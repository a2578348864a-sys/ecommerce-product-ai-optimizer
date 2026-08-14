# Phase 2 第一步 — Evidence Read Model（每个区域从哪里读）

> 11_PHASE2_TASK.md 强制要求：不新增外部数据源，先把已有数据统一成 Evidence Workbench。
> 本文件定义「商品研究详情页 Evidence 各区域」的权威读取源；不新建万能 Evidence 表（05 合同门槛未达），
> 全部读取现有 versioned JSON / 投影 / 批次数据。数据性质四档：snapshot / estimate / derived / unknown（05 合同）。

## 0. 读取总则

- **事实主体**：`candidate-analysis-context-v1`（lib/server/candidateAnalysisContext.ts:38-107）与 `decisionEvidence`（lib/decisionEvidence.ts）——研究事实/评估/缺口/冲突的权威承载。
- **研究运行绑定**：`product-research-record.v1`（lib/productResearchRecord.ts:65-76）——researchHash/contextHash/candidateId/runId 哈希链，作为「这些证据属于哪个研究运行」的证明；record 本身不含事实字段（Phase 0 正式风险 #11，本 Phase 明确：读取模型以 context + decisionEvidence 为事实源，record 只做绑定校验）。
- **任务承载**：`taskResultJson` 命名空间（taskResultJsonMutation.ts:31-41 所有权契约）——researchRecord/creativeHandoff/listingKeywordBrief/productLifecycle/competitorEvidence 等。
- **批次侧**（候选来自批次时）：ProductBatchItem.normalizedProductJson + ProductBatch（reportType/sourceFileName/sourceFileSha256）。
- **展示投影**：浏览器侧一律经 `productResearchPublicDto`（lib/productResearchPublicDto.ts）类安全投影；不直接读完整 resultJson 到 UI（现有契约）。

## 1. 商品概览区域

| 字段 | 读取源 | metricNature | 备注 |
|---|---|---|---|
| image | candidateAnalysisContext.facts 图片快照（productResearchImage / product-batch-product-image） | snapshot | 缺失显示占位 |
| asin | context.facts.asin / sourceSnapshot.identity.asin（sellersprite_candidate_source_v1） | unknown（身份字段，fields.ts:33） | 身份显示不属于 estimate |
| title | context.facts.title | unknown | — |
| brand | context.facts.brand | unknown | — |
| category | context.facts.category（rootCategory） | unknown | 类目路径可展开 |
| price | context.facts.priceUsd | snapshot | 单位 USD |
| rating | context.facts.rating | snapshot | 0-5 |
| review | context.facts.reviewCount | snapshot | — |
| bsr | context.facts.rootCategoryBsr/subCategoryBsr | snapshot | CC 报表语义；PS 报表缺失时 unknown |
| estimated sales/revenue | context.facts.estimatedMonthlySales / estimatedMonthlyRevenueUsd | **estimate** | UI 必须标注「第三方估算」 |
| source | sourceSnapshot.source（provider/reportType/marketplace）+ ProductBatch.sourceFileName（批次侧） | — | 可展开 sourceRef |
| capturedAt | sourceSnapshot.capturedAt ?? 批次 importedAt；**dataPeriod/observedAt**（30 增强：SellerSprite 报表是数据期口径，capturedAt 是采集上下文，不得混淆） | — | Phase 2 投影至少展示 capturedAt；dataPeriod 语义见 §7 |

## 2. 市场 Evidence 区域

- **读取源**：SellerSprite 市场快照与排名（批次侧）：
  - `sellersprite-market-snapshot.v3`（marketSnapshot.ts:32，含 fieldCoverage/metricNatureCoverage/sourceFileSha256）
  - `sellersprite-market-signal-ranking.v2` 排名结果（marketSignalRanking.ts，signalScore 用于排名；conditionalSignalScore 标注 diagnostic_only_not_used_for_ranking，sellerSpriteOpportunityPreview.ts:134）
  - ProductBatchItem.rankingJson / occurrenceProjectionJson / familyProjectionJson（批次详情）
- **展示**：品牌集中度、卖家集中度、价格带、信号 Top3 与正反依据、证据覆盖度；所有数字带 metricNature 角标（snapshot/estimate）。
- **不得**：把 conditionalSignalScore 当排名依据；把市场信号当作商品事实（researchContextAdapter.ts:224-227 隔离已存在）。

