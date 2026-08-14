# Phase 0 审计 — 现状资产地图

> 只读盘点产物。所有结论带仓库内证据；「未知」表示未确认。基线：main `76e2c962`（Phase 0 前 clean）。
> 0A/0B/0C 全部完成（3 个只读子 Agent + 主 Agent 交叉核对，无矛盾；冲突点已更正）。

## 0A 页面 / Route / API

### 页面清单（21 个 page.tsx）

| 路径 | 标题/用途 | 主要 API 调用 | 去留见 decisions |
|---|---|---|---|
| `/` | 登录（Owner/Visitor）→ HomeDashboardClient | `/api/auth/login`、`/api/tasks`、`/api/opportunity-candidates` | 保留 |
| `/agent` | 占位页：商品研究已迁移 | 无 | 保留占位 |
| `/agent/run` | 重定向 → `/opportunity-candidates/[candidateId]` | 无 | 保留重定向 |
| `/image-studio` | Image Studio 独立图片生成 | `/api/image-studio` | 保留 |
| `/listing-studio` | Listing Studio 独立生成 | `/api/listing-studio` | 保留 |
| `/materials` | 占位页：素材接收已迁移 | 无 | 保留占位 |
| `/opportunities` | 发现商品：SellerSprite 批次导入、选品入池（ProductBatchManager） | `/api/product-batches`（GET/POST/`[id]`/`candidates`/`selection`） | 保留（V3 主链入口） |
| `/opportunities/import` | 重定向 → `/opportunity-candidates?mode=manual` | 无 | 保留重定向 |
| `/opportunities/screening-preview` | Stage1.5 短名单预览（dev-only 只读） | 无（服务端 loader） | 停止新入口（候选） |
| `/opportunities/sellersprite-preview` | SellerSprite XLSX 只读预览 | `sellersprite-preview`、`sellersprite-import` | 裁定见 decisions |
| `/opportunity-candidates` | 待研究商品池 | `opportunity-candidates`（CRUD） | 保留（V3 主链入口） |
| `/opportunity-candidates/[candidateId]` | 商品研究权威页（三阶段） | `research-context`、`workflows/product-analysis(+save-task)`、`tasks/[id]/*` | 保留（V3 主链入口） |
| `/products/new` | 利润试算（不保存） | `/api/products/*` | 停止新入口（候选） |
| `/risk` `/sourcing` `/summary` `/viral` | 占位页：风险/货源/结论/爆款已迁移 | 无 | 保留占位 |
| `/tasks` | 研究历史列表 | `/api/tasks` | 保留（V3 主链入口） |
| `/tasks/[id]` | 任务详情 | `tasks/[id]`、`lifecycle`、`research-decision` | 保留 |
| `/workflow` | 重定向 → `/opportunity-candidates` | 无 | 保留重定向 |
| `/workflow/batch` | 批量工作流客户端（无站内入口链接） | `workflows/product-analysis(+save-task)` | 停止新入口（候选） |

### API 清单（52 个 route.ts / 约 68 handler）

