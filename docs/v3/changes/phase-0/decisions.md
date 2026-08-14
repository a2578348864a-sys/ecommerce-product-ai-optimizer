# Phase 0 裁定 — 资产去留与迁移裁定

> 依据：`04_ASSET_MIGRATION_SPEC.md`（必填列：对象/路径/当前职责/调用方/状态语义/V3 角色/去留/是否绕过 Evidence 门禁/是否允许新写/风险/验收）
> 状态：已完成（`PHASE_0 = PASS`，见 acceptance.md）。每行资产的「状态语义」统一见 §2 状态语义统一裁定（该对象相关状态套在 audit.md 0B 表中有取值与读写方）。

## 1. 资产去留总表

### 1.1 V3 主链资产（保留）

| 对象 | 路径 | 当前职责 | 调用方 | V3 角色 | 去留 | 绕过 Evidence 门禁 | 允许新写 | 风险 | 验收 |
|---|---|---|---|---|---|---|---|---|---|
| 发现商品页 | `app/opportunities/page.tsx` + `components/cross-border/ProductBatchManager.tsx` | SellerSprite 批次导入/筛选 | 侧边栏/工作台 | 数据获取层主入口 | 保留 | 否（导入即证据化批次） | 是 | 导入链需 Phase 1 稳定化 | Phase 1 |
| 批次 API | `app/api/product-batches/**` + `lib/server/productBatch*` | 批次 CRUD/转候选 | ProductBatchManager | 数据获取层 | 保留 | 否 | 是 | 双轨 store 一致性 | Phase 1 |
| 研究池 | `app/opportunity-candidates/page.tsx` + `CandidatePoolPanel` | 候选列表/排序 | 侧边栏 | Candidate 层 | 保留 | 否 | 是 | — | 持续 |
| 候选 API | `app/api/opportunity-candidates/**` + `opportunityCandidateService` | 候选 CRUD/研究上下文 | 池与研究页 | Candidate 层 | 保留 | 否 | 是 | — | 持续 |
| 研究页 | `app/opportunity-candidates/[candidateId]/page.tsx` + `AgentRunClient` | 三阶段研究 + 决定 | 池页 | Evidence/Research 层 | 保留 | 否 | 是 | — | Phase 2 |
| 研究 pipeline | `app/api/workflows/product-analysis(+save-task)` + `lib/workflows/productAnalysis.ts` | 研究执行与落库 | AgentRunClient | Evidence/Research 层 | 保留 | 否 | 是 | proof/配额已有 | Phase 2 |
| 研究记录 | `lib/productResearchRecord.ts` + `productResearchRecordStore` + research-decision API | 版本化研究记录+哈希 | 研究页/任务详情 | Evidence 核心 | 保留 | 否 | 是 | — | Phase 2 |
| 任务历史 | `app/tasks/**` + `app/api/tasks/**` + `taskResultJsonMutation` | 研究历史/详情 | 侧边栏 | 人工闸门层 | 保留 | 否 | 是 | 命名空间契约已冻结 | 持续 |
| 创作交接 | creative-handoff / listing-handoff / image-handoff API + `lib/listingHandoff`、`lib/imageHandoff` | 事实确认→创作输入 | 任务详情/Studio | 内容生产层 | 保留 | 否 | 是 | — | Phase 2/6 |
| Listing Studio | `app/listing-studio/**` + `/api/listing-studio` + `studioListingService` | 独立 Listing 生成 | 侧边栏 | 内容生产层 | 保留 | 是（真实 AI gate） | 是 | 配额已接 | 持续 |
| Image Studio | `app/image-studio/**` + `/api/image-studio` + `studioImageGenerator` | 独立图片生成 | 侧边栏 | 内容生产层 | 保留 | 是（真实 AI gate） | 是 | 配额已接 | 持续 |
| SellerSprite 解析 | `lib/upstream/sellersprite/**` | 报告识别/解析/投影 | 批次导入/CLI | 数据获取层核心 | 保留 | 否 | 是（受 Phase 1 门禁） | 2 报告类型，Reverse ASIN/Keyword Mining 未支持 | Phase 1/3/4 |
| SellerSprite CLI | `tools/upstream/sellersprite-preview*.ts` + `sellersprite:preview` script | 离线市场预筛报告 | Skill/人工 | 数据获取层工具 | 保留 | 否（authoritative=false 安全旗标） | 是 | — | 持续 |
| 业务 Skill | `skills/sellersprite-market-preview/SKILL.md` | 报告参数门禁与 CLI 编排 | Codex/人工 | 业务方法层第 1 个 Skill | 保留 | 否（只编排 CLI） | 是（按 Skill 合同） | V3 Skill 上限 4 | 持续 |
| 身份/配额 | `lib/server/accessPassword|accessSession|signedToken|demoAccess|demoGuard|demoSandbox|demoProductJourneyQuota` | 认证/隔离/配额 | 全部 | 基础层 | 保留 | — | 是 | — | 持续 |
| AI 门禁 | `lib/server/realAiListingGate.ts`、`realAiImageGate.ts`、`aiClient.ts` | 真实 AI 开关/调用 | Studio/交接 | AI 辅助层 | 保留 | — | 是 | — | 持续 |
| 工作流证明 | `lib/server/workflowRunProof.ts` | 研究运行证明 | save-task | 证据层 | 保留 | 否 | 是 | — | Phase 1 增强基础 |

