# P1 TASK_REPORT — Graph 骨架（V4-FINAL-R2）

- 判定：**PASS**（8/8 必测场景通过；B1 基线遗留测试失败为 v3.1.0 既有缺陷，单列用户决策，不影响 P1 门禁）
- executionBatch：V4-FINAL-R2-P1-20260821-1900；authorityChecksum：`848bc4f0…`
- 报告时间：2026-08-21 12:24:11 +08:00；集成 HEAD：`58fcb6a`（main，本地；未 push）
- 角色：Lead 冻结契约/迁移/API/集成/浏览器 E2E；A=Graph 实现；B=Run Console UI；C=只读恢复/幂等测试评审

## 原始目标与达成

| 目标 | 达成 | 证据 |
|---|---|---|
| feature flag 后单 Research Workflow 最小闭环 | ✅ | `QX_V4_GRAPH_ENABLED`；flag off → /api/v4/runs 404 + UI 占位；flag on → 全链路 |
| 确定性 fake tools，不接真实 Amazon/1688/LLM | ✅ | lib/v4/fakeTools.ts（inputHash→固定结果）；零真实调用（grep 无网络/浏览器/LLM 调用） |
| 状态持久化/中断/恢复/取消/revision/幂等 Journal | ✅ | runStore CAS + graphVersion 门禁 + SqliteSaver checkpoint 分离 + V4SideEffectJournal UNIQUE(runId,idempotencyKey) |
| Checkpoint 与业务记录分离 | ✅ | checkpoint=`.tmp/v4-graph/checkpoints-<runId>.db`（只存控制流）；业务=`V4ResearchRun` 行 |
| 5 个人工中断 | ✅ | PLAN_REVIEW、GATE_A、FACT_GATE、GATE_B、CONTENT_REVIEW（E2E 逐个点击通过） |
| UI 展示 run/计划/节点/预算/暂停/恢复/取消/错误 | ✅ | /v4/runs + /v4/runs/[runId]（B 交付 32 文件 + 41 测试） |
| 结构化事件，无 CoT | ✅ | eventsJson（seq 单调，type/node/payload）；无思维链字段 |

## 架构与关键决策（详见 docs/v4/P1_CONTRACT.md §0）

- D1 LangGraph 冻结元组 1.4.12/1.1.5/1.0.4/1.2.9（spike 验证过；--save-exact 入库）
- D2 新增 Prisma V4ResearchRun + V4SideEffectJournal（additive migration `20260821190000_add_v4_research_run`，SQL 仅 CREATE TABLE ×2 + 5 index；dev.db 已应用，无既有表变更）
- D3 checkpoint SqliteSaver 独立 DB（`.tmp/` gitignored）；E2E 发现目录缺失 → openCheckpoint 自动 mkdir（已修）
- D4 flag `QX_V4_GRAPH_ENABLED`（服务端）+ `NEXT_PUBLIC_QX_V4_GRAPH_ENABLED`（导航，构建期内联）
- D6 graphVersion=`research-graph.v4.1` 存业务行，resume fail_closed；E2E 发现 createRun 未持久化初始 stateJson → 已修（draft state 完整落库）
- D7 幂等：idempotencyKey=sha256(runId+questionId+toolName+inputHash)；重复→skipped_duplicate
- D9 API：POST/GET /api/v4/runs；GET [runId]；POST [runId]/start|resume|cancel；GET [runId]/events；409 REVISION_CONFLICT 携带 latestRevision；owner/demo 沙箱 fail-closed（错域 404）
- P1-C 评审 9 条裁定全部采纳（contracts §7；revision 单源、canonical inputHash、三方一致性、取消先 journal 后终态等）

## 修改文件（提交 6 个）

| commit | 内容 |
|---|---|
| b8cea7b | wave0：LangGraph 依赖 + Prisma schema/migration + next.config serverExternalPackages + P0 报告/P1 契约 docs |
| 2c29b3e | 公共契约 contracts.ts（researchRun.v4）+ featureFlag.ts |
| 6c55fdf | 合并 A(13 文件 lib/v4)+B(32 文件 app/v4+components/v4) |
| cc2fa6d | Lead API 路由 6 个 + apiHelpers + Sidebar 接线 |
| 57d305a/ddd8d3a | API 契约测试（11 个） |
| ad0f72c | 集成对齐：Sidebar 渲染期门控（冻结 nav 常量保留）、ProductBatch 守卫收窄、login-journey 陈旧断言对齐（基线缺陷） |
| 58fcb6a | E2E 集成修复：createRun draft state、checkpoint mkdir、预算统一 |

