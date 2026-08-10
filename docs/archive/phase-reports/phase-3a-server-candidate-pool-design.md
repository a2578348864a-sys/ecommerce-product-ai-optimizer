# Phase 3-A：服务端候选池设计评估

> 状态：只读方案评估 · 未实现 · 2026-06-24
> 依赖：Phase 2-O 已收口 · 当前生产 `43349a6`

## 1. 当前状态总结

### 1.1 localStorage 候选池

| 维度 | 现状 |
|------|------|
| 存储位置 | 浏览器 localStorage |
| Key | `qx:opportunity-candidate-pool:v1` |
| TTL | 7 天（过期自动清除） |
| 数据结构 | `OpportunityCandidatePoolItem[]` 序列化为 JSON |
| 状态 | `pending` / `worth_analyzing` / `analyzed` / `paused` / `rejected` |
| 排序 | 按分数、最近更新 |
| 筛选 | 全部、值得深挖、待判断、暂缓、已分析、放弃 |
| 去重 | 按商品名（name）去重 |
| 迁移能力 | 无服务端备份，浏览器清除即丢失 |

### 1.2 当前服务端存储

- 唯一模型：`ViralAnalysisRecord`
- 字段：`id, type, decisionStatus, title, platform, productUrl, materialText, source, score, level, oneLineSummary, resultJson, createdAt, updatedAt`
- `resultJson` 承载了所有结构化结果（workflow finalReport、sourceMeta、batchMeta 等）
- 无独立 Candidate 表

### 1.3 现有鉴权

- 所有 `/api/tasks/*` 端点通过 `checkAccessPassword()` 校验
- 校验来源：请求头 `x-access-password` 或 body 中 `accessPassword`
- 环境变量：`ACCESS_PASSWORD` 或 `APP_ACCESS_PASSWORD`
- save-task API 同样受保护

---

## 2. 方案判断（10 个关键问题）

### 2.1 是否应该继续用 ViralAnalysisRecord 承载候选池？

**不建议。**

原因：
1. `ViralAnalysisRecord` 的语义是"已完成分析的任务记录"，而候选品是"待判断的初筛条目"。语义混淆会导致筛选、统计、UI 渲染复杂度增加。
2. `resultJson` 已经是万能 JSON 字段，继续往里塞候选池数据会加重解析负担。
3. `ViralAnalysisRecord` 的字段（`materialText`、`productUrl`、`source`（mock/ai））与候选池需求不匹配。
4. 候选池有独立的状态机（pending → worth_analyzing → analyzed → paused/rejected），与 task 的 `decisionStatus` 状态机（pending/continue/need_info/rejected）不同且不应强行合并。
5. 后续爬虫/数据源接入时，候选品数量可能远大于任务数量，混在一起会影响任务列表分页和查询性能。

### 2.2 是否应该新增 Candidate 模型？

**建议新增 `OpportunityCandidate` 模型。**

### 2.3 是否需要 CandidateSource 模型？

**当前 MVP 不需要独立模型，建议用 JSON 字段承载。**

理由：
- Alpha MVP 候选品来源有限（手动输入、公开爬虫、机会雷达分析结果）
- source 信息结构简单（`{ type: "manual" | "crawl" | "opportunity_analysis", detail: "..." }`）
- 独立模型增加 JOIN 复杂度和 API 往返次数，收益有限
- 可以在 `sourceMetaJson` 字段中以结构化 JSON 承载，后续确有需要再拆表

### 2.4 是否需要 CandidateStatus 历史记录？

**当前 MVP 不需要。仅保留当前状态。**

理由：
- Alpha 阶段候选品数量预期 < 100，状态变更频率低
- 如果需要审计，可以在 `analysisJson` 中追加操作日志
- 独立 history 表增加写操作复杂度和存储开销
- MVP 阶段先跑通主链路，后续再补审计

### 2.5 是否需要把 localStorage 数据迁移到服务端？

**建议提供"导入"功能，不做强制迁移。**

策略：
- 保留 localStorage 读写能力，不删除现有代码
- 新增 `POST /api/opportunity-candidates/import-local` 端点
- 前端提供"上传本浏览器候选池到云端"按钮
- 导入后服务端优先展示，localStorage 降级为离线兜底
- 不自动迁移、不静默迁移

### 2.6 是否需要多用户能力？

**当前 MVP 不需要。**

理由：
- 当前访问密码模式是单用户/共享密码模式
- 所有任务 API 共用同一个 `ViralAnalysisRecord` 表，无 `userId` 字段
- 候选池沿用同一访问密码鉴权即可
- 多用户/多租户是商业化阶段的事，不应在 Alpha MVP 引入

