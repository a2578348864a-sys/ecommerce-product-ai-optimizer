# Phase 1E — 机会雷达真实爬虫 MVP + 首页信息架构重构

## 元数据

- **日期**：2026-06-21
- **执行人**：Claude
- **代码 HEAD**：待 commit
- **前序 Phase**：Phase 1D 已收口 (`bf2462a`)

## 用户反馈摘要

来自用户亲自体验后的反馈：

1. 首页看不懂 — "素材接收"和主页重复、入口过多
2. 需要批量输入能力
3. 导航图标不准、顺序不对
4. 机会雷达应该作为第一步
5. 雷达效果太基础 — 只是占位
6. 标准流程不够自动化
7. 演示案例看不懂
8. 上下文保留太久（隔一天还保留旧输入）

## 核心判断

不是单纯 UI 修复，而是两个根本问题：

1. **首页信息架构混乱**：多个入口概念并列（素材接收/演示案例/标准流程），用户不知道该点哪个
2. **机会雷达能力不足**：当前只是批量输入+AI 分析，没有真正的"发现机会"能力

## 本次实现

### 1. 首页信息架构重构

**之前**：v1.1 小白入口 + 我是新手/加载演示 + 复杂的三步分析流程 + 混乱的按钮群

**之后**：3 个清晰主入口卡片：

| 入口 | 链接 | 文案 |
|------|------|------|
| 找机会 | /opportunities | 还没有明确产品？从公开线索中发现候选机会 |
| 分析产品 | 当前页下方素材输入区 | 已经有商品名/链接/截图/想法？逐步判断能不能做 |
| 看演示 | 展开式 stepper | 第一次使用？一键看完整流程。不调用 AI，不保存记录 |

- 删除「本地部署」「省钱模式：已开启」两个模糊标签 → 替换为「Alpha 版」
- 「演示样例」重新定位为「一键看完整演示」→ 明确标注不调 AI、不写库
- stepper 保留原 6 步结构，但加上明确免责声明

### 2. 左侧导航调整

**之前顺序**：机会雷达 → 货源判断 → 风险排查 → 选品体检 → 爆款拆解 → 任务记录 → 素材接收 → 小白结论

**之后顺序**：机会雷达 → 产品分析 → 风险排查 → 小白结论 → 任务中心 → 爆款拆解 → 货源判断 → 素材接收

**分组调整**：
- "核心流程"（前 5 个）：机会雷达 → 产品分析 → 风险排查 → 小白结论 → 任务中心
- "辅助工具"（后 3 个）：爆款拆解 → 货源判断 → 素材接收

**图标调整**：移除数字步骤，全部使用语义图标（Target/Package/ShieldCheck/Brain/History/Sparkles/ClipboardCheck/UploadCloud）

### 3. 真实公开源爬虫 MVP

#### 新增文件

| 文件 | 功能 |
|------|------|
| `lib/server/radarCrawler.ts` | 公开 URL 抓取 + SSRF 防护 + robots.txt 检查 |
| `lib/server/radarNormalize.ts` | HTML/RSS/sitemap/JSON 内容提取 → 候选机会 |
| `lib/server/radarScore.ts` | 规则评分（demand/supply/risk/beginnerFit/final） |
| `app/api/opportunities/crawl/route.ts` | POST API，接入访问密码校验 |

#### 支持的数据源

- 公开 HTML 页面（提取 title/meta/h1/h2/text）
- RSS 2.0 / Atom feeds（提取 item title/link/description）
- XML sitemaps（提取 loc）
- 用户粘贴的公开 URL（多行，每行一个）

#### 不支持（明确排除）

- 登录态页面、需要验证码的页面
- Cookie/Session/Token 认证
- 代理池、高频抓取
- file://、ftp:// 协议
- TikTok/Amazon/1688 等反爬平台硬爬
- 自动化浏览器模拟真人操作

### 4. 安全策略

