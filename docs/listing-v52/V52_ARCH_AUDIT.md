# V5.2 架构只读审计（baseline `9cf1962`）

## 1. route generate 控制流

`app/api/tasks/[id]/listing-v5/route.ts`：入口 `305-316` → buildContext `317`（失败 422）→ 策略缓存 `320-330`（snapshot.v1 + prompt 版本 + revision + 指纹全等；`forceStrategy` 仅 analyze `322`）→ job lock `334-339`（key=`id:fingerprint`）→ provider 门禁 `340-346` → quota 预留 `347-357`（analyze 1／有缓存 3／无 4）→ 加锁 `358` + `onProviderCallStart` `361-365` → 生成 → trace `458` → blueprint `471` → quality `472` → snapshot `482` → 复读指纹 `489-500`（变→settle+409）→ settle `501-507` → CAS `508-512` → catch `513-524`（settle 一次＋删锁）。

```
cachedStrategy? ─是→ trace=stage_not_run(374)
   └否→ analyzeListingV5Strategy(375)
generate? ─是→ writer(388) 失败→ fallbackReason=writer_stage_failed(390)
    └→ validate(393) ─REPAIRABLE→ repair 一次(396)→重校(405)
         └→ 非PASS 且 useProvider(415)→Recovery(416) 成功→换稿重校(424)
              └→ 非PASS→fallback 闸门(429-434)：模板稿+fallbackUsed+validation_blocked
analyze_strategy→carried 逻辑(439-457)
```

## 2. Safe Recovery 为何 `recoveryAttempted=false`

根因是**接线缺陷，不是触发条件**：`route.ts:458-466` 未向 `buildListingV5ExecutionTrace` 传 `recovery/recoveryReason/recoveryValidation`（变量仅 `384-386` 声明、`420-426` 赋值），而 `trace.ts:231-236` 只读 `input.recovery` ⇒ trace 恒 `recoveryAttempted=false`、`stages.recovery=stage_not_run`。