### 2.7 是否会影响现有 /opportunities → /workflow → /tasks 链路？

**不会。**

设计原则：
- `/opportunities` 页面优先读服务端候选池，失败降级 localStorage
- `/workflow` 的 `sourceMeta` 传递机制不变（现有 URL params + save-task 写入）
- `/tasks` 列表和详情不变
- 候选池转任务（"用单品分析深挖"→ save-task）的现有流程不变

### 2.8 服务端化后，localStorage 还保留什么用途？

| 用途 | 保留 | 说明 |
|------|------|------|
| 离线草稿 | ✅ | 网络不可用时仍可手动输入候选品 |
| 降级兜底 | ✅ | API 失败时回退 localStorage 数据 |
| 本地缓存 | ✅ | 减少重复 API 请求 |
| 主存储 | ❌ | 服务端化后不作为权威数据源 |

### 2.9 如果做最小实现，预计改哪些文件？

| 层 | 文件 | 改动类型 |
|----|------|---------|
| Schema | `prisma/schema.prisma` | 新增 1 个 model |
| API | `app/api/opportunity-candidates/route.ts` | 新增 GET/POST |
| API | `app/api/opportunity-candidates/[id]/route.ts` | 新增 PATCH/DELETE |
| API | `app/api/opportunity-candidates/import-local/route.ts` | 新增 POST（可选） |
| Lib | `lib/server/opportunityCandidateService.ts` | 新增（CRUD 封装） |
| Lib | `lib/opportunityCandidatePool.ts` | 新增服务端读写函数 |
| Component | `components/cross-border/OpportunitiesForm.tsx` | 改数据源（localStorage → API） |
| Component | `components/HomeDashboardClient.tsx` | 候选池统计读 API |
| Hook | 可能新增 `hooks/useCandidatePool.ts` | 封装 API + localStorage fallback |

### 2.10 是否适合下一轮直接开发？

**基本适合，但有一个前置条件：需要先执行 Prisma migrate。**

前置条件：
1. ✅ 现有鉴权机制可复用
2. ✅ 现有数据结构清晰，映射明确
3. ✅ 前端已有完整的 localStorage 实现可参考
4. ⚠️ 需要在开发环境先跑一次 `prisma migrate`（改 schema）
5. ⚠️ SQLite 并发写入能力有限，候选池 + 任务 API 并发需关注

---

## 3. Prisma 模型草案（仅供评估）

```prisma
model OpportunityCandidate {
  id               String   @id @default(cuid())
  name             String                     // 商品名（必填）
  rawInput         String   @default("")      // 原始输入
  link             String?                    // 来源链接
  score            Int      @default(0)       // 分数 0-100
  source           String   @default("机会雷达") // 来源标签
  keyword          String   @default("")      // 关键词
  riskLevel        String   @default("")      // red / yellow / green / ""
  riskLabel        String   @default("")      // 高风险 / 需注意 / 低风险 / ""
  summaryLabel     String   @default("")      // 一句话摘要
  status           String   @default("pending") // pending / worth_analyzing / analyzed / paused / rejected
  sourceMetaJson   String   @default("{}")    // 来源元数据 JSON
  analysisJson     String   @default("{}")    // 完整分析结果 JSON
  convertedTaskId  String?                    // 关联的任务 ID（可选）
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  lastActionAt     DateTime?                  // 最后操作时间

  @@index([status, updatedAt])
  @@index([score])
  @@index([createdAt])
  @@index([name])
}
```

### 3.1 字段说明

| 字段 | 必需 | 说明 |
|------|------|------|
| `id` | ✅ | cuid 自动生成，替代 localStorage 的 hash-based id |
| `name` | ✅ | 商品名，去重维度 |
| `rawInput` | ✅ | 用户原始输入，用于回溯 |
| `link` | — | 来源链接，可选 |
| `score` | ✅ | 0-100，默认 0 |
| `source` | ✅ | 来源标签，默认"机会雷达" |
| `keyword` | — | 默认空字符串 |
| `riskLevel` | — | 默认空 |
| `riskLabel` | — | 默认空 |
| `summaryLabel` | — | 默认空 |
| `status` | ✅ | 候选状态，默认 "pending" |
| `sourceMetaJson` | — | JSON 字段，承载结构化来源信息 |
| `analysisJson` | — | JSON 字段，承载完整 AI 分析结果 |
| `convertedTaskId` | — | 当候选品已转为 workflow 任务后，记录 task id |
| `lastActionAt` | — | 最后操作时间，用于排序和 TTL |

### 3.2 JSON 字段用途