| 方法+路径 | 职责 | 读写 | 主体 | 真实AI/外部 |
|---|---|---|---|---|
| POST `/api/auth/login` | 统一登录发 token | 写(会话) | 登录前 | 无 |
| GET `/api/health` | 健康检查 | 读 | 无 | 无 |
| POST `/api/ai/ping`、GET `/api/ai/diagnostics` | AI 连通/诊断（门禁） | 读 | 诊断 | 真实AI探测 |
| POST `/api/generate` | 旧爆款雷达生成 | 读(生成) | 两者+配额 | 真实AI |
| POST `/api/agents/material|risk|sourcing|summary|viral` | 旧 5 子代理 AI | 读(生成) | 两者+配额 | 真实AI |
| POST `/api/opportunities` | 批量机会分析 pipeline | 读(生成)+配额 | 两者+配额 | 真实AI |
| POST `/api/opportunities/crawl` | 公开源抓取 | 读 | 两者 | 外部抓取 |
| POST `/api/opportunities/source-import` | 来源 URL 导入 | 读 | 两者 | 外部抓取 |
| POST `/api/opportunities/sellersprite-preview` | XLSX 只读预览+token | 读 | 两者 | 无 |
| POST `/api/opportunities/sellersprite-import` | XLSX 导入候选 | 写 | 两者 | 无 |
| GET/POST `/api/opportunity-candidates` | 候选池列表/保存 | 读/写 | 两者 | 无 |
| PATCH/DELETE `/api/opportunity-candidates/[id]` | 候选更新/删除 | 写 | 两者 | 无 |
| GET `/api/opportunity-candidates/research-context` | 研究上下文组装 | 读 | 两者 | 无 |
| POST `.../import-local`、`.../from-market-screening` | 本地草稿导入/短名单转候选 | 写 | 两者 | 无 |
| GET/POST `/api/product-batches`、GET/PATCH/DELETE `[id]`、POST `candidates`、PATCH `selection` | 批次导入/详情/转候选/筛选 | 读/写 | 两者 | 无 |
| POST `/api/products/ai-analysis|keywords|listing-copy` | 跨境辅助 AI | 读(生成) | 两者+配额 | 真实AI |
| GET/POST/DELETE `/api/products/listing-copy-history(+[id])` | Listing 历史 | 读写删 | 仅 owner | 无 |
| POST `/api/radar/search|analyze-links|analyze-materials`、GET/POST `/api/radar/save` | dev-only 雷达工具 | 读写 | save 仅 owner | 无 |
| GET/POST `/api/tasks`、GET `/api/tasks/aggregate`、GET/PATCH/DELETE `/api/tasks/[id]` | 任务 CRUD/聚合 | 读写删 | 两者 | 无 |
| PATCH `/api/tasks/[id]/lifecycle` | 产品生命周期流转 | 写 | 两者 | 无 |
| GET/PATCH `/api/tasks/[id]/research-decision` | 人工研究决策（四态） | 读写 | 两者 | 无 |
| GET/POST `/api/tasks/[id]/creative-handoff` | 创意交接 | 读写 | 两者 | 无 |
| GET/POST/PATCH `/api/tasks/[id]/image-handoff` | 图片交接 | 读写 | 两者 | 真实AI图片 |
| GET/POST `/api/tasks/[id]/listing-handoff` | Listing 交接 | 读写 | 两者 | 真实AI |
| PATCH `/api/tasks/[id]/listing-pack`、POST `ai-generate`、POST `ai-save` | listing pack 快照/旧AI生成(mock)/落库审计 | 写 | 两者 | ai-generate 仅 mock |
| GET/POST `/api/tasks/[id]/image-draft(+[imageId])` | AI 图片草稿 | 读写 | 两者 | 真实AI图片 |
| POST `/api/tasks/[id]/visual-reference-import`、GET `visual-reference-preview` | 视觉参考导入（唯一外部图片入口）/安全预览 | 读写 | 两者 | 外部抓取(白名单) |
| POST `/api/workflows/product-analysis` | 三阶段研究 pipeline | 读(生成)+旅程配额 | 两者+配额 | 真实AI |
| POST `/api/workflows/product-analysis/save-task` | 研究结果落任务（proof 校验） | 写 | 两者 | 无 |

### 服务端库分组

| 模块组 | 职责 |
|---|---|
| accessPassword/accessSession/signedToken/proofSigningSecret | 身份、会话、签名 |
| demoAccess/demoGuard/demoSandbox/demoProductJourneyQuota/demoProductBatchStore | Visitor 访问、sandbox、配额 |
| realAiListingGate/realAiImageGate | 真实 AI 服务端开关 |
| aiClient/aiDiagnostics/aiListingGenerator/taskLinkedAiListing | AI 客户端与 Listing 核心 |
| aiImageDraft*/openaiImageClient/openaiImageEditClient/aiImageUrlFetcher | AI 图片草稿 |
| studio* | 独立 Studio 生成与结果存储 |
| opportunityCandidateService/candidateAuthority/candidateAnalysisContext/candidateEvidenceReview/candidateResearchEligibility/candidateSourceSave | 候选权威与研究上下文 |
| sellerSprite* | SellerSprite 导入契约/token/同源/限流/事实投影 |
| productBatch* | 批次导入/存储/候选转换/事实闭包（owner+demo 双轨） |
| taskResultJsonMutation/taskResultNamespacePolicy/productResearchRecordStore/researchContextAdapter/researchSaveStaleGuard | resultJson 受控写入与命名空间 |
| listingCopyHistoryStore/listingSnapshotAudit | Listing 历史（owner-only）与审计 |
| radarCrawler/radarNormalize/radarScore/ssrfGuard/sourceProof/sourceImportAcceptance | 抓取（SSRF 防护）、清洗、评分、来源证据 |
| alphaSafety/summaryRiskGuard/smokeOneShotGuard/manualFactConfirmation/mutationBoundary | 安全过滤与人工确认边界 |
| workflowRunProof/productCreativeHandoffPersistence/Preview/visualReferenceCandidates | 工作流证明与创意交接 |
| db.ts | Prisma 单例 |

