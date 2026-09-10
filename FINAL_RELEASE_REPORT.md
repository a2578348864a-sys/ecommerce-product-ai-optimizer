# FINAL_RELEASE_REPORT — Listing V5 结项交付（Conversion Intelligence Layer）

- **仓库**：`D:\Workspace\projects\project-001-listing-v5`
- **分支**：`feat/listing-v5-rebuild`
- **交付前基线 Commit**：`9c36d0fd7bf39cfcba9a0d96d50ba8896492b1a7`（Final Holdout 记录即对应此 SHA）
- **交付性质**：在既有架构上做**增量**收口；未推翻架构、未删除 legacy、未修改 Benchmark 历史结论、未放宽任何安全规则、未重新生成已冻结的 Final Holdout 案例（H1/H2/H3 未被本轮用于调优）

---

## 1. 完成功能

### 1.1 Conversion Intelligence Layer（Phase 2）
新增 `lib/listingV5/conversionBlueprint.ts`：把流水线**已有**的资料（Confirmed Facts + Strategy + 仅作参考的 VOC/关键词/竞品观察）确定性地折叠成一份有界蓝图，供 Writer 生成前读取：

| 蓝图字段 | 来源 | 约束 |
|---|---|---|
| `buyerIntent`（primary/secondary/stage） | 关键词意图 + 商品身份 | 仅搜索措辞，不产生事实 |
| `painPoints[]` | VOC 参考 / 策略痛点 | 每条带 `factBacked`；无事实支撑时显式标注"不得承诺" |
| `competitorGaps[]` | 竞品参考 ∩ 我们自己的已确认事实 | 只保留"我们也能用事实说清"的属性 |
| `conversionAngle` | 策略主角度 + 最强证据点 | framing only |
| `proofPoints[]` | Confirmed Facts | 每个点都指向一个 factId，绝不发明参数 |
| `benefitOrder[]` | 策略 bulletAngles + 事实分配 | 每个卖点主锚定事实尽量不重复 |
| `disallowedTemptations[]` | **Validator 自身硬 claim 词表**（新增共享模块 `claimVocabulary.ts`） | 只保留本商品没有事实支撑的词，杜绝两侧词表漂移 |

设计约束全部满足：**确定性可回放**（纯函数，同输入同输出）、**零新增 Agent / 零新增 Provider 调用点**、reference 文本带 `UNTRUSTED_REFERENCE_DATA` 标记、`references.sourcing` 依旧恒空且不参与。

### 1.2 接入 Listing Writer（Phase 3）
`lib/listingV5/generation.ts`：Writer 系统提示新增 `CONVERSION BLUEPRINT` 段（写明 buyerIntent / benefitOrder 顺序 / 只有 `factBacked` 的痛点才可承诺 / 竞品差异必须用我们自己的事实值 / `disallowedTemptations` 一律不得出现），user payload 新增 `conversionBlueprint`。**Writer 现在在生成前确实拿到了：buyer intent、pain points、competitor gap、conversion angle、proof points。**

### 1.3 Listing Quality Evaluation（Phase 4）
新增 `lib/listingV5/qualityEvaluation.ts`：五维确定性评分（Safety 25 / Keyword relevance 20 / Benefit clarity 20 / Differentiation 15 / Conversion strength 20，合计 100，A–D 分级）。**不替代 Validator**：`safety` 只复述 Validator 已给出的结论（unsupported / prohibited / competitor overlap / 非 PASS 上限 12），评分结果只写入快照与 UI，不进入 `validation.status`、不进入任何 gate、不改变配额。

### 1.4 顺带修复的审计问题（Phase 6 发现）
- **P1-3 注入面未闭合**：`manualDirection`（用户可控）此前只做长度截断；现与 reference 走同一套 prompt-control 清洗，且 `contextFingerprint` 使用清洗后的值。`productIdentity`、竞品信号同样统一清洗。
- **P1-1 / P2-1**：Writer 原先拿不到转化证据原文；`keywordIntent.backendOnly` 恒空。前者由蓝图解决，后者改为从 keyword references 确定性派生（可见意图保持精简，剩余词进入后端搜索词）。
- **P2-4 词表漂移**：硬 claim 词表抽成 `claimVocabulary.ts`，Validator 与蓝图共用同一真源。

### 1.5 UI
`components/listing-v5/ListingStudioV5Client.tsx` 新增两个面板：**转化质量评分**（五维进度条 + 说明）与**转化蓝图**（买家意图 / 痛点及"是否有事实支撑"标记 / 竞品差异 / 证据点数 / 卖点顺序 / 本商品禁止使用的表述）。API `safeSnapshot` 增加两者的有界投影。

---

## 2. 架构说明

