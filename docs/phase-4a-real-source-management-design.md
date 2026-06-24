# Phase 4-A：真实数据源与爬虫来源管理只读评估

> 状态：只读方案评估 · 未实现 · 2026-06-24
> 依赖：Phase 3-C 候选池闭环已完成 · Phase 3-C.3 安全收口

---

## 1. 现有能力审计

### 1.1 已有爬虫基础设施（Phase 1E）

| 模块 | 文件 | 能力 |
|------|------|------|
| SSRF 防护 | `lib/server/ssrfGuard.ts` | 协议限制、hostname 黑名单、DNS 解析内网 IP 检测 |
| 爬虫核心 | `lib/server/radarCrawler.ts` | 单 URL 抓取、robots.txt 遵守、手动 redirect 重校验、10s 超时、1MB 限制、500ms 礼貌延迟 |
| 数据清洗 | `lib/server/radarNormalize.ts` | HTML/RSS/Sitemap 自动识别、正则提取标题/描述/关键词、品类推断、风险词检测 |
| 规则评分 | `lib/server/radarScore.ts` | 需求信号/货源易得/风险/新手适配 4 维评分、加权最终得分、品牌词库/风险词库 |
| 爬虫 API | `app/api/opportunities/crawl/route.ts` | POST 接入、访问密码保护、最多 5 URL、返回 scored candidates |

### 1.2 已有候选池承接能力（Phase 3）

| 模块 | 文件 | 能力 |
|------|------|------|
| 服务端候选池 | `lib/server/opportunityCandidateService.ts` | CRUD + 去重 upsert + 导入 |
| 候选池 API | `app/api/opportunity-candidates/` | GET/POST/PATCH/DELETE/import-local |
| 前端接入 | `OpportunitiesForm.tsx` | 服务端优先 + localStorage 降级 |

### 1.3 当前数据流

```
用户输入商品名 → POST /api/opportunities (AI分析) → 结果 → candidateToPoolInput() → localStorage/serve
用户输入 URL   → POST /api/opportunities/crawl     → 结果 → 页面展示 → 手动入池
```

### 1.4 当前缺口

1. **爬虫结果未自动入池**：`POST /api/opportunities/crawl` 返回 items 仅在页面展示，需要用户手动判断后通过"开始分析"按钮间接入池
2. **无来源管理**：候选品的 `source` 字段统一为"机会雷达"，不区分手动输入/爬虫/RSS
3. **sourceMetaJson 未充分利用**：现有 JSON 字段承载能力足够，但爬虫来源未写入结构化元数据
4. **候选品与爬虫结果之间无流水线**：爬虫 → 清洗 → 评分 → 候选品 的管道没有自动衔接

---

## 2. 数据源候选评估

### A. 官方 API / RSS / Sitemap

| 维度 | 评估 |
|------|------|
| **推荐度** | ✅ 强烈推荐（第一优先级） |
| **接入难度** | 🟢 低 — 已有 `radarCrawler` 支持 RSS/sitemap 解析 |
| **合规风险** | 🟢 极低 — 公开标准协议，robots.txt 易于遵守 |
| **数据质量** | 🟡 中 — 标题和链接丰富，但缺少价格/销量/评论 |
| **适合入池字段** | title→name, sourceUrl→link, sourceHost→source, categoryHint→keyword, riskHint→riskLabel, finalScore→score |
| **典型来源** | 公开博客 RSS、电商站点 sitemap、Google Merchant Center feed、AliExpress 公开 RSS |

**判断**：最适合 Alpha MVP。现有基础设施已覆盖。

### B. 电商平台公开页面

| 维度 | 评估 |
|------|------|
| **推荐度** | 🟡 谨慎推荐（仅公开不登录页面） |
| **接入难度** | 🟡 中 — 页面结构多变，无 API 协议 |
| **合规风险** | 🔴 高 — 需严格限制频率、遵守 robots.txt、不做登录态 |
| **数据质量** | 🟢 较高 — 商品页通常有标题/价格/描述/评论数 |
| **适合入池字段** | title→name, URL→link, 描述→summaryLabel, 价格信号→可辅助 score |
| **限制** | 不做反爬、不做登录态、不做代理池、不做验证码绕过 |

