# Listing V5.8 — Claim Policy 统一架构设计

> **设计文档。本轮不修改任何生产代码 / Prompt / Validator / 数据库 / 页面，不新增 AI 调用，不 commit。**
> 本文是 Phase 6 之前的架构设计；所有"未来迁移"均标注为**需单独授权**。
> 阅读顺序建议：§0 结论 → §4 冲突的形式化 → §7 迁移路径 → §8 风险。

---

## 0. 结论先行

1. **不新增第五套规则**。统一后的 Claim Policy **就是**现有 `lib/listingV5/claimVocabulary.ts` 的扩展 —— 该文件已经自我声明为"claim 措辞的唯一真值源"（`claimVocabulary.ts:5-8`），并且已经被 Validator 与 Conversion Blueprint 共同消费（`validation.ts:168-173`）。本设计是**把这个已存在的模式补完**，而不是另立一套。
2. **本设计不改变任何现有判定结果**。它把四套规则**登记**到同一个 4 层 tier 模型里，并以"当前行为"为唯一基准（conformance-first）。
3. **形式化后的核心发现**：在**当前 Validator 行为**下，`SAFE_BENEFIT` 层是**空集** ——
   Writer 明文批准的 11 条说服词（`generation.ts:107`）一条都不在其中。这不再是"词表没对齐"，而是**架构层面的 tier 空缺**（§4）。
4. `listingClaimPolicy.ts:16` 已经确立了"**禁止各路径各自维护同义词表，全部走本模块**"的原则，但只覆盖**事实域**。
   本设计把同一条原则延伸到**文案域**，并把两域合并到同一模块家族、共用同一套规范化与禁语匹配函数（§6.2）。

---

## 1. 设计原则（不可协商）

| # | 原则 | 理由 |
|---|---|---|
| P1 | **Conformance-first**：注册表必须能**逐字复现**当前四套集合，否则视为设计错误 | 迁移不能改变判定 |
| P2 | **Fail-closed 默认**：查不到的 token 一律按 `FACT_REQUIRED` 处理 | 与当前 Resolver 的闭世界语义一致（`listingClaimEvidenceResolver.ts:327-335`） |
| P3 | **单一声明点**：任何词只在一个地方声明它属于哪一层 | 现状 4 套词表各自维护是冲突根源 |
| P4 | **纯数据、零依赖**：词表模块不得 import 任何运行时模块 | `claimVocabulary.ts:9-12` 明示：route 测试会 mock Validator，词表必须继续可用 |
| P5 | **放宽与收紧都必须显式**：任何 tier 变更都要单独授权 + holdout 复测 | V5.6/V5.7 的历史（`validation.ts:103-106` 记录了被评估后**未采纳**的更宽促销守卫） |
| P6 | **不新增第 5 套**：新结构必须是现有集合的**并集登记**，不得引入任何新词 | 验收标准 1 |

---

## 2. 现状盘点：四套规则各自的"域"

| # | 规则源 | 位置 | 规则域 | 当前消费者 |
|---|---|---|---|---|
| R1 | Writer 两张词表 | `generation.ts:105-107` | **文案**（提示词声明） | Writer LLM |
| R2 | V5 Validator 检测器 | `validation.ts:165,200-231,341-448,528-651` | **文案**（判定） | 出稿门禁 |
| R3 | 遗留 Claim Evidence Resolver | `listingClaimEvidenceResolver.ts:48-61,178-293,316-321,364-372` | **文案**（判定） | R2 的上游证据源 |
| R4 | `claimVocabulary.HARD_OR_ESCALATION_TOKENS` | `claimVocabulary.ts:13-21` | **文案**（共享词表） | R2 + Blueprint |
| R5 | `listingClaimPolicy` | `listingClaimPolicy.ts:21-118` | **事实**（值分级） | 各生成路径的事实门禁 |

**关键观察**：
- R4 是**唯一已经共享**的规则源，但只覆盖 hard token。
- R5 是**另一个域**（事实值，不是文案），它有自己的"唯一裁决出口"定位（`:3-6`）与三档 tier（`verified|review|prohibited`，`:23`）。
- **R1 与 R2/R3 之间没有任何机械联系** —— Writer 的词表是 prompt 字符串里的硬编码，Validator 的词表在代码里。这是 §4 冲突的成因。

