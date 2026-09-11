# V5.2 链路审计（Phase 1，只读）

- **基线**：`9cf1962`（feature branch `feat/listing-v5-rebuild`）
- **依据**：本会话对 `app/api/tasks/[id]/listing-v5/route.ts`、`lib/listingV5/{conversionRecovery,generation,validation,structuredRepair,trace,types}.ts` 的实测阅读，以及四份审计文档（`V52_ARCH_AUDIT.md` / `V52_CONVERSION_DESIGN.md` / `V52_SECURITY_REVIEW.md` / `V52_TEST_PLAN.md`）与 `V52_SPIKE_REPORT.md`。**行号以审计文档当前版本为准**，本文按结构描述，避免引用漂移。

## 1. 当前 generate 状态机（实测）

```
POST /api/tasks/[id]/listing-v5
  ├─ auth（owner / demo）· action 白名单（analyze_strategy | generate）
  ├─ useProvider = isRealAiListingEnabled() · confirmRealAi 校验
  ├─ quota：reserveDemoAiCalls(plannedCalls)   ← plannedCalls = analyze 1 / 有缓存 3 / 无 4
  ├─ job lock：ACTIVE_V5_JOBS（同 task+fingerprint 并发 → 409）
  └─ try
       ├─ strategy：cachedStrategy 命中则复用（指纹 + strategyPromptVersion 门禁），否则 analyzeListingV5Strategy
       ├─ 若 action === "generate"：
       │    ├─ generateListingV5Draft(...)                    → writerTrace / provider.writerAttempted
       │    ├─ validateListingV5Draft(...)                    → firstValidation
       │    ├─ if (status === "REPAIRABLE")                   ← ★repair 唯一入口
       │    │     repairListingV5Draft(...)（≤1 次，targets ≤3）
       │    │     validateListingV5Draft(...)                 → 复验
       │    ├─ if (status !== "PASS" && useProvider)          ← ★Safe Recovery 入口（BLOCK 也会进）
       │    │     recoverListingV5Draft(...)（≤1 次）→ 若成功则复验
       │    └─ if (status !== "PASS")                         ← ★fallback 闸门（BLOCK 落点）
       │          draft = buildListingV5FallbackDraft(...)
       │          fallbackReason = "validation_blocked"; fallbackUsed = true；复验 fallback 稿
       ├─ snapshot 组装（含 provider / validation / strategy / listing）
       ├─ buildContext 复算指纹比对 → 不一致则 409 listing_v5_stale_context
       └─ CAS 持久化（mutateTaskResultJson）
```

**关键结构事实**

1. **BLOCK 分支位置**：BLOCK 不会进入 `repair` 分支（repair 的守卫是 `status === "REPAIRABLE"`），而是直接落到 fallback 闸门 `if (status !== "PASS")`。因此当前链路是 `BLOCK → fallback`，没有任何中间救援——这正是 V5.2 要改的点。
2. **Repair 调用位置**：唯一入口在 `REPAIRABLE` 分支内，BLOCK 时 `repair.allowed === false`、`targets === []`，结构不可达（`V52_TEST_PLAN.md` 已证）。
3. **Safe Recovery**：入口条件 `status !== "PASS" && useProvider`，BLOCK 亦满足；实测 H1/H3/H4 触发过（`provider.recoveryAttempted=true`）。
4. **trace builder**：调用点**未传** recovery 相关参数，导致 `trace.recoveryAttempted` 恒 false、`stages.recovery` 恒 `stage_not_run`（接线盲区，`V52_ARCH_AUDIT.md` 已证）；V5.1 的调用计数因此被系统性少报。
5. **snapshot provider**：`provider` 对象在 route 内被写入 `recoveryAttempted`，并经 `safeSnapshot` **原样透传**（未逐字段白名单）——V5.2 需一并收口。
6. **阈值**：`MAX_REPAIRABLE_CLAIMS=4 / FIELDS=3 / TARGETS=3`（`validation.ts`）。H3/H4 的 unsupported 计数 5/9 越界 → BLOCK，这是 Spike 中 Rewrite 把两案迁移成 `REPAIRABLE(4)/(3)` 后**重新落回 repair 可达区间**的原因。

## 2. V5.2 目标链（按指令）

