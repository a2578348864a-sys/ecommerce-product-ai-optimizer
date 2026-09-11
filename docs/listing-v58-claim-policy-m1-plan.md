# Listing V5.8 Claim Policy — M1 可执行补丁方案

> **本文档只是方案。本轮未修改任何生产代码 / Prompt / 测试 / 数据库 / 页面，未 commit。**
> 前置：`docs/listing-v58-claim-policy-design.md`（统一架构设计）。
> M1 的定义：**把散落的词表声明收敛到 `claimVocabulary.ts`，两个消费者改为从那里读取；集合内容逐元素不变。**
> M1 **不包含**任何判定变更（隔离清单见 §7）。

---

## 1. 为什么 M1 是纯重构（验收标准 1）

### 1.1 论证结构

M1 只做一件事：把一个 `const X = new Set([...])` 的**声明位置**从 A 文件搬到 B 文件，然后在 A 文件用 `import` 取回同一个值。

| 论证步骤 | 依据 |
|---|---|
| ① 被搬的是**纯字面量数据**，不含逻辑 | 全部 14 个目标符号都是 `new Set([...])` / `Object.freeze([...])` / 字符串常量（§3 逐项列出） |
| ② 搬运后**值不变** | `X` 的元素集合与插入顺序原样保留；`Set.prototype.has()` 语义不变 |
| ③ 读取方式从"本地常量"变为"跨文件 import" | JS 模块语义：同一模块实例、同一对象引用；`lib/` 内无循环依赖（§8 R1） |
| ④ 判定函数体**一行不改** | `isNeutralResidualGrammar`、`uncoveredHardTokens`、`hasUncoveredAttributeAssertion`、`isAnchoredToConfirmedValue` 的代码不变，只是它们引用的名字来源变了 |
| ⑤ 不触碰任何版本常量 | `LISTING_V5_VALIDATION_VERSION` / `*_PROMPT_VERSION` 全部不动（§6.3） |

### 1.2 三个必须守住的行为等价条件

| # | 条件 | 为什么关键 |
|---|---|---|
| **E1** | **元素插入顺序逐位相同** | `conversionBlueprint.ts:181` 用 `Array.from(HARD_OR_ESCALATION_TOKENS)`，其注释 `:178-180` 明示 *"Declaration order is the Validator's own priority order"*。**顺序变了 → `disallowedTemptations` 内容顺序变 → Writer prompt 变 → 行为变**。搬运必须**逐行复制字面量**，不得重排、不得去重、不得格式化 |
| **E2** | **集合基数逐位相同** | 任何"顺手补一个同义词"都会改变判定。M1 禁止增删任何一个词 |
| **E3** | **字符串常量逐字节相同** | `COPULA_ALLOWED_COMPLEMENTS` / `COPULA_NON_COMPLEMENTS` 是**正则片段字符串**，在 `validation.ts:223-231` 被模板拼接成 RegExp。一个空格差异就会改变正则 |

> **反向说明**：`Object.freeze(new Set(...))` 中的 `Object.freeze` 对 `Set` 内部槽**不生效**（冻结的是对象自身属性，不是集合成员）。因此"是否保留 freeze 包裹"**不改变行为**。为降低 diff 噪音，搬运时**原样保留包裹形式**，但这不是等价性的必要条件。

---

## 2. 涉及文件与函数清单（验收标准 2）

### 2.1 被修改的文件（4 个）

| 文件 | 改动性质 |
|---|---|
| `lib/listingV5/claimVocabulary.ts` | **新增声明**（搬入 + 导出）；现有 `HARD_OR_ESCALATION_TOKENS` 位置不动 |
| `lib/listingHandoff/listingClaimEvidenceResolver.ts` | 删除 6 个本地声明，改为 import |
| `lib/listingV5/validation.ts` | 删除 8 个本地声明，改为 import |
| （可选，M1b）`lib/listingHandoff/listingClaimPolicy.ts` | 3 个纯函数下沉 + 反向 re-export |
| （可选，M1b）`lib/listingHandoff/listingRuntimeSkill.ts` | 删除重复的 `canonicalTerm`，改 import |

### 2.2 逐符号清单

#### A. 从 `listingClaimEvidenceResolver.ts` 搬出（6 个）