---

## 3. 统一数据结构

### 3.1 四层 tier

| Tier | 语义 | 判定 | 是否需证据 |
|---|---|---|---|
| **STRUCTURE** | 纯语法材料：功能词、字段名词、中性连接谓语、中性限定词、中性文案允许集 | **闭集内即放行** | 否 |
| **SAFE_BENEFIT** | 已批准的说服表达（单词级优先） | **闭集内即放行** | 否 |
| **FACT_REQUIRED** | 属性断言、性能/认证/时长词、型号码、度量分词 | **须被证据覆盖才放行** | 是 |
| **PROHIBITED** | 绝对宣称、8 类高危、上下文禁语 | **一律拦截** | 否（证据也不放行） |

### 3.2 类型草案

```ts
/** 该词被放行所需的证据种类。仅对 FACT_REQUIRED 有意义。 */
export type ClaimCarrier =
  | "confirmed_fact_value"        // 词/短语出现在某条确认事实值中
  | "confirmed_model_code"        // 由 canonicalField === "series_or_model" 的确认值覆盖
  | "human_confirmation_metadata" // 需 explicitHighRiskConfirmed 元数据
  | "none";                       // 不需要证据（STRUCTURE / SAFE_BENEFIT）

export type ClaimTier = "STRUCTURE" | "SAFE_BENEFIT" | "FACT_REQUIRED" | "PROHIBITED";

/** 谁声明 / 谁执行 —— 分离这两个概念是本文档能表达"冲突"的关键。 */
export type ClaimConsumer =
  | "writer_prompt"        // R1
  | "v5_validator"         // R2
  | "legacy_resolver"      // R3
  | "conversion_blueprint" // 消费 R4 的上游
  | "fact_policy";         // R5

export type ClaimPolicyEntry = {
  /** 规范形（小写、连字符/空格归一），与 canonicalClaimTerm 对齐。 */
  term: string;
  tier: ClaimTier;
  carrier: ClaimCarrier;
  /** 今天由谁把它当规则执行。 */
  enforcedBy: readonly ClaimConsumer[];
  /** 今天由谁把它当规则声明（可能无人执行 → 即冲突）。 */
  declaredBy: readonly ClaimConsumer[];
  /** 可追溯来源：文件 + 符号（本文档中的行号在实现时转为符号名）。 */
  source: string;
  /** 已知分歧说明；仅记录，不改变判定。 */
  note?: string;
};

export type ClaimPolicyRegistry = {
  version: "listing-claim-policy.v2";
  entries: readonly ClaimPolicyEntry[];
};
```

### 3.3 查询接口（纯函数）

```ts
/** 闭世界查询：查不到返回 "UNKNOWN"。 */
export function tierOf(term: string): ClaimTier | "UNKNOWN";

/** 供 Validator / Resolver 使用的集合视图（与今天的行为逐字一致）。 */
export function structureTerms(): ReadonlySet<string>;
export function factRequiredTerms(): ReadonlySet<string>;
export function prohibitedTerms(prohibitedClaims: readonly string[]): ReadonlySet<string>;

/** 供 Writer prompt 生成使用（未来 M2）。 */
export function writerVocabulary(): {
  bannedUnlessFactBacked: readonly string[];   // 今天等价于 generation.ts:106
  persuasion: readonly string[];               // 今天等价于 generation.ts:107
  neverInvent: readonly string[];              // 今天等价于 generation.ts:105
};

/** 一致性审计：声明层与执行层不一致的条目。 */
export function divergences(): readonly ClaimPolicyEntry[];
```

**`tierOf` 的 fail-closed 语义**：未知 token 返回 `"UNKNOWN"`，调用方必须按 `FACT_REQUIRED` 处理（P2）。

---

## 4. 现有规则 → 四层 tier 的映射

### 4.1 STRUCTURE（闭集，无需证据）

