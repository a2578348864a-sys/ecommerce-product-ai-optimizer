# Listing Strategy Planner 输入契约分析（VOC / 关键词 / 竞品）

> 分析对象：`project-001-listing-v5` @ HEAD `bd070ca`（工作区含他人未提交改动，本文件为唯一新增文件，未触碰任何源码/配置/测试）。
> 方法：只读扫描真实代码；所有论断标注 `文件:行号区间`。类型草稿仅存在于本文 markdown 代码块内。
> 命名：本文把"证据本体"（`ViralAnalysisRecord.resultJson` 的命名空间）称为 **Evidence 层**，把 `lib/creativeContextBuilder.ts` 的输出称为 **投影层**，把 `lib/listingV5/*` 的输入称为 **消费层**。

---

## 0. 结论先行

| # | 结论 | 关键证据 |
|---|---|---|
| C1 | **VOC 已高度结构化，是三条流里唯一带"编号 + 强度 + 覆盖度 + 细粒度证据引用"的流。** | `lib/server/vocAnalysis.ts:37-56` |
| C2 | **keyword / competitor 结构化程度低得多**：关键词的全部指标（搜索量/排名等）落在 `rows[].fields` 里但从未被投影读取；竞品的 `note` 是可选字段。 | `lib/server/keywordEvidence.ts:50-76`、`lib/server/competitorEvidence.ts:28-45` |
| C3 | **投影层（投影桥）保留了证据身份，消费层把它彻底压平丢弃。** 丢失点唯一且集中：`lib/listingV5/context.ts:122-124`。 | 同左 |
| C4 | **压平是"不可逆"的**：`insightId / evidenceRefs / strength / reviewCount / coverage / relation / bullets / observedAt` 在消费层无任何还原路径，且下游用 `split(":")` 反解主题名，属于二次损坏。 | `lib/listingV5/strategy.ts:38`、`lib/listingV5/conversionBlueprint.ts:226` |
| C5 | **`relation` 字段被计算但从未在 V5 链路使用**：遗留链路有过滤（`listingGenerationService.ts:1226`），V5 链路无过滤（`context.ts:124`），与"仅 direct 允许进入 Listing"的模块契约直接冲突。 | `lib/research/researchInputQuality.ts:6-7` vs `context.ts:124` |
| C6 | **"证据身份丢失"是系统性缺陷，不止 V5 一处**：`MarketingInsightItem` 与 `CopyStrategyV1` 同样无任何证据 id；唯一看似有 id 的 `researchSignals.signalId` 实为**位置序号**（`voc-1`），不稳定。 | `marketingIntelligence/types.ts:15-22`、`copyStrategy/types.ts:16-28`、`listingPlanner.ts:134` |
| C7 | **存在两套互不换算的置信度**：`strength`（证据级，由 `reviewCount` 决定）与 `confidence`（分析器级，由文本命中数决定），且 `confidence` 的 strength 分支在生产中不可达、命中数分支可给出与 strength 相反的结论。 | `vocAnalysis.ts:107-112` vs `marketingIntelligence/analyzer.ts:32-36,59` |
| C8 | **V5 策略当前"无证据也能写"**：`ListingV5Strategy` 全字段为纯 `string[]`、仅 `referenceOnly:true`，无一处证据绑定；确定性兜底用 4 条硬编码正则从 VOC 文本猜痛点。 | `lib/listingV5/types.ts:51-65`、`lib/listingV5/strategy.ts:10-18,42` |
| C9 | **修复面极小**：只需在投影层（`context.ts` 的 references 映射）与 `ListingV5Reference` 类型上加"透传 + 过滤"，不动 Evidence 写入、不动 Validator/Writer/Fallback。 | 第 8 节 |

**一句话**：证据本体足够好，投影桥也还留着身份；**唯一断点在 `context.ts:122-124` 的三行 `.map(...)` 压平**，修好它就能让 Strategy 拿到"可追溯、带强度、可设门槛"的输入。

---

## 1. 数据在哪里、是否已结构化

### 1.1 命名空间总表（`ViralAnalysisRecord.resultJson`）

| 命名空间 | 常量定义 | 解析入口（投影层） | 结构化程度 |
|---|---|---|---|
| `vocAnalysis` | `lib/server/vocAnalysis.ts:26` | `creativeContextBuilder.ts:233-235` | **高**（编号/强度/覆盖/引用齐全） |
| `keywordEvidence` | `lib/server/keywordEvidence.ts:19-20` | `creativeContextBuilder.ts:241-253` | 中（行级结构齐全，但指标未读取） |
| `competitorEvidence` | `lib/server/competitorEvidence.ts:18-21` | `creativeContextBuilder.ts:255-261` | 中低（`note` 可选、上限 5） |
| `browserEvidence` | — | `creativeContextBuilder.ts:219-231` | 高（含 `entityBinding`） |
| `aiEvidenceSummary` | `lib/server/aiEvidenceSummary.ts:55-82` | `creativeContextBuilder.ts:237-239` | 高（每条强制 `evidenceRefs`） |
| `sourcingEvidence` | — | `creativeContextBuilder.ts:263-278` | 中（已被人确认/候选两级） |

### 1.2 VOC

**结论：已结构化，且是唯一自带"服务端确定性强度"的流。** AI 只负责聚类与解释，数量/覆盖/强度全部由服务端按 `evidenceRefs` 计算（`vocAnalysis.ts:1-7,291-311`）。

| 字段路径 | 类型/取值 | 投影层是否保留 | 能否直接用于痛点 | 能否绑定证据 |
|---|---|---|---|---|
| `themes.painPointThemes[].label` | `string` ≤60 | 是（`theme`） | **可直接用**（痛点主题名） | 间接（靠 theme 的 refs） |
| `themes.painPointThemes[].summary` | `string` ≤400 | 是（`summary`） | **可直接用**（痛点说明） | 间接 |
| `…[].evidenceRefs[]` | `string[]` = review `evidenceId`（UUID） | 是（`evidenceRefs`，截 5 条） | 否 | **可直接绑定** |
| `…[].themeId` | 16 hex，`sha256("theme:"+label)` | 是（`insightId`） | 否 | 编号锚点 |
| `…[].reviewCount` | 服务端计算 = 有效 refs 数 | 是 | 否（强度判据） | — |
| `…[].coverage` | `reviewCount / reviewsUsed` | 是 | 否（强度判据） | — |
| `…[].strength` | `isolated\|weak\|recurring` | 是 | 否（准入判据） | — |
| `…[].sourceProductRoles[]` | `current_candidate\|competitor` | **否** | 影响解读（我方评论 vs 竞品评论） | — |
| `…[].limitations` | `string\|null` ≤200 | **否** | 影响可信度 | — |
| `themes.conflicts[]` | 正负双方各自 `evidenceRefs` | 部分（合并双方 refs，丢 `note` 与"哪一方"） | 应视为**冲突**而非痛点 | 可绑定（双方都非空才成立） |
| `themes.usageScenarios / recurringRequests / weakSignals` | 同 `VocTheme` | 是（与痛点混为一池） | `usageScenarios` 可用于 useCases；`weakSignals` 应降级 | 同左 |
| `unknowns[]` | `string[]` ≤300 | 是（→ `missingConflicts`） | 否（是缺口，不是痛点） | 弱（`ev:voc:unknowns` 无逐条 id） |
| `unverified[]` | 无有效 refs 的主题 | **否**（有意排除，正确） | **禁止使用** | 无 |
| `datasetSnapshot.reviewsUsed` | `number` | **否** | 解读 `coverage` 的分母 | — |
| `gateResult` | `pass\|fail` | **否** | 质量闸门 | — |

