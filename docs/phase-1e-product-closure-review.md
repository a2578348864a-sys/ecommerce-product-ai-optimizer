# Phase 1E — 产品闭环复核

> 本轮目标：确认生产状态、第 81 条记录来源、crawl API 产品行为、首页/机会雷达是否符合产品目标。不涉及面试演示。

## 元数据

- **复核时间**：2026-06-21
- **复核人**：Claude（只读复核）
- **origin/main HEAD**：`2c1558e`
- **服务器 HEAD**：`0ba2860`（对齐 origin/main）
- **服务器**：112.124.54.81
- **PM2**：online
- **生产代码**：Phase 1E 最新

## 1. 当前生产状态

| 指标 | 值 |
|------|-----|
| 服务器 git HEAD | `0ba2860`（干净，对齐 origin/main） |
| PM2 | online |
| /api/health | `{"ok":true}` |

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

## 2. 数据库状态

### 记录数演变

| 阶段 | 记录数 | 说明 |
|------|--------|------|
| Phase 1D 初始 | 89 | 含 A 类 7 条 + C 类 2 条脏数据 |
| A 类清理后 | 82 | 删除 3 乱码 + 3 test + 1 空壳 |
| C 类清理后 | 80 | 删除 2 条 viral mock |
| Phase 1E 部署后 | **81** | +1 条 opportunities 真实 AI 分析 |

### 第 81 条记录完整溯源

| 字段 | 值 |
|------|-----|
| 完整 ID | `cmqnf9zw00000g7q8v0qxa7dp` |
| type | `opportunities` |
| title | `机会雷达 · 1 个候选品` |
| source | `ai` |
| score | 70 |
| level | `可以观察` |
| oneLineSummary | `分析 1 个候选品，1 完成，0 失败。最高分：kitchen gadgets / pet accessories（70分）` |
| decisionStatus | `pending` |
| resultJson | `{leaderboard, candidates}` — 标准 AI 分析输出结构 |
| mode=mock | **否** |
| 来自 /api/opportunities/crawl | **否** — crawl API 不写库，无此能力 |
| 来自 /api/opportunities | **是** — 该接口调用 AI pipeline + Prisma create |

### 判断

| 问题 | 结论 |
|------|------|
| 是否 mock | **否** — source=ai，resultJson 为标准 AI 输出 |
| 是否真实 AI | **是** — 来自 `/api/opportunities` AI 分析 pipeline |
| 是否应保留 | **是** — 合法真实分析记录 |
| 是否影响数据干净状态 | **否** — 非 mock/test/乱码/空壳 |

### 当前数据口径

> 生产库 81 条记录：80 条 Phase 1D 历史真实 AI 分析 + 1 条 Phase 1E opportunities 真实 AI 分析。0 mock、0 test、0 乱码、0 NULL、0 空壳。

## 3. crawl API 产品结论

### 代码审查

| 文件 | Prisma | OpenAI/DeepSeek | AI 调用 |
|------|--------|-----------------|---------|
| `app/api/opportunities/crawl/route.ts` | **无** | **无** | **无** |
| `lib/server/radarCrawler.ts` | **无** | **无** | **无** |
| `lib/server/radarNormalize.ts` | **无** | **无** | **无** |
| `lib/server/radarScore.ts` | **无** | **无** | **无** |

### 产品行为确认

| 行为 | 结果 |
|------|------|
| 访问密码保护 | ✅ 无密码 → 401 |
| 写数据库 | **否** ✅ — 无 Prisma import |
| 调用 AI | **否** ✅ — 评分纯规则（radarScore.ts） |
| 支持数据源 | HTML / RSS / sitemap / 公开 URL |
| 不支持数据源 | 登录态、验证码、Cookie、代理池、强反爬平台 |
| SSRF 阻断 | ✅ 127.0.0.1 / localhost / 169.254.169.254 全部阻止 |
| robots.txt | ✅ 自动检查 Disallow |
| 超时 | ✅ 10 秒 |
| 响应大小限制 | ✅ 1MB |
| 单次 URL 上限 | ✅ 5 个 |
| 候选上限 | ✅ 50 条 |

### 线上验证结果

| 测试 | 结果 |
|------|------|
| 无密码 | 401 ✅ |
| HTML (httpbin.org) | ok=true, 1 candidate, 无 500 ✅ |
| RSS (hnrss.org) | ok=true, 0 candidates（正常解析）, 无 500 ✅ |
| Sitemap (w3.org) | ok=true, 8 candidates, 无 500 ✅ |
| SSRF 127.0.0.1 | blocked ✅ |
| SSRF localhost | blocked ✅ |
| SSRF 169.254.169.254 | blocked ✅ |
| 数据库写入 | 0 条（确认不变） ✅ |
| AI 调用 | 0 次 ✅ |

### crawl API vs opportunities AI 分析接口

| 维度 | `/api/opportunities/crawl` | `/api/opportunities` |
|------|--------------------------|---------------------|
| 功能 | 公开源抓取+清洗+评分 | AI 批量候选品分析 |
| 写库 | **否** | **是**（Prisma create） |
| 调 AI | **否**（纯规则） | **是**（AI pipeline） |
| 密码保护 | **是** | **是** |
| Phase | Phase 1E 新增 | Phase 1C 已有 |
| 产品文案需区分 | 是，「抓取公开线索」→ 不调 AI，不写库 | 是，「开始分析」→ 调用 AI，保存任务 |