| 符号 | 现位置 | 现形式 | 在 resolver 内的使用点 |
|---|---|---|---|
| `NEUTRAL_COPY_ALLOWLIST` | `:178-209` | `Object.freeze([...])`，25 条（多为中文） | `:518`, `:860` |
| `RESIDUAL_FUNCTION_WORDS` | `:234-245` | `Object.freeze(new Set([...]))` | `:332` |
| `RESIDUAL_FIELD_NOUNS` | `:248-267` | 同上 | `:333`；并被 `:300-302` 派生出 `CJK_RESIDUAL_WORDS` |
| `RESIDUAL_QUALIFIERS` | `:270-275` | 同上 | `:334` |
| `RESIDUAL_PREDICATES` | `:278-293` | 同上 | `:335` |
| `ASSERTIVE_IMPERATIVE_VERBS` | `:316-321` | 同上 | `:905` |

**留在 resolver 内**（因为是**派生**，不是声明）：
- `CJK_RESIDUAL_WORDS`（`:300-302`，`RESIDUAL_FIELD_NOUNS` 筛中文 + 长词优先排序）
- `RESIDUAL_TOKEN_PATTERN`（`:303-306`，由上一行构造）

#### B. 从 `validation.ts` 搬出（8 个）

| 符号 | 现位置 | 现形式 | 使用点 |
|---|---|---|---|
| `STOPWORDS` | `:162` | `new Set([...])` | `:189`（`contentTokens`） |
| `COPULA_ALLOWED_COMPLEMENTS` | `:201` | **字符串**（regex 片段，10 词） | `:224`, `:229` |
| `COPULA_NON_COMPLEMENTS` | `:207` | **字符串**（regex 片段） | `:224`, `:229` |
| `RELATIONAL_COMPLEMENTS` | `:214` | `new Set([...])` | `:242-265` 区段 |
| `MEASUREMENT_PARTICIPLES` | `:220` | `new Set([...])` | 同上 |
| `ABSOLUTE_HEAD_NOUNS` | `:298-302` | `new Set([...])` | `:325` 区段 |
| `MEASURE_HEAD_NOUNS` | `:303-307` | `new Set([...])` | `isQuantityEnumerationContext` |
| `QUANTITY_QUANTIFIER_TOKENS` | `:316` | `new Set([...])` | 同上 |

#### C. `claimVocabulary.ts` 保留不动
`HARD_OR_ESCALATION_TOKENS`（`:13-21`）—— **位置与内容都不变**。它已被 5 个文件消费
（`validation.ts:5`、`conversionRewrite.ts:29`、`conversionRecovery.ts:25`、`conversionBlueprint.ts:21`、`benefitExpression.ts:2`），M1 **不触碰这些消费点**。

#### D. 不受影响的消费点（M1 预期零改动）
`conversionRewrite.ts` / `conversionRecovery.ts` / `conversionBlueprint.ts` / `benefitExpression.ts` / `listingPlanner.ts` / `listingGenerationService.ts` / `listingClaimPreflight.ts` / `listingCapabilityEvaluation.ts` / `listingCapabilityV2.ts`
—— 它们要么只依赖 `HARD_OR_ESCALATION_TOKENS`（位置不变），要么只调用 `verifyListingClaims`/`classifyClaimPolicy`（公开 API 不变）。

### 2.3 需要保持不变的公开导出
| 导出 | 位置 | 原因 |
|---|---|---|
| `LISTING_V5_HARD_CLAIM_TOKENS` | `validation.ts:173` | 对外 re-export，M1 不改 |
| `verifyListingClaims` / `listingClaimsHaveEvidence` / `buildListingClaimEvidenceIndex` | resolver | 被 10+ 处（含测试）引用，签名不变 |
| `classifyClaimPolicy` / `HIGH_RISK_CLAIM_FIELDS` / `normalizeClaimText` / `canonicalClaimTerm` / `hitsProhibited` | `listingClaimPolicy.ts` | 被 `listingCapabilityEvaluation.ts:12`、`listingCapabilityV2.ts`、`listingClaimPolicy.test.ts` 引用 |

---

## 3. 实施步骤

每个步骤独立可验证、可单独回滚。**建议一次提交只做一个步骤**，便于二分定位。

### S1 — `claimVocabulary.ts` 扩展（只新增，不改现有）

