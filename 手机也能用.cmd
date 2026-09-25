@echo off
rem ASCII-only launcher: all Chinese output comes from scripts\mobile-tunnel.mjs.
rem Reason: cmd.exe mis-parses UTF-8 batch files byte-by-byte, so Chinese
rem text inside a .cmd can be turned into bogus command names.
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js first.
  pause
  exit /b 1
)

node "scripts\mobile-tunnel.mjs"

echo.
pause
