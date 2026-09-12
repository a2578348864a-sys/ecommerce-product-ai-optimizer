# Listing V5 v6 — 最终冻结审计记录

- 日期：2026-09-12
- 仓库：`D:\Workspace\projects\project-001-listing-v5`，分支 `feat/listing-v5-rebuild`
- **冻结提交：`bfd9420`**（其上为 `6ae6b50` → `4233ae3` → `eb2ce0d`）
- 上一冻结里程碑：V5.7 @ `235e11b`（见 `docs/listing-v57/V57_STATE.md`，历史记录不改写）；V5 @ `eb2ce0d`（见 `docs/listing-v5/FINAL_FREEZE_V5.md`，该文件为另一工作流的未提交草稿）
- 本文件只记录审计与版本事实，不含功能变更。

---

## 1 版本信息（可复现所需）

| 项 | 值 |
| --- | --- |
| Validator | `listing-v5.validation.v6` |
| Strategy prompt | `listing-v5-strategy.v6` |
| Writer prompt | `listing-v5-writer.v6` |
| Repair / Rewrite / Recovery prompt | `listing-v5-repair.v3` / `listing-v5-rewrite.v1` / `listing-v5-recovery.v1` |
| 数据形状版本 | context `v1` / strategy `v1` / writer-draft `v1` / evidence-binding `v1` / benefit-priority `v1` / benefit-candidate `v1` |
| 生成链路（有界） | `writer → validate →(REPAIRABLE) repair≤1 → validate →(未 PASS) rewrite≤1 → validate →(REPAIRABLE 且 repair 未用过) repair≤1 → validate →(未 PASS) recovery≤1 → validate → 确定性 fallback` |
| 预算记账 | 预占 provider 调用 `1 / 4 / 5`（analyze_strategy / 有缓存 strategy / 无缓存） |

运行时自检（`runCaseD --dry-run`，0 次 provider 调用）输出为 `strategy v6 / writer v6 / validator v6 / repair v3`，与源码字面量一致。

`contextFingerprint` 计入提示词与校验版本：本次 v5→v6 升级使此前持久化的 Listing V5 快照指纹失效，需按既有流程重新执行 `decision → complete → handoff` 才能复用缓存策略。

## 2 本次冻结审计的两次提交

| 提交 | 内容 | 文件 |
| --- | --- | --- |
| `6ae6b50` | 策略/Writer prompt 与 Validator 对齐：策略框架只能用确认事实词汇表达，不得写成结果承诺或引入事实未声明的形容词；Writer 不得照抄策略里的结果承诺 | `lib/listingV5/{strategy,generation,types}.ts`、`promptContract.test.ts` |
| `bfd9420` | 单句单字段 claim 家族（numeric / dimension / compatibility）由 BLOCK 改为 REPAIRABLE，避免一句话毁掉整稿；出口门不变 | `lib/listingV5/{validation,types}.ts`、`validationRepairability.test.ts` |

审计逐项确认（依据 `git show` 逐行 diff）：

| 审计项 | 结论 | 依据 |
| --- | --- | --- |
| strategy/writer/validator v6 版本一致 | ✅ | `types.ts` 三处字面量均为 v6；运行时 banner 一致 |
| 未降低安全规则 | ✅ | 未改动任何判据：`uncoveredHardTokens`、`uncoveredAttributeAssertions`、`describeUnsupportedSegment`、`isAnchoredToConfirmedValue`、prohibited / competitor / 结构校验、`status` 计算全部逐字节未变；仅 `isLocallyRepairableClaim` 的 reason 集合变化 |
| 未改变 evidence 纪律 | ✅ | 未触碰 `evidenceBinding` / `claimTrace` / `factIds` / `factAnchorValues` / `confirmedModelCodes` 任何逻辑 |
| 未绕过 human_confirmed | ✅ | 事实来源仍为 `sourceRefs: ["human_confirmation"]`；model 证据仍只认 `canonicalField === "series_or_model"`；prompt 变更只增加约束 |
| 未影响 fallback 机制 | ✅ | `fallback()` / `buildListingV5FallbackDraft` / route 的 REPAIRABLE→repair、非 PASS→fallback 触发条件均未改动；变化仅在于「此前必然 BLOCK 的稿件现在有一次有界修复机会」，仍必须 PASS 才交付，否则照旧 fallback |

