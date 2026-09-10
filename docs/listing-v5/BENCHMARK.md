# Listing V5 本地基准测试记录（Benchmark）

- 仓库：`D:\Workspace\projects\project-001-listing-v5`
- 分支 / HEAD：`feat/listing-v5-rebuild` / `9c2163c985ba5891c0636fe57b7437b073968583`
- 冻结输入：`tools/listing-v5-eval/out/benchmark-abc.txt`（A/B/C Writer 真实输出，已冻结）
- 真实 Provider：`deepseek-flash`
- **最终判定：`BENCHMARK = FAIL`**（`V5_WINS = 2/4`，`WIN_RATE = 50% < 75%`；B、D 为 LOSS）
- **当前阻塞：`B_REPAIR_TARGETING_DEFECT`**（Repair 契约已修好并实测生效，但修复目标只给出整句、未给出具体违规词）
- 条件授权的那次真实调用：**已使用**（`ACTUAL_EXTRA_USED = 1`，`REMAINING = 0`，全程 Provider 预算已锁死）

---

## 1. 判定规则

单案只有在 Fact Safety 通过（`unsupported = 0`、`prohibited = 0`、`competitorOverlap = 0`）且 `validation.status = PASS`
时才成为 `V5_CANDIDATE_VALID`。四案须**逐一完成双轮匿名文案比较**并全部为 `V5 WIN` 才可能 `BENCHMARK = PASS`：
A/B/C 三胜 + D 一负 ⇒ `V5_WINS = 3/4`、`WIN_RATE = 75%` ⇒ PASS。`VALID ≠ WIN`，门槛不得修改。

## 2. Provider 调用账目

| 项目 | 次数 |
| --- | --- |
| 本阶段条件授权（`CONDITIONAL_EXTRA_AUTHORIZED`） | 1 |
| 实际使用（`ACTUAL_EXTRA_USED`，Case B `description` targeted Repair） | 1 |
| **剩余（`REMAINING`，已锁死）** | **0** |

未重新调用 Strategy、Writer，未重跑 A/C/D，未做 Prompt 实验，未做第二次 Repair。
本次调用只做一件事：用**修好后的新契约**对 LE TAUCI 的 `description` 执行一次定向 Repair。

## 3. 四案最终结果

| 案件 | 商品 | 状态 | 判定 |
| --- | --- | --- | --- |
| A | Owala | `validation = PASS`，四类 claim 全 0，`repairAllowed = false` | `V5_CANDIDATE_VALID` ⇒ **V5 WIN** |
| B | LE TAUCI | Repair 成功执行（`succeeded = true`、`appliedPaths = ["description"]`），但改写后的正文**仍含未支持表述 `high-use`** ⇒ `REPAIRABLE`、`unsupported = 1` | **`V5_LOSS`** |
| C | ukeetap | `validation = PASS`，四类 claim 全 0，`repairAllowed = false` | `V5_CANDIDATE_VALID` ⇒ **V5 WIN** |
| D | Desk Lamp（合成 Fixture） | 首次校验 `REPAIRABLE` → Repair 执行 → 仍非 PASS → 诚实回退 fallback | **`V5_LOSS`** |

A/B/C 由 `tools/listing-v5-eval/revalidateFrozenAbc.ts` 在**零 Provider 调用**下对冻结文案复核
（`out/benchmark-abc-revalidated.txt`）。D 使用此前真实运行记录（3 次调用），本次未重跑。
说明：`benchmark-abc.txt` 中内嵌的 `CASE_X_VERDICT = V5_LOSS_FACT_SAFETY` 是当时（validator 修复前）的旧结论，
以 revalidated 复核结果为准。

---

## 4. Case B 取证：三次真实 Repair 的完整历史

### 4.1 前两次失败（Repair 输出契约缺陷）

| 运行 | 结果 |
| --- | --- |
| run 1（无取证） | `completionTokens=135`、`responseCharLength=622`、`jsonParseStage=passed`、`repair_response_shape_invalid` |
| run 2（已取证，`out/benchmark-case-b-response.json`） | `completionTokens=131`、`responseCharLength=603`、`responseShape = keys=repairs;wrapper=none;items=0` |

两次 Provider 都返回：

```json
{ "repairs": [ { "path": "description", "currentText": "<改写后的正文>" } ] }
```

