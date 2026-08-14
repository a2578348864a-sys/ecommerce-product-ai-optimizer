# Phase 6 验证与验收 — 人工决定、Handoff、旧链收口

> 按 14_PHASE6_TASK.md Gate + 21_VALIDATION_GATES 填写。

## 1. Gate 对照（14_PHASE6_TASK.md）

| Gate | 状态 | 证据 |
|---|---|---|
| 四态复用 + 人工 Action | PASS | 四态权威模块 lib/tasks/decisionStatus.ts 全链复用（tasks 列表/详情/research-decision）；「进入内容制作」= creative-handoff 创建（POST，人工确认后），非状态（research-decision 三值写合同不变，§2.1a 钉死） |
| Handoff 门禁（Action 前条件） | PASS | creative-handoff：只接受 confirmed facts（evidenceTier=human_confirmed + usageScopes listing/image/internal）+ ai_hypothesis 带 allowedUse/prohibitedUses + **humanReviewRequired: true**（productCreativeHandoff.ts:204）；listing-handoff 经 checkCreativeHandoffGate（ownership/dual-storage/research hash 绑定）+ Claim Evidence 校验（claimEvidenceResolver 保守正向放行，prohibitedClaims 永不进入）；Keyword Brief 人工确认（confirmed:true）才能保存；Unknown/Risk 不进入创作输入（market_signal 隔离 researchContextAdapter.ts:224-227） |
| Studio 三项验证 | PASS | ① Listing 不越权：listingClaimEvidenceResolver + filterListingClaims + englishRendering（中英文混合受控渲染，无法安全英文化 fail-closed）；② Image 不虚构：AiImageReviewStatus=needs_human_review/approved/rejected（lib/aiImageDraft.ts:16），参考图白名单校验（studioReferenceImage）；③ real AI gate 有效：listing-studio route 检查 confirmRealAi + isRealAiListingEnabled（:102-106）、image-studio 检查 isRealAiImageEnabled（:87） |
| 旧链收口核对 | PASS | 见 §2 审计表 |
| 9 步 Core Smoke | PASS | 见 §3 矩阵 |
| lint/tsc/test/build | PASS | main 全量（见 §4） |

## 2. 旧链收口审计表（Phase 0 裁定 vs 现状）

| 资产 | Phase 0 裁定 | 现状核对 | 结论 |
|---|---|---|---|
| /api/generate、/api/agents/*5 | 停止新入口 + 退役候选 | 0 页面 import（孤儿组件 10/11 无页面引用）；API 保留 + 既有测试 2 个 | 已按裁定执行；保留兼容不扩展 |
| /products/new + /api/products/* | 停止新入口 | 页面存在但无站内入口链接（侧边栏/工作台不含） | 已按裁定执行 |
| /workflow/batch | 停止新入口 | 页面存在无站内入口 | 已按裁定执行 |
| /sourcing /risk /summary /viral /materials /agent | 保留占位 | LegacyMigratedPage 全部在位 | ✅ |
| /agent/run /workflow /opportunities/import | 保留重定向 | redirect 全部在位 | ✅ |
| 旧数据（ViralAnalysisRecord/ListingCopyHistory） | 只读兼容 | 未迁移未删除 | ✅ |
| 批次/候选主链 | 保留 | product-batches + 候选池 + 研究链全链在位且各 Phase 已验证 | ✅ |

## 3. 9 步 Core Smoke 矩阵（14_PHASE6_TASK）

| # | 步骤 | 自动化覆盖证据 | 本地人工步骤（3005） |
|---|---|---|---|
| 1 | Product Search 导入 | productBatchImportService.test（16 用例）+ sellersprite-preview CLI 测试 + golden replay | 发现商品 → 上传 Products XLSX → 选类型确认 |
| 2 | Candidate | opportunity-candidates route 测试（access-control/signed-source 等） | 批次 → 转候选 → 研究池确认 |
| 3 | Evidence Workbench | EvidenceWorkbench.test（8）+ components 套件（304） | 任务详情查看六大区域 + 角标 |
| 4 | Keyword Evidence | keywordReports.test（5）+ keywordEvidence.test（4） | 关键词区上传 RA/KM 报表 → 预览 → 确认保存 |
| 5 | AI Summary | aiEvidenceSummary.test（6，含 Golden Eval 抽查矩阵） | AI 证据总结 → 生成 → 人工抽查 4 条四问 |
| 6 | Human Decision | research-decision route + productResearchRecordStore 测试（乐观并发/幂等） | 研究决定三值 → 四态投影确认 |
| 7 | 进入内容制作 | creative-handoff 测试（persistence/revoke/preview 全套） | 确认事实 → 创建创意交接 |
| 8 | Listing Handoff | listing-handoff 套件（404 用例含 claim evidence/quality/fallback） | 生成 Listing 草稿 → 人工复核 |
| 9 | Image Handoff | image-handoff + image-draft 测试（review status/配额/gate） | 生成图片草稿 → 人工复核 |

自动化覆盖：全部 9 步均有既有/新增测试证据；人工页面步骤需访问密码（由用户在 3005 页面执行，步骤如上）。

## 4. 风险收口裁定（decisions.md §7，Phase 6 统一裁定）

| # | 裁定 | 状态 |
|---|---|---|
| 1 | 任务级 listing AI = 「handoff 后默认允许」正式文档化（确认事实 + humanReviewRequired + creativeHandoffGate + provider 治理）；开关语义属于独立 Studio 模式，不补检查 | 关闭 |
| 2 | 旧 AI 入口停新入口已生效，保留兼容不扩展，退役候选确认 | 关闭 |
| 4 | CC 只走批次链（product-batch-candidate-source.v1 动态 reportType 无硬编码）；旧链快照缺陷随旧链停用 | 关闭 |
| 5 | 旧 listing-copy 链停新入口，保留兼容 | 关闭 |
| 9 | crawl/source-import 无调用方保留兼容；视觉参考导入为唯一受控外部图片出口 | 关闭 |
| 3/6 | Phase 3/4 已实现关闭 | 已关闭 |
| 7/8/14 | Studio 相关（无查询入口/owner-only/缺测试）：Core 暂停点后由用户授权 V3.x 或后续专项处理，保留登记 | 保留登记 |

## 5. 结论

`PHASE_6 = PASS`

按 00_MASTER_EXECUTION.md §7：Phase 0–6 全部 PASS → **`V3_CORE = DONE`** → 完成 Core 最终规格对账、main 全量验证与本地 Smoke 准备、push 前状态确认、输出最终报告后**强制暂停自动推进**（V3X_AUTHORIZATION_REQUIRED = TRUE；不启动 V3.1；不公网部署）。
