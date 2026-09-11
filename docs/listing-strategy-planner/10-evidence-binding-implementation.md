# Listing V5 — Evidence Binding 实施报告

> 范围：只解决"策略与证据失去关联"。不新增 Planner / Agent / 状态节点 / API / AI 调用。
> 基线：`085ab4d`；分支 `feat/listing-v5-rebuild`。

---

## 1. 结论

**完成。** Strategy 的每条结论现在可以追溯到真实 evidence id；无证据的结论被如实标注为 `ai_suggestion`，不再与有证据的结论混同。

一次真实浏览器全流程（商品研究 → 研究详情 → Listing Studio → 生成）实测结果：

| 指标 | 实测值 |
|---|---|
| 输出状态 | `validation.status = PASS` |
| 输出来源 | **AI Writer 输出**（非确定性 fallback） |
| `fallbackUsed` | `false` |
| 结论可追溯 | **33 / 34** 条 `evidence_bound`，1 条 `ai_suggestion` |
| 未解析（伪造）id | 0 |
| Console error | **0** |

> ⚠️ 诚实说明：本次 PASS 与"无 fallback"**不能归因于 Evidence Binding 层**。该层只做标注，不参与 Validator，也不可能放宽任何判定（见 §5）。本次同时修改了 strategy prompt（新增证据引用要求），strategy 文本因此可能与旧版本不同，故**不可据此声称通过率提升**。

---

## 2. 修改文件

| 文件 | 类型 | 改动 |
|---|---|---|
| `lib/listingV5/types.ts` | 改 | `ListingV5Reference` 新增 5 个**可选**字段（`evidenceId`/`evidenceRef`/`strength`/`count`/`textTruncated`）；新增 `ListingV5EvidenceStrength`、`ListingV5EvidenceBinding` 等类型；`ListingV5Strategy` 新增可选 `evidenceBindings`；`LISTING_V5_STRATEGY_PROMPT_VERSION` v4→v5 |
| `lib/listingV5/context.ts` | 改 | 投影层恢复证据身份：`reference()` 透传 id/强度/计数并标记截断；`boundedReferences()` 接收带身份的来源；新增 `vocEvidenceId` / `keywordEvidenceId` / `competitorEvidenceId` |
| `lib/listingV5/evidenceBinding.ts` | **新增** | 纯函数绑定层：`buildEvidenceIndex()` + `bindStrategyConclusions()` + `summarizeEvidenceBinding()` |
| `lib/listingV5/strategy.ts` | 改 | 结论归一化同时接受 `string` 与 `{text, evidenceIds}`；prompt 新增 `EVIDENCE CITATION` 段与新的 JSON 形状；provider 与确定性两条路径都挂 `evidenceBindings` |
| `app/api/tasks/[id]/listing-v5/route.ts` | 改 | `safeSnapshot()` 白名单新增有界的 `evidenceBindings` 投影（只读、加法式） |
| `app/api/tasks/[id]/listing-v5/route.test.ts` | 改 | 缓存策略用例的版本字面量改为引用实时常量（见 §6） |
| `lib/listingV5/evidenceBinding.test.ts` | **新增** | 16 条专项测试 |

**未修改**（逐项已核）：`lib/listingV5/validation.ts`（Validator）、`lib/listingV5/generation.ts`（Writer 与 fallback）、`prisma/**`、`components/**`（页面主流程）、`lib/listingHandoff/**`。

---

## 3. 数据流变化

### 改前

```text
CreativeContextV1.vocInsights[]
  { insightId, theme, summary, evidenceRefs[], reviewCount, coverage, strength, provenance }
        │
        ▼  context.ts（三行 .map 压平）
  `${theme}: ${summary}`        ← insightId/evidenceRefs/strength/reviewCount 全部丢弃
        │
        ▼
ListingV5Reference = { text, sourceType, marker, notProductFact }   ← 无身份
        │
        ▼
ListingV5Strategy（纯 string[]）→ 无法回答"这个卖点凭什么"
```

### 改后

```text
CreativeContextV1.vocInsights[]（证据本体，未改动）
        │
        ▼  context.ts（身份透传 + 只加字段）
ListingV5Reference = {
    text, sourceType, marker, notProductFact,          ← 旧字段原样保留
    evidenceId,   // voc:theme:<insightId> | kw:<reportType>:<row> | competitor:<ASIN>
    evidenceRef, strength, count, textTruncated
  }
        │
        ├─► prompt：references 自带 evidenceId，模型被要求逐条回引
        │
        ▼
ListingV5Strategy（文本数组不变）+ evidenceBindings（新增 side-car）
        │
        ▼
buildEvidenceIndex() → bindStrategyConclusions()   ← 纯函数、无 provider 调用
        │
        ├─ 命中冻结上下文中的真实 id → evidence_bound
        └─ 无 id / id 解析不到        → ai_suggestion（并记录 unresolvedEvidenceIds）
```

