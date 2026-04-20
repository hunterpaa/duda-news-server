@echo off
cd /d "%~dp0"
taskkill /F /IM node.exe >nul 2>&1
timeout /t 1 /nobreak >nul
start "" http://localhost:3001
start /min "" cmd /c "node manager.js & pause"
