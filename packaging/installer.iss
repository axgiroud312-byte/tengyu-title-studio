#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

[Setup]
AppId={{35A8D0BC-7E3F-4C49-92C7-142B19B2B6AB}
AppName=腾域 ai 写标题
AppVersion={#AppVersion}
AppPublisher=腾域
DefaultDirName={localappdata}\Programs\TengyuTitleStudio
DefaultGroupName=腾域 ai 写标题
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\dist\installer
OutputBaseFilename=TengyuTitleStudio-Setup-{#AppVersion}-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\TengyuTitleStudio.exe
CloseApplications=yes

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Default.isl"

[Messages]
LanguageName=简体中文
WelcomeLabel1=欢迎安装 腾域 ai 写标题
WelcomeLabel2=安装程序将把 [name/ver] 安装到你的电脑。%n%n请关闭正在运行的程序，然后单击“下一步”。
ButtonNext=下一步(&N) >
ButtonBack=< 上一步(&B)
ButtonCancel=取消(&C)
ButtonInstall=安装(&I)
ButtonFinish=完成(&F)
ButtonBrowse=浏览(&B)...
WizardSelectDir=选择安装位置
SelectDirDesc=你想将 [name] 安装在哪里？
SelectDirLabel3=安装程序将把 [name] 安装到以下文件夹。
SelectDirBrowseLabel=单击“下一步”继续，或单击“浏览”选择其他文件夹。
WizardSelectTasks=选择附加任务
SelectTasksDesc=你希望执行哪些附加任务？
SelectTasksLabel2=选择安装时需要执行的附加任务，然后单击“下一步”。
WizardReady=准备安装
ReadyLabel1=安装程序已准备好将 [name] 安装到你的电脑。
ReadyLabel2b=单击“安装”继续，或单击“上一步”修改设置。
ReadyMemoDir=安装位置：
ReadyMemoGroup=开始菜单文件夹：
ReadyMemoTasks=附加任务：
WizardInstalling=正在安装
InstallingLabel=正在安装 [name]，请稍候。
FinishedHeadingLabel=已完成 [name] 安装
FinishedLabelNoIcons=[name] 已安装到你的电脑。
FinishedLabel=你可以通过桌面或开始菜单快捷方式打开 [name]。
ClickFinish=单击“完成”退出安装程序。
ConfirmUninstall=确定要卸载 %1 及其程序组件吗？
UninstallStatusLabel=正在卸载 %1，请稍候。
UninstalledAll=%1 已成功卸载。你的商品文件、设置和批次记录已保留。

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: checkedonce

[Files]
Source: "..\dist\TengyuTitleStudio\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "vendor\MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy

[Icons]
Name: "{group}\腾域 ai 写标题"; Filename: "{app}\TengyuTitleStudio.exe"
Name: "{autodesktop}\腾域 ai 写标题"; Filename: "{app}\TengyuTitleStudio.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\TengyuTitleStudio.exe"; Description: "打开 腾域 ai 写标题"; Flags: nowait postinstall skipifsilent

[Code]
function HasWebView2: Boolean;
var Version: String;
begin
  Result := (RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'))
    or (RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var ExitCode: Integer;
begin
  Result := '';
  if not HasWebView2 then begin
    ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
      Result := '无法启动 WebView2 安装程序，请检查权限后重试。'
    else if not HasWebView2 then
      Result := 'WebView2 尚未安装成功。请保持联网，然后重试安装。';
  end;
end;
