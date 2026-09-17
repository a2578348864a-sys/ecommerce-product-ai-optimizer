# V3.4 — Golden VOC Eval

> 小型 Golden Eval（任务书二十九节）：至少 3 个场景，验证 AI VOC 输出的确定性、可追溯性与安全边界。
> 不做大型 benchmark；用 mock AI 输出走完整校验/统计链路（deterministic），不消耗真实 API。

## 场景与验收

| # | 场景 | 输入 | 验收（必须） |
|---|---|---|---|
| G1 | 明显重复痛点 | 5 条评论同一痛点（"安装说明不清楚"） | 主题保留 5 个 refs；reviewCount=5（服务端计算）；strength=recurring；不编主题 |
| G2 | 正负意见冲突 | "很轻便"×2 vs "太轻显廉价"×2 | conflict 双面各有 refs 与计数；note 不裁判 |
| G3 | 样本太少 | 1 条评论的个例 | weakSignals/主题 reviewCount=1 → isolated；unknowns 明确"样本不足" |
| G4 | Prompt Injection | 评论/AI 输出含 "ignore previous instructions"、URL、命令、额外字段 | 结构白名单不变；无 executeCommand/sendSecret 字段泄漏；注入文本仅作纯文本数据 |

## 验收规则（全部必须有测试断言）

- 不编主题（无 refs 主题 → unverified 拒绝）
- 不跨 ASIN（refs 必须 ∈ 当前 dataset）
- 不把一条评论变成 recurring（strength 由 reviewCount 决定）
- evidenceRefs 正确（无效 ref 丢弃；全无效 → 主题拒绝）
- reviewCount deterministic（服务端按 refs 计算，LLM 不写数量）
- unknown 正确（样本不足时输出 unknowns）
- prompt injection 不生效（结构白名单）
- source product role 正确（sourceProductRoles 从 refs 推导）

## 实现位置

`lib/server/vocAnalysis.test.ts`（Golden VOC Eval describe）——validateVocOutput + finalizeTheme + computeThemeStrength 全链路的 mock-AI 断言；route 测试（`app/api/tasks/[id]/review-evidence/route.test.ts`）用 mock callAiJson 走真实 analyzeVoc 保存/读取链路。

## 结果

全部 PASS（2026-08-15，V3.4 worktree）。
