# Phase 0 阶段学习（learnings.md）

> 依据 22_CHANGE_PACKAGE_AND_LEARNING.md：只沉淀有代码/测试/真实样本证据支持的条目，禁止泛泛而谈。

1. **原假设**：V3 的「四态人工决定」在仓库里需要新建。
   **实测**：`lib/tasks/decisionStatus.ts` 已存在权威四态（pending/continue/need_info/rejected，含 normalize 与文案），且 `/api/tasks` 列表、`homeDashboardSummary`、`productResearchPresentation` 等已统一消费。
   **最终规则**：V3 四态权威定义已落地，Phase 1/2 直接复用，不新建状态枚举。
   **证据**：lib/tasks/decisionStatus.ts:1-66；app/api/tasks/route.ts:162,256,281。
   **失效条件**：出现与四态冲突的新状态需求。
   **下一阶段加载**：Phase 1/2 均需。

2. **原假设**：研究决定状态（creative_ready/needs_information/abandoned）是第三套需废弃的状态。
   **实测**：它是有 actor/revision/reason/nextAction 的版本化研究决定（product-research-record.v1），并通过 `productResearchDecisionToCompatibilityStatus` 显式映射到四态（creative_ready→continue、needs_information→need_info、abandoned→rejected）。
   **最终规则**：保留研究层三值记录，兼容层统一四态；禁止 UI 直接暴露未映射状态。
   **证据**：lib/productResearchDecisionContract.ts:1-36；lib/productResearchRecord.ts:560-566；lib/server/productResearchRecordStore.ts:300-312。
   **失效条件**：产品决定模型变化。
   **下一阶段加载**：Phase 2（研究页决定 UI）。

3. **原假设**：Candidate.score 是选品推荐依据。
   **实测**：score 由导入/旧链写入（radarScore.final、workflowScoreFromRiskLevel、PATCH），池列表按 score desc 排序展示；但研究链（research-decision + Evidence）不读取 score 做决定。
   **最终规则**：score 保留兼容展示与排序，V3 新决策链不得把 score 当「值得继续」权威依据（04 默认裁定）。
   **证据**：lib/server/opportunityCandidateService.ts:408-409,466；app/api/workflows/product-analysis/save-task/route.ts:274,390；app/api/opportunities/source-import/route.ts:178-190。
   **失效条件**：产品要求 score 参与推荐。
   **下一阶段加载**：Phase 2（Workbench 展示需标注参考分）。