| 来源 | 内容 | 位置 |
|---|---|---|
| FUNCTION 功能词 | the/a/an/this/…/about/around/while/only/more/most | resolver `:234-245` |
| FIELD 字段名词 | product/brand/material/size/capacity/count/pack/use/care/…（含中文字段词） | resolver `:248-267` |
| QUALIFIER 中性限定词 | everyday/daily/practical/**easy/easily/simple/simply**/general/regular/normal/common/typical/basic/convenient/suitable/available/made/built/designed/included/together | resolver `:270-275` |
| PREDICATE 中性连接谓语（**受位置约束**） | is/has/includes/measures/**fits**/comes/features/provides/**prevents**/helps/reduces/resists/… | resolver `:278-293` |
| 中性文案允许集 | 25 条冻结短语 | resolver `:178-209` |
| 数量枚举豁免 | `in total` / `Total: 4 Pcs` / `total pack size` 等读作计数 | `validation.ts:285-336` |

> ⚠️ PREDICATE 有位置约束（resolver `:224-230`）：谓语一旦出现，**其后每个 token 仍须落在四层之内**。
> 因此 STRUCTURE **不是无条件的**，注册表必须同时记录这条结构性约束（属于 tier 之外的 shape rule）。

### 4.2 FACT_REQUIRED（须证据覆盖）

| 来源 | 内容 | 载体 | 位置 |
|---|---|---|---|
| 硬词表 | `HARD_OR_ESCALATION_TOKENS` 76 词 | `confirmed_fact_value` | `claimVocabulary.ts:13-21` |
| copula 属性断言 | `copula + [a-z][a-z-]*`（非冠词/非允许补语/非功能词） | `confirmed_fact_value` | `validation.ts:200-231,242-265` |
| copula 允许补语 | made/designed/available/included/listed/shown/intended/suited/used/from | `confirmed_fact_value` | `validation.ts:201` |
| 型号码 | `series_or_model` 字段的确认值 | `confirmed_model_code` | `validation.ts:82-97,428-435` |
| 度量分词 | sized/measured/weighed | `confirmed_fact_value`（且句内需有确认数值） | `validation.ts:216-220,259` |
| 关系名词 | place/spot/home/role/purpose/use/sense/look/feel/way | `confirmed_fact_value` | `validation.ts:214` |
| 祈使护理动词 | rinse/wipe/wash/dry/place/store/handle/clean/… 24 词 | `confirmed_fact_value` | resolver `:316-321` |
| 高风险字段（事实域） | functional_feature/care/cleaning/insulation/certification/performance/duration/compatibility/operation/construction | `human_confirmation_metadata` | `listingClaimPolicy.ts:42-53,109-114` |

### 4.3 PROHIBITED（证据也不放行）

| 来源 | 内容 | 位置 |
|---|---|---|
| 8 类高危正则 | material / dimension / certification / compatibility / **performance** / origin / **effect** / **absolute** | resolver `:364-372` |
| 上下文禁语 | `prohibitedClaims` / `cannotSay`（同义归一后匹配） | `listingClaimPolicy.ts:73-87` |
| 促销条款 | 「verify the exact variant」类，且句中含已确认型号码 | `validation.ts:99-112,428-435` |

> 注：`validation.ts:566-567` 明示 *"Unknown, performance, certification and prohibited reasons are never softened."* —— 这四类**不可被事实锚定豁免**，因此归入 PROHIBITED 而非 FACT_REQUIRED。

### 4.4 SAFE_BENEFIT —— **当前为空集（核心发现）**

| 声明方 | 内容 | 执行方 |
|---|---|---|
| **Writer**（R1） | 11 条：easier / simpler / quicker / tidier / less guesswork / one less thing to think about / confidently compare / ready for / matches / avoids / saves a step | — |
| **Validator**（R2+R3） | **无**（无任何一条落在 STRUCTURE 四表内） | resolver `:327-335` |

**这就是冲突的形式化表达**：`SAFE_BENEFIT` 层被 Writer 声明，但 Validator 侧**没有对应的执行集**。
§5 的映射表把 11 条逐条登记，并用 `declaredBy: ["writer_prompt"]` + `enforcedBy: []` 表达这一空缺。

---

## 5. 11 条说服词的逐条映射（登记，不改变判定）