### 1.2 旧链资产（停止新入口 / 退役候选 / 只读兼容）

| 对象 | 路径 | 当前职责 | 调用方 | 去留 | 绕过 Evidence 门禁 | 允许新写 | 风险 | 验收 |
|---|---|---|---|---|---|---|---|---|
| 旧爆款雷达生成 | `app/api/generate/route.ts` | 真实 AI 生成证据卡片 | 无页面 | 停止新入口 + 退役候选 | 是（无证据门禁） | 否 | 配额/审计盲区 | Phase 6 收口 |
| 旧 5 子代理 | `app/api/agents/*` | 素材/风险/货源/结论/爆款 AI | 孤儿组件 | 停止新入口 + 退役候选 | 是 | 否 | 仍真实 AI 消耗配额 | Phase 6 收口 |
| 旧机会分析 | `app/api/opportunities/route.ts` | 批量机会 pipeline | 无页面 | 退役候选 | 是 | 否 | — | Phase 6 收口 |
| 旧抓取入口 | `app/api/opportunities/crawl`、`source-import` | 公开源抓取 | 无页面 | 退役候选 | 是 | 否 | 外部网络出口 | Phase 6 收口 |
| 旧 SellerSprite 导入 | `app/api/opportunities/sellersprite-import` | XLSX 导入候选 | SellerSpritePreviewPanel | 停止新入口（V3 统一走 product-batches） | 部分（导入即保存） | 否 | 双链并行 | Phase 6 收口 |
| SellerSprite 预览 | `app/api/opportunities/sellersprite-preview` + `/opportunities/sellersprite-preview` 页 | 只读预览 + token | 预览面板（无站内入口） | 保留只读兼容（preview token 链可被 Phase 1 复用） | 否（只读） | 是（只读生成） | — | 持续 |
| 旧利润试算 | `app/products/new` + `app/api/products/ai-analysis|keywords|listing-copy` | 利润/关键词/文案 AI | 无站内入口 | 停止新入口 | 是 | 否 | 真实 AI 无证据门禁 | Phase 6 收口 |
| Listing 历史 | `app/api/products/listing-copy-history(+[id])` + `ListingCopyHistory` 模型 | owner-only 历史 | 无页面 | 只读兼容保留 | 否 | 否（停止新写） | 历史数据保留 | 持续 |
| 批量工作流 | `app/workflow/batch` + `WorkflowBatchClient` | 批量分析 | 无站内入口 | 停止新入口 | 是 | 否 | — | Phase 6 收口 |
| Stage1.5 预览 | `app/opportunities/screening-preview` + `MarketScreeningWorkbench` | dev 短名单预览 | 无站内入口 | 停止新入口（保留 dev 只读） | 否（只读） | 否 | — | 持续 |
| 旧 radar 工具 | `app/api/radar/*` | dev-only 工具 | 无页面 | 保留（dev-only，不加新入口） | — | 是（dev） | 生产不可达 | 持续 |
| 占位页 | `/agent` `/materials` `/risk` `/sourcing` `/summary` `/viral` | 已迁移提示 | 直链 | 保留 | — | — | — | — | 持续 |
| 重定向页 | `/agent/run` `/workflow` `/opportunities/import` | 旧入口收口 | 旧书签 | 保留 | — | — | — | — | 持续 |
| 孤儿组件 | `OpportunitiesForm` `ViralMockAgent` `RiskCheckForm` `SourcingForm` `SummaryForm` `MaterialsForm` `ProductProfitForm` `WorkflowClient` `SellerSpriteOpportunityPreview` `OpportunitiesConvergenceView` `WorkspacePlaceholderPage` | 旧表单/视图 | 无页面 | 退役候选（Phase 6 专项裁定，先确认测试引用） | — | — | 删错风险 | Phase 6 |
| 旧 AI listing 生成 | `app/api/tasks/[id]/listing-pack/ai-generate` | 旧 AI 生成（real 已拒绝） | 无页面 | 停止新入口（保留 mock 兼容） | 是 | 否 | — | Phase 6 |
| Studio 结果存储 | `studioImageResultStore`、`studioListingResultStore` | 生成落库 | 无查询入口 | 改造候选（Phase 2 补查询/展示）或保持内部存储 | — | 是 | 无 UI 消费 | Phase 2 |
| 旧 viral 记录模型 | `ViralAnalysisRecord`（Prisma） | 旧研究任务落库 | 旧链 | 只读兼容保留 | — | 停止新写 | 旧数据 | 持续 |

