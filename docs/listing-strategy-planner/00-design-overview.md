# Listing Strategy Planner — 架构设计方案（总控 / 待审查）

> 状态：**仅设计，未实现**。本轮不写任何生产代码。
> 仓库：`project-001-listing-v5`（worktree，分支 `feat/listing-v5-rebuild`）
> 定位：本文是总控结论；`architecture-review.md`、`strategy-input-analysis.md`、`product-spec.md`、`implementation-plan.md`、`risk-review.md` 为分项论证。

---

## 0. 结论先行

### 0.1 最重要的发现：这一层不止已经存在，而是已经存在三套

| # | 既有实现 | 性质 | 产出字段 | 是否证据绑定 |
|---|---|---|---|---|
| 1 | `lib/listingHandoff/copyStrategy/types.ts`<br>`CopyStrategyV1` | **确定性** | `targetBuyer` / `buyerPainPoints` / `mainAngle` / `emotionalHook` / `copyTone` / `bulletStrategies[{order, structure, purpose}]` / `titleStrategy` / `descriptionStrategy` / `avoidExpressions` | ❌ 全是裸字符串 |
| 2 | `lib/listingHandoff/marketingIntelligence/`<br>`MarketingInsightV1` | **确定性**（硬编码关键词匹配） | `painPoints` / `customerNeeds` / `marketAngles` / `keywordThemes` / `competitorPatterns` / `recommendations`，每项 `{topic, summary, sourceType, confidence: high\|medium\|low}` | ❌ 只有 `topic`，无 evidenceRef |
| 3 | `lib/listingV5/strategy.ts` → `ListingV5Strategy`<br>+ `lib/listingV5/conversionBlueprint.ts` → `ListingV5ConversionBlueprint` | **LLM + 确定性**（V5 现役路径） | 见 §3.3；Blueprint 已有 `proofFactIds`/`factBacked`/`benefitOrder` | ❌ Strategy 无；✅ Blueprint 只绑 **factId**，不绑 **evidence** |
| 4 | `lib/listingHandoff/listingPlanner.ts`<br>`ListingPlannerDecision` | **LLM**（旧链，另一路由） | `title{factIds,keywordIds}` / `bullets[{role, factIds, keywordIds, templateId}]` / `description{factIds}` / `backendKeywordIds` | ❌ **同样无绑定** |

> **⚠️ 更正（原稿在此处判断有误，已由 Agent 1 逐行复核纠正）**：`PlannerPromptView.researchSignals[].signalId` **不是证据 id**。
> - `listingPlanner.ts:134` 生成为 `` `${kind}-${index+1}` ``（`voc-1`/`voc-2`/`keyword-1`…）——是**数组下标拼出的位置句柄**，每次构建 prompt 重新编号，**跨运行漂移**；
> - `ListingPlannerDecision`（`listingPlanner.ts:31-37`）经键白名单 `PLANNER_TOP_LEVEL_KEYS` 约束，**没有任何字段能回填 signalId** → 模型即便拿到也无法引用，**不可 round-trip**；
> - 它的输入 `ListingGenerationInput["creativeContext"]` 本身就是 `string[]`（`listingGenerationInput.ts:49-55`，由 `:306-334` 压平），证据身份在进入它之前就已丢失。
>
> 结论：`signalId` 只能作为**命名/纪律范式的先例**，**不能作为"证据绑定已存在"的依据**。Agent 2 独立得出同一结论。

> **✅ 真正且唯一可追溯的证据载体是 `CreativeContextV1`**：`creativeContextBuilder.ts:78/90/99/115/126` 的 `evidenceRefs`/`evidenceRef` 全部带 `provenance`（`:39-46`）。且上游纪律是**硬**的——`lib/v4/adapters/voc.ts:322-337` 会**拒绝** evidenceRefs 打不中真实样本的主题；`lib/v4/report.ts:45` 强制 factual sentence 必须带非空 evidenceRefs。
> **即：证据 id 在 Evidence 层是可信的，丢失纯粹发生在投影层。**

> **🕳 丢失点是两处，不是一处**（原稿只指出了一处）：
> - V5 链：`lib/listingV5/context.ts:122-124`
> - 旧链：`lib/listingHandoff/listingGenerationInput.ts:306-334`（VOC `:310-312` 同样只留 theme+summary+reviewCount）
>
> **且本仓库已发生过一次"槽位存在、绑定为空"的先例**：`listingPlan.ts:40` 已声明 `evidenceRefs?: string[]`，`:301` 已接上 `evidenceRefsOf(input)`，但该函数（`:182-189`）**只返回常量 `"ev:voc"`**，`:315`/`:475` 直接给 `[]`。
> **→ 新方案必须把"闸门必须真的拒绝"作为验收项，防止第二次重演。**

> **`CopyStrategyV1` 的字段几乎与需求描述的"谁买 / 为什么买 / 卖什么 / 怎么排序 / 不建议表达"一一对应，且已在 UI 上线**（`components/listing-handoff/CopyStrategyPlannerSuggestionPanel.tsx`）。

### 0.2 因此结论是：不要再加第四套

真正缺失的**不是"层"**，而是一组**横切能力**：

- **G1 证据身份在上下文边界被销毁** → `lib/listingV5/context.ts` 把参考压平成字符串，证据绑定在当前架构下**根本无法实现**；
- **G2 三套决策层的结论都没有证据引用** → 无法回答"这个卖点凭什么"；
- **G3 没有任何闸门**拦截"无证据结论"流向 Writer；
- **G4（系统性风险）确定性路径普遍用硬编码关键词"造"市场洞察** —— `marketingIntelligence/analyzer.ts` 的 `VOC_TOPICS`（`messy|clutter|organize`…）与 `lib/listingV5/strategy.ts` 的 `classifyReferenceNeeds` 是同一模式：对 2–3 个英文关键词的正则命中，却以 `confidence: high` 的确定口吻呈现。**这比 LLM 幻觉更隐蔽，因为它看起来像"确定性事实"。**

### 0.3 推荐方案

**把"Listing Strategy Planner"定义为横切的"证据绑定契约 + 准入闸门"，并原地升级既有 Strategy 阶段**，而非新增并行层：

- 新增 `lib/listingV5/listingStrategy/` 作为**契约家与实现归属**（满足"新增模块"的诉求），但：
  - **不新增编排节点**、**不新增状态机**、**不新增 Prisma 表**、**不新增 API 路由**；
  - **不新增 provider 调用**（复用既有那一次 strategy 调用）。