**强度/覆盖的确切算法**（`vocAnalysis.ts:30-33,107-112,291-311`）：

```
weakMin = 2, recurringMin = 4
reviewCount = |{ ref ∈ theme.evidenceRefs : ref ∈ reviewsById }|      // 过滤掉不存在的 ref
coverage    = reviewsUsed > 0 ? reviewCount / reviewsUsed : 0
strength    = reviewCount<=0 ? isolated : reviewCount<2 ? isolated : reviewCount<4 ? weak : recurring
```

**痛点提取能力**：
- **可直接用**：`painPointThemes[].label + summary`（已聚类的痛点陈述）。
- **需要推断**：`usageScenarios` → useCases 的映射（语义等价但非显式）；`conflicts` → 是否构成痛点（应默认否）。
- **禁止使用**：`unverified[]`（无有效 refs）；`weakSignals`（`vocAnalysis.ts:155` 明确要求"1-2 条评论不应过度解读"）。

**`evidenceRef` 的确切格式与可追溯性边界**：

| 项 | 事实 | 证据 |
|---|---|---|
| 细粒度 ref | VOC 主题的 `evidenceRefs[]` 元素 = review 的 `evidenceId` | `vocAnalysis.ts:180-182,296-306` |
| `evidenceId` 的形态 | **`randomUUID()`**（36 字符 UUID），非结构化 | `reviewEvidence.ts:305`，形校验 `/^[a-z0-9-]{8,64}$/i` at `:198` |
| 投影层包装 | `provenance.evidenceRef = "ev:voc:" + evidenceRefs[0]` | `creativeContextBuilder.ts:554` |
| **`observedAt` 恒为空** | VOC 主题/冲突/unknowns 的 `observedAt` 被**硬编码空串** | `creativeContextBuilder.ts:556,585,745` |
| 本可填充的时间 | `vocAnalysis.startedAt / finishedAt / updatedAt` 存在但**未传播**到 insight | `vocAnalysis.ts:67-69,83` |
| review 级时间 | `ReviewItem.capturedAt` 存在，但要经 `evidenceRefs → reviewsById` 才能取到 | `reviewEvidence.ts:51` |

> **可追溯性边界（结论）**：VOC 的 `evidenceRef` 在**投影层**可追溯（指向 review UUID）；但 **`observedAt` 恒为空**，即"这条洞察是什么时候观察到的"在当前契约里不可回答。要做时间性判据，必须补 `vocAnalysis.finishedAt`（命名空间级）或经 refs 解析 `ReviewItem.capturedAt`（需回查 `reviewEvidence`）。**仅靠现有 `CreativeContextVocInsight` 无法恢复时间。**

### 1.3 keyword

**结论：行级结构齐全，但"证据的度量"从未进入任何消费层。**

| 字段路径 | 类型 | 投影层是否保留 | 备注 |
|---|---|---|---|
| `reportType` | `reverse_asin\|keyword_mining` | 是 | 决定报告语义 |
| `capturedAt` | ISO string | 是（`observedAt`） | **可为空**（`asIso` 无效值 → `""`，`creativeContextBuilder.ts:207-211`） |
| `rows[].rowNumber` | `number` | 是 | 现有排序键 |
| `rows[].keyword` | `string` | 是 | **唯一进入 V5 的内容** |
| `rows[].keywordTranslation` | `string\|null` | **否** | |
| `rows[].fields{field:{raw,normalized,metricNature,applicability}}` | 指标字典 | **否** | 搜索量、ABA 排名等**全部丢弃** |
| `dataPeriod` | **恒为 `null`**（契约占位） | 否 | `keywordEvidence.ts:26` |
| `schema` | `seller-sprite-keyword-evidence.v1` | 否 | 版本未参与指纹 |

**evidenceRef 格式**：`ev:keyword:<reportType>:<keyword>`（`creativeContextBuilder.ts:605-611`）。

> **可追溯性缺陷**：该 ref **不含 `rowNumber`**。同一 `reportType` 下若出现重复关键词（不同行），两条证据会得到**同一个 id**。此外 `ev:keyword:` 前缀 + 关键词原文，若关键词含 `:` 或超长会破坏可读性（关键词已在 `:597` 截断到 120 字符）。

### 1.4 competitor

**结论：`relation` 是本流最有价值的结构化产物，但在 V5 被完全绕过。**

| 字段路径 | 类型 | 投影层是否保留 | 备注 |
|---|---|---|---|
| `asins[].asin` | 10 位 `A-Z0-9` | 是 | 上限 `MAX_ASINS = 5`（`competitorEvidence.ts:20`） |
| `asins[].note` | **可选** `string` ≤500 | 是（截 160） | 同时被当作竞品"标题"用于相关度判定 |
| `asins[].addedAt` | ISO | 是（`observedAt`） | 可空 |
| `asins[].sourceKind` | `manual\|browser_use` | **否** | 影响可信度 |
| `asins[].sourceUrl` / `capturedAt` | — | **否** | |
| `asins[].reasonCodes[]` | ≤9 | **否** | |
| `asins[].detailBullets{bullets[≤5]≤500, capturedAt, sourceUrl}` | — | 仅 `bullets`（截 200×5） | **`capturedAt`/`sourceUrl` 丢失** |
| `competitiveContext[].relation` | `direct\|adjacent\|irrelevant` | 是（投影层） | 由 `classifyCompetitorRelation(note, productName)` 判定 |

**判定逻辑**（`researchInputQuality.ts:112-132`）：`note` 规范化后与商品名共享"具体词"数 ≥2 → `direct`；=1 且命中 ≥2 词连续短语（≥6 字符）→ `direct`；=1 → `adjacent`；0 → `irrelevant`；**商品名为空 → 全部 `irrelevant`（fail-closed）**。

**三个必须记录的问题**：

| 问题 | 事实 | 影响 |
|---|---|---|
| P1 `relation` 在 V5 未过滤 | `context.ts:124` 直接 `.map(item => item.note \|\| item.asin)`，无 `relation` 判断；而遗留链路有 `.filter(c => c.relation !== "irrelevant")`（`listingGenerationService.ts:1226`） | `irrelevant` 竞品会作为策略参考进入 Listing，违反 `researchInputQuality.ts:6-7` 的模块契约 |
| P2 截断先于分类 | `competitorEvidence` 到 `slice(0, MAX_COMPETITORS)`（`creativeContextBuilder.ts:625`）**按数组插入序**取前 5，`relation` 在其后才算（`:633`） | 前 5 条若全是 `irrelevant`，真正 `direct` 的竞品被挤掉且不可恢复 |
| P3 无 `note` 的竞品必然 `irrelevant` | `note` 可选（`competitorEvidence.ts:33`）；`cleanExcerpt(undefined,300)` → `""` → shared=0 → `irrelevant`（`:634`+`researchInputQuality.ts:115-118`） | `browser_use` 自动采集但未写 note 的竞品会被判定为不相关 |

