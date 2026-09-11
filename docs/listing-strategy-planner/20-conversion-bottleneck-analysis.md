# Listing V5 转化质量瓶颈分析（只读 · 未改代码）

> 基线：Evidence Binding 已完成版本（`feat/listing-v5-rebuild`）。
> 方法：只读通读 `lib/listingV5/**`、`lib/creativeContextBuilder.ts`、`lib/server/vocAnalysis.ts`、
> `lib/server/reviewEvidence.ts`、`lib/research/researchInputQuality.ts` + 实测本机任务快照。
> **本文已经过一轮独立对抗审查，并按其复核结果修正了 4 处错误/夸大（修订记录见 §8）。**
> 约束遵守：未写代码、未改 Validator/fallback、未新增 Planner/Agent/状态、未 Git 写操作。

---

## 0. 结论先行

**方向：转化的主要损失发生在"发布的是哪一版"，不在"策略够不够聪明"。**
但在动手之前，**必须先修一个度量缺陷**——否则 V5.8 的任何改动都无法被证明有效（§2）。

三条关键事实：

| 事实 | 数值 | 来源 |
|---|---|---|
| AI 稿能否发布 | V5.7 holdout **PASS 0/3**；残余 unsupported 5 条中 **4 条是 Writer 追加的目的从句** | `docs/listing-v57/V57_STATE.md:33,57` |
| AI 初稿的转化评分（离线 benchmark） | **平均 89.0 / 100**（C4 94 / C7 86 / C1 87） | 同上 `:33`（离线 runner，**不跑** repair/rewrite/recovery/fallback） |
| 本机实际交付构成 | 5 个任务中 AI 交付 **1**、fallback **4** | 本次实测，**但样本被污染，仅为轶事级证据，见 §7.1** |

**最重要的一条新发现（对抗审查指出、我已逐行复核）**：页面上真正显示的那套五维量表
（`qualityEvaluation.ts`）**在页面上实测给出「fallback 优于 AI」的反转**，根因是它有
**一行把"买家看不见的后台搜索词"计入关键词覆盖率**的缺陷。这意味着**当前度量在奖励不可见的堆砌、
惩罚更自然的 AI 文案**——度量口径不修，后续优化无法验收（§2）。

---

## 1. 当前 Listing 链路能力评分

10 分制。

| 能力 | 分 | 依据 |
|---|---|---|
| 事实安全 / 合规 | **9** | Validator + Claim Evidence + `prohibitedClaims` + `disallowedTemptations`（由 Validator 自身词表派生，`conversionBlueprint.ts:172-184`） |
| 证据可追溯 | **7** | Evidence Binding 已落地（实测 33/34 条结论可回指真实 evidenceId）。**扣分**：VOC 分组语义与来源角色仍在投影层丢失（§3.2） |
| 关键词 / 搜索意图 | **7** | `keywordIntent{primary,secondary,backendOnly}` + 语言闸门。扣分：`intentStage` 靠 3 条正则猜（`conversionBlueprint.ts:209-214`） |
| 卖点表达质量 | **6** | AI 初稿在**离线 benchmark** 量表得 89/100。⚠️ 但该量表（`conversionScore`）**未接线**；页面上显示的是另一套，实测 fallback 81 > AI 71（§2） |
| **卖点优先级（按需求强度）** | **3** | 频次决定 VOC 主题**能否存活**（`creativeContextBuilder.ts:590-591` 排序后截断 12），但**完全不决定顺序**；顺序是位置性的 |
| **差异化（竞品机会）** | **3** | `competitorGaps` = 静态属性词表重叠，无强弱方向（`conversionBlueprint.ts:256-273`） |
| 异议处理 | **4** | `objectionHandling` 只覆盖 `factBacked` 痛点（`:338-350`），且痛点未排序 |
| **实际交付率（AI 稿能否发布）** | **3** | PASS 0/3（官方）；本机轶事样本 1/5 |
| **度量可信度** | **2** | 见 §2：现役量表有反向缺陷 + fallback 硬性封顶 |
| 成本效率 | **8** | 1 次 strategy + 1 writer + 有界修复，`plannedCalls` 1/4/5，无冗余调用 |