## 0B 状态 / score / 旧 workflow

### 状态套数总览（主 Agent 已核验 + 子 Agent 0B 复核）

| 状态套名 | 业务对象 | 取值集合 | 读写方（代表） | 证据 |
|---|---|---|---|---|
| 人工决定四态（V3 权威） | 任务/研究决定兼容层 | pending / continue / need_info / rejected | 读：tasks 列表、homeDashboard、presentation；写：research-decision → researchRecord | lib/tasks/decisionStatus.ts:1-66；lib/server/productResearchRecordStore.ts:300-312 |
| 研究决定三值 | product-research-record.v1 | creative_ready / needs_information / abandoned | 写：research-decision PATCH；读：研究页/任务详情 | lib/productResearchDecisionContract.ts:1-36 |
| 候选池队列状态 | OpportunityCandidate（池） | pending / worth_analyzing / analyzed / paused / rejected | 写：candidateSourceSave/池操作；读：CandidatePoolPanel | lib/opportunityCandidatePool.ts:22；lib/server/candidateSourceSave.ts:41 |
| 产品生命周期 | resultJson.productLifecycle | new_candidate / analysis_ready / analyzed / watching / ready_to_test / abandoned | 写：lifecycle PATCH；读：任务详情/演示 | lib/workflowLifecycle.ts:10-66 |
| 旧 viral 决定扩展值 | ViralAnalysisRecord / 旧任务 | watchlist / archived（旧数据） | 只读兼容（agentRunTimeline） | lib/agentRunTimeline.ts:22-23 |
| R22 市场决定 | r22-market-decision-v1 | advance/watch/reject 语义快照 | 写：旧市场决定；读：候选 DTO | lib/r22DecisionModel.ts:119-133 |
| 批次状态 | ProductBatch.batchStatus | processing / ready / blocked / archived | 写：productBatchStore；读：批次管理 | lib/productBatchContract.ts:3,63-64 |
| 预筛决定 | ProductBatchItem | promoted / rejected / insufficient_evidence | 写：stage1Scoring；读：预筛工作台 | lib/upstream/contracts.ts:238 |
| AI 建议 level | 候选质量/证据决定 | recommended / cautious / not_recommended / rejected | 写：candidateEvidence/candidateQuality；读：来源导入 | lib/candidateEvidence.ts:1-18 |
| 图片草稿复核 | AiImageDraft | needs_human_review / approved / rejected | 写：image-draft 流程；读：图片草稿面板 | lib/aiImageDraft.ts:16 |

### score 盘点

| 对象 | 字段 | 谁写 | 谁读 | 排序 | UI | 证据 |
|---|---|---|---|---|---|---|
| OpportunityCandidate | score(Int 0-100) | source-import(radarScore.final)/from-market-screening/save-task(opportunityScore)/import-local/PATCH [id] | 池列表 sort=score desc | 是 | 是 | lib/server/opportunityCandidateService.ts:408-409,466,590；app/api/workflows/product-analysis/save-task/route.ts:274,390 |
| ViralAnalysisRecord/task | score(Int) | 任务创建/更新（workflowScoreFromRiskLevel 等） | tasks 列表/详情/聚合 | 否 | 是 | app/api/tasks/route.ts:200；app/api/tasks/aggregate/route.ts:46 |
| ProductBatchItem | researchPriority + rankingJson + provisionalDisposition + evidenceStatus | stage1Scoring（确定性、证据驱动） | 批次/预筛展示 | 是（冻结公式） | 是 | lib/upstream/stage1Scoring.ts:60-90；lib/upstream/sellersprite/marketSignalRanking.ts |
| 旧机会雷达 | radarScore 0-100 权重 | /api/opportunities pipeline | 无页面 | 否 | 否 | lib/server/radarScore.ts:9-16 |