**判断**：Alpha MVP 暂不宜主动做，允许用户粘贴链接后手动清洗。Phase 4-B 可评估"用户提供链接 + 系统读公开页面 title/meta"的最小实现。

### C. 社媒/内容平台公开趋势

| 维度 | 评估 |
|------|------|
| **推荐度** | 🔴 暂不推荐 |
| **接入难度** | 🔴 高 — 平台反爬严重、API 受限 |
| **合规风险** | 🔴 极高 — TikTok/Instagram/小红书均需登录或 API Key，平台 ToS 严格 |
| **数据质量** | 🟡 高但不可靠 — 趋势变化快，数据可能已下架 |
| **替代方案** | 用户手动复制链接或截图导入；第三方合规趋势工具（如 Google Trends） |

**判断**：Phase 4 系列均不做社媒平台硬爬。建议用户通过消息/社群获取线索后手动粘贴。后续商业化阶段可评估官方 API（如 TikTok Shop API、Instagram Graph API）。

### D. 用户手动输入 / 批量粘贴

| 维度 | 评估 |
|------|------|
| **推荐度** | ✅ 强烈推荐（稳定入口） |
| **接入难度** | 🟢 极低 — 已有的核心功能 |
| **合规风险** | 🟢 零 — 用户自己提供的数据 |
| **数据质量** | 🟡 取决于用户 — 可辅助清洗 |
| **适合入池字段** | 用户输入 → 清洗 → normalizeCandidate → 服务端候选池 |

**判断**：作为永恒的低风险入口，持续维护。Phase 4-B 可增强批量粘贴的智能解析（自动识别商品名/链接/关键词并分行）。

---

## 3. 推荐第一版数据源策略

### 优先级排序

| 优先级 | 来源 | 理由 |
|--------|------|------|
| **P1（第一优先）** | 用户手动输入/批量粘贴 | 最稳定、零风险、已有完整能力、小白可直接用 |
| **P2（第二优先）** | 公开 RSS / Sitemap | 合规性最好、已有解析器、5 URL 限制已内置、适合有经验的用户 |
| **P3（第三优先）** | 用户提供链接 + 系统读公开 meta | 比 P2 更广（不限于 RSS/sitemap），但需加强 HTML title 提取 |
| **暂不做** | 平台硬爬、登录态抓取、代理池、验证码绕过 | 合规红线；任何情况下都不做 |
| **未来评估** | 官方 API（Google Merchant、AliExpress Dropshipping API 等） | 需商业化阶段、API Key 管理、配额控制 |

### 为什么这样排序

1. **用户手动输入**已经是最成熟的能力，无需新开发
2. **RSS/Sitemap** 已有完整基础设施（radarCrawler → normalize → score → crawl API），只需补一条"爬虫结果→候选池"的轻桥接
3. **读公开 meta** 是对 RSS/Sitemap 的自然扩展，只需放宽 HTML 提取的触发条件
4. **平台硬爬** 有合规、法律和技术三重风险，Alpha 阶段绝不触碰

---

## 4. 来源导入器 MVP 设计草案（Phase 4-B）

### 4.1 MVP 名称

"来源导入器 / Source Importer MVP"

### 4.2 功能边界

1. 用户输入 1-5 个公开 URL（RSS、sitemap、普通网页）
2. 系统调用已有 `POST /api/opportunities/crawl` 抓取
3. 抓取结果展示为候选品列表
4. 用户可逐条勾选/取消、编辑标题、调整分数
5. 用户确认后**一键入池**（调用 `POST /api/opportunity-candidates`）
6. 每批入池记录可写入 `analysisJson`（含原始 URL、抓取时间、来源类型）
7. `sourceMetaJson` 写入结构化来源元数据

### 4.3 不做事项

- ❌ 不自动 AI 分析
- ❌ 不自动入池（必须人工确认）
- ❌ 不后台定时抓取
- ❌ 不做代理池
- ❌ 不绕 robots.txt
- ❌ 不抓登录态内容
- ❌ 不保存 Cookie

### 4.4 sourceMetaJson 结构草案