| Writer 声明 | 冲突 token | 当前执行层 | 拟登记 tier | 分歧标记 |
|---|---|---|---|---|
| `easier` | easier | 无表命中 → FACT_REQUIRED | SAFE_BENEFIT | declared=SAFE_BENEFIT / enforced=FACT_REQUIRED |
| `simpler` | simpler | 同上 | SAFE_BENEFIT | 同上 |
| `quicker` | quicker | 同上 | SAFE_BENEFIT | 同上 |
| `tidier` | tidier | 同上 | SAFE_BENEFIT | 同上 |
| `ready for` | ready | 同上 | SAFE_BENEFIT | 同上 |
| `matches` | matches | 同上（`:803` 仅保护掩码，非白名单） | SAFE_BENEFIT | 同上 |
| `avoids` | avoids | 同上 | FACT_REQUIRED | 同义词缺口（表内有 prevents） |
| `less guesswork` | less, guesswork | 同上 | PROHIBITED（短语级不可判定） | 建议改为单词级 |
| `one less thing to think about` | one, less, thing, think | 同上 + copula 规则 | PROHIBITED（短语级） | 建议改为单词级 |
| `confidently compare` | confidently, compare | 同上 | PROHIBITED（短语级） | 建议改为单词级 |
| `saves a step` | saves, step | 同上 | PROHIBITED（短语级） | 建议改为单词级 |

> **登记 ≠ 生效**。上表只描述"应登记成什么"，**不改变任何判定**。真正让 `SAFE_BENEFIT` 生效属于 M3（需授权，§7）。

---

## 6. 新模块接口设计

### 6.1 落点：**扩展现有文件，不新建模块**

```
lib/listingV5/claimVocabulary.ts        ← 唯一声明点（本次设计的落点）
  ├─ HARD_OR_ESCALATION_TOKENS          （现状保留，位置不变）
  ├─ CLAIM_POLICY_REGISTRY              （新增：四层登记表，纯数据）
  ├─ tierOf / structureTerms / factRequiredTerms / writerVocabulary / divergences
  └─ （保持 dependency-free）
```

**为什么是这个文件**：它已经自我声明为 claim 措辞的唯一真值源（`:5-8`），已经被 `validation.ts:165` 与 `conversionBlueprint.ts:172-184` 消费，
且已具备"dependency-free"这一被测试依赖的属性（`:9-12`）。扩展它 **= 补齐既有模式**，而不是新增第 5 套。

### 6.2 与事实域模块的关系（合并而非并列）

`listingClaimPolicy.ts` 已经确立了跨路径唯一出口原则（`:16`："禁止各路径各自维护同义词表——全部走本模块"）。
设计上**复用它的纯函数**，不复制：

| 复用项 | 现状位置 | 用途 |
|---|---|---|
| `normalizeClaimText` | `listingClaimPolicy.ts:56-61` | 注册表的 term 归一 |
| `canonicalClaimTerm` | `:68-70` | 连字符/空格同义（`leak-proof` = `leakproof`） |
| `hitsProhibited` | `:73-87` | PROHIBITED 层的上下文禁语匹配 |

> ⚠️ **依赖方向**：`claimVocabulary.ts` 必须保持零依赖（P4），因此**不能** import `listingClaimPolicy.ts`。
> 迁移时把这三个纯函数**下沉**到 `claimVocabulary.ts`，由 `listingClaimPolicy.ts` 反向 re-export（保持其公开 API 不变）。
> 这条下沉是**纯移动**，可用 conformance 测试锁定行为。

### 6.3 Writer 侧接口（未来 M2）

```ts
// 由注册表生成 prompt 片段，取代 generation.ts:105-107 的硬编码字符串
const { neverInvent, bannedUnlessFactBacked, persuasion } = writerVocabulary();
```

**生成结果必须与今天逐字相同**（M2 的验收条件），否则视为行为变更。

---

## 7. 迁移路径

### 7.1 保持不变 vs 未来可迁移（验收标准 3）

