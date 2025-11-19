@echo off
cd /d "%~dp0"

echo Starting Cloudflare tunnel...
cloudflared tunnel --edge-ip-version 4 --loglevel debug --url http://127.0.0.1:8080

echo.
echo Tunnel process exited with code %ERRORLEVEL%.
pause