```ts
// 1) 现有：位置不动
export const HARD_OR_ESCALATION_TOKENS: ReadonlySet<string> = new Set([...]);   // :13-21

// 2) 新增：STRUCTURE 层（从 resolver 原样搬入，顺序逐位保留）
export const NEUTRAL_COPY_ALLOWLIST: readonly string[] = Object.freeze([...]);  // 25 条
export const RESIDUAL_FUNCTION_WORDS: ReadonlySet<string> = Object.freeze(new Set([...]));
export const RESIDUAL_FIELD_NOUNS: ReadonlySet<string> = Object.freeze(new Set([...]));
export const RESIDUAL_QUALIFIERS: ReadonlySet<string> = Object.freeze(new Set([...]));
export const RESIDUAL_PREDICATES: ReadonlySet<string> = Object.freeze(new Set([...]));
export const ASSERTIVE_IMPERATIVE_VERBS: ReadonlySet<string> = Object.freeze(new Set([...]));

// 3) 新增：FACT_REQUIRED 层的 shape 参数（从 validation.ts 原样搬入）
export const STOPWORDS: ReadonlySet<string> = new Set([...]);
export const COPULA_ALLOWED_COMPLEMENTS: string = "made|designed|available|included|listed|shown|intended|suited|used|from";
export const COPULA_NON_COMPLEMENTS: string = "that|which|who|whom|whose|of|for|in|on|at|and|or|but|with|to|as|by|near|over|under|into|onto|is|are|was|were|be|been|it|its|this|these|those|there";
export const RELATIONAL_COMPLEMENTS: ReadonlySet<string> = new Set([...]);
export const MEASUREMENT_PARTICIPLES: ReadonlySet<string> = new Set([...]);
export const ABSOLUTE_HEAD_NOUNS: ReadonlySet<string> = new Set([...]);
export const MEASURE_HEAD_NOUNS: ReadonlySet<string> = new Set([...]);
export const QUANTITY_QUANTIFIER_TOKENS: ReadonlySet<string> = new Set([...]);

// 4) 新增：聚合视图（派生，供未来 M2/M3 使用；M1 无消费者）
export function structureTerms(): ReadonlySet<string>;   // FUNCTION ∪ FIELD ∪ QUALIFIER ∪ PREDICATE ∪ ALLOWLIST
export function factRequiredTerms(): ReadonlySet<string>; // = HARD_OR_ESCALATION_TOKENS（M1 阶段）
```

**S1 的硬约束**：`claimVocabulary.ts` 必须保持 **零 import**（除类型外），
因为 route 测试会 mock Validator 模块，而 `claimVocabulary` 必须在该 mock 下继续可用（`claimVocabulary.ts:9-12` 明示）。

### S2 — Resolver 改为 import

```diff
-const NEUTRAL_COPY_ALLOWLIST = Object.freeze([...]);   // :178-209 删除
-const RESIDUAL_FUNCTION_WORDS = Object.freeze(new Set([...]));  // :234-245 删除
-... 其余 4 个
+import {
+  NEUTRAL_COPY_ALLOWLIST, RESIDUAL_FUNCTION_WORDS, RESIDUAL_FIELD_NOUNS,
+  RESIDUAL_QUALIFIERS, RESIDUAL_PREDICATES, ASSERTIVE_IMPERATIVE_VERBS,
+} from "@/lib/listingV5/claimVocabulary";
```
`CJK_RESIDUAL_WORDS`（`:300-302`）与 `RESIDUAL_TOKEN_PATTERN`（`:303-306`）**留在原处**，只是其输入变为 import 来的 `RESIDUAL_FIELD_NOUNS`。

> ⚠️ **依赖方向**：这是 `listingHandoff → listingV5` 的新增引用。当前 `validation.ts:1` 已经是反向（`listingV5 → listingHandoff`），
> 因此**会不会形成循环取决于两者是否互相 import 同一个模块图**。见 §8 R1 —— 必须实测确认，这是 M1 唯一的真实技术风险。

### S3 — Validator 改为 import

```diff
-const STOPWORDS = new Set([...]);              // :162 删除
-const COPULA_ALLOWED_COMPLEMENTS = "made|..."; // :201 删除
-... 其余 6 个
+import {
+  STOPWORDS, COPULA_ALLOWED_COMPLEMENTS, COPULA_NON_COMPLEMENTS, RELATIONAL_COMPLEMENTS,
+  MEASUREMENT_PARTICIPLES, ABSOLUTE_HEAD_NOUNS, MEASURE_HEAD_NOUNS, QUANTITY_QUANTIFIER_TOKENS,
+} from "./claimVocabulary";
```
`:165` 的别名与 `:173` 的 re-export **保持不变**。

