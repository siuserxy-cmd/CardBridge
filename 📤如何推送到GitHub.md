# 📤 如何推送到 GitHub

## ✅ 已完成的步骤

- ✅ Git 仓库已初始化
- ✅ 所有文件已添加
- ✅ 首次提交已创建（30个文件）

---

## 🚀 接下来的操作（3步）

### 第一步：在 GitHub 创建新仓库

1. 访问 https://github.com/new
2. 填写仓库信息：
   - **Repository name（仓库名）**: `digital-shop` 或 `发卡网`
   - **Description（描述）**: 完整的数字商品发卡系统
   - **Public/Private**: 选择 Public（公开）或 Private（私有）
   - ⚠️ **不要勾选** "Add a README file"（我们已经有了）
   - ⚠️ **不要勾选** "Add .gitignore"（我们已经有了）
3. 点击 **Create repository**

### 第二步：复制仓库地址

创建后，GitHub 会显示一个页面，找到类似这样的地址：
```
https://github.com/你的用户名/仓库名.git
```

### 第三步：在终端推送代码

打开终端，运行以下命令（**替换成你的仓库地址**）：

```bash
# 进入项目目录
cd 发卡网

# 添加远程仓库（替换成你的地址）
git remote add origin https://github.com/你的用户名/仓库名.git

# 推送代码到 GitHub
git push -u origin main
```

如果提示输入用户名和密码：
- 用户名：你的 GitHub 用户名
- 密码：使用 **Personal Access Token**（不是账号密码）

---

## 🔑 如果需要 Personal Access Token

1. 访问 https://github.com/settings/tokens
2. 点击 "Generate new token" → "Generate new token (classic)"
3. 勾选 `repo` 权限
4. 点击 "Generate token"
5. 复制生成的 token（只显示一次，请保存好）
6. 在推送时使用这个 token 作为密码

---

## 📋 完整命令（复制粘贴用）

```bash
# 1. 进入项目目录
cd '/Users/siuserxiaowei/Desktop/发卡网'

# 2. 添加远程仓库（⚠️ 替换成你的仓库地址）
git remote add origin https://github.com/你的用户名/你的仓库名.git

# 3. 推送到 GitHub
git push -u origin main

# 4. 查看推送结果
git remote -v
```

---

## ✨ 推送成功后

访问 `https://github.com/你的用户名/仓库名` 就能看到你的项目了！

然后可以：
- 🚀 使用 Railway/Render 一键部署
- 📝 编辑 README.md 添加项目介绍
- 🌟 邀请其他人协作
- 📊 使用 GitHub Actions 自动部署

---

## 🐛 常见问题

### 问题1：提示"failed to push"
```bash
# 先拉取远程代码
git pull origin main --allow-unrelated-histories

# 再次推送
git push -u origin main
```

### 问题2：想要修改提交信息
```bash
# 修改最后一次提交
git commit --amend

# 强制推送（⚠️ 谨慎使用）
git push -f origin main
```

### 问题3：忘记用户名/密码
- 用户名：就是你的 GitHub 用户名
- 密码：使用 Personal Access Token

---

## 🎯 下一步建议

1. **推送到 GitHub** ✅
2. **部署到 Railway**
   - 访问 https://railway.app
   - 连接 GitHub 仓库
   - 自动部署
   - 获得在线网址

3. **添加自定义域名**
   - 在 Railway/Render 设置中绑定域名

---

**准备好了就开始推送吧！**🚀
