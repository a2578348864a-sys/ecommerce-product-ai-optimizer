# Listing V5.2 — Conversion Rewrite 设计（决策链 + 整体重写）

> 只读依据：`lib/listingV5/*` 与 `benchmark-v51-final/H1..H5-generate.json` 的 `snapshot.listing`。只设计，不含实现。

## 1. 高转化结构、失败模式与当前差距

| 字段 | 应承载 | 常见失败模式 |
|---|---|---|
| 标题 | 品类可检索词 + 唯一识别 + 一个最强可验证属性 | 同义词堆叠、事实原样拼接、缺买家意图短语 |
| 五点 | 每点一个购买理由：使用时刻 → 确认事实 → 到手结果 | 参数罗列、无场景、无风险消除、无取舍对比、五点同模板 |
| 描述 | 定位 → 主事实收益 → 真实场景 → 风险消除，2–4 句 | 复述五点、无场景、无收口 |

实测差距：

- H3/H4 走 fallback：标题即事实拼接（`TERRO T300-2 2-Pack Liquid Ant Baits 12-Pack TERRO T300B Liquid Ant Bait Ant Killer, 12 bait stations`），五点全套 `shoppers can compare a clear product detail for everyday routines`，并逐条复述产品名 → Keyword relevance **3/20**、Conversion strength 8/20、总分 64/C。
- AI 路径（H1 73、H2 76、H5 83）已有场景与收益，但三案均记 `description does not state a strategy use scenario`；H2 标题不含 buyerIntent → Conversion strength **6/20**。
- 五案 `competitorGaps` 全为空 → Differentiation 恒为中性分：禁止引用竞品后，"对比"必须改由事实自证。

## 2. 决策链：定义与确定性派生规则

总则：五字段均为 `confirmedFacts + strategy` 的纯函数；不读 `references.competitors` 与 `sourcing`；无事实支撑一律 `factBacked=false` 并输出空值，不猜需求、不补人群、不引竞品文本。

**productPositioning**：一句可核查的"是什么 + 给谁 + 凭哪条事实"。派生 = `product_type`（缺则 `productIdentity`）+ `strategy.targetAudience[0]`（缺则省略）+ proofPoints 中字段优先级最高的确认值；`anchors` 少于 2 条时降级为纯识别句，不写定位修辞。

```json
{"positioning":"1 Count zinnia seed pack for home gardeners, stated as Green","audience":"home gardeners","anchorFactIds":["f1","f2"]}
```

**buyerIntent**：搜索意图。派生 = `strategy.keywordIntent.primary[0]`（缺则 `productIdentity`）；`stage` 复用既有判定：含 best/vs/compare/top → `comparison`，primary 为空 → `discovery`，否则 `purchase_ready`。

```json
{"primary":"zinnia seeds","secondary":["flower seeds"],"stage":"purchase_ready"}
```

**purchaseObjections**：只保留能被确认事实回答的顾虑。`objection` 取 `strategy.painPoints` 与 VOC 主题（仅作措辞框架）；`resolution` 必须绑定 `factIds`，沿用现有 `PAIN_RELIEF_FIELDS` 映射。无 factIds 的顾虑进 `silentObjections`，提示模型必须沉默。

```json
{"handled":[{"objection":"will it fit my cabinet","resolution":"answer with the confirmed dimensions detail","factIds":["f3"]}],"silentObjections":[]}
```

**benefitPriority**：每条收益 = 一条 proofPoint 的确定性 `shopperBenefit`；`priority` 先按 `strategy.bulletAngles` 角色顺序、再按 confirmedFacts 顺序补足，同一 factId 只出现一次。

```json
{"benefit":"measurements remove fit guesswork","priority":1,"factIds":["f3"]}
```

**decisionSequence**：固定五步，与 bulletRole 一一对应，禁止重排。

```json
[{"step":"use_scenario","role":"use_scenario","bulletIndex":0},{"step":"core_benefit","role":"core_outcome","bulletIndex":1},{"step":"ease_of_use","role":"ease_of_use","bulletIndex":2},{"step":"proof","role":"proof_or_fit","bulletIndex":3},{"step":"risk_reduction","role":"pain_relief","bulletIndex":4}]
```

