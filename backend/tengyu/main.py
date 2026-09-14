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
        errors = [{"field": ".".join(map(str, e["loc"][1:])), "message": e["msg"]} for e in exc.errors()]
        return JSONResponse({"detail": "设置内容有误，请检查输入。", "errors": errors}, status_code=422)

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
            raise ValueError("请先暂停并等待当前请求收尾，再修改服务设置。")
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
            raise ValueError("请先在设置中保存 API Key。")
        try:
            rows = await manager.providers[provider].list_models(manager.settings(), key)
        except httpx.HTTPError as exc:
            raise ValueError("模型目录连接失败，请检查网络；已有列表已保留。") from exc
        if not rows:
            raise ValueError("目录未返回可看图写标题的模型，已有列表已保留。")
        result = {"models": [m.model_dump() for m in rows]}
        store.put("models", provider, result)
        return result

    @app.post("/api/scans")
    async def scan(body: ScanRequest):
        try:
            result = await asyncio.to_thread(scan_directory, body.directory, body.mode)
        except OSError as exc:
            raise ValueError("无法读取此目录，请检查路径和访问权限。") from exc
        store.put("scan", result["id"], result)
        return {k: v for k, v in result.items() if k != "items"} | {"total": len(result["items"])}

    def paged(items, status, page):
        counts = {name: sum(i["status"] == name for i in items) for name in (
            "pending", "running", "completed", "review", "failed", "unknown")}
        if status != "all":
            accepted = {"failed", "unknown"} if status == "failed" else {status}
            items = [i for i in items if i["status"] in accepted]
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
            raise HTTPException(404, "项目不存在")
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
