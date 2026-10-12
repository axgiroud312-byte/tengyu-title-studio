param([string]$Version = "0.1.0")
$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "此脚本必须在 Windows 64 位环境执行。" }
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Run-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program 执行失败，退出码 $LASTEXITCODE" }
}

$compilerCandidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
)
$compilerCommand = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
if ($compilerCommand) { $compilerCandidates += $compilerCommand.Source }
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw "请安装 Inno Setup 6 后重新执行脚本。" }

Run-Checked "uv" @("sync", "--frozen", "--python", "3.12")
Push-Location "frontend"
try {
    Run-Checked "npm.cmd" @("ci", "--no-audit", "--no-fund")
    Run-Checked "npm.cmd" @("run", "build")
} finally { Pop-Location }
Run-Checked ".venv\Scripts\python.exe" @("-m", "ruff", "check", "backend", "tests")
Run-Checked ".venv\Scripts\python.exe" @("-m", "pytest", "-q")
Run-Checked ".venv\Scripts\python.exe" @("-m", "PyInstaller", "--noconfirm", "--clean", "packaging\tengyu-title.spec")

$vendorPath = Join-Path $projectRoot "packaging\vendor"
New-Item -ItemType Directory -Force -Path $vendorPath | Out-Null
$bootstrapper = Join-Path $vendorPath "MicrosoftEdgeWebview2Setup.exe"
Invoke-WebRequest "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile $bootstrapper
$signature = Get-AuthenticodeSignature $bootstrapper
if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Subject -notmatch "Microsoft Corporation") {
    throw "WebView2 安装器签名验证失败，已停止打包。"
}
Run-Checked $compiler @("/DAppVersion=$Version", "packaging\installer.iss")
Write-Host "安装包已生成到 dist\installer。请在干净 Windows 环境完成安装验收。"