---

## 2. 【本轮最重要的发现】度量口径本身是坏的

> 这一节是对抗审查查出、并经我逐行复核确认的。它**改变了整个分析的优先级**。

### 2.1 两套五维量表，只有一套在页面上跑，而它在奖励"看不见的词"

- `lib/listingV5/conversionScore.ts`（buyer_intent / benefit_clarity / differentiation / specificity / naturalness）
  **完全没有接线**：`app/api/tasks/[id]/listing-v5/route.ts` 只 import 并调用 `evaluateListingV5Quality`，
  `scoreListingV5Conversion` 全仓仅出现在自身定义与两个测试文件里（`conversionScore.test.ts`、`safetyGates.test.ts`）。
  → **V57_STATE 里的 89 分来自离线 harness，不是页面上看到的分数，也不是"交付物"的分数。**
- 页面上真正显示的是 `lib/listingV5/qualityEvaluation.ts` 的另一套五维
  （safety / keyword_relevance / benefit_clarity / differentiation / conversion_strength）。

### 2.2 反向缺陷：后台搜索词被计入"listing 里的关键词覆盖"

```ts
// qualityEvaluation.ts:57-62
function draftText(draft) {
  const backend = normalize((draft.backendSearchTerms ?? []).join(" "));
  return { title, bullets, description, backend,
           all: [title, ...bullets, description, backend].join(" \n ") };   // ← backend 进了 all
}
// :113  关键词覆盖率算在 text.all 上
const covered = terms.filter((term) => text.all.includes(term));
// :115  措辞还写成 "present in the listing"（实际包含后台词，不在 listing 正文里）
evidence.push(`${covered.length}/${terms.length} intent term(s) present in the listing`);
```

**`backendSearchTerms` 是后台搜索词，买家在页面上看不到。** 把它计入覆盖率，等于
"往后台塞词即可拿高分"。而 fallback 稿恰好会塞 8 个（`generation.ts:76` 的 `backendOnly.slice(0,8)`），
AI 稿塞得少 —— 于是出现反转。

**实测（`qualityEvaluation`，即页面那套）**：

| 任务 | fallback | total | keyword_relevance | conversion_strength |
|---|---|---|---|---|
| `cmtwke5sg0` | True | **81** | 20/20 | 8/20 |
| `cmtwk36m20`（AI 交付） | False | **71** | 6/20 | 12/20 |
| `cmtwkkjem0` | True | 73 | 12/20 | 8/20 |
| `cmtwkd1oo0` | True | 70 | 2/20 | 8/20 |

→ **fallback(81) 反超 AI 交付(71)**，与"AI 稿更好"的直觉相反。

### 2.3 量表还把"交付路径"与"质量分"硬耦合

- `qualityEvaluation.ts:203-206`：fallback 时 `conversion_strength = min(score, 8)`，并写明
  "deterministic fallback copy cannot express a conversion angle"。
- `conversionScore.ts:208-211`：fallback 时 naturalness 封顶 6。

所以"交付率"与"转化分"**不是两件独立的事**——这解释了上表 3 个 fallback 全是 8/20。

**结论**：在修好 `qualityEvaluation.ts:62` 之前，**任何转化升级都无法被证明有效或无效**。
这把"修度量"从可选项提升为**第 0 步**。

---

## 3. 四个问题的直接回答

### Q1. 当前 VOC 只是评论主题，还是已包含购买动机？

**只是评论主题；而且"主题属于哪一类"在投影层被丢掉。**

- VOC 产出 6 组：`positiveThemes` / `painPointThemes` / `usageScenarios` / `recurringRequests` /
  `conflicts` / `weakSignals`（`vocAnalysis.ts:71-78`）。
