# Phase 5 阶段学习（learnings.md）

> 依据 22_CHANGE_PACKAGE_AND_LEARNING.md：只沉淀有代码/测试/真实样本证据支持的条目。

1. **原假设**：AI Summary 需要新的真实 AI 门禁开关。
   **实测**：研究链（product-analysis）用 `callAiJson`（provider 配置治理）不经过 listing/image 开关；AI Summary 同属研究链，复用同一治理即满足「复用 real AI gate」——不新建开关（风险 #1 的不一致只在 listing 链，本阶段不扩大）。
   **最终规则**：研究链 AI 复用 callAiJson + demoGuard 配额；新 AI 入口不得裸 provider 调用。
   **证据**：aiEvidenceSummary.ts generate；agents/summary route 配额模式。
   **失效条件**：产品要求研究链独立开关。
   **下一阶段加载**：Phase 6 风险 #1 统一裁定。

2. **原假设**：Prompt Injection 隔离只需在 prompt 里加一句"忽略指令"。
   **实测**：真正的隔离是**结构性的**——外部文本只出现在 user message 的 JSON 数据字段，system prompt 固定且不含任何外部内容；测试断言注入指令字符串"ignore previous instructions"只存在于数据字段。
   **最终规则**：隔离 = 数据/指令结构分离 + system 固定 + 输入裁剪；提示词声明是辅助不是主体。
   **证据**：buildAiSummaryEvidenceInput + SYSTEM_PROMPT；aiEvidenceSummary.test.ts 注入用例。
   **失效条件**：—。
   **下一阶段加载**：V3.x（VOC/1688 外部文本同法）。

3. **原假设**：AI 输出校验可以放宽（AI 偶尔无引用也接受）。
   **实测**：fail-closed 必须严格——fact/estimate/signal/risk/conflict 无引用 → 降级 unverified 并记 error；ghost ref（引用不存在的证据）同样拒绝。降级不丢数据（保留原始输出供审计）。
   **最终规则**：证据引用是事实类输出的硬门禁；校验在保存前，gateResult 落库。
   **证据**：validateAiSummaryOutput + generate gateResult。
   **失效条件**：—。
   **下一阶段加载**：持续。

4. **原假设**：Run Trace 需要独立存储/平台。
   **实测**：runId/inputEvidenceHash/tokenUsage/gateResult/evidenceRefCoverage 作为 summary 记录字段即可满足 30 增强"可回溯本次运行"；不建 tracing 平台（任务书禁止重型平台）。
   **最终规则**：轻量 trace 字段随结果落 resultJson；重跑覆盖旧 trace（最新一次运行语义）。
   **证据**：AiEvidenceSummaryV1 runTrace 字段。
   **失效条件**：需要历史多轮 trace 查询。
   **下一阶段加载**：无需。

5. **原假设**：人工抽查只能靠真人。
   **实测**：Golden Eval 用 mock provider 输出做**四问抽查矩阵**（当前商品/真有证据/数字一致/不扩大语义）可自动化；真实 AI 输出的人工抽查步骤保留在页面（本地 smoke 时执行）。
   **最终规则**：抽查矩阵自动化（回归保障）+ 真实输出人工抽查（门禁前必做，步骤文档化）。
   **证据**：aiEvidenceSummary.test.ts Golden Eval 用例；validation.md 附录。
   **失效条件**：真实 AI 行为与 mock 显著不同。
   **下一阶段加载**：Phase 6 Core Smoke 的人工抽查沿用。

6. **原假设**：测试 fixture 的 researchRecord 可以简化。
   **实测**：taskResultJsonMutation 的 assertResearchNamespaceValid 要求 researchRecord 必须是合法 record + verification + hash 匹配（防覆盖保护）——简化 fixture 直接触发 409。
   **最终规则**：写 resultJson 的测试 fixture 必须用合法 researchRecord（createInitialProductResearchRecord + createProductResearchVerification 构造）。
   **证据**：aiEvidenceSummary.test.ts 合法 record 构造；taskResultJsonMutation assertResearchNamespaceValid。
   **失效条件**：—。
   **下一阶段加载**：Phase 6（handoff 相关测试同法）。

## 下一阶段是否需要加载

1 对 Phase 6 必载（风险 #1 裁定）；2 对 V3.x 必载；5/6 对 Phase 6 必载；3/4 持续。
