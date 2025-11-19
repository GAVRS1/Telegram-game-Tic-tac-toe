@echo off
cd /d "%~dp0"

if exist .venv\Scripts\activate.bat (
  call .venv\Scripts\activate.bat
)

echo Starting FastAPI server...
python -m pyserver

echo.
echo Python process exited with code %ERRORLEVEL%.
pause
