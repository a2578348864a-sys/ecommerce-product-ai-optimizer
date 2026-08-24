# RESEARCH_LISTING_CLOSURE_R2 PROGRESS（执行者自记）

## 冻结现场（任务 0）
- 分支 feature/v4.1-ui-productization；HEAD 1623a1e4bffa07bf3bb55c9cffed1a175564d38a；无暂存。
- prisma/dev.db SHA-256：d29d45db4f23f278f1dd24d21951465e61166d92fb166ff2bc1c42d72f80a8a2（与 R1 基线一致，全程不变）。
- 用户 dirty 文件（TaskRecordDetail/ListingFactSupplementPanel/AGENTS.md/app/prototype 等）未触碰。

## 缺口确认（审计）
1. route 未接入 businessModules（GET/POST 只返回 summary+storageVersion）。
2. AiEvidenceSummarySection 有客户端第二套分类器（projectModulesFromSummary/moduleKeyOf）。
3. 「查看依据（N 条）」是 span。
4. Listing 生成依据只有数量/固定文案，无具体关键词/研究参考/逐条待确认表达；usedFactTrace 泄漏内部 field。
5. 四模块下旧扁平分类完整重复。

## 实现（全部在允许白名单内）
- lib/server/aiEvidenceSummary.ts：SummaryModuleView.conclusion 增加 evidenceTarget（安全枚举 market/buyer/sourcing/costRisk）+ TARGET_BY_KEY 映射。
- app/api/tasks/[id]/ai-evidence-summary/route.ts：GET/POST 返回 data.businessModules = projectEvidenceSummaryBusiness(summary)。
- components/evidence/EvidenceWorkbench.tsx：loadAiSummary 读取 businessModules（BusinessModuleView[]）→ 传 AiEvidenceSummarySection。
- components/evidence/AiEvidenceSummarySection.tsx：删除 projectModulesFromSummary/moduleKeyOf（唯一分类器在服务端）；新增 BusinessModuleView + EVIDENCE_TARGET_IDS（evidenceTarget→DOM id 安全映射）；「查看依据」为真实 button（aria-controls/aria-expanded 动态/点击打开祖先 details/hash 更新/scrollIntoView/focus/tabindex 兜底）；目标不存在 fail-closed 显示「对应资料区暂时无法打开」；旧扁平分类移入默认关闭 <details data-testid="legacy-category-details">「查看历史分类详情」。
- lib/listingHandoff/listingGenerationService.ts：usedFactTrace 对外仅 label/value（删 field）；新增 usedKeywordTrace（deriveUsedKeywordTrace：usedKeywordIds+brief→具体词）与 researchReferenceTrace（deriveResearchReferenceTrace：aiReferences 去 "AI REFERENCE (NOT FACT): " 前缀）；draftSnapshot 组装处附着；draftSafeSummary allowlist 有界透传三字段。
- components/listing-handoff/ListingHandoffSection.tsx：提取导出 ListingGenerationBasis（四组：最终文案实际命中的已确认商品事实 / 最终文案实际采用的关键词 / 生成时提供给 AI 的研究参考 / 待人工确认的表达 + 守卫句「研究资料只用于定位和表达参考；Listing 硬属性只允许来自已确认商品事实。」）；历史草稿无字段→「这份历史草稿没有保存生成依据，重新生成后可查看。」+ 守卫句。

## TDD 红灯先行（全部先红后绿）
- route 契约测试（GET/POST businessModules + 安全字段/无泄漏）：2 红→2 绿。
- AiEvidenceSummarySection.test.ts（无第二套分类器/接收 businessModules）：2 红→2 绿。
- AiEvidenceSummarySection.dom.test.ts（真实 DOM 点击：button/aria-controls/hash/scroll/focus/details/fail-closed/去重折叠）：5 红→5 绿。
- ListingGenerationBasis.dom.test.ts（完整 fixture 四组 + 历史空态）：2 红→2 绿。
- v2216.test.ts 契约升级（含 usedKeywordTrace/researchReferenceTrace 透传 + 生成侧 derive 调用）：绿。

## 反向验证（红→绿，三项）
1. 断开 route businessModules 返回 → route 契约测试 2/2 红；恢复后绿。
2. 「查看依据」临时改回 span → DOM 点击测试 4/4 红；恢复后绿。
3. Listing 具体关键词替换为数量 → ListingGenerationBasis.dom.test 红（kids water bottle not found）；恢复后绿。

## 验证结果
- 定向测试（8 文件/121 tests）全绿。
- tsc --noEmit：0 错误。
- eslint（修改文件）：0 errors（2 warnings 为 HEAD 既有 unused eslint-disable no-console，非本次引入）。
- next build：✓ Compiled successfully（20.1s/30.0s 两次）。
- git diff --check：clean。
- dev.db SHA 与基线一致（全程无写入）。
- 真实链路（mainChain e2e，mock AI）：usedFactTrace=[品牌YETI/材质Stainless Steel/颜色Mist-Pink-Grasshopper/清洁保养…]、usedKeywordTrace=["kids water bottle"]、researchReferenceTrace（去前缀）、reviewClaims 逐条——全部真实生成。
- 真实 API（本地 3005 + 任务 cmt0lmsqa）：GET 返回 businessModules（4 模块），结论项仅 text/refCount/evidenceTarget，无 ev: 引用泄漏。

## 浏览器验收（1440×900 + 390×844；console 0/0；无横向滚动）
- 商品研究四模块：summary-module-market/buyers/sourcing/costRisk 全出现；「查看依据（N 条）」按钮真实可点：点击后 targetId=formal-v2-market-evidence、hash=#formal-v2-market-evidence、scroll ok、focus true（双端一致）。
- Listing Studio（cmt0cletl 旧草稿）：data-testid="listing-generation-basis" 出现；诚实空态「这份历史草稿没有保存生成依据，重新生成后可查看。」+ 守卫句「研究资料只用于定位和表达参考；Listing 硬属性只允许来自已确认商品事实。」（双端一致）。
- 说明：页面全文中 "run xxx · model" 命中的是 VocEvidenceSection（买家资料区非白名单组件）的既有运行 trace，非四模块/生成依据区域；本轮按最小修改范围未改动。

## 全量 npm run test（616 文件）：8 failed / 6105 passed / 89 skipped
- 6 个失败与 R1 完全一致（断言目标为用户未提交 dirty 文件的 TaskRecordDetail 系列 + 原生 CLI 桥接未启动）——任务前既有。
- 2 个新增失败均为并发环境性超时/文件锁（全量并发负载下）：
  1. lib/server/taskResultJsonMutation.sqlite.test.ts：Hook timed out 10000ms + EPERM（临时目录占用）——单跑 4/4 通过。
  2. tools/upstream/generate-stage15-source-native-result.test.ts：Test timed out 5000ms——单跑 5/5 通过。
- 均与本次白名单改动零关联（不涉及任何修改文件）。