- 复用既有范式而非发明：`listingPlanner.ts` 已经示范了正确的**纪律**（精确键白名单 + `rejectedSelections` 计数 + 细化失败码 + `semanticStatus: full|partial|none`），新契约应沿用其精神。
  > ⚠️ **但 `researchSignals.signalId` 不属于可复用项**——它是数组下标句柄且不可 round-trip（详见 §0.1 更正）。原稿曾把它列入此处，已删除。
- **推荐把证据绑定做成共享能力**，使其可被 `CopyStrategyV1` / `MarketingInsightV1` / `ListingV5Strategy` 共同使用——否则第四套依然不会绑定证据（这是本方案与"再加一层"的根本区别）。

### 0.4 必须诚实说明的两点

1. **provider 调用次数与 `plannedCalls` 配额完全不变**（`app/api/tasks/[id]/listing-v5/route.ts:357`），这是"原地升级"相对"新增一层"的决定性优势。
2. 已实测的现状瓶颈与本次升级**无关**：真实 provider 已接通，3 个真实任务共 12 次调用全部成功，但全部因 Validator 事实锚定不过而 `fallbackUsed=true`。**Strategy Planner 不解决这条主瓶颈**，其价值在"可信度与可审计性"，不在"提升 PASS 率"。ROI 判断详见 `risk-review.md`。

---

## 0.5 对抗审查裁决（Agent 5，**请先读这一节再决定是否开工**）

> **`risk-review.md` 的结论：当前形态（新增独立 Listing Strategy Planner 决策层）不值得做，建议否决或收缩。**

### 0.5.1 已由总控独立复核确认的"墓碑级"证据

旧链里**带受约束挑选能力的 LLM Planner 早已建成，但生产调用点不可达**：

```js
// lib/listingHandoff/listingGenerationService.ts
:1770  const plannerEligible = copyReady && rendererQualifiedOptionCount >= 3 && ... ;
:1773  const useTaskLinkedAiListing = copyReady;
:1774  if (plannerEligible && !hasInjectedTaskLinkedAiListingClientForTests() && !useTaskLinkedAiListing) {
:1777      const plannerResult = await generateListingPlanDecision(plannerInput);   // ← 永不执行
```

把 `:1770` 与 `:1773` 代入 `:1774`，条件等价于 **`copyReady && … && !copyReady` ⇒ 恒假**。
（`copyReady` 为真时 `!useTaskLinkedAiListing` 为假；为假时 `plannerEligible` 为假。两种取值都不可能进入。）

- `generateListingPlanDecision` 全仓**只有这一个生产调用点**，因此该 Planner 实际是死代码；
- `:1771-1772` 的注释自述意图是"避免 Planner 先调一次、正文生成器再调一次"——**意图合理，但写出的守卫把整条分支一起关掉了**；
- 实际生效的是 `:1890` 的 `generateTaskLinkedAiListing`（LLM 直接写正文，不经过受约束挑选）。

**这条证据对本方案的意义**：它证明"在本仓库新增一层 Planner"有**被同类守护条件架空的真实先例**。任何新方案必须把"可达性验证"写成硬性验收项（Agent 5 已列为 kill criteria **K9**），否则极可能重演。

### 0.5.2 层数比本文初稿估计的更多

不是"第四套"，而是**已有 6 个同类决策产物**（新增即第 7 个）：

| # | 产物 | 状态 |
|---|---|---|
| 1 | `lib/server/taskLinkedAiListing.ts` | **现役**（LLM 直接生成正文） |
| 2 | `CopyStrategyV1` | 已上线，有 UI，字段与需求一一对应 |
| 3 | `MarketingInsightV1` | 已上线，有 UI |
| 4 | `ListingPlannerDecision` | **已建成但生产不可达**（§0.5.1） |
| 5 | `ListingV5Strategy` | V5 现役 |
| 6 | `ListingV5ConversionBlueprint` | V5 现役 |

实测维护面：`copyStrategy` 24 文件/6 测试；`marketingIntelligence` 12/5；`listingPlanner` 4/2；`taskLinkedAiListing` 13/9；V5 侧 `./strategy` 被 **20 个测试文件**导入。

### 0.5.3 严重度裁决（Agent 5 明确给出，总控认同）

> **A3「硬编码伪证据包装」的严重度 高于 A2「新增 LLM 层的幻觉风险」。**

理由：A3 **已在线**（A2 未落地）；A3 有 UI 呈现 + 确定语气 + **零下游防线**（`validation.ts` 的事实锚只校验 Listing 正文，**完全不看** `MarketingInsightItem.confidence`）；A3 失真系统性，A2 失真随机且至少会被 Validator 拦在正文之外。

逐行证据：`marketingIntelligence/analyzer.ts:15-19` 的 `VOC_TOPICS` **仅 3 个主题**硬编码英文词表；`:32-36` `confidence()` 由 `matches>=2` 直接判 `high`；**`:59` 置信度通胀缺陷**——`voc.find(strength==="recurring")` 写在每个主题的循环体内，任一 recurring 条目会让**所有**主题拿到 `high`。

> **含义**：把 `confidence` 这类"假精度"搬进新 Planner 是**放大已有缺陷**；本方案因此明确要求**废弃 confidence 表达**，改用"出现条数 + 强度 + 可点开原文"（见 `product-spec.md`）。

---

## 1. 当前真实链路图（Research → Evidence → Fact → Handoff → Listing）