**`sourceMetaJson`** 结构：
```json
{
  "type": "manual" | "crawl" | "opportunity_analysis",
  "crawlUrl": "...",
  "crawlHost": "...",
  "crawlTimestamp": "...",
  "opportunityScore": 85,
  "opportunitySource": "机会雷达候选品"
}
```

**`analysisJson`** 结构：
```json
{
  "sourcing": { ... },
  "risk": { ... },
  "summary": { ... },
  "finalReport": { ... },
  "analyzedAt": "2026-06-24T12:00:00Z"
}
```

### 3.3 索引策略

| 索引 | 用途 |
|------|------|
| `@@index([status, updatedAt])` | 按状态筛选 + 时间排序（主查询路径） |
| `@@index([score])` | 按分数排序 |
| `@@index([createdAt])` | 按创建时间筛选 |
| `@@index([name])` | 按商品名搜索 |

### 3.4 SQLite 风险评估

| 风险 | 等级 | 说明 |
|------|------|------|
| 并发写入 | 🟡 中 | SQLite 单写锁，候选池 + 任务并发写入可能排队。Alpha 数据量小，可接受。 |
| JSON 字段不可索引 | 🟢 低 | `sourceMetaJson` 和 `analysisJson` 仅作存储，不参与查询过滤。 |
| 全文搜索 | 🟢 低 | 商品名搜索用 `@@index([name])` + `contains`，SQLite 足够。 |
| 数据量 | 🟢 低 | Alpha MVP 预期 < 500 候选品，SQLite 完全胜任。 |

---

## 4. API 草案

### 4.1 `GET /api/opportunity-candidates`

- **用途**：获取候选品列表
- **入参**：
  - `status` (optional): 筛选状态
  - `sort` (optional): `score` / `updated`
  - `q` (optional): 商品名搜索
  - `limit` (default 50)
  - `offset` (default 0)
- **出参**：
  ```json
  {
    "ok": true,
    "candidates": [...],
    "page": { "total": 42, "hasMore": false, "nextOffset": null }
  }
  ```
- **鉴权**：需要 `x-access-password` header
- **错误码**：`unauthorized` / `database_error`
- **写 DB**：否
- **与现有关系**：新增端点，不影响 `/api/opportunities`（后者是 AI 分析端点）

### 4.2 `POST /api/opportunity-candidates`

- **用途**：新增一个或多个候选品
- **入参**：
  ```json
  {
    "candidates": [
      { "name": "桌面手机支架", "score": 85, "source": "机会雷达", ... }
    ]
  }
  ```
- **出参**：`{ "ok": true, "candidates": [...], "merged": 2, "created": 3 }`
- **鉴权**：需要访问密码
- **错误码**：`unauthorized` / `invalid_body` / `database_error`
- **写 DB**：是（INSERT，按 name 去重 upsert）
- **与现有关系**：替代 localStorage `mergeCandidatesIntoPool()`

### 4.3 `PATCH /api/opportunity-candidates/[id]`

- **用途**：更新单个候选品（状态变更、备注等）
- **入参**：`{ "status": "worth_analyzing" }`
- **出参**：`{ "ok": true, "candidate": {...} }`
- **鉴权**：需要访问密码
- **错误码**：`unauthorized` / `not_found` / `invalid_status` / `database_error`
- **写 DB**：是（UPDATE）
- **与现有关系**：替代 localStorage `updateCandidateStatus()`

### 4.4 `DELETE /api/opportunity-candidates/[id]`

- **用途**：删除候选品（物理删除）
- **出参**：`{ "ok": true, "data": { "id": "..." } }`
- **鉴权**：需要访问密码
- **写 DB**：是（DELETE）
- **说明**：Alpha MVP 阶段不做 soft delete，简单物理删除即可

### 4.5 `POST /api/opportunity-candidates/import-local`（可选）

- **用途**：将浏览器 localStorage 中的候选品批量导入服务端
- **入参**：`{ "items": [...] }` — localStorage `readCandidatePool()` 的输出
- **出参**：`{ "ok": true, "imported": 5, "skipped": 0 }`
- **鉴权**：需要访问密码
- **写 DB**：是（批量 upsert）
- **说明**：去重逻辑复用 `getCandidateDedupeKey()`

---

## 5. 前端迁移方案

### 5.1 五步迁移路径

```
第一步：页面优先读服务端，失败降级 localStorage
第二步：提供"导入本浏览器候选池"按钮
第三步：新候选品默认写服务端
第四步：保留 localStorage 作为草稿/离线兜底
第五步：任务来源 sourceMeta 继续兼容
```

### 5.2 数据流

