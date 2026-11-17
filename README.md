# 腾域 ai 写标题

全中文、蓝白风格的跨境电商标题批处理桌面程序。用 **Python + FastAPI** 处理本地图片与模型调用，通过 **React + pywebview** 显示独立窗口，输出只有「货号、标题」两列的 Excel。

> 已在本机完成 Windows 构建，安装包位于 `dist/installer/TengyuTitleStudio-Setup-0.1.0-x64.exe`，构建产物不纳入 Git。打包程序的启动、页面加载、图片扫描和设置弹窗已验证；尚未完成干净 Windows 系统上的安装、升级和卸载验收。真实阿里云调用需要自行在界面中配置 API Key。

![蓝白界面预览](docs/ui-empty.png)

## 使用流程

1. 打开右上角「设置」，填写阿里云 API Key 和匹配的服务地址，保存。
2. 选择「货号目录」或「图片目录」，选择文件夹并点击「扫描商品」。
3. 查看所选图片，设置模型、思考开关、目标语言、字符范围和补充要求。
4. 点击「开始生成」。可以暂停、继续，并在任务收尾后选择项目重新生成。
5. 完成后在输入目录找到 Excel，也可以点击「打开结果」。

### 语言与标题前后缀

- 「目标语言」内置常用语言和地区选项，可展开下拉列表选择，也可直接输入列表以外的语言。
- 「标题前缀」「标题后缀」为选填项，由程序在模型生成正文后原样拼接，不要求模型生成这些内容。
- 前后缀的连接符由用户直接手动输入，支持任意单行文字、符号和空格，输入内容原样保留。默认留空表示直接拼接；没有前缀或后缀时，不添加对应连接符。
- 拼接预览可查看组合形式。例如前缀「品牌」、前缀连接符「 - 」、后缀「系列」、后缀连接符「 」会得到「品牌 - 生成的标题 系列」。
- 字符数范围约束拼接后的完整标题；请求模型时会预留前后缀和连接符的长度，结果列表和 Excel 使用同一完整标题。AI 自报字数仅供参考，不参与合格判定，原始 JSON 保留不变。
- 设置随批次固定，恢复或手动重新生成使用该批次原有设置；旧批次没有前后缀时保持原行为。修改拼接方式需开始新批次。

### 两种目录模式

| 模式 | 示例 | 货号 | 读取规则 |
| --- | --- | --- | --- |
| 货号目录 | `商品总目录/00123/1.jpg` | `00123` | 每个一级货号文件夹取自然排序的第一张图片 |
| 图片目录 | `商品图片/ABC001.jpg` | `ABC001` | 当前目录每张图片生成一条标题 |

自然排序按照 `1、2、10` 排列，不扫描更深层目录。支持 JPG、JPEG、PNG、WebP、BMP；空文件夹、损坏的第一张图片会标记失败，不偷偷改用其他图片。同名不同后缀的图片各自占一行，并提示货号重复。

### 标题与 Excel

- 内置通用标题规则：使用可确认的商品事实，遵守目标语言、字符范围和用户补充要求，不凭图片猜测品牌、材质、尺寸等未知属性。
- 每件商品只请求一次。没有自动修正和自动重试；重新生成由用户明确点击，可能再次计费。
- 按 Unicode grapheme cluster 统计可见字符，空格和标点也计入。
- 新批次只要求模型输出标题 JSON：`{"title":"Blue bag"}`。程序独立计数，结果列表显示拼接后完整标题的实算值。
- 保存模型原始 JSON，兼容旧版 `char_count` 字段；自报数字不准、缺失或格式不正确都不会使有效标题被标记为「需检查」。长度不足或超出时，明确提示「还差 N 字符」或「超出 N 字符」，不会自动再次请求模型。
- 从 JSON 提取标题正文并规范空白后保存，Excel 标题列只写标题，不包含 JSON 或字符数，也不自动截断或改写标题。
- 已有批次继续使用创建时保存的生成规则与设置。升级后启动应用会在本地重新检查已有标题，纠正仅因自报字数产生的误报；无需重新生成。历史请求原始记录保留，已有 Excel 不会被自动覆盖，请在历史批次中重新导出以更新标记。
- 长度不符的标题仍导出，单元格标黄并附批注；失败及待处理项目保留货号，标题为空。
- Excel 文件写入所选总目录，文件名固定为 `标题.xlsx`，不添加日期、时间或批次编号。同一文件夹再次导出会更新此文件；如需其他历史批次，请打开对应批次重新导出。货号与标题都按文本写入，保留前导零并防止内容被当成公式。
- 结果分项保存，退出后可以恢复。请求被打断时标记「结果未知」，不会自动再次调用。
- 批次开始后固定图片、规则和设置。更换图片或服务地址后，请重新扫描创建新批次。

## 技术结构

```text
backend/tengyu/     FastAPI、扫描、任务队列、服务商适配、SQLite、Excel
frontend/src/      React、TypeScript、Tailwind CSS、Base UI
tests/             不调用真实模型的自动化测试
packaging/         pywebview 启动入口、PyInstaller 和 Inno Setup 配置
scripts/           Windows 构建脚本
.github/workflows/ Linux/Windows 代码检查、手动 Windows 打包
```

