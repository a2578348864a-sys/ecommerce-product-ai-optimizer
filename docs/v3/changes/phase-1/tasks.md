# Phase 1 任务分解 — Product Search 识别稳定化

> 开发在 Pipeline worktree（codex/pipeline-phase1）执行；只允许修改 proposal.md §2 列出的路径。

## T1 现状阅读（主 Agent/开发 Agent）

- 读 `lib/upstream/sellersprite/reportType.ts`（现判定逻辑与证据结构）、`precheck.ts`、`xlsx.ts`、`previewXlsx.ts`、`fields.ts`、`canonical.ts`、`projections.ts`、`marketSnapshot.ts`、`marketSignalRanking.ts`、`dualReportTypes.test.ts`、`previewTestFixtures.ts`、fixtures（category-current.sanitized.v1.ts、search-export.sanitized.v1.ts）
- 输出：现状判定路径图（哪一步可能把缺 searchRank 的 PS 静默判为 CC）、现有测试覆盖缺口

## T2 Golden Dataset 建立

- 新建 `lib/upstream/sellersprite/golden/`：
  - `goldenReportCases.ts`（用例清单：id、名称、fixture 引用、预期 reportType、预期 fail-closed 与否、原因断言）
  - fixtures：基于现有 sanitized 样本派生最小脱敏用例（PS 正例含 searchRank / PS 变体缺 searchRank / CC 正例 / 表头重叠歧义 / 缺关键字段 / 未知表），**不引入真实业务数据**
  - expected values：少量人工核验字段（reportType 判定 + 关键字段解析结果）
- 验收：每个用例有明确预期；歧义/缺字段用例预期 = fail-closed 或 unknown

## T3 Parser Replay 测试套件

- 新建 `lib/upstream/sellersprite/golden/goldenReplay.test.ts`：
  - 遍历全部用例 → 调 detectSellerSpriteReportType + precheck + 解析 → 断言 reportType / fail-closed 行为 / 关键字段
  - 断言「歧义样本仍 fail-closed」「未知表 → unknown + 原因」
  - deterministic：同输入两次运行结果一致
- 验收：`npm test` 自动包含；修改 reportType/precheck/fields/parser 后重跑全绿

## T4 searchRank 缺失静默误判修复（核心）

- 现状缺陷：缺 searchRank 的 Product Search 样本可能被静默判为 Category Current（或反之）
- 修复：三层判断落地
  1. 表头强特征（确定性，如 BSR 类列组合与 searchRank 类列组合互斥时）
  2. 行级信号（双样本验证，如 searchRank 数值分布、无 BSR 列但存在 searchRank 列）
  3. 歧义 → fail-closed（unknown + 明确原因 code，如 `ambiguous_header_signals` / `missing_report_signature`）
- 禁止回归：现有 search_results/category_current 正例仍正确；dualReportTypes 测试不破坏
- 验收：缺 searchRank 的 PS 样本不再静默判为 CC；歧义样本 fail-closed

## T5 Category Current 反向误判防护

- CC 样本不得被误判为 PS（无 searchRank 列但有 BSR 四件套特征时仍判 CC）
- 验收：golden CC 正例 + 变体全过

## T6 历史误分类只读审计

- 只读脚本/查询（不改库）：按现有解析结果统计误分类候选（Owner Prisma ProductBatch.reportType + OpportunityCandidate sourceMeta + sandbox 候选）
- 输出：聚合数量、原因分布、受影响 ID 清单（不打印业务行）
- 验收：审计完成，结果入 validation.md 附录；发现真实误分类时登记不自动修

## T7 全量验证

- worktree 内：定向测试 → `npm test` → `npx tsc --noEmit` → `npm run lint` → build（如可行）
- 集成树：门禁后集成 main → main 全量验证 → 本地 smoke（3005 状态恢复确认）

## T8 规格对账 + 收口

- 规格对账（缺做/多做/做偏/合理偏离/无法验证）
- learnings.md（5–10 条，SellerSprite 相关必载）
- 双重审查 + 三视角终审
- `PHASE_1 = PASS`，继续 Phase 2
