# V5.2 实施计划（Phase 1 产出）

- **基线**：`9cf1962`（`feat/listing-v5-rebuild`）
- **依据**：`V52_CHAIN_AUDIT.md`（本会话只读审计）、`V52_ARCH_AUDIT.md`、`V52_SECURITY_REVIEW.md`、`V52_TEST_PLAN.md`、`V52_SPIKE_REPORT.md`，以及 Spike 模块 `lib/listingV5/conversionRewrite.ts` 的实测行为。
- **本文件只做规划，不含任何代码改动。**

## 1. Phase 1 确认项（四处入口 + 两处投影）

| 目标 | 现状（实测） | V5.2 落点 |
|---|---|---|
| **BLOCK 入口** | BLOCK 不进入 repair 分支（守卫 `status === "REPAIRABLE"`），直接落到 fallback 闸门 `if (status !== "PASS")` | 在 fallback 闸门**之前**插入「BLOCK → rewriteEligible → Conversion Rewrite」 |
| **Repair 入口** | 唯一入口在 `REPAIRABLE` 分支内，≤1 次、targets ≤3、`appliedPaths === targets` 才算成功 | 复用同一函数；新增 `repairUsed` 守卫，保证「Writer 后 repair」与「Rewrite 后 repair」合计 ≤1 次 |
| **fallback 入口** | `if (status !== "PASS")` → `buildListingV5FallbackDraft` + `fallbackReason="validation_blocked"` + 复验 | 保持不变，作为所有失败路径的唯一出口（Rewrite 异常也走这里，不抛错） |
| **trace builder** | 调用点**未传** recovery 相关参数 → `recoveryAttempted` 恒 false（接线盲区） | 新增 `rewriteAttempted / rewriteSuccess / rewriteValidationStatus`，并把 recovery 与 rewrite 变量**真实传入** |
| **snapshot provider** | `provider` 经 `safeSnapshot` **原样透传** | 改为**逐字段白名单**（`strategy/writer/repair/recovery/rewrite` 各 attempted + `fallbackUsed` + `fallbackReason`），未知字段一律丢弃 |
| **配额** | `plannedCalls` = analyze 1 / 有缓存 3 / 无 4 | 加 Rewrite 后最坏 = 2 / 4 / 5；**不同步会在 mark 时抛错 → 500** |

## 2. rewriteEligible 判定（Phase 2 核心）

在 BLOCK 分支先做**确定性分类**，只有 eligible 才调用 Rewrite，其余直接 fallback：

| 判定为 **eligible**（允许 Rewrite） | 依据字段 |
|---|---|
| unsupported wording / benefit overstatement / marketing phrasing | `validation.claims.unsupportedClaims` 或 `unsupportedDetails` **非空**（即 `validationBlockReasons` 含 `claims:unsupported:*`），且 `status === "BLOCK"` |

| 判定为 **not eligible**（直接 fallback，不调用 Rewrite） | 依据 |
|---|---|
| **insufficient facts** | `context.confirmedFacts.length === 0`（无可写事实） |
| **source conflict / policy block** | `validation.claims.competitorOverlap.length > 0` 或 `prohibitedClaims.length > 0`（属来源/合规冲突，重写无法消除） |
| **identity mismatch** | 上游已 fail-closed：taskAsin 三方绑定、handoff gate、`listing_v5_stale_context` → 不进入本分支 |
| 其他 BLOCK（无 unsupported 明细可归类） | `rejected` 明细为空 → 直接 fallback |

判定结果写入 trace（`rewriteEligible` + 原因），使"为什么没走 Rewrite"可追溯。

## 3. Rewrite 输入白名单（按你的指令收紧）

- **允许**：`confirmedFacts`、**已 sanitize 的** blueprint 的 `buyerIntent / painPoints / benefitOrder / purchaseTriggers / objectionHandling`、strategy 的安全子集（`primaryAngle/tone/useCases/bulletAngles/keywordIntent`，经 `sanitizeStrategyForCopy`）、`validation **category**`（`status` + 计数 + `issueCode` 列表）。
- **禁止**：competitor 原文（`competitorSignal` 强制置空且经 `sanitizeBlueprintForPrompt`）、sourcing（上下文恒空）、provider metadata、**raw unsafe claim 文本**（当前 Spike 版本会把 `validationIssues.text` 与 `offendingSpans` 一并发给模型 —— **正式接入时必须改为只发类别/计数/issueCode，不发原句与 span**）。
- 产出稿**必然重过同一 Validator**；模块内保留 `facts=[]`、provider 异常、结构不可用三条 fail-closed 分支。

