#!/bin/bash

# 发卡网一键启动脚本
echo "================================"
echo "🚀 数字商店 - 一键启动脚本"
echo "================================"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null
then
    echo "❌ 未检测到 Node.js，请先安装 Node.js"
    echo "   下载地址: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js 版本: $(node -v)"
echo ""

# 检查是否已安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 正在安装依赖包..."
    npm install
    echo ""
fi

# 检查数据库是否已初始化
if [ ! -d "database" ]; then
    echo "📊 正在初始化数据库..."
    npm run init-db
    echo ""
fi

# 启动服务器
echo "🎉 准备启动服务器..."
echo ""
echo "================================"
echo "访问地址："
echo "  前台: http://localhost:3000"
echo "  后台: http://localhost:3000/admin"
echo ""
echo "默认管理员账号："
echo "  邮箱: admin@example.com"
echo "  密码: admin123456"
echo "================================"
echo ""
echo "按 Ctrl+C 可停止服务器"
echo ""

# 启动服务器
npm start