- prompt **明令禁止**购买建议：`"Never output profit forecasts, purchase advice…"`、
  `"Never output an automatic decision such as 'worth selling' / 'big opportunity'"`
  （`vocAnalysis.ts:135-137`）。→ **没有购买动机字段是设计选择，不是遗漏。**
- 最接近需求信号的是 `recurringRequests`（反复被要求什么）与 `conflicts`（既喜欢又抱怨的张力）。
- **真缺陷**：`creativeContextBuilder.ts:527-528` 的白名单**包含**这五组，但
  `:529` 写作 `for (const [, groupRaw] of themeGroups)` —— **分组键被解构丢弃**，
  且 `:552` 把 `sourceType` 硬编码为 `"voc_theme"`。
  → "在**要**什么"（request）、"在**骂**什么"（pain）、"在**夸**什么"（positive）、
  "**1–2 条评论**的弱信号"（weakSignal，prompt 明说"不应过度解读"）**在下游完全无法区分**。
- 雪上加霜：`listingV5/context.ts` 的 `reference()` 会把 `sourceType` 统一改写为流名 `"VOC"`
  （`context.ts:83-104`），连 `conflicts` 保留的 `"voc_conflict"` 区分也一并消失，只剩文本里的 `冲突：` 字面量。

**结论**：VOC 不缺数据，缺的是**把已有的语义标签传到下游**。

### Q2. 当前 Competitor 数据支持竞品机会分析，还是只是参考资料？

**只是参考资料，关键字段在进入 Listing 前被丢掉。**

- 竞品证据结构：`{asin, note, addedAt, detailBullets?}` + `relation: direct|adjacent|irrelevant`；
  模块契约写明"仅 direct 允许进入 Listing 竞品定位参考"（`researchInputQuality.ts:5-7`）。
- **丢弃点 1**：`listingV5/context.ts:211-217` 只映射 `item.note || item.asin`
  → **竞品五点 `bullets` 被采集（`creativeContextBuilder.ts:628-632`）却从未进入 Listing 链**。
- **丢弃点 2**：`relation` 未透传 → **`irrelevant` 竞品的文本仍进入 V5 参考**，与上述契约相悖。
- **丢弃点 3**：`competitorGaps` 由静态 `ATTRIBUTE_LEXICON`（14 条正则，`conversionBlueprint.ts:149-164`）
  生成（`:256-273`），只说明**双方都提到材质/容量**，**无法判断竞品强弱**。
- **上游其实有更强的信号没用**：`reviewEvidence.ts:31` 定义
  `ReviewSourceProductRole = "current_candidate" | "competitor"`，`vocAnalysis.ts:291-311`
  的 `finalizeTheme` **确定性地**把它算进 `VocTheme.sourceProductRoles`，
  且 VOC 证据页已在渲染它（`components/evidence/VocEvidenceSection.tsx:378` 的 RoleBadge）。
  → **"竞品被抱怨的维度"就是最直接的差异化机会，这个数据已经存在，但在 Listing 链路上丢失**
  （`CreativeContextVocInsight`（`creativeContextBuilder.ts:74-84`）**根本没有这个字段**）。

### Q3. 当前 Strategy 是否存在卖点排序能力？

**有"位置排序"；频次只决定"存活"，不决定"顺序"。**

- 有的部分：`strategy.bulletAngles[{role, shopperValue}]` 给出角色顺序；
  `benefitOrder` 按该顺序为每个角色绑定 `primaryFactId`（`conversionBlueprint.ts:292-302`，
  用静态 `ROLE_FIELD_PREFERENCE:284-290` 选 fact）；`benefitPriority:352-368` 由它派生。
