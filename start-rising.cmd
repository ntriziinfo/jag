@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run RISING.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:8787/jag.html"
node server.js
pause
