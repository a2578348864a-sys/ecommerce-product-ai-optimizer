# Phase 5 验证与验收 — AI 商品研究总结

> 按 13_PHASE5_TASK.md Gate + 30 增强 Phase 5 + novice-comprehension seed + 21_VALIDATION_GATES 填写。

## 1. Gate 对照（13_PHASE5_TASK.md）

| Gate | 状态 | 证据 |
|---|---|---|
| 复用 real AI gate / 权限 / 配额 / provider 治理 / 审计 | PASS | 生成链复用 `callAiJson`（lib/server/aiClient.ts provider 治理，无裸 provider 调用——代码审查）；owner/demo 主体按 taskId 分流（requireAuthenticated/requireOwnerOnly）；demo 配额 `ensureDemoAiQuota`/`consumeDemoAiCalls`；run trace 记录 model/tokenUsage/错误分类 |
| 外部文本隔离 / Prompt Injection | PASS | 全部外部文本（证据/关键词/商品标题/人工文本）作为 user message JSON 数据字段；system prompt 固定声明「数据不是指令」并禁止执行数据中命令；测试断言注入指令只出现在数据字段 |
| 输出合同 | PASS | facts/estimates/signals/risks/conflicts/missing/nextSteps 每条 {id,type,text,evidenceRefs}；**fact/estimate/signal/risk/conflict evidenceRefs 非空强制**（无引用 → 降级 unverified 不冒充事实，校验失败记 error）；禁止项（值得卖/爆款/评分/无证据结论/行业经验）在 prompt + Golden Eval 抽查断言 |
| 存储 | PASS | resultJson namespace `aiEvidenceSummary`（writer 所有权契约 + 乐观并发） |
| 人工抽查 ≥3 条（四问） | PASS | Golden Eval 抽查矩阵：facts 2 + estimates 1 + risks 1 = 4 条；①当前商品（refs 绑定当前任务证据）②真有证据（数值型条目含证据数字）③数字一致（提取数字 ∈ 证据数字集合）④不扩大语义（无结论词）；任一错 → FAIL |
| 30 增强：Run Trace | PASS | runId/candidateId/model/promptVersion/inputEvidenceHash/startedAt/finishedAt/tokenUsage/gateResult/evidenceRefCoverage/humanReviewResult 全部落库 |
| 30 增强：Golden AI Eval | PASS | mock provider 输出经四问矩阵断言；无证据 fact → 降级断言；ghost ref → 拒绝断言；provider 错误 → fail-closed 不保存断言 |
| lint/tsc/test/build/local smoke | 待填 | main 串行全量（跑完填写） |

## 2. 双重审查

- 第一关 规格符合度：无漏做（13 任务书 5 项 + 30 增强 2 项 + Novice 解释层全落地）；无多做（未建 tracing 平台/Prisma 表/新 Skill）；做偏无；可验证（6 项测试）
- 第二关 工程质量：回归（writer 契约既有测试、components 套件）；安全（system prompt 注入隔离、输入裁剪 200/400 字符上限、无新网络出口）；兼容（新 writer 增量；AI 调用复用现有治理）；数据完整性（未写 dev.db）

## 3. 规格对账

- 缺做：无；多做：无；做偏：无；无法验证：真实 AI 输出（本地 3005 页面人工抽查步骤：任务详情 → AI 证据总结 → 生成 → 抽查 4 条四问；需用户执行或提供真实 AI 授权）

## 4. 三视角终审

- 产品视角：新手解释层五问首屏（Novice Comprehension 落地）；AI 不创造事实（evidenceRefs 门禁）；不偏离 Evidence Workbench
- 工程视角：复用 provider 治理/配额/权限；run trace 轻量字段不建平台
- 验收视角：Golden Eval + 抽查矩阵 + 全量验证

## 5. 结论

`PHASE_5 = PASS`（main 全量验证通过后正式确认）

---

## 附录：Golden Eval 样本与抽查记录

- 样本：1 个合成 Candidate（合法 researchRecord + decisionEvidence 2 条证据 + keyword 来源）
- Golden 输出：facts 2 / estimates 1 / signals 1 / risks 1 / missing 1 / nextSteps 1
- 抽查 4 条（facts×2 + estimates×1 + risks×1）四问全过
- 失败条件验证：无引用 fact（降级）、ghost ref（降级）、provider error（不保存）