- **频次已经在起作用，但只作用于截断**：`creativeContextBuilder.ts:590-591`
  `vocInsights.sort((a,b) => b.reviewCount - a.reviewCount)` 后 `splice(MAX_THEMES=12)`。
  → **评论多的主题更容易活到下游，但活下来之后彼此的顺序与频次无关。**
- 缺的部分：
  1. 顺序完全由位置决定，没有按**需求强度 / 购买阻碍力**排序；
  2. `decisionSequence` 是**常量** `["use_scenario","core_benefit","proof","risk_reduction"]`（`:82`、`:404`）；
  3. `painPoints` 的 `proofFactIds` 靠正则匹配，**不按 `strength`/`count` 加权**（`:216-254`）；
  4. `conversionAngle.whyItConverts` 用 `points[0]` 却命名为 `strongest`（`:370-375`）——**命名暗示了并不存在的强度排序**。
- **最关键的一点**：Evidence Binding 刚把 `strength` 与 `count` 带进 `ListingV5Reference`，
  但**没有任何决策消费**：`evidenceBinding.ts:86-88` 只是把它们**存进索引**，
  `resolveIds` 仅做 `index.has(id)`，**没有任何阈值分支**；
  `conversionBlueprint.ts` / `qualityEvaluation.ts` / `validation.ts` 全不读。
  **且 `coverage` 连 `ListingV5Reference` 都没进**（`context.ts:197-203` 未映射）——要做强度排序得先补它。

### Q4. 当前 Writer 只是表达层，还是承担了策略决策？

**名义上是表达层；但它的提示词在"鼓励收益从句"与"禁用词/事实锚定"之间自相拉扯。**

- 架构隔离干净：writer payload **不含 references**（`generation.ts:156`），有 `writerInputIsolation.test.ts` 守着。
- ⚠️ **修正一处常见误解**：Writer **并非被禁止**写收益——`generation.ts:108` 明确鼓励：
  `"BENEFITS ARE ALLOWED: connect confirmed facts to a shopper benefit, for example carrying loop -> makes it easier to take along…"`。
  被禁止的是"在写收益时引入新规格/认证/时长"（`:104-107`，`:105` 是一张极长的禁用词表）。
- **真正的问题是指令层对冲**：`:108` 要求把 fact 接到买家收益，`:104-107` 又要求删掉任何不来自 fact 的措辞；
  两句话同时约束一个句子，模型只能二选一——它选了从句，于是被 Validator 拦
  （`V57_STATE.md:57` 记录的正是 `so you can…` / `which helps you…`）。
- 项目已试过最便宜的修法并**回滚**：禁用从句清单曾让 C1 首次 PASS，但 C7 退化到 BLOCK，均分 −2.3（`V57_STATE.md:58`）。

**结论**：这不是某个模块的 bug，而是**表达与锚定之间的结构性对冲**。

---

## 4. 第一性原理：高转化 Amazon Listing 需要什么，当前缺什么

| # | 高转化的必要条件 | 当前 | 缺什么 |
|---|---|---|---|
| 1 | 事实准确、无夸大 | ✅ 强（9/10） | — |
| 2 | 搜索词覆盖 | 🟡 中 | 意图阶段靠正则；且**覆盖率度量口径有缺陷**（§2.2） |
| 3 | **先讲市场最在意的点** | ❌ 弱 | 按需求强度排序（`strength`/`count` 已在 context，无人消费；`coverage` 未透传） |
| 4 | **说竞品说不出的话** | ❌ 弱 | 竞品**弱点**方向（`sourceProductRoles` 已算、`bullets` 已采，均在 Listing 链路丢失） |
| 5 | **消除购买顾虑** | 🟡 部分 | 顾虑清单未排序 |
| 6 | **好稿能真的发出去** | ❌ 弱 | 指令对冲 vs Validator 锚定（约束禁止动 Validator/fallback） |
| 7 | **能判断自己有没有变好** | ❌ **无** | **现役度量在奖励不可见堆砌（§2）** |

