# P1 Graph Skeleton — 冻结契约与执行计划（Wave 0）

- executionBatch：V4-FINAL-R2-P1-20260821-1900；authorityChecksum：`848bc4f0845ac87db713e85022360835a0bccb5d148b813082bb53f3534378e1`
- baseCommit：`53880c83fb25d7e266d6aa5abe0ce700347137c4`（v3.1.0，P0 已验证 clean）
- Lead：Integrator；本契约、Prisma schema/migration、package.json/lockfile、next.config.ts、公共类型、API 契约、最终合并与浏览器 E2E 由 Lead 独占。

## 0. 设计决策与理由（含 ADR 摘要）

| # | 决策 | 理由 | 依据 |
|---|---|---|---|
| D1 | LangGraph 冻结元组：@langchain/langgraph 1.4.12、@langchain/langgraph-checkpoint 1.1.5、@langchain/langgraph-checkpoint-sqlite 1.0.4、@langchain/core 1.2.9（--save-exact） | V4 spike 已按该元组 8/8 验证（checkpoint write/read、graphVersion 门禁）；与 TS/Next 16 兼容；SqliteSaver 提供 Checkpoint 持久化 | 05、spike 证据 g1–g5 |
| D2 | 运行状态业务记录 = 新增 Prisma 模型 `V4ResearchRun`（+ `V4SideEffectJournal`），一次性 additive migration | 与 Checkpoint 分离（书 17）；`agent_runs` 不存在（P0 verified）；taskResultJson 是 Task 行的严格 writer 所有权机制，为 fake run 引入新命名空间会耦合 Task 创建流且需改 mutationBoundary | 17、P0 报告 |
| D3 | Checkpoint = SqliteSaver 独立 DB（`.tmp/v4-graph/checkpoints-<runId>.db`，gitignored；测试用 mkdtemp），只存控制流，不存业务记录 | 05「Checkpoint 只用于恢复控制流」；`.tmp/` 已 gitignored | 05、.gitignore |
| D4 | Feature flag：`QX_V4_GRAPH_ENABLED`（env，1/true 开启，默认关）；服务端 `lib/v4/featureFlag.ts` 统一判定；flag 关闭时 API 404、页面占位、Graph 代码不参与 V3.1 路径 | 与现有 `QX_RUNTIME_MODE` 约定一致；17「关闭 feature flags 可回到稳定 V3.1」 | AGENTS.md、17 |
| D5 | 运行 id：cuid()（仓库惯例），不采用 book schema 的 uuid 字面格式（JSON schema 的 format:uuid 为提示性约束，以仓库 id 惯例为准，契约内注明偏差） | 全仓模型均 cuid | schema.prisma |
| D6 | 状态/事件：`stateJson` 严格按 book `research-run-state.schema.json`（schemaVersion researchRun.v4）+ `eventsJson` 结构化事件（node/type/seq/payload，**不含模型思维链**）；graphVersion = `research-graph.v4.1` 存业务行，resume 时比对，mismatch fail_closed（spike 关键发现：SqliteSaver 不持久化自定义 configurable） | spike gv-gate 8/8 | 05、17 |
| D7 | 幂等：`V4SideEffectJournal` UNIQUE(runId, idempotencyKey)；fake tool 副作用 idempotencyKey = sha256(runId + questionId + toolName + inputHash)；重复→skipped_duplicate，不重放 | 书 11/17；spike g4 | 11 |
| D8 | next.config.ts 增加 `serverExternalPackages: ["better-sqlite3"]` | better-sqlite3 为原生模块，Next 16 webpack 需 external | 实测约定 |
| D9 | 公共 API（flag 门禁 + requireAuthenticated + owner/demo 沙箱）：POST /api/v4/runs；GET /api/v4/runs；GET /api/v4/runs/[runId]；POST /api/v4/runs/[runId]/start；POST /api/v4/runs/[runId]/resume；POST /api/v4/runs/[runId]/cancel；GET /api/v4/runs/[runId]/events。revision 冲突→409 返回最新 revision | P1 卡「expectedRevision 冲突返回最新 revision」 | P1 卡 |

## 1. 数据模型（Lead 独占，additive）

