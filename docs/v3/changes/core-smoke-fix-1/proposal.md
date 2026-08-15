# Core-Smoke-Fix.1 — 人工 Smoke 缺陷修复（proposal）

> 范围：仅修复人工验收发现的 3 个真实问题。不启动 V3.x、不 push、不公网部署、不新增状态/Evidence 体系、不降低 fail-closed/安全/配额约束。

## 问题 1：SellerSprite 导入仍要求手动选报表类型和一级类目

### 根因

- **1A 报表类型**：`detectSellerSpriteReportType`（lib/upstream/sellersprite/reportType.ts）对「无搜索排名列 + 四件套齐全」的报表：
  - 全部 BSR ∈ [1..10] → category_current（正确）
  - 其余（含真实 Products(10) 的 BSR 大值域）→ `unknown(ambiguous_ps_without_search_rank)`（fail-closed）
  - 真实 Products(10)-US-20260814.xlsx（新格式 Product Search，无搜索排名列，rootBsr max=750682）因此被判 unknown → inspect 返回 reportTypeDetected=false → UI 要求手动选择。
- **1B 一级类目**：类目检测三态（detected/mixed/unknown）与自动填充已实现（`detectProductBatchCategory` + `setSelectedCategory`），但因 1A 失败，真实 Products 报表从未走到类目检测（acceptedRows=0），且 UI 无「已自动识别」表达。

### 修改

- `reportType.ts`：BSR 值域判定改为三分支——
  - 无行级 BSR 值 → `unknown(requires_row_signal)`（人工兜底）
  - 全部 ∈ [1..10] → `category_current`（真实 CC 榜单形态，12/12 样本验证）
  - **存在 >10 → `search_results`**（CC 榜单 BSR 必 ∈[1..10]，含 >10 必然是新格式 Product Search；确定性判定，错误率不上升）
- `ProductBatchManager.tsx`（UI）：
  - 自动识别成功 → 「已自动识别报表类型：搜索结果报表。已自动识别一级类目：厨房与餐厨。请确认查询词和价格范围后导入。」（`data-testid="report-type-auto-detected"`）
  - 无法可靠识别 → 「无法可靠识别报表类型，请手动选择。」（`data-testid="report-type-manual-required"`）
  - 三态语义：detected（自动填，无需操作）/ ambiguous·unknown（人工选择，不预选）/ manually_confirmed（人工选择后提交）
- golden 用例更新：`ps-no-search-rank` 与 `ps-no-search-rank-explicit` 断言 search_results（原 unknown）；CC fixture 大类 BSR 修正为榜单值（1/2，与真实 CC 语义一致）；新增 `detect` 测试断言。

### 自动识别何时成功 / 何时人工 fallback

| 输入特征 | 判定 |
|---|---|
| 含搜索排名列 | search_results（旧格式，确定性） |
| 无搜索排名 + BSR 全 ∈[1..10] | category_current（榜单形态） |
| 无搜索排名 + BSR 存在 >10 | search_results（新格式 PS，确定性） |
| 无搜索排名 + 无 BSR 行数据 | unknown（requires_row_signal）→ 人工选择 |
| 缺身份列/歧义列/无签名 | fail-closed（unsupported_sheet / missing_report_signature 等）→ 人工选择 |

## 问题 2：点击「开始研究」约 20 秒体感慢

### 真实延迟分解（真实 AI，deepseek-v4-flash，John Boos 砧板）

| 阶段 | 串行实测 | 说明 |
|---|---|---|
| sourcing（货源判断） | 27.3s | AI 延迟波动大（另次实测 8.9s） |
| risk（风险排查） | 8.7s | |
| summary（小白结论） | 15.3s | 依赖 sourcing+risk |
| **合计** | **51.2s** | 串行 await |
| 并行 sourcing‖risk | 14.3s | |
| summary（并行后） | 6.7s | |
| **并行合计** | **21.0s** | 省 ~59% |

### 修改