### S4（M1b，可选，建议独立提交）— 规范化函数下沉

| 动作 | 说明 | 等价性 |
|---|---|---|
| `normalizeClaimText` / `canonicalClaimTerm` / `hitsProhibited` 从 `listingClaimPolicy.ts:56-87` 下沉到 `claimVocabulary.ts` | `listingClaimPolicy.ts` 改为 `export { ... } from "@/lib/listingV5/claimVocabulary"` | **纯移动**，公开 API 与行为不变 |
| 删除 `listingRuntimeSkill.ts:352` 的重复实现 `canonicalTerm` | 改为 import `canonicalClaimTerm` | **已证等价**：两者都是 `toLowerCase().replace(/[-_\s]+/g,"")`；`canonicalClaimTerm` 中间那步 `replace(/\s+/g," ").trim()` 在最终 `[-_\s]+` 替换下**恒等可约**（`[-_\s]+` 已覆盖所有空白），故输出逐字节相同 |

> S4 让"禁止各路径各自维护同义词表"（`listingClaimPolicy.ts:16`）在实现层成立。
> **M1b 必须先由 S1–S3 落地并验证通过**，以缩小单次变更面。

---

## 4. Conformance 测试设计（验收标准 3）

### 4.1 迁移期"影子比对"（最强证据，必须先做）

在 S1 的同一个提交里，**暂时保留**旧声明并新增比对测试；确认相等后再在 S2/S3 删除旧声明。

```ts
// 临时测试（S2/S3 完成后删除）：证明搬运无差异
import { HARD_OR_ESCALATION_TOKENS as REG_HARD } from "@/lib/listingV5/claimVocabulary";
// ...导入全部 14 个注册表符号

describe("M1 conformance — 搬运前后逐元素一致", () => {
  it("集合基数与插入顺序都相同", () => {
    // Set 的迭代顺序 = 插入顺序，因此 toEqual(Array.from(...)) 同时锁定顺序与内容
    expect(Array.from(REG_RESIDUAL_QUALIFIERS)).toEqual(Array.from(LOCAL_RESIDUAL_QUALIFIERS));
    // 对全部集合重复
  });
  it("正则片段字符串逐字节相同", () => {
    expect(REG_COPULA_ALLOWED_COMPLEMENTS).toBe(LOCAL_COPULA_ALLOWED_COMPLEMENTS);
    expect(REG_COPULA_NON_COMPLEMENTS).toBe(LOCAL_COPULA_NON_COMPLEMENTS);
  });
  it("25 条中性文案逐位相同（含顺序）", () => {
    expect(REG_NEUTRAL_COPY_ALLOWLIST).toEqual(LOCAL_NEUTRAL_COPY_ALLOWLIST);
  });
});
```

**为什么用 `Array.from` + `toEqual` 而不是 `Set` 断言**：`toEqual` 对 `Set` 是**无序**比较，
而 E1（顺序）是本次迁移最容易踩的坑。转成数组才能同时锁住**内容与顺序**。

### 4.2 迁移后常驻的 conformance 测试

| # | 用例 | 断言 |
|---|---|---|
| C1 | 14 个注册表符号的快照 | 逐元素 + 顺序快照（`toMatchInlineSnapshot`）—— 任何人增删一个词都必须显式更新快照 |
| C2 | 硬词表快照 | `Array.from(HARD_OR_ESCALATION_TOKENS)` 快照（**76 词、顺序固定**） |
| C3 | 零依赖 | 静态断言 `claimVocabulary.ts` 无 import（读文件文本断言 / lint 规则） |
| C4 | 聚合视图一致 | `structureTerms()` ≡ 四个集合的并集；`factRequiredTerms()` ≡ 硬词表 |
| C5 | 公开 API 不变 | `validation.ts` 仍导出 `LISTING_V5_HARD_CLAIM_TOKENS`；resolver 仍导出原 3 个函数；`listingClaimPolicy` 仍导出原 5 个符号 |

### 4.3 行为回归（真正的验收）