```
┌─────────────────────────────────────────────────┐
│              OpportunitiesForm                   │
│                                                  │
│  useEffect → GET /api/opportunity-candidates     │
│       │                                          │
│       ├── 200 → setPoolItems(serverData)         │
│       │                                          │
│       └── 失败 → setPoolItems(localStorageData)  │
│                + 显示"离线模式"提示               │
│                                                  │
│  用户操作（标记状态）→ PATCH API                  │
│  用户操作（新增）→ POST API                       │
│  API 失败 → 回退 localStorage                     │
└─────────────────────────────────────────────────┘
```

### 5.3 不要做什么

- ❌ 不要一次性删除 localStorage 读写代码
- ❌ 不要强制自动迁移
- ❌ 不要影响现有用户浏览器里的候选池数据
- ❌ 不要上来就做多租户复杂权限
- ❌ 不要在迁移期改变 `OpportunityCandidatePoolItem` 的 id 生成逻辑（保持兼容）

---

## 6. 风险评估

| # | 风险 | 等级 | 说明 | 缓解方案 |
|---|------|------|------|---------|
| 1 | 数据迁移风险 | 🟡 中 | 用户浏览器里有候选品但 API 不可用时，可能丢失操作 | 导入按钮 + 双重读写 + 迁移前提示 |
| 2 | 鉴权风险 | 🟢 低 | 复用现有 `checkAccessPassword()`，一致性有保证 | 所有候选池 API 统一使用相同鉴权 |
| 3 | schema 设计错误 | 🟡 中 | 字段过多或过少，后续改 schema 需要 migrate | 先用 JSON 字段承载不稳定的结构，核心字段保持精简 |
| 4 | JSON 字段滥用 | 🟡 中 | `sourceMetaJson` / `analysisJson` 可能变成垃圾场 | 文档约定结构，API 层做 JSON schema 校验 |
| 5 | 列表分页/性能 | 🟢 低 | Alpha 数据量小（< 500），SQLite 完全足够 | 加索引，limit 上限 50 |
| 6 | 爬虫接入后数据污染 | 🟡 中 | 后续真实爬虫可能灌入脏数据 | 候选品创建时校验 name 非空、分数范围、来源合法性 |
| 7 | 成本与复杂度 | 🟢 低 | 新增 1 个 model + 2-3 个 API 端点，改动可控 | 最小化改动范围，复用现有鉴权和 Prisma 客户端 |
| 8 | 回滚风险 | 🟢 低 | 如果服务端候选池有问题，可回退 localStorage 模式 | 保留 localStorage 读写代码，候选池 API 可单独禁用 |

---

## 7. 推荐下一步

### 主建议：**A. 可以进入 Phase 3-B：服务端候选池 MVP 开发**

理由：
1. 当前 localStorage 候选池已经是明确的短板，并且是用户可感知的痛点（换浏览器丢数据）
2. 设计已经充分评估了 schema、API、前端迁移、风险
3. 实现范围明确且可控：1 个 model + 2-3 个 API + 1 个组件改造
4. 不影响现有主链路（`/opportunities → /workflow → /tasks`）
5. 鉴权可复用，不需要重新设计安全层
6. 前置条件清晰：只需执行一次 `prisma migrate`

不建议暂缓的原因：
- 候选池是主链路第一环（首页 → 候选池 → 单品分析），如果候选池不稳定，整个主链路的可信度受影响
- 真实数据源/爬虫接入在没有服务端候选池的情况下，没有稳定的落地层

---

## 8. 附录：关键文件路径索引

| 类别 | 文件 |
|------|------|
| 候选池核心 | `lib/opportunityCandidatePool.ts` |
| 候选池测试 | `lib/opportunityCandidatePool.test.ts` |
| 候选池 UI | `components/cross-border/OpportunitiesForm.tsx` |
| 机会页路由 | `app/opportunities/page.tsx` |
| 机会 API | `app/api/opportunities/route.ts` |
| 任务 API | `app/api/tasks/route.ts` |
| 任务详情 API | `app/api/tasks/[id]/route.ts` |
| 保存任务 API | `app/api/workflows/product-analysis/save-task/route.ts` |
| Prisma Schema | `prisma/schema.prisma` |
| 任务摘要 | `lib/taskWorkflowSummary.ts` |
| 任务列表 UI | `components/TaskRecordsList.tsx` |
| 任务详情 UI | `components/TaskRecordDetail.tsx` |
| Alpha 状态文档 | `docs/alpha-mvp-status.md` |
| 项目 README | `README.md` |
| 项目总览 | `00_项目总览.md` |
| 设计文档 | `docs/phase-3a-server-candidate-pool-design.md`（本文件） |
