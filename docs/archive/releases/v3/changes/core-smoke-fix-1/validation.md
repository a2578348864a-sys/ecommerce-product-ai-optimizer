# Core-Smoke-Fix.1 — validation（含独立复核）

## 问题 1 验证（复核后终态）

### 结构同构性（第一性分析，材料根只读）

- 12/12 CC（BSR(...Current)）+ 1/1 PS（Products(10)）真实样本：**表头完全相同（72 列）**、
  US/Brands/Sellers/Note 四工作表、无搜索排名列——CC 与 PS 新格式在结构上**不可区分**。

### 多信号分布（12 CC + 1 PS）

| 信号 | CC | PS | 级别 |
|---|---|---|---|
| 大类 BSR 值域 | 1..10（12/12） | 1,270..750,682 | supporting（Top100/加载更多可 >10 → 非合同） |
| 大类目唯一数 | 1（10/12）或 2（2/12） | 3 | supporting |
| 月销量 | 3,851..467,907 | 1..3,107 | supporting |
| Best Seller 标识 | 7–10/11 行 | 0/10 | supporting |
| 搜索排名列 | 无（12/12） | 无 | —（CC/PS 均无；旧 PS 格式有 → deterministic） |

### 自动判定（复核后）

- 搜索排名列 → search_results（deterministic，唯一结构信号）
- 无搜索排名（BSR 任意值域）→ **一律 unknown**（ambiguous_ps_without_search_rank / requires_row_signal）→ 人工选择
- BSR 值域不参与 reportType 判定（仅辅助建议）

### 真实样本 inspect 实测（复核后）

| 文件 | reportType | detected | 辅助建议 |
|---|---|---|---|
| Products(10)（PS） | unknown | false | suggestion=search_results（0 榜单信号：BSR 大值域/跨类目/低月销/无 BestSeller） |
| BSR(厨房和餐厅)（CC） | unknown | false | suggestion=category_current（3 信号：BSR 榜形态 + 月销高 + BestSeller 多） |
| BSR(Beauty)（CC） | unknown | false | suggestion=category_current（4 信号） |
| BSR(Electronics)（CC） | unknown | false | suggestion=category_current（4 信号） |

### Golden Replay（含对抗样本）

- `cc-bsr-beyond-band`（CC Top100 对抗：单类目、BSR 11..100 >10、月销高、Best Seller 多）→ 自动 unknown，**不因 BSR>10 判 PS**；显式 category_current 放行（matched=true，无 mismatch）
- `ps-no-search-rank` / `cc-current` / `cc-with-ties` → 自动 unknown（fail-closed）
- `ps-no-search-rank-explicit` / `cc-explicit-conflict` → 显式选择结构合法即放行（无确定性结构信号 → 不再 mismatch）
- `cc-headers-only`（requires_row_signal）/ `unsigned` / `missing-identity` → fail-closed（不变）
- `ps-legacy`（含搜索排名）→ search_results（deterministic，不变）
- 确定性：同输入两次运行结果一致

### 页面 Smoke A（复核后重测）

- 上传 Products(10) → 「无法可靠识别报表类型，请手动选择」+「检测建议：更像「搜索结果报表」（行级特征不足）」+ 不预选
- 上传 BSR(厨房和餐厅) → 「检测建议：更像「类目商品报表」（大类 BSR 值域呈榜单形态（1..10）、月销量中位数高（≥10,000）、多数行带 Best Seller 标识）」+「建议仅供参考，请以报表实际内容为准」

## 问题 2 验证（保持 PASS，未重构）

- 延迟分解（真实 AI）：串行 sourcing=27268ms + risk=8685ms + summary=15257ms = 51210ms；并行 sourcing‖risk=14329ms + summary=6657ms = 20986ms（省 59%）
- 页面 Smoke C：点击 <1s UI 响应（研究中 + 并行进度提示）；~21s AI 完成自动展示
- provider 不可控延迟：deepseek-v4-flash 单步 8.9–27.3s 波动

## 问题 3 验证（保持 PASS，未重构）

- 根因复现：John Boos（ProductBatch）status=worth_analyzing（UI「待研究」）+ researchAction=runtime_validation_required；修复前 candidatePrimaryHref 返回 null、startSelected 只认 research_available
- 修复后：列表显示「开始／继续研究」链接；批量「开始研究」跳转研究页（无报错）
- 唯一权威判断：`candidatePrimaryHref`（含 runtime_validation_required）+ `isCandidateResearchActionAvailable`

## Visitor 最小 Smoke（复核新增）

| 步骤 | 结果 |
|---|---|
| 访客码登录 | PASS（访客体验模式，配额显示 0/5 · Listing 3 次 · 生图 3 张） |
| 研究池 | PASS（「研究池还没有商品」——Owner 的 John Boos/B00063QBL8 等候选**未串读**） |
| 发现商品导入 Products(10) | PASS（10 商品，访客配额 0/5 未占用；manual + 建议提示正常） |
| 加入研究 → 研究页 | PASS（「批次：Kitchen & Dining · cutting board · 商品：B00063QBL8」；无「候选不存在」错误；「开始商品研究」按钮可用） |
| 真实 AI 调用 | 无额外调用（未点击「开始商品研究」；导入/研究页不触发 AI） |

## 工程验证

- targeted tests：golden Replay（含对抗样本）/ dualReportTypes / marketSignalRanking / precheck / productBatchImportService / dual-report CLI / ProductBatchManager / candidateResearchPool / CandidatePoolView / AgentRunClient 全部通过
- 全量：**4522 passed / 0 failed**（main 串行全量）
- tsc：0 错误；lint：0 错误；build：PASS

## 判定

- 原 CORE_SMOKE_FIX_1 = PASS 曾基于 BSR≤10 合同（已撤销）
- 复核后：**reportType 不依赖未经证实的 BSR≤10 全局假设**（无搜索排名一律 fail-closed，BSR 仅辅助建议）
- **CORE_SMOKE_FIX_1 = PASS（复核后恢复）**
