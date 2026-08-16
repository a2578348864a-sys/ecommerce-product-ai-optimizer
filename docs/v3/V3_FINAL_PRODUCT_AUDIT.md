# V3 Final Product Architecture & Workflow Adversarial Audit — 最终报告

> 状态：`FINAL_PRODUCT_AUDIT = COMPLETE`（严格只读审计；本文件未提交，是否进入 main 等待用户确认）
> 基线：main == origin/main == 29c2933；`LOCAL_RELEASE_CANDIDATE = REOPENED_FOR_PRODUCT_AUDIT`；`PUBLIC_DEPLOY = FORBIDDEN`
> 方法：全代码实证（file:line 证据）+ 6 路并行专项审计 + Start Research 全链 trace；全程未修改任何代码/数据、未执行 git 写操作

## 第一句话

**现在轻选工作台的问题不是几个 UI 小问题，而是产品主链存在系统性错位（Architecture / Product Integration 层）**：研究流程被切成两页——候选研究页先做"AI 结论 + 人工决策"，真正的 Evidence 收集藏在"研究历史"的 Task Detail 里；Sourcing 在证据序列之外（页面末尾、证据区内是死占位）；4 类已保存证据对 AI Summary 不可见；Amazon Browser Evidence 因 productUrl 三重断裂 100% 不可用且用户无法自助修复；VOC 在正常单用户操作下就会 stale 且存在输入丢失风险。

## 结论摘要

| 项 | 结果 |
|---|---|
| P0 数量 | **0**（无数据破坏/跨用户/错误 Entity/错误自动决策；已保存数据无丢失路径——并发正确性无损） |
| P1 数量 | **8**（F1 主链倒置、F2 Sourcing 错位+死区、F3 错误 gating、F4 productUrl 三重断裂、F5 VOC stale+假冲突+draft 丢失、F8 孤儿 AI API+第二扇门、F10 决定三处表达、F11 AI Summary 看不到 4 类证据） |
| P2 数量 | **5**（F6 导航命名、F7 legacy 模型名、双导入入口、首页 /tasks 张力、死代码/测试脱节） |
| 是否需要 DB migration | F4/F5/F3/F2/F11 主修复均**无需 migration**；仅可选优化（F7 模型改名、identity 提列）需要 |
| 是否需要重写架构 | **否**。namespace 写入模型、Evidence 组件、双驱动、Handoff 门禁均可复用；问题是职责编排、gate 拆解与数据接通 |

---

# 输出 1：真实主链图（CURRENT ACTUAL FLOW，代码实证）

```
SellerSprite XLSX → ProductBatch/ProductBatchItem（asin 在此，schema:125）
  → OpportunityCandidate（link=amazonUrl 直导 / 批次 link=null；身份藏 sourceMetaJson）
  → /opportunity-candidates 候选池（"开始研究" → candidatePrimaryHref）
  → /opportunity-candidates/{candidateId}（AgentRunClient candidateMode，旧 /agent/run 迁移）
      └ 候选上下文 → AI 研究（POST /api/workflows/product-analysis）
      └ 研究结论/风险/建议下一步 → 4 项人工确认 → 三态决定 → 保存任务（save-task）
      └ 【无任何 Evidence 收集入口；productUrl:null 硬编码】
  → "已保存，进入研究历史" → /tasks/{id}（TaskRecordDetail）
      └ 研究结论卡（第二套 AI 总结）→ EvidenceWorkbench
          （简明结论→概览→竞品→关键词→Browser→VOC→【货源=静态占位"未收集"】→AI 总结→Missing）
      └ 人工决定（版本化）→ 创作工具 → 历史成果 → 删除/返回 →【SourcingEvidencePanel 真身，页面末尾】
  → Listing/Image Studio（creative_ready 门禁 + 版本化 Handoff，服务端锁死，可绕过浏览页面但无法生成）
```

# 输出 2：推荐主链（RECOMMENDED FINAL FLOW，复用现有能力）

```
SellerSprite → Candidate（只负责 Pre-Research：导入、身份快照、进入研究）
  → "开始研究" → 创建/获取 Task → redirect 至 Research Workbench（Task Detail 升格为主研究页）
      Identity → Source Snapshot → Competitor → Keyword → Amazon Browser → VOC → Sourcing
      → AI Summary（输入含全部已收集 Evidence；标注"基于当前已有 Evidence"）
      → Missing/Conflict → Human Decision（唯一维护点）
  → Content Handoff（Action + 版本化状态）→ Listing/Image Studio
导航：发现商品 / 待研究商品 / 研究记录（原"研究历史"；决策与创作入口从列表收敛到详情）
```

