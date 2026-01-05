@echo off
chcp 65001 >nul
color 0A

echo ================================
echo 🚀 数字商店 - 一键启动脚本
echo ================================
echo.

REM 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ 未检测到 Node.js，请先安装 Node.js
    echo    下载地址: https://nodejs.org/
    pause
    exit /b 1
)

node -v
echo.

REM 检查依赖
if not exist "node_modules" (
    echo 📦 正在安装依赖包...
    call npm install
    echo.
)

REM 检查数据库
if not exist "database" (
    echo 📊 正在初始化数据库...
    call npm run init-db
    echo.
)

REM 启动服务器
echo 🎉 准备启动服务器...
echo.
echo ================================
echo 访问地址：
echo   前台: http://localhost:3000
echo   后台: http://localhost:3000/admin
echo.
echo 默认管理员账号：
echo   邮箱: admin@example.com
echo   密码: admin123456
echo ================================
echo.
echo 按 Ctrl+C 可停止服务器
echo.

call npm start
