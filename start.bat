@echo off
REM Переходим в папку, где лежит .bat (и проект)
cd /d "%~dp0"

echo Starting Sync...
REM Запуск скрипта
node server\index.js

echo.
echo Node process exited with code %ERRORLEVEL%.
pause