而不是契约要求的 `text`。根因：`ROOT_CAUSE = REPAIR_PROMPT_OUTPUT_CONTRACT_AMBIGUITY` ——
请求用 `currentText` 命名输入、输出又要求 `text`，模型连续两次回填请求字段名。解析器拒绝它是正确行为，
**没有**把 `currentText` 加入合法输出别名。

### 4.2 契约修复（GATE_A = PASS）

| 项 | 修复后 |
| --- | --- |
| 请求输入字段 | `targets[].original` |
| 输出字段 | `repairs[].text` |
| 请求中是否仍有 `currentText` | 否（测试静态断言整个 payload 不含该字符串） |
| Prompt | 显式给出唯一 JSON shape，并列出 `Do not return: original, source, currentText, factIds, strategyRole, issues, analysis, reason, explanation.` |
| 安全边界 | 未放宽：仍拒绝 currentText-only / 缺 text / 空 text / 未授权 path / 改 factIds / 改 strategyRole |

零 Provider 测试 `lib/listingV5/repairContract.test.ts`（4 项）：请求契约、Prompt 契约、
Mock 正向合同（`succeeded = true`、`appliedPaths = ["description"]`、其他字段完全不变）、
Mock `currentText` 回归（`succeeded = false`、`repair_response_shape_invalid`、草稿不变）。
验证：`lib/listingV5` 86/86 通过；路由测试 48 文件 / 610 项通过；`tsc` 0 错误；`eslint` 0 错误。

### 4.3 第三次运行（修好契约后，`out/benchmark-case-b-repair.run3.txt`）

```
providerHttpStatusClass = success      finishReason     = stop
completionTokens        = 134          responseCharLength = 615
jsonParseStage          = passed
responseShape           = keys=repairs;wrapper=repairs[0];items=1;paths=description;textPresent=y;textLengths=569
repairSucceeded         = true         appliedPaths     = ["description"]
afterStatus             = REPAIRABLE   afterUnsupported = ["... brings kitchen counter utensil storage and organization to high-use kitchens"]
```

冻结答案（`out/benchmark-case-b-response.run3.json`，secret scan PASS）：

```json
{ "repairs": [ { "path": "description", "text": "The LE TAUCI Ceramic Utensil Holder set brings kitchen counter utensil storage and organization to high-use kitchens. ..." } ] }
```

**契约修复被实测证明有效**：模型这次正确返回了 `text`，正文被真实替换。
但改写后的句子**保留了 `high-use kitchens`**，Validator 因此仍判定 `REPAIRABLE` ⇒ `B = LOSS`。

根因（下一次要修的缺陷）：Repair 请求的 `issues.unsupportedClaims` 传的是**整句**，没有告诉模型句子里
**哪个词**没有 Confirmed Fact 支持。模型于是重写了句子的一部分，却留下了真正违规的 `high-use`。
这把问题从「输出契约」推进到了「Repair 定向精度」，属于新的、独立的缺陷。

按既定规则（返回 text 但内容仍不安全 ⇒ LOSS，不得 retry），**本次未做第二次 Repair**，Case B 判定为 LOSS。

---

## 5. V4 baseline 与 GATE_B（方法学修正后 = PASS）

### 5.1 来源与公平性

| 案件 | BASELINE_SOURCE | 证据 |
| --- | --- | --- |
| A | `persisted_v4`：`aiListingPackSnapshot`，`source = real_ai_draft`，`generatedAt = 2026-09-09T19:26:10.849Z` | 同 Task；`ALIGNED_HANDOFF = true`、`ALIGNED_RESEARCH = true` |
| B | `persisted_v4`：`source = deterministic_composition_v1`，`composerVersion = listing-composer-v1`，`generatedAt = 2026-09-08T21:34:34.524Z` | 同上 |
| C | `persisted_v4`：`source = deterministic_composition_v1`，`generatedAt = 2026-09-09T18:55:53.348Z` | 同上；且离线重放与 persisted 文案**逐字一致** |

三案均具备 Title / Bullets / Description，且与 V5 使用**同一 Research Revision 与 Handoff Revision**。
未使用人工撰写、未使用 V5 fallback、未使用不同商品、未给 V4 削减证据。

### 5.2 Search Terms：V4 的真实输出就是空