- `app/api/workflows/product-analysis/route.ts`：sourcing 与 risk 无数据依赖（均只依赖商品名+描述）→ `Promise.all` 并行；summary 仍等待两者；provider 调用计数改为每步独立跟踪（`sourcingCallStarted`/`riskCallStarted`），保持 costGuard 语义（串行：启动调用且步骤 completed → providerCallsCompleted+1）。
- `AgentRunClient.tsx`（渐进式 UI）：running 状态显示「AI 分析进行中（通常 10–30 秒，视 AI 服务响应而定）。正在并行分析货源判断与风险排查，随后生成综合结论；完成后自动展示结果。请勿关闭页面或重复点击。」（`data-testid="agent-run-progress-hint"`）
- 保留：real AI gate、demo quota（product-journey 按 plannedAiCalls 预留，并行不改调用次数）、Evidence 绑定、run trace、fail-closed；防重复点击（isRunning guard 已有）、失败可重试（failed→重新开始已有）、离开恢复（cache restore 已有）。

### 优化前后对比（真实页面 Smoke C）

| 时间点 | 实测 |
|---|---|
| 点击「开始商品研究」→ UI 首次响应 | <1s（研究中徽章 + 进度提示立即出现） |
| → AI 内容完成（进度提示消失） | ~21s（并行；串行实测 51.2s） |
| provider 本身不可控延迟 | 存在：deepseek-v4-flash 单步 8.9s–27.3s 波动（reasoning 模型）；并行后总耗时随最慢步骤波动 |

## 问题 3：「待研究」商品点「开始研究」提示「无待研究商品」

### 根因

- SellerSprite ProductBatch 候选的 eligibility = `runtime_validation_required`（允许研究，进入研究时服务端再校验来源；candidateResearchEligibility.ts）。
- 前端两处只认 `research_available`：
  - `candidatePrimaryHref`（lib/candidateResearchPool.ts）：runtime_validation_required → null（列表不显示「开始／继续研究」）
  - `CandidatePoolView.startSelected`：只找 `researchAction === "research_available"` → 批量「开始研究」报「已选项中无待研究商品」
- UI「待研究」标签来自 `STATUS_LABEL[status]`（status=worth_analyzing），与 researchAction 是两套语义——页面标签说「待研究」，入口判断说「不能研究」，不一致。

### 修改（唯一权威判断）

- `lib/candidateResearchPool.ts`：新增 `isCandidateResearchActionAvailable(item)`（research_available 或 runtime_validation_required），并让 `candidatePrimaryHref` 对 runtime_validation_required 也返回研究页 href。**一切「开始／继续研究」入口复用 `candidatePrimaryHref !== null` / `isCandidateResearchActionAvailable`，不再各自写 status/researchAction 判断。**
- `CandidatePoolView.startSelected`：改为 `selectedIds.includes(item.id) && candidatePrimaryHref(item) !== null`；报错文案改为「已选项中没有可开始研究的商品（已转任务或当前不满足研究条件），请重新选择。」
- 服务端 eligibility 与状态流转未改（runtime_validation_required 允许进入研究，研究页 research-context 服务端再次校验来源；失败恢复/成功一致性由既有链路保证）。

## Smoke 结果（本地 3005 真实页面）

- **Smoke A**：上传 Products(10)-US-20260814.xlsx → 自动识别「搜索结果报表」+「厨房与餐厨」→ 导入 10 个商品成功
- **Smoke B**：研究池勾选「待研究」John Boos → 点「开始研究」→ 跳转研究页（不再报错）；列表显示「开始／继续研究」链接
- **Smoke C**：点击后 <1s 出现研究中状态与进度提示；~21s AI 完成并自动展示结果
- **Smoke D**：刷新 → 「已恢复上次分析结果」（不重复 AI 调用）；DB 任务数不变（4，无重复任务）
- **Smoke E**：研究页显示结论/风险/下一步；新手五问完整版在任务详情 Evidence Workbench（人工验收已 PASS）

## 工程验证

- targeted tests：candidateResearchPool / CandidatePoolView / ProductBatchManager / golden Replay / dualReportTypes / marketSignalRanking / precheck / workflow route(quota/run-proof) / AgentRunClient 全部通过
- 全量：4519 passed / 0 failed（main 串行全量）
- tsc / lint / build：PASS

## 结论

**CORE_SMOKE_FIX_1 = PASS**