```text
① 研究 Research
   lib/v4/**, lib/research/**
   落库：ViralAnalysisRecord.resultJson（JSON blob）
        └─ 证据命名空间：browserEvidence / vocAnalysis / aiEvidenceSummary
                        keywordEvidence / competitorEvidence / sourcingEvidence
   │
   ▼
② 证据 Evidence（结构化、带可追溯引用）
   lib/creativeContextBuilder.ts → buildCreativeContextFromResearch()   ← 唯一桥（纯函数投影）
   产出 CreativeContextV1（schema creative-context.v1）
     ├─ vocInsights[]        {insightId, theme, summary, evidenceRefs[], reviewCount,
     │                        coverage, strength: isolated|weak|recurring, provenance}
     ├─ keywordCandidates[]  {keyword, reportType, rowNumber, evidenceRef, observedAt}
     ├─ competitiveContext[] {asin, note, relation: direct|adjacent|irrelevant, bullets?}
     ├─ confirmableFactCandidates[] {factCategory, stabilityRule, allowedUsageScopes, entityBinding}
     ├─ missingConflicts[]   {kind: missing|conflict, summary, evidenceRef}
     └─ aiReferences[]       {referenceId, field, summary, allowedUse}
   ★ 不变量：Evidence ≠ Fact / VOC ≠ Fact / AI Summary ≠ Fact /
             Competitor Evidence ≠ Fact / Sourcing Evidence ≠ Fact / Keyword Evidence ≠ Fact
   │
   ▼
③ 事实 Fact（人工门禁，不可绕过）
   lib/listingHandoff/** + app/api/tasks/[id]/creative-handoff/route.ts
   运营逐项确认 → CAS storageVersion 盖章 → confirmedFacts
   （仅 usageScopes 含 "listing" 的进入 Listing）
   │
   ▼
④ 交接 Handoff / 上下文冻结
   app/api/tasks/[id]/listing-v5/route.ts → buildContext()
   lib/listingV5/context.ts → buildListingV5Context() → ListingV5Context
     {confirmedFacts, prohibitedClaims, unknowns,
      references: {voc[], keywords[], competitors[], sourcing[]},
      manualDirection, contextFingerprint}
   ❌ 断点 G1：references 在这里被压平成纯字符串
        voc  → `${theme}: ${summary}`
        kw   → 仅 keyword
        comp → 仅 note || asin
      丢失：insightId / evidenceRefs / strength / reviewCount / coverage / relation / bullets
      类型 ListingV5Reference = {text, sourceType, marker:"UNTRUSTED_REFERENCE_DATA", notProductFact:true}
      预算：MAX_REFERENCES=20 / MAX_REFERENCE_CHARS=300 / MAX_TOTAL_REFERENCE_CHARS=7000
   │
   ▼
⑤ Listing 生成
   ├─ Strategy   lib/listingV5/strategy.ts
   │    analyzeListingV5Strategy()  ← LLM（useProvider 时）
   │    buildListingV5Strategy()    ← 确定性兜底
   │    → ListingV5Strategy（纯 string[]，仅 referenceOnly:true）
   │    ❌ 断点 G2：无任何证据绑定
   │    ⚠️ 确定性兜底的 classifyReferenceNeeds() 用硬编码正则从 VOC 文本"猜"痛点
   │       （messy|organize|storage|kitchen|sip|straw|hydration|carry|portable|spill|leak…）
   │       再派生 purchaseMotivations / useCases / targetAudience
   ├─ Blueprint  lib/listingV5/conversionBlueprint.ts（纯函数，0 次 provider 调用）
   │    → ListingV5ConversionBlueprint
   │    ✅ 已有 proofFactIds / factBacked / benefitOrder / disallowedTemptations / decisionSequence
   ├─ Writer     lib/listingV5/generation.ts → generateListingV5Draft()
   ├─ Validator  lib/listingV5/validation.ts → validateListingV5Draft()  → PASS | REPAIRABLE | BLOCK
   │    ❌ 断点 G3：没有任何环节校验"Strategy 结论是否有证据"
   └─ 编排       strategy → writer → repair(≤1) → rewrite(≤1) → recovery(≤1) → deterministic fallback
        快照 ListingV5Snapshot 经 safeSnapshot() 白名单投影后写回 resultJson 的 listingV5 键
```

---

## 2. 最佳接入点判断

### 2.1 候选位置对比

| 候选位置 | 评价 | 结论 |
|---|---|---|
| A. 在 `buildCreativeContextFromResearch()` 里做 | 越界：那是 Evidence 层，不该产出市场决策 | ✗ |
| B. 在 Creative Handoff 人工确认时做 | 会让确认门禁变重，且 Strategy 依赖的是"参考层"而非"事实层" | ✗ |
| **C. 原地升级既有 Strategy 阶段（context 之后、Writer 之前）** | 位置本来就是对的；只需修投影 + 换契约 + 加闸门；**0 新增 provider 调用** | **✓ 推荐** |
| D. 在 Writer 之后、Validator 之前做 | 无法影响"怎么排序"，只能事后解释 | ✗ |
| E. 新增独立编排节点 | 破坏"不重构 / 不新增状态机"，且 +1 次付费调用 + 新失败路径 + 配额语义变更 | ✗ |

### 2.2 推荐接入点（精确到调用位置）

`app/api/tasks/[id]/listing-v5/route.ts` 中**既有的** `analyzeListingV5Strategy(...)` 调用点(约 383–385 行区)不变；变更发生在它的**内部契约与产物**上：

```text
buildListingV5Context()                       ← C1 携带证据身份（投影层，不动证据本体）
        │
        ▼
analyzeListingV5Strategy()                    ← C2 内部升级：走新的策略契约，产出证据绑定结论
        │
        ▼
admitStrategyDecisions()                      ← C3 新增纯函数闸门：无证据结论一律丢弃
        │
        ▼
ListingStrategyPlan（保留 ListingV5Strategy 兼容投影）
        │
        ├─► buildListingV5ConversionBlueprint(context, strategy)   ← 不动
        └─► generateListingV5Draft(context, strategy, blueprint)   ← 不动
```

### 2.3 三处最小改动

| 编号 | 改动 | 文件 | 性质 |
|---|---|---|---|
| **C1** | `ListingV5Reference` 增加 `refId` / `evidenceRef` / `strength` / `textTruncated`，`buildListingV5Context()` 填充 | `lib/listingV5/context.ts`、`types.ts` | 向后兼容的**加字段** |
| **C2** | 新模块 `lib/listingV5/listingStrategy/`：`types.ts` / `service.ts` / `promptContract.ts` / `admission.ts`；Strategy 结论改为带 `evidenceRefs[]` | 新增目录 | 契约升级 |
| **C3** | `admitStrategyDecisions()` 纯函数闸门 + 确定性兜底去掉正则"造洞察" | `lib/listingV5/listingStrategy/admission.ts`、`strategy.ts` | 收紧，不放宽 |

**明确不做**：不改 `validation.ts`（Validator 阈值/判定一字不动）；不改 `creativeContextBuilder.ts` 的不变量；不新增 Prisma 表；不新增 API 路由；不新增状态枚举；不改 `plannedCalls`。

### 2.4 既有资产处置表（复用 / 冻结 / 弃用）

已核实路由归属（这是处置建议的依据）：