**`relation` 过滤对 Listing 的意义**：`direct` 才能提供"同一属性维度上的可比对象"，是 `conversionBlueprint` 生成 `competitorGaps` 的前提（`conversionBlueprint.ts:256-273` 依赖竞品文本命中 `ATTRIBUTE_LEXICON` 且**我方事实也命中同一维度**）。`adjacent` 只能支撑"相邻替代"表述，`irrelevant` 进入会把无关属性当差异点。

**`bullets` 作为参考的越界风险（明确）**：

| 风险 | 机制 | 证据 |
|---|---|---|
| R1 竞品声明被当作我方事实 | `bullets` 是竞品详情页原文，若被 prompt 直接引用，模型极易复述为我方属性 | `competitorEvidence.ts:39`（注释已声明 reference-only） |
| R2 触发 Validator 的竞品重叠判罚 | `competitorOverlap` 对**全部** competitor reference 做文本重叠检测，命中即计入阻断项 | `validation.ts:558-561`、`:617` |
| R3 被写成差异点但无我方事实支撑 | `competitorGaps` 要求"竞品与**我方事实**共享属性维度"，否则 `continue` | `conversionBlueprint.ts:260-271` |

> 结论：`bullets` 可以**作为维度线索**（用于 `competitorGaps.dimension` 的发现），**不得作为可引用文本**进入任何面向 Writer 的字段；且应显式限定为 `relation === "direct"`。

---

## 2. 投影桥：`CreativeContextV1`（唯一桥）

`buildCreativeContextFromResearch()`（`creativeContextBuilder.ts:361-777`）是 Evidence → 创作上下文的**唯一桥**，纯函数、无 DB/网络/时间/随机（`:18-22`）。预算常量集中在 `:178-184`：

| 常量 | 值 | 作用域 |
|---|---|---|
| `MAX_EXCERPT` | 200 | 单条摘要 |
| `MAX_THEMES` | 12 | VOC 主题总数 |
| `MAX_KEYWORDS` | 20 | 关键词候选 |
| `MAX_COMPETITORS` | 5 | 竞品（与 Evidence 上限一致） |
| `MAX_SOURCING` | 5 | 货源 |
| `MAX_AI_REFS` | 10 | AI 参考 |
| `MAX_MISSING` | 12 | 缺失/冲突 |

**投影层保留的证据身份**（这正是 V5 丢掉的东西）：

| 流 | 稳定 id | 细粒度 refs | 强度/覆盖 | 时间 |
|---|---|---|---|---|
| VOC | `insightId`（优先上游 `themeId`，`:543`） | `evidenceRefs[]`（截 5，`:536-538`） | `reviewCount`/`coverage`/`strength`（`:539-542`） | **恒空**（`:556`） |
| keyword | `evidenceRef`（`:605`） | 同左 | 无 | `capturedAt`（可空） |
| competitor | `evidenceRef = ev:competitor:<asin>`（`:640`） | 同左 | `relation`（`:633-635`），`bullets`（`:629-632`） | `addedAt`（可空） |

**投影层自身的两个 id 缺陷（需在契约中修正）**：

| 缺陷 | 事实 | 后果 |
|---|---|---|
| D1 冲突 id 与上游不一致 | `VocConflict.themeId = sha256("conflict:"+label)`（`vocAnalysis.ts:212`），但投影层**不读取**它，改为 `deterministicId("voc:conflict:"+label+":"+summary, "voc")`（`creativeContextBuilder.ts:574`） | 同一冲突在两个契约里有**两个不同 id**，无法互查 |
| D2 VOC themeId 只哈希 `label` | `hashId("theme:"+label)`（`vocAnalysis.ts:192`） | 不同分组（positive/pain）中同名主题得到**同一 themeId**；`dedupe` 会误合并 |

---

## 3. 压平缺口：`context.ts` 的不可挽回损失

**唯一断点**（`lib/listingV5/context.ts:122-124`）：

```
voc        = boundedReferences(vocInsights.map(i => `${i.theme}: ${i.summary}`), "VOC", …)
keywords   = boundedReferences(keywordCandidates.map(i => i.keyword), "keyword", …)
competitors= boundedReferences(competitiveContext.map(i => i.note || i.asin), "competitor", …)
```

产物类型只有一个字符串（`lib/listingV5/types.ts:14-19`）：

```ts
type ListingV5Reference = { text: string; sourceType: "VOC"|"keyword"|"competitor"|"sourcing";
                            marker: "UNTRUSTED_REFERENCE_DATA"; notProductFact: true };
```

### 3.1 不可挽回损失清单

| # | 丢失内容 | 来源字段 | 是否可还原 | 后果 |
|---|---|---|---|---|
| L1 | 稳定证据 id | `insightId` | **否** | 无法把策略字段回指到某条洞察 |
| L2 | 细粒度证据引用 | `evidenceRefs[]`（review UUID） | **否** | 策略与原始评论之间链路断开 |
| L3 | 强度 | `strength` | **否** | 无法设"仅 recurring 可进 Listing"门槛 |
| L4 | 评论数 | `reviewCount` | **否** | 同上；也无法做展示 |
| L5 | 覆盖度 | `coverage` | **否** | 无法判断"是不是只有 1/100 提到" |
| L6 | 来源语义细分 | `sourceType`（`voc_theme`/`voc_conflict`） | **否**（全被压成 `"VOC"`） | 冲突被当普通洞察；`weakSignals` 与痛点同权 |
| L7 | 观察时间 | `provenance.observedAt` | **否**（投影层本就恒空） | 时效性判据不可用 |
| L8 | 竞品相关度 | `relation` | **否** | 见 P1，与模块契约冲突 |
| L9 | 竞品五点 | `bullets[]` | **否** | 维度线索丢失；`conversionBlueprint` 只能用 `note` |
| L10 | 关键词度量与坐标 | `fields`、`reportType`、`rowNumber`、`evidenceRef` | **否** | 无法按搜索量/相关度排序，只能按行号 |
| L11 | 主题/摘要边界 | `theme` vs `summary` | **否**（拼成 `"theme: summary"`） | 下游用 `split(":")` 反解（`strategy.ts:38`、`conversionBlueprint.ts:226`）：主题或摘要含 `:` 即互相污染 |
| L12 | 货源流 | `sourcingContext` | **否**（`references.sourcing` 被硬编码 `[]`，`context.ts:151`） | 有意排除，但契约未声明 |
| L13 | AI 参考 / 缺失冲突 | `aiReferences`、`missingConflicts` | **否**（`context.ts` 未映射） | 见第 5 节 |

### 3.2 预算裁剪的三个隐患

| 隐患 | 机制 | 证据 |
|---|---|---|
| B1 跨流饥饿 | `MAX_TOTAL_REFERENCE_CHARS = 7000` 由 `voc → keywords → competitors` **顺序共享**；VOC 最多 12×300=3600 字符，关键词最多 20×300=6000 | `context.ts:10,82-95,120-124` |
| B2 词中间截断 | `item.text.slice(0, room)` 按字符切，且截断后的片段**照常入列**（`if (!clipped) break`） | `context.ts:88-92` |
| B3 双上限语义含混 | `MAX_REFERENCES=20` 是**每流**上限，`MAX_REFERENCE_CHARS=300` 是**每条**上限，但总预算跨流 | `context.ts:8-10` |

