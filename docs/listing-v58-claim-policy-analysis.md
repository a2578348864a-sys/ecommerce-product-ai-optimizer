# Listing V5.8 — Writer / Validator Claim Policy 冲突分析与统一设计

> 只读分析。**未修改任何生产代码**，未调用 AI，未改数据库/页面/测试/fallback，未提交 Git。
> 依据文件：
> - `lib/listingV5/generation.ts`（Writer prompt 与 payload）
> - `lib/listingV5/validation.ts`（V5 Validator）
> - `lib/listingV5/claimVocabulary.ts`（共享硬词表）
> - `lib/listingHandoff/listingClaimEvidenceResolver.ts`（遗留 Claim Evidence Resolver）
> - `lib/listingHandoff/listingClaimPolicy.ts`（事实三级 tier，另一个独立策略层）
> - 旁证：Phase 5 真实生成实测的 flagged spans（20 次真实调用，见 `output/v58-phase5/`）

---

## 0. 一句话结论

**Writer 被明文批准的 11 条说服词（`generation.ts:107`），全部至少含 1 个 Validator 侧词表不认的 token；
而 Validator 的 BLOCK/REPAIRABLE 分界不是"严重程度"而是"条数 >4"。**
两者叠加的结果是：**Writer 越忠实执行 prompt，越容易产出 5–6 条轻度违规句，从而被判 BLOCK。**

---

## 1. 现状：一个链路里存在 **4 套互相独立的 claim 规则**

| # | 规则集 | 位置 | 作用对象 | 是否共享真值源 |
|---|---|---|---|---|
| 1 | Writer 的两张词表（banned 55 词 / persuasion 11 短语） | `generation.ts:105-107` | 提示词 | ❌ 硬编码在 prompt 字符串里 |
| 2 | V5 Validator 检测器（硬词 + copula 属性断言 + 锚定） | `validation.ts:165,200-231,341-448` | 文案 | ✅ 硬词表来自 #4 模块 |
| 3 | 遗留 Claim Evidence Resolver（残余语法模型 + 14 reason code + 8 类高危正则） | `listingClaimEvidenceResolver.ts:48-61,211-293,364-372` | 文案 | ❌ 自维护词表 |
| 4 | `claimVocabulary.HARD_OR_ESCALATION_TOKENS`（76 tokens） | `claimVocabulary.ts:13-21` | — | 被 #2 与蓝图共用 |
| 5 | `listingClaimPolicy` 三级 tier（verified/review/prohibited） | `listingClaimPolicy.ts:21-117` | **事实值**（非文案） | ❌ 自维护 |

**冲突的结构性根源**：只有 #4 被声明为"唯一真值源"（`claimVocabulary.ts:5-8` 明示，`validation.ts:165` 引用），
而 **Writer prompt 的两张词表（#1）与 Resolver 的残余语法表（#3）都不由任何共享模块派生**。
`validation.ts:168-173` 已经把硬词表导出给上游（`LISTING_V5_HARD_CLAIM_TOKENS`）——**这个模式存在，但只覆盖了硬词，没有覆盖说服词与残余语法。**

---

## 2. Writer 明确允许 / 鼓励的表达（原文摘录）

### 2.1 明确允许（`generation.ts:107`）
> `PERSUASION VOCABULARY (closed list): easier, simpler, quicker, tidier, less guesswork, one less thing to think about, confidently compare, ready for, matches, avoids, saves a step.`

补充约束（同句）：*"carry every persuasive sentence on the Confirmed Facts you cite, and do not reach outside this list for persuasive wording."*

### 2.2 明确鼓励（`generation.ts:109`）
> `BENEFITS ARE ALLOWED: connect confirmed facts to a shopper benefit, for example`
> `carrying loop -> makes it easier to take along, straw -> supports convenient sipping,`
> `24 oz -> a practical size for everyday hydration routines, wide opening -> makes the opening easier to access.`

### 2.3 允许的结构（`generation.ts:111`）
`Feature -> Benefit`、`Scenario -> Feature -> Benefit`、`Feature -> Practical Consideration`、`Fit or Use -> Benefit`

### 2.4 明确禁止
- `generation.ts:105` NEVER INVENT 清单（约 20 词：durable, long-lasting, heavy-duty, leakproof, spill-proof, waterproof, rustproof, BPA-free, food-safe, non-toxic, FDA approved, dishwasher safe, scratch/stain/odor resistant, 24-hour, all-day cold…）
- `generation.ts:106` BANNED VOCABULARY **55 词**（与共享硬词表高度重叠但不完全相同）
- `generation.ts:115-116` `disallowedTemptations`（= 硬词表减本品事实已覆盖词，`conversionBlueprint.ts:172-184`）

