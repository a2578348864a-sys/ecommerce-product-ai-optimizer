# LISTING_PLAN_V2 PROGRESS

## 任务0：冻结与诊断（≤10行）
- 基线：branch=feature/v4.1-ui-productization；HEAD=ccdb7e79…；staged=0；dirty -uall=68；3005 pid=24960 health=200；dev.db SHA=2203f5d6… mtime=2026-08-25T16:39:31.410Z（只读记录）。
- 现存草稿（复审已证）：draftKind=structured_listing_draft；providerAttempted=true、providerSucceeded=false；keywordPlanSource=manual；usedKeywordTrace=[]。
- 诊断①成立：composeOptimizedBullets(input, plan) 收 plan 但直接 return composeBullets(input)（listingComposition.ts:356-359）→ 计划完全未被五点消费（仅 title 用 primaryKeyword）。
- 诊断②：截图关键词非空=bento box for kids/lunch box kids/kids lunch box/thermos（当前草稿有值），usedKeywordTrace 空属「非 AI 成功路径不填充」（providerSucceeded=false 时 trace 语义为无 AI 优化）；不是读取丢失、不是无 Brief（keywordPlanSource=manual）。
- 诊断③：当前四点来自 Runtime 安全模板（option fits/cleaning/pairs with/keeps…）——mechanic 句式确凿。
- 结论：核心判断成立（plan 未真实驱动生成），继续实现；顺序：Plan v2 → Composition 消费 → 页面展示 → TDD 反向 → 浏览器闭环。
- 最大风险：break v1 兼容（旧数据/既有测试）；VOC/竞品泄漏为事实；plan 被「消费但无差异」（假消费）。


## 进展（第1轮）
- Task1 完成：listingPlan.ts v2（role×5/shopperNeed/claimMode/cannotSay/status；VOC→shopperNeed 不成为事实；identity 不充当卖点事实；cannotSay 默认含 leakproof/12小时/BPA-free/FDA/guaranteed/100%；status=ready/needs_facts/needs_keywords/needs_review）。红→绿：listingPlan.test.ts 6红1过→7/7。
- Task2 完成：composeOptimizedBullets 按 plan.bulletPlans 逐条生帧（V2_ROLE_FRAMES×5 角色异句）+ 每帧锚定确认事实 + 至多1计划关键词 + 高风险值过滤；<3条纯回退旧安全模板（不混合防重复）。composeOptimizedListingDraft 消费变更实测：plan 顺序翻转→五点顺序变化（红→绿）。listingComposition.test.ts 15/15；v2214Closure/listingMainChain.r16/listingComposition.r15/taskLinkedAiListing.integration/listingQuality 65/65。
- taskLinkedAiListing prompt 传入有界 plan v2（role/shopperNeed/claimMode/cannotSay/status）。
- Task3 进行中：ListingHandoffSection 新增 ListingSellingPointStrategy 紧凑卡片（买家关心/准备表达/使用事实/关键词/需确认/不能写）+ 草稿类型标签（安全事实草稿不是运营优化版 / 已按卖点策略生成运营优化稿）；null 显示"这份历史草稿没有保存卖点策略"。

## 第1轮完成证据
- **行为测试（TDD 红→绿）**：listingPlan.test.ts 6红→7/7；composition v2 消费测试 3红→15/15；plan 顺序翻转→五点变化（红证明）；每条 bullet 唯一映射 bulletPlan 并锚定事实；needs_keywords 仍产安全草稿。
- **反向验证**：A（composeOptimizedBullets 忽略 plan→composition 消费测试红）✓ 红→绿；B（service irrelevant 过滤 bypass→v2214Closure 反向验证② 1 failed/9 passed）✓ 红→绿（逐字节恢复，temp 0 残留）。
- **真实浏览器闭环（3029 隔离 v2 db，Provider 关闭，普通 Chrome/CDP）**：
  - 卡点：idempotent replay 与 Prisma updatedAt 存储格式（ms number）；在隔离 v2 副本 db 清除 binding/snapshot 并修正 updatedAt=ms 格式 → 真实非重放生成。
  - POST 200；draftKind=structured_listing_draft；listingUnqualified=false；rejectedListingSentences=[]；**5 条正式 bullets 全部计划驱动**（core_outcome/use_scenario/ease_of_use/proof_or_fit/pain_relief 各一条，角色不同、锚定确认事实）。
  - **sellingPointPlan 5 条**（role/shopperNeed(VOC)/shopperAngle/factLabels/keywordIds/claimMode/cannotSay）随响应返回并渲染于页面「卖点策略」区（DOM 断言 hasSelling=True）。
  - 刷新保持 ✓；console 0 error（干净 tab）；1440 与 390 均无横滚（sw<=iw）；截图 verify-v2-desktop-1440.png / verify-v2-mobile-390.png（%TEMP%\research-listing-commit）。
  - 关键词：keywords 4 个（有效 brief）非空；主词仅标题一次；正文不内嵌关键词词面（Claim-Safety 有意识选择，取 0 最稳）。
  - 无 FUNTAINER Kids THERMOS / THERMOS THERMOS；cannotSay 含 leakproof/12 hours/BPA-free 等；rejected 不进正式字段。
