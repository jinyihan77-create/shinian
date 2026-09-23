@echo off
rem ASCII-only launcher: all Chinese output comes from scripts\ship.mjs.
rem Reason: cmd.exe mis-parses UTF-8 batch files byte-by-byte, so Chinese
rem text inside a .cmd can be turned into bogus command names.
rem This switches to the UTF-8 code page so Node's Chinese output renders.
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js first.
  pause
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git not found. Please install Git first.
  pause
  exit /b 1
)

call npm run ship
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

echo.
pause
