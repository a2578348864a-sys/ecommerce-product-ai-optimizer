# 初始部署指南

> 这是一份泛化的服务器初始化示例。真实 IP、域名、账号、项目路径、端口和密钥只应存在于部署环境的私有资料中。

## 1. 目标架构

```text
用户浏览器
  → your-domain.example.com / HTTPS
  → Nginx 或同类反向代理
  → 127.0.0.1:<PORT>
  → Next.js production server
```

应用端口只监听本机，公网只开放反向代理所需端口。

## 2. 服务器准备

以受限部署账号执行系统准备，不要在公开文档中使用真实 root 登录信息：

```bash
sudo apt update
sudo apt install -y git nginx
node -v
npm -v
sudo npm install -g pm2
```

Node.js 使用项目要求的 LTS 版本。真实环境变量通过私有配置注入。

## 3. 获取代码与安装

```bash
cd /path/to
 git clone <repository-url> project
cd /path/to/project
npm ci
cp .env.example .env.local
```

编辑 `.env.local` 时只填写部署环境私有值。不要把它提交到 Git，也不要在日志或截图中显示。

## 4. 构建与启动

```bash
npm run lint
npm test
npm run build
npm run start -- -p <PORT>
```

确认本机健康检查：

```bash
curl -fsS http://127.0.0.1:<PORT>/api/health
```

长期运行可以使用 PM2 或部署平台提供的进程管理器。进程名、工作目录和日志目录都应由部署环境配置。

## 5. Nginx / HTTPS

反向代理上游使用：

```text
http://127.0.0.1:<PORT>
```

对外只配置 `80`、`443` 和泛化域名 `your-domain.example.com`。证书、域名解析和日志路径不写入仓库。

## 6. 数据备份与回滚

部署前备份：

- 当前 `.next` 构建；
- 部署环境的 SQLite 数据库；
- 当前 `.env.local` 的私有备份；
- 反向代理与进程管理配置。

回滚时恢复上一份已经验证的构建包，并重新执行健康检查。不要把本地开发目录整体上传到服务器。

## 7. 安全边界

- 不上传 `.env`、`.env.local`、数据库、`node_modules`、浏览器状态和临时输出；
- 不在公开 Issue、日志或截图中暴露服务器地址、账号、token 或 key；
- 外部 Provider 和采集器遵守各自授权与费用边界；
- 没有数据库 schema 变化时，不执行迁移命令。

日常部署流程见 [production-runbook.md](production-runbook.md)。
