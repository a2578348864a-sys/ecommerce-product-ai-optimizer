# V5.2 Conversion Rewrite Spike 报告

- **代码基线**：`9cf1962`（feature branch）；本轮新增未提交文件：`lib/listingV5/conversionRewrite.ts`、`lib/listingV5/conversionRewrite.spike.test.ts`、`docs/listing-v52/*`
- **执行范围**：仅 Spike（未接生产链路、未改 Writer/Validator/Repair/Blueprint/评分器/Case/事实）

## 1. 测试目标

验证"被 Validator 阻断（BLOCK → deterministic fallback）的 Listing 能否通过**一次整体 Rewrite** 恢复为 AI 可交付状态"，判据：H3/H4 至少一案 `fallback → AI_REWRITE → Validator PASS`，且 Safety 100%。

## 2. H3/H4 原始失败原因（先更正一处我此前的错误结论）

| Case | Writer 首验 | 阻断原因 | repair | 事实数 |
|---|---|---|---|---|
| H3 | BLOCK | `claims:unsupported:5`（> `MAX_REPAIRABLE_CLAIMS=4`） | `repair.allowed=false` | 6 |
| H4 | BLOCK | `claims:unsupported:6` | `repair.allowed=false` | 8 |

**更正**：我此前报告"Safe Recovery 在 5 案中一次未触发"是**错的**。架构审计（`docs/listing-v52/V52_ARCH_AUDIT.md`）与测试计划（`V52_TEST_PLAN.md`）共同查证：`provider.recoveryAttempted=true` 在 H1/H3/H4 均成立，`trace.recoveryAttempted=false` 只是 **route 未把 recovery 变量传给 trace builder** 的接线盲区；由于 `run-summary.json` 的 `recoveryAttempted` 与 `calls` 都取自该 trace，V5.1 那轮的调用计数被系统性少报（真实调用数高于记录值）。

**第二条更正（V5.1 交付来源归属）**：H1 的交付其实来自 **Safe Recovery**，不是 repair——repair 后的复校验仍非 PASS，是恢复稿复验 PASS 且 `fallbackUsed=false`（若恢复稿也未过，`route.ts` 的 fallback 闸门必然把 `fallbackUsed` 置 true）。因此 V5.1 的正确归属是：**H1 = Safe Recovery 交付、H2/H5 = Repair 交付、H3/H4 = deterministic fallback**。两项比率不变（AI 交付 3/5 = 60%、fallback 2/5 = 40%、Safety 5/5 = 100%），变的是来源标签；V5.1 结项报告中"AI 直交 2/3、平均 81.3"不受影响（那是 V5 基线，非本轮 5 案）。

**教训**：判断"某阶段是否执行"要看写入 snapshot 的 `provider` 字段（唯一写点 `route.ts` 内 `provider = { ...provider, recoveryAttempted }`），不能只看 `trace`——trace 是开发期投影，接线遗漏会静默显示为"未执行"。

## 3. Rewrite 输入设计

- **允许**：`confirmedFacts`、`conversionBlueprint`、`strategy`（供 framing 与 normalize）、`failedListing`、`validationIssues`；
- **禁止**：竞品标题/bullet/原文、supplier/sourcing/MOQ/价格、任何未确认信息——竞品信号经 `sanitizeBlueprintForPrompt` + `competitorSignal=""` 双重剥离，sourcing 在 Listing V5 上下文恒空；
- **输出**：完整 `title / bullets / description / keywords`（provider 返回的 `keywords` 自动映射为 `backendSearchTerms`）；
- **约束**：单次调用；`facts=[]`、无违规明细、provider 失败、结构不可用一律 fail-closed 返回 null；产出稿必然重过**同一** Validator；
- **安全必修项（安全审计要求，已在跑之前落地）**：复用 `sanitizeBlueprintForPrompt`（含 banned/risk 词清洗）；`backendSearchTerms` 逐词过 `HARD_OR_ESCALATION_TOKENS` 过滤（该字段是唯一既不被 Validator 检查、又直出客户端的字段）。

## 4. 测试结果

**单元测试**（`conversionRewrite.spike.test.ts`，mock provider）：**3 例全通过** —— 完整 Listing 返回、经 `normalizeListingV5ProviderDraft`（factIds 白名单）、二次 Validator 校验、unsupported claims 不增加、竞品与 sourcing 不进入提示与产物、无 facts 时 fail-closed、坏响应 fail-closed。

