# 生产环境运维手册

> **标准部署规范以本文档为准。所有生产操作必须先读本文档。**

---

## 1. 标准部署节奏

> **铁律：不在阶段中间部署生产。只做本地开发 → 本地验证 → 本地 commit；阶段收口后统一 push；验收通过后统一部署。**

### 阶段内日常

| 步骤 | 说明 |
|------|------|
| 本地开发 | 在本地完成一个阶段或一个明确功能包的所有代码修改 |
| 本地验证 | `npm run lint` + `npm test` + `npm run build` + 本地页面 HTTP 检查 |
| 本地 commit | 验证通过后精确 `git add` 具体文件，生成有意义的 commit message |
| 继续开发 | 阶段内继续本地开发 → 验证 → commit，**不 push、不部署** |

### 阶段收口

| 步骤 | 说明 |
|------|------|
| 1. 阶段完成确认 | 本阶段所有功能包均已完成、本地验证全部通过 |
| 2. 统一 push | `git push origin main`，将本阶段所有 commit 推送到 GitHub |
| 3. 确认远端一致 | `git status -sb` 显示 `main...origin/main`，无 ahead/behind |

### 生产部署（只在阶段收口后）

| 步骤 | 命令 | 说明 |
|------|------|------|
| 1. SSH 到服务器 | Workbench 网页终端 | 进入生产环境 |
| 2. 备份当前状态 | `cp -r /www/alibaba-ai-assistant /www/server-backups/before-xxx/` | 备份代码和数据库 |
| 3. 拉取最新代码 | `git pull --ff-only origin main` | **首选部署方式** |
| 4. 安装依赖 | `npm ci` | 锁定版本安装 |
| 5. 构建 | `npm run build` | Next.js 生产构建 |
| 6. 重启服务 | `pm2 restart alibaba-ai-assistant` | 平滑重启 |
| 7. 确认 PM2 状态 | `pm2 status` | 确认 online |
| 8. 健康检查 | `curl -s http://127.0.0.1:3005/api/health` | 确认 200 |
| 9. 页面验收 | 关键页面本机 + 公网 200 | 确认功能可用 |

---

## 2. 生产标准部署命令（完整流程）

在阿里云 Workbench 网页终端中执行：

```bash
cd /www/alibaba-ai-assistant
pwd
git branch --show-current
git status -sb
git log --oneline -3

# 备份
mkdir -p /www/server-backups/before-$(date +%Y%m%d-%H%M%S)
cp -r . /www/server-backups/before-$(date +%Y%m%d-%H%M%S)/

# 拉取
git pull --ff-only origin main
git log --oneline -3
git status -sb

# 构建
npm ci
npm run build

# 重启
pm2 restart alibaba-ai-assistant
pm2 status

# 验收
curl -s http://127.0.0.1:3005/api/health
curl -s http://112.124.54.81/api/health
curl -I http://127.0.0.1:3005/
```

说明：

- 如果 `git status -sb` 显示工作区不干净，先停止部署并排查，不要强行覆盖。
- 如果 `git pull --ff-only` 失败（工作区有 modified/untracked），先排查原因：是否未 push？是否有残留文件？按第 5 节应急规则处理。
- 本项目部署时不要打印 `.env.local` 内容。
- 本次没有 schema/migration 变化时，默认不执行数据库迁移。
- 如果未来确实有 Prisma schema 或 migration 变化，再按当次部署要求执行 `npx prisma generate` 和 `npx prisma migrate deploy`。

---

## 3. 禁止项

### 部署节奏禁止
- ❌ **禁止每做一个小功能就部署生产**：只在阶段收口、稳定验收后统一部署
- ❌ **禁止阶段内 push 或部署**：阶段内只做本地开发、本地验证、本地 commit
- ❌ **禁止未验证 build 就重启生产**：必须先 `npm run build` 通过

### 文件上传禁止
- ❌ **禁止把整个本地项目文件夹直接上传服务器**
- ❌ **禁止上传 `.env`、`.env.local`、`node_modules`、`.next`、本地数据库、临时文件、备份文件**
- ❌ **禁止用本地文件直接覆盖生产文件（绕过 Git）**

### 安全禁止
- ❌ 不要在日志里输出密钥
- ❌ 不要 `cat .env.local`
- ❌ 不要截图暴露密钥、密码、token
- ❌ 不要直接删除生产数据库
- ❌ 测试删除只能删除本轮新建的测试记录
- ❌ 不要调用真实 AI 接口做普通部署验收
- ❌ 不要在未确认工作区状态时执行覆盖性 Git 操作

---

## 4. 应急 SCP 规则

> SCP / 手动上传是应急方案，不是日常部署方式。

### 触发条件（必须同时满足）
1. `git pull --ff-only origin main` 因网络/GitHub/服务器 Git 状态异常而不可用
2. 已经尝试过 `git fetch` + `git reset --hard origin/main` 仍失败
3. 确认不是本地代码未 push 导致的问题

### 执行要求
- ✅ 只允许精确 SCP 具体文件（如 `components/XXX.tsx`、`app/YYY/page.tsx`），**禁止 SCP 整个项目文件夹**
- ✅ 部署前必须先备份服务器当前文件到 `/www/server-backups/`
- ✅ 必须在执行记录中写明：
  - 为什么不用 git pull（具体原因）
  - SCP 上传了哪些文件（精确清单，含 SHA256）
  - 服务器当前 Git HEAD 和 `git status -sb`
  - 后续 Git 对齐方案（什么时候、怎么把服务器 Git 状态对齐到 origin/main）
- ❌ 禁止 SCP `node_modules`、`.next`、`.env`、`.env.local`、数据库文件
- ❌ 禁止 SCP 后不记录、不对齐

---

## 5. 线上验收清单

部署后至少检查：

```bash
# 本机检查
curl -s http://127.0.0.1:3005/api/health
curl -I http://127.0.0.1:3005/
curl -I http://127.0.0.1:3005/tasks
curl -I http://127.0.0.1:3005/workflow
curl -I http://127.0.0.1:3005/opportunities

# 公网检查
curl -s http://112.124.54.81/api/health
curl -I http://112.124.54.81/
```

页面验收（本机 + 公网均需 200）：

- `/`
- `/tasks`
- `/workflow`
- `/workflow/batch`
- `/opportunities`
- `/agent`
- `/api/health`

---

## 6. 服务器信息

- 公网 IP：`112.124.54.81`
- 项目目录：`/www/alibaba-ai-assistant`
- PM2 服务名：`alibaba-ai-assistant`
- 服务端口：`3005`（仅监听 `127.0.0.1`，不对外开放）
- 连接方式：阿里云控制台 → Workbench → root 网页终端

---

## 7. 当前结论

已验证的生产环境状态：

- `/` 返回 `200`
- `/tasks` 返回 `200`
- `/workflow` 返回 `200`
- `/api/health` 返回 `{"ok":true}`
- PM2 `alibaba-ai-assistant` online
- 公网 `3005` 不可达（安全）
- 无密码 API 返回 401

---

## 8. 参考资料

- 项目部署说明：[DEPLOY.md](../DEPLOY.md) — 初始部署、Nginx、PM2 配置说明
- 项目总览：`../00_项目总览.md` — 产品定位、当前阶段、开发与部署节奏
- Codex 任务控制台：`../00_Codex任务控制台.md` — 当前禁止项、部署与发布规则