- **质量门**：listingHandoff 30 文件 487/487（0 fail 0 skip）；tsc 0；改动文件 ESLint 0；git diff --check clean；npm run build OK。
- **门禁零放宽**：listingClaimEvidenceResolver/listingReadiness/listingGenerationInput/prisma schema 未修改。
- **状态**：HEAD=ccdb7e7（未变）；staged 空；dirty 77（68 既有 + 9 白名单新文件；无白名单外新增）；3005 未停；原 dev.db 未写（仅隔离 v2 副本）。


## 第2轮（最终轮）完成证据
- **AI 成功路径绑定计划**：listingGenerationService 新增唯一 aiBulletsBindToPlan（plan.status=ready；bullets 数与 bulletPlans 一致；bullet i 命中 plan i 确认事实；不含 cannotSay 词面）。AI 成功只有全部门禁 + 绑定通过才 ai_optimized；claim 硬失败保持 providerSucceeded=false（R3 契约），仅绑定拒绝而调用成功时 providerSucceeded=true（状态诚实）。
- **主链行为测试（taskLinkedAiListing.integration）**：P1 计划对齐→ai_optimized+s ellingPointPlan 快照；P2 调换顺序→不得 ai_optimized；P3 cannotSay(12 hours)→拦截且正式字段不含；P4 needs_keywords→不得 ai_optimized。24/24 绿。
- **关键词"计划/实际"分离**：sellingPointPlan 只展示计划关键词；usedKeywordTrace 改为 deriveActualKeywordTrace（文本真实出现+来自有效方案）；安全事实组合词（材质/容量+类型）可自然进入标题与 Keywords 且过 Claim Evidence；类目词（bento box）不进入正文（单测断言）。keywords 6 个（4 brief + 2 fact-safe）。
- **三态 UI DOM 测试（ListingGenerationBasis.dom.test.ts 12/12）**：历史空态"这份历史草稿没有保存卖点策略"；计划卡（买家关心/准备表达/使用事实/关键词/不能写）；draftKindLabel 三态标签（ai=已按卖点策略生成运营优化稿；structured/safe=安全事实草稿不是运营优化版）；无内部 id/hash/runId。
- **反向验证 3 项**：R1 去掉绑定→P2/P3/P4 红（3 failed）；R2 去掉 status 门控→P4 红；R3 标签改回→DOM 标签测试红。均逐字节恢复+复绿，temp 0 残留。
- **隔离浏览器闭环（3029 + Provider 关闭 + 普通 Chrome/CDP）**：POST 200 非重放；draftKind=structured；5 条计划驱动 bullets（core_outcome/use_scenario/ease_of_use/proof_or_fit/pain_relief 各异、8-30 词、事实锚定）；sellingPointPlan 5 卡片（DOM hasSelling=True）；keywords 6 去重（主词标题一次）；usedKeywordTrace 4 实际采用；无 FUNTAINER Kids THERMOS/THERMOS THERMOS；cannotSay 含 leakproof/12 hours/BPA-free；1440/390 无横滚；干净 tab console 0 error；刷新保持；截图 final-v2-desktop.png / final-v2-mobile.png。
- **质量门**：listingHandoff 30 文件 489/489（0 fail 0 skip，>487）；tsc 0；eslint（11 文件）0；git diff --check clean；npm run build OK；全量 npm run test 8 failed/6259 passed/89 skipped——其中 6 个既有环境/未提交功能失敗（同 Round-1 复审结论：native1688Bridge + phase3ResearchHistory/productUiPolish/WorkspaceSidebar.v4nav/navigationAudit/CreativeHandoffPanel），新增 2 个为 **白名单外文件**（taskLinkedAiListing.factRef.test.ts、yetiGoldenCase.test.ts）——其 AI 注入夹具为旧 5-bullet 语义，不符合 ListingPlan.v2 严格绑定/结构化升级后的预期；按本任务书「仅允许修改白名单文件」不得修改，列为遗留并给出最小修复建议（对齐夹具为计划绑定输出或将绑定要求写为可选模式），非本轮缺陷。
- **状态**：HEAD=ccdb7e7（未变）；staged 空；dirty 77（68 既有 + 9 白名单，无新增）；3029 已停；3005 未动；原 dev.db 未写；0 commit/push/deploy。