三份 persisted V4 snapshot 的 `backendSearchTerms` 与 `keywords` **都是空数组**（原始值已核验）。
`listingKeywordBrief` 在 A、C 完全不存在，B 存在但 `backendSearchTerms = []`。
`ListingCopyHistory` 旧表 7 行全是 6 月的无关商品。

离线重放（`LISTING_V5_FORBID_PROVIDER=1`，任何 AI 调用都会抛错，Provider 调用 = 0）能产出机械拼接词
（如 `ukeetap | UTO001 | Plastic | Organizer | Silver`），且 A/B 的正文已劣化（B 标题混入抓取页面文字
"Click to play video …"），因此**不采用**：那不是 V4 的真实输出，也不是可用的搜索词。
`out/v4-baseline-abc.json` 中 `searchTerms: []` 原样保留，并记录
`searchTermsState: "authentic_empty_in_persisted_v4"`；`searchTermsSynthesisUsed = false`。

### 5.3 方法学说明（原文照录）

> The persisted V4 outputs for all three real cases contained no
> backend search terms. Empty search-term arrays were retained as the
> authentic V4 output rather than synthesized. Search-term generation
> is reported separately as a capability difference and is excluded
> from the blind copy-quality winner.

### 5.4 Gate B 判定

```
V4_TITLE = PRESENT        V4_BULLETS = PRESENT        V4_DESCRIPTION = PRESENT
SEARCH_TERMS_STATE = AUTHENTIC_EMPTY（有 persisted 证据）
Revision / Fingerprint 对齐 = PASS
GATE_B = PASS            FAIR_V4_BASELINE_AVAILABLE = YES
```

---

## 6. SEARCH TERMS 能力差异（与 Copy Quality 分开记录）

`SEARCH_TERMS_CAPABILITY` —— 属于 `PRODUCT_CAPABILITY_DIFFERENCE`，**不计入**匿名 Copy Quality 得分。

| 案件 | V4 state | V5 Search Terms | V5 Validator |
| --- | --- | --- | --- |
| A | `EMPTY_IN_PERSISTED_OUTPUT` | owala water bottle 24 oz, owala water bottle, insulated water bottle, water bottle insulated, owala, water bottle, water bottles, thermos, owala 16 oz, owala coffee tumbler | PASS（不得分，仅记录） |
| B | `EMPTY_IN_PERSISTED_OUTPUT` | utensil holder, kitchen utensil holder, ceramic utensil holder, utensil holder countertop, utensil organizer, kitchen decor, kitchen counter decor, spoon holder, tool organizer, apartment decor | REPAIRABLE（正文问题，与搜索词无关） |
| C | `EMPTY_IN_PERSISTED_OUTPUT` | silverware organizer, drawer organizer, utensil drawer organizer, silverware tray for drawer, kitchen drawer organizer, kitchen organization, utensil holder, kitchen organizer, home essentials, kitchen | PASS（不得分，仅记录） |

`SEARCH_TERMS_CAPABILITY_RESULT` = V5 生成了搜索词、V4 未生成；这是能力差异，不是文案质量差异。

---

## 7. 双轮匿名 Copy Quality 比较

- 比较面（双方共同拥有）：**Title / Bullets / Description**；Search Terms 排除（V4 未生成，纳入会给 V5 免费优势）。
- 匿名标签 `Candidate A / Candidate B`，Round 1 正常顺序、Round 2 完全交换；两轮同向才算有效 Winner。
- 评分：Naturalness / Marketing Appeal / Benefit Clarity / Bullet Differentiation / Keyword Naturalness / Direct Usability（1–5），外加 Mechanical Copy = YES/NO。
- `Keyword Naturalness` 只看**可见正文**中的关键词自然度，不以是否存在 backend Search Terms 计分。
- 原始证据：`out/blind-pairs.json`（匿名对）、`out/blind-mapping.json`（封存映射）、`out/blind-scores.json`（两轮评分与理由）。

限制（不隐藏）：评分者与候选产出者是同一个 Agent，**无法做到真正盲评**；交换顺序可消除位置偏差，但不能消除来源知识偏差。

| 案件 | Round 1 | Round 2 | 一致 | Winner |
| --- | --- | --- | --- | --- |
| A Owala | Candidate B 胜 | Candidate A 胜（同一文本） | 是 | **V5 WIN** |
| C ukeetap | Candidate B 胜 | Candidate A 胜（同一文本） | 是 | **V5 WIN** |
| B LE TAUCI | 不比较 | 不比较 | — | **LOSS**（无有效 V5 候选，不存在文案质量可比性问题） |