| # | 命令 | 期望 |
|---|---|---|
| B1 | `npx vitest run listing-v5 listingV5 evidenceBinding benefitPriority benefitCandidate benefitExpression` | 与迁移前**完全同数**通过/跳过（实测基线 **236 passed / 1 skipped**，29 文件） |
| B2 | `npx vitest run listingClaimEvidence` | resolver 全部测试通过（该测试族共 **6 个文件**：`listingClaimEvidenceResolver` / `.legitimate` / `.fieldcoverage` / `.expanded` / `.compositeRegression` / `.r1matrix`） |
| B3 | `npx vitest run listingClaimPolicy listingCapabilityV2 listingRuntimeSkill` | 事实域与 runtime skill 不受影响 |
| B4 | `npx tsc --noEmit` | 0 error |
| B5 | `npm run build` | 成功（验证无循环依赖/打包问题 —— R1 的实测手段） |

**判定口径**：B1–B5 中任何一项的**通过数或跳过数发生变化**（除明确记录的环境性失败外）→ 视为 M1 失败，回滚。

---

## 5. 回滚方式（验收标准 4）

### 5.1 首选：按步骤 revert

M1 不涉及数据迁移、不写库、不改持久化格式 → **回滚是纯代码操作**。

| 场景 | 回滚动作 | 影响面 |
|---|---|---|
| S1 出问题（新增声明有误） | revert S1 提交 | 无消费者，零影响 |
| S2 出问题（resolver 读取异常） | revert S2 提交 | resolver 回退到本地声明；S1 的导出成为死代码（无害） |
| S3 出问题（validator 读取异常） | revert S3 提交 | 同上 |
| 整体回退 | 按 S3→S2→S1 逆序 revert | 回到迁移前状态 |

### 5.2 关键回滚属性（为什么这次回滚很安全）

| 属性 | 说明 |
|---|---|
| **无状态** | 词表是模块作用域常量，无缓存、无 DB、无文件 |
| **无指纹影响** | M1 **不修改任何版本常量**（§6.3），因此 `contextFingerprint` 不变 → **既有快照不失效**、无需重新冻结 |
| **无 schema** | 未触碰 `prisma/` |
| **无 Prompt 影响** | 未触碰 Writer prompt 字符串；`disallowedTemptations` 的**内容**由 E1 保证不变 |
| **可二分** | 4 个步骤独立提交，出问题可精确定位 |

### 5.3 应急预案
若出现"集合内容已变但无法立即定位"的情况：**先 revert 全部 M1 提交**，再在本地重做 S1 并只跑 §4.1 影子比对，用 `Array.from(...).join("|")` 的哈希定位差异集合。

---

## 6. 隔离与边界

### 6.1 明确**不包含**（本次任务指定的 5 项）

| 排除项 | M1 的状态 | 归属 |
|---|---|---|
| **SAFE_BENEFIT 生效**（让 11 条说服词被接受） | ❌ 不做。注册表只**登记**分歧，不改变任何判定 | M3，需单独授权 |
| **Writer prompt 修改** | ❌ 不做。`generation.ts:105-107` 的字符串一字不动 | M2 |
| **Validator 放宽** | ❌ 不做。`isNeutralResidualGrammar` / copula / 锚定逻辑一行不改 | M3 |
| **BLOCK 阈值修改** | ❌ 不做。`MAX_REPAIRABLE_CLAIMS`(`:522`) / `MAX_REPAIRABLE_FIELDS`(`:523`) / `:621,638` 判定式不动 | M4 |
| **reason 语义调整** | ❌ 不做。`isLocallyRepairableClaim`(`:509-511`) 与 14 个 reason code 不动 | M4 |

### 6.2 明确发现的**范围内不处理**的重复品（仅登记）

| 重复品 | 位置 | 为什么不在 M1 |
|---|---|---|
| `NEUTRAL_ALLOWLIST`（15 条**英文**中性文案） | `safeListingFallback.ts:25`，注释自称"与 Claim Evidence 的 `NEUTRAL_COPY_ALLOWLIST` 同源语义" | 与 resolver 的 25 条（多为中文）**内容不同**，合并会改变 fallback 行为 → 属行为变更，**不得夹带进 M1** |
| `canonicalTerm` | `listingRuntimeSkill.ts:352` | **已证与 `canonicalClaimTerm` 等价**，可安全并入 → 归 M1b（S4）单独提交 |

### 6.3 版本常量：一个都不许动

| 常量 | 位置 | M1 动作 |
|---|---|---|
| `LISTING_V5_VALIDATION_VERSION` | `types.ts` | **不动**（行为未变，升版反而会误废快照） |
| `LISTING_V5_STRATEGY_PROMPT_VERSION` / `LISTING_V5_WRITER_PROMPT_VERSION` | `types.ts` | **不动** |
| `LISTING_CLAIM_POLICY_VERSION` | `listingClaimPolicy.ts:21` | **不动** |
| `LISTING_V5_HARD_CLAIM_TOKENS`（导出名） | `validation.ts:173` | **不动** |