反向断言（`validationRepairability.test.ts`）锁定：认证 / 绝对承诺 / 违规词三类仍为 BLOCK，且「超过上限的 claim/字段数」仍为 BLOCK；`git diff` 中所有安全相关词命中均出现在注释里，无代码行变化。

## 3 当前版本能力（已实现且可核验）

- 研究完成 → `factCandidates` 人工确认 → `creativeHandoff` → V5 gate → Listing 生成 → validation/snapshot 持久化。
- Listing 生成全程受 **Confirmed Facts 唯一事实权威**约束；VOC / 关键词 / 竞品 / 货源仅作 framing，不进入事实。
- 生成链路有界：repair ≤1、rewrite ≤1、recovery ≤1、末位确定性 fallback；Validator 是唯一安全门。
- 策略（Strategy）确实进入 Writer 上下文（`strategy` + `conversionBlueprint` + `benefitExpressions` + `keywordIntent`），Case-D 实测策略来源的场景 / 痛点 / 排序 / 角度均出现在稿件中。
- AI 状态展示为服务端权威（启用→provider/model；未启用→安全演示模式），界面无法伪造 AI 开启。

## 4 已解决问题（本轮）

1. **策略诱导的结果承诺导致整稿被丢弃**：实测同一测试商品、同一链路，AI 稿件因「weighted base → stay in place」（`unsupported_dimension_claim`，不可修复）判 BLOCK → 交付确定性模板，策略框架 100% 丢失。修复后同一 fixture 首检 PASS、`fallbackUsed=false`，交付 AI 文案。
2. **prompt 与 Validator 互相矛盾**：prompt 鼓励「收益」，Validator 拦截「事实未声明的结果」；现已把边界写进策略与 Writer prompt。
3. **同草稿零调用复算证据**（`holdout-evidence/strategy-audit/`）：`caseD-before` 与 `caseD-after` 两份曾被判 BLOCK 的稿件，在同一文本、仅换判据的情况下均变为 REPAIRABLE（修复目标分别为 `bullets[4]+description`、`bullets[1]+bullets[3]`）。

## 5 已知非阻塞问题

### 5.1 已审计未修改（需排期，均不影响安全不变量）

1. **检测器三类纯误报**：代词 + 进行时动词（`you are checking`）、wh- 词（`is what the listing states`）、量词（`are both included` 的 `both`）被当作属性形容词；颜色语境 `warm`（`warm autumn colours`）被当作热性能硬词。当前代价是「多一个修复目标」，不再丢整稿。
2. **静默删词**：`sanitizeStrategyForCopy` / `sanitizeBlueprintForPrompt` / `clean()` 直接删除风险词，可能留下残句（旧基线出现 `removable, reusable, and .`）。
3. **策略字段级可追踪性缺失**：`claimTrace` 只追 claim→factId，不追策略字段；只能人工比对。
4. **prompt 未逐字段要求** `targetAudience` / `useCases` / `primaryAngle` / `tone`（仅总述 + payload）。
5. **两处说明性文案**在 stale 商品详情页仍含「研究已完成」（`commercial-inputs-stale`、`product-research-decision-readonly-completed`），与同页「修改人工决定」入口的既有服务端契约冲突，属产品决策项。

### 5.2 环境类测试失败（非代码问题，未修改任何测试）

全量：**7560 passed / 5 failed / 90 skipped**（5 个失败文件）；隔离复跑后：