| 入口 | 渲染 | 状态 |
|---|---|---|
| `/listing-studio` | `components/listing-v5/ListingStudioV5Client.tsx` | **现役主路径（V5）** |
| `/listing-studio-v5` | 302 → `/listing-studio` | 已收口 |
| `/listing-studio-legacy` | `components/listing-studio/ListingStudioClient.tsx`（内含 `TaskStudioPreparation` + `ListingHandoffSection` + `CopyStrategyPanel`） | **V4 回滚目标，页面注释明示"Not linked from the workspace navigation"** |

| 既有资产 | 处置 | 理由 |
|---|---|---|
| `lib/listingHandoff/listingPlanner.ts` 的**纪律范式**（键白名单 / `rejectedSelections` 计数 / 细化失败码 / "模型只能从给定集合中挑选"） | ✅ **复用其纪律** | 仓库里唯一已证明可行的"受约束挑选"实现；新契约应沿用而非另创 |
| `listingPlanner.ts` 的 `signalId` 命名 | ⛔ **反例，禁止效仿** | 它是位置句柄 `${kind}-${index+1}` 且不可 round-trip（见 §0.1 更正），把它当 id 会制造"看起来可追溯、实际会漂移"的假绑定 |
| `lib/listingHandoff/copyStrategy/types.ts` 的**字段词汇**（`targetBuyer`/`buyerPainPoints`/`mainAngle`/`bulletStrategies[order]`/`avoidExpressions`） | ✅ **复用词汇** | 运营已在上线 UI 见过这套语言；重复造词会加重认知负担 |
| `lib/listingHandoff/listingPlanner.ts` 的 **templateId 渲染体系** | ⛔ **不要搬进 V5** | 会把旧链的整体渲染模型带进来，等同重构 V5（违反约束） |
| `lib/listingHandoff/marketingIntelligence/`（`VOC_TOPICS` 硬编码匹配） | ⚠️ **冻结在旧链，不回移** | 它是"正则造洞察"的典型；回移会把 G4 风险带进 V5 |
| `lib/listingHandoff/**` 旧链整体 | 🧊 **冻结**：只作为 `/listing-studio-legacy` 的回滚目标，不再新增能力 | 避免"四套策略"继续扩散 |
| `lib/listingV5/strategy.ts` + `conversionBlueprint.ts` | ✅ **原地升级（唯一改动点）** | 现役路径，且位置本就正确 |

> **一句话**：**能力从旧链"借范式与词汇"，但实现只落在 V5 一处。** 这既满足"新增 Listing Strategy Planner"，又不制造第四套并行体系。

---

## 3. 数据结构设计

### 3.1 C1：证据引用（跨边界不丢身份）

```ts
/** 扩展既有 ListingV5Reference —— 只加字段，旧快照缺字段时按 unbound 降级 */
export type ListingV5Reference = {
  text: string;
  sourceType: "VOC" | "keyword" | "competitor" | "sourcing";
  marker: "UNTRUSTED_REFERENCE_DATA";
  notProductFact: true;
  // ── 新增 ──
  refId?: string;              // VOC=insightId；keyword=evidenceRef；competitor=`asin:<ASIN>`
  evidenceRef?: string;        // 可追溯原文引用 ev:voc:... / ev:keyword:... / ev:competitor:...
  strength?: "isolated" | "weak" | "recurring" | "unknown";
  reviewCount?: number;
  coverage?: number;
  textTruncated?: boolean;     // 正文是否因 300/7000 预算被截断
};
```

> `textTruncated` 是**诚实性关键字段**：见 §6 风险 R3——否则会出现"引用了一个模型根本没看全的证据 id"这种新型伪证。

**evidenceId 稳定生成规则（采纳 Agent 2 §5.3 的复核结论，必须是跨运行稳定的内容寻址，而非下标）**：

| 来源 | evidenceId | 人读 ref | 说明 |
|---|---|---|---|
| VOC 主题 | `voc:theme:<group>:<themeId>`，`themeId = sha256("theme:"+label).slice(0,16)` | `ev:voc:<evidenceRef>` | 加 `group` 前缀以修复"跨组同名碰撞" |
| VOC 冲突 | `voc:conflict:<conflictThemeId>`，用上游 `sha256("conflict:"+label)` | `ev:voc:conflict` | 投影层目前自行重算 id，导致同一冲突存在两个不同 id，须改为复用上游 |
| keyword | `kw:<reportType>:<rowNumber>` | `ev:keyword:<reportType>:<kw>` | 现有 ref 不含 `rowNumber`，重复词会碰撞 |
| competitor | `competitor:<ASIN>` | `ev:competitor:<ASIN>` | — |

> **硬规则：`signalId`（`${kind}-${index+1}`）禁止被提升为 evidenceId**，二者不得互相赋值；需要引用证据处一律使用上表的 evidenceId。

### 3.2 C2：策略结论与计划

```ts
export const LISTING_STRATEGY_PLAN_VERSION = "listing-v5.strategy-plan.v1" as const;

export type StrategyDropReason =
  | "no_evidence"        // 模型未给出任何 evidenceRefs
  | "unknown_evidence"   // 引用了冻结上下文里不存在的 refId
  | "weak_evidence"      // strength=isolated 且低于准入阈值
  | "unbound_source"     // 参考正文被截断/来源不可追溯
  | "fact_contradiction";// 与 Confirmed Facts 冲突（保守丢弃）

export type StrategyDecision = {
  text: string;
  /** 必须是 ListingV5Context.references 中真实存在的 refId */
  evidenceRefs: string[];
  /** 关联 Confirmed Facts（可为空：市场结论不必然是事实结论） */
  factIds: string[];
  factBacked: boolean;
  admitted: boolean;
  dropReason?: StrategyDropReason;
};

export type ListingStrategyPlan = {
  version: typeof LISTING_STRATEGY_PLAN_VERSION;
  referenceOnly: true;                 // 与既有语义一致：永不是事实权威
  researchRevision: number;
  audience: StrategyDecision[];        // 谁买
  motivations: StrategyDecision[];     // 为什么买
  painPoints: StrategyDecision[];      // 痛点
  sellingPoints: StrategyDecision[];   // 卖什么
  bulletOrder: Array<{                 // 怎么排序
    role: ListingV5BulletRole;
    shopperValue: string;
    evidenceRefs: string[];
    primaryFactId: string | null;
  }>;
  avoidClaims: string[];               // 不建议表达（沿用既有字段语义）
  /** 被闸门拒绝的结论：UI 必须可见，不得静默丢弃 */
  dropped: StrategyDecision[];
  evidenceBudget: {
    refsAvailable: number;
    refsUsed: number;
    truncated: boolean;
  };
};
```

