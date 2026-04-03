#!/bin/bash
# 一键部署到 Vultr 服务器
# 用法: ./deploy.sh

set -e

SERVER="root@43.224.33.197"
DIR="/root/cardbridge"

echo "🚀 开始部署..."

echo "📦 1/4 推送代码到 GitHub..."
git push origin main

echo "📥 2/4 拉取代码到服务器..."
ssh $SERVER "cd $DIR && git pull origin main"

echo "🔨 3/4 重建并启动容器..."
ssh $SERVER "cd $DIR && docker compose down && docker compose up -d --build"

echo "🗄️ 4/4 数据库迁移..."
ssh $SERVER "docker exec digital-shop node server/migrate-database.js"

echo ""
echo "✅ 部署完成！访问 https://payforgpt.com 查看"
