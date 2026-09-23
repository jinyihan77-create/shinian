@echo off
rem ASCII-only launcher. All Chinese output comes from the Node script,
rem because cmd.exe mis-parses UTF-8 batch files and would garble it.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js first.
  echo Node.js not found - cannot continue.
  pause
  exit /b 1
)

node "scripts\health-check.mjs"

echo.
pause