### 1.3 0B/0C 完成后的补充裁定

- 任务级真实 AI Listing 门禁不一致（listingGenerationService → taskLinkedAiListing 不受 OPENAI_LISTING_ENABLED 控制）：裁定为**已知不一致，Phase 0 不修**；Phase 2/6 在收口任务中统一（要么补 gate，要么把该路径正式纳入「handoff 后默认允许」并文档化）。
- category_current 候选落库缺口（sellersprite_candidate_source_v1 硬编码 Search Results）：裁定为 **Phase 1 范围内可修**（候选源快照 schema 属 SellerSprite 合同层）；未决前 category_current 只走批次链，不写候选源快照。
- listing-keyword-brief 可追溯字段不完整：裁定为 **Phase 2/3 增强项**（05 合同 + 30 文档 provenance），不属 Phase 0。
- AgentStatusKey 七态（派生展示态）：保留，明确不落库、不并入四态。
- 主链两分支：ProductBatchManager 批次链为 V3 主入口；旧 opportunities 表单链全部死代码，随 Phase 6 收口。

## 2. 状态语义统一裁定

### 2.1 权威状态

- **V3 人工决定四态（唯一权威）**：`pending / continue / need_info / rejected`，权威定义在 `lib/tasks/decisionStatus.ts`（含文案与 normalize 函数）。所有 UI 文案、筛选、汇总以此为准。

### 2.2 研究决定三值 → 四态映射（保留，显式映射）

- `creative_ready`（进入创作准备）→ `continue`
- `needs_information`（待补信息）→ `need_info`
- `abandoned`（放弃研究）→ `rejected`
- 映射函数已存在：`productResearchDecisionToCompatibilityStatus`（lib/productResearchRecord.ts:560）。
- 裁定：研究层保留三值记录（含 reason/nextAction/actor/revision），兼容层统一为四态；禁止 UI 直接展示第三套未映射状态。

