# Core-Smoke-Fix.1 — validation

## 问题 1 验证

### 真实样本（材料根只读，不入 Git）

| 文件 | 修复前 | 修复后 |
|---|---|---|
| Products(10)-US-20260814.xlsx | reportType=unknown(ambiguous_ps_without_search_rank)，acceptedRows=0 | **reportType=search_results，acceptedRows=10**；BSR 值域 1,270–750,682（全 >10，证实判定依据）；类目 detected=Kitchen & Dining（8/9 多数派） |
| BSR(厨房和餐厅（当前的）)-10-US-20260814.xlsx | category_current | category_current（不反向误判）；BSR 1..10；类目 detected=Kitchen & Dining（9/10） |

### Golden Replay

- ps-no-search-rank / ps-no-search-rank-explicit：unknown → **search_results**（新断言）
- cc-current / cc-with-ties：category_current（不变）
- cc-headers-only / unsigned / missing-identity：fail-closed（不变）
- 确定性：同输入两次运行结果一致

### 关键保证

- 错误自动识别率优先：PS（BSR>10）与 CC（BSR≤10）值域互斥（CC 榜单不可能 >10），自动判定不会把 CC 误判为 PS；「排名都好的 PS 全 ≤10」仍可能判 CC（Phase 1 既有规则，未扩大）
- 显式选择冲突：自动判定成功且与显式选择不一致 → report_type_mismatch 拒绝（不静默接受与强证据冲突的人工选择）——marketSignalRanking/dualReportTypes 用例同步修正 fixture 语义（CC 行 BSR 改为榜单值）

## 问题 2 验证

### 延迟分解（真实 AI，deepseek-v4-flash）

- 串行：sourcing=27268ms + risk=8685ms + summary=15257ms = **51210ms**
- 并行：sourcing‖risk=14329ms + summary=6657ms = **20986ms**（省 59%）

### 页面 Smoke C（真实浏览器 3005）

- 点击「开始商品研究」→ <1s：研究中徽章 + 「AI 分析进行中（正在并行分析货源判断与风险排查…）」提示 + 按钮禁用态
- ~21s：进度提示消失，结果自动展示（等待人工确认徽章 + 三阶段状态）
- provider 不可控延迟：deepseek-v4-flash 单步 8.9–27.3s 波动（reasoning 模型），并行后总耗时随最慢步骤波动；已通过渐进式 UI 消除「系统卡死」体感，不伪造完成

## 问题 3 验证

### 根因复现

- John Boos 候选（ProductBatch 来源）：status=worth_analyzing（UI「待研究」）+ researchAction=runtime_validation_required
- 修复前 `candidatePrimaryHref` 返回 null（列表无「开始研究」链接）；`startSelected` 只认 research_available → 报「已选项中无待研究商品」

### 修复后页面（Smoke B）

- 研究池 John Boos「待研究」行显示「开始／继续研究」链接
- 勾选 → 点「开始研究」→ 跳转研究页（candidateId=baf43687…，批次 Kitchen & Dining · cutting board · B00063QBL8）
- 服务端 research-context 再次校验来源（runtime_validation_required 语义保持）；进入研究页正常

### 唯一权威判断

- `candidatePrimaryHref`（含 runtime_validation_required）+ `isCandidateResearchActionAvailable`；UI 不再各自写 status/researchAction 判断

## Smoke A–E（真实页面 3005，playwright）

| Smoke | 结果 |
|---|---|
| A 上传 PS 报表自动识别+导入 | PASS（自动识别报表类型+类目，导入 10 商品） |
| B 待研究商品开始研究 | PASS（无「无待研究商品」错误，跳转研究页） |
| C 三个时间点 | PASS（<1s UI 响应；~21s AI 完成） |
| D 刷新一致性 | PASS（恢复缓存不重复 AI；DB 任务数 4 不变，无重复任务） |
| E 新手五问 | PASS（研究页结论/风险/下一步；五问完整版在 Evidence Workbench，人工验收已 PASS） |

## Owner / Visitor 一致性

- Owner：真实页面全链路验证（本 Smoke）
- Visitor：研究池/候选访问控制与 sandbox 隔离由既有测试覆盖（route.access-control.test.ts、CandidatePoolView.test.ts、productResearchRecordStore 等），本轮未改动权限/隔离代码

## 重复任务 / 重复 AI 消耗

- 无：Smoke 全程任务数不变；cache restore 不触发 AI；workflow 仅按钮触发 1 次；demo product-journey 幂等（jobRequestId）保持

## 工程验证

- tests：4519 passed / 0 failed（main 串行全量）
- tsc：0 错误；lint：0 错误；build：PASS