```json
{
  "sourceType": "crawl",
  "crawlMethod": "rss|sitemap|html|manual",
  "sourceUrls": ["https://..."],
  "sourceHosts": ["example.com"],
  "crawledAt": "2026-06-24T12:00:00Z",
  "originalScore": 85,
  "humanConfirmed": true,
  "confirmerNote": ""
}
```

---

## 5. 候选品清洗规则草案

### 5.1 标题 normalize

- 去首尾空格、HTML 实体解码
- 截断至 120 字符
- 去除纯数字/纯符号标题
- 最小长度 2 字符

### 5.2 去重规则

| 维度 | 策略 |
|------|------|
| name 相同 | 按 `normalizeKey(name)` 去重（已有） |
| link 相同 | 复用 `getCandidateDedupeKey()` 的 link fallback |
| source + name | 同源同名的视为重复（更新而非新增） |

### 5.3 score 初始规则

基于 `radarScore.ts` 的 4 维评分：
- demandSignalScore × 0.30
- supplyEaseScore × 0.20
- (100 - riskScore) × 0.30
- beginnerFitScore × 0.20

手动输入的候选品 score 默认为 0（待判断）。

### 5.4 riskLevel 初始规则

基于 `radarScore.ts` 的 `riskScore`：
- riskScore ≥ 70 → "red"
- riskScore ≥ 40 → "yellow"
- riskScore < 40 → "green"

高风险词命中（儿童/医疗/品牌/带电/食品接触）自动升一级。

### 5.5 人工确认字段

| 字段 | 用途 |
|------|------|
| `humanConfirmed` (in sourceMetaJson) | 标记用户已确认 |
| `status` | pending → worth_analyzing（确认后） |
| `keyword` | 用户可编辑 |
| `name` | 用户可编辑 |

---

## 6. 安全与合规红线

| # | 红线 | 说明 |
|---|------|------|
| 1 | 不绕过 robots.txt | 已有 `parseRobotsTxt()` 实现 |
| 2 | 不抓登录态内容 | 不发送 Cookie / Authorization |
| 3 | 不保存 Cookie | 每次请求独立 |
| 4 | 不用代理池 | 固定 IP，直连 |
| 5 | 不绕验证码 | 遇到 403/5xx 即停止 |
| 6 | 不高频抓取 | 已有 500ms 礼貌延迟 + 5 URL 上限 |
| 7 | 不抓个人隐私数据 | 仅提取页面 meta/text（标题、描述、关键词） |
| 8 | 不抓付费墙内容 | 不处理 402 Payment Required |
| 9 | 不自动执行商业动作 | 所有操作需人工确认 |
| 10 | SSRF 防护 | 已有完整多层校验 |

---

## 7. 技术方案草案

### 7.1 推荐模块（仅设计，不实现）

| 模块 | 路径 | 职责 |
|------|------|------|
| URL 安全校验 | `lib/server/sourceImport/urlSafety.ts` | 扩展现有 `ssrfGuard`，增加 allowlist/denylist |
| 公开源抓取 | `lib/server/sourceImport/fetchPublicSource.ts` | 封装 `radarCrawler`，增加 retry/batch |
| 候选品提取 | `lib/server/sourceImport/extractCandidates.ts` | 复用 `radarNormalize` + `radarScore`，直接输出 `CandidateInput` |
| 来源导入 API | `app/api/source-import/route.ts` | 对 `crawl` API 的增强：抓取→评分→候选品草案→入池 |
| 来源导入 UI | `components/cross-border/SourceImporter.tsx` | 用户输入 URL、预览/勾选结果、确认入池 |

### 7.2 DB 模型判断

**Phase 4-B 不需要新增 DB 模型。** `OpportunityCandidate` 已足够。

| 字段 | 用途 |
|------|------|
| `source` | "RSS抓取" / "Sitemap抓取" / "网页抓取" / "手动输入" |
| `sourceMetaJson` | 来源元数据（URL、host、时间、方式） |
| `analysisJson` | 爬取原始结果（供审计/溯源） |
| `link` | 来源 URL |
| `keyword` | 品类/关键词 |

**不需要 SourceImportRun 模型**的理由：
- Alpha 阶段每次导入 ≤ 5 URL，无需批次管理
- 入池后候选品即可独立操作
- 导入日志可通过 `analysisJson` 中的 `crawledAt` 追溯

