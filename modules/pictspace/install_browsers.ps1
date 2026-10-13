# 使用国内镜像安装 Playwright 浏览器（Chromium）
# 用法: powershell -ExecutionPolicy Bypass -File .\install_browsers.ps1

$ErrorActionPreference = "Stop"
$Python = "python"

# npmmirror Playwright 驱动镜像（ffmpeg / winldd 等仍可用）
$env:PLAYWRIGHT_DOWNLOAD_HOST = "https://cdn.npmmirror.com/binaries/playwright"
# 固定安装到用户目录，避免沙箱临时路径
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:LOCALAPPDATA "ms-playwright"

Write-Host "PLAYWRIGHT_DOWNLOAD_HOST=$env:PLAYWRIGHT_DOWNLOAD_HOST"
Write-Host "PLAYWRIGHT_BROWSERS_PATH=$env:PLAYWRIGHT_BROWSERS_PATH"
Write-Host "正在安装 chromium ..."

# 新版 Chromium(CFT) 镜像路径常 404，先尝试官方/镜像自动装；失败则手动从 chrome-for-testing 镜像拉取
try {
    & $Python -m playwright install chromium
    Write-Host "安装完成。"
    exit 0
} catch {
    Write-Host "自动安装失败，改为手动从 npmmirror chrome-for-testing 下载..."
}

$dry = & $Python -m playwright install chromium --dry-run 2>&1 | Out-String
Write-Host $dry

# 从 dry-run 文本里抓版本号，例如 151.0.7922.34 与 chromium-1234
$chromeVer = [regex]::Match($dry, "Chrome for Testing\s+(\d+\.\d+\.\d+\.\d+)").Groups[1].Value
$rev = [regex]::Match($dry, "chromium[^\d]*(\d{3,5})").Groups[1].Value
if (-not $chromeVer) { throw "无法从 dry-run 解析 Chrome 版本号" }
if (-not $rev) { $rev = "1234" }

$zipUrl = "https://cdn.npmmirror.com/binaries/chrome-for-testing/$chromeVer/win64/chrome-win64.zip"
$destRoot = Join-Path $env:PLAYWRIGHT_BROWSERS_PATH "chromium-$rev"
$zipPath = Join-Path $env:TEMP "chrome-win64-$chromeVer.zip"

Write-Host "下载: $zipUrl"
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
New-Item -ItemType Directory -Force -Path $destRoot | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $destRoot -Force
Set-Content -Path (Join-Path $destRoot "INSTALLATION_COMPLETE") -Value ""
Write-Host "已安装到 $destRoot"
Write-Host "再执行一次 playwright install chromium 以补齐 ffmpeg/winldd ..."
& $Python -m playwright install chromium
Write-Host "完成。"
