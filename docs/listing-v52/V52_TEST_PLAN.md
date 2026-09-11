# Listing V5.2 测试计划（附 H3/H4 阻断根因核对）

只读分析，基线 `9cf1962`；证据 `benchmark-v51-final/`（13:19 生成，晚于接线提交 `b2acd0d`）。

## 1. H3/H4 为何被阻断

快照真实字段（逐字引用）：

| 案 | `validationStatus` | `validationBlockReasons` | `repairAttempted`/`repairFailureReason` | `fallbackReason` |
|---|---|---|---|---|
| H3 | `"BLOCK"` | `["claims:unsupported:5"]` | `false` / `"stage_not_run"` | `"validation_blocked"` |
| H4 | `"BLOCK"` | `["claims:unsupported:9"]` | `false` / `"stage_not_run"` | `"validation_blocked"` |
| H1/H2/H5 | `"REPAIRABLE"` | `["claims:unsupported:2"]`/`:2`/`:1` | `true` / `"none"` | `"none"` |

**前置假设需更正**：证据里**没有** `claims.unsupportedClaims`、`claims.unsupportedDetails`、`repair.allowed`（5 案命中 0 次）；`safeSnapshot`（`route.ts:184-193`）只投影状态与计数，`claims.*` 文本与 `repair` 块（`validation.ts:453,455`）不入快照；快照的 `unsupportedClaimCount: 0` 属于 **fallback 稿**复校验，不可反推。

代码依据（`validation.ts`）：`MAX_REPAIRABLE_CLAIMS=4`、`MAX_REPAIRABLE_FIELDS=3`、`MAX_REPAIR_TARGETS=3`（`:331-333`）、`MAX_UNSUPPORTED_DETAILS=10`（`:335`）；`blockingClaims`/`repairScopeTooBroad`（`:423-427`）；状态分支 `:444-448`；原因串 `claims:unsupported:N`（`trace.ts:188`）。

**阻断类型**：设局部可修数为 L（`isLocallyRepairableClaim` 仅认 `reason==="unclassified_factual_claim"`，`:318-320`），其余为 B。B≥1 → `blockingClaims>0` → BLOCK；B=0 → L>4（5、9）→ `repairScopeTooBroad` → BLOCK。两种划分都必然 BLOCK：**unsupported 数量越过可修上限**，非 prohibited/competitor 命中。

## 2. Repair 为何无法恢复
- 路由只在 `status==="REPAIRABLE"` 时调 repair（`route.ts:395`）；BLOCK 案 `repair.allowed` 恒 `false`、`targets` 恒 `[]`（`validation.ts:455`）→ **结构上不可达**（`repairAttempted:false`、`stage_not_run`）。
- 即便可达，repair 只改 ≤3 个白名单字段（`:427,435`），5/9 条超 ≤4 上限。

## 3. Safe Recovery 触发真相（更正"5 案全未触发"）
- 调用条件 `status!=="PASS" && useProvider`（`route.ts:415-419`）对 BLOCK 同样成立；`rejectedSegments()` 读 `validation.claims?.unsupportedDetails`（`conversionRecovery.ts:74-86`），路由传入完整 Validator 对象 → H3/H4 的 5/9 条必然非空，**非"unsupportedDetails 为空"**。
- 真实执行看 `snapshot.provider.recoveryAttempted`（`route.ts:422` 唯一写点）：**H1/H3/H4=true，H2/H5=false**；H2/H5 未触发是 repair 后已 PASS（`:415` 条件不成立），与 `rejectedSegments()` 无关；H1 的 recovery 稿复验 PASS（否则 `:429` 必 fallback），故 **H1 实由 Safe Recovery 救回**，`delivered` 失真。
- "5 案全 false"是**接线缺陷**：`buildListingV5ExecutionTrace` 调用（`route.ts:458-466`）未传 recovery 三项入参，故 `trace.recoveryAttempted` 恒 false、`recoveryReason`/`recoveryValidationStatus` 恒 null、`stages.recovery` 恒 `stage_not_run`（`trace.ts:231-236`）；`run-summary.json` 的 `recoveryAttempted` 与 `calls` 均取自该 trace（`calls` = `stages` attempted 计数），系统少报 recovery 调用。

## 4. V5.2 测试矩阵

