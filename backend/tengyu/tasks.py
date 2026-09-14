from __future__ import annotations

import asyncio
import hashlib
import uuid
from datetime import datetime
from pathlib import Path

from .files import check_output, encoded_image, evaluate_title, export_excel, verify_source
from .models import ModelInfo, Settings, TitleOptions
from .providers import PRESETS, PROVIDERS, ProviderError, validate_model
from .storage import Store, now

SKILL_PATH = Path(__file__).parent / "resources" / "title_skill.md"


class TaskManager:
    def __init__(self, store: Store, credentials, providers=None):
        self.store, self.credentials = store, credentials
        self.providers = providers if providers is not None else PROVIDERS
        self.tasks: dict[str, asyncio.Task] = {}
        self.control_lock = asyncio.Lock()
        self.export_lock = asyncio.Lock()

    def settings(self) -> Settings:
        try:
            return Settings.model_validate(self.store.get("settings", "current"))
        except KeyError:
            return Settings()

    def models(self, provider: str) -> list[ModelInfo]:
        try:
            return [ModelInfo.model_validate(m) for m in self.store.get("models", provider)["models"]]
        except KeyError:
            return list(PRESETS) if provider == "aliyun" else []

    def create(self, scan_id: str, options: TitleOptions) -> dict:
        if any(b["status"] in {"running", "pausing"} for b in self.store.all("batch")):
            raise ValueError("请先暂停当前批次，再创建新批次。")
        if options.provider not in self.providers:
            raise ValueError("尚未接入此服务商")
        model = next((m for m in self.models(options.provider) if m.id == options.model), None)
        if model is None:
            raise ValueError("请从当前模型目录中选择模型。")
        validate_model(model, options)
        scan = self.store.get("scan", scan_id)
        if not scan["items"]:
            raise ValueError("此目录没有待处理的商品。")
        check_output(Path(scan["directory"]))
        identifier = uuid.uuid4().hex
        skill = SKILL_PATH.read_text(encoding="utf-8")
        batch = {"id": identifier, "created_at": now(), "mode": scan["mode"], "directory": scan["directory"],
                 "options": options.model_dump(), "settings": self.settings().model_dump(),
                 "model_info": model.model_dump(), "skill": skill,
                 "skill_version": hashlib.sha256(skill.encode()).hexdigest()[:12],
                 "status": "ready", "error": None, "export_error": None, "exported_at": None,
                 "excel_path": str(Path(scan["directory"]) / f"标题_{datetime.now():%Y%m%d_%H%M%S}_{identifier[:6]}.xlsx")}
        items = [{**item, "id": uuid.uuid4().hex, "batch_id": identifier} for item in scan["items"]]
        self.store.create_batch(batch, items)
        return self.summary(identifier)

    def summary(self, identifier: str):
        batch = self.store.get("batch", identifier)
        items = self.store.items(identifier)
        counts = {name: sum(i["status"] == name for i in items) for name in (
            "pending", "running", "completed", "review", "failed", "unknown")}
        return {k: v for k, v in batch.items() if k not in {"skill", "settings"}} | {
            "counts": counts, "total": len(items), "processed": len(items) - counts["pending"] - counts["running"]}

    async def start(self, identifier: str, only_ids: set[str] | None = None):
        async with self.control_lock:
            batch = self.store.get("batch", identifier)
            if identifier in self.tasks and not self.tasks[identifier].done():
                raise ValueError("当前批次正在运行或收尾，请稍候。")
            if any(not t.done() for t in self.tasks.values()):
                raise ValueError("请先暂停其他运行中的批次。")
            check_output(Path(batch["directory"]))
            key = self.credentials.get(batch["options"]["provider"])
            if not key:
                raise ValueError("请先在设置中保存阿里云 API Key。")
            for item in self.store.items(identifier):
                if item["status"] == "pending" and (only_ids is None or item["id"] in only_ids):
                    try:
                        await asyncio.to_thread(verify_source, item)
                    except (ValueError, OSError) as exc:
                        item.update(status="failed", error="源图片发生变化或不可读，请重新扫描。", input_error=str(exc))
                        self.store.save_item(item)
            batch.update(status="running", error=None)
            self.store.put("batch", identifier, batch)
            self.tasks[identifier] = asyncio.create_task(self._run(identifier, key, only_ids))
        return self.summary(identifier)

    async def _worker(self, identifier: str, key: str, only_ids: set[str] | None):
        # Claims are synchronous on this single event loop before the next await.
        while True:
            batch = self.store.get("batch", identifier)
            if batch["status"] != "running":
                return
            item = next((i for i in self.store.items(identifier) if i["status"] == "pending"
                         and (only_ids is None or i["id"] in only_ids)), None)
            if not item:
                return
            item.update(status="running", error=None, title=None, raw=None, char_count=None)
            self.store.save_item(item)
            attempt_id = self.store.begin_attempt(item["id"])
            options = TitleOptions.model_validate(batch["options"])
            details = {}
            try:
                image = await asyncio.to_thread(encoded_image, item)
                result = await self.providers[options.provider].generate_title(
                    Settings.model_validate(batch["settings"]), key, options, batch["skill"], image)
                details = result.model_dump()
                item.update(raw=result.raw, elapsed=result.elapsed,
                            **evaluate_title(result.raw, result.finish, options.min_chars, options.max_chars))
            except ProviderError as exc:
                item.update(status="unknown" if exc.uncertain else "failed", error=str(exc), raw=exc.raw)
                if exc.global_error:
                    current = self.store.get("batch", identifier)
                    current.update(status="pausing", error=str(exc))
                    self.store.put("batch", identifier, current)
            except asyncio.CancelledError:
                item.update(status="unknown", error="程序已退出，请求结果未知；请手动决定是否重试。")
                raise
            except (ValueError, OSError):
                item.update(status="failed", error="图片发生变化或无法处理，请重新扫描此目录。")
            except Exception:
                item.update(status="failed", error="处理出现异常，原始记录已保留；请重新打开程序后查看。")
            finally:
                self.store.save_item(item)
                self.store.finish_attempt(attempt_id, details | {"status": item["status"], "error": item["error"],
                                                                "raw": item["raw"], "title": item["title"]})

    async def _run(self, identifier: str, key: str, only_ids: set[str] | None = None):
        batch = self.store.get("batch", identifier)
        try:
            await asyncio.gather(*(self._worker(identifier, key, only_ids)
                                   for _ in range(batch["options"]["concurrency"])))
        finally:
            current = self.store.get("batch", identifier)
            pending = any(i["status"] == "pending" for i in self.store.items(identifier))
            current["status"] = "paused" if pending else "completed"
            self.store.put("batch", identifier, current)
        if not pending:
            await self.export(identifier)

    def pause(self, identifier: str):
        batch = self.store.get("batch", identifier)
        if batch["status"] == "running":
            batch["status"] = "pausing"
            self.store.put("batch", identifier, batch)
        return self.summary(identifier)

    async def retry(self, identifier: str, item_ids: list[str]):
        async with self.control_lock:
            batch = self.store.get("batch", identifier)
            if batch["status"] in {"running", "pausing"} or any(not t.done() for t in self.tasks.values()):
                raise ValueError("请等待当前请求收尾后再重试。")
            items = [self.store.item(i) for i in set(item_ids)]
            if any(i["batch_id"] != identifier for i in items):
                raise ValueError("选中商品不属于此批次")
            if any(i["status"] in {"pending", "running"} for i in items):
                raise ValueError("待处理项目请使用继续生成。")
            if any(i["input_error"] for i in items):
                raise ValueError("包含图片输入错误的项目，请修复图片后重新扫描。")
            if not self.credentials.get(batch["options"]["provider"]):
                raise ValueError("请先在设置中保存 API Key。")
            for item in items:
                await asyncio.to_thread(verify_source, item)
            for item in items:
                item.update(status="pending", title=None, raw=None, char_count=None, error=None)
                self.store.save_item(item)
            batch.update(status="paused", error=None, exported_at=None)
            self.store.put("batch", identifier, batch)
        return await self.start(identifier, set(item_ids))

    async def export(self, identifier: str):
        async with self.export_lock:
            batch = self.store.get("batch", identifier)
            try:
                await asyncio.to_thread(export_excel, batch, self.store.items(identifier))
                batch = self.store.get("batch", identifier)
                batch.update(exported_at=now(), export_error=None)
            except (ValueError, OSError) as exc:
                batch = self.store.get("batch", identifier)
                batch["export_error"] = str(exc) if isinstance(exc, ValueError) else "保存 Excel 失败，请检查目录权限和磁盘空间。"
            self.store.put("batch", identifier, batch)
        return self.summary(identifier)

    async def shutdown(self):
        for identifier in self.tasks:
            self.pause(identifier)
        active = [t for t in self.tasks.values() if not t.done()]
        if active:
            _, pending = await asyncio.wait(active, timeout=3)
            for task in pending:
                task.cancel()
            await asyncio.gather(*active, return_exceptions=True)