### 3.3 指纹连带影响（实施约束，非缺陷）

`references` 参与 `contextFingerprint`（`context.ts:125-139`）。**任何给 `ListingV5Reference` 增加字段的改动都会改变指纹 → 已缓存快照失效**，需同步 bump `LISTING_V5_*_PROMPT_VERSION`（`lib/listingV5/types.ts:9-12`）。这是"最小修复"必须预先声明的代价。

---

## 4. 既有三套消费者：证据身份系统性丢失

> 除 `CreativeContextV1` 外，仓库已有三套消费同一批参考数据的实现。新契约应**复用其概念**，但必须修掉它们共同的"证据身份丢失"。

### 4.1 `MarketingInsightV1`（确定性营销情报）

| 项 | 事实 | 证据 |
|---|---|---|
| 输入契约**已承认**强度 | `MarketingResearchReferenceText = string \| {theme?,summary?,keyword?,note?,title?,bullets?,strength?,reviewCount?}` | `marketingIntelligence/types.ts:35-44` |
| 但 `reviewCount` 从未被读取 | 全模块只在 `types.ts` 出现 | `marketingIntelligence/analyzer.ts:1-137`（无 `reviewCount`） |
| `strength` 分支**生产中不可达** | 生产桥传入的是**纯字符串**（`context.vocInsights` 等），`typeof entry !== "string"` 恒 false | `listingGenerationService.ts:250-257`、`listingGenerationInput.ts:308-334` |
| 输出**零证据身份** | `MarketingInsightItem = {topic,summary,sourceType,confidence,referenceOnly}`，无 id/ref | `marketingIntelligence/types.ts:15-22` |
| `summary` 是**固定模板句** | `VOC_TOPICS[].pain/need` 为硬编码中文常量，不是从证据文本生成 | `marketingIntelligence/analyzer.ts:15-19,56-63` |
| `topic` 是**封闭小集合** | VOC 3 个、keyword 3 个、competitor 3 个、sourcing 1 个 | `analyzer.ts:15-19,69-73,86-99,101-104` |

**缺陷 A（严重）**：`strength` 判定是**全局**的，不是按主题的 —

```
// analyzer.ts:59
const strength = voc.find(e => typeof e !== "string" && e.strength === "recurring") ? "recurring" : undefined;
```

只要**任意一条** VOC 参考是 `recurring`，**所有** topic 的 `confidence` 都被抬为 `high`。这是"证据身份丢失"的直接后果：因为输出没有 id，判定只能退化为对整个数组的全局扫描。

### 4.2 `CopyStrategyV1`（文案策略）

| 项 | 事实 | 证据 |
|---|---|---|
| 全字段无证据 id | `targetBuyer/buyerPainPoints[]/mainAngle/emotionalHook/copyTone/bulletStrategies[]/titleStrategy/descriptionStrategy/avoidExpressions[]` | `copyStrategy/types.ts:16-28` |
| 第二跳再次丢失 | `buyerPainPoints = insight.painPoints.map(i => i.summary)` — 连 `topic`/`sourceType`/`confidence` 也丢掉 | `copyStrategy/analyzer.ts:26` |
| `bulletStrategies` 是常量脚手架 | 1..5 固定 `purpose` 文案 | `copyStrategy/analyzer.ts:43-56` |
| 该策略会被写入 Planner Prompt | `COPY_STRATEGY_START … buyerPainPoints …` | `listingPlanner.ts:147` |

> 即：VOC 证据的 `label/summary` →（投影）→ `CreativeContextVocInsight` →（桥）→ 字符串 →（分析器）→ 硬编码中文模板句 →（文案策略）→ 字符串数组 →（Planner）→ prompt。**四次转换后，原文与证据身份均已不存在。**

### 4.3 `PlannerPromptView.researchSignals`（唯一"看起来有 id"的结构）

| 项 | 事实 | 证据 |
|---|---|---|
| 形状 | `Array<{source:"voc"\|"keyword"\|"competitor"\|"sourcing"; signalId: string; summary: string}>` | `listingPlanner.ts:62-68` |
| **id 生成规则** | `` `${kind}-${index + 1}` `` | `listingPlanner.ts:134` |
| 稳定性 | **位置序号**：顺序或数量一变，`voc-1` 就指向另一条证据 | 同左 |
| 截断 | 每流 8 条、每条 160 字符 | `listingPlanner.ts:134` |
| 竞品被 `String()` 化 | `source.competitiveContext.map(String)`（该处元素实为 `string[]`，故为 no-op；若将来换成对象会得到 `[object Object]`） | `listingPlanner.ts:135`、`listingGenerationInput.ts:320-326` |

> **结论**：`signalId` 是**展示用序号**，**不可**作为证据 id 复用。新契约必须与它**明确分道**（见 5.3）。

### 4.4 横向对比：四套消费者对同一批证据的处理

| 消费者 | 携带稳定 id | 携带 strength/reviewCount | 携带细粒度 refs | 过滤 relation | 输出可追溯 |
|---|---|---|---|---|---|
| `CreativeContextV1`（投影桥） | ✅ `insightId`/`evidenceRef` | ✅ | ✅ | ⚠️ 仅计算不过滤 | ✅ |
| `ListingV5Context`（V5 消费） | ❌ | ❌ | ❌ | ❌ | ❌ |
| `MarketingInsightV1` | ❌ | ⚠️ 声明未用（且判定全局化） | ❌ | ❌ | ❌ |
| `CopyStrategyV1` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `PlannerPromptView.researchSignals` | ⚠️ 位置序号 | ❌ | ❌ | ❌ | ❌ |
| `ListingGenerationInput.creativeContext`（遗留链路） | ❌ | ⚠️ 以文本 `"(N reviews)"` 内嵌 | ❌ | ✅（`listingGenerationService.ts:1226`） | ⚠️ 仅文本 |

> **系统性缺陷（回答父 Agent ①）**：`CreativeContextV1` 是**唯一**在投影层保住证据身份的结构；其下游四个消费者（V5 context、MarketingInsight、CopyStrategy、researchSignals）**全部**丢失。所以问题不是"V5 特别差"，而是**投影层之后缺少一个共同的'证据化参考'契约**——每个消费者各自把结构化对象压成字符串，再各自用正则/序号重建语义。修复应落在"投影层 → 消费者"这一段，而不是每个消费者各修一次。

---

## 5. Strategy 输入契约设计（草案）

### 5.1 设计原则

