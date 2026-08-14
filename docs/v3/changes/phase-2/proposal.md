# Phase 2 提议 — 商品证据工作台（Evidence Workbench）

> 来源：`11_PHASE2_TASK.md`、`30_GITHUB_DERIVED_PHASE_ENHANCEMENTS.md`（Phase 2 增强）、`change-package-seeds/phase2-phase5-novice-comprehension/README.md`、`decisions.md §6/§7`
> 状态：执行中。第一步已完成：`evidence-read-model.md`（每个区域从哪里读）；竞品合同已冻结：`competitor-evidence-contract.md`。

## 1. 目标

不新增外部数据源，把已有数据统一成 Evidence Workbench：商品研究详情页展示 商品概览 / 市场 Evidence / 竞品 Evidence / 关键词 Evidence / 货源 Evidence / Missing 六大区域，Fact/Estimate/Derived/Unknown 清晰、来源可追溯、不用 AI 填空、无重复体系；满足 Novice Comprehension Gate。达成 `PHASE_2 = PASS`。

## 2. 范围

**Backend（codex/backend-phase2）**：

- `app/api/tasks/[id]/competitor-evidence/route.ts`（GET/POST/DELETE，人工添加，竞品合同）
- `lib/server/competitorEvidence.ts`（schema 校验 + mutate：上限 5、去重、格式、并发）
- `lib/server/taskResultJsonMutation.ts`：writer `competitor-evidence` + OWNED_NAMESPACES 增 `["competitorEvidence"]`（与既有 writer 契约一致）
- 相关测试
- provenance 读取投影所需的服务端字段（如 DTO 投影 dataPeriod/observedAt 语义，放 lib 读取模型层）

**UI（codex/ui-phase2）**：

- 商品研究详情页（`app/opportunity-candidates/[candidateId]/page.tsx` + AgentRunClient）与任务详情（`app/tasks/[id]/page.tsx` + TaskRecordDetail）的 Evidence Workbench 展示：
  - 信息层级：简明结论 → 为什么这么说 → 原始 Evidence（Novice Comprehension）
  - 六大区域（读取源见 evidence-read-model.md）
  - metricNature 角标（snapshot/estimate/derived/unknown）
  - score 标注「参考/旧兼容排序信号」（正式风险 #15；不得作首屏权威决策信号）
  - 竞品维护 UI（调用 backend API；上限 5 提示）
  - 来源可追溯展开（sourceRef/artifactHash/rowRef/capturedAt/dataPeriod 可用处）
- 展示投影模块（lib 非 server：productResearchPublicDto 类）及测试

**禁止**：新建 Prisma 表（05 门槛未达）；新增外部数据源；新增 AI 调用；改 research-decision 写合同（§2.1a）；碰 lib/upstream/sellersprite 解析链（Phase 1 稳定）；改共享文件；竞品做成第四套 Candidate/Task。

## 3. Gate（11_PHASE2_TASK.md）

- 真 Candidate 可打开（真实数据路径验证）
- Fact/Estimate/Derived/Unknown 清楚（UI 角标 + 投影）
- 来源可追溯（provenance 最小字段可用处展示）
- 不用 AI 填空（Missing 区域恒 unknown/ai_hypothesis 标注）
- 无重复体系（复用现有 namespace/投影；竞品唯一新 namespace）
- Novice Comprehension Gate 自评（首屏五问可答）
- 正式风险 #1/#6/#7/#11/#12/#14/#15 本阶段评估记录
- lint/tsc/test/build/local smoke 通过

## 4. 产出

- `evidence-read-model.md`（已完成）
- `competitor-evidence-contract.md`（已完成）
- proposal.md（本文件）、tasks.md、validation.md、learnings.md