→ **最小缺失能力是三件"接线"：① 修度量口径；② 把已有的证据强度接进排序；③ 把已有的 VOC 分组与竞品来源角色透传。**

---

## 5. 最大三个瓶颈

### 瓶颈 1：度量口径坏了，导致"优化无法被证明"（**优先级最高**）

- `qualityEvaluation.ts:62` 把后台搜索词并入 `text.all`，`:113` 在其上算覆盖率；`:115` 的措辞还
  写成 "present in the listing"。
- 后果：实测 fallback(81) > AI(71)；团队会**朝错误方向优化**（多塞后台词）。
- 这不是"转化瓶颈"，而是**转化能力的度量瓶颈**——但它排第一，因为在它修好前，其余改动都无法验收。

### 瓶颈 2：交付与质量的强耦合——AI 稿常常发不出去，而发布物是模板稿

- 官方 PASS 0/3；残余失败 4/5 是 Writer 目的从句。
- fallback 稿是纯事实复述框架（`generation.ts:60-66` 的 5 个固定句式），且被两套量表硬性封顶
  （`qualityEvaluation.ts:203-206` 封 8；`conversionScore.ts:208-211` 封 6）。
- ⚠️ **你的约束（不得修改 Validator / fallback）恰好移除了这一环的两个直接手段。**
  因此 V5.8 只能在"让 AI 稿更干净"这一侧做功，**期望收益有限，不应被承诺为通过率提升**。

### 瓶颈 3：语义在投影层被抹平——分不清"要什么/骂什么"，也分不清"本品/竞品"

- `creativeContextBuilder.ts:529`（丢分组键）+ `:552`（`sourceType` 硬编码）→ 五类主题合一。
- `sourceProductRoles`（本品 vs 竞品）在两处投影全部丢失
  → 既是**正确性风险**（竞品缺陷可能被当成我方痛点去"解决"），也是**机会缺口**。
- 竞品 `bullets` 与 `relation` 同样未透传；`MAX_THEMES=12` 是**跨分组混合截断**
  （`:590-591`）→ 一个 2 条评论的 `recurringRequest` 可能被 6 条评论的 `positiveTheme` 挤出，
  而"未满足需求"通常比"好评"更有转化价值。

---

## 6. V5.8 最小升级方案

**全部满足：不新增 Planner / Agent / 状态节点 / API；不新增 AI 调用；不改 Validator / fallback / DB / 页面主流程。**

### 第 0 步（**必做，且必须先做**）：修度量口径 + 分层重算交付率

1. **修 `qualityEvaluation.ts:62`**：从 `text.all` 中移除 `backend`（后台搜索词买家不可见）。
   - 已核实 `text.backend` **仅**在 `:62` 使用（`:57/:61/:62`），故这是真正的 1 行改动、0 新增调用，
     可用单测锁定（断言"只塞后台词不得提高 keyword_relevance"）。
2. **按 `strategyPromptVersion` 分层重算交付率**：现有快照混了 Evidence Binding 前后的两种配置（§7.1）。
3. **为什么必须最先做**：在这之前，任何"转化是否变好"的结论都不可信。

### 第 1 步：把 `strength`/`count` 接进确定性重排（改 `conversionBlueprint.ts`，纯函数）

- 对 `painPoints` / `purchaseTriggers` / `benefitOrder` 增加按证据强度的**稳定重排**
  （`recurring` > `weak` > `isolated`；同强度按 `count` 降序；再按原顺序稳定）。
- 让 `weakSignals` 来源的痛点降级，落实 VOC prompt 已有的"不得过度解读"约束。
- **口径要说准**：频次已经在决定"谁能活到下游"（`:590-591`），本步的增量是
  **"重排幸存者"**，不是"从零引入排序"。
- 成本：**0 新增 AI 调用、0 新增状态、0 新增字段**；**只改"先说什么"，不改写任何文案**，不触 Validator。

