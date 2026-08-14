# Phase 1 验证与验收 — Product Search 识别稳定化

> 按 10_PHASE1_TASK.md Gate + 30 增强 Phase 1 验收 + 21_VALIDATION_GATES 填写。阶段末更新。

## 1. Gate 对照（10_PHASE1_TASK.md）

| Gate | 状态 | 证据 |
|---|---|---|
| Product Search 正确 | PASS | golden 用例 ps-legacy/ps-partial-category 通过；真实 Products(10) 不再静默误判（见下） |
| 缺 searchRank 不静默误判 | PASS | 真实 Products(10)：自动判定 `unknown(ambiguous_ps_without_search_rank)`（修复前判 category_current）；golden 用例 ps-no-search-rank 断言 |
| Category Current 不反向误判 | PASS | 真实 12/12 BSR(...Current) 文件自动判定 category_current；golden 用例 cc-current/cc-with-ties 通过 |
| unknown fail-closed | PASS | golden 用例 cc-headers-only(requires_row_signal)/unsigned/missing-identity 断言 fail-closed + reasonCode |
| 历史审计完成 | PASS | 见附录：本地库 0 批次、12 候选均为旧导入链 Search Results 语义，无真实误分类需修正 |
| lint/tsc/test/build/local smoke 通过 | 待填 | lint PASS、tsc PASS、test 待全量确认、build/smoke 见下 |

## 2. 30 增强验收（Golden Dataset + Parser Replay）

| 验收 | 状态 | 证据 |
|---|---|---|
| 不能只证明"新样本能过"（旧样本不退化） | PASS | 全量 SellerSprite 相关测试 324 通过（含既有 dualReportTypes/marketSignalRanking/CLI/批次导入）；全部既有显式 expected 用例保持通过 |
| 歧义样本仍 fail-closed / 人工确认 | PASS | golden 歧义用例全部 unknown + reasonCode；显式选择仅在证据不足时放行，与强证据冲突时 report_type_mismatch 拒绝 |
| 输出 deterministic replay 结果 | PASS | goldenReplay 每个用例双跑断言 toEqual 一致 |
| 真实 XLSX 不入 Git | PASS | 仓库内 `**/*.xlsx` 0 命中；golden fixtures 全脱敏（GOLDEN/SANITIZED 前缀） |

## 3. 真实样本端到端验证（只读，材料根 XLSX案例 目录）

| 样本 | 自动判定 | 修复前后对比 |
|---|---|---|
| Products(10)-US-20260814.xlsx（PS 新格式，无搜索排名列） | unknown(ambiguous_ps_without_search_rank) | 修复前：静默判 category_current（误判）；修复后：fail-closed，人工可显式选择 |
| BSR(...Current) × 12（CC 新格式，表头与 PS 相同） | category_current（12/12） | 行级信号（大类 BSR 值域 [1..10]）判定 |
| 备注 | 全部 CC 样本第 12 行存在缺必需值（真实尾部瑕疵行），precheck 行级隔离为 rejected，不影响判定 | — |

## 4. 双重审查

- 第一关 规格符合度（漏做/多做/做偏/可验证）：
  - 漏做：无（三层判断、Golden Dataset、Replay、审计、显式选择覆盖全部落地）
  - 多做：无（未触碰 lib/server/**、app/api/**、prisma、页面、package.json；sellerSpritePreview* 例外未启用）
  - 做偏：一处语义澄清——「显式选择」仅在自动判定证据不足时放行，与强证据冲突时拒绝（report_type_mismatch），比最初「结构合法即放行」更严格、更符合任务书 fail-closed 精神
  - 可验证：全部 golden 用例 + 真实样本端到端可复现
- 第二关 工程质量（回归/安全/兼容/数据完整性/可维护性）：
  - 回归：既有显式 expected 用例全部保持通过；仅 2 处旧合成 CC fixture 用例更新为真实形态（fixture 本身从"PS 表头减一列"的错误合成修正为真实 72 列形态）
  - 安全：不新增解析入口；行级信号只读；无网络、无写库
  - 兼容：detect 签名向后兼容（rows 可选）；reasonCode 为新增可选字段；precheck result 新增可选字段
  - 数据完整性：真实样本验证只读，未写 dev.db；审计只读聚合

## 5. 规格对账

- 缺做：无
- 多做：无（未超出 10_PHASE1_TASK + 30 增强范围）
- 做偏：见 §4 第一关（显式选择冲突语义收紧）
- 合理设计偏离（说明）：precheck 显式 expectedReportType 的匹配从「自动检测结果比对」改为「结构合法性 + 强证据冲突检查」——因真实 PS/CC 表头完全相同，自动检测在无搜索排名时无法给出确定性结果，旧比对语义会让真实 PS 报表在人工选择场景也无法导入（做偏的合理化理由）
- 无法验证：无

## 6. 三视角终审

- 产品视角：新手/人工兜底链路（unknown → 人工选择）在批次导入 UI 已有（inspectSellerSpriteProductBatch 返回 reportTypeDetected=false），修复后自动接入；不偏离 Evidence Workbench
- 工程视角：无重复体系；Golden Dataset 最小化（3 个 fixture 文件 + 用例 + replay）；真实样本不入库
- 验收视角：真实双样本（1 PS + 12 CC）端到端全过；golden replay deterministic

## 7. 结论

`PHASE_1 = PASS`（待全量验证与集成后确认）

---

## 附录：历史误分类只读审计结果（T6）

- 执行方式：只读 Prisma 查询（集成树 .tmp 脚本，DATABASE_URL=file:./dev.db，未写库、未打印业务行）
- ProductBatch.reportType 分布：**0 条**（本地库无批次历史）
- OpportunityCandidate.sourceMeta 类型分布：12 条，全部 `SellerSprite|sellersprite_xlsx|SellerSprite Search Results`（旧 sellersprite-import 链硬编码语义，即已知缺口 #4，非误分类）
- 误分类结论：**无真实历史误分类需修正**；修复后新导入的自动判定路径不再产生静默误判
- 遗留：12 条旧候选的 sourceMeta 中 reportType 硬编码 Search Results 属缺口 #4（lib/server，Phase 1 禁改），Phase 2/6 评估

