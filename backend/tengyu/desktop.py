from __future__ import annotations

import os
import secrets
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import uvicorn
from filelock import FileLock, Timeout

from .main import create_app, data_directory


def open_path(path: Path):
    if sys.platform == "win32":
        os.startfile(str(path))
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


class Bridge:
    def __init__(self, token, store):
        self._token, self._store, self._window = token, store, None

    def bootstrap(self):
        return {"token": self._token}

    def choose_directory(self):
        import webview
        result = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        return result[0] if result else None

    def open_output(self, batch_id: str, directory: bool = False):
        try:
            batch = self._store.get("batch", batch_id)
            path = Path(batch["directory"] if directory else batch["excel_path"])
            if not path.exists():
                return {"error": "文件尚未生成或已被移走。"}
            open_path(path)
            return {"ok": True}
        except (KeyError, OSError):
            return {"error": "无法打开文件，请在资源管理器中查看商品文件夹。"}


def show_error(message: str):
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, message, "腾域 ai 写标题", 0x10)
    else:
        print(message, file=sys.stderr)


def main():
    import webview
    data = data_directory()
    data.mkdir(parents=True, exist_ok=True)
    lock = FileLock(data / "desktop.lock")
    try:
        lock.acquire(timeout=0)
    except Timeout:
        show_error("腾域 ai 写标题已在运行，请从任务栏打开现有窗口。")
        return
    server, thread, sock = None, None, None
    try:
        token = secrets.token_urlsafe(32)
        app = create_app(data, token)
        # Bind the actual server socket once; avoid the free-port selection race.
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        sock.listen(128)
        server = uvicorn.Server(uvicorn.Config(app, access_log=False, log_level="warning"))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
        thread.start()
        deadline = time.monotonic() + 15
        while not server.started:
            if time.monotonic() > deadline or not thread.is_alive():
                raise RuntimeError("本地服务启动失败，请重新打开程序。")
            time.sleep(0.05)
        bridge = Bridge(token, app.state.manager.store)
        screen = webview.screens[0]
        window = webview.create_window("腾域 ai 写标题", f"http://127.0.0.1:{sock.getsockname()[1]}/",
                                       js_api=bridge, width=min(1280, screen.width - 60),
                                       height=min(800, screen.height - 80), min_size=(800, 520),
                                       background_color="#EFF6FF", text_select=True)
        bridge._window = window
        webview.start(gui="edgechromium" if sys.platform == "win32" else None, debug=False,
                      private_mode=True, icon=str(Path(__file__).resolve().parent / "resources" / "app.ico"))
    except Exception:
        show_error("程序启动失败。Windows 请确认 WebView2 已安装，或重新运行安装包修复。")
    finally:
        if server:
            server.should_exit = True
        if thread:
            thread.join(timeout=12)
        if sock:
            sock.close()
        lock.release()


if __name__ == "__main__":
    main()
