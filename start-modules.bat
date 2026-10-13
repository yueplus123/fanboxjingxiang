@echo off
chcp 65001 >nul
rem 同时启动两个嵌入的子项目（各自独立运行，管理后台里用 iframe 打开）
cd /d "%~dp0modules"
start "pictspace :8765" cmd /k "cd /d %~dp0modules\pictspace && set PYTHONUTF8=1 && python web_app.py"
start "author-stats :8766" cmd /k "cd /d %~dp0modules\author-stats && python server.py"
echo 已启动：pictspace http://127.0.0.1:8765   作者投稿统计 http://127.0.0.1:8766