| 原则 | 说明 |
|---|---|
| G1 证据身份必须随行 | 每条参考携带稳定 `evidenceId` + 可追溯 `evidenceRef`，任何策略字段都能回指 |
| G2 强度是准入判据，不是装饰 | `strength`/`coverage` 参与 `tier` 计算并决定字段可用性 |
| G3 单一置信度来源 | 只保留 `strength` 为证据级真值，`confidence` 由 `tier` 派生，杜绝双重置信度 |
| G4 复用既有 id 命名 | 沿用 `ev:voc:` / `ev:keyword:` / `ev:competitor:` 前缀，不新造体系 |
| G5 bounded 沿用现有思路 | 每流 top-N + 每条字符上限 + **每流独立预算**（消除跨流饥饿） |
| G6 不变量不变 | `Evidence ≠ Fact`、`VOC ≠ Fact`、`AI Summary ≠ Fact`、`Competitor Evidence ≠ Product Fact`、`Keyword Evidence ≠ Product Fact`（`creativeContextBuilder.ts:8-13`） |
| G7 只动投影层 | 不改 Evidence 写入、Validator、Writer、Fallback |

### 5.2 类型草案（仅草图，不落地为 .ts）

```ts
// ─────────────────────────────────────────────────────────────
// listing-v5.planner-evidence.v1 —— Strategy Planner 的证据化输入
// 位置建议：lib/listingV5/context.ts 内新增类型 + 由 references 派生
// 目的：把 context.ts:122-124 的"压平成字符串"替换为"带身份透传"
// ─────────────────────────────────────────────────────────────

/** 证据流（与 PlannerPromptView.researchSignals.source 同名，便于对齐） */
export type PlannerEvidenceStream = "voc" | "keyword" | "competitor";

/** 证据级强度：直接搬 vocAnalysis.computeThemeStrength，不重新定义 */
export type PlannerEvidenceStrength = "isolated" | "weak" | "recurring";

/**
 * 准入等级：唯一判据。由 (stream, strength, coverage, relation, relevanceScore) 纯函数推导。
 * A = 可支撑"面向买家状态"的策略字段（painPoints / purchaseMotivations / useCases）
 * B = 仅可支撑框架类字段（angle / tone / targetAudience 泛化 / bulletAngles 角色）
 * C = 仅可进 gap 清单，禁止生成任何策略字段
 */
export type PlannerEvidenceTier = "A" | "B" | "C";

/** 该证据允许支撑的策略字段（白名单，避免下游自由发挥） */
export type PlannerEvidenceAllowedField =
  | "painPoints" | "purchaseMotivations" | "useCases" | "targetAudience"
  | "primaryAngle" | "secondaryAngles" | "tone"
  | "keywordIntent.primary" | "keywordIntent.secondary" | "keywordIntent.backendOnly"
  | "bulletAngles.role";

export type PlannerEvidenceItem = {
  /** 稳定证据 id（规则见 5.3；跨运行、跨顺序不变） */
  evidenceId: string;
  stream: PlannerEvidenceStream;
  /** 可追溯引用：能回到 Evidence 本体（不一定能回到单条原文，见 5.4） */
  evidenceRef: string;
  /** 细粒度引用：VOC = review evidenceId(UUID) 列表；keyword/competitor 为空 */
  evidenceRefs: string[];
  /** 保留来源语义细分，不再被压成 "VOC" 一个值 */
  sourceKind: "voc_theme" | "voc_conflict" | "voc_unknown" | "keyword_evidence" | "competitor_evidence";
  /** 参考文本（UNTRUSTED）。主题与摘要分开存放，禁止下游 split(":") 反解 */
  theme: string | null;
  summary: string;
  marker: "UNTRUSTED_REFERENCE_DATA";
  notProductFact: true;

  // ── 强度与准入 ──
  strength: PlannerEvidenceStrength;
  tier: PlannerEvidenceTier;
  /** 唯一置信度（由 tier 派生，禁止独立计算） */
  confidence: "high" | "medium" | "low";
  reviewCount: number | null;   // VOC：服务端计算值；其他流为 null
  coverage: number | null;      // VOC：reviewCount / reviewsUsed；其他流为 null
  /** 关键词相关度（researchInputQuality.scoreKeywordRelevance），其他流为 null */
  relevanceScore: number | null;

  // ── 竞品专用 ──
  relation: "direct" | "adjacent" | "irrelevant" | null;
  /** 竞品五点：**仅**用于发现可比维度，不进 prompt 文本 */
  competitorDimensions?: string[];

  // ── 溯源与完整性 ──
  observedAt: string;           // 允许 ""；为 "" 时 provenanceComplete=false
  provenanceComplete: boolean;

  /** 该证据被允许影响的策略字段（白名单） */
  allowedFields: PlannerEvidenceAllowedField[];
};

/** 证据不足的账本：被丢弃的候选在此留痕，**永不进入 prompt** */
export type PlannerEvidenceGap = {
  /** 被丢弃的候选文本的确定性哈希（不保留原文，避免回流进 prompt） */
  candidateHash: string;
  reason:
    | "no_evidence_id"        // 无法绑定任何证据
    | "strength_below_gate"   // isolated 或无 refs
    | "relation_not_direct"   // 竞品非 direct
    | "keyword_irrelevant"    // 相关度为 0
    | "conflict_not_resolvable"; // VOC 冲突（正负并存）
  stream: PlannerEvidenceStream;
  /** 人类可读的一句话说明，供 UI 展示 */
  note: string;
};

export type PlannerEvidenceBundle = {
  version: "listing-v5.planner-evidence.v1";
  items: PlannerEvidenceItem[];           // 已按 tier → strength → 原文 排序，bounded
  gaps: PlannerEvidenceGap[];             // 被丢弃项（bounded）
  counts: {
    vocTotal: number; vocAdmitted: number;
    keywordTotal: number; keywordAdmitted: number;
    competitorTotal: number; competitorAdmitted: number;
    tierA: number; tierB: number; tierC: number;
  };
  /** fail-closed 判据：tierA + tierB 是否足以支撑一次 Strategy 生成 */
  strategyAdmissible: boolean;
};

/** Strategy 输入 = 原有 context + 证据包（附加，不替换） */
export type ListingV5StrategyInput = {
  context: ListingV5Context;              // 保持现有字段与指纹语义
  evidence: PlannerEvidenceBundle;        // 新增，唯一证据权威
  confirmedFactSummary: { count: number; labels: string[] };  // 复用 CopyStrategyInput 既有概念
};
```

**与现有 `ListingV5Reference` 的关系**：保留 `ListingV5Reference`（`types.ts:14-19`）作为**渲染文本**用途（Writer prompt 仍需纯文本），把 `PlannerEvidenceItem` 作为**策略决策**用途。两者由同一投影派生，避免"又要文本又要身份"时再次压平。

**预算草案（沿用现有思路、消除跨流饥饿）**：

| 维度 | 现有 | 建议 |
|---|---|---|
| 每流条数 | 20（共享总字符预算） | VOC ≤12 / keyword ≤10 / competitor ≤5，**各自独立字符预算** |
| 每条字符 | 300 | 300（VOC summary 可放宽到 400，与 `vocAnalysis.ts:178` 一致） |
| 总预算 | 7000 跨流共享 | 8000 分账（VOC 3600 / keyword 2400 / competitor 2000），任一流不挤占他流 |
| 截断策略 | 字符硬切且片段照常入列 | **词边界截断；截断后不足 60% 则整条丢弃并入 `gaps`** |

### 5.3 稳定 evidence id 生成规则（回答父 Agent ②）