A 的 V5 WIN 依据：Fact Safety PASS；`Naturalness 5 > 4`、`Direct Usability 5 > 4`（三项头条指标中两项明显更优），
`Bullet Differentiation 5 > 3` 未退化、`Keyword Naturalness` 持平；
V4 侧存在 "effortless portability" 一类广告腔，V5 无；机械文案双方均 NO。

C 的 V5 WIN 依据：Fact Safety PASS；六项全部更高（V4 侧为属性拼接
"This Organizer is extra Large Capacity, Expandable, Sturdy, Food Safe, Waterproof." 与
片语 "Available with Matte for this Organizer."），`Mechanical Copy` 由 YES 变为 NO。

### Owala Quality Gate

| 指标 | 阈值 | V5 实测 | 结果 |
| --- | --- | --- | --- |
| Naturalness | ≥ 4 | 5 | PASS |
| Benefit Clarity | ≥ 4 | 5 | PASS |
| Bullet Differentiation | ≥ 4 | 5 | PASS |
| Direct Usability | ≥ 4 | 5 | PASS |
| Mechanical Copy | NO | NO | PASS |

旧的机械文案标记（`for a clear product detail`、`The product includes X...`）在 Owala 的 V5 文案中**均不存在**。
`OWALA_QUALITY_GATE = PASS`

---

## 8. 最终判定与下一步

```
A = V5 WIN        B = LOSS        C = V5 WIN        D = LOSS
V5_WINS = 2/4     WIN_RATE = 50%  BENCHMARK = FAIL
LOCAL_CLOSURE = BLOCKED           READY_FOR_PR = NO
```

未执行项：Browser 之外的收口流程（final diff audit、commit、push）——本分支判定 FAIL，未做任何 Git 写操作。

---

## 9. 本 Benchmark 的角色（开发证据，不再作为发布门槛）

这是一个**开发期 Benchmark**，A/B/C/D 在开发过程中被反复用于 Validator 修复、Fact atomization、
Repair schema 修复与 Repair 定向诊断，因此它们已经属于 **DEVELOPMENT / REGRESSION CASES**，
不能继续通过针对同一个 Case 反复抽样把 2/4「磨」成 3/4。

> This benchmark was used iteratively during development and exposed
> multiple validator and repair-contract defects. Its final recorded
> result remains 2/4 and is retained as development evidence rather
> than rewritten after fixes.

- `DEVELOPMENT_BENCHMARK = A/B/C/D`（结果 2/4，FAIL，保留原样）
- `FINAL_HOLDOUT_BENCHMARK = NOT_RUN` —— 只有全新的、未参与本轮任何修复的 Case，
  才能作为最终独立质量验证（`QUALITY_HOLDOUT = NOT_RUN`，`CUTOVER_APPROVAL = PENDING`）。
- `PROVIDER_CALLS_REMAINING = 0`：Case B 不再授权任何真实调用。

---

## 10. Repair 定向精度修复（零 Provider，开发回归）

### 10.1 实现

Validator 现在把「为什么这句失败」结构化输出，而不是只给整句：

```ts
claims.unsupportedDetails?: Array<{
  text: string;             // 失败句子
  reason: string;           // 上游 Claim Evidence 原因
  field: string;            // title | bullets[i] | description
  issueCode: "unsupported_hard_claim" | "unsupported_attribute_assertion" | "unsupported_claim";
  offendingSpans: string[]; // 被拒绝的**原文词**，如 ["high-use"]
}>
```

设计要点（`lib/listingV5/validation.ts`）：

- 与布尔判定共用同一套检测器（`uncoveredHardTokens` / `uncoveredAttributeAssertions`），
  不再有第二份判断逻辑；`hasUncoveredHardToken` / `hasUncoveredAttributeAssertion` 变成它们的薄封装；
- `offendingSpans` 由 offender token 反查**原文中真实出现的词**得到（`high` → `high-use`），
  因此它永远是原句的**子集**，不可能引入新内容；
- 有界：每句最多 6 个 span、每个 span ≤ 48 字符，且不含句末标点；
- deterministic（只读该句与 Confirmed Facts）、可测试；
- `offendingSpans` 只解释「为什么失败」，**不是事实来源**，Fact Authority 仍然只有 Confirmed Facts。

