# RESEARCH_LISTING_CLOSURE_R3 PROGRESS（执行者自记）

## 任务 0：冻结现场（完成）
- 分支 feature/v4.1-ui-productization；HEAD 1623a1e4bffa07bf3bb55c9cffed1a175564d38a（与预期一致）；无暂存。
- prisma/dev.db SHA-256：d29d45db4f23f278f1dd24d21951465e61166d92fb166ff2bc1c42d72f80a8a2（全程不变）。
- R2 全部 15 个文件在位，无缺失；白名单外均为既有内容（用户 dirty + 证据记录），无本轮新改动。
- 定向基线：8 文件 / 121 tests 全绿。

## 修复 1：costRisk 查看依据定位（完成）
- 现状确认：formal-v2-cost-risk-evidence 原挂在 MissingSection（缺口说明区）。
- 修复：CommercialInputsCard 根 <section> 增加 id="formal-v2-cost-risk-evidence"（同时保留 data-testid="commercial-inputs-card"）；MissingSection 移除该 id。
- 安全映射不变：costRisk → formal-v2-cost-risk-evidence。
- 点击行为：打开祖先 details → hash → scrollIntoView → 聚焦（增强：优先目标内首个可聚焦控件 input/select/textarea/button，否则目标自身 tabindex=-1 兜底）。
- 红灯：R3 DOM 测试（真实组件渲染断言 + 唯一 id 归属）先红（old 布局 workbench-missing 持有 id → 断言红）；实现后绿。

## 修复 2：Listing AI 来源口径（完成）
- 现状确认：draftSnapshot 无条件写 researchReferenceTrace（即使 providerAttempted=false）。
- 服务端门控（lib/listingHandoff/listingGenerationService.ts）：
  researchReferenceTrace 仅在 providerAttempted=true 时写入（否则 undefined）。
- 前端三态（ListingGenerationBasis）：
  A 历史草稿无字段 → 「这份历史草稿没有保存生成依据，重新生成后可查看。」
  B providerAttempted=false → 「本次未调用 AI，当前内容为基于已确认事实生成的安全草稿。」 + 不显示「提供给 AI」组（即使存在 aiReferences）
  C providerAttempted=true → 显示「生成时提供给 AI 的研究参考」具体内容；永不写「AI 实际使用」。
- 守卫句保留：研究资料只用于定位和表达参考；Listing 硬属性只允许来自已确认商品事实。
- 红灯：R3 Listing DOM 测试（B 态不显示提供给 AI / C 态显示 / A 态历史空态）先红；实现后绿。

## 修复 3：四模块缺口错分（完成）
- 现状确认：无引用 missing/nextSteps 默认 market（缺少买家评论/供应商报价错进市场机会）。
- moduleOf 增加有界业务语义词典（仅无引用项）：
  BUYER_GAP_WORDS（评论/买家/需求/差评/VOC…）→ buyers
  SOURCING_GAP_WORDS（供应商/供应/货源/1688/材质/规格/报价/交期…）→ sourcing
  COST_GAP_WORDS（采购价/MOQ/物流费/平台费/广告费/合规/成本/利润/风险…）→ costRisk
  MARKET_GAP_WORDS（市场/销量/搜索/竞争/类目/价格带/竞品…）→ market
  兜底 market。
- 带引用路径优先（voc→buyers、sourcing→sourcing）；风险/冲突恒 costRisk。
- 规则只决定展示模块；无引用项仍只在「还缺什么/下一步」，绝不进 conclusion。
- 红灯：R3 对抗性测试（评论→buyer、供应商报价→sourcing、物流平台费→costRisk、市场销量→market、全部空引用、conclusion 恒空）先红；实现后绿。

## 修复 4：测试可信度（完成）
- 路由测试隔离：beforeEach 设 DEMO_SANDBOX_STORE_PATH → 本测试临时目录独立 sandbox-store.json；afterEach 恢复原 env；清理仅限临时目录；新增断言（隔离文件存在且含本测试任务、不触碰 data/demo-sandbox.json）。
- DOM 点击全部包 act()（clickInAct helper）；stderr 0 act warning（8/8 运行验证）。
- 删除无效 void 断言：替换为真实安全契约（序列化不含内部 field/usedFactIds/runId/inputEvidenceHash；DOM 不渲染这些字段；具体事实/关键词/研究参考仍正常出现）。

## 反向验证（红→绿，三项）
1. costRisk 指回 MissingSection → DOM 真实组件用例红（getElementById 空）；恢复绿。
2. providerAttempted=false 时恢复无条件 researchReferenceTrace → mainChain 源码契约红（gate not found）；恢复绿。
3. 删除 buyer/sourcing 缺口语义映射 → 投影测试红（评论未归 buyer）；恢复绿。

## 验证结果
- 定向测试（8 文件 / 131 tests）全绿；DOM stderr 0 act warning。
- tsc --noEmit --pretty false：0 错误。
- eslint（R3 修改文件）：0 errors（2 warnings 为 HEAD 既有 unused eslint-disable no-console）。
- git diff --check：clean。
- next build：✓ Compiled successfully（13.8s / 12.8s 两次）。
- dev.db SHA 与任务 0 一致（全程零写入，复测确认）。

## 浏览器验收（1440×900 + 390×844；console 0/0；无横向滚动）
- 四模块 summary-module-market/buyers/sourcing/costRisk 全出现。
- 真实按钮点击：view-evidence-sourcing-0 → ariaControls=formal-v2-sourcing-evidence、hash=#formal-v2-sourcing-evidence、targetExists=true。
- costRisk：id=formal-v2-cost-risk-evidence 归属 commercial-inputs-card（真实表单根）、ci-purchase-price/ci-moq/ci-logistics/ci-compliance-status/ci-save 控件均存在、hash=#formal-v2-cost-risk-evidence。
- 焦点：headless CDP 环境 document.activeElement 不反映 section/input focus（环境限制）；组件逻辑（tabindex=-1 + 优先首个控件 + focus）与 DOM 测试断言已锁定；真实浏览器以组件 DOM 实现为准。
- 说明：cmt0lmsqa 任务的 costRisk conclusion 为空（无「成本与风险查看依据」按钮），该模块缺口/结论为空是任务数据所致，非代码问题。

## 全量 npm run test（616 文件）：6 failed / 6117 passed / 89 skipped
- 6 个失败与 R1/R2 完全一致（断言目标为用户未提交 dirty 文件的 TaskRecordDetail 系列 + 原生 CLI 桥接未启动）——任务前既有，与本次白名单改动零关联。
- R3 前出现的 2 个并发环境失败（sqlite CAS timeout/EPERM、stage15 timeout）本次未再现（通过 6117 vs 之前 6105，+12 为本轮新增测试）。
- 白名单外修改 0（说明：lib/server/aiEvidenceSummary.test.ts 本轮仅追加 80 行行为测试（投影缺口语义用例），属服务端投影修复的配套测试；零删除、零放宽，已在 R3 报告中如实记录）。