**总原则**：id 必须只依赖**证据自身的内容**，不依赖数组下标、排序或运行次序。

| 流 | `evidenceId` 规则 | 稳定性来源 | 与既有实现的关系 |
|---|---|---|---|
| VOC 主题 | `voc:theme:<group>:<themeId>`，`group ∈ {positive,pain,scenario,request,weak}`，`themeId = sha256("theme:"+label).slice(0,16)` | `label` | 复用上游 `vocAnalysis.ts:192,223-225`；**新增 `group` 前缀以修复 D2 的跨组同名碰撞** |
| VOC 冲突 | `voc:conflict:<conflictThemeId>`，`conflictThemeId = sha256("conflict:"+label).slice(0,16)` | `label` | **改用上游 id**（`vocAnalysis.ts:212`），修掉投影层 D1 的重复计算（`creativeContextBuilder.ts:574`） |
| VOC 缺口 | `voc:unknown:<index>` 的替代 → `voc:unknown:<sha256(text).slice(0,16)>` | `unknowns[]` 文本 | `unknowns` 是纯字符串数组（`vocAnalysis.ts:79`），无原生 id，只能按文本哈希 |
| keyword | `kw:<reportType>:<rowNumber>` （人读 ref 仍为 `ev:keyword:<reportType>:<kw>`） | `reportType + rowNumber` | 现有 `ev:keyword:<reportType>:<kw>`（`creativeContextBuilder.ts:605`）**不含 rowNumber，会碰撞**；故拆成"稳定 id"与"可读 ref"两用 |
| competitor | `competitor:<ASIN>`（人读 ref `ev:competitor:<ASIN>`） | `asin` | 与父 Agent 建议一致，且与 `creativeContextBuilder.ts:640` 现有 ref 对齐 |
| 货源 | `sourcing:<offerId>`（人读 ref `ev:sourcing:<offerId>`） | `offerId` | 沿用 `creativeContextBuilder.ts:667`；**Strategy 不消费**（保持 `conversionBlueprint.ts:18` 的排除） |

**与 `researchSignals.signalId` 的对齐 / 分道（明确）**：

| 维度 | `signalId`（`listingPlanner.ts:134`） | `evidenceId`（本草案） |
|---|---|---|
| 生成方式 | `` `${kind}-${index+1}` `` 位置序号 | 内容哈希 / 原生业务键 |
| 顺序变化 | id 指向漂移 | 不变 |
| 条数变化 | 后续全部重编号 | 不变 |
| 是否可回指证据 | **否** | **是**（`evidenceRef`） |
| 处置 | **保留**作为 UI 展示序号 | **新增**为唯一证据身份 |

> **分道规则**：`signalId` 继续服务"给人看的第 N 条信号"，`evidenceId` 服务"给模型与校验用的证据身份"。二者**不得互相赋值**；`plannerSuggestion` / prompt 中凡需引用证据处，一律使用 `evidenceId`。若未来要统一，只能**废弃** `signalId`，绝不能把序号提升为 id。

### 5.4 可追溯性边界（必须写进契约的诚实声明）

| 证据 | `evidenceRef` 能到达 | 不能到达 |
|---|---|---|
| VOC | 具体 review 记录（经 `evidenceId` 查 `reviewEvidence.dataset.reviews`） | **观察时间**（`observedAt` 恒空，`creativeContextBuilder.ts:556`），除非补 `vocAnalysis.finishedAt` 或回查 `ReviewItem.capturedAt` |
| keyword | 某次报告类型下的某一行（`reportType + rowNumber`） | 该行的指标值来源与抓取时间（`capturedAt` 可空） |
| competitor | 某 ASIN 的登记记录 | `note` 的原始出处（`sourceUrl` 被投影丢弃） |
| AI Summary | summary 条目 | 条目所引 refs 之外的一切 |

因此 `provenanceComplete` 字段是必要的：它让下游能区分"有 id 但无时间"与"完整可追溯"。

---

## 6. 证据强度的分级与准入门槛

### 6.1 两套分级的现状（回答父 Agent ③）

| 维度 | `strength` | `confidence` |
|---|---|---|
| 定义位置 | `vocAnalysis.ts:35,107-112` | `marketingIntelligence/analyzer.ts:13,32-36` |
| 取值 | `isolated \| weak \| recurring` | `high \| medium \| low` |
| 输入 | `reviewCount`（服务端按有效 `evidenceRefs` 计算，`:296-302`） | 文本命中数 `matches`、总数 `total`，以及一个可选 `strength` |
| 语义 | **证据本身有多强**（多少条真实评论支撑） | **分析器的匹配有多可信** |
| 粒度 | 每条证据 | 每个 topic（可能聚合多流） |
| 生产可达性 | ✅ | ✅（但 `strength` 分支不可达，见下） |

**`confidence` 的三个具体问题**：

| 问题 | 事实 | 证据 |
|---|---|---|
| Q1 `strength` 分支生产不可达 | 生产桥只传字符串（`listingGenerationService.ts:250-257`），`typeof entry !== "string"` 恒 false | `analyzer.ts:59` |
| Q2 判定全局化 | 任意一条 recurring 就抬高**所有** topic | `analyzer.ts:59` |
| Q3 阈值与语义脱节 | `matches >= 2` 即 `high`：20 条参考里命中 2 条 = high；而 `strength` 对 2 条评论只给 `weak` | `analyzer.ts:33` vs `vocAnalysis.ts:110` |

> 即：**两套分级会给出互相矛盾的结论**（同一主题：`strength=weak` 但 `confidence=high`）。这正是"双重置信度"必须消除的原因。

### 6.2 统一方案：单一真值 + 派生映射

**唯一真值 = `strength`（证据级）**，`confidence` 降级为 `tier` 的**派生别名**，不得独立计算：

| `tier` | `confidence` | 含义 |
|---|---|---|
| A | `high` | 可用于主张类策略字段 |
| B | `medium` | 仅可用于框架类字段 |
| C | `low` | 仅可进 gap 清单 |

**`tier` 的确定性计算表（唯一准入判据）**：

| 流 | tier A | tier B | tier C | 依据 |
|---|---|---|---|---|
| VOC 主题 | `strength === "recurring"`（`reviewCount ≥ 4`）且 `evidenceRefs.length ≥ 1` | `strength === "weak"`（`reviewCount` 2–3） | `strength === "isolated"`（≤1）或 refs 为空 | `vocAnalysis.ts:30-33,107-112` |
| VOC 冲突 | **永不 A** | **永不 B** | 恒 C，`kind:"conflict"` 进 gap 清单 | 正负并存本质不可选边：`vocAnalysis.ts:206-208` |
| VOC `weakSignals` 分组 | **永不 A** | 永不 B | 恒 C | `vocAnalysis.ts:155`（"1-2 条不应过度解读"） |
| keyword | 相关度 `score > 0` **且**该词被 `pickBestKeyword` 选中 → A；`score > 0` → B | — | `score === 0` → C | `researchInputQuality.ts:58-109` |
| competitor | `relation === "direct"` → B（竞品不得单独构成 A，因其非我方证据） | `adjacent` → C | `irrelevant` → C（**且必须过滤出 items**） | `researchInputQuality.ts:112-132`、`listingGenerationService.ts:1226` |