Repair 请求随之变为 `{ path, original, issues: { structuralIssues, violations: [{ issueCode, sentence, offendingSpans }] } }`，
Prompt 新增：`Rewrite only the requested field.` / `Remove or rewrite every offending span.` /
`Do not preserve an offending span unless a Confirmed Fact supports it.` /
`Do not replace it with another unsupported hard claim ...` /
`They are not facts and are never a source of product facts ...`。
安全边界未动：最多 3 targets、一次调用、只改 text、requested path 白名单、factIds / strategyRole / backendSearchTerms 不变。

### 10.2 零 Provider 测试（`lib/listingV5/repairPrecision.test.ts`，6 项全通过）

| 测试 | 内容 | 结果 |
| --- | --- | --- |
| A | 违规词被识别为 `offendingSpans: ["high-use"]` 并出现在 Repair payload 中 | PASS |
| B | mock 修复删除 `high-use` → Validator `PASS` | PASS |
| C | mock 修复仍保留 `high-use` → 仍 `REPAIRABLE` | PASS |
| D | mock 换成 `heavy-duty`（同样无事实）→ 仍非 PASS，且 span 为 `["heavy-duty"]` | PASS |
| E | span 有界、是原句子集、不含标点、不等于整句 | PASS |
| 回归 | **冻结的 Case B description** → `offendingSpans = ["high-use"]`（field = description），payload 携带该 span | PASS（`CASE_B_REGRESSION_FIX = PASS`） |

回归只读冻结数据，Provider 调用 = 0；**它不改变 B 的原始 Benchmark 结果，B 仍为 LOSS**。

---

## 11. 工程收口验收（全部零 Provider）

| 检查 | 结果 |
| --- | --- |
| TARGETED（`lib/listingV5`） | 12 文件 / 92 项通过 |
| ROUTE / TRACE（含 listing-v5 route、route.trace、prompt injection、validation quality、repair contract） | 48 文件 / 610 项通过 |
| TYPECHECK（`tsc --noEmit`） | 0 错误 |
| LINT（`eslint .`） | 0 错误 |
| BUILD（`npm run build`） | 成功 |
| 全仓 `vitest run` | 698 文件 / 7461 项：7363 通过 / 19 失败 / 79 跳过。失败项均为既有环境问题：5 个 `lib/v4/*`（`better-sqlite3` Node 24 原生绑定缺失）、`lib/listingHandoff/listingOperatorCopy.test.ts`（历史任务夹具）、`lib/server/native1688Bridge.integration.test.ts`（全量并行下端口竞争，**单独运行 11/11 通过**），均与本次改动无关 |
| DESKTOP 1440×900 | PASS：Owner 登录后渲染，无横向溢出，无内部 trace 泄漏 |
| MOBILE 390×844 | PASS：同一 Listing 渲染，`scrollWidth = 390`，无横向溢出 |
| PERSISTENCE | PASS：生成后整页刷新，Listing 区块文本完全一致（长度差 0） |
| PRODUCTION TRACE HIDDEN | PASS：认证态 HTML 与可见文本均不含 `deepseek` / `fallbackUsed` / `contextFingerprint` / `repairPromptVersion` / `unsupportedClaims` / `offendingSpans` / `completionTokens` 等内部字段 |
| IMAGE STUDIO SMOKE | PASS：`/image-studio` HTTP 200，正常渲染 |
| `/listing-studio-v5` redirect | PASS：200 落到 `/listing-studio?taskId=...`，参数保留 |
| `/listing-studio-legacy` | PASS：回滚入口仍可用 |

浏览器验收方式：本地 `next start -p 3015`（不触碰 3005）、使用本仓库自己的 `prisma/dev.db`、
进程内 `LISTING_PROVIDER_MODE=mock` / 无 AI 凭证，因此**全程 0 次真实 Provider 调用**；
通过真实 `LoginPage` 完成 Owner 登录（客户端 token 存在 sessionStorage，按标签页隔离）。
在该 mock 配置下，Studio 生成的是被明确标注为 **“Safe Fallback · 基础安全稿”** 的安全回退稿，
未被冒充为 AI 文案——真实 AI 生成路径不在本次验收范围内（需要 Provider，已锁死）。