```prisma
model V4ResearchRun {
  id                          String   @id @default(cuid())
  candidateId                 String
  ownerScope                  String
  sandboxId                   String?
  mode                        String   @default("local_live")
  graphVersion                String   @default("research-graph.v4.1")
  status                      String   @default("draft")
  currentNode                 String   @default("load_context")
  revision                    Int      @default(0)
  planRevision                Int      @default(0)
  automaticPlanRevisionCount  Int      @default(0)
  stateJson                   String
  eventsJson                  String   @default("[]")
  createdAt                   DateTime @default(now())
  updatedAt                   DateTime @updatedAt

  @@index([candidateId])
  @@index([ownerScope, sandboxId])
  @@index([status, updatedAt])
}

model V4SideEffectJournal {
  id             String   @id @default(cuid())
  runId          String
  idempotencyKey String
  inputHash      String
  action         String
  status         String   @default("recorded")
  detailJson     String   @default("{}")
  createdAt      DateTime @default(now())

  @@unique([runId, idempotencyKey])
  @@index([runId])
}
```

迁移：`prisma migrate dev --name add_v4_research_run --create-only` 生成 SQL（仅 CREATE TABLE ×2）→ 审阅 → `prisma migrate deploy` 应用（dev.db additive）→ `prisma generate`。

## 2. Graph 节点与状态（P1 子集，严格按 05 与 run-state schema）

load_context → validate_identity → assess_gaps → build_plan → [计划审核 interrupt] → dispatch_tool(fake) → validate_output → merge_evidence → detect_conflicts → (revise_plan ≤2 或继续) → synthesize_market → gate_a [interrupt] → supplier_research(fake) → product_fact_gate [interrupt] → commercial_check(fake 确定性) → gate_b [interrupt] → content_handoff → content_skills(fake) → content_review [interrupt] → complete

- 中断（LangGraph interrupt()）：计划审核、Gate A、Fact Gate、Gate B、内容审核 = 5 个 waiting_human；等待登录→waiting_auth（P1 fake 不触发，状态保留）；预算耗尽→paused_budget；错误→failed_recoverable/failed_terminal；取消→cancelled（不可再写）。
- 自动修订：同一问题 ≤2 次；同一工具连续失败 2 次暂停；rationale 存结构化事件，不存 CoT。
- resume 门禁：candidate 身份/factRevision/预算/登录态重校验；graphVersion 比对 fail_closed；expectedRevision 冲突→409+最新 revision。

## 3. Domain adapter（复用，不复制业务对象）

- `lib/v4/domain.ts`：load_context 读取现有候选/任务/Evidence（productResearchRecord、candidateEvidence、taskResultJson 命名空间只读），输出候选上下文快照；不写 V3.1 业务记录（除本 run 行）。
- fake tools：确定性（inputHash→固定结果表），覆盖 plan/question/tool/validate/evidence/merge/conflict/feasibility/content 节点；零真实网络/浏览器/LLM。

## 4. 文件所有权（写入路径零重叠）

| Owner | 路径 |
|---|---|
| Lead | docs/v4/*（含本契约、P1 报告）、prisma/schema.prisma、prisma/migrations/*、package.json、package-lock.json、next.config.ts、lib/v4/contracts.ts、lib/v4/featureFlag.ts、app/api/v4/*（API 契约实现） |
| Implementer A（worktree `codex/v4-p1-graph`） | lib/v4/graph.ts、lib/v4/domain.ts、lib/v4/fakeTools.ts、lib/v4/journal.ts、lib/v4/checkpoint.ts、lib/v4/*.test.ts |
| Implementer B（worktree `codex/v4-p1-ui`） | app/v4/runs/**（页面）、components/v4/**（Run Console）、对应 UI 测试 |
| 第 3 子 Agent（只读） | 恢复/幂等测试设计评审（产出 findings，不写文件） |

A/B 不触碰对方路径、不触碰 Lead 路径、不触碰 V3.1 既有文件；不 push、不部署、不调用真实 Provider/Browser/LLM。

## 5. 必测场景（P1 卡，Gate 全过后才可收口）

1. happy path draft→completed；2. Gate A/B/Fact/Content 四处等待+刷新恢复；3. 运行中取消→取消后不可继续写入；4. 同 idempotency key 同输入不重复副作用、不同输入冲突；5. expectedRevision 冲突→409 返回最新 revision；6. 进程中断恢复不重复 Evidence；7. flag 关闭 V3.1 全量回归通过；8. 真实浏览器 E2E 完成一条 fake workflow（截图/记录，E2E_EVIDENCE_TEMPLATE）。

## 6. 执行顺序

1. Lead：本契约入库（docs/v4/P1_CONTRACT.md）。2. Lead：prisma schema+migration+generate，跑回归。3. Lead：npm install 冻结元组 + next.config.ts，跑 lint/test/build 回归（flag off）。4. Lead：建 worktree 分支。5. Wave 1：A、B 并行实现；第 3 子 Agent 只读评审。6. Lead：逐个合并、补公共接线（API 路由）、全量门禁。7. Lead：真实浏览器 E2E + TASK_REPORT。8. Gate 判定，PASS→P2，否则停止。
