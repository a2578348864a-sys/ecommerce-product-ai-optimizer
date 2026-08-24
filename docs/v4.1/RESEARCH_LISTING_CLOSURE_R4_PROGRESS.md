# RESEARCH_LISTING_CLOSURE_R4 PROGRESS（执行者自记）

## 任务 0：只读基线（完成）
- 分支 feature/v4.1-ui-productization；HEAD 1623a1e4bffa07bf3bb55c9cffed1a175564d38a；无暂存。
- prisma/dev.db SHA-256：d29d45db4f23f278f1dd24d21951465e61166d92fb166ff2bc1c42d72f80a8a2（全程不变）。
- 基线：8 文件 / 131 tests 全绿。

## P1-1：AI 摘要公开 DTO（完成）
- route GET/POST 不再返回原始 summary/unverified/gateResult；改为 data = { businessModules, legacyCategories, storageVersion }。
- 新增 projectLegacyCategories(summary)：历史分类安全投影（仅 label + 用户可读 text；无 id/evidenceRefs/runId/model/hash 等；每类 ≤20 条、单条 ≤200 字符、总数 ≤7 类）。
- EvidenceWorkbench 读取 legacyCategories 传 Section；AiEvidenceSummarySection 消费 legacyCategories prop（旧分类折叠区改为 prop 渲染）。
- AiEvidenceSummarySection 渲染重构：四模块/历史/门禁独立于 summary（summary 只控新手层与门禁）；businessModules 非空即渲染四模块。
- 契约测试：GET/POST 完整响应 JSON 序列化扫描 FORBIDDEN 字段（runId/candidateId/inputEvidenceHash/promptVersion/tokenUsage/gateResult/evidenceRefCoverage/summary/unverified/model/humanReviewResult）+ legacyCategories 有界断言——红灯→绿灯。

## P1-2：封闭 Listing 公开摘要（完成）
- draftSafeSummary 删除 usedFactIds 与 usedKeywordIds（公开 DTO 不再外发）；类型（ListingDraftSafeSummary）同步删除。
- 读取层第二道门控：researchReferenceTrace 仅 providerAttempted===true 时返回（否则 undefined）。
- 真实契约测试（mainChain）：AI 成功路径 draft 不含 usedFactIds/usedKeywordIds/field；真实非 AI 路径（providerAttempted=false）researchReferenceTrace undefined。

## P1-3：风险冲突模块优先级（完成）
- moduleOf 合同顺序：① risk/conflict → costRisk（优先，即使引用 voc/sourcing）② VOC→buyers ③ sourcing→sourcing ④ 无引用语义词典 ⑤ 兜底 market。
- 修正 R2 错误断言（risk+voc 原断言 buyers → 改为 costRisk）。
- 对抗性测试：risk+ev:voc→costRisk(evidenceTarget=costRisk)、conflict+ev:sourcing→costRisk、fact+voc→buyers、fact+sourcing→sourcing、无引用 risk 不进 conclusion。

## P1-4：三态判断顺序（完成）
- ListingGenerationBasis 先检查 providerAttempted 显式值：undefined 且无新字段→历史；false→非 AI 说明（即使 trace 全空）；true→AI 态。
- 测试：providerAttempted=false+trace空→非 AI 说明（不误判历史）；undefined+无字段→历史。

## 反向验证（红→绿，三项）
1. 恢复原始 summary 透传 → DTO 契约红；恢复绿。
2. risk+VOC 优先级后移 → 模块测试红；恢复绿。
3. providerAttempted=false 按空数组判断 → 三态测试红；恢复绿。

## 验证结果
- 定向测试：9 文件 / 154 tests 全绿；stderr 0 act warning。
- tsc --noEmit --pretty false：0 错误。
- eslint（R4 文件）：0 errors（2 warnings 为 HEAD 既有 unused disable）。
- git diff --check：clean。
- next build：✓ Compiled successfully（19.4s/19.8s）。
- dev.db SHA 与任务 0 一致（全程零写入）。
- 全量 npm run test（616 文件）：6 failed / 6134 passed / 78 skipped——6 个失败与 R1/R2/R3 完全相同（TaskRecordDetail 断言系列+原生 CLI 桥接），零新增。
- API 验证（本地 3005 GET）：data = businessModules/legacyCategories/storageVersion，无 summary/runId/model 泄漏。

## 浏览器验收（1440×900 + 390×844；console 0/0；无横向滚动）
- 四模块全出现；历史分类折叠默认关闭；页面无内部 runId/hash/model/ID 文案（leaks=[]）。
- 查看依据按钮点击：ariaControls/hash/target 正确。
- Listing 草稿（cmt0cletl）：生成依据块显示、守卫句在；该草稿 providerAttempted=true（AI 态无研究参考=历史字段缺失，合理）。
- 非 AI/历史三态文案由真实行为测试（mainChain 真实生成路径）覆盖——浏览器不执行生成（不写库）。

## 遗留说明
1. 浏览器无法实测非 AI 草稿文案（需生成才出现，禁止写库）——由 mainChain 真实生成路径断言覆盖。
2. headless CDP 焦点 activeElement 环境限制同 R3。
3. VocEvidenceSection 既有 trace 非白名单未动。
