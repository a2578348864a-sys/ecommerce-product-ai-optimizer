# 部署运行手册

> 本文只提供可泛化的部署流程。真实服务器地址、账号、项目路径、端口、域名和密钥必须通过私有运维资料管理，不要写入仓库。

## 1. 推荐节奏

```text
本地开发 → 本地检查 → 生成发布包 → 受控上传 → 服务器备份 → 解压与重启 → 健康检查
```

在阶段收口前不要部署。部署前确认工作区干净、构建成功，并准备可回滚的服务器备份。

## 2. 本地构建与打包

```bash
npm ci
npm run lint
npm test
npm run build
node scripts/release/package-release.mjs
```

`package-release.mjs` 生成的发布包只应包含构建产物和运行所需依赖。禁止把 `.env`、`.env.local`、数据库、浏览器状态、日志、备份或整个开发目录放入发布包。

## 3. 上传与服务器目录

下面的命令使用占位符，执行前替换为部署环境的私有值：

```bash
scp release/<artifact>.tar.gz deploy@your-server-ip:/tmp/
```

服务器上的项目目录使用泛化路径：

```bash
cd /path/to/project
cp -r .next .next.backup-<timestamp>
rm -rf .next
tar -xzf /tmp/<artifact>.tar.gz
```

不要使用 root 账号作为公开文档中的默认操作示例。服务器账号、备份目录和域名由部署环境单独配置。

## 4. 运行服务

Next.js 只监听服务器本机端口，再由反向代理对外提供 HTTPS：

```text
浏览器 → HTTPS 域名 → Nginx / 反向代理 → 127.0.0.1:<PORT> → Next.js
```

示例：

```bash
npm run start -- -p <PORT>
# 或使用部署环境的进程管理器启动
```

健康检查使用部署环境的私有地址和端口：

```bash
curl -fsS http://127.0.0.1:<PORT>/api/health
```

## 5. 反向代理与 HTTPS

生产环境应由 Nginx、Caddy 或同类反向代理终止 HTTPS，并只公开 80/443。应用端口不应直接开放到公网。

反向代理配置中使用：

- `your-domain.example.com` 作为示例域名；
- `127.0.0.1:<PORT>` 作为上游；
- 私有证书路径和日志路径，不写入 Git。

## 6. 数据与密钥

- `.env.local` 只保存在部署环境，不上传到仓库。
- SQLite 数据库和备份只由部署环境管理，不放入发布包。
- 真实 Provider key 通过环境变量或密钥管理服务注入。
- 部署日志、浏览器状态和诊断输出不得包含密码、token 或 key。
- 没有 schema/migration 变化时不要执行数据库迁移；有变化时按该版本的迁移说明执行。

## 7. 回滚

回滚前先停止流量或服务，保存当前状态，再恢复上一份已验证的构建包：

```bash
cd /path/to/project
cp -r .next .next.before-rollback-<timestamp>
rm -rf .next
tar -xzf /path/to/previous-artifact.tar.gz
# 按部署环境重启服务并重新执行健康检查
```

如果应用数据结构发生变化，必须先确认回滚版本与数据库兼容。禁止用未验证的开发目录覆盖服务器。

## 8. 部署后检查

至少检查：

- 首页、任务页、研究页和 Listing Studio 能打开；
- `/api/health` 返回成功；
- 反向代理 HTTPS 正常；
- 关键页面无 Console 错误；
- `git status`、构建版本和部署记录与预期一致。

本仓库不保存任何真实生产地址、账号、服务器路径或运行指纹。