4. **原假设**：旧链（/api/generate、/api/agents/*、/api/products/*、/api/opportunities/*、/workflow/batch、/products/new）已被删除。
   **实测**：页面已迁移/重定向（LegacyMigratedPage、redirect），但 API 全部仍在线，其中 /api/generate 与 /api/agents/*（5 个）仍真实调用 AI 并消耗配额，且无任何页面调用方（孤儿组件仍引用）。
   **最终规则**：旧链 = 停止新入口 + 退役候选，统一 Phase 6 收口；Phase 1/2 不得为旧链扩展；旧 AI 入口是配额/审计盲区，需在 Phase 6 前持续关注。
   **证据**：app/sourcing/page.tsx:4-9（LegacyMigratedPage）；app/agent/run/page.tsx:27-43（redirect）；app/api/agents/risk/route.ts（真实 AI）；components/cross-border/RiskCheckForm.tsx:161（孤儿调用方）；components/agent/AgentRunClient.tsx:934（新链调用）。
   **失效条件**：用户授权重新启用旧链。
   **下一阶段加载**：Phase 6。

5. **原假设**：SellerSprite 正式支持三报告（Product Search/Reverse ASIN/Keyword Mining）。
   **实测**：当前 reportType 只支持 `search_results` 与 `category_current` 两种（lib/upstream/sellersprite/reportType.ts:6-7），Reverse ASIN 与 Keyword Mining 尚无解析实现。
   **最终规则**：V3 Core 三报告冻结 ≠ 现状三报告；Phase 3/4 才补 Reverse ASIN/Keyword Mining，Phase 1 只稳定 search_results/category_current。
   **证据**：lib/upstream/sellersprite/reportType.ts:6-7；lib/upstream/sellersprite/dualReportTypes.test.ts。
   **失效条件**：新报告类型实现。
   **下一阶段加载**：Phase 1/3/4。

6. **原假设**：任务数据统一在 Prisma。
   **实测**：Owner 任务在 Prisma `ViralAnalysisRecord`，Visitor 任务在 `data/demo-sandbox.json`（sandbox tasks），`/api/tasks` 按主体双读；resultJson 由 `taskResultJsonMutation` 按 writer→namespace 所有权契约写入。
   **最终规则**：数据落点双轨是既有架构，V3 复用不合并；任何 resultJson 写入必须走 namespace 契约。
   **证据**：app/api/tasks/route.ts:267-321（demo 分支读 sandbox，owner 分支读 Prisma）；lib/server/demoSandbox.ts:89-93；lib/server/taskResultJsonMutation.ts:20-41。
   **失效条件**：数据架构变更。
   **下一阶段加载**：Phase 2。

7. **原假设**：V3 需要新建 Evidence 表。
   **实测**：05_EVIDENCE_CONTRACT 门槛（两类稳定外部证据 + JSON 影响查询）当前未达到；已有 researchRecord/candidateAnalysisContext/creativeHandoff/listingKeywordBrief 等版本化 JSON 合同承载证据，productResearchPublicDto 已含 missingData/conflicts/estimates 结构。
   **最终规则**：V3 Core 不新建万能 Evidence Prisma 表；Phase 2 只做 Evidence Read Model（JSON 读取侧）+ provenance 增强（30 文档）。
   **证据**：lib/productResearchPublicDto.ts:277-361；lib/server/candidateAnalysisContext.ts:38-62；docs/architecture/data-model.md:23-32。
   **失效条件**：证据数据规模达到门槛。
   **下一阶段加载**：Phase 2。

8. **原假设**：浏览器证据是 V3 Core 范围。
   **实测**：tools/collectors/amazon（human-assisted CLI、browser-control、live-canary、page-diagnostics）已存在，属 V3.x Spike 的既有资产；manifest `v3x_auto_start=false` 且未授权前禁止装新浏览器依赖。
   **最终规则**：V3 Core 不扩展浏览器资产；Phase 0 只登记；V3.1 授权后从既有资产开始 Spike。
   **证据**：tools/collectors/amazon/README.md；manifest.json:37-38；00_MASTER_EXECUTION.md:115-123。
   **失效条件**：用户授权 V3.1。
   **下一阶段加载**：V3.1。

9. **原假设**：业务 Skill 资产为零。
   **实测**：`skills/sellersprite-market-preview`（v1）已存在且冻结：只编排 sellersprite:preview CLI、authoritative=false 安全旗标、参数硬门禁；另有 .agents/skills 桥接文件。
   **最终规则**：这是 V3 业务方法层第 1 个已验收 Skill；V3 Skill 总数上限 4（商品研究/关键词/VOC/货源），新增必须经真实业务验证。
   **证据**：skills/sellersprite-market-preview/SKILL.md:1-176；06_BUSINESS_SKILL_CONTRACT.md:80-89。
   **失效条件**：Skill 合同变更。
   **下一阶段加载**：Phase 2（读模型时参考其门禁风格）。

10. **原假设**：Phase 1/2 并行无文件重叠。
    **实测**：重叠风险集中在 `app/api/workflows/product-analysis/save-task/route.ts`（写 researchRecord，Phase 2 若扩展写入会与 Phase 1 无关但与自身版本相关）；sellerSprite preview 服务（lib/server/sellerSpritePreview*）若 Phase 1 改造会触碰 server 层。
    **最终规则**：Phase 1 边界 = lib/upstream/sellersprite + tools/upstream/sellersprite-preview + 测试；Phase 2 边界 = 读取模型 + 研究页/任务详情展示；save-task 与 preview 服务列为显式重叠文件，修改需串行确认。
    **证据**：app/api/workflows/product-analysis/save-task/route.ts:60-71；lib/server/sellerSpritePreviewOrigin.ts、sellerSpritePreviewImportToken.ts。
    **失效条件**：Phase 任务书调整。
    **下一阶段加载**：Phase 1/2 任务书。

## 下一阶段是否需要加载

全部 10 条中，1/2/3/6/7 对 Phase 2 必载；5/10 对 Phase 1 必载；4 对 Phase 6 必载；8 对 V3.1 必载；9 持续。