**`coverage` 的角色**：作为 A 级的**附加闸门**而非独立分级——建议 `tier A` 需同时满足 `coverage ≥ 0.1`（即至少 1/10 的已用评论提到），避免"4 条评论全样本 200 条"被当作强证据。阈值需可配置并版本化（沿用 `VOC_STRENGTH_THRESHOLDS` 的做法，`vocAnalysis.ts:29-33`）。

### 6.3 `missingConflicts` 与 `aiReferences` 如何参与

| 结构 | 现状 | 建议 | 理由 |
|---|---|---|---|
| `missingConflicts` | **完全未进入 V5**（`context.ts` 未映射） | **不作为参考文本进入**；作为**闸门输入**参与 `strategyAdmissible` 判定，并作为 `PlannerEvidenceGap` 的人类可读补充 | 其语义是"不得推断补全"（`creativeContextBuilder.ts:171`、`:713`）；把它当参考文本会诱导模型填补缺口 |
| `aiReferences` | **完全未进入 V5** | **明确排除**出 Strategy | `allowedUse` 取值是 `tone\|layout\|composition\|non_factual_angle`（`creativeContextBuilder.ts:124`），其中 `layout`/`composition` 是**图像**语义；且 AI Summary 明确 `≠ Fact`（`:10`）。Strategy 是文字策略，仅 `tone` 勉强相关，收益不足以承担"AI 生成内容被当作洞察"的风险 |
| `confirmableFactCandidates` | 未进入（仅 `confirmedFacts` 进入） | **保持排除** | 未确认候选不是事实；进入策略即等于把候选当事实 |
| `sourcingContext` | 硬编码 `[]`（`context.ts:151`） | **保持排除**，但在契约中显式声明 | `conversionBlueprint.ts:18` 已声明"Sourcing references are never read here" |

> **判定规则**：`missingConflicts.length > 0` **不**阻断 Strategy（缺口可正常存在）；但 `missingConflicts` 中 `kind:"conflict"` 的条目所涉主题，其对应 VOC 主题**必须降级为 tier C**（冲突未解 → 不可选边）。

---

## 7. 证据不足时的降级规则（可判定）

> 这是"Strategy 无证据不能进入 Listing"的落点。核心取舍：**丢弃还是标注？答案是——按字段性质二分。**

### 7.1 字段二分（决定性规则）

| 字段类别 | 字段 | 无证据时 | 理由 |
|---|---|---|---|
| **主张类**（声称买家状态） | `painPoints`、`purchaseMotivations`、`useCases`、`targetAudience` | **丢弃**（drop），并在 `gaps[]` 留哈希痕迹 | 这些字段会被 Writer 当作"买家确实如此"的框架。保留但标注 → 模型仍会使用它（现状即证据：`strategy.ts:42` 用正则凭空造 `painPoints`，且实测这些 painPoints 进入了 prompt 并影响成稿） |
| **框架类**（不声称买家状态） | `primaryAngle`、`secondaryAngles`、`tone` | **允许无证据**（框架无害） | 仅表达角度与语气，不引入买家事实；且 `primaryAngle` 是必填（`strategy.ts:110`） |
| **词表类**（搜索措辞） | `keywordIntent.primary/secondary/backendOnly` | **丢弃无证据项**；若全空则允许退化为 `productIdentity` | 关键词是 SEO 措辞不是主张；但无证据的关键词不应被发明（`strategy.ts:43` 现在会用商品名兜底，应保留该兜底） |
| **角色脚手架** | `bulletAngles[].role` | 角色可保留（结构）；`shopperValue` 无证据时**降级为 `ROLE_FALLBACK_LABEL`** | 既有常量已存在（`strategy.ts:75-81`），直接复用 |
| **禁止项** | `avoidClaims` | 保留（来自 `prohibitedClaims`） | 是否定式约束，无证据风险 |

### 7.2 可判定算法（伪代码）

```
admit(evidence) =
      evidence.tier ∈ {A, B}
  AND evidence.provenanceComplete ⊇ { evidenceId, evidenceRef }   // observedAt 允许为空
  AND NOT (evidence.sourceKind === "voc_conflict")                 // 冲突一律不入主张类

buildStrategyFields(bundle):
  claimFields   = ["painPoints","purchaseMotivations","useCases","targetAudience"]
  framingFields = ["primaryAngle","secondaryAngles","tone"]

  for f in claimFields:
      value = provider[f]                                        // 模型产出
      bound = bindToEvidence(value, bundle.items, tier ∈ {A,B})  // 必须命中至少一条
      if bound is empty:
          drop(value); gaps.push({candidateHash: H(value), reason: "no_evidence_id", stream})
      else:
          emit({ text: value, evidenceIds: bound.ids, tier: min(bound.tiers) })

  # 硬闸门：一份策略若"主张类字段全部被丢弃"或"tier A 数为 0"，
  # 则该策略不得进入 Writer
  if emittedClaimFields.length === 0 OR tierACount === 0:
      return STRATEGY_EVIDENCE_INSUFFICIENT     // fail-closed，不调用 Writer
```

**新增失败态（建议）**：`strategy_evidence_insufficient`。语义是"研究证据不足以生成有依据的策略"，与现有 `provider_*` 失败**不同类**：它不是"AI 坏了"，而是"证据不够"，因此**不应**触发 provider 重试预算，也**不应**回退到确定性模板后仍以"策略"名义发布。路由层应在 `generateListingV5Draft` 之前返回该状态（对齐 `route.ts:412` 之前的门禁位置）。

### 7.3 与现有机制的衔接

| 现有机制 | 位置 | 衔接方式 |
|---|---|---|
| `conversionBlueprint.painPoints[].factBacked` | `conversionBlueprint.ts:33,250` | 概念**直接复用**：`factBacked === false` 的痛点已是"只框架不主张"，可作为 `tier B` 的判据 |
| `objectionHandling` 只取 `factBacked` 项 | `conversionBlueprint.ts:341` | 已是"无证据则静默"的正确范式，`tier` 体系与之同构 |
| `normalizeProviderStrategy` 返回 null → 确定性策略 | `strategy.ts:106-124,187-190` | 新增证据闸门后，确定性策略**也必须**走同一闸门；`classifyReferenceNeeds`（`strategy.ts:10-18`）产出的 painPoints 无任何证据绑定，属**必须被闸门拦下**的情形 |
| Validator 的 `unsupportedClaims` | `validation.ts:569-580` | 证据闸门在**上游**减少无依据主张，可预期降低 `claims:unsupported` 计数——与"修复 fallback 偏高"是同一杠杆 |

---

## 8. 最小修复方式（只动投影层）

### 8.1 修改清单

