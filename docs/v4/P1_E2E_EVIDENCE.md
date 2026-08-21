# P1 E2E 证据 — 真实浏览器 fake workflow（V4-FINAL-R2）

## 元数据

- Journey ID：V4-P1-E2E-01
- 日期/时区：2026-08-21 12:24:25 +08:00
- Commit SHA：`58fcb6a`（本地 main；E2E 时 `ddd8d3a`+58fcb6a 已含全部修复）
- Execution Batch：V4-FINAL-R2-P1-20260821-1900
- 已确认所有工作包合并到该 SHA：是
- 环境/URL：http://127.0.0.1:3005（local_owner 无认证模式，flag QX_V4_GRAPH_ENABLED=1 + NEXT_PUBLIC_QX_V4_GRAPH_ENABLED=1 构建并启动）
- Browser/viewport：Chrome（playwright-cli，默认 viewport）
- 模式：local_live
- 角色与 sandbox：owner（本地）
- Case ID / runId（脱敏）：ca738f99-…（完整 fake workflow）；28f9c221-…（取消路径）；443bc01a-…（revision 冲突）

## 前置状态

- Feature flags：QX_V4_GRAPH_ENABLED=1（服务端）+ NEXT_PUBLIC_QX_V4_GRAPH_ENABLED=1（导航内联）
- Fixture：dev.db 既有候选 `91a60705-3cbd-46ff-888a-9a111eeaf64d`（THERMOS FUNTAINER Kids Food Jar，SellerSprite 导入，只读复用，未写入 V3.1 业务记录）
- 登录态：local_owner 无认证；人工接管条件：N/A（fake tools）
- 预期成本上限：0（无真实 Provider/Browser 付费）

## 步骤

| # | 用户动作 | 预期 UI/业务状态 | 实际结果 | 截图/快照 | PASS |
|---:|---|---|---|---|---|
| 1 | 打开 /v4/runs | 列表页 + flag 门控侧栏「V4 研究图 → 运行控制台」+ 空态 | 相符（侧栏出现 V4 研究图组） | 01-runs-list-empty.yml | ✅ |
| 2 | 浏览器 fetch POST /api/v4/runs {candidateId} | 201 + waiting_human@build_plan（PLAN_REVIEW）+ rev4 + 9 events | 相符 | 02-run-detail-waiting-plan-review.png | ✅ |
| 3 | 打开 /v4/runs/[runId] | Run Console：等待人工徽标、计划 rev.0、中断面板（继续/停止）、节点进度（加载上下文✓/校验身份✓/评估缺口✓/制定计划•） | 相符 | snapshot yml | ✅ |
| 4 | 刷新页面 | 状态保持 waiting_human（刷新恢复） | 相符（find 等待人工处理=1） | — | ✅ |
| 5 | 点击「继续」 | 推进到下一中断 GATE_A（门禁 A） | 相符 | — | ✅ |
| 6 | 点击「继续」×3 | FACT_GATE（产品事实门禁）→ GATE_B（门禁 B）→ CONTENT_REVIEW（内容审核） | 全部相符（各门禁 reasonCode 正确） | — | ✅ |
| 7 | 点击「继续」 | 完成 → completed（当前节点：完成） | 相符 | 03-run-completed.png | ✅ |
| 8 | resume(expectedRevision=3) 对已完成 run | 409 终态冻结 | 409 run_not_actionable（terminal completed） | console log | ✅ |
| 9 | 创建 run2 → cancel(expectedRevision) | 200 cancelled（node=cancel） | 相符 | — | ✅ |
| 10 | start(run2, cancelled revision) | 409 不可再写 | 409 run_not_actionable（terminal cancelled） | console log | ✅ |
| 11 | 创建 run3 → resume(expectedRevision=0, 实际 4) | 409 REVISION_CONFLICT + latestRevision=4 | 相符 | — | ✅ |
| 12 | flag off（恢复默认启动） | /api/v4/runs → 404；V3.1 health/home 200 | 相符 | — | ✅ |

## 必核对

- [x] 实体/marketplace/variant 正确（load_context 读取候选；fake 无真实实体断言）
- [x] Evidence 引用可打开（fake evidence 结构事件；无真实链接）
- [x] 人工 Gate 未被自动通过（5 处中断全部等待人工，仅 UI 点击后推进）
- [x] 刷新/重开恢复正确（步骤 4）
- [x] 无重复 Evidence/费用/资产（journal 幂等单测覆盖；E2E 无真实副作用）
- [x] 未显示 secret、PII 或跨 sandbox 数据（events 仅结构化；无 CoT/secret）
- [x] console 无未解释错误（仅断言期 409 资源错误日志）
- [x] Replay 标识：N/A（local_live）

## 持久化核对

- V4ResearchRun 行：ca738f99（completed, rev4+）、28f9c221（cancelled）、443bc01a（waiting）——经 API 读取核对 revision/status/currentNode 与 UI 一致；不复制敏感 DB 内容。

## 异常与缺陷

| Defect ID | 严重度 | 复现步骤 | 预期/实际 | 修复 commit | 重测 |
|---|---|---|---|---|---|
| E2E-01 | 高 | 创建 run 后 startRun | createRun 未持久化初始 stateJson → RUN_NOT_FOUND | 58fcb6a（draft state 落库） | ✅ E2E 步骤 2 |
| E2E-02 | 高 | 首次跑图 | checkpoint 目录不存在 → Cannot open database | 58fcb6a（openCheckpoint mkdir） | ✅ 步骤 2 |

## 结论

**PASS**。真实浏览器完成一条 fake workflow（5 人工中断 + 刷新恢复 + 终态冻结 + 取消 + revision 冲突），截图/快照留存于 `D:\Workspace\tmp\v4-p1-evidence\`。