## 第3轮（P1-1/P1-2 修复，独立复审通过后执行）完成证据
- **P1-1 关键词三态诚实化**：ListingGenerationService 新增 `deriveKeywordAdoptionTrace`（导出供测试）：
  - `usedKeywordTrace` 只扫描最终 title/bullets/description（不再并入 keywords/搜索词字段），词须来自有效方案（plan.primaryKeyword + supportingKeywords + backendSearchTerms，大小写不敏感、保序去重、有界 20）；
  - 新增 `searchOnlyKeywordTrace`（公开 DTO：仅进入最终 keywords/backendSearchTerms 且未进入正文的方案词；与 used 互斥）；
  - 旧快照无该字段 → 保持 undefined（不伪造）；公开 DTO 的 trace 项不含 keywordId/factId/field/hash/runId。
  - UI：ListingGenerationBasis 两组中文标题「标题和正文实际采用的关键词」/「仅用于搜索词，未进入正文」；空态诚实（仅搜索词组不冒充正文采用）。
- **P1-2 两个旧测试对齐新合同**：
  - taskLinkedAiListing.factRef.test.ts：注入式 Provider 夹具改为 ListingPlan.v2 对齐（3 bullets=3 bulletPlans，逐条命中功能性/清洁/材质事实、8-30 词、无 cannotSay/未确认内容；usedFactIds=[functional_feature,care,material]）；强断言 providerAttempted=true、providerSucceeded=true、draftKind=ai_optimized_listing、fallbackApplied=false、正式字段无未确认内容、公开 DTO 无内部 id；新增「调换任意两条事实顺序 → 绑定门拦截 → 回退」用例（4/4）。
  - yetiGoldenCase.test.ts：固定夹具改为唯一确定结果 structured_listing_draft（禁止 safe/structured 二选一）：listingUnqualified=false、fallbackApplied=true、providerAttempted/Succeeded=true、3-5 条正式五点（8-30 词、逐条确认事实锚点）、rejectedListingSentences=[]、正式字段无 12 ounces/leakproof/BPA/FDA/认证/性能时长、usedKeywordTrace=[]、searchOnlyKeywordTrace=3 个后台词（与关键词字段分离）、sellingPointPlan 与五点一一对应（3/3）。
- **红→绿证明**：三个红→绿均真实执行：RV1（searchFieldTexts 并入 body 语料 → 关键词 trace 用例 5 failed）→ 恢复 → 绿；RV2（factRef Provider bullets 错序 → AI 成功强断言 1 failed）→ 恢复 → 绿；RV3（YETI 期望改回 safe_fact_draft → 1 failed）→ 恢复 → 绿；临时改动全部逐字节恢复（byte-compare all=true）。
- **套件**：8 文件核心 92/92；listingHandoff+server+DOM 34 文件 541/541（>489，含新增用例，0 新增 skip）；tsc 0；eslint（6 文件）0；git diff --check clean；npm run build OK（BUILD_ID LJcQKZ3Y8xzwT8x_AAqUY，bundle 含新 UI 串）。
- **真实 3029 隔离浏览器闭环（独立服务，Provider 空 key + 死端口 59999；普通 Chrome/CDP）**：
  - 隔离实例：Desktop/qingxuan-smoke/v2fix2-listingplan-2026-08-26（dev.db 副本 + demo-access 副本；原 dev.db 未写）；启动：node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3029 + DATABASE_URL/DEMO_SANDBOX_STORE_PATH/DEMO_ACCESS_STORE_PATH/QX_RUNTIME_MODE=local_owner；PID 3360；health {"ok":true}；隔离库 dev.db mtime 21:24:10.834Z → 21:24:36.990Z（写入）。
  - POST 非重放（idempotentReplay=false）：draftKind=structured_listing_draft；5 条计划驱动 bullets；keywordPlanSource=manual；**keywords=["bento box for kids","lunch box kids","kids lunch box","thermos","Stainless Steel THERMOS","10oz THERMOS"]；usedKeywordTrace=["thermos"]；searchOnlyKeywordTrace=["bento box for kids","lunch box kids","kids lunch box"]**（bento/lunch 仅搜索字段未进正文；thermos 正文标题采用）——P1-1 线上成立。
  - 浏览器（CDP Emulation 1440×900 & 390×844）：两组中文标题均渲染；used 组仅 thermos、so 组仅 bento/lunch/kids lunch（PRECISE 边界检查 usedRegion="thermos"）；5 张卖点策略卡 + 5 条正式五点 + 正式字段无被拒内容；刷新后 GET 持久（used=["thermos"]/searchOnly=3 词不变）；1440 sw=1781≤iw=1800、390 sw=390≤iw=390 无横滚；console 0 error/0 warning；EXTERNAL_REQ=[]；截图 verify-fix-1440-keywords.png / verify-fix-390.png。
  - 结束：3029 已停（kill + port free）；3005 PID 24960 health 200 未动；原 dev.db SHA 2203f5d63f5eb940/mtime 2026-08-25T16:39:31.410Z 未变；data/demo-sandbox.json 未变。
- **状态**：HEAD=ccdb7e7（未变）；staged 空；dirty 81（68 既有 + 13 候选；本轮仅白名单 6 文件，无新文件）；0 commit/push/deploy；0 原库写入；0 付费调用（Provider 空 key 死端口，providerSucceeded=false 证实未成功调用）。