### 3.3 与既有结构的关系（不破坏消费方）

| 既有结构 | 处理方式 |
|---|---|
| `ListingV5Strategy` | **保留**为兼容投影（`ListingStrategyPlan` → `ListingV5Strategy` 的确定性降级投影），UI 与快照消费方零改动即可继续工作 |
| `ListingV5ConversionBlueprint` | **完全不动**。它在 Strategy 之后运行，继续负责把事实绑成 proofPoints/benefitOrder |
| `ListingV5Snapshot` | **加可选字段** `strategyPlan?: ListingStrategyPlan`；`strategy` 字段语义不变 |
| `contextFingerprint` | 因 `strategyPromptVersion` 进入哈希，**升版即全量缓存失效**（见 §6 风险 R5） |

### 3.4 准入阈值（可判定、可复核）

| 条件 | 处置 |
|---|---|
| 结论无 `evidenceRefs` | 丢弃，`dropReason="no_evidence"` |
| `evidenceRefs` 含冻结上下文中不存在的 id | 丢弃，`unknown_evidence` |
| 全部 `evidenceRefs` 的 `strength==="isolated"` 且 `reviewCount<=1` | 丢弃，`weak_evidence` |
| 引用的证据 `textTruncated===true` | 保留但在 UI 标注"证据正文未完整进入模型" |
| VOC 证据数为 0 | 允许输出，但**必须**返回空数组而非套话；`missingConflicts` 同步展示 |

> 阈值本身是**新增的确定性常量**（不改 Validator），需在实现时报备并单测锁定。

---

## 4. API 设计

### 4.1 结论：不新增路由

复用既有唯一入口 `app/api/tasks/[id]/listing-v5`：

| 方法 | 动作 | 变化 |
|---|---|---|
| `GET` | 读取上下文 + 快照 | 响应 `data.snapshot` 增加 `strategyPlan`（经 `safeSnapshot()` 白名单显式放行） |
| `POST {action:"generate"}` | 生成 Listing | Strategy 阶段内部产出 `ListingStrategyPlan`；**`plannedCalls` 不变** |
| `POST {action:"analyze_strategy", forceStrategy:true}` | 重新分析策略 | 复用为"重新绑定证据"的操作入口，无需新端点 |

**不新增路由的理由**：`docs/architecture/auth-and-quota-contract.md` 规定 Route 的状态码/错误码/响应体属既有外部契约；新增路由会复制 auth、origin/CSRF、访客配额、沙箱路由等一整套安全面，收益为零。

### 4.2 响应体增量（需改 `safeSnapshot()` 白名单）

```ts
// app/api/tasks/[id]/listing-v5/route.ts 的 safeSnapshot() 白名单新增
strategyPlan: {
  version, audience, motivations, painPoints, sellingPoints,
  bulletOrder, avoidClaims, dropped, evidenceBudget
}
```

必须白名单化（逐字段），沿用现有"未知字段一律丢弃"的投影纪律，避免 provider 未白名单直传。

### 4.3 错误与降级语义（不新增状态）

| 情形 | 行为 |
|---|---|
| Provider 返回结构非法 / 未给 evidenceRefs | 视为**既有** `providerSucceeded:false` 语义，走既有确定性兜底；不新增状态码 |
| Provider 失败 | 既有 `callAiJson` 错误映射不变 |
| 全部结论被闸门拒绝 | 仍然 HTTP 200；`strategyPlan` 各数组为空 + `dropped` 有值；UI 显示"证据不足" |
| 访客配额 | 不变（Planner 不增加调用次数） |

**"证据不足"如何在不新增状态的前提下表达（采纳 Agent 1 的 Q3 结论）**：

既有词表已经够用，**不要新增**：`LISTING_V5_VALIDATION_STATUSES`（`trace.ts:49-51`）、`LISTING_V5_STAGE_FAILURE_REASONS`（15 值，`trace.ts:24-43`）、`LISTING_V5_FALLBACK_REASONS`（`trace.ts:45-47`）。

- 表达方式 = **计数 + 归因**（照搬 `listingPlanner.ts` 的 `rejectedSelections` / `semanticStatus: full|partial|none` 范式）；
- ⛔ **绝不能给 Strategy 加 PASS/BLOCK**——那会与 `validation.ts` 的事实锚定语义撞车，且违反"不改 Validator"；
- ⛔ **绝不新增 stage name**：既有 `ListingV5StageName`（`trace.ts:22`）**缺 `recovery`** 而 `stages`（`:95-101`）含之（既有类型漂移，本次**不要顺手修**）。Planner 只在既有 `strategy` 阶段的 trace 内承载准入计数。

### 4.4 持久化约束（Agent 1 Q2 结论，硬约束）

**不要新增 Prisma 表，复用 `resultJson` 的 `listingV5` 键。**

依据：研究/Listing 本就以 JSON 存于 `prisma/schema.prisma:32-46`；且 `lib/server/taskResultJsonMutation.ts:64` 已定义
`OWNED_NAMESPACES["listing-v5"] = ["listingV5"]`，`:276-291` 强制命名空间独占（越权即 500）。

> **推论（必须遵守）**：Planner 产物**必须落在 `listingV5` 键内部**。若要新建顶层键，就必须改 `OWNED_NAMESPACES` —— 那是**共享持久化契约变更**，应独立决策，不得夹带。

### 4.5 反模式清单（Agent 1 Q4，违反即否决）

现有**四道真实防线**保护 Confirmed Facts：确认层（`creativeContextBuilder.ts:48-72` 的 `factCategory`/`stabilityRule`）、投影层（`listingGenerationInput.ts:109,122-127` 双保险：`usageScopes` 含 listing **且** 非市场信号字段）、prompt 层（`context.ts:62-64` 的 `marker`/`notProductFact`）、持久化层（命名空间独占）。

| 反模式 | 为什么禁止 |
|---|---|
| **让 Planner 输出 `factIds`** | 该能力已存在于 `conversionBlueprint.ts:275-282,292-302`；再给一次会制造**"模型 vs 确定性代码"两个事实权威** |
| 扩展 `ListingV5Fact` 侧 | Planner 只能扩展 `ListingV5Reference` 侧（参考层），**永不扩展事实层** |
| 给 Strategy 结论加 PASS/BLOCK | 与 Validator 语义撞车 |
| 新增 Prisma 表 / 顶层 resultJson 键 | 见 §4.4 |
| 把 `confidence` 表达搬进来 | 见 §0.5.3（假精度放大） |

---

