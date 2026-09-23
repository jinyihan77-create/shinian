@echo off
rem ASCII-only launcher: Chinese output comes from scripts\show-night-watch.mjs
chcp 65001 >nul
cd /d "%~dp0"
node "scripts\show-night-watch.mjs"
pause
