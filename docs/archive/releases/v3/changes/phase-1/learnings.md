# Phase 1 阶段学习（learnings.md）

> 依据 22_CHANGE_PACKAGE_AND_LEARNING.md：只沉淀有代码/测试/真实样本证据支持的条目。

1. **原假设**：现有 CC fixture（PS 表头去掉搜索排名）代表真实 Category Current 形态。
   **实测**：真实 2026-08-14 双样本（Products(10) + 12 个 BSR(...Current)）表头**完全相同**（72 列，均无「搜索排名」列）；旧 fixture 的「7天促销」等列在真实样本中为「秒杀」等——fixture 是旧导出格式的错误合成。
   **最终规则**：报告类型判定不得依赖「PS 表头 = CC 表头 - 搜索排名」假设；新格式下 PS/CC 表头无差异。
   **证据**：.tmp/probe-headers.ts（真实表头探测）；lib/upstream/sellersprite/fixtures/category-current.sanitized.v1.ts:3-4。
   **失效条件**：SellerSprite 导出配置变更。
   **下一阶段加载**：Phase 3/4（Reverse ASIN/Keyword Mining 表头差异同样需真实样本验证）。

2. **原假设**：缺 searchRank 的 Product Search 报表是边缘假设。
   **实测**：**当前真实 PS 样本（Products(10)）就没有搜索排名列**；修复前 precheck 自动判定会把它静默判为 category_current（四件套齐全）——静默误判是真实存在的缺陷。
   **最终规则**：无搜索排名列 + 四件套齐全时禁止自动判 CC；行级信号不足 → fail-closed（ambiguous_ps_without_search_rank）+ 人工选择兜底。
   **证据**：.tmp/probe-e2e.ts（修复前/后对比）；lib/upstream/sellersprite/reportType.ts:99-115。
   **失效条件**：—（修复目标本身）。
   **下一阶段加载**：Phase 1 门禁验收项。

3. **原假设**：Category Current 可以用「大类 BSR 升序」识别。
   **实测**：真实 CC 报表存在并列名次（健康与家居样本 BSR 序列 1,2,3,4,5,3,5,8,9,10），非严格升序；但 12/12 个 CC 样本的大类 BSR 值域全部 ∈ [1..10]（Top10 榜单），PS 样本 max=750682。
   **最终规则**：行级 CC 信号 = 大类 BSR 值域 ⊆ [1..10]（被真实双样本验证）；升序仅作辅助，不作硬条件。
   **证据**：.tmp/probe-bsr.ts、probe-all.ts、probe-anomaly.ts；reportType.ts:56-61。
   **失效条件**：未来 CC 导出非 Top10 榜单（值域超界 → 自动 fail-closed，人工选择可覆盖）。
   **下一阶段加载**：Phase 1 golden 用例 cc-with-ties。

4. **原假设**：人工显式选择报告类型时应验证「表头签名与选择一致」。
   **实测**：新格式 PS/CC 表头完全相同，表头签名无法验证选择；旧「检测结果比对」语义会让真实 PS 报表（detect unknown）在任何显式场景都被拒绝。
   **最终规则**：显式选择只在「自动判定证据不足」（requires_row_signal / ambiguous_ps_without_search_rank）时放行；与自动强证据冲突（detect 成功且不一致）时拒绝并报 report_type_mismatch；结构非法（缺身份/歧义列/无签名）永远拒绝。
   **证据**：lib/upstream/sellersprite/precheck.ts（matched 规则）；golden 用例 ps-no-search-rank-explicit / cc-explicit-conflict。
   **失效条件**：产品要求无条件的用户类型覆盖。
   **下一阶段加载**：Phase 1 验收；批次导入 UI 的人工选择链路。

5. **原假设**：真实 CC 报表行数据干净完整。
   **实测**：12/12 个真实 CC 样本的第 12 行（尾部行）缺必需值（ASIN 等），precheck 将其行级隔离（rejected），不影响报告类型判定。
   **最终规则**：报表尾部瑕疵行按行级隔离处理，不阻断判定与导入；不需要特判。
   **证据**：.tmp/probe-e2e.ts（missing_required_value@12）。
   **失效条件**：—。
   **下一阶段加载**：无需。

6. **原假设**：detect 签名变更会破坏既有调用方。
   **实测**：detect 增加可选 rows 参数 + 可选 reasonCode 字段，precheck/CLI/既有测试全部兼容（324 个 SellerSprite 相关测试通过，其中仅 2 处旧合成 CC fixture 用例按真实形态更新）。
   **最终规则**：API 演进优先可选参数/字段；fixture 必须基于真实形态而非推导。
   **证据**：git diff（worktree codex/pipeline-phase1）。
   **失效条件**：—。
   **下一阶段加载**：Phase 3/4 报告类型扩展时沿用。

7. **原假设**：全量测试失败 = 代码回归。
   **实测**：三次全量并行跑的失败集合各不相同（1/7/3 个），全部与 SellerSprite 无关（SQLite 临时目录 ENOTEMPTY、demoSandbox store 竞争、release 打包缺 .next/BUILD_ID），单独重跑均通过；集成树对照 release-package 通过（worktree 缺构建产物）。
   **最终规则**：Windows 并发全量测试存在已知抖动（项目体检报告问题 3）；判断回归必须「单独重跑失败文件 + 集成树对照」，不能只看一次全量结果。
   **证据**：pwsh-24/25/26/28 输出。
   **失效条件**：抖动被根治。
   **下一阶段加载**：每 Phase 门禁验证沿用。

8. **原假设**：真实 XLSX 必须能进测试才能验证解析。
   **实测**：仓库内 glob `**/*.xlsx` 0 命中；真实样本验证通过**只读探测脚本**（.tmp/，gitignore）完成——探测输出仅表头/聚合统计，不提交、不入库。
   **最终规则**：真实样本验证一律走 .tmp 只读脚本 + 聚合输出；Golden Dataset 只承载脱敏形态（统计模式保留：BSR 值域、并列、表头）。
   **证据**：.tmp/probe-*.ts；lib/upstream/sellersprite/golden/golden-fixtures.ts。
   **失效条件**：—。
   **下一阶段加载**：Phase 3/4（Reverse ASIN/Keyword Mining 真实样本同法验证）。

## 下一阶段是否需要加载

1/2/3/4 对 Phase 3/4 必载（新报告类型表头与行级信号需同样方法论）；6/7 对每 Phase 门禁验证必载；8 对 Phase 3/4 样本验证必载；5 无需。