## 4. 产品体验复核

### 首页

| 检查项 | 结果 |
|--------|------|
| 3 主入口可见 | ✅ 找机会 / 分析产品 / 看演示 |
| 用户能看懂第一步 | ✅ 「从哪里开始？三个入口，按需选择」 |
| 无素材接收重复 | ✅ 素材接收已移至辅助工具 |
| 无面试演示文案 | ✅ 无「求职」「面试」等文案 |
| 标签干净 | ✅ 「Alpha 版」代替旧「省钱模式」 |

### 左侧导航

| 检查项 | 结果 |
|--------|------|
| 机会雷达排第一 | ✅ |
| 导航像流程 | ✅ 核心流程 5 项 → 辅助工具 3 项 |
| 图标语义匹配 | ✅ Target/Package/ShieldCheck/Brain/History |
| 素材接收弱化 | ✅ 已移至辅助工具组最后 |

### 机会雷达 (/opportunities)

| 检查项 | 结果 |
|--------|------|
| 可输入公开 URL/RSS/sitemap | ✅ 「抓取公开线索」输入框 |
| 有「抓取公开线索」按钮 | ✅ |
| 说明不抓登录态 | ✅ 「不调用 AI，不保存任务，仅整理候选机会」 |
| 抓取结果进入候选池 | ✅ 自动填入 textarea |
| 有标题/来源/分数 | ✅ 来源于抓取结果中的 sourceHost + scores |
| 不自动调 AI | ✅ crawl 路径无 AI |
| 不自动写库 | ✅ crawl 路径无 Prisma |

### 批量输入

| 检查项 | 结果 |
|--------|------|
| 只是整理候选机会 | ✅ 多行输入 textarea |
| 不批量调 AI | ✅ 「开始分析」才触发 AI（/api/opportunities） |
| 不批量写库 | ✅ 「开始分析」才写库 |
| 提示需逐个确认 | ✅ 「分数不是采购建议，只是初筛参考」 |

### 一键演示

| 检查项 | 结果 |
|--------|------|
| 「一键看完整演示」按钮 | ✅ 首页第三个入口 |
| 不调 AI | ✅ static stepper |
| 不写库 | ✅ 标注「不保存新记录」 |
| 能解释完整流程 | ✅ 6 步 stepper |

### TTL

| 存储 | TTL | 结果 |
|------|-----|------|
| 首页输入草稿 | 10 分钟 | ✅ `INPUT_DRAFT_TTL_MS` |
| 机会雷达输入草稿 | 10 分钟 | ✅ `ttlMs: 10 * 60 * 1000` |
| accessPassword | 60 分钟（不变） | ✅ 未修改 |
| 任务历史 | 永久（不受影响） | ✅ 数据库记录 |

## 5. 剩余风险

| # | 风险 | 等级 | 说明 |
|---|------|------|------|
| 1 | DNS rebind 防护需加强 | P2 | 当前仅 hostname/IP 字符串规则 |
| 2 | 正则提取准确度有限 | P2 | 不同网站 HTML 结构差异大，需后续升级解析器 |
| 3 | 评分规则粗粒度 | P2 | 关键词匹配无法替代真实市场数据 |
| 4 | 不同网站 robots 和结构差异大 | P2 | 部分网站返回非标准结构，提取率不稳定 |
| 5 | 未接入授权数据源/官方 API | P3 | 后续接 TikTok/Amazon 需官方 API |
| 6 | 真实用户反馈不足 | P1 | 目前 0 真人测试，无法验证产品假设 |
| 7 | 机会池未形成长期数据资产 | P3 | 抓取结果不持久化，无法跨会话复用 |

## 6. 下一步建议

> 本项目当前目标是：**可商用、可持续迭代、逐步走向全自动化的 AI + 电商 Agent 产品**。不把面试演示作为目标。

### A. 最小产品闭环（Phase 1F）

- 稳定机会雷达抓取（当前 HTML/RSS/sitemap 已可用）
- 增加机会池「人工确认」状态标记（保留/淘汰/待研究）
- 增加抓取结果导出/暂存（localStorage 短期保留）
- 保持 crawl 不自动调 AI、不自动写库
- 保持 opportunities AI 分析路径独立

### B. 自动化工作流增强（Phase 2）

- 人工确认机会后 → 触发 sourcing/risk/summary 串行分析
- 加入工作流队列和每次分析成本上限
- 每一步可暂停、可回滚、可查看证据
- 与现有任务中心（/tasks）集成

### C. 商用化前准备（Phase 3+）

- 用户账号/权限体系
- 成本统计与分析次数配额
- 操作日志与审计
- 数据源合规策略（官方 API 优先）
- 真实用户小范围测试（3-5 人）

---

> **Phase 1E 产品闭环复核结论**：生产状态健康，第 81 条记录来源清晰（真实 AI 分析），crawl API 确认不写库/不调 AI，首页信息架构正确，机会雷达可用。**Phase 1E 可以收口，建议进入 Phase 1F 最小产品闭环。**