**真实 Provider Spike**（H3/H4 各 1 次 Writer 复现阻断稿 + 1 次 Rewrite，被阻断的 AI 稿并未落库，故必须由 Writer 复现）：

| Case | Writer | Rewrite | 结果 |
|---|---|---|---|
| H3 | 成功，1001 tokens，4.3s | 成功，1027 tokens，4.4s | BLOCK(5) → **REPAIRABLE(4)** |
| H4 | 成功，1219 tokens，5.0s | 成功，1162 tokens，4.5s | BLOCK(6) → **REPAIRABLE(3)** |

两案的 `prohibited=0`、`competitorOverlap=0`，未发现竞品/sourcing 泄漏。

```
SPIKE_RESULT = FAIL            （0/2 达到 Validator PASS）
STOP_EXPANDING = YES
Safety PASS = 0/2（两案均为 REPAIRABLE，未达 PASS）
```

## 5. Provider 消耗

**总计 4 次调用（恰好用满授权）**：H3 = 1 Writer + 1 Rewrite；H4 = 1 Writer + 1 Rewrite。模型 `deepseek-flash`（harness 层 `DEEPSEEK_MODEL=deepseek-v4-flash`），tokens 见上表，全部 `httpStatusClass=success`。**未修改 Prompt 后重跑、未替换 Case、未重复采样。**

## 6. 失败原因分析（按你给的四方向）

| 方向 | 结论 | 依据 |
|---|---|---|
| facts 不足 | **否** | H3 6 条、H4 8 条已确认事实，足以支撑 Listing |
| Rewrite 输入不足 | **否** | 输入含 facts + blueprint + failedListing + 违规明细；Rewrite 正常生成完整稿，且把 unsupported 从 5→4、6→3 |
| Rewrite prompt 问题 | **部分** | 方向正确（违规减少、Safety 干净），但一次重写仍留下 3–4 条未支持表述，不足以直接 PASS |
| Validator 约束过强 | **否** | 残留项确属文案越界；Validator 是安全门，不放宽 |

**最重要的发现**：Rewrite 把两案从 **BLOCK（不可修）迁移为 REPAIRABLE（可修）**——即"Writer → Validator(BLOCK) → **Rewrite** → Validator(REPAIRABLE) → Repair → Validator"这条链**有可能**让两案最终 PASS，而当前链路在 BLOCK 时 repair 被直接禁止、只能 fallback。这是一条真实可行的改进路径，但属于**架构顺序变更**（Rewrite 前置于 Repair 或 Rewrite 后接一次 Repair），超出本 Spike"只验证 Rewrite 单步"的范围，本轮未做。

## 7. 是否进入正式 V5.2

按你设定的判据：**`STOP_EXPANDING = YES`，不进入正式 V5.2 全量开发**（Blueprint/Judge/UI 均未实现）。

若要把本次发现转化为价值，建议的**最小后续**（需你明确授权后再做）：
1. 只改**顺序**：在 BLOCK 分支允许 `Rewrite → Validator → (若 REPAIRABLE) 一次 Repair → Validator`，并同步 `plannedCalls`（否则会 500）；
2. 顺带修两个已确认缺陷：route 未把 recovery/rewrite 变量传给 trace builder；`safeSnapshot` 的 `provider` 字段未做白名单；
3. 用同一 H3/H4 之外的新 Holdout 验证，且**不得**用本轮结果当"已修复"的证据。

## 8. 本轮产物与卫生

- 新增（未提交）：`lib/listingV5/conversionRewrite.ts`、`lib/listingV5/conversionRewrite.spike.test.ts`、`docs/listing-v52/{V52_ARCH_AUDIT,V52_CONVERSION_DESIGN,V52_SECURITY_REVIEW,V52_TEST_PLAN}.md`（D 的测试计划文档以子 Agent 交付为准）、本报告；
- 一处对 `generation.ts` 的最小改动：把 `sanitizeBlueprintForPrompt` 导出供 Rewrite 复用（无行为变化）；
- 临时件已删：`v52-spike.tmp.ts`（spike 驱动）；`%TEMP%` 下的脚本不在仓库内；
- **未 commit / 未 push / 未 merge**；
- 已知风险：`conversionRecovery.ts` 仍缺 `facts=[]` 检查、其 `ok!==true` 提前返回使失败分类成死代码（安全审计记录）；`backendSearchTerms` 未过 Validator 的既有缺口本轮只在 Rewrite 路径补齐，Writer 主路径仍未补。