**什么时候需要 Source 模型**：
- 需要跟踪同一来源的多次爬取（如每日 RSS）
- 需要对比同一来源的候选品质量变化
- 需要按来源维度做统计分析
- → 商业化阶段再评估

### 7.3 Phase 4-B 是否需要改 schema？

**不需要。** 完全复用 `OpportunityCandidate`。

但如果改，最小 Source 模型草案（仅评估，不实现）：

```prisma
model CandidateSource {
  id        String   @id @default(cuid())
  name      String           // 来源名称
  type      String           // rss | sitemap | manual | crawl
  url       String?          // 来源 URL
  configJson String  @default("{}") // 抓取配置 JSON
  createdAt DateTime @default(now())
}
```

**权衡**：不改 schema 的优势是零负担开发；缺点是缺少来源维度的聚合统计。Alpha 阶段不需要来源统计，故不推荐改。

---

## 8. 风险评估

| # | 风险 | 等级 | 说明 | 缓解方案 |
|---|------|------|------|---------|
| 1 | 合规风险 | 🟡 中 | 某些网站 robots.txt 可能歧义 | 保守策略：robots.txt 有 Disallow 即停止 |
| 2 | SSRF/内网访问 | 🟢 低 | 已有完整 `ssrfGuard`（协议+host+DNS 三层） | 持续维护 ssrfGuard 规则 |
| 3 | 抓取失败率 | 🟡 中 | 很多网站 Cloudflare/JS渲染/反爬 | 明确告知用户失败原因，不自动重试 |
| 4 | 数据质量差 | 🟡 中 | RSS/sitemap 提取的标题可能不准确 | 用户人工确认后才入池 |
| 5 | 候选池污染 | 🟡 中 | 批量导入可能冲入大量低质候选品 | 每批最多 5 URL，用户逐条确认 |
| 6 | 用户误以为自动选品 | 🟡 中 | 导入后用户可能不标记状态 | UI 引导："请标记状态后再进入单品分析" |
| 7 | 成本与性能 | 🟢 低 | 已有 1MB/10s/5URL 限制 | Alpha 用户量极小 |
| 8 | 回滚风险 | 🟢 低 | 不涉及 schema 变更 | 删除候选品即可回退 |

---

## 9. 推荐下一步

### 主建议：**A. 进入 Phase 4-B：来源导入器 MVP 开发**

理由：

1. **基础设施已完备**：`ssrfGuard` + `radarCrawler` + `radarNormalize` + `radarScore` + `OpportunityCandidate` API 都已就位，Phase 4-B 主要是"桥接"（爬虫结果→候选池）和"UI"（用户确认入池）
2. **风险可控**：不做新协议、不破安全边界、不改 schema
3. **价值明确**：从"手动敲候选品名"升级为"贴一个 RSS 链接，自动提 20 个候选品"
4. **合规安全**：所有现有安全逻辑（robots.txt、SSRF、超时、大小限制）可原样复用

不建议选 B（暂缓）的理由：
- sqlite3 运维补强是低优先级运维任务，不应阻塞功能开发

不建议选 C（暂缓/用户测试）的理由：
- 来源导入器 MVP 的开发是往现有候选池加一个入口，不影响已有主链路，可以并行

---

## 10. 附录：关键文件索引

| 类别 | 文件 |
|------|------|
| 爬虫 API | `app/api/opportunities/crawl/route.ts` |
| SSRF 防护 | `lib/server/ssrfGuard.ts` |
| 爬虫核心 | `lib/server/radarCrawler.ts` |
| 数据清洗 | `lib/server/radarNormalize.ts` |
| 规则评分 | `lib/server/radarScore.ts` |
| 候选池服务 | `lib/server/opportunityCandidateService.ts` |
| 候选池 API | `app/api/opportunity-candidates/route.ts` |
| 候选池 UI | `components/cross-border/OpportunitiesForm.tsx` |
| SSRF 测试 | `lib/server/ssrfGuard.test.ts` |
| 设计文档 | `docs/phase-4a-real-source-management-design.md`（本文件） |
