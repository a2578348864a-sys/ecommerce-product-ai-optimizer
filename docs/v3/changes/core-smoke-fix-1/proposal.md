# Core-Smoke-Fix.1 — 人工 Smoke 缺陷修复（proposal）

> 范围：仅修复人工验收发现的 3 个真实问题。不启动 V3.x、不 push、不公网部署、不新增状态/Evidence 体系、不降低 fail-closed/安全/配额约束。
> **独立复核（2026-08-15）**：问题 2/3 保持 PASS；问题 1 的 BSR≤10 合同假设被撤销，改为「无搜索排名一律 fail-closed + 多信号辅助建议」，详见 `report-type-evidence-matrix.md`。

## 问题 1：SellerSprite 导入仍要求手动选报表类型和一级类目

### 根因（复核后终态）

- 无搜索排名列的 CC 与 PS 新格式报表**结构完全同构**（真实样本：72 列表头、四工作表、无搜索排名列），无 deterministic 结构差异。
- 上一轮将「CC BSR 必 ∈[1..10]」当作合同并推导「BSR>10 → PS」——该推导仅由 12 份真实样本支持，官方存在 Top100/Top400/加载更多导出场景（CC BSR 可 >10），**有限样本规律不得升级为永久报表合同** → 撤销。
- 一级类目自动识别（1B）与 1A 无关，保持：类目检测三态 + 自动填充 + UI 提示（仅当报表类型已知；manual 模式下类目同样人工选择）。

### 修改（复核后）

- `detectSellerSpriteReportType`：BSR 值域**不再参与判定**。无搜索排名 + 四件套齐全 → 一律 `unknown(ambiguous_ps_without_search_rank)`（有行数据）或 `requires_row_signal`（无行数据）；搜索排名列仍为唯一 deterministic 结构信号（→ search_results）；关键词表头签名 → 关键词管线。
- 新增多信号**辅助建议**（`buildSellerSpriteReportTypeHints`，纯提示非判定）：bandLikeBsr / singleRootCategory / hotSales / bestSellerMajority，≥3 → 建议 category_current；≤1 → 建议 search_results；2 → 无建议。基于 precheck rejectedRecords 原始行值计算（unknown 时 precheck 行全拒但 raw 保留）。
- UI：manual 模式显示「无法可靠识别报表类型，请手动选择」+「检测建议：更像…（信号理由）+ 建议仅供参考，请以报表实际内容为准」。
- Golden Replay 扩充：新增对抗样本 `cc-bsr-beyond-band`（CC Top100，BSR 11..100 >10）→ 自动 unknown（**不因 BSR>10 判 PS**）+ 显式 CC 放行；ps-no-search-rank / cc-current / cc-with-ties 全部改断言 fail-closed；cc-explicit-conflict 改为「无确定性结构信号 → 显式选择放行（不再 mismatch）」。

### 自动识别何时成功 / 何时人工 fallback（复核后）

| 输入特征 | 判定 |
|---|---|
| 含搜索排名列 | search_results（deterministic，旧格式） |
| Reverse ASIN / Keyword Mining 表头签名 | 关键词管线（deterministic） |
| 无搜索排名（BSR 任意值域，含 1..10 与 >10） | **一律 unknown → 人工选择**；UI 多信号建议仅供参考 |
| 缺身份列/歧义列/无签名/无行数据 | fail-closed（unsupported_sheet / missing_report_signature / requires_row_signal） |

## 问题 2：点击「开始研究」约 20 秒体感慢

（保持 PASS，未重构。摘要：sourcing‖risk 并行实测 51.2s→21.0s；渐进式 UI 点击 <1s 响应；计数按步独立跟踪。详见本文件上一版与本仓库 validation.md。）

## 问题 3：「待研究」商品点「开始研究」提示「无待研究商品」

（保持 PASS，未重构。摘要：ProductBatch 候选 researchAction=runtime_validation_required 未被前端入口接受；统一权威判断 `candidatePrimaryHref` / `isCandidateResearchActionAvailable`。详见本文件上一版与本仓库 validation.md。）

## Smoke 结果（本地 3005 真实页面）

- **Smoke A（复核后重测）**：上传 Products(10) → 「无法可靠识别报表类型，请手动选择」+ 建议「更像搜索结果报表」（0 榜单信号）；上传 BSR(厨房和餐厅) → 建议「更像类目商品报表」（3 信号：BSR 榜形态 + 月销高 + Best Seller 多）。均不预选类型。
- **Smoke B/C/D/E**：保持 PASS（问题 2/3 未改动；问题 3 入口验证通过）。
- **Visitor 最小 Smoke（复核新增）**：访客码登录 → 研究池为空（Owner 数据不串读）→ 发现商品导入 10 商品（访客配额显示）→ 加入研究 → 研究页状态正确（批次/商品正确、无「候选不存在」错误）→ 未点 AI 分析（无额外真实 AI 调用）。

## 工程验证

- targeted tests：golden Replay（含对抗样本）、dualReportTypes、marketSignalRanking、precheck、productBatchImportService、dual-report CLI、ProductBatchManager、candidateResearchPool、CandidatePoolView 全部通过
- 全量：4522 passed / 0 failed（main 串行全量）
- tsc / lint / build：PASS

## 结论

**CORE_SMOKE_FIX_1 = PASS**（复核后：reportType 不再依赖未经证实的 BSR≤10 全局假设）

