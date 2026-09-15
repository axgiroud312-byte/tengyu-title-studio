# Run on Windows from the repository root.
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_data_files

root = Path(SPECPATH).parent
webview_data, webview_binaries, webview_imports = collect_all("webview")
lingua_data, lingua_binaries, lingua_imports = collect_all("lingua")
analysis = Analysis(
    [str(root / "packaging" / "entrypoint.py")],
    pathex=[str(root / "backend")],
    binaries=webview_binaries + lingua_binaries,
    datas=webview_data + lingua_data + collect_data_files("tengyu") + [
        (str(root / "frontend" / "dist"), "frontend/dist"),
    ],
    hiddenimports=webview_imports + lingua_imports + ["keyring.backends.Windows", "uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto", "uvicorn.lifespan.on"],
    excludes=["PyQt5", "PyQt6", "PySide6", "pytest", "tkinter"],
    noarchive=False,
)
pyz = PYZ(analysis.pure)
exe = EXE(pyz, analysis.scripts, [], exclude_binaries=True, name="TengyuTitleStudio",
          console=False, debug=False, strip=False, upx=False)
collection = COLLECT(exe, analysis.binaries, analysis.datas, strip=False, upx=False, name="TengyuTitleStudio")
