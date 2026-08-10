# Phase 1E — 生产部署协调与线上验证

> ⚠️ **这是历史应急 SCP 部署后的 Git 对齐记录。** 记录的是 Phase 1E 应急 SCP 部署后服务器 Git 状态与 origin/main 的重新对齐过程。**不代表当前标准部署方式**。当前标准部署流程以 [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) 为准。

## 元数据

- **日期**：2026-06-21
- **origin/main HEAD**：`0ba2860`
- **服务器对齐后 HEAD**：`0ba2860`
- **服务器**：112.124.54.81

## 问题

上一轮 Phase 1E 部署时 GitHub 从服务器不可达（TLS connection timeout），使用 SCP 直传 8 个文件部署。导致服务器 git HEAD 停留在 `7b83cdf`，而运行代码为 `0ba2860` 版本，存在下次部署覆盖/混乱风险。

## 处理结果

### GitHub 连接恢复

```
git ls-remote origin main → 0ba2860 ✅
```

GitHub 连接已恢复。

### Git 对齐

```
git fetch origin main → 7b83cdf..0ba2860
git reset --hard origin/main → HEAD is now at 0ba2860
git status -sb → main...origin/main (clean)
```

服务器 git 已完成对齐：
- HEAD：`0ba2860` ✅
- 工作区：干净 ✅
- 与 origin/main 一致 ✅

### Build 验证

```
npm run build → ✓ Compiled successfully → ✓ Generating static pages (34/34)
```

### PM2

```
pm2 restart alibaba-ai-assistant → online ✅
/api/health → {"ok":true} ✅
```

## 线上 crawl API 验证

### 测试环境

- 使用访问密码（未在报告中打印）
- 低风险公开源测试
- 不高频、不绕反爬

### 结果

| 测试项 | 输入 | 结果 |
|--------|------|------|
| 无密码 | `https://example.com` | **401** — `{"ok":false,"error":{"code":"unauthorized"}}` ✅ |
| SSRF 阻断 | `http://169.254.169.254` | **blocked** — `warnings: ["内网地址已阻止：169.254.169.254"]` ✅ |
| 公开 HTML | `https://httpbin.org/html` | **ok=true** — totalCrawled=1, totalOk=1, totalCandidates=1, score=52 ✅ |
| 公开 RSS | `https://hnrss.org/frontpage` | **ok=true** — totalCrawled=1, totalOk=1, totalCandidates=0（RSS 解析正常，无匹配 item）✅ |
| 公开 Sitemap | `https://www.w3.org/sitemap.xml` | **ok=true** — totalCrawled=1, totalOk=1, totalCandidates=8 ✅ |

### 安全确认

| 检查项 | 结果 |
|--------|------|
| 密码保护 | ✅ 无密码 → 401 |
| SSRF 阻断（7/7） | ✅ 已验证 169.254.169.254 |
| 不写数据库 | ✅ crawl API 无 Prisma import |
| 不调用 AI | ✅ 无 OpenAI/DeepSeek import |
| 500 错误 | ✅ 所有测试无 500 |

## 数据库状态

| 指标 | 值 |
|------|-----|
| ViralAnalysisRecord | 81（比清理后 80 多 1 条，为 `/api/opportunities` AI 分析新增的合法记录） |
| ListingCopyHistory | 2（不变） |
| quick_check | ok |
| crawl API 写入 | 0 条（确认不写库） |

## 页面复查

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
| `/api/health` | `{"ok":true}` | `{"ok":true}` |

## 合规确认

| 项目 | 状态 |
|------|------|
| 是否修改业务代码 | **否** ✅ |
| 是否修改数据库 | **否** ✅ |
| 是否调用真实 AI | **否** ✅ |
| 是否部署新功能 | **否** ✅ |
| 是否读取 .env.local | **仅用于 crawl API 测试，未打印/复制** ✅ |
| 是否 git add . | **否** ✅ |

## 下一次部署建议

- GitHub 连接已恢复，下次可直接 `git pull --ff-only`
- 部署流程：`git pull → npm ci → npm run build → pm2 restart`
- 服务器 git 状态已干净，无遗留问题
