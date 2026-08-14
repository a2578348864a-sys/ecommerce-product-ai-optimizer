# Phase 1 提议 — Product Search 识别稳定化（含 Spec）

> 来源：`10_PHASE1_TASK.md`、`30_GITHUB_DERIVED_PHASE_ENHANCEMENTS.md`（Phase 1 增强）、`decisions.md §6`（Closeout 修正边界）、`learnings.md #5/#10`
> 状态：执行中

## 1. 目标

修复真实 Product Search 缺 searchRank 时被静默误判的风险；建立 Golden Dataset + Parser Replay 回归能力；三层判断 + fail-closed；历史误分类只读审计。达成 `PHASE_1 = PASS`。

## 2. 范围（Closeout 修正版）

**允许修改**：

- `lib/upstream/sellersprite/**`（reportType/precheck/fields/xlsx/previewXlsx/canonical/projections/marketSnapshot/marketSignalRanking/dualReportTypes 等）
- `tools/upstream/sellersprite-preview/**`（runner/ranking-report/render-markdown）
- `lib/upstream/contracts.ts`
- 上述模块的直接测试与 Golden Dataset fixture（最小、脱敏，不含真实业务敏感数据）
- 仅限 `docs/v3/changes/phase-1/` 的文档

**默认禁止修改 `lib/server/**`**：唯一例外为与 SellerSprite Preview 识别闭环直接相关的 `lib/server/sellerSpritePreview*`，需 Change Package 显式 allowlist + 必要性证明——**本轮不申请，保持禁止**。

**禁止**：`ASIN + title + url = Product Search` 式推断；`有 searchRank = PS，否则 BSR 四件套 = CC` 式二元推断；真实 XLSX 入 Git/提交；修改 `app/api/**`、`prisma/**`、页面、`package.json`/共享文件；改 dev.db；自动修历史数据；打印业务行。

## 3. Spec

### 3.1 三层判断（10_PHASE1_TASK.md）

1. **确定性表头特征**：报告级别（sheet 表头集合）的强特征，如 searchRank 类列 vs root/subCategory+BSR 类列（沿用现有 reportType.ts 判定方向，但需消除"缺 searchRank → 静默误判"路径）。
2. **行级信号**：被真实双样本（Product Search + Category Current）验证过的行内容信号。
3. **仍歧义 → fail-closed / 人工选择**：输出 `unknown` + 原因，禁止猜测。

### 3.2 Golden Dataset + Parser Replay（30 增强）

`lib/upstream/sellersprite/golden/` 下建立最小 Golden Dataset（真实 XLSX 不入 Git）：

| 用例 | 预期 |
|---|---|
| Product Search 正例（含 searchRank） | reportType=search_results，字段解析成功 |
| Category Current / BSR 正例 | reportType=category_current |
| 高度重叠表头歧义例 | fail-closed / 人工确认（不允许静默选型） |
| 缺关键字段例（如缺 searchRank） | **fail-closed（修复目标）**：不得静默判为 Category Current |
| 旧 Product Search 兼容例（旧格式变体） | 仍识别为 search_results |
| 未知/空表例 | unknown + 原因 |

Replay：`npm test` 覆盖（vitest 套件 `golden.*.test.ts`），任何对 reportType/precheck/fields/parser 的修改自动重跑；验收 = 新样本能过 + **旧样本不退化** + 歧义样本仍 fail-closed + 输出 deterministic。

### 3.3 历史误分类审计（只读）

- 只读扫描既有导入记录（Owner Prisma ProductBatch / OpportunityCandidate sourceMeta 与 sandbox 候选），按 reportType 判定结果聚合输出：误分类数量 + 原因分布 + 受影响 ID。
- 不修改 dev.db、不打印业务行、不自动修历史数据；结果写入 `docs/v3/changes/phase-1/validation.md` 附录。

## 4. 门禁（10_PHASE1_TASK.md + 30 增强）

- Product Search 正确（含缺 searchRank 样本不再静默误判）
- Category Current 不反向误判
- unknown fail-closed（歧义样本仍 fail-closed）
- Golden parser replay PASS（新样本过 + 旧样本不退化 + deterministic）
- 历史审计完成（聚合 + ID + 原因）
- lint / tsc / test / build / local smoke 通过
- 双重审查（规格符合度 → 工程质量）、规格对账、三视角终审

全部通过后：`PHASE_1 = PASS`，继续 Phase 2（auto_with_integration_gates）。