### 2.3 候选池队列状态（显式区分，不并入四态）

- `CandidateStatus = pending / worth_analyzing / analyzed / paused / rejected`（lib/opportunityCandidatePool.ts:22）。
- 裁定：这是「候选队列」状态，不是「人工决定」状态；保留，UI 文案（待查看/待分析/分析中/已转任务/已放弃）与四态并存但语义分离；文档写明两者关系（rejected 一致，其余互不替代）。

### 2.4 生命周期状态（正交维度）

- `LifecycleStatus = new_candidate / analysis_ready / analyzed / watching / ready_to_test / abandoned`（lib/workflowLifecycle.ts）。
- 裁定：保留为研究推进生命周期维度，与四态正交；不做合并。

### 2.5 旧状态（只读兼容，停止新写）

- viral 旧 decisionStatus 扩展值 `watchlist / archived`（lib/agentRunTimeline.ts:23 COMPLETED_DECISIONS）：只读兼容旧数据，停止新写。
- `R22MarketDecision`（r22-market-decision-v1）：旧市场决定快照，只读兼容；V3 新链不写。
- `BatchStatus = processing / ready / blocked / archived`（lib/productBatchContract.ts:3）：批次状态，保留（属于批次生命周期，非人工决定）。
- `stage1PromotionDecision = promoted / rejected / insufficient_evidence`（lib/upstream/contracts.ts:238）：预筛决定，保留（AI 建议层，人工复核）。
- `AiImageReviewStatus = needs_human_review / approved / rejected`：图片草稿复核状态，保留（独立维度）。

### 2.6 状态写入门禁

- 人工决定四态只允许通过 `research-decision` API（带 expectedRevision 乐观并发）写入 `researchRecord` 命名空间；`legacy-decision` 写者为空（只读旧数据）。
- 其余状态各有唯一写入方（见 0B 证据），禁止跨层直接改写。

## 3. score 裁定（04 必答）

| 问题 | 裁定 |
|---|---|
| 谁写 | `OpportunityCandidate.score`：source-import（radarScore.final）、from-market-screening、workflows/save-task（opportunityScore）、import-local、PATCH `[id]`；`ViralAnalysisRecord.score`：任务创建时写入（workflowScoreFromRiskLevel）；`task.score`（sandbox）：创建/更新时写入 |
| 谁读 | 候选池列表按 score desc 排序（opportunityCandidateService.ts:408）、池 UI 展示；tasks 列表/聚合展示 score |
| 是否排序 | 是（候选池默认排序之一） |
| 是否参与 V3 推荐 | **否**：V3 新决策链（research-decision + Evidence）不得把 score 当「值得继续」权威依据（04 默认裁定） |
| UI 是否显示 | 是（保留展示，标注为参考分；V3 决策以研究记录/决定为准） |
| 是否停止新写 | 否（导入链继续写入以保证列表可用），但 V3 研究链不读取 score 做决定 |
| 新增证据驱动评分 | `ProductBatchItem` 的 stage1 确定性排名（rankingJson、researchPriority、provisionalDisposition、evidenceStatus）是证据驱动、可追溯，V3 保留为预筛层，不替代人工决定 |

## 4. 旧链去留裁定

- 新主链（V3 形状）已成立：`发现商品(批次导入) → 研究池 → 候选研究(三阶段+研究记录+四态决定) → 研究历史 → 创作交接 → Listing/Image Studio`。
- 旧链（机会雷达/5 子代理/利润试算/批量工作流/Stage1.5 预览）全部**停止新入口**；页面已由占位页/重定向收口，API 保留但标记退役候选，统一由 Phase 6 收口（本 Phase 只裁定不动代码）。
- 旧数据（ViralAnalysisRecord、ListingCopyHistory、旧 resultJson 命名空间）**只读兼容保留**，不迁移、不删除。

## 5. API/MCP 定位裁定

