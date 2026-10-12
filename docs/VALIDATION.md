# 验收记录

## 2026-09-14 本机环境构建与打包

### Logo 更新与重新打包

- 新增蓝白 T / 钢笔尖 Logo，原图保留在 `packaging/assets/app-icon-source.png`，前端使用 `frontend/public/app-icon.png`。
- Windows 图标位于 `backend/tengyu/resources/app.ico`，包含 16、24、32、48、64、128、256 像素版本；已用于 EXE、安装器及桌面窗口，应用页眉与 favicon 使用同一标识。
- 重新执行 Ruff、31 项 pytest、TypeScript/Vite 和 5 项 Playwright 测试，全部通过，重新生成同名 0.1.0 安装包并更新 `dist/installer/SHA256SUMS.txt`。
- 读取 EXE 与安装器 PE 资源，确认各自嵌入的 7 个图标帧均与源 ICO 一致；确认运行时 ICO 随包分发。
- 实际启动新版 EXE，确认 Logo 图片加载、桌面桥接、真实本地图片扫描和设置弹窗正常。截图：`build/verification/packaged-app-with-icon.png`；构建日志：`build/verification/build-with-icon.log`。验证进程已正常关闭，未调用模型。

### 环境与基础验证

- 开发环境：Python 3.12.13、uv 0.12.9、Node.js 24.14.0、npm 11.9.0；已通过锁文件安装 Python 和前端依赖。
- 本轮重新执行 Ruff、31 项 pytest、TypeScript/Vite 构建和 5 项 Playwright 测试，全部通过。Playwright 已补装匹配的 Chromium。
- PyInstaller 和 Inno Setup 编译成功，产物：`dist/installer/TengyuTitleStudio-Setup-0.1.0-x64.exe`。
- 修复构建脚本对个人目录安装的 Inno Setup 的识别，增加打包前 Ruff 检查；修复安装器 `LanguageName` 所属配置节。
- 实际启动 `dist/TengyuTitleStudio/TengyuTitleStudio.exe`，确认窗口响应、页面渲染、WebView2 桌面桥接、真实本地测试图片扫描和设置弹窗正常。验证使用独立的 `build/verification/app-data/` 数据目录，没有调用模型。
- 截图：`build/verification/packaged-app.png`；构建日志：`build/verification/build-windows.log`；最终安装器编译日志：`build/verification/installer-compile.log`。临时调试进程已正常关闭。
- WebView2 引导安装器的 Microsoft Authenticode 签名验证通过。
- 本轮未运行安装向导，未进行干净系统安装、升级、卸载、系统凭据写入及多种 Windows DPI 验收。上述程序验证不能替代这些验收。

以下保留项目既有检查范围说明。

## 已完成的本地代码检查

- Python 语法检查通过。
- Ruff 检查通过。
- 31 项自动化测试通过，覆盖目录扫描、可见字符、Excel 文本写入、请求解析、模型目录分页、单次调用、密钥保护、任务暂停/恢复、单项重试及异常导出。
- TypeScript 检查及 Vite 生产构建通过。
- 5 项 Playwright 界面测试通过：1366×768、1920×1080，以及模拟缩放后可用空间的 1092×614、910×512；检查主要操作可见、窄窗设置弹窗和扫描请求。此项为浏览器视口测试，不能替代真实 Windows DPI 验收。
- 在本地实际页面检查蓝白布局，并使用测试目录完成图片扫描。界面预览见 `ui-empty.png`。
- 检查使用已经存在的本地工具；测试中的模型响应为模拟数据，不调用真实模型。

## 尚未完成的外部验收

- 未使用真实阿里云 API Key 进行计费调用，不宣称任何型号已经实测可用。
- 尚未完成干净 Windows 系统上的安装、系统凭据读写、多种显示缩放、升级和卸载验收；本机打包程序启动及 WebView2 页面验证见上。
- 尚未触发 Windows 安装包构建工作流。

安装包工作流仅按需手动运行。公开仓库的代码检查工作流与安装包构建分开，自动化检查结果以对应 GitHub Actions 运行记录为准。