## 3. 竞品 Evidence 区域（新写入需冻结最小合同）

- **读取源**：`taskResultJson.competitorEvidence` 命名空间（新，合同见 docs/v3/changes/phase-2/competitor-evidence-contract.md）。
- **展示**：人工维护 3–5 个竞品 ASIN 列表（asin/sourceKind=manual/addedAt/note）；空列表显示「未维护」。
- **禁止**：做成第四套 Candidate/Task 系统；AI 自动写入竞品。

## 4. 关键词 Evidence 区域

- **读取源**：现有 `listing-keyword-brief.v1`（listingKeywordBrief namespace，lib/listingHandoff/listingKeywordBrief.ts:27-34）。
- **展示**：primaryKeyword / supportingKeywords / backendSearchTerms / source / capturedAt——**先展示现有 Brief，不扩展**（正式风险 #6 追溯增强留 Phase 3）。

## 5. 货源 Evidence 区域

- **Core 阶段允许为空**：显示「货源证据未收集」（采购价/MOQ/logistics/compliance 全部 unknown）。
- 展示研究流程中的 sourcing 步骤输出（若有）：feasibility/searchKeywords/moqEstimate/nextSteps——但标注为 AI 建议（ai_hypothesis 级），不是确认事实。

## 6. Missing 区域（不用 AI 填空）

| 项 | 状态 |
|---|---|
| 采购价 | unknown（明确展示，禁止 AI 猜测） |
| MOQ | unknown |
| logistics | unknown |
| compliance | unknown |
| 其余缺失 | 来自 decisionEvidence.missingData / researchRecord 的缺失证据清单（evidenceGaps） |

- 展示「还缺什么 + 下一步建议补什么」（Novice Comprehension 约束的「下一步最值得补什么证据」）；建议文本只允许来自 AI 建议层（ai_hypothesis）或人工 note，**不得呈现为事实**。

## 7. Provenance 最小字段（30 增强 Phase 2，投影层）

关键指标（价格/评分/BSR/销量）展示时至少可追到：

- sourceType（SellerSprite / manual / …）
- reportType（search_results / category_current）
- artifactHash / sourceHash（ProductBatch.sourceFileSha256 / snapshotHash）
- rowRef（ProductBatchItem.ordinal / 行号，适用时）
- sourceField / sourceColumn（fields.ts 字段 ↔ 原始表头）
- parserVersion（precheck schemaVersion / collector 版本）
- entityKey（asin）
- capturedAt（采集上下文）与 dataPeriod / observedAt（数据期口径，至少二选一表达；**不得混淆**——SellerSprite 报表表示"某月数据"，capturedAt 是导入时刻）
- sourceRef / evidenceRef（已有：researchHash/contextHash/creativeHandoff sourceRef；缺失处标 unknown，不伪造）

数据落点：现有 versioned JSON（researchRecord/context/snapshot/rankingJson）；**禁止新建 Prisma Evidence 表**；禁止为 provenance 引入重型平台。

## 8. 信息层级（Novice Comprehension 约束，Phase 2 部分）

商品研究详情页默认优先让普通用户看懂：

1. **简明结论层（首屏）**：目前知道什么 / 不知道什么 / 支持信号 / 风险与冲突 / 下一步最值得补什么证据（直接可读语言，不要求先懂 BSR/SPR）
2. **为什么这么说层**：关键判断的依据摘要（fact/estimate 区分、主要风险理由）
3. **原始 Evidence 层**：专业指标可展开（来源、时间、EvidenceRef、数据性质、原始值）

- score 展示（正式风险 #15）：候选池/详情中的 OpportunityCandidate.score 必须标注「参考/旧兼容排序信号」，**不得作为首屏权威决策信号**；首屏决策信息以研究决定（creative_ready/needs_information/abandoned → 四态）与 Evidence 为准。
- 验收：Novice Comprehension Gate（seed README）——假设用户不懂专业概念，仅看首屏/摘要能说清：①知道什么 ②不知道什么 ③最大风险 ④为什么 ⑤下一步研究什么。

## 9. 不改动清单（Phase 2 边界）

- 不新增外部数据源；不新建 Prisma 表；不新增 AI 调用；不改 research-decision 写合同（决策语义钉死 §2.1a）；不触碰 lib/upstream/sellersprite 解析链（Phase 1 已稳定）；不改共享文件（package.json/AGENTS.md 等）。