- 现状：无 API/MCP 对外服务；数据入口 = SellerSprite XLSX（批次/预览）+ 浏览器人工辅助 CLI（tools/collectors/amazon，human-assisted）+ 人工录入。
- 裁定：V3 Core **不引入** API/MCP 正式入口，不建设任何新 API/MCP 能力；`02_FINAL_ARCHITECTURE` 中 API/MCP 保持「候选增强」，未经独立验证不替代 XLSX 合同。
- 浏览器方向：现有 `tools/collectors/amazon`（human-assisted CLI、browser-control、live-canary、page-diagnostics）为 V3.x Spike 的既有资产，V3 Core 不扩展；V3.1 授权前不装新浏览器依赖。

## 6. Phase 1/2 冲突范围（Gate 6）

### Phase 1 边界（Product Search 识别稳定化）

- 只动：`lib/upstream/sellersprite/**`（reportType/precheck/fields/xlsx/preview/canonical/projections）、`tools/upstream/sellersprite-preview/**`、`lib/upstream/contracts.ts`、相关测试与 Golden Dataset fixture（30 增强）。
- 禁止触碰：`app/api/**`、`lib/server/**`（除 fixture 相关）、prisma、页面。

### Phase 2 边界（Evidence Read Model + Workbench UI）

- 只动：研究记录/证据读取模型（productResearchRecord/candidateAnalysisContext/resultJson 命名空间读取侧）、`/opportunity-candidates/[candidateId]` 研究页与任务详情展示。
- 禁止触碰：`lib/upstream/sellersprite/**` 解析链（与 Phase 1 无重叠）。
- 重叠风险点：`app/api/workflows/product-analysis/save-task/route.ts`（写 researchRecord）——Phase 2 如需扩展写入需与 Phase 1 串行确认；两阶段默认不并行修改该文件。

### 与 0A 疑点的关系

- 旧 AI 入口（/api/generate、/api/agents/*）不在 Phase 1/2 范围；Phase 6 收口时处理，Phase 1/2 不得为它们扩展。
- `sellersprite-preview` 链（token/同源/限流）若 Phase 1 需要改造 preview 服务，属于 Phase 1 范围（涉及 `lib/server/sellerSpritePreview*`）——在 Phase 1 proposal 中显式列出。

## 7. 遗留风险清单（Phase 0 不修，登记在案）

| # | 风险 | 证据 | 处理时机 |
|---|---|---|---|
| 1 | 任务级 AI Listing 不受 OPENAI_LISTING_ENABLED 开关控制 | listingGenerationService.ts:483-496；taskLinkedAiListing.ts:157 | Phase 2/6 统一裁定 |
| 2 | 旧 AI 入口（/api/generate、/api/agents/*5）仍真实调用并消耗配额，无页面调用方 | 0A API 清单；孤儿组件 | Phase 6 收口 |
| 3 | Reverse ASIN / Keyword Mining 无实现（V3 三报告冻结未满足） | reportType.ts:6-7 | Phase 3/4 |
| 4 | category_current 候选源快照硬编码 Search Results | sellerSpriteImportContract.ts:156 | Phase 1 |
| 5 | 旧 listing-copy 链真实 AI 无证据门禁 | ProductProfitForm.tsx:650 | Phase 6 |
| 6 | listing-keyword-brief 可追溯字段不完整（05 合同） | listingKeywordBrief.ts:27-35 | Phase 2/3 |
| 7 | studioImageResultStore/studioListingResultStore 无查询入口 | 0A 疑点 6 | Phase 2 |
| 8 | listing-copy-history owner-only（Visitor 无历史） | 0A 疑点 5 | 产品决策 |
| 9 | 外部抓取出口 2 处无页面调用方（crawl/source-import） | 0A | Phase 6 |
| 10 | 真实 XLSX 不入 Git 约束持续有效；仓库仅脱敏 fixture | manifest real_samples_must_not_be_committed | 持续 |