### 旧链现状

- `/agent/run`、`/workflow`：纯重定向到 `/opportunity-candidates`（证据：app/agent/run/page.tsx:27-43、app/workflow/page.tsx:29-60）。
- `/sourcing`、`/risk`、`/summary`、`/viral`、`/materials`、`/agent`：LegacyMigratedPage 占位（证据：app/sourcing/page.tsx:4-9 等）。
- `/opportunities/import`：重定向到 `/opportunity-candidates?mode=manual`。
- 旧表单组件全部无页面引用（孤儿）：OpportunitiesForm、ViralMockAgent、RiskCheckForm、SourcingForm、SummaryForm、MaterialsForm、ProductProfitForm、WorkflowClient、SellerSpriteOpportunityPreview、OpportunitiesConvergenceView、WorkspacePlaceholderPage（证据：grep app/**/page.tsx 无 import）。
- 旧 API 仍在线：/api/generate、/api/agents/*（5）、/api/opportunities(+crawl/source-import/sellersprite-import)、/api/products/*、/api/radar/*（dev-only）、listing-pack/ai-generate（real 拒绝）。
- 数据落点：Owner 任务 = Prisma ViralAnalysisRecord；Visitor 任务/候选 = data/demo-sandbox.json（sandbox）；候选池另有 localStorage 缓存键 qx:opportunity-candidate-pool:v1；图片草稿 = AI_IMAGE_DRAFT_STORAGE_ROOT 本地文件；radar save = .local/radar-research（dev）。

## 0C Research / Keyword / Handoff / Studio / SellerSprite / AI gate

> 主 Agent 与子 Agent 0C 交叉核对一致。

### product-research-record

- schema：`product-research-record.v1`（revision/researchHash/candidateId/runId/contextHash/createdAt/updatedAt/latestDecision/decisionEvents），hash schema `product-research-hash.v1`，verification `product-research-verification.v1`（证据：lib/productResearchRecord.ts:14-16,65-91）。
- **重要澄清**：record 本身是「决策事件账本 + hash 绑定」，**不含** facts/estimates/unknowns/risks/conflicts 字段；研究事实/评估实际存于 `candidateAnalysisContext`（lib/server/candidateAnalysisContext.ts:38-107，facts/assessment/integrity）与 `decisionEvidence`（lib/decisionEvidence.ts）。V3 若把 record 当「证据主体」需在 Phase 2 明确证据读取模型边界。
- 写方：`save-task`（writer research-decision → researchRecord 命名空间，taskResultJsonMutation.ts:32，save-task/route.ts:757-906）；追加决策 = research-decision PATCH → productResearchRecordStore.ts:241-335（expectedRevision 乐观并发 + 幂等）。
- 读方：研究页（research-context）、任务详情（research-decision GET）、researchContextAdapter（:97-284）、creativeHandoffPreview gate。
- 追溯：researchHash/contextHash/inputHash/resultHash 哈希链 + decisionEvents（actor/reason/nextAction/revision）；公共 DTO 不投影 sourceRef/confirmedFacts（productResearchPublicDto.ts:190）。命名空间保护：taskResultNamespacePolicy.ts:3-32（31 个系统保留 key，通用写接口禁止触碰）。

### listing-keyword-brief

- schema：`listing-keyword-brief.v1`（ListingKeywordSource 等，证据：lib/listingHandoff/listingKeywordBrief.ts:27-35,102-146）。
- 写方：`/api/tasks/[id]/listing-handoff`（writer keyword-brief → listingKeywordBrief 命名空间，route.ts:307-313）；读方：Listing 生成链（listingGenerationInput 等）。
- 来源引用：listingKeywordProvenance（lib/listingHandoff/listingKeywordProvenance.ts）。

### Handoff 链

- creative-handoff：`product-creative-handoff.v1`（确认事实带 usageScopes listing/image/internal、source references、visual reference 带身份绑定、request ledger；证据：lib/productCreativeHandoff.ts:3-6,65,168-190）；写方 `/api/tasks/[id]/creative-handoff`（POST 创建/撤销，版本化，锁内 CAS + 幂等账本，persistence.ts:242-506）。
- **confirmed 三档**：`evidenceTier = human_confirmed`（sourceRef.sourceKind=user_confirmation + confirmedBy/confirmedAt，:65-75）/ `source_snapshot`（4 分支 sourceRef：candidate_snapshot/seller_sprite_snapshot/research_result/user_confirmation，:22-61）/ `ai_hypothesis`（allowedUse/prohibitedUses，:96-112）；market_signal 永不进 Listing 创作输入（researchContextAdapter.ts:224-227）。
- listing-handoff / image-handoff：GET/POST/PATCH，写 listingHandoffBinding / imageHandoffBinding 命名空间；confirmed 事实经 creativeHandoff 门禁（revoke 逻辑：productCreativeHandoffStatus.ts:95-96）。
- 人工确认边界：manualFactConfirmation（MANUAL_FACT_FIELDS 白名单，evidenceTier=human_confirmed）、creativeHandoffProjectionGate、listingSnapshotAudit。

### Studio

- Listing Studio：`/api/listing-studio`（standalone，复用 aiListingGenerator，real gate `isRealAiListingEnabled`/`isRealAiVisitorListingEnabled`，证据：app/api/listing-studio/route.ts:7-9）；`studioListingService`（Visitor 配额在 service 内 `reserveVisitorStandaloneStudioQuota`，studioListingService.ts:19-25）；**输出 meta.saved=false 不落业务库**，仅写临时 `studioListingResultStore`。
- Image Studio：`/api/image-studio`（standalone，studioImageGenerator，real gate `isRealAiImageEnabled`，env `OPENAI_IMAGE_GENERATION_ENABLED`/`OPENAI_IMAGE_VISITOR_ENABLED`，lib/server/realAiImageGate.ts:6-13）；`studioImageResultStore` 同前。
- **Studio 结果存储（临时、TTL 1h、不落业务库）**：`studioListingResultStore.ts:12`（`STUDIO_LISTING_RESULT_TTL_MS=1h`，root `data/studio-listing-results`，可 `STUDIO_LISTING_RESULT_STORE_ROOT` 覆盖）；`studioImageResultStore.ts:18,183`（root `data/studio-image-results`，owner.json/visitor-{sha256}.json）。结论：Studio「保存草稿」能力缺失，真实结果仅临时文件用于幂等重放。
- **Image 真实 Provider 安全白名单**：`openaiImageClient.ts:13,25-26`（base URL 主机精确白名单 `api.65535.space`，模型白名单 `gpt-image-2`，key 存在性校验 :268-269，错误映射 mapProviderError :171-228）；`openaiImageEditClient.ts:39-106`（参考图 images.edit，复用同 key/base/model）；`studioReferenceImage.ts:18-43`（仅 Image Studio 使用，magic bytes/尺寸/像素/单帧校验）。
- **历史双轨并存不互通**：Prisma `ListingCopyHistory` + `listingCopyHistoryApi`（旧链，owner-only）vs `studioListingResultStore`/`studioImageResultStore`（Studio，临时文件 TTL 1h）。
- 旧 listing 链：`/api/products/listing-copy`（route.ts:369-382 直接 `callAiJson` 真实调用，:346 requireAuthenticated，仅 demoGuard 配额，**无 real AI gate、无 mock/real 开关**；仅 ProductProfitForm 调用）+ ListingCopyHistory（owner-only 历史，listingCopyHistoryStore.ts:9-15 白名单/敏感键过滤）；`listing-pack/ai-generate` real 拒绝（route:198-201）；`listingSnapshotAudit` 写 `logs/listing-snapshot-save.audit.log`（唯一生产调用方 = listing-pack/ai-save）。
- **测试缺口**：`studioListingService.test.ts` 不存在（幂等/配额/账本恢复复杂逻辑缺专项单测；phase2 测试仅覆盖 route/input 层）。

### SellerSprite

- reportType：`search_results`（Product Search）、`category_current`（Category Current）两种；`unknown` 兜底（lib/upstream/sellersprite/reportType.ts:6-7）；判定依据 searchRank 列 vs root/subCategory(+Bsr) 列（:22-59）。
- 字段合同：fields.ts 键清单（asin…subCategoryBsr，:1-20）；必填 asin/productTitle/productUrl（:59-63）；**metricNature 映射**（:32-51）：searchRank/price/rating/reviews/variationCount/BSR=snapshot、estimatedMonthlySales/Revenue=estimate、**身份字段（asin/sku/brand/productTitle/productUrl/parentAsin/seller/rootCategory/subCategory）=unknown**。
- 解析链：precheck → xlsx/previewXlsx → canonical/fields → projections → marketSnapshot（sellersprite-market-snapshot.v3，marketSnapshot.ts:32，含 sourceFileSha256/metricNatureCoverage，productionEffect/productionDatabaseWritten=false 硬编码 :672-673）→ marketSignalRanking（sellersprite-market-signal-ranking.v2，runner.ts:216）；dualReportTypes 测试覆盖表头重叠歧义。
- 导入链：`/api/product-batches`（V3 批次主入口）与旧 `/api/opportunities/sellersprite-import`（停止新入口）；`/api/opportunities/sellersprite-preview` 只读预览 + token（sellerSpritePreviewImportToken/Origin/RateLimit）。
- CLI：`sellersprite:preview` → tools/upstream/sellersprite-preview.ts（authoritative=false、promotionEligible=false、manifestRegistered=false、productionEffect=false、rankingSchemaVersion 等安全旗标，runner.ts:129-234）。
- 样本：仓库内仅脱敏 fixture（lib/upstream/sellersprite/fixtures、tools/upstream/fixtures、sanitized 样本 category-current.sanitized.v1.ts / search-export.sanitized.v1.ts）；真实 XLSX 不入 Git（manifest real_samples_must_not_be_committed=true，真实样本位于 Git 根外材料目录）。
- 缺口：Reverse ASIN、Keyword Mining 无实现（grep 无匹配）。

### real AI gates

- `realAiListingGate.ts`：`OPENAI_LISTING_ENABLED`（owner）+ `OPENAI_LISTING_VISITOR_ENABLED`（visitor）纯 env 开关（:6-13）；调用方仅 `app/api/listing-studio/route.ts`（grep 全库 2 处）。
- `realAiImageGate.ts`：`OPENAI_IMAGE_GENERATION_ENABLED`（owner）+ `OPENAI_IMAGE_VISITOR_ENABLED`（visitor）纯 env 开关（:6-13）；调用方 = image-studio route、image-draft route、aiImageDraftService.ts:255。
- **门禁语义**：两 gate 只做 env 布尔开关，不含 key 存在性检查/配额/错误码；key 与错误分类在 `aiClient.ts`（getAiConfig：missing_api_key/missing_base_url/missing_model，:172-206）；配额在 demoGuard（ensureDemoAiQuota:237、reserveDemoAiCalls:282、consumeDemoAiCalls:587；Studio 走 reserveVisitorStandaloneStudioQuota）。
- 调用方（研究/交接链，只走 callAiJson + demoGuard 配额，不接 realAi gate）：workflows/product-analysis、listing-handoff（generateTaskLinkedAiListing）、image-handoff、image-draft、agents/*、products/*、generate。
- AI 输出安全：summaryRiskGuard（5 级 verdict 硬降级）、alphaSafety、listingClaimEvidenceResolver、englishRendering 等（见 0A 服务端分组）。

### 四态 Decision

- API：`/api/tasks/[id]/research-decision` GET/PATCH（expectedRevision 乐观并发、decisionId/status/reason/nextAction，route.ts:88-117）；**PATCH 只接受研究决定三值，提交旧四态字符串返回 400**（route.ts:88-97）。
- 状态：三值研究决定 → 四态兼容映射（见 0B；无 pending 映射，pending 为未决策默认态，taskResultJsonMutation.ts:180-197 限定 research-decision/legacy-decision 可写兼容列）；UI：研究页（AgentRunClient）与任务详情（TaskRecordDetail）展示与写入。
- 人工确认边界：creative_ready 仅表示可进入创作准备，不代表采购/盈利/合规成立（productResearchDecisionContract.ts:11-15）；manualFactConfirmation 白名单（注：文件头注释写「8 个字段」，实际 MANUAL_FACT_FIELDS 为 17 项，:19-37——文档漂移，登记）。

### 0B/0C 补充发现（子 Agent 交叉核对一致）

1. **任务级真实 AI Listing 不受 `OPENAI_LISTING_ENABLED` 开关控制**：`listingGenerationService.ts:483-496`（copyReady 即调真实 AI）→ `taskLinkedAiListing.ts:157`（callAiJson 直连，无 realAiListingGate 检查）；独立 Studio 路径受开关控制（app/api/listing-studio/route.ts:7）。属门禁不一致，Phase 0 不修，Phase 2/6 裁定。
2. **Reverse ASIN / Keyword Mining 两报告未实现**：reportType.ts:6-7 仅 search_results/category_current；grep 全库无 reverse-asin/keyword-mining。
3. **category_current 未接入候选落库**：`sellerSpriteImportContract.ts:156` 硬编码 `reportType: "SellerSprite Search Results"`（sellersprite_candidate_source_v1）；批次链（ProductBatch）可存 category_current，候选源快照仅支持 Search Results。
4. **旧 listing-copy 链仍活跃且无 gate**：`ProductProfitForm.tsx:650` 调用 `/api/products/listing-copy`（真实 AI、无证据门禁、无站内入口）。
5. **listing-keyword-brief 可追溯字段不完整**：05 合同要求（source/reportType/marketplace/data period/capturedAt/ASIN/evidenceRef）未完整落地（lib/listingHandoff/listingKeywordBrief.ts:27-35 现为 source 简版）。
6. **AgentStatusKey 七态是派生展示态**（components/agentNextStepPanelModel.ts:15-22：needs_review/needs_decision/can_continue/needs_info/rejected/missing_review_state/non_agent），由 DecisionStatus+reviewState 派生，不落库；`/api/tasks` 无 status 列。
7. **主链两分支**：`/opportunities`（ProductBatchManager）= 实时 XLSX 批次链（product-batches API）；旧 opportunities 表单链（OpportunitiesForm）= 死代码，仅经 `sellersprite-preview/import` 与 source-import 保留能力入口。
8. **外部抓取出口 3 处**（0A）：`opportunities/crawl`、`source-import`、`tasks/[id]/visual-reference-import`；前两者无页面调用方。
9. **SellerSprite metricNature：身份字段默认 unknown**（fields.ts:32-51：asin/sku/brand/productTitle/productUrl/parentAsin/seller/rootCategory/subCategory=unknown），仅指标字段为 snapshot/estimate——与 05 合同「能证明同实体才算证据」铁律方向一致，Phase 2 需确认读取模型如何使用这些 unknown 身份字段。
10. **listing-keyword-brief 仅 source+capturedAt**（source 枚举 6 值，listingKeywordBrief.ts:19-34），无 evidenceRef/reportHash/month/data period（05 合同未完整落地）。
11. **manualFactConfirmation 注释与实现不一致**（注释「8 个字段」，实际 17 项，:19-37）——小文档漂移，随代码维护修正。
12. **studioListingService 缺专项单测**（幂等/配额/账本恢复逻辑无 studioListingService.test.ts；phase2 测试仅覆盖 route/input 层）——工程缺口，Phase 2 补测。
13. **Studio 无「保存草稿」能力**（真实结果仅临时文件 TTL 1h，用于幂等重放）；历史双轨（Prisma ListingCopyHistory vs studio resultStore）不互通。

## 盘点疑点汇总（供 decisions 裁定）

1. 已迁移但未下线的旧 AI 入口：`/api/generate`、`/api/agents/*` 仍真实调用 AI 且消耗配额，页面已全部迁移/占位 → 配额/审计盲区。
2. `/api/radar/*` dev-only；`save` 仅 owner 写 `.local/radar-research`。
3. `listing-pack/ai-generate` real 模式被显式拒绝（route:198-201），真实 Listing 统一走 listing-handoff 链。
4. 外部抓取出口仅 3 处：`opportunities/crawl`、`source-import`、`tasks/[id]/visual-reference-import`。
5. `listing-copy-history` owner-only。
6. `studioImageResultStore/studioListingResultStore` 无独立查询入口（生成落库但无读取路由）。
7. `/api/radar/save`、`/api/ai/*`、`/api/health` 无 UI 依赖，属运维/测试通道。