## 5. 前端展示方案（嵌入 Listing Studio，不新增页面）

### 5.1 信息架构（采纳 `product-spec.md` 的方案 A，经代码核实修正）

**原地升级"营销文案策略"卡为「五问策略区」，并收编"转化蓝图"折叠区** → **页面区块净减 1 个**，五问各只有 1 个归属地。

被否决的选项：B（新增独立 Planner 区）= 把已有的 2 次重复变 3 次；C（只给蓝图加徽标）= 策略卡的"目标买家/避免表达/主表达角度"仍无依据；D（搬旁路面板）= 造第 4 个重叠区。

> **⚠️ 修正本文初稿的一处前提（Agent 3 实测）**：`MarketingIntelligencePanel` 与 `CopyStrategyPlannerSuggestionPanel` **不在 V5 Listing Studio 上**，而在
> - `components/image-studio/ImageStudioClient.tsx:124` → **`/image-studio`（现役）**
> - `components/listing-studio/ListingStudioClient.tsx:188` → `/listing-studio-legacy`（V4 回滚页）
>
> 因此"三套结论"是**跨页面**问题，不是同页问题。→ **不要去改 `components/studio/TaskStudioPreparation.tsx` 或那两个面板**（与现役 Image Studio 共用，改了就是扩大范围）。V5 页面内做到"唯一且语义清晰"即可。

**已核实的页内重复（Agent 3 逐项计数）**：买家 2 次 · 为什么买 **4 次** · 卖什么 2 次 · 排序 2 次 · 禁区 2 次 · 表达角度 **3 次**。
其中 **`benefitOrder` 与 `bulletAngles` 本就是同一个列表**（`conversionBlueprint.ts:292-302` = `strategy.bulletAngles.map()` + `primaryFactId`）→ **必须合并为一处**，分两处展示纯属重复。

### 5.2 五问呈现

| 用户问题 | 数据来源 | 呈现 |
|---|---|---|
| 买家是谁？ | `plan.audience[]` | 每条结论后挂**三态徽标** + 可点开抽屉 |
| 为什么买？ | `plan.motivations[]` | 同上 |
| 卖什么？ | `plan.sellingPoints[]` | 同上，并标注是否 `factBacked` |
| 怎么排序？ | `plan.bulletOrder[]` | 有序列表 1→5，标注角色与主锚定事实；显式提示"排序建议，不是事实" |
| 不建议表达 | `plan.avoidClaims[]` | 红色禁区列表（沿用既有展示） |
| （诚实性）未采用 | `plan.dropped[]` | 折叠区"证据不足，未采用 N 条"，展示原因，**不得静默丢弃** |

**证据徽标（采纳 Agent 3，替代本文初稿的裸编号 `E3`）**：

| 徽标 | 含义 | 依据 |
|---|---|---|
| 🟢 `依据 N` | 已确认事实支撑 | `factIds[]` |
| 🟡 `参考 N` | 研究资料支撑（非事实） | `evidenceRefs[]` |
| ⚪ `无依据` | 无任何支撑 | 必须如实显示 |

抽屉内部才显示 `E1…En` 编号、原文摘要、出现条数与强度。**裸编号外挂对非技术运营不可读**。

**强度文案直接复用既有阈值**（无需再造）：`lib/server/vocAnalysis.ts:30-33` —— 0–1 条=`isolated`→「个别提及」；2–3 条=`weak`→「少数提及」；≥4 条=`recurring`→「反复出现」。
**默认不展示百分比**（`coverage`）以避免"假精度"，仅抽屉"原始记录"内可选。

### 5.3 三个必须一并修的诚实性缺陷（Agent 3 读码发现）

1. **`fallbackUsed=true` 时界面仍无条件显示「✓ 已应用到本次 Listing」** —— 但代码事实是 `buildListingV5FallbackDraft` 只用了 `bulletAngles[].role`、`useCases[0]`、`keywordIntent.backendOnly`，**文案并非 AI 按策略所写**。必须改口为"只应用了结构：五点顺序、关键词"。
2. **`proofPoints` 是全系统唯一 100% 可追溯的一条，而今天 UI 只显示数量**（`safeSnapshot` 仅投影 `proofPointCount`）。每条 `proofPoint` 就是一条已确认事实（field+value）→ **本次用户可感收益最大、成本最低的补齐点**。
3. **确定性路径的 `targetAudience`/`tone`/`primaryAngle`/`bulletAngles[].shopperValue` 全是硬编码常量/模板**（`strategy.ts:10-18`、`:48-68`）→ **绝不能挂证据徽标**，否则就是"给模板贴证据"。已列入反例清单。

### 5.4 硬性 UI 规则

- 竞品来源的证据一律标注"竞品参考，不等于本商品事实"。
- `textTruncated===true` 的证据显示"证据正文未完整进入模型"。
- 无证据态必须真实呈现，不得用套话填充。
- 延续既有 `humanReviewRequired`：Planner 不改变人工复核边界；**不新增任何写操作或否决状态**（"改方向"走既有 `additionalRequirements` → 策略 prompt 这条真实链路）。
- **废弃 `confidence: high|medium|low` 表达**（理由见 §0.5.3）。

> 详细线框（六种状态）、文案与 8 条运营自测见 `product-spec.md`。

---

## 6. 风险分析（摘要，详见 `risk-review.md`）