| 套件 | 全量 | 隔离 | 判定 |
| --- | --- | --- | --- |
| `lib/listingHandoff/listingOperatorCopy.test.ts` | 1 failed | **1 failed** | 数据前置：该用例依赖本地真实任务 `cmtdgivs6000nutmvkeymtg83`，该任务已不存在（`GET /api/tasks/cmtdgivs6000nutmvkeymtg83` → 404，`prisma/dev.db` 今日被重写）→ 环境/数据问题 |
| `lib/server/native1688Bridge.security.test.ts` | 2 failed | **3 passed** | 负载与端口竞争（外部 1688 CLI PID 34712 占用端口、5s 超时） |
| `lib/server/demoSandbox.store-consistency.test.ts` | 1 failed | **9 passed** | 5s 超时（并发负载） |
| `lib/server/sourcingAcquisition.test.ts` | 1 failed | **41 passed** | 端口占用：`1688 图片扩展桥接端口 (53318) 被外部非项目进程 (PID 34712) 占用` |
| `lib/server/native1688Bridge.integration.test.ts` | file-level fail（11 skipped） | — | 配置中被 CI 排除的集成套件（`vitest.config.ts` `CI_EXCLUDED_TESTS`） |

## 6 冻结验证结果

| 检查 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 0 error |
| `npm run lint` | 0 error / 7 warning（全部既有：`no-img-element` ×5、`no-location-assign-relative-destination` ×2） |
| `npm run build` | 通过（exit 0） |
| `vitest run lib/listingV5` | 30 文件 / **227 passed** |
| `vitest run`（Listing 链路：route + handoff + vrc + handoff preview） | 876 passed / 1 failed（同上 5.2 数据前置项） |
| `vitest run`（全量） | 7560 passed / 5 failed / 90 skipped（失败全部为 5.2 环境类） |
| 运行时 | 3005 `{"ok":true}`；`runtime-mode = local_owner, noAuthOwner, v4GraphEnabled` |

**v6 行为样本说明**：v6 目前的实测样本是 Case-D 单案（改前 BLOCK / 改后 PASS，2 次 provider 调用 + 同草稿零调用复算）。`docs/listing-v57/V57_STATE.md` 的 C1/C4/C7 三案 holdout 数字属 **v4 时代**测量，未在 v6 重跑（需 3 次 provider 调用并重新冻结指纹），**不得当作 v6 指标引用**。

## 7 Git 状态

- HEAD：`bfd9420`；分支 `feat/listing-v5-rebuild`，相对 `origin/feat/listing-v5-rebuild` **ahead 2**（`6ae6b50`、`bfd9420` 未推送），**未合并 main、未推送**。
- 已存在 tag **`project-001-v5-final` → `4233ae3`**（V5 冻结点，与之相差 2 个提交：`6ae6b50`、`bfd9420`）。即 **v6 的两次提交尚未被任何 tag 覆盖**；是否补 tag 由发布流程决定。
- 本文件与版本同步改动（`README.md`、`docs/listing-v57/V57_STATE.md`、`docs/listing-strategy-planner/implementation-plan.md`、`docs/listing-v5/FINAL_FREEZE_V6.md`）为工作区未提交状态。
- 工作区另有他人未提交文件 `docs/listing-v5/FINAL_FREEZE_V5.md`（另一工作流，本审计未触碰）。

## 8 是否可以进入作品集阶段

**可以进入（有条件）**：

- 可以陈述：链路端到端可复现、事实权威与人工确认边界、Validator 唯一安全门、有界重试与确定性 fallback、AI 状态服务端权威、审计与证据位置。
- 不要陈述：v6 的 PASS 率 / 转化率提升（仅有单案样本）；三案 holdout 平均分属于 v4 时代；全量测试「全绿」（存在 2 项需说明的环境类失败）。
- 建议在作品集定稿前完成（可选，各需授权）：① 在 v6 重跑三案 holdout 并重新冻结指纹；② 清理 `FINAL_FREEZE_V5.md` 的未提交状态；③ 决定 v6 是否需要一个新 tag（现有 `project-001-v5-final` 指向 `4233ae3`，不含 v6 两次提交）；④ 排期 5.1 中的检测器误报与静默删词。
