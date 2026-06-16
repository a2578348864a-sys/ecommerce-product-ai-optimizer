# 阿里云轻量服务器部署说明

这份文档只说明如何把项目部署到阿里云轻量服务器作为稳定主站，不会替你真实部署，也不会写入任何真实密钥。

## 1. 部署目标

目标架构是：

```text
用户浏览器
-> 域名 / HTTPS
-> Nginx
-> 127.0.0.1:3005
-> Next.js production server
```

推荐把 Next.js 运行在服务器本机的 `3005` 端口，再用 Nginx 对外提供 `80/443` 访问。正式主站不建议把 `3005` 直接开放到公网。

## 2. 推荐架构

- 系统：Ubuntu LTS
- Node.js：20 LTS 或 22 LTS
- 启动方式：`npm run start -- -p 3005`
- 进程守护：PM2
- 反向代理：Nginx 转发到 `127.0.0.1:3005`
- 对外端口：正式主站只开放 `80/443`
- HTTPS：域名解析和 Nginx 跑通后再配置证书
- 备份：首次部署成功后立刻创建阿里云快照

## 3. 服务器准备

在服务器里准备这些工具：

```bash
sudo apt update
sudo apt install -y git nginx
node -v
npm -v
sudo npm install -g pm2
```

如果服务器还没有 Node.js，建议安装 Node.js 20 LTS 或 22 LTS。不要把 `.env.local` 提交到 Git，也不要把真实密钥写进 README、DEPLOY 或前端页面。

## 4. 项目部署流程

推荐项目目录：

```text
/www/alibaba-ai-assistant
```

进入服务器后执行：

```bash
cd /www
git clone 你的仓库地址 alibaba-ai-assistant
cd /www/alibaba-ai-assistant
npm install
cp deploy/env.production.example .env.local  # 部署配置文件位于项目 09_交付与归档/deploy/
```

然后手动打开 `.env.local`，填写真实环境变量。不要把 `.env.local` 上传到 Git。

构建：

```bash
npm run build
```

临时启动测试：

```bash
npm run start -- -p 3005
```

浏览器访问：

```text
http://服务器公网IP:3005
```

临时测试确认可用后，再改用 PM2 长期运行。

## 5. PM2 使用

项目已经提供 PM2 示例：

```text
deploy/ecosystem.config.cjs  # (实际位于项目 09_交付与归档/deploy/，部署时需复制到代码目录)
```

如果项目目录不是 `/www/alibaba-ai-assistant`，先把示例里的 `cwd` 和 `env_file` 改成你的真实路径。

启动：

```bash
pm2 start deploy/ecosystem.config.cjs  # (实际位于项目 09_交付与归档/deploy/，部署时需复制到代码目录)
```

查看状态：

```bash
pm2 status
```

查看日志：

```bash
pm2 logs alibaba-ai-assistant
```

重启：

```bash
pm2 restart alibaba-ai-assistant
```

停止：

```bash
pm2 stop alibaba-ai-assistant
```

设置开机自启：

```bash
pm2 save
pm2 startup
```

`pm2 startup` 会输出一条需要复制执行的命令，按终端提示执行即可。

## 6. Nginx 使用

项目已经提供 Nginx 示例：

```text
deploy/nginx.conf.example  # (实际位于项目 09_交付与归档/deploy/，部署时需复制到代码目录)
```

核心逻辑是把公网请求转发到：

```text
http://127.0.0.1:3005
```

正式主站建议只开放：

```text
80
443
```

不建议公网开放：

```text
3005
```

配置 Nginx 后，常用检查命令：

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl status nginx
```

## 7. HTTPS、域名和备案

- 中国内地服务器绑定域名正式访问，通常需要 ICP 备案。
- 香港节点通常上线更快，但国内访问速度和稳定性可能不同。
- HTTPS 证书建议等域名解析和 Nginx 反代都跑通后再配置。
- 没有域名时，先不要配置 HTTPS。

## 8. 数据持久化与备份

必须备份但不能提交：

```text
.env.local
```

如果启用数据库历史记录，必须备份 `DATABASE_URL` 指向的 SQLite 数据库文件，例如：

```text
prod.db
```

如果未来生产环境启用选品档案保存，也必须备份：

```text
.local/radar-research/
```

PM2 和 Nginx 日志主要用于排查问题，也建议保留一段时间。

首次部署成功后，建议立刻在阿里云控制台创建服务器快照。以后每次大版本升级前，也建议先创建快照。

## 9. 回滚方案

如果新版本上线后出问题，先按这个顺序回滚：

```bash
cd /www/alibaba-ai-assistant
git log --oneline -5
git checkout 上一个可用commit
npm install
npm run build
pm2 restart alibaba-ai-assistant
```

如果代码回滚也解决不了，或者服务器环境被改乱了，再考虑用阿里云快照恢复。

## 10. 生产安全提醒

- 生产环境不要开启诊断接口。
- `ENABLE_AI_DIAGNOSTICS` 生产环境默认填 `false`。
- 不要在日志、文档、前端页面里打印密钥。
- 不要公网开放 `3005`。
- `ACCESS_PASSWORD` 必须设置强密码。
- `.env.local` 只能放在服务器，不要提交 Git。
- `/api/radar/*` 当前生产环境默认关闭；如果以后要启用，必须先设计持久化目录和备份方案。

## 11. 常见问题排查

### 端口占用

```bash
sudo lsof -i :3005
pm2 status
```

如果已有旧进程占用，先确认是不是本项目，再决定是否停止。

### build 失败

```bash
npm run build
```

先看第一条报错。常见原因是 Node.js 版本太旧、依赖没安装完整、环境变量缺失。

### 环境变量缺失

检查 `.env.local` 是否存在，并确认必填变量已经填写。不要把真实值发到聊天窗口或提交到 Git。

### PM2 进程异常

```bash
pm2 status
pm2 logs alibaba-ai-assistant
pm2 restart alibaba-ai-assistant
```

### Nginx 502

502 通常表示 Nginx 找不到后面的 Node 服务。先检查：

```bash
pm2 status
curl http://127.0.0.1:3005
sudo nginx -t
sudo systemctl reload nginx
```

### 数据库路径错误

如果历史记录保存失败，检查 `DATABASE_URL` 指向的 SQLite 文件路径是否存在、服务进程是否有读写权限、文件是否被备份。