### 第 2 步：透传语义标签（改 `context.ts` + 只加可选字段）

- 给 `ListingV5Reference` 增加可选 `group`
  （`positive|pain_point|usage_scenario|recurring_request|weak_signal|conflict`），
  并在 `creativeContextBuilder.ts:529` **保留分组键**。
- 可选一并透传 `sourceProductRoles` 与 `relation`（后者顺带修复"irrelevant 竞品进入参考"的契约偏差）。
- 收益：① 排序可只作用于 `pain`/`request`，并把 `weak_signal` 降级；② 竞品来源痛点可用于差异化，
  且避免把竞品缺陷当成本品痛点。
- 成本：0 新增调用；会改变 `contextFingerprint`（代价见 §7.4）。

### 第 3 步（假设，须先离线证伪）：给 Writer 与需求相关的"已批准收益语汇"

- 现状：`BENEFIT_BY_FIELD`（`conversionBlueprint.ts:113-130`）是 16 条**通用**措辞，与本品需求无关。
- 假设：**当被批准的收益措辞正好命中市场最大的需求时，Writer 自造从句的压力下降。**
- **必须先证伪**：在冻结的 3 案 + 离线 runner 上做对照（同 draft、同指纹、只换喂给 Writer 的收益语汇），
  确认 `unsupported` 下降且不出现 C1/C7 式的互相拉扯。**不成立则不做**（已有同类实验因收益不一致回滚）。

---

## 7. 诚实说明、未验证假设与修订记录

### 7.1 ⚠️ 头条指标"20% 交付率"存在方法论硬伤（对抗审查指出，已确认）

我最初用"5 个任务中 AI 交付 1 个 = 20%"作为头条，**这个数字不可作为立项依据**：

1. **混用了两种配置**：`cmtwk36m20` 与 `cmtwkd1oo0` 都是在 Evidence Binding（含 strategy prompt v4→v5）
   **之后**生成的；其余 3 个快照早于该改动。
2. **样本被我自己改写**：`cmtwkd1oo0` 在改动**之前**是 `writerAttempted=true, fallbackUsed=false`
   （**AI 交付**），本次重新生成后变成 fallback。即该样本里**有 1 个 AI 交付被我的运行覆盖**。
3. 结论：**"20%" 不是任何单一配置的交付率，只能算轶事级证据**。按配置粗看，改动后观测为 1/2，n 极小。

### 7.2 其它未验证事项

- **不承诺通过率提升**：瓶颈 2 的根因是指令对冲 vs Validator 锚定，而约束禁止动两侧。
  V5.8 只改善 AI 稿的顺序与语义基础，**收益上限有限**。
- **`sourceProductRoles` 的实际覆盖率未验证**：机制正确且已被测试
  （`VocEvidenceSection.test.ts:174` 断言过 `["competitor"]`），但**真实任务里 competitor 来源的占比未知**。
  实施第 2 步前应先只读统计其分布。
- **数据不足是常态**：实测存在 `voc=0` 的任务（`cmtwkikd60` facts=8/voc=0；`cmtwkhaci0` facts=5/voc=0）。
  VOC 为空时"卖点来自评论"整条逻辑无源可用——第 1/2 步对这类任务无收益，需在方案里显式降级。
- **89 分 ≠ 交付物分数**：它来自离线 runner（不跑 repair/rewrite/recovery/fallback、用 AI 初稿）。
- 本机 DB 期间被清空过，任务数据不可完整复现。

### 7.3 修订记录（对抗审查发现并已修正的 4 处）

| # | 原稿错误 | 修正 |
|---|---|---|
| 1 | 称 `conversionScore`"只用于展示" | **它根本没接线**；页面显示的是 `qualityEvaluation` 那套 |
| 2 | 称 Strategy"没有任何排序" | **夸大**：频次已决定"谁能存活"（`:590-591`），只是不决定顺序 |
| 3 | 称 Writer"被禁止做的恰是转化最需要的" | **错**：`:108` 明确鼓励收益从句；真问题是指令层对冲 |
| 4 | 头条用"20% 交付率" | **降级为轶事**，并披露 pre/post 混用与样本被覆盖 |