---

## 3. Validator 会判定的词与规则

### 3.1 判定入口与阈值（`validation.ts:528-651`）

```
allDetails = resolver 报的 unsupportedClaims（除被锚定豁免的 unclassified）
           + V5 自己扫全文补报的句子（validation.ts:595-607）
blockingClaims = prohibitedClaims + competitorOverlap + allDetails.filter(!isLocallyRepairable || field==="unknown")
repairScopeTooBroad = locallyRepairable.length > 4 || 涉及字段数 > 3     // :522-523, :621
status = blockingClaims>0 || repairScopeTooBroad ? "BLOCK"
       : locallyRepairable.length>0 || structuralIssues>0 ? "REPAIRABLE"
       : "PASS"                                                          // :638-642
```

**关键机制 `isLocallyRepairableClaim`（`:509-511`）只认一个 reason：**

```ts
function isLocallyRepairableClaim(item) { return item.reason === "unclassified_factual_claim"; }
```

→ 也就是说：**"可修复"与否取决于哪套规则报的它，而不是它有多严重。**
Resolver 报的带类型 reason（`unsupported_performance_claim` 等）一律 blocking；V5 自己补报的句子 reason 固定为 `unclassified_factual_claim`（`:605`），属可修复。

**并且还有第二条封顶**：即使全部可修复，`locallyRepairable.length > 4` 仍然直接 BLOCK（`:621,638`）。

### 3.2 硬词规则（`validation.ts:165,341-355`）
- 词表 = `HARD_OR_ESCALATION_TOKENS`（76 tokens，`claimVocabulary.ts:13-21`）
- 数量枚举豁免（`:285-336`）：`in total` / `a total of` / `Total: 4 Pcs` / `total pack size|pieces|count|quantity` 读作计数，不算绝对宣称；`QUANTITY_QUANTIFIER_TOKENS`（`:316`）限定哪些词可被豁免
- 非确认值覆盖的硬词才报（`:341`）

### 3.3 copula 属性断言规则（`validation.ts:200-231`）—— **最容易被忽略、影响最大的一条**

```ts
COPULA_WORDS = "is|are|looks?|feels?|seems?|has|have"
COPULA_ALLOWED_COMPLEMENTS = "made|designed|available|included|listed|shown|intended|suited|used|from"   // 仅 10 词
COPULA_NON_COMPLEMENTS = "that|which|who|…|there"
COPULA_BARE_ADJECTIVE  = copula + 非冠词 + 任意 [a-z][a-z-]*
COPULA_ARTICLE_ADJECTIVE = copula + 冠词 + 任意 [a-z][a-z-]*
```
判定（`:242-244`）：该词若**不在"全部已确认事实值的 token 并集"**里，即为"未被覆盖的属性断言"，报出该**表面词**（`:258-265`）。

**即：`copula + 任何不在事实里出现过的英文形容词/分词` 都会被判违规。** 这个集合在英语里几乎是开放集。

### 3.4 锚定判定（`validation.ts:424-448`）
一段文字被判"锚定"需同时满足：重述了某条确认值（整串或全部 token 到齐）+ 未引入未覆盖硬词 + 无未覆盖属性断言（`:436-446`）。
另有型号促销条款（`:99-112,428-435`）：出现已确认型号码且句中含"verify the exact variant"类表述时，**该句不因型号码而可锚定**。

### 3.5 Resolver 的残余语法模型（`listingClaimEvidenceResolver.ts:211-293`）—— **第二套独立词表**

安全不变式（`:213-217`）：把"句子 − 全部确认值"后的**残余**逐 token 检查，**每个 token 都必须落在四张表内**，否则报 `unclassified_factual_claim`。

| 表 | 内容（节选） | 位置 |
|---|---|---|
| FUNCTION 功能词 | the/a/an/this/…/about/around/while/…/only/more/most | `:234-245` |
| FIELD 字段名词 | product/brand/material/size/capacity/count/pack/use/care/… | `:248-267` |
| **QUALIFIER 限定词** | everyday, daily, practical, **easy, easily**, **simple, simply**, general, regular, normal, common, typical, basic, convenient, suitable, available, made, built, designed, included, together | `:270-275` |
| PREDICATE 连接谓语 | is/has/includes/measures/**fits**/comes/features/provides/**prevents**/helps/… | `:278-293` |