| 规则 | 本轮 | 未来 | 变更性质 |
|---|---|---|---|
| `HARD_OR_ESCALATION_TOKENS` 及其消费者 | **完全不变** | 位置不变，仅登记 | 无 |
| `validation.ts` 的 copula / 锚定 / 阈值逻辑 | **完全不变** | M1 改为读注册表（集合内容逐字相等） | 纯重构 |
| resolver 四张语法表 | **完全不变** | M1 同上 | 纯重构 |
| resolver 8 类高危正则 | **完全不变** | 不迁移（正则不是词表，登记为规则引用） | 无 |
| `listingClaimPolicy` 三档 tier | **完全不变** | M1 复用其纯函数（下沉） | 纯重构 |
| Writer prompt 两张词表 | **完全不变** | M2 改为生成（内容逐字相等） | 纯重构 |
| **SAFE_BENEFIT 生效**（让 11 条被 Validator 接受） | **不做** | **M3，需单独授权** | **放宽 → 行为变更** |
| **11 条短语级降级为单词级** | **不做** | **M3 备选，需授权** | **收紧 prompt → 行为变更** |
| **BLOCK 阈值与严重度解耦** | **不做** | M4，需专项验收 | 行为变更 |
| 两套权威 reason 语义统一 | **不做** | M4 | 行为变更 |

### 7.2 阶段划分

| 阶段 | 内容 | 行为变化 | 授权 |
|---|---|---|---|
| **M0**（本文档） | 设计 + conformance 测试设计 | 无 | 已完成 |
| **M1** | 注册表落地；`validation.ts` / resolver 改为读注册表；**集合内容逐字相等** | **应无** | 需授权（改 Validator 文件） |
| **M2** | `writerVocabulary()` 生成 prompt 片段，输出与今天逐字相同 | **应无** | 需授权（改 Prompt） |
| **M3** | 逐条解决 §5 的分歧（放宽 or 收紧），每条独立授权 + holdout 复测 | **有** | **单独授权** |
| **M4** | 阈值/严重度、reason 语义统一 | **有** | 单独授权 |

**M1/M2 的验收口径**：`tierOf` 输出的集合与迁移前快照**逐元素相等**，且 Listing V5 全量测试不变绿即视为失败。

---

## 8. 风险分析

| # | 风险 | 触发条件 | 后果 | 缓解 |
|---|---|---|---|---|
| R1 | **迁移期行为漂移** | M1 移动词表时漏项/多项 | 判定悄然变化 | conformance 快照测试（集合逐元素比对）+ 迁移前后同一 holdout |
| R2 | **依赖方向破坏** | 为复用 `hitsProhibited` 让 `claimVocabulary` import `listingClaimPolicy` | route 测试的 Validator mock 失效（`:9-12` 明示） | P4 强制零依赖；下沉纯函数而非反向 import |
| R3 | **SAFE_BENEFIT 放宽被误当重构** | M3 与 M1 混在一次提交 | 安全边界在"重构"名义下被放宽 | 阶段硬隔离：M3 必须独立 PR + 独立 holdout |
| R4 | **Prompt 生成后与历史快照不一致** | M2 生成结果与 `generation.ts:106-107` 有字符差异 | fingerprint 失效 / 旧快照行为变化 | 逐字相等断言（字符串比较），差异即失败 |
| R5 | **注册表成为第 5 套** | 实现时手工再抄一份词表 | 又一处漂移源 | `entries` 必须**由现有集合构造**（`new Set([...HARD, ...QUALIFIER, ...])`），禁止手写字面量 |
| R6 | **闭世界 vs 开放集误配** | 把 copula 规则（开放集）登记为枚举词表 | 注册表无法穷举，形同虚设 | copula 登记为 **shape rule**（正则 + 例外表），不登记为词表 |
| R7 | **失败默认值选错** | `tierOf` 未知返回 STRUCTURE | 未登记词被静默放行 | P2 fail-closed：未知 = FACT_REQUIRED |
| R8 | **跨链耦合** | `listingV5` 与 `listingHandoff` 互引 | 循环依赖 / 打包问题 | 注册表放 `listingV5`，`listingHandoff` 只做**反向 re-export**，不反向 import |

---

## 9. 单元测试设计

### 9.1 M0 可立即写（无需改生产代码，仅新增测试文件）