另补正一处措辞：`sourceProductRoles` 并非"全仓无人用"——VOC 证据页在渲染它；
准确说法是**在 Listing 链路上丢失**。

### 7.4 `contextFingerprint` 代价

第 2 步加字段会改变指纹 → 既有快照标记为 stale（Evidence Binding 已实测发生过一次）。
属一次性成本，`plannedCalls` 不变。

---

## 8. 对抗式审查：明确不要做

| 不要做 | 理由 |
|---|---|
| ❌ **不新增任何 Planner / 决策层** | 同类决策产物已有 **6 个**；且 `listingGenerationService.ts:1770/1773/1774` 的守卫等价于 `copyReady && !copyReady` **恒假**，**带 id 的 LLM Planner 已是死代码**。再加极可能重演 |
| ❌ **不新增 AI 调用** | 本方案三步全部复用既有调用。排序依据（`reviewCount`/`strength`/`coverage`）**全是确定性的**，用 LLM 排序是浪费 |
| ❌ **不放松 Validator / 不改事实锚定** | 这是当前唯一真正在工作的高价值能力（9/10） |
| ❌ **不改 fallback 文案模板** | 即便它是当前多数发布物——它同时是安全底线。应单独决策、单独验收，不能夹带 |
| ❌ **不重复建设"竞品分析"** | `relation`、`sourceProductRoles`、`detailBullets` **都已存在**，只是没透传 |
| ❌ **不新建"购买动机"AI 分析** | VOC 被设计为只做证据聚类（prompt 禁止 purchase advice）。要动机应改 VOC 的输出分组，而非再开一路 AI |
| ❌ **不把 `decisionSequence` 动态化** | 它是常量，且 Writer prompt `:114` 只要求 "Follow benefitOrder"、**根本不读 decisionSequence** → 改一个没人读的字段 |
| ❌ **不给 `benefitPriority` 加评分体系** | 它**已投影并已在 UI 渲染**（`route.ts:270-271`、`ListingStudioV5Client.tsx:925-937`），加评分要连带改 UI，收益不明 |
| ❌ **不追求把 `ai_suggestion` 清零 / 不伪造证据** | 那会重演 `listingPlan.ts` 用常量 `"ev:voc"` 填 `evidenceRefs` 的先例 |
| ❌ **不做 UI 大改** | 本轮目标在数据流；UI 改动不提升转化，只增加回归面 |

**"看起来有用但不会提升转化"的清单**：
1. 再写一套策略/规划层（覆盖不到交付率，且是第七套重复）；
2. 新增一次"竞品分析 AI 调用"（竞品信号已在库里，缺的是透传）；
3. 调整 `conversionScore` 的评分权重（**它未接线，调它对任何可见输出零影响**）；
4. 引入 `confidence` / 可信度百分比之类的"假精度"（会放大 `marketingIntelligence/analyzer.ts:59` 那类置信度通胀缺陷）；
5. 新的"证据强度排序器"独立成模块（会与刚落地的 `evidenceBinding.buildEvidenceIndex` 重叠）。

---

## 9. 如果只允许做一件事

**修 `lib/listingV5/qualityEvaluation.ts:62`——从 `text.all` 中移除 `backend`。**

理由：它是当前唯一一个**会让优化方向反向**的缺陷（后台词不可见却计入关键词覆盖，实测让
fallback 81 反超 AI 71）。1 行、0 新增调用、可单测锁定。
**在度量口径修好之前，V5.8 的任何改动都无法被证明有效或无效。**
（若允许第二件事：`context.ts` 透传 `sourceProductRoles` + `relation` 过滤。）