## 4. Phase 3 链路（Rewrite 后接 Repair）

```
BLOCK → rewriteEligible?
  否 → fallback
  是 → Conversion Rewrite（≤1）→ validate
        ├─ PASS → 交付 AI_REWRITE
        ├─ REPAIRABLE → Repair（全局 ≤1）→ validate
        │     ├─ PASS → 交付 AI_REWRITE+AI_REPAIR
        │     └─ non-PASS → fallback
        └─ non-PASS/BLOCK → fallback
```

不变量：Validator 判定与阈值零改动；Repair/Rewrite 各 ≤1 次；无循环；所有失败出口均为 deterministic fallback。

## 5. Phase 5 测试矩阵（route 集成测试）

| # | 场景 | 断言 |
|---|---|---|
| 1 | BLOCK → Rewrite → PASS | 最终 `listing.title` 为 Rewrite 稿、`fallbackUsed=false`、`validation.status=PASS`、`rewriteAttempted=true` |
| 2 | BLOCK → Rewrite → REPAIRABLE → Repair → PASS | `repairListingV5Draft` 被调用 1 次且发生在 Rewrite **之后**；最终 PASS 且来源为 Rewrite+Repair |
| 3 | Rewrite 失败（provider 异常/结构不可用） | 最终为 fallback 稿、`fallbackUsed=true`、`rewriteAttempted=true`、无异常抛出（HTTP 200） |
| 4 | facts 为空 | **不调用** Rewrite（`rewriteAttempted=false`）、直接 fallback |
| 5 | 竞品/sourcing 注入隔离 | provider 收到的 prompt 不含竞品 marker / `1688\|supplier\|moq`；`prohibitedVocabulary` 与 `confirmedFacts` 存在 |

现有测试须保持全绿（`route.test.ts` / `route.trace.test.ts` / `conversionRecovery.test.ts` / `conversionRewrite.spike.test.ts`），并按白名单变更更新 `plannedCalls` 断言。

## 6. Phase 6/7 Holdout 与预算协议

- **必须新建 3–5 个全新真实商品**（未进入 benchmark / writer 调试 / validator 调试 / fixture）。**不得使用 H1–H5 或 H3/H4 作为最终成绩**。
- 冻结字段：`code SHA`、`taskId`、`contextFingerprint`、`factCount`、`vocCount`、`keywordCount`、`competitorCount`。
- 预算 **≤9 次调用**，逐案记录 `writerCalls / rewriteCalls / repairCalls / fallback / finalSource / conversionScore`。
- 指标：`AI_DELIVERED ≥80%`、`fallback ≤20%`、`Safety = 100%`、`Conversion Score ≥85`。**任一不达标即停止，禁止改规则或改评分器。**
- 已知测量前提（`V52_CONVERSION_DESIGN.md`）：`scoreListingV5Conversion` 未接入 route，且五案 `competitorGaps` 全空会让 Differentiation 最高 18/20 → `≥85` 存在结构性触顶风险。**需要你在 Phase 6 前确认测量入口与口径**（benchmark harness 离线计算 vs 新增快照字段），我不会自行改 rubric。

## 7. 未执行部分（如实）

本会话仅完成 Phase 1（本计划 + `V52_CHAIN_AUDIT.md`）。**Phase 2–10 全部未执行**：链路接入、trace/snapshot 收口、5 条集成测试、全新 Holdout 与 9 次真实验证、浏览器 CDP 验收、工程收口、提交、推送、3005 部署、`../archive/releases/FINAL_RELEASE_REPORT_V52.md`。

工作区现状：`M lib/listingV5/generation.ts`（1 行 export 改动）+ `?? lib/listingV5/conversionRewrite*.ts`（Spike，未接线）+ `?? docs/listing-v52/`（6 份文档）；**未 commit / 未 push / 未 merge**；3016 已停止，无临时进程与标签页。

继续实施需要：① 一个新的执行轮次；② Phase 6 的 provider 预算与新 Holdout 商品来源（SellerSprite 新导出，或经你确认符合"全新"口径的现有批次商品）；③ 上面第 6 节末尾的测量口径确认。