```
Research（已冻结事实/参考）
      │  confirmedFacts（唯一事实权威） + references（UNTRUSTED_REFERENCE_DATA）
      ▼
Conversion Blueprint（新增，确定性、零 provider）
      │  buyerIntent / painPoints / competitorGaps / conversionAngle / proofPoints / benefitOrder / disallowedTemptations
      ▼
Strategy（不变） ──► Writer（提示升级至 v4，接收蓝图）──► Validator（零改动）──► Repair（零改动，单次、有界）
                                                                  │
                                                                  ▼
                                        Quality Evaluation（新增，只读评分，不改判）
                                                                  │
                                                                  ▼
                                                     Snapshot / Safe projection / Studio UI
```

- **事实权威**：只有 handoff 中 `usageScopes` 含 `listing` 的 confirmedFacts 进入上下文；蓝图的 `proofPoints` / `primaryFactId` / `ourFactIds` / `proofFactIds` 100% 来自该集合。
- **确定性职责边界**：Validator / Repair / Normalizer / Persistence / Fallback 未被削弱，确定性代码依旧不重写营销句以求通过（复核确认 `validation.ts`、`structuredRepair.ts` 在本轮 diff 中除"导出共享词表"外零行为改动）。
- **可回滚**：新增字段全部可选；旧代码读新快照会忽略多余字段，新代码读旧快照走 null 分支；删除两个新模块 + 还原 8 个改动文件即可回到 `9c36d0f` 行为。

---

## 3. 测试结果（本轮实际执行）

| 检查 | 命令 | 结果 |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **0 error** |
| Lint | `npm run lint` | **0 error / 7 warning**（7 条均为改动前既有告警，无一来自本轮文件） |
| 构建 | `npm run build` | **PASS**（Next.js 16.3.0，`next build --webpack`） |
| 定向测试 | `npx vitest run lib/listingV5 app/api/tasks/[id]/listing-v5 components/listing-v5` | **17 files / 139 tests 全通过** |
| 全量测试 | `npm test` | **7387 passed / 18 failed / 79 skipped（701 files）** |
| 失败归因 | `npx vitest run lib/v4` | 18 例全部为环境性 `better-sqlite3` 原生 binding 缺失（`Could not locate the bindings file`），与交付前基线一致，**非本轮引入** |

新增测试：`conversionBlueprint.test.ts`（7）、`qualityEvaluation.test.ts`（5）、`contextHardening.test.ts`（5），并在 `promptContract.test.ts` 增加"Writer 生成前收到 Conversion Blueprint"契约用例（断言蓝图六个字段存在、系统提示含蓝图规则、`proofPoints` 仅指向已确认事实）。

---

## 4. 浏览器验收证据（Phase 5，真实 Chrome，3005 实例）

验收任务：`cmtvzy3ko0004hv02hpmddrs2`（CHAPIN 探针任务，**非 Holdout 案例**）；实例运行 `LISTING_PROVIDER_MODE=mock` / `OPENAI_LISTING_ENABLED!=true`，生成走确定性路径，**零 Provider 消耗**。

**旅程断言（全部 true）**

| # | 步骤 | 断言 |
|---|---|---|
| 1 | 进入任务（研究记录） | 页面加载、任务标题存在 |
| 2 | 进入 Listing Studio | Studio 加载；生成前无 Listing 面板 |
| 3 | 点击"生成" | 真实点击成功；Listing 生成；质量评分面板出现；蓝图面板出现；校验区可见 |
| 4 | 点击"重新分析策略" | 真实点击成功；**已生成 Listing 未被丢弃**（历史 P0 回归），蓝图与评分仍在 |
| 5 | 离开到任务中心 | 导航成功 |
| 6 | 返回 Studio | Listing/蓝图/评分仍在，内容长度与生成后一致 |
| 7 | 刷新页面 | 状态全部保持（服务端快照为唯一来源） |
| 8 | 移动端视口 390×844 | 横向溢出 0px；质量面板可见 |

