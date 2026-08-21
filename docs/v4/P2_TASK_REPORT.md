# P2 TASK_REPORT — 市场研究 Skills（V4-FINAL-R2）

- 判定：**PASS**（必测 6/6；B1 基线遗留单列，不影响本 Phase 门禁）
- executionBatch：V4-FINAL-R2-P2-20260821-2030；authorityChecksum：`848bc4f0…`
- 报告时间：2026-08-21 13:29:14 +08:00；集成 HEAD：`ccfe3ad`（main，本地；未 push）
- 角色：Lead（Tool 信封/注册表/Evidence 合并/报告/API/UI 接线/E2E）；A（Amazon bounded adapter）；B（SellerSprite/Keyword/VOC adapters）；C（fixtures/eval 只读评审）

## 目标与达成

| 目标 | 达成 | 证据 |
|---|---|---|
| Workflow 对真实候选制定计划并调用受控工具 | ✅ | dispatch_tool 经 lib/v4/tools/registry.ts（envelope 校验 + recorded/live 双模式）；fake 计划问题映射市场工具 |
| SellerSprite/Amazon/Keyword/VOC 受控能力 | ✅ | 4 个 adapter（recorded fixtures + live 门控）；复用现有 sellersprite/evidence 数据面（零复制上传/解析） |
| 逐句有引用、显示未知与冲突的报告 | ✅ | lib/v4/report.ts：factual sentence 100% evidenceRefs（validateReportCitations）；gaps/unknowns 显式；reportJson 业务落库 + GET 报告 API + UI 面板 |
| 3 个候选画像（充足/不足/冲突） | ✅ | candidateProfiles fixtures（B）+ amazon-recorded profile-a/b/c（A） |
| 每 Skill 十项标准 + eval | ✅ | skills/v4/*.md（opportunity-prioritization、amazon-competitor-research、keyword-research、review-voc-analysis） |
| 计划修订 ≤2、失败暂停 | ✅ | P1 状态机复用；adapter 失败→failState（recoverable）→retry/revise |

## 文件（3 个提交组 + wave2）

- A：lib/v4/adapters/amazon.ts（1123 行：bounded、实体/赞助位校验、注入安全、幂等）+ 14 fixtures + 49 测试 + skill md
- B：lib/v4/adapters/{keyword,voc,sellersprite}.ts + candidateProfiles + 43 测试 + 3 skill md
- Lead wave2：lib/v4/tools/envelope.ts + registry.ts、lib/v4/report.ts（校验器 + 构建器）、graph.ts 集成（市场工具路由/waiting_auth/evidenceV2/报告生成/校验旁路）、reportJson 迁移（additive）、GET /api/v4/runs/[runId]/report、components/v4/ReportPanel.tsx + 控制台接线、lib/v4/marketJourney.test.ts

## 必测 Gate（6/6）

| # | 场景 | 结果 | 证据 |
|---|---|---|---|
| 1 | 正确候选完整研究（recorded） | ✅ | marketJourney.test：3 问题（amazon/search+keyword+voc）→ 证据合并 → 引用完整报告 → gate_a；E2E 同 |
| 2 | WRONG_ENTITY/no_results/AUTH_REQUIRED/DOM_CHANGED/RATE_LIMITED/BUDGET_EXCEEDED | ✅ | adapter 测试覆盖全部错误码（WE-1/2/3、no_results、AUTH、DOM、RATE、BUDGET）；graph 状态映射（waiting_auth/paused_budget/fail） |
| 3 | 网页/评论/XLSX 注入不改变权限与计划边界 | ✅ | PI-1/2/3：allowedDomains/budget/nextAction 不变、evidence.kind 非 action、注入文本只进 rawArtifact |
| 4 | 报告引用完整性 100% | ✅ | validateReportCitations + journey 断言 factual 均有 evidenceRefs |
| 5 | 刷新恢复 + 幂等 | ✅ | P1 checkpoint/journal 复用；adapter 幂等（同 key 同 inputHash 不重放） |
| 6 | 真实浏览器旅程到市场报告与 Gate A 前 | ✅ | E2E：创建→PLAN_REVIEW→继续→市场工具→报告面板渲染→GATE_A（截图存 v4-p1-evidence/p2/） |

## 命令与结果

| 命令 | 结果 |
|---|---|
| npx tsc --noEmit | exit 0（多次） |
| npx vitest run lib/v4 app/v4 components/v4 app/api/v4 | 28 files / 215 passed |
| npx vitest run lib/v4/adapters | 92 passed |
| npm test 全量 | 5565 passed / 1 failed（B1 基线）/ 78 skipped |
| npm run lint | 0 error / 8 warnings（既有） |
| npm run build（flag on） | 成功 |
| 浏览器 E2E | 全链路（见 P2_E2E_EVIDENCE.md） |

## 边界遵守

- 零真实付费/LLM 调用；Amazon live 模式仅代码级（QXV4_TOOL_LIVE 门控，默认关，E2E 用 recorded）；无自动登录/验证码绕过；无全天采集。
- 未开始 1688 Fact Gate/商业计算/内容生成（P3/P4/P5）。
- 报告无「能卖/爆款概率/预计月赚」；第三方热度不冒充精确搜索量（keyword adapter metricType 语义）。

## 风险 / 下一步

- B1（handoff quota 基线失败）待用户裁定；P3 全量回归前建议裁定。
- Amazon live 真机验证待用户授权真实浏览会话（waiting_auth 人工接管路径已实现+测试）。
- P2 PASS → 按授权进入 **P3（Supplier 与 Fact Gate）**。