**关键点**：绑定层**只标注，不删除、不改写**结论文本，也不改变交给 Writer 的内容结构，因此生成链路与 Validator 输入不变。

---

## 4. Evidence 前后对比

### 4.1 结构对比

| | 改前 | 改后 |
|---|---|---|
| VOC 参考 | `"organization: counters get messy"` | 同文本 **＋** `evidenceId=voc:theme:2d419e319b3f285a`、`strength=recurring`、`count=6`、`evidenceRef=ev:voc:r1` |
| 关键词参考 | 仅 `keyword` | **＋** `evidenceId=kw:reverse_asin:1`、`evidenceRef=ev:keyword:...` |
| 竞品参考 | 仅 `note \|\| asin` | **＋** `evidenceId=competitor:B0H4GR82N1`、`evidenceRef=ev:competitor:B0H4GR82N1` |
| Strategy 结论 | 无法追溯 | 每条带 `status` + `evidenceIds[]` |
| 伪造 id | 无从发现 | 记入 `unresolvedEvidenceIds`，且**永不**出现在 `evidenceIds` |

### 4.2 真实任务实测（taskId `cmtwk36m2000b9px2t5x65acf`）

```text
evidenceBindings: version=listing-v5.evidence-binding.v1
                  source=provider  total=34  bound=33  suggestions=1

[targetAudience]      evidence_bound  ids=kw:reverse_asin:1, kw:reverse_asin:3, kw:reverse_asin:7, kw:reverse_asin:10
[targetAudience]      evidence_bound  ids=voc:theme:2d419e319b3f285a, voc:theme:f317a9698b986072, ...
[purchaseMotivations] evidence_bound  ids=voc:theme:6f886af4711460b7
[painPoints]          evidence_bound  ids=voc:theme:855ef7a2e67b8481
[useCases]            evidence_bound  ids=kw:reverse_asin:1, competitor:B0H4GR82N1
...
```

**id 来源可核**：
- `voc:theme:2d419e319b3f285a` 的 `2d419e319b3f285a` 是 Evidence 层 VOC 主题的 `insightId`（`creativeContextBuilder` 生成），**不是下标、不是常量**；
- `kw:reverse_asin:1` 由 `reportType + rowNumber` 组成；
- `competitor:B0H4GR82N1` 是真实竞品 ASIN。

### 4.3 反"固定字符串假 evidence"

本仓库曾把 `evidenceRefs` 字段填成常量 `"ev:voc"`（`listingPlan.ts`）。本次用三道防线避免重演：

1. **只从真实来源生成 id**：上游缺身份就不给 id（`evidenceId?: undefined`），绝不补一个占位值；
2. **解析失败即拒绝绑定**：`ev:voc` 这类常量在任何上下文里都解析不到，只会落进 `unresolvedEvidenceIds`；
3. **测试锁定**：`evidenceBinding.test.ts` 断言"5 条参考 → 5 个互不相同的 id""id 集合不含 `ev:voc`""上游数据变化则 id 变化"。

---

## 5. 是否提升可审计性

**是，且这是本次唯一的净增能力。** 具体提升：

| 问题 | 改前 | 改后 |
|---|---|---|
| 这个卖点凭什么？ | 答不出 | 每条结论挂真实 evidenceId，可回指 VOC 主题 / 关键词报表行 / 竞品 ASIN |
| 模型有没有编证据？ | 无从判断 | 编造的 id 被记为 `unresolvedEvidenceIds`，且不会被当成引用 |
| 确定性模板是否被当成"有依据"？ | 混同 | 模板结论**全部**标为 `ai_suggestion`（`source=deterministic`，`bound=0`） |
| 证据强度如何？ | 丢失 | `strength`（isolated/weak/recurring）与 `count` 从 Evidence 层原样带出 |

**边界（必须明确）**：该层**不参与** Listing 文案的 PASS / REPAIRABLE / BLOCK 判定，也不改变写入 Listing 的内容。它只回答"这条策略结论有没有依据"，不回答"这版文案能不能过"。

---

## 6. 验收对照