| # | 风险 | 严重度 | 缓解 | 残余 |
|---|---|---|---|---|
| R1 | **AI 幻觉**：模型编造卖点并伪造 evidenceRef | 高 | 闸门只接受冻结上下文中真实存在的 `refId`；无法解析即丢弃 | 模型可能"选中"一条真实但语义不相干的证据（弱绑定），需 UI 显示原文供人判断 |
| R2 | **数据不足是常态**（实测有 `voc=0` 任务） | 高 | VOC=0 时必须返回空数组；`missingConflicts` 同步展示；禁止套话 | 运营可能把"空"误读为"系统坏了" |
| R3 | **伪证据引用**：证据正文被 300/7000 预算截断，模型没看全却引用了该 id | 高 | 新增 `textTruncated` 并在 UI 明示 | 只能提示，不能消除 |
| R4 | **架构膨胀**：既有已有 Strategy + Blueprint 两层 | 中 | 原地升级，0 新增节点 / 0 新增调用 / 0 新增表 | 模块数增加 1（实现归属），需在文档中锁定职责边界 |
| R5 | **版本变更引发重新冻结**：`contextFingerprint` 计入 Validator/Writer/Strategy 版本 | **高（已核实，非推测）** | `docs/listing-v57/V57_STATE.md` §4.5 明示："任何提示词或校验版本变更都会使既有指纹失效，**需重新冻结（decision → complete → handoff）**" | 升 `strategyPromptVersion` 不是"重算一次"，而是**每个既有任务都要重走研究决定→完成→交接**。→ 强烈建议**首期不动 prompt 版本**（只做 C1+C3） |
| R6 | **ROI 错配**：当前主瓶颈是 Writer 事实锚定，不是缺决策层 | **高** | 见 §7 先行实验 | 若不先做实验，可能投入后 PASS 率不变 |
| R7 | **确定性兜底本身就在造洞察**：`classifyReferenceNeeds()` 正则猜痛点 | 中高 | C3 一并替换为证据派生；无证据则留空 | 去掉后确定性路径输出会变"更空"，需产品确认可接受 |
| R8 | 成本与配额 | 低 | 复用既有 strategy 调用，`plannedCalls` 不变 | 无 |
| **R9** | **反向风险：卖点表达越多，PASS 率可能越低** | **高（本设计最反直觉的风险）** | 见下方说明 | 若成立，则"策略层加料"与"通过 Validator"是**相互拉扯**的两个目标 |

#### R9 详述（来自项目自身冻结基线，非推测）

`docs/listing-v57/V57_STATE.md` §2/§4 记录：V5.7 官方 holdout 三案 **PASS 0/3**，全部停在 REPAIRABLE；且残余 unsupported 的归因是：

> "5 条 unsupported 中 4 条是 writer 追加的**『目的/框架从句』**（`so you can…`、`which helps you…`、`which is what…`）"

也就是说：**Writer 今天已经在自发做"基于需求的卖点表达"了**——它把事实接上一句买家收益从句。而 Validator 正是因为这些从句没有 Confirmed Fact 支撑而拦截。

推论（必须让用户看到）：
- 用户的目标"从事实描述升级为**基于市场需求的卖点表达**"，在当前 Validator 标准下**天然与事实锚定冲突**——因为它要求文案说出事实之外的东西；
- 因此 **Strategy Planner 若让 Writer 更有"卖点表达欲"，很可能使 PASS 率进一步下降**，而不是上升；
- 用户同时要求"**不降低 Validator 标准**"——这三者（更多卖点表达 / 不降 Validator / 提高通过率）在数学上不能同时最大化，**必须选两个**。
- 该文档同时记录：禁止从句清单的实验曾在 C1 上首次拿到 PASS，但 C7 退化到 BLOCK，收益不一致而被回滚 → 说明这条边界很窄，不宜用"加策略层"的方式硬推。

> **这是本次设计最重要的审查输入**。它不否定 Strategy Planner 的价值（证据可追溯、无证据不进入 Listing），但**否定了"它能提升 AI 交付率"的隐含期待**。

---

## 7. 建议的先行最小实验（不做大规模编码）

在投入实现前，先用**最小代价**证伪核心假设（与 `risk-review.md` 的 kill criteria 对应）：

1. **E1（证据可用性）**：对现有全部任务统计 `vocInsights` 的 `strength` 分布与 `voc=0` 占比。若绝大多数任务证据稀薄，则 Planner 的边际价值集中在"诚实呈现无证据"，而非"产生卖点"。
2. **E2（主瓶颈归因）**：沿用上轮实测（12 次调用全成功但全部 fallback），确认瓶颈在 Writer 事实锚定。若 Planner 无法改善该指标，则必须以"可审计性"而非"PASS 率"作为验收口径。
3. **E3（弱绑定抽样）**：人工抽 20 条 VOC 主题，判断"模型选中该证据"是否真的语义相关。这决定 R1 残余风险是否可接受。
4. **E4（截断率）**：统计进入 prompt 的参考文本被 `MAX_REFERENCE_CHARS=300` 截断的比例，量化 R3。

**验收口径（用户给定标准的映射）**：

```text
商品研究 → Confirmed Facts → [Strategy Planner]
   用户能看到：谁买？为什么买？卖什么？怎么排序？   ← product-spec.md 的界面验收
        ↓
   Listing Writer → Validator → 输出
```

| 目标 | 本方案如何满足 | 备注 |
|---|---|---|
| 原有 Listing V5 测试全部通过 | 不改 Validator / 不改编排 / 加字段向后兼容 | 需实跑 `npm test` 验证 |
| 浏览器真实流程通过 | 仅升级既有策略卡 | 需真实浏览器验收 |
| 无新增安全边界破坏 | 不新增路由/状态/表；`safeSnapshot` 白名单化 | auth/quota 契约不变 |
| **Strategy 无证据不能进入 Listing** | C3 闸门：无证据结论不进入交给 Writer 的 strategy | **本方案的唯一硬新增能力** |

**回归基线（本轮实测，作为"原有 Listing V5 测试全部通过"的对照基准）**：

```text
npx vitest run listing-v5 listingV5
→ Test Files 25 passed | 1 skipped (26)
→ Tests     180 passed | 1 skipped (181)
→ 含 route.test.ts(24) / route.trace.test.ts(11) / validationAnchoring(14)
     validationQuality(10) / listingV5(16) / conversionBlueprint(7) 等
```

实现落地后必须以**同一命令**对比：180 passed 不得减少、1 skipped 不得增加。

---

## 8. 交付物索引

| 文件 | 内容 |
|---|---|
| `00-design-overview.md` | 本文（总控：链路图 / 接入点 / 数据结构 / API / 前端 / 风险） |
| `architecture-review.md` | Agent 1：分层、数据库、状态、事实隔离 |
| `strategy-input-analysis.md` | Agent 2：VOC / 关键词 / 竞品输入契约与证据绑定 |
| `product-spec.md` | Agent 3：面向非技术运营的界面方案与文案 |
| `implementation-plan.md` | Agent 4：`listingStrategy` 模块最小 MVP |
| `risk-review.md` | Agent 5：对抗审查与是否值得做的判断 |

> ⚠️ 审查重点建议：**先读 `risk-review.md`（Agent 5 的对抗结论）再决定是否开工**。

---

## 9. 需要你决策的 4 个问题（审查时请明确拍板）

### D1. 范围：原地升级 vs 新建第四套 Planner