**截图**（`D:\Workspace\holdout-evidence\browser-validation\`）：`01-task-research-record.png`、`02-listing-studio.png`、`03-generated.png`、`04-after-reanalyze.png`、`05-left-studio.png`、`06-returned.png`、`07-after-refresh.png`、`08-mobile-viewport.png`

**页面实测文本（质量评分面板）**：`转化质量评分 · B（81/100）` — Safety 25/25、Keyword relevance 20/20、Benefit clarity 20/20、Differentiation 8/15、Conversion strength 8/20，并如实标注"本 Listing 来自确定性 fallback（质量回退信号，非事实失败）"与"缺少可比竞品属性，差异度无法测量"。

---

## 5. 安全审计（Phase 6）

独立只读审计结论：**`SECURITY_AUDIT = PASS_WITH_NOTES`**。

- **fact authority**【PASS】蓝图/评分不存在把 reference 写进事实集合或参与事实锚定的路径。
- **sourcing leakage**【PASS】蓝图、评分、路由投影均不读 sourcing；`references.sourcing` 恒 `[]`；UI 仅有"1688 货源: 0"历史空计数标签，非内容泄漏。
- **prompt injection**【PASS，已加固】`manualDirection` 清洗 + 指纹用清洗值；reference 在构造期即剥离控制语句；痛点/竞品信号二次清洗并带 UNTRUSTED 标记与长度上限；`productIdentity` 统一清洗。
- **unsupported claims**【PASS】`disallowedTemptations` 改为从 Validator 词表派生，消除词表漂移（`certified/professional/perfect/always/never` 等此前不在禁令内）。
- **隔离与校验**：确认 `validation.ts` / `structuredRepair.ts` 行为零改动，质量评分不参与通过/阻断判定。

---

## 6. 已知限制

1. **Writer 提示 v3 → v4 会改变 `contextFingerprint`（必须声明）**：指纹输入原本就包含策略/Writer/Validator 提示版本，因此本轮升级后旧指纹不再复现、旧快照在新代码下会被判 `stale`。**Final Holdout 的 H1–H5 冻结指纹对应的是 writer v3 / SHA `9c36d0f`；本轮 v4 结果与旧指纹不可直接比较，需要为新版本重新冻结一批 Holdout 才能给出发布级质量结论。**
2. **本轮是"机制升级"，不是"质量复测"**：基线 `9c36d0f` 的 Final Holdout 质量结论仍是 `QUALITY_PASS 1/3`（H1/H3 首验 REPAIRABLE → repair 后仍非 PASS → 诚实 fallback；H2 AI 草稿直接 PASS），安全 3/3。蓝图 + 词表派生正是针对该失败模式（模型缺少事实锚定的说服点而转向形容词），但其效果需由新 Holdout 独立测量，本报告不作效果承诺。
3. **fallback 文案仍是模板句**（审计 P1-2）：确定性回退稿可安全通过校验，但转化力弱；质量评分会把这类稿件如实压低（Conversion strength ≤ 8）。
4. **差异度维度在缺少可比竞品属性时给中性分**（8/15），不臆造差异。
5. **环境性缺口**：本机 `better-sqlite3` 原生 binding 缺失，`lib/v4/*` 18 例测试与 V4 graph/checkpoint 无法运行，属既有环境问题，与本轮改动无关。
6. **未做发布动作**：本轮未执行 merge / 部署 / 3005 之外的任何环境切换。

---

## 7. 下一阶段建议

1. **用 writer v4 重新冻结一批 Final Holdout 池并复测**（新商品、新批次、≤9 次 provider 调用/3 例），以量化蓝图对转化质量与 fallback 率的真实影响；旧池不得复用为无偏 Holdout。
2. **提升 fallback 质量**：让确定性回退稿也用蓝图组织句子（仍只拼装已确认事实），缩小 AI 失败时的体验落差。
3. **竞品结构化**：把竞品价格/评分/BSR/五点结构化为可比属性，让"差异度"维度可测量而非中性分。
4. **Validator 词形覆盖**：硬 claim 词形还原（leaks/waterproofing/certifications），在不放宽规则的前提下减少漏检。
5. **前端可达性/移动端专项**：本轮只验证了移动端无横向溢出，建议补键盘可达性与对比度检查。
6. **修复本地 `better-sqlite3` 依赖**，恢复 `lib/v4/*` 测试与 V4 图谱能力。

---

## 8. 变更清单与回滚

**新增**：`lib/listingV5/conversionBlueprint.ts`、`lib/listingV5/qualityEvaluation.ts`、`lib/listingV5/claimVocabulary.ts`、`lib/listingV5/conversionBlueprint.test.ts`、`lib/listingV5/qualityEvaluation.test.ts`、`lib/listingV5/contextHardening.test.ts`

**修改**：`lib/listingV5/types.ts`、`lib/listingV5/context.ts`、`lib/listingV5/strategy.ts`、`lib/listingV5/generation.ts`、`lib/listingV5/validation.ts`（仅新增共享词表导出）、`lib/listingV5/promptContract.test.ts`、`app/api/tasks/[id]/listing-v5/route.ts`、`components/listing-v5/ListingStudioV5Client.tsx`

**回滚**：`git revert <本次 commit>` 或删除 3 个新模块 + 还原 8 个改动文件；无数据库迁移、无持久化格式破坏、无 legacy 删除（`/listing-studio-legacy` 保留）。
