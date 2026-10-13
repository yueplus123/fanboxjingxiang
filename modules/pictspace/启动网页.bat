@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONUTF8=1
set PLAYWRIGHT_BROWSERS_PATH=%LOCALAPPDATA%ms-playwright
echo 正在启动 pictspace 网页版...
echo 浏览器打开 http://127.0.0.1:8765
python web_app.py
pause