### 3.6 Resolver 的 14 个 reason code 与 8 类高危正则
- reason codes：`listingClaimEvidenceResolver.ts:48-61`
- 高危类别（**永不软化**，`validation.ts:566-567`）：`:364-372`，含 `unsupported_performance_claim`（耐用/耐用性/heavyduty/更强…）、`unsupported_dimension_claim`（轻量化/lightweight/超大…）、`unsupported_absolute_claim`（永久/100%/guaranteed/always…）等

---

## 4. 两套规则的对比

### 4.1 ✅ Writer 允许 + Validator 允许（无冲突区）

| 表达 | 为什么允许 | 位置 |
|---|---|---|
| `easy` / `easily` | 在 QUALIFIER 表 | resolver `:271` |
| `simple` / `simply` | 在 QUALIFIER 表 | resolver `:271` |
| `convenient` / `practical` / `everyday` / `daily` / `regular` / `typical` / `basic` | 在 QUALIFIER 表 | resolver `:271-274` |
| `made` / `built` / `designed` / `included` / `including` / `available` / `suitable` | 在 QUALIFIER 表；且 `made/designed/included/available/used` 同时在 copula 允许补语表 | resolver `:271-273`；`validation.ts:201` |
| `fits` / `fit` | 在 PREDICATE 表 | resolver `:283` |
| `prevents` / `helps` / `reduces` / `resists` | 在 PREDICATE 表 | resolver `:290-291` |
| `together` | 在 QUALIFIER 表 | resolver `:274` |
| 数量枚举语境（`in total`、`Total: 4 Pcs`） | 计数豁免 | `validation.ts:285-336` |
| 事实值原文复述 | 锚定 | `validation.ts:424-448` |

### 4.2 ❌ Writer 允许 + Validator 拒绝（**冲突清单**）

判据：把 `generation.ts:107` 的 11 条说服词逐 token 对照 §3.5 的四张表与 §3.3 的 copula 规则。

| # | Writer 批准的表达 | 冲突 token | 冲突机制 | 性质 |
|---|---|---|---|---|
| 1 | `easier` | easier | QUALIFIER 只有 easy/easily，**无比较级 easier** | 单词级（词形缺口） |
| 2 | `simpler` | simpler | QUALIFIER 只有 simple/simply，**无比较级 simpler** | 单词级（词形缺口） |
| 3 | `quicker` | quicker | 两张表**均无** quick/quicker | 单词级 |
| 4 | `tidier` | tidier | 两张表**均无** tidy/tidier | 单词级 |
| 5 | `less guesswork` | less, guesswork | FUNCTION 有 more/most 但**无 less**；无 guesswork | 短语级 |
| 6 | `one less thing to think about` | one, less, thing, think | 仅 about 在 FUNCTION；其余全无。且 `have one…` 触发 copula 规则 | 短语级 |
| 7 | `confidently compare` | confidently, compare | 两张表**均无** | 短语级 |
| 8 | `ready for` | ready | for 在 FUNCTION，**ready 不在 QUALIFIER** | 单词级 |
| 9 | `matches` | matches | PREDICATE 有 fits/fit，**无 matches** | 单词级（同义缺口） |
| 10 | `avoids` | avoids | PREDICATE 有 prevents，**无 avoids** | 单词级（同义缺口） |
| 11 | `saves a step` | saves, step | 仅 a 在 FUNCTION | 短语级 |

**11 / 11 全部冲突。**

**逐 token 核对方式（可复核）**：对 `listingClaimEvidenceResolver.ts` 全文检索这 16 个 token，
结果 **全部 0 命中**（唯一例外见下）；对照组 `easy/easily/simple/simply/convenient/practical/everyday/fits/prevents`
均命中 1–2 次（作为表项）。判定入口是 `isNeutralResidualGrammar`（`:327-335`），它**只**consult
`RESIDUAL_FUNCTION_WORDS` / `RESIDUAL_FIELD_NOUNS` / `RESIDUAL_QUALIFIERS` / `RESIDUAL_PREDICATES` 四张表。

> **唯一需要说明的词：`matches`**。它在全文仅出现 1 次，位于 `:803` 的**保护掩码正则**
> （`(everyday|hydration|practical|construction|available|preference|capacity|matches|on-the-go)`），
> 该步的作用是把这些词临时替换成 `__P{n}__`，**避免后续 fragment 剥离把 allow 词拆坏**（注释 `:799-800`）。
> 它**不在**上述四张语法表内，因此 `isNeutralResidualGrammar` 不会接受它 —— 保护掩码不等于白名单。
> （该掩码列表是否本意为白名单、现已退化，值得单独确认；这不是本文结论所依赖的前提。）

**旁证（Phase 5 真实生成，20 次真实调用实测）**，被 Validator 报出的表面词：
`easy, easier, one, less, ready, noted, stated, described, setting, arranging, putting, considering, choosing, ordering, second, you`

