# Core-Smoke-Fix.1 — learnings

1. **报表类型 fail-closed 不等于永远手动**：Phase 1 把「无搜索排名 + BSR 大值域」的 PS 报表判 unknown（ambiguous_ps_without_search_rank）是为了不静默误判 CC，但忽略了值域互斥性——CC 榜单 BSR 必 ∈[1..10]（12/12 样本），含 >10 是 PS 的**确定性证据**，判 PS 错误率为零。修复后真实 Products(10) 自动识别成功，无需人工。**教训：fail-closed 之前先穷尽确定性互斥特征；「不能判 CC」不等于「不能判 PS」。**

2. **UI 标签与入口判断必须同源**：「待研究」标签（status 映射）与「开始研究」入口（researchAction 映射）是两套语义，ProductBatch 候选 status=worth_analyzing 但 researchAction=runtime_validation_required，导致「页面说待研究、按钮说不能研究」。修复后统一为 `candidatePrimaryHref` / `isCandidateResearchActionAvailable` 单一权威。**教训：可操作性与状态展示必须复用同一判断函数，禁止各组件自行写 `status === xxx`。**

3. **并行优化前必须实测数据依赖与配额语义**：sourcing 与 risk 无相互依赖（均只依赖商品名+描述），summary 依赖两者——并行 sourcing‖risk 合法。实测串行 51.2s → 并行 21.0s（省 59%）。同时验证：并行不改变 AI 调用次数（demo 配额按 plannedAiCalls 预留，不重复扣额度）；provider 调用计数需改为每步独立跟踪（并行下「前后计数器差值」无法区分调用归属，首版实现曾导致 providerCallsCompleted 误计为 2/4）。

4. **deepseek-v4-flash 延迟波动大（8.9–27.3s/步）**：provider 本身不可控延迟是「开始研究 20s」的组成部分，代码层优化（并行）把总耗时压到最慢步骤量级；剩余体感问题必须用渐进式 UI 解决（点击立即响应 + 真实进度提示），不能伪造完成。

5. **测试 fixture 要匹配真实语义**：CC fixture 行 BSR 用 1,234/2,468（脱敏大值）与真实 CC 榜单（1..10）语义不符，修复后与新检测规则冲突（显式 CC + BSR>10 → report_type_mismatch 拒绝）。将 fixture 修正为榜单值后，marketSignalRanking 等 65 个测试全部通过且语义更真实。**教训：fixture 是契约的一部分，必须与真实样本语义一致。**

6. **显式选择与自动强证据冲突必须拒绝**：新规则下「显式 category_current + BSR>10」被 report_type_mismatch 拒绝——不静默接受与强证据冲突的人工选择，保持 Phase 1 的 fail-closed 语义。
