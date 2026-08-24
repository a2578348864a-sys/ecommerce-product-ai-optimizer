# RESEARCH_LISTING_CLOSURE PROGRESS（执行者自记）

## 任务 0（完成）
- 分支 feature/v4.1-ui-productization；HEAD 1623a1e4bffa07bf3bb55c9cffed1a175564d38a；工作区已有用户未提交修改（TaskRecordDetail/ListingFactSupplementPanel/phase2StudioNavigation.test 等）——白名单外禁止触碰。
- prisma/dev.db SHA-256：d29d45db4f23f278f1dd24d21951465e61166d92fb166ff2bc1c42d72f80a8a2（已存 before 快照）。
- 定向基线：5 文件 / 26 tests 全绿（reporter=dot 输出见执行记录）。

## 目标/顺序/最大风险（≤10 行）
- 目标：只读审计证明缺口 → 用最小改动让现有 aiEvidenceSummary 呈现「四模块研究结论」（AI结论/关键依据/还缺什么/下一步，引用100%），并为 Listing 补「生成依据」展示（服务端安全结果为唯一来源）。
- 顺序：0 冻结 → 1 审计映射 → 2 摘要业务投影 → 3 Listing 生成依据 → 4 契约+3次反向验证 → 双端浏览器验收 → 汇报。
- 最大风险：① 现有链路可能已完整（则按领导拍板走零业务修改+契约测试）；② 页面四模块渲染在禁止修改的 TaskRecordDetail——模块级结论改放在白名单内的 AiEvidenceSummarySection；③ 不得覆盖用户 dirty 文件。

## 任务 1（完成）：映射审计
- aiEvidenceSummary 仅有扁平分类（facts/estimates/signals/risks/conflicts/missing/nextSteps），无「四模块业务投影」——缺口确认，非零业务修改可解。
- Listing 安全摘要（draftSafeSummary）已有 humanReviewClaims/usedKeywordIds/backendTermWarnings/keywordPlanSource，但无「实际使用的已确认商品事实」透传——缺口确认。

## 任务 2（完成）：摘要四模块业务投影
- lib/server/aiEvidenceSummary.ts：新增 SummaryModuleView + 纯函数 projectEvidenceSummaryBusiness(summary)；四模块 market/buyers/sourcing/costRisk；0 引用项 → missing（不冒充结论）；原字段未动。
- components/evidence/AiEvidenceSummarySection.tsx：客户端镜像 projectModulesFromSummary（同规则）；渲染 summary-module-* 四块（结论/关键依据 N 条/还缺什么/下一步）；脱敏 trace（去 model/run/引用覆盖，改为「结论基于已采集证据整理；未取得信息已如实标注。」）。
- 注：父级 EvidenceWorkbench 接线属禁止修改区（TaskRecordDetail 链），故采用客户端镜像 + 文档说明（领导拍板允许更简单方案）。
- 测试：aiEvidenceSummary.test.ts +2（投影分类/缺口）、AiEvidenceSummarySection.test.ts +1（镜像投影）。

## 任务 3（完成）：Listing 生成依据
- lib/listingHandoff/listingGenerationService.ts：ListingDraftSafeSummary + usedFactTrace；buildUsedFactTrace(usedFactIds→安全标签+值，仅白名单事实)；两处生成点附着（AI 成功/最终草稿）；draftSafeSummary 白名单透传（有界：field≤60/label≤80/value≤200，≤30 条，仅字符串白名单校验）。
- components/listing-handoff/ListingHandoffSection.tsx：data-testid="listing-generation-basis" 生成依据块（实际使用的已确认商品事实 / 待人工确认表达 N 条 / 关键词来源 / 定位守卫句）。
- 测试：ListingHandoffSection.v2216.test.ts +2 基础依据块；随后补 +2 契约（允许清单透传有界映射、生成侧 ≥2 处写入投影）。

## 任务 4（完成）：契约 + 反向验证（红→绿）
- RV1（0 ref → 不得冒充结论）：red（临时破坏）→ 绿（恢复），红绿均见执行记录输出。
- RV2（competer-labeled 事实注入 productFacts → 主链拒绝）：mainChain suite 3/3 红→恢复绿。
- RV3（basis 块被删）：v2216 红 → 绿（3/3 → 4/4 → 5/5 逐步补齐）。
- 契约测试（新红→绿）：v2216 新增「允许清单必须透传 usedFactTrace（有界）」——先红（allowlist 漏映射），补映射后绿。
- 定向全量（7 文件）：134 tests 全绿（reporter=dot，见执行记录）。
- tsc --noEmit：0 errors。eslint 修改文件：0 errors（2 条 warning 为 HEAD 既有的 unused eslint-disable no-console，非本次引入）。

## 浏览器验收（完成，双端）
- 商品研究结论（#formal-v2-materials，任务 cmt0lmsqa000272kny9labi54）：summary-module-market/buyers/sourcing/costRisk 四块全出现；hasRef（查看依据（N 条））true；无 模型 {model}/run/unknown；无横向滚动；console 0/0；1440×900 与 390×844 均通过。
- Listing Studio（任务 cmt0cletl0003nkvnkek3x4nk，active 草稿）：data-testid="listing-generation-basis" 出现；含「生成依据」标题与「研究结论仅作定位参考；Listing 硬属性以已确认商品事实为准」守卫句；无横向滚动；console 0/0；双端通过。
  - 说明：该任务既有草稿快照生成于本功能上线前（无 usedFactIds 新字段），故「实际使用的已确认商品事实」列表为空——空态安全降级，不报错不虚报；新生成草稿经服务契约+主链 e2e 证明含 usedFactIds→usedFactTrace。

## 全量 npm run test（613 文件）：6 failed / 6095 passed / 89 skipped
- 6 个失败全部确认为任务前既有/与本次改动无关（断言目标均为用户未提交 dirty 文件或环境）：
  1. components/WorkspaceSidebar.v4nav.test.ts（2 失败）：断言 WorkspaceSidebar.tsx 的公网导航/模式 Badge——该文件相对 HEAD 0 diff，失败为基线既有。
  2. lib/navigationAudit.test.ts（1 失败）：断言 TaskRecordDetail.tsx 含「历史未核实草稿，禁止使用。」——HEAD 与工作区均不含该串（用户正在改该文件，头部 diff 1760B 为用户工作，非本次）。
  3. components/creative-handoff/CreativeHandoffPanel.test.ts（1 失败）：同 2（TaskRecordDetail 断言）。
  4. components/productUiPolish.test.ts（1 失败）：同 2。
  5. components/phase3ResearchHistory.test.ts（1 失败）：同 2。
  6. lib/server/native1688Bridge.integration.test.ts（suite 失败）：bridge did not start（原生 CLI 桥接进程/环境问题，11 用例全 skip），与本次文件无关。
- 我的 7 个白名单文件均未被上述失败测试读取（v4nav 只读 WorkspaceSidebar）。

## 完成状态：任务书 4 项全部完成；未提交（任务书要求仅本地验证，不 git 操作）。