其中 `easy/easier/one/less/ready` 直接落在上表的冲突项上；`noted/stated/described` 与 `setting/arranging/putting/considering` 走的是 §3.3 的 copula 规则（分词不在 copula 允许补语表里）。

### 4.3 ⚠️ Validator 限制但 Writer **未声明**的风险表达

| 类别 | Writer 是否告知 | Validator 是否判 | 位置 |
|---|---|---|---|
| copula + 任意非事实形容词（如 `is ready`、`is noted`、`is stated`、`is described`） | ❌ 完全未提 | ✅ 报未覆盖属性断言 | `validation.ts:200-231` |
| copula + 动名词（`you are setting/arranging/putting/considering`） | ❌ 未提 | ✅ 同上 | 同上 |
| 残余语法表外的任意英文实词（`second`、`ordering`、`you`） | ❌ 未提 | ✅ `unclassified_factual_claim` | resolver `:234-293` |
| `disallowedTemptations`（硬词减事实词） | ✅ 明确告知"never write it" | ✅ | `generation.ts:115-116` |
| 55 词 banned 表 | ✅ 明确列出 | ✅ | `generation.ts:106` |
| 8 类高危（performance/dimension/absolute…） | 🟡 部分重叠（banned 表覆盖约一半） | ✅ **永不软化** | resolver `:364-372`；`validation.ts:566-567` |

**信息不对称**：Writer 只被告知两张封闭词表（约 66 条），但 Validator 实际拒绝的是
**"copula + 任何不在确认事实里的形容词"∪"残余语法表外的实词"** —— 这是一个**开放集**，无法用清单穷举。

---

## 5. 冲突分类

### A. 单词级冲突（词形 / 同义缺口，可枚举）
`easier`（有 easy 无 easier）、`simpler`（有 simple 无 simpler）、`quicker`、`tidier`、`ready`、`matches`（有 fits 无 matches）、`avoids`（有 prevents 无 avoids）
→ 共 7 条。**特征：Validator 已有近似词，只是缺这一形/这一同义词。**

### B. 短语级冲突（多 token 组合，无法靠单词表覆盖）
`less guesswork`、`one less thing to think about`、`confidently compare`、`saves a step`
→ 共 4 条。**特征：短语中至少 2 个 token 同时不在表内。**

### C. 需要事实支撑的表达（本身合法，但必须能被事实锚定）
- 任何 `copula + 形容词`：只有当该形容词出现在某条确认值中才放行（`validation.ts:242-265`）
- 硬词（durable/leakproof/waterproof…）：只有确认值原文含该词才放行（`validation.ts:341-355`）
- 高危 8 类：**即使有事实也按类型处理**（`validation.ts:566-567` 明示 never softened）

### D. 纯连接 / 结构表达（无事实内容，本应永远安全）
`FUNCTION`（`:234-245`）+ `PREDICATE`（`:278-293`）+ `FIELD`（`:248-267`）三张表内的词。
**风险点**：`PREDICATE` 有位置约束（`:224-230`）——谓语一旦出现，**其后每个 token 仍须落在四类表内**，
否则整句失效。所以"连接词"并不自动安全。

---

## 6. 哪些能靠 Prompt 解决，哪些必须改 Validator

### 6.1 可以只靠 Prompt 解决（**改动小、不碰安全边界**）

| 方案 | 覆盖冲突 | 代价 |
|---|---|---|
| P1 把 persuasion 词表从"比较级/同义词"换成 Validator 已认可的形态：`easy, simple, convenient, practical, everyday, regular, typical, basic, together` | A 类 7 条中的 5 条（easier/simpler/quicker/tidier/ready 改为 easy/simple/quick?/tidy?/available…） | 说服力略降 |
| P2 明确告知：copula 后只能用 `made/designed/available/included/listed/shown/intended/suited/used/from` | 消除 `is ready/noted/stated/described` 一类 | 需列举 10 词 |
| P3 明确禁止 `you are + 动名词`（setting/arranging/putting/considering）与 `so you can…` 目的从句 | 消除动名词与 `you` 类 | 与 `BENEFITS ARE ALLOWED`(`:109`) 有张力，需同时改写该条 |
| P4 明确"短语级说服表达不可用"，改为单词级 | B 类 4 条 | 表达力下降 |

**P1–P4 全部只改 prompt 字符串，不改判定逻辑，不降低安全性。** 但它们是**迁就规则**，不是修规则。

### 6.2 必须调整 Validator / Resolver（Prompt 无法穷举）

