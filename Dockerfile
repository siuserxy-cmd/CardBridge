# 使用官方 Node.js 镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 安装依赖
RUN npm install --production

# 复制所有文件
COPY . .

# 初始化数据库
RUN npm run init-db
RUN npm run migrate-db

# 暴露端口
EXPOSE 3000

# 设置环境变量
ENV NODE_ENV=production

# 启动应用
CMD ["sh", "-c", "npm run init-db && npm run migrate-db && npm start"]
