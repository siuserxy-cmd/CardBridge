#!/bin/bash
# 一键部署到 Vultr 服务器
# 用法: ./deploy.sh

set -e

SERVER="root@43.224.33.197"
DIR="/root/cardbridge"

echo "🚀 开始部署..."

echo "📦 1/3 推送代码到 GitHub..."
git push origin main

echo "📥 2/3 拉取代码到服务器..."
ssh $SERVER "cd $DIR && git pull origin main"

echo "🔨 3/3 重建并启动容器..."
ssh $SERVER "cd $DIR && docker compose up -d --build"

echo ""
echo "✅ 部署完成！访问 https://payforgpt.com 查看"
echo "💡 数据库在 volume 中持久化，部署不会丢失数据"