## 3. Conversion Rewrite 的职责边界

| | Repair | Conversion Rewrite |
|---|---|---|
| 目标 | 消违规，保留原稿表达 | 重排购买理由密度与场景 |
| 范围 | ≤3 个白名单字段的文本 | 整篇 title / 3–5 bullets / description / keywords |
| 事实 | 保持原 factIds | factIds 重新绑定 confirmedFacts，strategyRole 按 decisionSequence 重排 |

允许输入：`context.confirmedFacts`；blueprint（`competitorSignal` 置空）；`failedListing` 清洗后文本；`unsupportedDetails` 的 `text`/`offendingSpans`（否定清单，非事实）。
禁止输入：竞品标题与五点原文、`references.competitors/voc/keywords` 任何文本、sourcing 任何内容、未确认属性与推断的人群或需求。
输出契约：`{"title":{text,factIds},"bullets":[{text,factIds,strategyRole}]×3–5,"description":{text,factIds},"backendSearchTerms":[]}`，经既有 normalizer 归一。
语义：每案最多 1 次调用、不重试；返回稿必须重过同一 Validator；PASS → 直接发布，非 PASS → 丢弃该稿并走既有 fallback 闸门。provider 失败或结构非法 → `draft=null`，fail-closed，既有路径不变。

## 4. Rewrite Prompt 设计要点

1. FACTUAL AUTHORITY: Confirmed Facts are the only factual authority; every number, size, material, capacity, colour, pack count, care or compatibility statement must keep the wording and meaning of a Confirmed Fact you cite in factIds.
2. NO NEW FACTS: reorder, split, compress and reconnect confirmed wording freely, but never add a specification, certification, duration, performance, ranking or absolute promise, and never imply a source you were not given.
3. DECISION SEQUENCE: place the bullets in this order and set strategyRole to the matching role — use_scenario, core_outcome, ease_of_use, proof_or_fit, pain_relief.
4. REASON-TO-BUY DENSITY: make every bullet one purchase reason — a real use moment, then the confirmed detail that serves it, then what the shopper gets; never stack two attributes without a shopper outcome.
5. SCENARIO: open bullet 1 with a strategy use case the facts can actually support, and open the description with the positioning sentence.
6. RISK REDUCTION: answer only the purchaseObjections that carry factIds, using exactly those values; for every silentObjections entry write nothing at all.
7. AVOID HARD CLAIMS: never write a word from disallowedTemptations or prohibitedVocabulary, not as an adjective, comparative or hyphenated compound, and never let a copula assert an adjective — write the confirmed noun phrase itself.
8. VARIETY AND SHAPE: vary sentence structure, keep 12–32 words per bullet, write 2–4 description sentences, and return JSON only in the output contract shape.

## 5. 验收标准

| # | 门槛 | 观测方式 |
|---|---|---|
| 1 | Conversion Score 均值 **≥85**，单案 ≥75 | 同一 `scoreListingV5Conversion` rubric（五维×20，rubric 不改），冻结 5 案池 |
| 2 | AI 交付率 **≥80%**（≥4/5） | first PASS、repair 后 PASS、rewrite 后 PASS 均计入 |
| 3 | fallback **≤20%**（≤1/5） | `provider.fallbackUsed` 与 `fallbackReason` 逐案记录 |
| 4 | Safety **100%** | 发布稿 `validation.status = PASS`，且 unsupportedClaims / prohibitedClaims / competitorOverlap 全为 0 |
| 5 | Rewrite 边界可观测 | 每案 ≤1 次调用；一条测试断言输入白名单不含竞品/VOC/keywords/sourcing 文本；一条断言重写稿必然重过 Validator |
| 6 | 派生确定性 | 同一 context+strategy 下 blueprint 五字段可复现；无事实支撑项 `factBacked=false` |

> 诚实提示：五案 `competitorGaps` 为空时 Differentiation 走中性分，≥85 要求其余四维接近满分。触顶应如实报告为结构上限，不得改评分器或 rubric。
