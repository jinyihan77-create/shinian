@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js，然后重新打开此文件。
  pause
  exit /b 1
)
if not exist "node_modules\next" (
  echo 正在安装网站需要的依赖，首次启动可能需要几分钟……
  call npm ci
  if errorlevel 1 (
    echo 安装没有完成，请检查网络后重试。
    pause
    exit /b 1
  )
)
echo 灵感回声即将启动。请保留这个窗口，并在浏览器打开下方显示的地址。
echo 通常地址为 http://localhost:3000 。日常使用请保持同一个地址。
call npm run dev
pause
