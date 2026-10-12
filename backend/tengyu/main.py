from __future__ import annotations

import argparse
import asyncio
import os
import secrets
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from platformdirs import user_data_path

from . import __version__
from .files import scan_directory, thumbnail
from .models import BatchCreate, RetryRequest, ScanRequest, Settings, SettingsUpdate
from .providers import Credentials, ProviderError
from .storage import Store
from .tasks import SKILL_PATH, TaskManager


def validation_error_message(error: dict) -> dict[str, str]:
    location = error["loc"][1:]
    field = ".".join(map(str, location))
    labels = {
        "base_url": "生成服务地址", "models_url": "模型列表地址", "workspace_id": "业务空间 ID",
        "api_key": "API 密钥", "defaults": "生成设置", "options": "生成设置", "provider": "模型服务商",
        "model": "生成模型", "thinking": "深度思考", "language": "目标语言", "min_chars": "最少字符数",
        "max_chars": "最多字符数", "requirements": "补充要求", "concurrency": "同时处理数量",
        "directory": "商品文件夹", "mode": "商品识别方式", "scan_id": "扫描记录",
        "item_ids": "所选商品", "page": "页码",
    }
    label = next((labels[part] for part in reversed(location) if part in labels), "提交内容")
    kind, context = error["type"], error.get("ctx", {})
    if kind == "missing":
        message = f"请填写{label}。"
    elif kind in {"int_parsing", "int_type", "int_from_float"}:
        message = f"{label}请填写整数。"
    elif kind in {"float_parsing", "float_type", "finite_number"}:
        message = f"{label}请填写有效数字。"
    elif kind in {"greater_than_equal", "less_than_equal", "greater_than", "less_than"}:
        comparison, key = {
            "greater_than_equal": ("不能小于", "ge"), "less_than_equal": ("不能大于", "le"),
            "greater_than": ("必须大于", "gt"), "less_than": ("必须小于", "lt"),
        }[kind]
        message = f"{label}{comparison} {context[key]}。"
    elif kind == "string_too_short":
        limit = context["min_length"]
        message = f"{label}不能为空。" if limit == 1 else f"{label}至少需要 {limit} 个字符。"
    elif kind == "string_too_long":
        message = f"{label}不能超过 {context['max_length']} 个字符。"
    elif kind in {"too_short", "too_long"}:
        comparison, key = ("至少需要", "min_length") if kind == "too_short" else ("不能超过", "max_length")
        message = f"{label}{comparison} {context[key]} 项。"
    elif kind == "string_type":
        message = f"{label}请填写文字。"
    elif kind in {"bool_type", "bool_parsing", "literal_error"}:
        message = f"{label}的选项无效，请重新选择。"
    elif kind == "extra_forbidden":
        message = "包含不支持的字段，请移除后再提交。"
    elif kind == "json_invalid":
        message = "提交内容无法解析，请重新填写后再提交。"
    elif kind in {"empty_text", "character_range", "service_url", "models_url", "workspace_id"}:
        # Only these application-defined messages are safe to show; never echo input or arbitrary error text.
        message = error["msg"] if kind == "character_range" else f"{label}：{error['msg']}"
    else:
        message = f"{label}格式不正确，请检查后重新提交。"
    return {"field": field, "message": message}


def data_directory():
    return Path(os.environ.get("TENGYU_DATA_DIR", user_data_path("TengyuTitleStudio", appauthor=False)))


