@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ==========================================================
echo   安全发布：先把改动检查一遍，全部通过才会上线
echo   任何一步失败都不会影响线上正在运行的网站
echo ==========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js。请先安装 Node.js 再运行本文件。
  pause
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo 找不到 Git。请先安装 Git 再运行本文件。
  pause
  exit /b 1
)

echo 即将开始检查并发布。整个过程通常需要 3 到 8 分钟。
echo 请耐心等待，不要关闭这个窗口。
echo.
pause

call npm run ship
if errorlevel 1 (
  echo.
  echo ==========================================================
  echo   检查没有通过，已经自动阻止发布。
  echo   线上网站没有被改动，仍然可以正常访问。
  echo.
  echo   请把上面带 ✗ 的报错内容复制给 AI，让它修复后重试。
  echo ==========================================================
  echo.
  pause
  exit /b 1
)

echo.
echo ==========================================================
echo   发布完成。建议打开网站自己看一眼确认没问题。
echo   https://inspiration-echo-318255-10-1492602203.sh.run.tcloudbase.com
echo ==========================================================
echo.
pause
