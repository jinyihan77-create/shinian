@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
node "scripts\night-watch-auto.mjs" >> "test-results\night-watch\auto-log.txt" 2>&1
exit /b %errorlevel%
