@echo off
REM Переходим в папку, где лежит .bat (и проект)
cd /d "%~dp0"

echo Starting Sync...
REM Запуск скрипта
cloudflared tunnel --edge-ip-version 4 --loglevel debug --url http://127.0.0.1:8080

echo.
echo Node process exited with code %ERRORLEVEL%.
pause