### A. conversionRewrite（整体重写）— 新 `lib/listingV5/conversionRewrite.test.ts`（spike 已有 `rewriteListingV5Draft`，未接入）
| 用例名 | 输入构造 | 断言点 |
|---|---|---|
| `rewrite recovers a BLOCK draft repair cannot touch`（Rewrite 成功恢复） | BLOCK（9 条明细、`repair.allowed=false`）+ mock 返回合规稿 | attempted/succeeded=true；重写稿过 `validateListingV5Draft` = PASS |
| `rewrite fails closed and the honest fallback ships`（Rewrite 失败 fallback） | mock 返回含 HARD 词/未确认规格稿 | 该稿被丢弃；`fallbackUsed=true`、`fallbackReason="validation_blocked"`、`buildListingV5FallbackDraft` 1 次 |
| `rewrite payload carries no competitor / VOC / keyword / sourcing text`（competitor isolation） | context 注入 MARKERS（仿 `conversionRecovery.test.ts:19,49`） | payload 无 marker 与 `/1688\|supplier\|moq\|采购价/i`，`competitorSignal` 为空 |
| `rewrite never adds a fact the Confirmed Facts do not carry`（fact authority，含 `offendingSpans`） | mock 输出含未确认数字/规格 token 与旧违规词 | 复验非 PASS；输出数字与规格 token ⊆ confirmedFacts；每段 factIds 非空 |
| `trigger matrix` | 结构性 REPAIRABLE、仅 competitorOverlap 的 BLOCK、`unsupportedClaims=[]` | `useProvider && confirmedFacts>0 && status!=="PASS"` 均触发；`confirmedFacts=[]` → provider 未调用 |
| `budget and exclusivity` | — | ≤1 次调用、与 Safe Recovery 互斥、`plannedCalls` 同步 |

### B. conversionJudge（确定性评分）— 新 `conversionJudge.test.ts`（今日 = `conversionScore.ts`，五维×20，阈值 75）
| 用例名 | 输入构造 | 断言点 |
|---|---|---|
| `judge is pure and deterministic` | 同 context/strategy/draft 调两次；fallback 稿 vs AI 稿 | 结果 deep-equal；输入 validation JSON 前后不变；fallback 稿总分更低、naturalness 扣分，各维 ≤20 |
| `judge exposes no status or validation key` | 任意输入；route 层 | 返回体无 `status`/`validation`（仿 `safetyGates.test.ts:82-99`）；`snapshot.validation` 恒等于 Validator 结果 |

### C. route 链路 — `route.test.ts`（扩既有两例）
| 用例名 | 断言点 |
|---|---|
| `writes rewrite telemetry into the trace`（V52 必补） | 四字段如实反映执行（今日恒 false/null） |
| `publishes the rewritten draft when it validates`（Rewrite 成功恢复） | `listing` = 重写稿、`fallbackUsed=false`、`validation.status="PASS"`、fallback 未调用 |
| `falls back when the rewritten draft still fails`（Rewrite 失败 fallback） | `fallbackUsed=true`、`fallbackReason="validation_blocked"`、发布稿 = deterministic 稿 |
| `re-validates the rewritten draft with the same Validator`（Validator 二次验证） | `validateListingV5Draft` 序列 = 首验 →（repair 复验）→ 重写后复验；发布稿 validation 属于发布稿 |
| `a BLOCK draft with >4 unsupported claims still gets one rewrite` | BLOCK 触发 rewrite 恰 1 次，不因 `repair.allowed=false` 跳过 |

## 5. 真实质量验证协议（5 案新 Holdout 池）

**冻结字段**（生成前写 `frozen-pool.json`，之后不变）：`codeSha`（`git rev-parse HEAD`）、`taskId`、`contextFingerprint`、`confirmedFacts`/`prohibitedClaims`/`unknowns` 计数、`researchRevision`/`handoffRevision`、模型名与 `confirmRealAi:true`。

**逐案记录项**：provider calls（`stages.*.attempted` 与 `provider.*Attempted` 双记，规避 §3 少报）、writer 首验状态与 block 原因、repair（attempted/success/appliedPaths）、rewrite（attempted/复验 status）、fallback（fallbackUsed/fallbackReason）、conversion score（75/85）、交付来源四态。

**执行约束**：
1. 同一 Case **SHA 冻结后不得改代码再重跑**；源码/提示词/评分器任一改动 → 该轮 5 案证据作废，换指纹整体重跑；预算超支事前备案，不得改 rubric 凑指标。
2. 失败案不得删除或只报成功案；每案保留原始 `snapshot`。
3. 先修 §3 trace 接线并补 C 组首例，否则 `calls`/`delivered` 不可信。
