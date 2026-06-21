# Phase 1E — 生产部署记录

## 元数据

- **部署时间**：2026-06-21
- **部署人**：Claude
- **部署方式**：SCP（GitHub 从服务器不可达，使用文件直传）
- **部署前 HEAD**：`7b83cdfc07dc14bb2e3f0b363f41bf575507cdc9`
- **部署后 origin/main HEAD**：`7c9336e`（本地已 push）
- **服务器运行代码**：Phase 1E 最新（通过 SCP 覆盖 8 个文件）

## 部署文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/page.tsx` | 覆盖 | 首页 3 主入口 + TTL 10min |
| `components/WorkspaceSidebar.tsx` | 覆盖 | 导航重排序 |
| `components/cross-border/OpportunitiesForm.tsx` | 覆盖 | 爬虫输入 + TTL 10min |
| `hooks/useLocalDraft.ts` | 覆盖 | INPUT_DRAFT_TTL_MS |
| `lib/server/radarCrawler.ts` | **新增** | 公开 URL 抓取 + SSRF |
| `lib/server/radarNormalize.ts` | **新增** | HTML/RSS/sitemap 提取 |
| `lib/server/radarScore.ts` | **新增** | 规则评分 |
| `app/api/opportunities/crawl/route.ts` | **新增** | POST API |

## 部署流程

1. ✅ 本地安全复核：无 AI 调用、无 DB 写入、SSRF 阻断完整
2. ✅ lint：0 warnings
3. ✅ build：34/34 pages
4. ✅ DB 备份：`/www/server-backups/.../2026-06-21-before-phase1e-deploy/prod.db.before-phase1e.bak`
5. ✅ SCP 8 个文件到服务器
6. ✅ `npm run build` — 34/34 pages
7. ✅ `pm2 restart alibaba-ai-assistant` — online
8. ✅ `/api/health` — `{"ok":true}`

## 生产复查

### 页面（全部 200）

| 页面 | 本机 3005 | 公网 |
|------|----------|------|
| `/` | 200 | 200 |
| `/opportunities` | 200 | 200 |
| `/tasks` | 200 | 200 |
| `/sourcing` | 200 | 200 |
| `/risk` | 200 | 200 |
| `/summary` | 200 | 200 |
| `/viral` | 200 | 200 |
| `/products/new` | 200 | 200 |
| `/materials` | 200 | 200 |

### Crawl API

| 检查项 | 结果 |
|--------|------|
| 无密码请求 | **401** ✅ |
| 密码保护 | ✅（页面访问密码，未读取 .env.local） |
| 不写数据库 | ✅（无 Prisma import） |
| 不调用 AI | ✅（无 OpenAI/DeepSeek import） |
| SSRF 防护 | ✅（7 类内网地址阻断） |
| 单次限制 | ✅（最多 5 URL，最多 50 候选） |

### PM2

| 指标 | 值 |
|------|-----|
| 状态 | online |
| uptime | 正常运行 |
| memory | 58.8mb |

## 合规确认

| 项目 | 状态 |
|------|------|
| 是否修改数据库 | **否** ✅ |
| 是否调用真实 AI | **否** ✅ |
| 是否新增 DB 写入 | **否** ✅ |
| 是否新增 AI 调用 | **否** ✅ |
| 是否读取 .env.local | **否** ✅ |
| 是否修改 DB schema | **否** ✅ |
| 是否部署成功 | **是** ✅ |

## 剩余风险

1. **DNS rebind 防护不完整** — 当前仅 hostname/IP 字符串规则，后续可加强
2. **正则提取准确度有限** — 不同网站 HTML 结构差异大
3. **评分规则粗粒度** — 关键词匹配无法替代真实市场数据
4. **不支持强反爬平台** — TikTok/Amazon/1688 等需要官方 API
5. **GitHub 不可达** — 服务器无法 git pull，后续部署需用 SCP 或修复网络
6. **服务器 git 历史落后** — HEAD 仍为 `7b83cdf`，工作区代码为 Phase 1E 最新，下次 git pull 前需先 stash/commit