| # | 标准 | 结果 | 证据 |
|---|---|---|---|
| 1 | 现有 Listing V5 测试全部通过 | ✅ | `npx vitest run listing-v5 listingV5 evidenceBinding` → **196 passed / 1 skipped**（基线 180 + 新增 16） |
| 2 | Provider 调用次数与当前一致 | ✅ | `route.test.ts:306` `reserveCalls=[5]`、`startedCalls=2` 原样通过；新测试断言绑定层 `callAiJson` 调用数=1 |
| 3 | 原有 Listing 生成结果无异常回归 | ✅ | 全量 `npx vitest run` → **7474 passed / 1 failed**；唯一失败见下 |
| 4 | Strategy 输出可追溯到真实 evidence id | ✅ | §4.2 实测 33/34 条绑定；id 来自 `insightId`/报表行/ASIN |
| 5 | 禁止固定字符串假 evidence | ✅ | §4.3 三道防线 + 专项测试 |
| 6 | 真实浏览器验证、无 Console error | ✅ | 首页 → 商品研究 → 研究记录 → 研究详情 → Listing Studio → 生成；`console error` = **0 条**（全程 SPA 导航，钩子未丢） |
| 7 | 输出报告 | ✅ | 本文件 |

### 那 1 条全量失败是既有环境问题，非本次回归

```text
FAIL lib/listingHandoff/listingOperatorCopy.test.ts
  "真实任务 cmtdgivs6000nutmvkeymtg83 隔离生成验证"
  TypeError: Cannot read properties of undefined (reading 'currentRevision')
```

三重证据表明与本次改动无关：
1. 该用例依赖的真实任务 `cmtdgivs6000nutmvkeymtg83` **已不在本机数据库中**（`/api/tasks` 查无此 id），属 fixture 数据缺失；
2. `docs/listing-v57/V57_STATE.md` §4.6 早已登记：**"`lib/listingHandoff/listingOperatorCopy.test.ts` 1 条（真实任务 handoff 前置条件缺失）"**；
3. 本次 diff **完全未触碰 `lib/listingHandoff/**`**。

### 其它门禁

- `npx tsc --noEmit` → **0 error**
- `npx eslint`（全部改动文件）→ **0 problem**

---

## 7. 副作用与必须知悉的事项

### 7.1 `contextFingerprint` 变化 → 既有快照全部失效（**不可避免**）

`references` 参与 `contextFingerprint` 哈希；参考对象新增了 `strength`/`count` 等**新信息**（这些确实进入了 prompt），因此哈希必然改变。

实测：本机 4 个已有快照的任务现在全部返回 `snapshot.stale = true`。

**影响**：运营下次打开会看到"研究资料已更新，建议重新生成"；每个任务首次重新生成会**多跑一次 strategy 调用**（一次性），之后恢复缓存。**单次请求的调用预算 `plannedCalls`（1/4/5）未变**。

> 这是"恢复证据身份"的固有代价：要让 prompt 看到证据强度，指纹就必须覆盖它。

### 7.2 strategy prompt 版本 v4 → v5

prompt 的输出契约变了（每条结论必须回引 evidenceId），故按既有纪律升版。除 §7.1 外无额外成本（指纹本就会变）。

### 7.3 修改了一条既有测试的版本字面量

`route.test.ts` 的"复用当前缓存策略"用例原先把 `strategyPromptVersion` 硬编码为 `"listing-v5-strategy.v4"`。升版后该 fixture 不再代表"当前版本"，用例失败。

处理方式：改为**引用实时常量** `LISTING_V5_STRATEGY_PROMPT_VERSION`。**断言未被削弱**（仍断言 `analyzeListingV5Strategy` 不被调用、`generateListingV5Draft` 调用 1 次），且今后升版不再误报。

---

## 8. 未做与遗留

| 项 | 说明 |
|---|---|
| 未做 UI 呈现 | 绑定数据已进入 `safeSnapshot`，但策略卡尚未显示证据徽标；`product-spec.md` 的界面方案仍待实现（本轮要求"不改页面主流程"） |
| 未做 C4（去正则伪洞察） | `strategy.ts` 的 `classifyReferenceNeeds()` 仍用硬编码正则猜痛点；本轮它已**如实标为 `ai_suggestion`**，但未被移除——那是独立的一步 |
| 未做 competitor `relation` 过滤 | V5 仍不过滤 `adjacent/irrelevant` 竞品（与模块契约存在偏差），属既有问题，本轮未扩大范围 |
| 未验证 | 只在 1 个任务上做了端到端真实生成；未做多任务批量统计（证据覆盖率分布、`ai_suggestion` 占比） |
| 环境限制 | 审查/实施期间本机 DB 曾被清空、有并发提交，任务数据不可完整复现 |