| # | 位置 | 改动 | 依据 |
|---|---|---|---|
| M1 | `lib/listingV5/types.ts:14-19` | `ListingV5Reference` 增加**可选**字段：`evidenceId?`、`evidenceRef?`、`evidenceRefs?`、`theme?`、`summary?`、`sourceKind?`、`strength?`、`reviewCount?`、`coverage?`、`relation?`、`observedAt?` | 全部可选 → 现有测试与构造点不破坏 |
| M2 | `lib/listingV5/context.ts:122` | VOC：不再 `\`${item.theme}: ${item.summary}\``，改为透传 `theme`/`summary` 分开存放 + `insightId`/`evidenceRefs`/`strength`/`reviewCount`/`coverage` | 消除 L1–L7、L11 |
| M3 | `lib/listingV5/context.ts:123` | keyword：透传 `evidenceRef`/`reportType`/`rowNumber`；按 `scoreKeywordRelevance > 0` 过滤 `relation` 无关词 | 消除 L10；补上缺失的相关度闸门 |
| M4 | `lib/listingV5/context.ts:124` | competitor：**增加 `relation === "direct"` 过滤**；透传 `relation`/`bullets` | 消除 L8、L9；修 P1 |
| M5 | `lib/listingV5/context.ts:82-95` | `boundedReferences` 改为**每流独立预算** + **词边界截断** + 过短片段整条丢弃 | 修 B1、B2 |
| M6 | `lib/listingV5/strategy.ts:38`、`lib/listingV5/conversionBlueprint.ts:226` | 删除 `split(":")` 反解，改用 `reference.theme` / `reference.summary` | 修 L11；两处同源缺陷 |
| M7 | `lib/listingV5/context.ts:151` | `sourcing: []` 保留，但加注释显式声明"有意排除" | 契约可读性 |
| M8 | `lib/listingV5/types.ts:9-12` | bump `LISTING_V5_STRATEGY_PROMPT_VERSION` | 指纹含 references（`context.ts:137`），必须版本化 |

**明确不改**：`lib/server/vocAnalysis.ts`、`keywordEvidence.ts`、`competitorEvidence.ts`、`aiEvidenceSummary.ts`（Evidence 本体）；`lib/listingV5/validation.ts`、`generation.ts`、`structuredRepair.ts`、`conversionRewrite.ts`、`conversionRecovery.ts`（Validator/Writer/Fallback）。

### 8.2 改动后的收益（可度量）

| 指标 | 现状 | 修复后 |
|---|---|---|
| 策略字段可回指证据的比例 | 0% | 主张类字段 100%（闸门强制） |
| 可设"仅 recurring 进 Listing" | ❌ | ✅（`strength` 随行） |
| `irrelevant` 竞品进入 Listing | 可能 | 不可能（M4） |
| 跨流预算饥饿 | 可能 | 不可能（M5） |
| 主题名含 `:` 时的数据污染 | 会发生 | 不发生（M6） |
| 指纹兼容性 | — | **需 bump 版本；旧快照失效**（见 3.3） |

### 8.3 建议的验证方式（后续实施时）

| 层 | 验证 |
|---|---|
| 单测 | `lib/creativeContextBuilder.test.ts`、`lib/listingV5/contextHardening.test.ts`、`lib/listingV5/listingV5.test.ts` 扩展：断言 `evidenceId` 透传、`relation` 过滤、跨流预算不互相挤占 |
| 契约 | 新增"每条 admitted 参考必须携带非空 `evidenceId` 且能解析回 Evidence"的不变量测试 |
| 回归 | `lib/listingV5/promptInjection.test.ts:154-166` 已断言参考文本不含注入串 —— 新字段同样需要过同一断言（`summary`/`theme` 分开后要各自过 `PROMPT_CONTROL_TEXT`，`context.ts:63`） |

---

## 9. 未决问题与风险

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| U1 | VOC `observedAt` 恒空 | 无法做时效判据 | 短期在契约中声明 `provenanceComplete=false`；长期由投影层补 `vocAnalysis.finishedAt` → 这是**投影层**可做的，属最小修复范围 |
| U2 | `themeId` 仅哈希 `label`（D2） | 跨组同名主题 id 碰撞 | 契约层加 group 前缀（5.3），不改上游 |
| U3 | 投影层冲突 id 与上游不一致（D1） | 两套 id 无法互查 | 投影层改用上游 `themeId` |
| U4 | 关键词证据无强度概念 | 无法分级 | 用 `scoreKeywordRelevance` 作为替代强度轴（6.2），并在契约中说明这是**相关度**而非**强度**，二者不同名不同义 |
| U5 | `competitorEvidence.MAX_ASINS = 5` 先于 `relation` 分类 | 真 direct 竞品可能被挤掉（P2） | 需在 `creativeContextBuilder.ts:625` 前分类或提高候选上限；属投影层，可纳入 M4 的范围一起评估 |
| U6 | 尚无 `strength` 的 A 级覆盖度阈值依据 | `coverage ≥ 0.1` 是建议值 | 需以 holdout 数据校准，先做成可配置常量并版本化 |
| U7 | `aiEvidenceSummary.evidenceRefCoverage`（`aiEvidenceSummary.ts:67`）未被投影使用 | 少了一个"摘要质量"闸门 | 可作为 `aiReferences` 是否可信的辅助判据，当前先保持排除 |

---

## 附录 A：关键文件索引

| 层 | 文件 | 角色 |
|---|---|---|
| Evidence | `lib/server/vocAnalysis.ts` | VOC 唯一写入方；强度/覆盖/引用硬门禁 |
| Evidence | `lib/server/reviewEvidence.ts` | 评论证据本体；`evidenceId = randomUUID()` |
| Evidence | `lib/server/keywordEvidence.ts` | 关键词行级证据 |
| Evidence | `lib/server/competitorEvidence.ts` | 竞品登记（上限 5）；`detailBullets` |
| Evidence | `lib/server/aiEvidenceSummary.ts` | AI 摘要；每条强制 `evidenceRefs` |
| 投影 | `lib/creativeContextBuilder.ts` | **唯一桥**；保住证据身份 |
| 消费 | `lib/listingV5/context.ts` | **压平断点**（`:122-124`） |
| 消费 | `lib/listingV5/strategy.ts` | 策略生成；无证据绑定 |
| 消费 | `lib/listingV5/conversionBlueprint.ts` | `factBacked` 范式来源 |
| 消费 | `lib/listingV5/validation.ts` | 竞品重叠判罚（`:558-561`） |
| 判据 | `lib/research/researchInputQuality.ts` | 关键词相关度 + 竞品三分类（唯一算法） |
| 既有消费者 | `lib/listingHandoff/marketingIntelligence/analyzer.ts` | 确定性营销情报 |
| 既有消费者 | `lib/listingHandoff/copyStrategy/analyzer.ts` | 文案策略 |
| 既有消费者 | `lib/listingHandoff/listingPlanner.ts` | `researchSignals.signalId`（位置序号） |
| 遗留链路 | `lib/listingHandoff/listingGenerationService.ts:1226` | 唯一使用 `relation` 过滤之处 |

## 附录 B：核心不变量（不得改动）

`lib/creativeContextBuilder.ts:8-13` 明确写死，本契约全部设计均须维持：

```
Evidence ≠ Fact
VOC ≠ Fact
AI Summary ≠ Fact
Competitor Evidence ≠ Product Fact
Sourcing Evidence ≠ Amazon Product Fact
Keyword Evidence ≠ Product Fact
```

只有 contract 允许的确定性 fact candidate + Human Confirmation 才能进入 `confirmedFacts`（`creativeContextBuilder.ts:15-16`）。