def create_app(data_dir: Path | None = None, token: str | None = None, credentials=None, providers=None):
    store = Store(data_dir or data_directory())
    manager = TaskManager(store, credentials or Credentials(), providers)
    session_token = token or secrets.token_urlsafe(32)

    @asynccontextmanager
    async def lifespan(app):
        store.recover()
        yield
        await manager.shutdown()

    app = FastAPI(title="腾域 ai 写标题", version=__version__, lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.state.manager, app.state.token = manager, session_token

    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        if request.url.path.startswith("/api/"):
            origin = request.headers.get("origin")
            if origin and urlsplit(origin).netloc != request.headers.get("host"):
                return JSONResponse({"detail": "此操作只能从程序窗口发起。"}, status_code=403)
            supplied = request.headers.get("authorization", "").removeprefix("Bearer ")
            if request.url.path != "/api/session":
                supplied = supplied or request.cookies.get("tengyu_session", "")
            if not secrets.compare_digest(supplied.encode(), session_token.encode()):
                return JSONResponse({"detail": "连接凭证已失效，请重新打开程序。"}, status_code=401)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ValueError)
    async def value_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.exception_handler(KeyError)
    async def missing(request, exc):
        return JSONResponse({"detail": "记录不存在，请刷新后重试。"}, status_code=404)

    @app.exception_handler(RequestValidationError)
    async def validation(request, exc):
        errors = [validation_error_message(error) for error in exc.errors()]
        return JSONResponse({"detail": "填写内容有误，请检查提示后修改。", "errors": errors}, status_code=422)

    @app.exception_handler(ProviderError)
    async def provider_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.get("/health")
    async def health():
        return {"status": "ok", "version": __version__}

    @app.post("/api/session")
    async def session():
        response = JSONResponse({"ok": True})
        response.set_cookie("tengyu_session", session_token, httponly=True, samesite="strict")
        return response

    @app.get("/api/settings")
    def settings():
        configured, warning = False, None
        try:
            configured = bool(manager.credentials.get("aliyun"))
        except ValueError as exc:
            warning = str(exc)
        return manager.settings().model_dump() | {"key_configured": configured, "credential_warning": warning}

    @app.put("/api/settings")
    async def save_settings(body: SettingsUpdate):
        if any(not t.done() for t in manager.tasks.values()):
            raise ValueError("请先暂停生成，等待当前请求结束后再修改设置。")
        previous = manager.settings()
        new = Settings.model_validate(body.model_dump(exclude={"api_key"}))
        if body.api_key is not None:
            await asyncio.to_thread(manager.credentials.set, "aliyun", body.api_key)
        store.put("settings", "current", new.model_dump())
        if ((previous.base_url, previous.models_url, previous.workspace_id) !=
                (new.base_url, new.models_url, new.workspace_id)):
            from .providers import PRESETS
            store.put("models", "aliyun", {"models": [m.model_dump() for m in PRESETS]})
        return settings()

    @app.get("/api/skill")
    def skill():
        return {"text": SKILL_PATH.read_text(encoding="utf-8")}

    @app.get("/api/providers")
    def providers_list():
        return [{"id": identifier, "name": "阿里云 · 千问" if identifier == "aliyun" else identifier}
                for identifier in manager.providers]

    @app.get("/api/providers/{provider}/models")
    def models(provider: str):
        if provider not in manager.providers:
            raise HTTPException(404, "服务商尚未接入")
        return {"models": [m.model_dump() for m in manager.models(provider)]}

    @app.post("/api/providers/{provider}/models/refresh")
    async def refresh_models(provider: str):
        if provider not in manager.providers:
            raise HTTPException(404, "服务商尚未接入")
        key = await asyncio.to_thread(manager.credentials.get, provider)
        if not key:
            raise ValueError("请先在设置中保存 API 密钥。")
        try:
            rows = await manager.providers[provider].list_models(manager.settings(), key)
        except httpx.HTTPError as exc:
            raise ValueError("模型列表获取失败，请检查网络后刷新；已有列表已保留。") from exc
        if not rows:
            raise ValueError("未获取到支持图片输入和文字输出的模型，已有列表已保留。")
        result = {"models": [m.model_dump() for m in rows]}
        store.put("models", provider, result)
        return result

    @app.post("/api/scans")
    async def scan(body: ScanRequest):
        try:
            result = await asyncio.to_thread(scan_directory, body.directory, body.mode)
        except OSError as exc:
            raise ValueError("无法读取商品文件夹，请检查路径和访问权限。") from exc
        store.put("scan", result["id"], result)
        return {k: v for k, v in result.items() if k != "items"} | {"total": len(result["items"])}

    def paged(items, status, page):
        counts = {name: sum(i["status"] == name for i in items) for name in (
            "pending", "running", "completed", "review", "failed", "unknown")}
        if status != "all":
            items = [i for i in items if i["status"] == status]
        result = [{k: v for k, v in i.items() if k != "raw"} for i in items[(page-1)*50:page*50]]
        return {"items": result, "total": len(items), "page": page, "page_size": 50, "counts": counts}

    @app.get("/api/scans/{scan_id}/items")
    def scan_items(scan_id: str, status: str = "all", page: int = Query(1, ge=1)):
        return paged(store.get("scan", scan_id)["items"], status, page)

    @app.post("/api/batches")
    async def create_batch(body: BatchCreate):
        return manager.create(body.scan_id, body.options)

    @app.get("/api/batches")
    def batches():
        return [manager.summary(b["id"]) for b in store.all("batch")]

    @app.get("/api/batches/{batch_id}")
    def batch(batch_id: str):
        return manager.summary(batch_id)

    @app.get("/api/batches/{batch_id}/items")
    def batch_items(batch_id: str, status: str = "all", page: int = Query(1, ge=1)):
        store.get("batch", batch_id)
        return paged(store.items(batch_id), status, page)

    @app.get("/api/batches/{batch_id}/items/{item_id}")
    def detail(batch_id: str, item_id: str):
        item = store.item(item_id)
        if item["batch_id"] != batch_id:
            raise HTTPException(404, "商品记录不存在。")
        return item | {"attempts": store.attempts(item_id)}

    @app.get("/api/images/{kind}/{identifier}/{item_id}")
    async def image(kind: str, identifier: str, item_id: str):
        if kind == "scan":
            item = next((i for i in store.get("scan", identifier)["items"] if i["id"] == item_id), None)
        elif kind == "batch":
            item = store.item(item_id)
            if item["batch_id"] != identifier:
                item = None
        else:
            item = None
        if not item or not item["image_path"] or not item["fingerprint"]:
            raise HTTPException(404, "图片不可用")
        return Response(await asyncio.to_thread(thumbnail, item), media_type="image/jpeg")

    @app.post("/api/batches/{batch_id}/start")
    async def start(batch_id: str):
        return await manager.start(batch_id)

    @app.post("/api/batches/{batch_id}/pause")
    async def pause(batch_id: str):
        return manager.pause(batch_id)

    @app.post("/api/batches/{batch_id}/retry")
    async def retry(batch_id: str, body: RetryRequest):
        return await manager.retry(batch_id, body.item_ids)

    @app.post("/api/batches/{batch_id}/export")
    async def export(batch_id: str):
        return await manager.export(batch_id)

    @app.get("/api/batches/{batch_id}/excel")
    def download(batch_id: str):
        batch = store.get("batch", batch_id)
        path = Path(batch["excel_path"])
        if not path.is_file():
            raise HTTPException(404, "此批次尚未导出 Excel")
        return FileResponse(path, filename=path.name)

    root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
    frontend = root / "frontend" / "dist"
    if frontend.is_dir():
        app.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
    return app


def run():
    parser = argparse.ArgumentParser(description="腾域 ai 写标题 — 本地预览")
    parser.add_argument("--port", type=int, default=4315)
    parser.add_argument("--data-dir", type=Path)
    args = parser.parse_args()
    app = create_app(args.data_dir)
    print(f"本地预览：http://127.0.0.1:{args.port}/#token={app.state.token}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    run()