证据 `holdout-evidence\benchmark-v51-final\`：H1/H3/H4 的 `provider.recoveryAttempted=true`（`route.ts:422`）而 trace 为 false、reason/validationStatus 为 null；H1 且 `fallbackUsed=false`+PASS ⇒ 恢复稿已发布（失败必走 `429`）。即 5 案实触发 **3 次**。测试缺口：`route.test.ts:576-638` 只断言 provider 不断言 trace（非生产 trace 可见 `trace.ts:101-105`）；`route.trace.test.ts:293-311` 同。

BLOCK 案的 `validation.claims`（`types.ts:108-115`）：`allHaveEvidence`、`unsupportedClaims`、`prohibitedClaims`、`competitorOverlap`、`unsupportedDetails?`；客户端只有计数（`route.ts:189-191`）。`unsupportedClaims=allDetails.map(text)`（`validation.ts:415`），故两者**同为空只有一种形状**：BLOCK 仅由 `competitorOverlap>0` 造成（`423-424`）；resolver 的 `prohibited_claim` 同时写入两数组（`listingClaimEvidenceResolver.ts:602-603`），故"仅 prohibited"不为空。

`repairScopeTooBroad`（`427`）BLOCK **必走 Recovery**：`locallyRepairable>4` ⇒ `allDetails≥5` ⇒ `rejectedSegments()` 非空（`conversionRecovery.ts:74-86`）；H3/H4 即此形状（trace `claims:unsupported:5/9`）。其余拦截仅三条：`useProvider=false`（`route.ts:415`）、`rejected` 空（`104-108` `recovery_target_missing`）、未真正发起（`135-140`）。附带缺陷：`135` 提前返回使 `141-143` 成死代码，失败原因无法分类；`rejectedSegments()` 不含 prohibited/overlap。

## 3. snapshot 与投影

`ListingV5Snapshot`（`types.ts:121-144`）：version/taskId/revisions/fingerprint、strategy、listing、validation、三 prompt 版本+validatorVersion、repairApplied、repairPromptVersion、provider{4 字段}、model、generatedAt、humanReviewRequired，可选 conversionBlueprint/qualityEvaluation/trace。

`safeSnapshot`（`route.ts:163-273`）：version 不符整份丢弃 `164`；stale 三比对 `165-167`；各段白名单；validation 只留 status/issues/计数/quality `184-193`；trace 仅在开关下经 safeTrace `272`、`117-161`；**provider 原样透传 `272`，无白名单**，故 recoveryAttempted 能到客户端却不在 `types.ts:135` 类型内。

最小改动：扩 `types.ts:135` 与 `route.ts:383`/`422`、`272` 收白名单、客户端标签 `ListingStudioV5Client.tsx:769` 与阶段表 `190-195` 补新阶段。旧快照：safeSnapshot 按缺失取默认，新字段须可选带默认；**勿改 version 字符串**（`164` 会丢全部旧快照）。

## 4. Validator 与 Repair

维度：title `340-341`、bullet `342-350`、description `351-354`（2–4 句 `26-49`）、claim=resolver `362-366`+自扫描 `395-414`（硬词/系动词 `121-129`/`156-186`、事实锚定 `241-257`）、竞品 12 词重叠 `367-370`、堆砌 `292-310`、quality 三旗 `417-419`（`validation.ts`）。

阈值 `331-335`：MAX_REPAIRABLE_CLAIMS=4、MAX_REPAIRABLE_FIELDS=3、MAX_REPAIR_TARGETS=3、MAX_UNSUPPORTED_DETAILS=10。分界：blockingClaims `423-424`、repairScopeTooBroad `427`、status `444-448`、`repair.allowed` 仅 REPAIRABLE 且有目标 `455`。repair 一次、只改白名单 text 字段（`structuredRepair.ts:39-54`/`141-146`），≤3 targets、4 violations，要求 `appliedPaths.length===targets.length` `285`。

"确定性代码不重写营销句"落点：`route.ts:407-409` 注释+`429-434` 直接换模板稿；quality 旗不参与判定（`validation.ts:437-443`）。

## 5. trace schema

`trace.ts`：版本 v1 `20`；字段 `67-95`（recovery `80-83`、四阶段 `88-93`）；失败枚举 14 项 `24-38`；fallback `42`；状态 `46`；`safeTrace` 校验 `route.ts:117-161`。

最小改法：`67-95` 追加 `rewriteAttempted/Success/FailureReason` 与 `conversionScore{total,grade,version}`（只存数值与版本），同步 safeTrace 白名单并复用 `24-38`（必要时加 `rewrite_not_eligible`）。**version 保持 v1**：safeTrace 只认 v1，升 v2 只会让旧 trace 变 null；客户端 `traceStages:190-195`、`traceConclusion:53-71` 同步。

## 6. 最小插入点

**Judge（确定性、零调用）**：插在 `route.ts:457` 与 `471`（blueprint）之间，复用确定性评分器 `scoreListingV5Conversion`（`conversionScore.ts:216`，阈值 75 在 `243`；该文件禁止改动，`RESUME-V51.md:54`）。签名：`judgeListingV5Conversion(input:{context;strategy;blueprint;draft;validation;deterministicFallback:boolean}): {version:string;total:number;grade:string;dimensions:…}`；写入 snapshot 新字段并入 safeSnapshot 白名单（照 `255-271`）；只读，不改 validation。

**Rewrite（provider、整稿重写）**：插在 Recovery `415-428` 后、fallback 闸门 `429` 前，守卫 `validation.status!=="PASS" && useProvider && action!=="analyze_strategy"`。签名同 Recovery：`rewriteListingV5Draft(input:{context;strategy;blueprint;failedDraft;validation},{useProvider;onProviderCallStart}): Promise<{draft:ListingV5WriterDraft|null;attempted:boolean;succeeded:boolean;trace:ListingV5StageTrace}>`；复用 `normalizeListingV5ProviderDraft`（`generation.ts:173`）与 `buildStageTrace`，产出稿须重过同一 `validateListingV5Draft`。

**配额**：`plannedCalls`（`route.ts:347`）= analyze 1／有缓存 3／无 4 = 当前最坏值。加 Rewrite 后最坏 4／5，须同步抬高，否则超预留时 `markDemoAiProviderCallStarted` throw（`363-364`）→ 500，多一次重写即成硬失败。settlement 幂等：仍只 `settleQuota()` 一个入口 + `quotaSettled` 一次闸（`366-371`），三条结算路径（`492-497`/`501-507`/`514-520`）不新增；按实际 started 数而非 plannedCount 结算（`demoGuard.ts:400-444`），多预留不扣额度、少预留才 500。