新增文件总数：lib/v4/ 15（contracts、featureFlag、graph、domain、fakeTools、journal、checkpoint、runStore、apiHelpers + 7 测试）、app/api/v4/ 8（6 路由 + 2 测试）、app/v4/ 4、components/v4/ 28。

## 必测场景 Gate（8/8）

| # | 场景 | 结果 | 证据 |
|---|---|---|---|
| 1 | happy path draft→completed | ✅ | 单测 graph.test + **浏览器 E2E**：创建 201→5 中断→已完成 |
| 2 | Gate A/B/Fact/Content 等待 + 刷新恢复 | ✅ | E2E 每门禁 UI 点击 + 刷新后状态保持（等待人工处理仍在） |
| 3 | 运行中取消；取消后不可写 | ✅ | E2E：cancel→200 cancelled；start→409 run_not_actionable；单测 TERMINAL_FROZEN |
| 4 | 同 idempotency key 同输入不重复；不同输入冲突 | ✅ | journal.test（skipped_duplicate/冲突） |
| 5 | expectedRevision 冲突→返回最新 revision | ✅ | E2E：resume(expected=0)→409 REVISION_CONFLICT latestRevision=4；单测同 |
| 6 | 进程/请求中断恢复，不重复 Evidence | ✅ | recovery.test（checkpoint 重建、journal 不重放、三方一致性） |
| 7 | flag off → V3.1 正常 | ✅ | 全量回归 5472 passed；/api/v4/runs→404；health 200；home 200 |
| 8 | 真实浏览器完成一条 fake workflow + 截图 | ✅ | 见 P1_E2E_EVIDENCE.md；截图存 `D:\Workspace\tmp\v4-p1-evidence\` |

## 实际命令与结果

| 命令 | 结果 |
|---|---|
| npx tsc --noEmit | exit 0（多次） |
| npm run lint | 0 error / 8 warnings（既有） |
| npx vitest run lib/v4 app/v4 components/v4 app/api/v4 | 22 files / 122 tests passed（最终） |
| npm test 全量 | 5472 passed / 1 failed（仅 B1 基线） / 78 skipped |
| npm run build（flag on） | 成功；/v4/runs 路由入产物 |
| 浏览器 E2E（playwright-cli + 3005 local_owner） | 全链路通过（见证据文档） |

## B1 基线缺陷（v3.1.0 既有，非本 Phase 引入）

1. `app/api/tasks/[id]/handoff.product-journey-quota.test.ts`：mock 缺 `approvedReferenceImageDataUrl`，route:369 直读 → TypeError（隔离复现，冻结 tag 上稳定失败）。待用户裁定（A=route 防御 / B=修 mock）。
2. `components/productUiPolish.test.ts` 登录旅程断言陈旧（断言 01 发现商品 等旧文案，实际 v3 发布文案为 01 导入真实数据…）——本 Phase 已对齐到发布文案（仅测试文案，零业务改动；冻结 tag 上复现确认属基线缺陷）。
3. P0 报告 B1 原记录 1 例，现更正为 2 例（补记 productUiPolish）。

## 回滚与恢复

- 业务代码全部在 flag 后；flag off = V3.1 原样（已回归验证）。
- dev.db 仅新增两张表（additive）；回滚=删除两表即可（未执行）。
- checkpoint DB 在 `.tmp/v4-graph/`，可整目录删除。
- 本地 3005 已恢复计划任务托管（flag off 默认），health 200。

## 遗留风险 / 下一步

- B1/B3/B4 用户决策项（P0 报告已列）；B1 需在后续全量回归前裁定。
- v4-p1-ui worktree 未使用（B 实际工作在 graph worktree，内容已合并），待清理 worktree。
- /v4/runs 仅桌面侧栏入口（NEXT_PUBLIC flag 内联），移动导航未加（V3.1 常量冻结约束）。
- P1 完成后按用户授权进入 **P2（市场研究 Skills）**。

## 工作区状态

- main=58fcb6a（本地，clean，未 push）；`git status --porcelain` 空；3005 运行中（flag off）。
- 证据目录：`D:\Workspace\tmp\v4-p1-evidence\`（截图 + snapshot + console）。
