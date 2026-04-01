# 数字商店 - 完整发卡系统

> 会话交接入口：优先阅读 [下次开始先读这里-最高优先级.md](./下次开始先读这里-最高优先级.md)

一个现代化的数字商品自动发卡平台，支持支付宝/微信支付，自动发货。

## 功能特性

- ✅ 用户注册/登录系统（JWT 认证）
- ✅ 商品展示和购买
- ✅ 支付宝/微信支付集成
- ✅ 自动发卡系统
- ✅ 订单管理
- ✅ 管理后台
- ✅ 库存管理
- ✅ 响应式设计

## 技术栈

**前端**
- 原生 HTML/CSS/JavaScript
- 响应式设计

**后端**
- Node.js + Express
- SQLite 数据库
- JWT 身份验证

**支付**
- 支付宝开放平台 SDK
- 微信支付 V3 API

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填写配置：

```bash
cp .env.example .env
```

**重要**：编辑 `.env` 文件，至少修改以下配置：
- `JWT_SECRET`：修改为随机字符串
- `ADMIN_EMAIL` 和 `ADMIN_PASSWORD`：管理员账号

### 3. 初始化数据库

```bash
npm run init-db
```

### 4. 启动服务器

```bash
npm start
```

开发模式（自动重启）：
```bash
npm run dev
```

### 5. 访问系统

- 前台商城：http://localhost:3000
- 管理后台：http://localhost:3000/admin

## 支付配置

### 支付宝配置

1. 前往 [支付宝开放平台](https://open.alipay.com/) 注册账号
2. 创建应用，获取 `App ID`
3. 生成应用私钥和公钥
4. 在 `.env` 中填写配置

### 微信支付配置

1. 前往 [微信支付商户平台](https://pay.weixin.qq.com/) 注册
2. 获取商户号和 API 密钥
3. 下载证书
4. 在 `.env` 中填写配置

**注意**：支付功能需要企业资质，个人用户可以先使用测试模式。

## 项目结构

```
发卡网/
├── server/                 # 后端代码
│   ├── index.js           # 服务器入口
│   ├── init-database.js   # 数据库初始化
│   ├── routes/            # API 路由
│   ├── models/            # 数据模型
│   ├── middleware/        # 中间件（认证等）
│   └── utils/             # 工具函数
├── public/                # 前端静态文件
│   ├── index.html         # 首页
│   ├── admin.html         # 管理后台
│   ├── css/               # 样式文件
│   └── js/                # JavaScript 文件
├── database/              # 数据库文件（自动生成）
├── .env                   # 环境变量（不提交到 Git）
├── .env.example           # 环境变量模板
├── package.json           # 项目配置
└── README.md              # 本文档
```

## 使用说明

### 管理员操作

1. 使用配置的管理员账号登录后台
2. 添加商品和卡密
3. 管理订单和库存

### 用户购买流程

1. 浏览商品 → 2. 注册/登录 → 3. 选择支付方式 → 4. 完成支付 → 5. 自动获取卡密

## 部署到生产环境

### 使用 Vercel / Netlify（仅前端）

如果只部署静态页面展示，可以使用免费平台。

### 使用完整后端

推荐使用以下平台：
- **Railway**：https://railway.app（免费额度 + 简单部署）
- **Render**：https://render.com
- **阿里云/腾讯云**：购买服务器自行部署

## 注意事项

⚠️ **安全提醒**
- 生产环境务必修改 `JWT_SECRET`
- 不要将 `.env` 文件提交到代码仓库
- 定期备份数据库文件
- 使用 HTTPS 部署

⚠️ **法律合规**
- 确保售卖的数字商品合法
- 遵守支付平台的服务条款
- 保护用户隐私数据

## 许可证

MIT License

## 技术支持

如有问题，请提交 Issue 或联系开发者。