```
Writer → Validator
   ├─ PASS → 交付（source = WRITER）
   └─ REPAIRABLE → Repair → Validator
        ├─ PASS → 交付（source = AI_REPAIR）
        └─ non-PASS
BLOCK →（二者汇合）→ Conversion Rewrite（≤1 次）→ Validator
        ├─ PASS → 交付（source = AI_REWRITE）
        ├─ REPAIRABLE → Repair（≤1 次，全局仅一次）→ Validator
        │     ├─ PASS → 交付（source = AI_REWRITE + AI_REPAIR）
        │     └─ non-PASS → fallback
        └─ non-PASS/BLOCK → fallback
```

**必须守住的不变量（来自安全审计）**

- Validator 判定标准与阈值**零改动**；Rewrite/Repair 产出稿**必然重过同一 Validator**；
- 生成分支内 Repair 与 Rewrite **各至多一次**，不引入循环；
- Rewrite 输入白名单：`confirmedFacts` / `buyerIntent` / `painPoints` / `benefitOrder` / **已 sanitize 的 blueprint**；**禁止** competitor 原文、sourcing、provider trace、raw validator offending text；
- Rewrite 任何异常（缺 facts、provider 异常、结构不可用）→ **直接 fallback，不抛错**；
- Judge/评分**不得**写入 `validation.status`。

## 3. 最小改动清单（Phase 2–4 的落点，尚未实施）

| # | 改动 | 位置 | 说明 |
|---|---|---|---|
| 1 | 在 fallback 闸门之前插入 Rewrite 分支 | `route.ts` generate 块（Recovery 之后 / fallback 之前） | `status !== "PASS"` 时调用 `rewriteListingV5Draft`，成功后复验 |
| 2 | Rewrite 后接 Repair（复用现有 Repair，**全局仅一次**） | 同处 | 需新增 `repairUsed` 布尔守卫，避免同一生成出现两次 repair |
| 3 | `plannedCalls` 同步 | quota 预留处 | 当前最坏 = 1/3/4，加 Rewrite 后最坏 = 2/4/5；**不同步会在 mark 时抛错 → 500** |
| 4 | trace 字段补齐并真实传参 | `buildListingV5ExecutionTrace` 调用点 | 新增 `rewriteAttempted / rewriteSuccess / rewriteValidationBeforeRepair`，并把 recovery/rewrite 变量真正传入（消除盲区） |
| 5 | `safeSnapshot` 的 `provider` 改为**逐字段白名单** | `safeSnapshot` | 禁止原样透传；新字段给默认值；**不要动 snapshot `version` 字符串**（否则旧快照整份被判失效） |
| 6 | Rewrite 模块加固 | `lib/listingV5/conversionRewrite.ts` | 已在 Spike 中补：复用 `sanitizeBlueprintForPrompt`、`backendSearchTerms` 过 `HARD_OR_ESCALATION_TOKENS`、`facts=[]`/坏响应 fail-closed；正式接入时需再确认白名单输入（不含 raw offending text） |

## 4. 与其他文档的关系

- `V52_SPIKE_REPORT.md`：Rewrite 单步在 H3/H4 上把 `BLOCK(5)/(6)` 迁移为 `REPAIRABLE(4)/(3)`，但**未达 PASS**；本链路的第 2 项（Rewrite 后接一次 Repair）正是把该发现变成可用路径的最小手段。
- `V52_CONVERSION_DESIGN.md`：提示五字段与验收门槛；注意其提出的结构性风险——五案 `competitorGaps` 全空使 Differentiation 最高 18/20，`Conversion Score ≥85` 存在触顶风险，且 `scoreListingV5Conversion` 尚未接入 route（缺测量入口）。

## 5. 本阶段结论

- Phase 1（只读）**完成**，产出本文件；
- Phase 2–10（接入、测试、新 Holdout 真实验证、浏览器、收口、提交、部署、`../archive/releases/FINAL_RELEASE_REPORT_V52.md`）**未执行**：本会话执行预算已耗尽，且 Phase 6 需要新的 provider 预算与 3 个全新 Holdout（不得用 H3/H4 作为最终成绩）。
- 未产生任何源码改动：`git status` 仅剩 `M lib/listingV5/generation.ts`（v5.1 轮遗留的 1 行 export 改动）、`?? lib/listingV5/conversionRewrite*.ts`（Spike 产物）与 `?? docs/listing-v52/`；**未 commit / 未 push / 未 merge**。
