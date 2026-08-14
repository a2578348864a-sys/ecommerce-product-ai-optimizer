# Phase 2 任务分解 — 商品证据工作台

> 规格来源：docs/v3/changes/phase-2/{evidence-read-model,competitor-evidence-contract,proposal}.md、11_PHASE2_TASK.md、30 增强 Phase 2、novice-comprehension seed。

## B1（Backend）竞品 Evidence 写入链

- `lib/server/competitorEvidence.ts`：`competitor-evidence.v1` schema 校验（parse/normalize）、`mutateCompetitorEvidence`（add/remove/list，上限 5、ASIN 规范化去重、expectedStorageVersion 乐观并发、actor 记录）
- `lib/server/taskResultJsonMutation.ts`：writer 类型增 `"competitor-evidence"`，OWNED_NAMESPACES 增 `["competitorEvidence"]`
- `app/api/tasks/[id]/competitor-evidence/route.ts`：GET（投影列表）/ POST（添加单条）/ DELETE（删除单条）；requireAuthenticated + 主体校验（owner/demo 分流由 mutateTaskResultJson 现有机制承担）
- 测试：写入（上限/去重/格式非法/并发 conflict）、读取（空/正常/非法 schema fail-soft）

## B2（Backend）provenance 读取投影字段

- 读取模型投影（lib 侧，如 productResearchPublicDto 相关模块或新 lib/evidence 读取模块）：商品概览字段带 sourceType/reportType/artifactHash(sourceFileSha256)/rowRef(ordinal)/parserVersion/capturedAt/dataPeriod 或 observedAt（可用处）；不可用标 null，不伪造
- 服务端测试：投影字段存在性与语义（capturedAt≠dataPeriod 不混淆）

## U1（UI）研究页/任务详情 Evidence Workbench 展示

- 区域：商品概览（image/asin/title/brand/category/price/rating/review/bsr/estimated sales/revenue/source/capturedAt）、市场 Evidence、竞品 Evidence、关键词 Evidence、货源 Evidence、Missing
- metricNature 角标（snapshot/estimate/derived/unknown）；estimate 强制「第三方估算」标注
- 信息层级（Novice Comprehension）：简明结论首屏（知道什么/不知道什么/支持信号/风险冲突/下一步补什么证据）→ 为什么这么说 → 原始 Evidence 展开（来源/时间/EvidenceRef/数据性质/原始值）
- score 展示：标注「参考/旧兼容排序信号」，不作首屏权威信号（风险 #15）
- 竞品维护 UI（添加/删除/上限 5/去重提示，调 B2 API）
- 货源区域：Core 阶段显示「未收集」+ 研究 sourcing 步骤 AI 建议（ai_hypothesis 标注）
- 测试：区域渲染（空/有数据）、角标、score 标注、竞品交互

## U2（UI）Novice Comprehension 自评

- 按 seed README 五问（知道什么/不知道什么/最大风险/为什么/下一步）对首屏做静态自评（测试断言首屏文本包含五要素对应区块）
- 结果入 validation.md

## V（验证收口）

- 真 Candidate 数据路径验证（本地 3005 或测试数据）
- 全量 lint/tsc/test/build；串行全量测试
- 规格对账、双审、三视角、风险 #1/#6/#7/#11/#12/#14/#15 评估记录
- `PHASE_2 = PASS`