| 策略 | 实现 |
|------|------|
| SSRF 防护 | 阻止 localhost/127.0.0.1/0.0.0.0/::1/10.x/172.16-31.x/192.168.x/169.254.x |
| robots.txt | 自动检查并遵守 Disallow 规则 |
| User-Agent | `QingxuanAgent-Radar-MVP/0.1` |
| 超时 | 10 秒 |
| 响应大小 | 最大 1MB |
| 重定向 | 最多 3 次 |
| 请求频率 | 顺序请求，每个间隔 500ms |
| 单次限制 | 最多 5 个 URL |

### 5. 成本策略

- **不调用真实 AI** — 评分使用纯规则（radarScore.ts）
- **不写数据库** — crawl API 不创建任何记录
- **不保存任务** — 抓取结果仅在当前会话使用

### 6. /opportunities 页面升级

新增区块：
- **抓取公开线索输入**：URL 输入框 + 「抓取公开线索」按钮
- **安全提示**：不调用 AI，不保存任务，仅整理候选机会
- **抓取结果**：自动填入候选商品列表，可手动编辑后点「开始分析」
- **批量输入**：原有 textarea 保留，支持多行商品名/URL/想法

### 7. TTL 修复

| 存储 | 旧 TTL | 新 TTL |
|------|--------|--------|
| 首页输入草稿 | 7 天 | **10 分钟** |
| 机会雷达输入草稿 | 7 天 | **10 分钟** |
| accessPassword | 60 分钟 | **不变** |

实现方式：`useLocalDraft` 新增 `INPUT_DRAFT_TTL_MS = 10 * 60 * 1000` 导出，首页和机会雷达显式传入。

### 8. 一键演示

- 按钮文案：「一键看完整演示」
- 展开后显示 6 步流程 stepper
- 不调用 AI、不写数据库
- 明确标注：「演示流程，不调用 AI，不保存新记录」

## 验证结果

| 检查项 | 结果 |
|--------|------|
| npm run lint | ✅ No warnings or errors |
| npm run build | ✅ 34/34 pages generated |
| SSRF 防护 | ✅ localhost/127.0.0.1/169.254.169.254/192.168.x/10.x/172.16.x 全部阻止 |
| TypeScript 编译 | ✅ 通过 |

## 修改文件列表

| 文件 | 操作 | 说明 |
|------|------|------|
| `hooks/useLocalDraft.ts` | 修改 | 新增 `INPUT_DRAFT_TTL_MS` 导出 |
| `app/page.tsx` | 修改 | 首页 3 主入口 + TTL 10 分钟 + 标签更新 |
| `components/WorkspaceSidebar.tsx` | 修改 | 导航重排序 + 分组重命名 + 图标修复 |
| `components/cross-border/OpportunitiesForm.tsx` | 修改 | 新增爬虫输入 + TTL 10 分钟 + handleCrawl |
| `lib/server/radarCrawler.ts` | **新增** | 公开 URL 抓取 + SSRF + robots |
| `lib/server/radarNormalize.ts` | **新增** | HTML/RSS/sitemap 提取 |
| `lib/server/radarScore.ts` | **新增** | 规则评分 |
| `app/api/opportunities/crawl/route.ts` | **新增** | POST API |

## 剩余风险

1. **不同网站结构差异大** — 正则提取准确度有限，未来可考虑 cheerio 或更专业的解析器
2. **robots.txt 规则差异** — 各站 robots.txt 格式不完全一致，仅支持基础 Disallow 规则
3. **部分网站阻止抓取** — 返回 403/Cloudflare 等，属正常现象
4. **DNS rebind 防护不完整** — 当前仅 hostname/IP 字符串规则，后续可加强
5. **后续接 TikTok/Amazon/1688** — 需优先考虑官方 API、授权数据或合规数据源
6. **评分规则粗粒度** — 关键词匹配无法替代真实市场数据，仅作初筛参考