界面由本机 FastAPI 提供，默认并发 3 个任务，可设置为 1～10。仅启动一个 Uvicorn 进程，通过桌面桥接打开目录和输出文件。API 在每次启动时使用新的随机会话凭证，仅监听 `127.0.0.1`。

### 本地开发（按需自行执行）

需要 Python 3.12、uv、Node.js 24。仓库锁定 Python 和前端依赖；开发者执行下列命令时会安装依赖。

```bash
uv sync --frozen --python 3.12
cd frontend
npm ci
npm run build
cd ..
uv run --no-sync tengyu-title-web
```

终端会显示带一次性连接凭证的本地预览地址。在浏览器打开该地址，凭证会从地址栏移除。浏览器预览时可手动输入本机目录路径；系统目录选择框和打开资源管理器功能需要桌面窗口。

Windows 桌面开发运行：

```powershell
uv run --no-sync tengyu-title
```

Vite 开发服务器：先保持后端运行，再执行 `npm run dev`；首次打开 Vite 地址时附上后端预览地址中的 `#token=...`。仅用于本机开发，不应将后端绑定到公网或局域网。

### 自动化检查

```bash
uv run --no-sync ruff check backend tests
uv run --no-sync pytest -q
cd frontend
npm run build
```

前端交互测试使用模拟 API，可执行 `npm run test:ui`。需事先具备匹配版本的 Playwright Chromium；没有时可按需执行 `npx playwright install chromium`。本次没有新下载浏览器运行环境。

代码检查工作流在推送和 Pull Request 时运行 Linux、Windows 两个环境，测试使用模拟模型，不需要 API Key、不产生模型费用。

### Windows 安装包（手动触发）

GitHub 仓库打开 **Actions → Windows installer → Run workflow**。成功后下载 `TengyuTitleStudio-Windows-x64` 构建产物。

推送与应用版本一致的 `v*` 标签时，同一流程会自动打包，并将安装包及 `SHA256SUMS.txt` 上传至 [GitHub Releases](https://github.com/axgiroud312-byte/tengyu-title-studio/releases)。

也可以在装有 uv、Node.js 24 和 Inno Setup 6 的 Windows 64 位构建机运行：

```powershell
.\scripts\build-windows.ps1
```

脚本会先检查代码，再创建安装包。WebView2 引导安装器从微软官方下载，打包前验证 Microsoft Authenticode 签名。用户电脑缺少 WebView2 时，安装器联网补装；已有运行组件则直接安装应用。

安装包默认安装到当前用户目录，建立桌面快捷方式，升级和卸载保留用户配置、任务记录及商品文件。安装包构建成功不等于 Windows GUI 验收完成，仍需在干净的 Windows 10/11 64 位电脑验证安装、显示缩放、凭据读写、打开窗口及卸载。

## 阿里云配置

默认服务地址：`https://dashscope.aliyuncs.com/compatible-mode/v1`。默认预设型号为 `qwen3.8-flash`；切换到其他地域或业务空间时按官方文档填写匹配的地址与密钥。

模型目录使用独立的 `/api/v1/models` 接口，完整翻页并筛选图片输入、文字输出能力。北京地域目录查询可填写业务空间 ID，也可单独填写完整模型目录地址。目录刷新失败保留原列表，不代表模型不可用；目录出现某型号也不代表账号已开通。

支持切换思考的模型显示开关；已知固定思考模式的型号显示固定状态；未知能力跟随模型默认。只有模型最终正文进入标题，思考过程不会混入。

参考文档：[快速入门](https://platform.qianwenai.com/docs/developer-guides/getting-started/introduction)、[模型目录](https://help.aliyun.com/zh/model-studio/list-models)、[图片输入](https://help.aliyun.com/zh/model-studio/vision)、[思考模式](https://platform.qianwenai.com/docs/developer-guides/text-generation/thinking)。

## 增加其他服务商

在 `providers.py` 增加符合 `TextProvider` 的适配器并注册到 `PROVIDERS`，实现 `list_models()` 和 `generate_title()`。通过 `ModelInfo` 声明图片、文字和思考能力；将各家的鉴权、请求格式、错误与返回内容转换为统一结构。

首版界面和凭据设置只有阿里云。增加服务商时还需增加对应设置表单和凭据项，目录、任务队列和 Excel 模块无需重写。普通纯文本模型不能用于本程序的看图标题流程。

## 数据与隐私

- Windows 数据目录：`%LOCALAPPDATA%\TengyuTitleStudio`，SQLite 保存原始标题、设置快照、Skill 版本和请求状态。
- Windows API Key 保存在系统凭据管理器，服务名 `com.tengyu.title-studio`，不写入数据库、Excel、日志或仓库。
- 商品图片仅在调用时发送到用户选定的模型服务，原始图片不会被修改。
- `TENGYU_DATA_DIR` 可指定开发测试的数据目录。不要把真实任务数据库、密钥、商品图片或本地构建目录提交到公开仓库。

当前验证范围见 [验收记录](docs/VALIDATION.md)。