| 问题 | 为什么 Prompt 解决不了 | 建议的最小改动 | 风险 |
|---|---|---|---|
| copula 规则实际是开放集（任意形容词） | Writer 无法穷举英语形容词 | 把 copula 断言收紧为**"闭集形容词表 + 事实覆盖词"**，或把 `COPULA_ALLOWED_COMPLEMENTS` 扩充为"分词/形容词白名单" | 属于**放宽**，必须单独授权与回归 |
| QUALIFIER 表缺比较级（easier/simpler） | 列举可解，但会连带削弱表达 | 在 `RESIDUAL_QUALIFIERS`（resolver `:270-275`）补 `easier, simpler, quicker, tidier` 等 | 同上，放宽 |
| `matches`/`avoids` 缺同义 | 可换词规避 | 在 `RESIDUAL_PREDICATES`（`:278-293`）补 `matches, avoids, saves` | 同上，放宽 |
| **BLOCK 阈值是条数（>4）而非严重度**（`validation.ts:621,638`） | Prompt 可减少条数，但阈值设计本身与严重度脱钩 | 把 `MAX_REPAIRABLE_CLAIMS`（`:522`）与严重度解耦：轻度（unclassified/attribute）允许更多，或改为按字段数封顶 | 阈值调整需专项验收 |
| 两套权威（Resolver vs V5 scanner）reason 语义不统一 | — | 统一 reason 词表，使"可修复"由**严重度**决定而非"谁报的"决定 | 结构性 |

### 6.3 明确**不**建议
- ❌ 不要为了通过率放宽 8 类高危正则（performance/certification/absolute）；
- ❌ 不要把 `unclassified_factual_claim` 一律视为可修复而不看条数；
- ❌ 不要再新增第三套词表——现状已经是 4 套（§1），应**收敛**而不是增加。

---

## 7. 统一 Claim Policy 设计（提案，未实施）

### 7.1 单一真值源
把现有 `claimVocabulary.ts` 从"只存硬词"扩展为**唯一 claim 词表模块**，导出 4 个 tier；
Writer prompt 的字符串**由该模块生成**（而非硬编码），Validator 与 Resolver 也只读它。
现有先例已证明可行：`validation.ts:168-173` 已把硬词导出为 `LISTING_V5_HARD_CLAIM_TOKENS` 供蓝图使用。

### 7.2 四层 tier

| Tier | 语义 | 内容来源 | 判定 |
|---|---|---|---|
| **A 结构/连接** | 无事实内容，永远允许 | FUNCTION + PREDICATE + FIELD | 无约束 |
| **B 说服（闭集，单词级）** | 允许，但须落在已批准集合内 | **A 与 C 的交集**：easy, simple, convenient, practical, everyday, together… | 表内即过 |
| **C 属性（需事实）** | 仅当词出现在某条确认值中 | copula 补语 + 形容词/分词 | 事实覆盖即过 |
| **D 禁止** | 永不放行（除事实原文覆盖） | HARD_OR_ESCALATION_TOKENS − 事实词 + prohibitedClaims + 8 类高危 | 一律拦 |

**关键不变式**：B ⊆ (A ∪ 事实词)，即"Writer 允许的说服词必须是 Validator 一定放行的词"。
这条不变式可用**单元测试锁定**（对 B 中每个词跑一次 Validator，必须 PASS）——这是本方案最便宜的护栏。

### 7.3 严重度与判定
建议 BLOCK/REPAIRABLE 由 **tier 的严重度**决定，而非条数与"谁报的"：
- D 类命中 → BLOCK（现状一致）
- C 类未覆盖 → REPAIRABLE（现状一致）
- A/B 类 → 不产生 finding（现状部分不一致）

---

## 8. 未验证与限制（如实）

1. **§4.2 的冲突清单由"词表集合比对"得出**，每条都给了表位置；但我**没有**逐条跑 Validator 验证每个单词的端到端判定结果（本轮不允许新增脚本/测试）。
2. §4.3 中 `second / ordering / choosing / putting / considering` 等 span 来自 Phase 5 实测，其**具体触发规则**（copula 还是残余语法）我按规则推断，未逐句追踪。
3. §3.1 的阈值结论（>4 条 → BLOCK）有 Phase 5 旁证支持（5→BLOCK、3→REPAIRABLE 多次一致），但样本仅 5 商品 ×2 臂。
4. 本文**未**评估修复链（repair/rewrite/recovery）对这些 finding 的处理效果。
5. 全文基于当前工作树版本；`listingClaimEvidenceResolver.ts` 属于遗留链路，与 V5 共用但独立演进，**后续任一侧改动都可能使本文部分结论过期**。