| # | 用例 | 断言 | 目的 |
|---|---|---|---|
| T1 | **conformance: 硬词表** | `factRequiredTerms()` ⊇ `HARD_OR_ESCALATION_TOKENS` 且逐元素相等 | 锁 P1 |
| T2 | **conformance: 结构表** | `structureTerms()` 与 resolver 四表并集逐元素相等 | 锁 P1 |
| T3 | **tier 划分互斥** | 任一 term 只属于一个 tier（copula shape rule 除外） | 防重复声明 |
| T4 | **fail-closed** | `tierOf("zzz-unknown") === "UNKNOWN"`，调用方按 FACT_REQUIRED 处理 | 锁 P2 |
| T5 | **归一化一致** | `leakproof` / `leak-proof` / `leak proof` → 同一 entry；大小写不敏感 | 锁 R4 复用 |
| T6 | **writerVocabulary 逐字相等** | 生成的三个数组与 `generation.ts:105-107` 的字符串**逐字相同** | 锁 M2 无行为变化 |
| T7 | **divergences 非空即缺陷** | `divergences()` 当前返回 **11 条**（§5）；数量变化必须显式更新快照 | 让冲突可见 |
| T8 | **★ 不变式测试（核心）** | 对每个 `SAFE_BENEFIT` term，构造只含该 term 的合法 draft 并跑 `validateListingV5Draft`，**必须不产生 finding** | 见 9.2 |

### 9.2 核心不变式：`B ⊆ (A ∪ 事实词)`

用 `test.fails`（Vitest 的 expected-failure）表达：

```ts
// 今天这条应当 FAIL —— 它失败的本身就是冲突的证据。
// M3 完成后它必须转为 PASS，那时把 test.fails 去掉即可。
test.fails("every SAFE_BENEFIT term is accepted by the Validator", () => {
  for (const term of safeBenefitTerms()) {
    expect(flagsFor(syntheticDraftUsing(term))).toEqual([]);
  }
});
```

**价值**：把"Writer 批准 / Validator 拒绝"这一冲突从**文档里的发现**变成**CI 里的红灯**，
从而(a) 阻止新增分歧，(b) 让 M3 的完成可被机械验证。

### 9.3 M1 起追加

| # | 用例 | 断言 |
|---|---|---|
| T9 | 迁移等价性 | 迁移前后 `structureTerms()` / `factRequiredTerms()` 的排序快照逐字节相等 |
| T10 | 判定回归 | 现有 `validation*.test.ts` / `benefitExpression.test.ts` 全绿且**断言不变** |
| T11 | 依赖约束 | `claimVocabulary.ts` 无 import（静态检查） |

---

## 10. 明确不做的事

- ❌ 不新增第五套词表（验收标准 1）——注册表必须由现有集合**构造**得出（R5）。
- ❌ 不在本轮修改任何生产文件（含 `claimVocabulary.ts` 本身）。
- ❌ 不把 copula 规则（开放集）伪装成枚举词表（R6）。
- ❌ 不在 M1/M2 里夹带任何判定变更（R3）。
- ❌ 不为了通过率放宽 8 类高危正则或 PROHIBITED 层。
- ❌ 不新增 Planner / AI 调用 / 数据库字段 / 页面改动。

---

## 11. 未验证与限制（如实）

1. 本文的映射表由**只读代码阅读**得出，每条给了文件与行号；**未**运行端到端验证每个 tier 归属（本轮不允许改代码、不允许新增脚本）。
2. §5 中 11 条说服词的"当前执行层"是按 `isNeutralResidualGrammar`（resolver `:327-335`，只读四张表）与 copula 规则**推导**的；
   Phase 5 的实测 span（`easy/easier/one/less/ready/noted/stated/described/setting/arranging/putting/considering`）与推导一致，但未逐词复现。
3. `matches` 在 resolver 中唯一出现在 `:803` 的**保护掩码正则**（注释 `:799-800` 称之为 "allow 词"），
   但**不在**四张语法表内。该掩码是否本意为白名单、是否已退化为死代码，**需要单独确认**；本文的 tier 归属不依赖这一结论。
4. `listingClaimPolicy` 的 `review` tier 依赖 `explicitHighRiskConfirmed` 元数据，该元数据在 V5 链路上的**实际填充率未统计**。
5. 本文假设 `listingHandoff` 与 `listingV5` 两侧都可被安全引用；**跨链依赖的实际打包/循环依赖影响未验证**（R8 仅是设计约束）。