---

## 7. 风险与缓解

| # | 风险 | 触发 | 后果 | 缓解 | 残余 |
|---|---|---|---|---|---|
| **R1** | **循环依赖**（本次唯一真实技术风险） | resolver 新增 `listingHandoff → listingV5` 引用，而 `validation.ts:1` 已是 `listingV5 → listingHandoff` | 打包/运行时循环；Next 构建可能报错或行为异常 | ① `claimVocabulary.ts` 保持零依赖（它不 import 任何东西，因此**不构成环**）；② B5 `npm run build` 作为硬门禁；③ 若仍成环，改用类型无关的第三落点（如 `lib/claim/*`）—— 需重新授权 | 低 |
| R2 | **顺序被无意打乱**（E1） | 搬运时格式化/去重/排序 | `disallowedTemptations` 顺序变 → Writer prompt 变 | §4.1 影子比对 + C1/C2 快照 | 低 |
| R3 | **集合被顺手增删**（E2） | 实现者"顺手补个同义词" | 判定变化 | C1/C2 快照 + 迁移前后 B1 同数 | 低 |
| R4 | **正则片段字符串被改**（E3） | 拼接时调整空白 | copula 正则变化 | 字符串 `toBe` 断言 | 低 |
| R5 | **`Object.freeze` 语义误解** | 以为 freeze 能保护 Set | 误删包裹导致 diff 噪音（非行为变化） | §1.2 反向说明 | 极低 |
| R6 | **M1b 夹带行为变更** | S4 合并 fallback 的 15 条列表 | fallback 文案变化 | §6.2 明确排除；S4 单独提交 | 中 |
| R7 | **误改版本常量** | 认为"重构要升版" | 全量快照失效、需重新冻结 | §6.3 清单 + review 检查项 | 低 |
| R8 | **跨链打包** | `listingHandoff` 被更早的打包边界引用 | 构建体积/边界问题 | B5；必要时改落点（同 R1③） | 低 |

---

## 8. 执行清单（可直接照做）

| 序 | 提交 | 内容 | 完成判据 |
|---|---|---|---|
| 1 | `refactor(claim): add claim vocabulary registry` | S1 + §4.1 影子比对测试 | 影子比对全绿；B4/B5 通过；**无消费者改动** |
| 2 | `refactor(claim): resolver reads the registry` | S2，删除 6 个本地声明与影子测试中对应部分 | B2 通过数不变；B5 通过 |
| 3 | `refactor(claim): validator reads the registry` | S3，删除 8 个本地声明与影子测试 | **B1 与迁移前同数（236/1）**；B4/B5 通过 |
| 4 | `test(claim): lock the vocabulary registry` | §4.2 C1–C5 常驻快照测试 | 快照固定；C3 零依赖断言通过 |
| 5 | （可选，M1b）`refactor(claim): single canonicalisation` | S4 | B3 通过；`canonicalTerm` 删除后无引用 |

**每一步的 review 检查项**：① 无版本常量改动；② 无 Prompt 字符串改动；③ 无判定逻辑改动；④ 无新增/删除词；⑤ 顺序未变。

---

## 9. 未验证事项（如实）

1. **R1 循环依赖未实测**：本文只做静态推理（`claimVocabulary` 零依赖 ⇒ 不构成环），**未运行 `npm run build` 验证**（本轮不执行构建）。
2. **影子比对测试的可行性未验证**：`listingClaimEvidenceResolver.ts` 的 6 个集合目前是**模块私有** `const`，只有把它们同时导出才能做双份比对；实现 S1 时需确认这一步不会改变其公开 API（预期不会，因为是从私有变导出）。
3. **`LISTING_V5_HARD_CLAIM_TOKENS`（`validation.ts:173`）的实际消费者未确认**：静态检索未发现非测试消费者（各消费方直接 import `claimVocabulary`）。M1 保留它不变，但其"是否已是死代码"需单独确认。
4. **测试基线取自当前工作树**（`236 passed / 1 skipped`）。工作树含多个未提交轮次的改动，若期间他人在同一分支改动，基线需重新采集。
5. **未评估 `lib/listingV5 → lib/listingHandoff` 反向依赖的体积/边界影响**（`validation.ts:1` 已经存在该依赖）。
