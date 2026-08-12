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

> **部署方式：本地构建 + artifact 上传**。服务器 RAM（1.6GB）不足以执行 `next build`，一律在本地完成构建，将产物 artifact 上传后解压、重启。

| 步骤 | 命令 | 说明 |
|------|------|------|
| 1. 本地构建 | `npm run build` | Next.js 生产构建（本机，Windows） |
| 2. 本地打包 | `node scripts/package-release.mjs` | 打包 `.next` 为自包含 artifact（自动包含 hashed external modules，见下）并做完整性检查 |
| 3. 上传 | `scp <artifact> root@112.124.54.81:/tmp/` | 上传 artifact 到服务器 |
| 4. 服务器解压 | 解压并替换 `.next`（备份旧版） | 见下方完整命令 |
| 5. 重启服务 | `pm2 restart alibaba-ai-assistant` | 平滑重启 |
| 6. 确认 PM2 状态 | `pm2 status` | 确认 online |
| 7. 健康检查 | `curl -s http://127.0.0.1:3005/api/health` | 确认 200 |
| 8. 页面验收 | 关键页面本机 + 公网 200 | 确认功能可用 |

#### 完整命令（生产部署）

本地（Windows PowerShell / Git Bash）：

```bash
npm run build
node scripts/package-release.mjs
# 输出：release/next-v2.2.16-<short-sha>-linux-x64.tar.gz（自包含，含 hashed external modules）
scp release/next-v2.2.16-<short-sha>-linux-x64.tar.gz root@112.124.54.81:/tmp/
```

服务器：

```bash
cd /www/alibaba-ai-assistant
# 备份当前构建
cp -r .next .next.bak-$(date +%Y%m%d-%H%M%S)
# 解压新构建（tar 包内含顶层 .next/）
rm -rf .next && tar -xzf /tmp/next-v2.2.16-<short-sha>-linux-x64.tar.gz
# 部署完整性检查：hashed external modules 必须存在
test -d node_modules/@prisma/client-$(grep -oE 'client-[a-f0-9]+' .next/server/chunks/*.js 2>/dev/null | head -1 | cut -d- -f2-) \
  && echo "external modules OK" || echo "external modules MISSING — 使用包内 node_modules 补齐"
# 重启与验收
pm2 restart alibaba-ai-assistant
pm2 status
curl -s http://127.0.0.1:3005/api/health
curl -s http://112.124.54.81/api/health
```

> ⚠️ **hashed external modules**：Next.js turbopack 会把 `@prisma/client-*`、`sharp-*` 等外部模块生成到 `.next/node_modules/`（symlink 指向真实 `node_modules`）。普通 tar 打包会丢失这些 symlink。`scripts/package-release.mjs` 会用 `--dereference` 跟随 symlink 打包，使 artifact 自包含；服务器解压后需将包内 `node_modules/` 内容合并到项目 `node_modules/`（或由脚本在服务器端自动校验）。**禁止依赖人工补目录。**

说明：

- 如果 `git status -sb` 显示工作区不干净，先停止部署并排查，不要强行覆盖。
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
1. `node scripts/package-release.mjs` 生成的 artifact 无法上传（网络故障）
2. 已经尝试过重新打包与重试上传仍失败
3. 确认不是本地未 push 导致的问题

### 执行要求
- ✅ 只允许精确 SCP 具体文件（如 `components/XXX.tsx`、`app/YYY/page.tsx`），**禁止 SCP 整个项目文件夹**
- ✅ 部署前必须先备份服务器当前文件到 `/www/server-backups/`
- ✅ 必须在执行记录中写明：
  - 为什么不用 artifact 部署（具体原因）
  - SCP 上传了哪些文件（精确清单，含 SHA256）
  - 服务器当前 Git HEAD 和 `git status -sb`
  - 后续对齐方案（什么时候、怎么把服务器状态对齐到 origin/main）
- ❌ 禁止 SCP `node_modules`、`.env`、`.env.local`、数据库文件
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

- 项目部署说明：[initial-deploy.md](initial-deploy.md) — 初始部署、Nginx、PM2 配置说明
- 项目总览：根目录 [README.md](../../README.md) — 产品定位、当前阶段、冻结基线