- **选项 A（推荐）**：把 Planner 定义为**横切的"证据绑定契约 + 准入闸门"**，实现落在 V5 既有 Strategy 阶段；旧链仅借范式与词汇。→ 0 新增 provider 调用、0 新增路由、0 新增表、0 新增状态。
- **选项 B**：严格按字面"新增 Listing Strategy Planner 模块"并作为独立编排节点。→ 将出现**第四套**同类决策层（§0.1），且需 +1 次付费调用、新失败路径、新配额语义。
- **我的建议**：A。若你仍要独立模块边界，A 已包含"新增 `lib/listingV5/listingStrategy/` 目录"，只是**不新增编排节点**。

### D2. 是否移除确定性路径的硬编码关键词"造洞察"（G4）

- 现状：`classifyReferenceNeeds()` 用正则从 VOC 文本猜痛点；`marketingIntelligence/analyzer.ts` 的 `VOC_TOPICS` 同理。
- **移除的收益**：消除"伪证据包装"（把 2–3 个英文关键词命中说成市场洞察）。
- **移除的代价**：确定性兜底路径的 `painPoints` / `purchaseMotivations` / `useCases` / `targetAudience` 会变**空**，Writer 收到的框架信息减少，**可能进一步降低 PASS 率**（而 PASS 率本就是当前主瓶颈）。
- **需要你拍板**：是"宁空不假"，还是"保留通用兜底但明确标注为通用非证据结论"？

### D3. 验收口径：可审计性 vs 通过率

- 实测事实：真实 provider 已接通，12 次调用全部成功，但 3/3 任务仍因 Validator 事实锚定不过而 fallback。
- **Strategy Planner 不会改善 `fallbackUsed` 或 PASS 率**，它改善的是"这个卖点凭什么、能不能查证"。
- **需要你拍板**：是否接受以"证据可追溯 + 无证据不进入 Listing"作为本轮验收口径？若你真正想要的是"AI 产出能通过 Validator"，那是**另一个目标（Writer 事实锚定 / prompt 与事实集质量）**，应单独立项，不应与本设计混在一起验收。

### D4. 旧链处置

- 建议：**冻结 `lib/listingHandoff/**` 的策略类资产**（`listingPlanner` / `copyStrategy` / `marketingIntelligence`），只保留为 `/listing-studio-legacy` 的回滚目标，不再新增能力。
- **需要你拍板**：是否同意冻结？若不同意，请给出旧链的继续投入理由（否则两套 planner 会持续分叉）。

---

## 10. 下一步（等你审查后）

**本轮不写任何生产代码。** 你审查后可选：

1. **批准 A 方案** → 先做 §7 的 E1/E4 两个只读统计实验（成本≈0），用真实数据确认证据稀薄程度与截断率，再决定实现范围；
2. **要求缩范围** → 只做 C1（证据身份透传）+ C3（准入闸门），不动 prompt、不动版本号（避免 R5 缓存失效）；
3. **要求先解决主瓶颈** → 转立项"Writer 事实锚定 / 输出 PASS 率"，本轮设计存档备用。

### 10.1 五位 Agent 一致指向的推荐落地顺序（总控整理）

> **关键提示**：Agent 1 与 Agent 5 独立得出结论——**如果资源有限，C4 应排在 C1–C3 之前**。

| 顺序 | 动作 | 成本 | 收益 | 依据 |
|---|---|---|---|---|
| **0（必做，前置）** | **E1 只读实验**：统计存量任务 `vocInsights[].evidenceRefs` 的**非空率与可解析率** | 0 代码 / 0 成本 | 若该假设不成立，**证据绑定将无源可用**，C1–C3 全部落空 | Agent 1 §8 明确标注此为**未验证假设** |
| **1** | **C4：确定性兜底去掉正则"造洞察"**（`strategy.ts:10-18,42,48,58,60`） | 最小改动 | **单独即可消除最隐蔽的失真**（确定口吻的伪洞察），且不依赖 E1 | Agent 1 §"两点诚实说明"第 1 条 |
| 2 | C1 + C3：证据身份透传 + 准入闸门 | 中（+可选字段） | 让"凭什么"可回答、可拒绝 | Agent 2 §8 的 M1–M8 |
| 3 | C2：prompt 契约升级（需升版本） | 高（**触发全量重新冻结**） | 模型被迫引用 refId | §6 R5 |
| 4 | C5：`safeSnapshot()` 白名单暴露准入计数 | 低 | 运营可见"未采用 N 条" | Agent 4 L1–L8 |

**硬性可达性验收（防重演 §0.5.1）**：任何新增产物都必须证明**从真实 UI 操作可到达并被执行**（对照 `listingGenerationService.ts:1774` 的死分支）。这是 Agent 5 的 kill criteria **K9**。

### 10.2 五位 Agent 的独立结论收敛情况

| Agent | 结论 | 是否与总控一致 |
|---|---|---|
| 1 架构 | 不新增第四套；原地升级 + 恢复证据身份；0 新增调用/状态/表/路由 | ✅ 一致，并纠正了总控的 `signalId` 前提错误 |
| 2 输入 | 唯一断点 `context.ts:122-124`；证据本体结构化良好，丢失纯在投影层 | ✅ 一致 |
| 3 产品 | 不新增页面；原地升级策略卡并收编蓝图区（净减 1 区块）；废弃 `confidence` | ✅ 一致 |
| 4 实现 | 3 新文件 + 4 处加法式改动；`route.ts` 编排 **0 行**；`plannedCalls` 不变 | ✅ 一致 |
| 5 对抗 | **否决当前形态**，收缩为"证据身份 + 准入闸门" | ✅ 与总控 §0.2/§0.3 收敛 |

> **五份独立分析全部收敛到同一结论**：**不要新增第四套决策层；真正要做的是证据身份 + 准入闸门这两个横切能力，且优先做取消确定性伪洞察（C4）。**

### 10.3 局限与未验证事项（如实）

1. **E1 未实测**（Agent 1 声明）：存量任务证据引用的非空率未知；若过低，C1–C3 无源可用。
2. **实测数字不可二次复现**（Agent 5 §1.7）：审查期间本机 3005 被重建、16:50 有并发提交、`/api/tasks` 中途返回 0 条（SQLite 被清空），与本任务书给出的上轮实测环境已不一致；`docs/listing-v57/V57_STATE.md:86` 亦自述"基线数字不可复现（属数据依赖，不是代码差异）"。
3. **工作区有并发在途改动**（`components/listing-studio/StandaloneListingStudio.tsx` 等，非本次产物），未触碰。
4. 本轮**未运行**任何浏览器验收（无实现可验）；Listing V5 测试基线 180 passed 为**改动前**状态。