# 输出 3：Gap Matrix（问题清单）

| # | Expected | Actual | Root Cause（file:line） | Severity | Affected Files | Data Risk | UX Risk | Recommended Fix | Regression Risk |
|---|---|---|---|---|---|---|---|---|---|
| F1 | 开始研究后进入 Research Workbench，Evidence 先于 Decision | 候选页先做结论+决策+保存，Evidence 在任务创建后才收集 | 候选研究页=AgentRunClient（含决策模块，`AgentRunClient.tsx:1477-1661`）；Evidence 全在 TaskRecordDetail（:1529）；决策事件在 save-task 时写 researchRecord revision 1（`save-task/route.ts:806-821`）；`validateDecisionForWorkflow` 只要求 4 项勾选（`productResearchRecord.ts:249-260`） | P1（主链倒置） | AgentRunClient.tsx / TaskRecordDetail.tsx / save-task route / productResearchRecord.ts | 无（决策可后续维护，版本化） | 高（先决策后见证据；倒置主链） | Start Research 直接 create/get Task→redirect Task Detail；候选页降为 Pre-Research；决策模块迁移至详情（版本化面板已存在） | **高**（研究执行端重构；需全链 smoke：候选→研究→证据→决策→创作） |
| F2 | Sourcing 在证据序列第 7 位，收集即展示 | 真身在页面最底（删除记录之后）；证据区内货源区=静态占位永远"未收集" | `TaskRecordDetail.tsx:1679-1686`（SourcingEvidencePanel 末尾）；`EvidenceWorkbench.tsx:682-688` 硬编码占位不读 sourcingEvidence namespace | P1（Evidence/Decision 顺序错误） | TaskRecordDetail.tsx / EvidenceWorkbench.tsx | 无 | 高（保存后工作台仍显示未收集；位置反常识） | SourcingEvidencePanel 移入 EvidenceWorkbench 序列（VOC 后）；货源区读 resultJson.sourcingEvidence | 中（组件迁移 + 区块 props 接线；sourcing 已有测试可回归） |
| F3 | CLI_READY 只 gate 关键词/URL/详情；图片走扩展 readiness | 单一 toolStatus.loggedIn（仅 CLI）gate 整个面板，图片找货被 CLI 登录横幅错误覆盖 | `SourcingEvidencePanel.tsx:127`（面板级 need_login）；GET toolStatus=checkCliLogin（`sourcing/route.ts:201-207`）；扩展 extensionSeen 未暴露给 HTTP API；image auth_required 被 :149 映射进 CLI 横幅 | P1（错误 gating） | SourcingEvidencePanel.tsx / sourcing route / native1688BridgeClient.ts | 无 | 高（图片找货被误导去 CLI 扫码登录） | 分能力状态：{cli:{loggedIn,toolAvailable}, image:{extensionAvailable}}；按 action 分流 gate 与文案（图片 auth→"请在普通 Chrome 登录 1688"） | 低-中（API 响应结构扩展 + UI 分支；route 测试更新） |
| F4 | Task 继承 Candidate 的 productUrl/ASIN；Browser Evidence 可用 | Task.productUrl=null；gate 只读 productUrl 不读 resultJson ASIN；无填写表单 | ①save-task 硬编码 `productUrl:null`（`save-task/route.ts:998`）；Demo 缺键（:945-956→demoSandbox.ts:181）②`browserEvidence.ts:313-331` 只读 task.productUrl ③PATCH 只改 decisionStatus（`app/api/tasks/[id]/route.ts:383-403`），通用 POST 被 assertGenericTaskResultAllowed 拒（:426-436） | P1（关键功能完全不可用；若 Amazon Browser Evidence 认定为核心链必备则升 P0） | save-task route / demoSandbox.ts / browserEvidence.ts / browser-evidence route | 无 | **极高**（Browser Evidence 100% 被 task_asin_unbound 拦截，用户无法自助修复；错误提示指向不存在的入口） | ①save-task Owner/Demo 两处复制 candidate.link（或 asin 派生 dp URL）②readBrowserEvidenceTaskAsin 增加 resultJson asin 回退③修正提示文案/提供真实入口 | 低（3 个点 + 测试更新；无 UI 重构） |
| F5 | 正常单用户操作不冲突；冲突可恢复、draft 不丢 | 同页任意区块写入使 VOC stale；冲突后死胡同；刷新丢输入 | whole-document CAS（`taskResultJsonMutation.ts:175-187` 校验整文档 hash+updatedAt）vs namespace 级写入隔离；VOC 冲突只 setError（`VocEvidenceSection.tsx:436-438`）无重载；draft 仅组件内存无 session draft（:399-407）；legacy PATCH 只改列却 bump @updatedAt 造成假冲突（`app/api/tasks/[id]/route.ts:399-402` + schema:35） | P1（正常流程频繁 stale）+ BUG（假冲突）+ DATA_LOSS_RISK（未提交 draft 刷新即丢；已保存数据 SAFE_CONFLICT 无损） | taskResultJsonMutation.ts / VocEvidenceSection.tsx / EvidenceWorkbench.tsx / app/api/tasks/[id]/route.ts | 已保存数据：无；**draft：有丢失风险** | 高（单用户单标签页即可复现；文案"其他页面更新"误导） | ①VOC draft 接 useSessionDraft ②冲突后自动重载最新版本可一键重试 ③legacy PATCH 走 legacy-decision writer ④409 响应携带当前 storageVersion | 中（并发行为改动；已有 CAS 测试覆盖需扩展） |
| F6 | 导航名"研究记录" | "研究历史"（实际含 ongoing） | `WorkspaceSidebar.tsx:33`；页面自证"商品研究历史"（tasks/page.tsx:5） | P2（命名） | WorkspaceSidebar.tsx | 无 | 低 | 改名"研究记录" | 极低（文案） |
| F7 | 研究记录模型名中性 | ViralAnalysisRecord（type="viral"） | `prisma/schema.prisma:32-52` | P2（命名，需 migration 才改） | schema.prisma | 无 | 低（仅开发者可见） | 可选：重命名模型（需 migration+prisma 回归）；或文档化说明 | 中（migration） |
| F8a | 无绕过候选流程写 Task 的门 | /workflow/batch 在线（批量分析可 save-task）；/products/new 在线（3 个真实 AI API + POST /api/tasks） | `WorkflowBatchClient.tsx:380,410`；`ProductProfitForm.tsx:524,588,650,796`；两路由均无导航入口（URL 直达） | P1（第二扇门） | workflow/batch page / products/new page | 无破坏（写入合法任务） | 中（绕过主链） | 产品裁决：下线/重定向，或正式接入入口 | 低-中（路由收口） |
| F8b | 无 UI 调用的真实 AI API 不消耗配额 | /api/generate、/api/agents/{material,risk,sourcing,summary,viral} 在线真实 AI（配额已接） | legacy 审计：死组件对应 API 未下线 | P1（资源风险） | app/api/agents/* / app/api/generate | 无 | 低 | 下线或加显式开关 | 低 |
| F10a | 决定对象单一维护点 | 候选页创建 + 详情版本化维护 + 列表内嵌 legacy 修改三处 | `TaskRecordsList.tsx:709-755`（列表 PATCH，且触发 F5 假冲突） | P1（重复决策） | TaskRecordsList.tsx | 无（版本化防护） | 中 | 列表去直接修改，REDIRECT 详情"打开正式决定面板"（链接已存在 :265） | 低 |
| F10b | 单一 SellerSprite 导入入口 | 双入口（/opportunities 正式 vs /sellersprite-preview 无入口孤岛）；smoke 脚本期望链接不存在 | `OpportunitiesConvergenceView.tsx:28`（死代码）；`flow-convergence-browser.ts:438-443` 与 UI 脱节 | P2 | sellersprite-preview route / smoke 脚本 | 无 | 低 | MERGE 到 /opportunities；修 smoke 脚本 | 低 |
| F10c | /tasks 只是记录索引 | 首页五步中三步指向 /tasks（决策+创作入口） | `HomeDashboardClient.tsx:102-143`（:120-142 三步→/tasks） | P2 | HomeDashboardClient.tsx | 无 | 中（概念张力） | 首页步骤文案与链接改指向详情语义或统一口径 | 低 |
| F11 | AI Summary 读取全部已收集 Evidence；生成前有 gate | Browser/VOC/Sourcing/竞品 4 类证据完全不在输入；无生成前 gate（全空也调 AI，fail 也保存）；顶部"研究结论"卡有第二套 AI 总结（finalReport 来源，非 Phase 5） | `aiEvidenceSummary.ts:108-194 buildAiSummaryEvidenceInput` 仅 decisionEvidence+keywordEvidence；`ai-evidence-summary/route.ts:111-163` 无 gate；`TaskRecordDetail.tsx:1486-1491` 读 presentation.researchConclusions | P1（Evidence 已写但 AI 不读） | aiEvidenceSummary.ts / ai-evidence-summary route / TaskRecordDetail.tsx | 无 | 高（AI 总结对多数证据"失明"，与"AI 解释已有证据"定位不符） | 输入接入 4 类证据（namespace 已存在）；加"基于当前已有 Evidence"生成标注（可选：关键证据缺失时提示）；统一/区分两套 AI 总结语义 | 中（输入构造 + prompt 契约 + 输出校验测试） |
| F12 | EvidenceWorkbench 单渲染 | 死代码 WorkflowDecisionSummary（从未调用）内含重复渲染 | `TaskRecordDetail.tsx:264-777`（定义未调用，:382 重复 EvidenceWorkbench） | P2（死代码） | TaskRecordDetail.tsx | 无 | 无 | 删除死分支 | 极低 |

# 输出 4：Page Responsibility Matrix

| 页面 | 应该负责 | 不应该负责 | 现状 | 处置 |
|---|---|---|---|---|
| Candidate 详情（/opportunity-candidates/[id]） | Pre-Research 收口：身份快照展示、发起研究 | AI 结论长期承载、人工决策、任务沉淀 | 承担研究执行端全责（结论+4 确认+决策+保存），无 Evidence | **MOVE**：研究执行（AI 分析）可保留，决策模块迁至 Task Detail；保存后强制 redirect 详情 |
| Research Workbench（现 Task Detail /tasks/[id]） | Identity→Evidence 序列→AI Summary→Missing→Human Decision→Handoff | 无（它就该是全功能研究页） | 已有 90% 能力（EvidenceWorkbench+版本化决定+Handoff），仅 Sourcing 错位、货源区死占位、AI 输入缺失 | **KEEP + 补全**（F2/F11） |
| Research Records（/tasks 列表） | 记录索引：筛选/搜索/进入详情 | 直接修改决定、承担决策/创作入口 | 内嵌 legacy 决定修改 + 首页把决策/创作入口指向它 | **KEEP + REDIRECT**（决定修改去详情；首页口径收敛） |
| Listing/Image Studio | Content 创作（Handoff 绑定） | 绕过 Decision | 服务端门禁锁死，无绕过 | **KEEP** |
| /sourcing、/viral、/summary、/materials、/risk | 迁移说明 | 活动功能 | LegacyMigratedPage 占位，与主链一致 | **KEEP（占位）或收口 404** |
| /agent、/agent/run、/workflow、/opportunities/import | 重定向收敛 | 活动功能 | 已全部重定向/归档，收敛正确 | **KEEP（重定向）** |
| /workflow/batch、/products/new、/sellersprite-preview | 产品裁决去留 | 悄悄在线 | 无导航入口的孤儿活动路由（batch 可写 Task、products/new 调真实 AI） | **REDIRECT/LEGACY**（裁决后收口） |

# 输出 5：State Machine（现有冲突）

**合法状态**：正式 3 态 `creative_ready / needs_information / abandoned`（`productResearchDecisionContract.ts:1-4`）；研究流程态 `completed / partial_failed`（`productResearchRecord.ts:26`，正交）；DB 兼容列 4 态 `pending/continue/need_info/rejected`（`decisionStatus.ts:1`）；创作交接 `active/stale/revoked`（派生，`productCreativeHandoffStatus.ts:7`）。

**转换规则（现有）**：save-task 建任务写 revision 1（creative_ready 需 completed + 4/4 勾选；partial_failed 强制 needs_information）；详情 PATCH 版本化追加（revision_conflict→409）；decision 变化→handoff revoked（needs_information/abandoned）或 stale（researchRevision 变化）；legacy 记录 readOnly 拒补写。

**冲突点**：
1. **creative_ready 与"Evidence 未收集"可并存**：`validateDecisionForWorkflow` 只要求人工勾选，不要求任何证据 namespace——属有意语义边界（contract 文案明示"不代表采购/盈利/合规成立"），但与主链模型（Evidence→Decision）存在张力，需产品确认是否加"关键证据提示"（非硬门禁）
2. **3 态/4 态双轨**：单向映射，列表显示"可继续"而详情显示"进入创作准备"——文案观感不一致
3. **假冲突**：legacy PATCH 只改列却 bump @updatedAt → storageVersionMatches time 判定冲突（F5 BUG）
4. watchlist/archived 悬空（仅 timeline 模块识别，无来源）

# 输出 6：Capability Matrix

| Capability | readiness 判定 | credential | trigger | error | fallback | 现状问题 |
|---|---|---|---|---|---|---|
| SellerSprite 导入 | 页面即用 | 无 | /opportunities 上传 | 422/415 分类文案 | 预览重试 | ✅ 正常；双入口冗余（F10b） |
| Amazon Browser | 需 Task.productUrl | 无（受控浏览器） | EvidenceWorkbench 采集按钮 | task_asin_unbound | 手动截图导入口 | ❌ **100% 被 gate（F4）** |
| VOC | 页面即用 | 无 | 粘贴导入+分析 | 无评论 no_review_data | — | ⚠️ stale/draft 丢失（F5） |
| 1688 关键词 | CLI_READY | 1688-cli 扫码登录 | action=search | auth_required/risk_control/tool_error | Manual | ✅ gate 正确但 UI 面板级放大（F3） |
| 1688 图片 | EXTENSION_READY + BROWSER_AUTH_READY | 普通 Chrome + 扩展（零 CDP） | action=image | extension_not_installed/auth_required/risk_control | Manual | ⚠️ UI 被 CLI 横幅错误覆盖（F3）；服务端本身正确 |
| 1688 详情/URL | CLI_READY | 同上 CLI | action=url/detail | 同上 | Manual | ✅ 同 F3 |
| AI Summary | 无生成前 gate | AI provider | 手动生成 | quota/输出校验 fail | 降级保存 | ⚠️ 对 4 类证据失明（F11） |
| Listing 生成 | Handoff active + creative_ready | AI provider | Studio 生成 | handoff_stale/required | safe fallback | ✅ 门禁锁死正确 |
| Image 生成 | 同上 + 视觉参考 | AI provider | Studio 生成 | 同上 | safe fallback | ✅ 同 Listing |

# 输出 7：Data Flow Matrix（Candidate → Task）

| 字段 | Candidate 存 | Task 创建时 | Task 现状 | 判定 |
|---|---|---|---|---|
| ASIN | sourceMetaJson.identity.asin / 批次 productBatchSource | 复制进 resultJson facts.asin；顶层无列 | ✅ resultJson 有；❌ Browser Evidence 不读 | **应该引用（已保留）→ 下游读取路径断（F4②）** |
| productUrl | link 列（直导=amazonUrl；批次=null） | **未复制**（Owner 硬编码 null；Demo 缺键） | ❌ null | **应该复制，当前=丢失（F4①）** |
| marketplace | sourceMetaJson.source.marketplace | resultJson facts.marketplace | ✅ | 应该引用（无断裂） |
| title | name 列 | Task.title + resultJson productName | ✅ | 应该引用（无断裂） |
| image | sourceMetaJson.snapshot.imageUrl | resultJson facts.imageUrl + candidateSnapshot | ✅ | 应该引用（无断裂；受控导入） |
| category | sourceMetaJson.snapshot.category | resultJson facts.category | ✅ | 应该引用（无断裂） |
| candidateId | id | 三处保留（sourceMeta/candidateToTask/researchRecord）+ convertedTaskId 原子回写 | ✅ | 应该引用（故意；追溯完整） |
| SellerSprite 证据引用 | sourceMetaJson（sha256/rowHash） | 直导：不复制（candidateId 回查）；批次：完整复制 productBatchBinding | ✅（两种路径均可达） | 应该引用（故意，有注释证据） |

# 输出 8：Concurrency Analysis（VOC stale 完整解释）

- **为什么出现**：whole-document CAS 令牌（resultJson sha256 + updatedAt）+ 同页多区块各自缓存版本。单用户单标签页即可复现：竞品/浏览器/决策/生命周期/创作交接/货源**任一保存**→ 整文档 bump → VOC 持有的旧版本提交 → 409"任务已在其他页面更新，请刷新后重试"。
- **是否丢 draft**：是（DATA_LOSS_RISK）。VOC 输入仅组件内存（无 useSessionDraft），409 后重试必再失败（版本未刷新），唯一出路=刷新页面→输入丢失。已保存数据不丢（SAFE_CONFLICT：owner CAS where 双条件 + visitor 锁+原子写，实证正确）。
- **是否需要整改**：是（P1）。四项：draft 持久化、冲突自动重载、legacy PATCH 走 writer 修假冲突、409 带最新版本。

# 输出 9：整改计划

## P0 Fix Package
**无**（未发现数据破坏/跨用户/错误 Entity/错误自动决策级问题）。

## P1 Fix Package（按依赖与风险排序）
1. **F4（最小、收益最大）**：save-task 复制 candidate.link→productUrl（Owner+Demo 两处）+ readBrowserEvidenceTaskAsin 增加 resultJson ASIN 回退 + 文案修正。无 migration、无 UI 重构，预计 3 个修改点 + 测试。
2. **F11（小）**：buildAiSummaryEvidenceInput 接入 browser/review/sourcing/competitor 证据；生成标注"基于当前已有 Evidence"；统一两套 AI 总结语义。
3. **F3（中）**：GET /sourcing 分能力状态（cli/image 两组 readiness）+ UI 按能力 gate 与文案分流。
4. **F5（中）**：VOC draft 接 useSessionDraft；409 自动重载可重试；legacy PATCH 走 legacy-decision writer；409 携带最新 storageVersion。
5. **F2（中）**：SourcingEvidencePanel 移入 EvidenceWorkbench（VOC 后第 7 位）；货源区读 sourcingEvidence 真实数据。
6. **F10a（小）**：任务列表去掉直接改决定，REDIRECT 详情（链接已存在）。
7. **F8（产品裁决）**：/workflow/batch、/products/new 去留；孤儿 AI API（/api/generate、/api/agents/*）下线或加开关。
8. **F1（最大、最后做）**：Start Research → 创建/获取 Task → redirect Task Detail；候选页决策模块迁至详情（版本化面板已存在，迁移为 UI 重组）。需全链 smoke（候选→研究→证据→决策→创作）。

## P2 Optional Polish
F6 导航改名"研究记录"；F7 模型重命名（migration，可选）；F10b 双导入 MERGE + smoke 脚本修复；F10c 首页口径；F12 死代码清理（WorkflowDecisionSummary + 13 死组件 + 6 孤儿 API）。

## 预计修改范围
- 服务端：save-task route、browserEvidence、sourcing route、aiEvidenceSummary、taskResultJsonMutation（legacy 路径）、可能的 API 下线
- 前端：TaskRecordDetail（区块重组）、EvidenceWorkbench（货源区+sourcing 接入）、SourcingEvidencePanel（gate/文案）、VocEvidenceSection（draft+重载）、TaskRecordsList（决定收敛）、AgentRunClient（决策模块迁移）、导航文案
- 测试：route 测试、驱动测试、并发测试扩展 + 全链 smoke 重跑
- **无 DB migration（除可选 F7）**

## 修完后需要哪些验收
1. 全链浏览器 smoke：SellerSprite 导入→候选→开始研究→Task 直达→六类 Evidence（含 Browser 采集与 1688 三入口）→AI Summary（含新输入）→决策→Handoff→Listing/Image 生成
2. VOC 并发场景回归（同页多区块写入后导入评论不丢 draft）
3. 1688 三能力分别 gate 验证（CLI 未登录时图片找货仍可用；未装扩展时关键词仍可用）
4. 全量回归 + tsc/lint/build
5. 用户第一视角复验（登录→主链完整走一遍）

## 回答其余问题
- **是否仍适合继续 V3.6**：**否**。先完成 P1 整改（Final Product Integration Correction），V3.6 需等整改验收后单独授权。
- **是否可以公网部署**：**否**（PUBLIC_DEPLOY=FORBIDDEN；P1 整改完成并验收前不可）。
- **Visitor 隔离**：审计未发现隔离破坏（访客沙箱 + 锁 + 原子写实证；决定/证据均按 subject 校验）。
- **最大工程风险**：F1 主链重排（研究执行端与详情页职责重组）——其余 P1 均可在不动 F1 的前提下先行修复。
- **最小整改方案**：P1 清单 1-7 项（跳过 F1）即可解除全部"关键功能不可用/错误 gating/数据丢失风险"问题；F1 单独评估排期。

---

*审计执行：主线程全链 trace + 6 路并行专项审计（路由职责 / Candidate→Task 数据流 / 状态机与并发 / Sourcing gating / Evidence 生命周期 / Legacy 残留），全部 file:line 实证，严格只读。*
