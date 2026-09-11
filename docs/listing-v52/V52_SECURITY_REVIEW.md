# Listing V5.2 安全审计（Rewrite / Judge）

只读审计（基线 `9cf1962`；未改源码、未跑 test/build、未调 provider）；新稿 `conversionRewrite.ts` 未接线，已在审。

## 1 事实权威
- 风险：failedListing 未举报句可整段复用（只送前 10 条明细 `conversionRewrite.ts:81-93`、`validation.ts:414`；无违规词的编造句被跳过 `validation.ts:410`）；蓝图仅 `proofPoints` 为事实，其余为 reference（`conversionBlueprint.ts:86-104`），`buyerIntent.primary` 取自 keyword（`:391`）；`offendingSpans` 为原句字面词（`validation.ts:202-212`），可拼新句。
- 断言：①每段（含 title/description）factIds 非空、⊆confirmedFacts（`normalize` 只强制 bullets：`generation.ts:87,95,98`；Validator 不查 description：`validation.ts:341,351`）；②数字/规格 ⊆ 事实 token；③不得含 offendingSpans（除非在事实值内）。

## 2 竞品与 sourcing 隔离
- 须复用 `sanitizeBlueprintForPrompt`（`generation.ts:124-140`）。缺口：`conversionRewrite.ts:68-70`（同 `conversionRecovery.ts:70-72`）只清 `competitorSignal`、未清 banned/risk 词；接线勿传未消毒蓝图（`route.ts:417`）。
- competitor 标题/bullet 原文永禁入提示（蓝图内仅 140 字 `competitorSignal`，`conversionBlueprint.ts:267`）。
- sourcing 恒空（`context.ts:151`，指纹不含 `:137`）。提示与投影排除：supplierConclusion、sourceSignals、priceSignals、availabilitySignals、moqText、supplierName、priceText、displayedMoq、采购价、工厂、1688（`agentOutputSnapshot.ts:303-306`、`image-search-contract.ts:80-81`、`creativeContextBuilder.ts:664`、`decisionEvidence.ts:266`）。

## 3 unsupported claims
- 提示层：prohibitedClaims + `HARD_OR_ESCALATION_TOKENS`（`conversionRewrite.ts:132-135`），并禁复用违规句/词（`:109`）。
- 输出层：`clean` 仅按 `banned` 清洗（`generation.ts:7,9`），弱于 Validator HARD 集（`validation.ts:63,177-186`）→ 须再按 HARD 集过滤 + factIds 白名单（`generation.ts:87,173`）。`backendSearchTerms`（`keywords`）最弱：Validator 不查却直出快照（`route.ts:182`），必须过 HARD 集。
- 必重过 Validator：提示有概率性，只有 `validateListingV5Draft`（`validation.ts:337`）定稿；否则"旧 FAIL + 新文案"错配（`route.ts:425-434`）。

## 4 伪造 PASS
- Judge 分数不得写 `validation.status`；快照 `validation` 仅来自 Validator（`route.ts:484`），投影缺省 `?? "BLOCK"`（`:185`）；先例：评分层无 `status`（`safetyGates.test.ts:82-99`）。
- 只读：`validation.*`、`listing.*`、`provider.fallbackUsed`、`repairApplied`、`validatorVersion`；仅可追加 rewrite/judge 字段（仿 `trace.ts:80-93`）；`provider` 未白名单直传（`route.ts:272`）须补。
- fail-closed：facts 空→不调 provider（Rewrite 已查 `:127-128`，Recovery 缺 `conversionRecovery.ts:104-108`）；provider 失败→无稿（`:159-164`）；结构不可用→null（`generation.ts:88,97`）；重写非 PASS→丢弃走 fallback（`route.ts:429-434`）。

## 5 必加回归测试
T1 输出含 HARD 词/编造规格（含 backendSearchTerms）或复用违规句 → 清洗或拒绝，不得进 PASS。
T2 payload 无 competitorSignal 原文、无 `/1688|supplier|moq|供应商|采购价/i`（同 `writerInputIsolation.test.ts:85-90`）。
T3 facts=[] → `attempted:false`、provider 未调用→fallback。
T4 重写稿仍违规 → status≠PASS、`fallbackUsed:true`，无伪造 PASS。
T5 Judge 无 `status`/`validation` 键，输入 validation JSON 不变，snapshot.validation 仍等于 Validator 结果（`safetyGates.test.ts:87-95`）。
T6 结构性 REPAIRABLE 与仅 competitorOverlap 的 BLOCK 也须触发 Rewrite。
T7 输出/投影无 1688/MOQ/采购价（`safetyGates.test.ts:101-113`）。

## 6 既有缺陷与触发
五案实测 AI 直交 0/5、fallback 5/5，unsupported 3/6/8，3 例超修复上限成不可修 BLOCK（`RESUME-V51.md:36`、`validation.ts:331-333,427`）；该轮 Safe Recovery 未接线（`RESUME-V51.md:89`），"0 触发"非有效证据。
新稿沿用"仅有违规明细才触发"（`conversionRewrite.ts:130`）会重复：①结构性违规或 BLOCK 仅源自 competitorOverlap/prohibitedClaims 的案例永不重写→fallback；②明细超上限→触发一次仍非 PASS→fallback。
建议：`useProvider && facts>0 && 最终 status!=="PASS" && 存在可写字段`；明细降级为可选；与 Recovery 互斥、合计一次；重写必重校验。

SECURITY_REVIEW = PASS_WITH_NOTES；必须修项：(1) 复用 `sanitizeBlueprintForPrompt`；(2) 触发不依赖违规明细、与 Recovery 互斥、`plannedCalls` 同步（`route.ts:347`）；(3) `provider` 字段白名单；(4) title/description 强制 factIds、数字 token 白名单、backendSearchTerms 过 HARD 集；(5) 重写必重校验，Judge 不触碰 `validation`。
