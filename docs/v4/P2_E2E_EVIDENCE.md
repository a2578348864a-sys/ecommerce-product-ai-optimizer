# P2 E2E 证据 — 真实浏览器市场研究旅程（V4-FINAL-R2）

## 元数据
- Journey ID：V4-P2-E2E-01；日期：2026-08-21 13:29:14 +08:00
- Commit：ccfe3ad（本地 main，flag on 构建）
- 环境：http://127.0.0.1:3005（local_owner；QX_V4_GRAPH_ENABLED=1；市场工具 recorded 模式）
- Browser：Chrome（playwright-cli）；模式：local_live；角色：owner
- runId（脱敏）：ee2466cf-…

## 前置
- Flags：QX_V4_GRAPH_ENABLED=1 + NEXT_PUBLIC_QX_V4_GRAPH_ENABLED=1；市场工具 recorded（无 QX_V4_TOOL_LIVE）
- Fixture：dev.db 候选 91a60705…（THERMOS FUNTAINER，SellerSprite 导入，只读）
- 成本上限：0（零真实调用）

## 步骤
| # | 动作 | 预期 | 实际 | 截图 | PASS |
|---:|---|---|---|---|---|
| 1 | POST /api/v4/runs | 201 waiting_human@PLAN_REVIEW | 相符（rev 4） | — | ✅ |
| 2 | 详情页显示等待人工 + 计划 | Run Console 完整 | 相符 | page-2026-08-21T13-1*.png | ✅ |
| 3 | 点击「继续」 | 市场工具（recorded）执行→证据合并→报告→GATE_A | 相符（原因码 GATE_A，节点门禁 A，事件流显示 合并证据×2） | page-2026-08-21T13-2*.png | ✅ |
| 4 | GET /api/v4/runs/[runId]/report | 200 报告（evidence+sections+gaps） | 200：report-ee2466cf，SellerSprite 市场指标 1 句 + 缺口 1 | — | ✅ |
| 5 | 控制台面板 | 「市场研究报告」面板渲染（factual 句 + 引用） | 相符（find=2 matches） | page-2026-08-21T13-24-58.png | ✅ |
| 6 | flag off 恢复 | /api/v4/runs→404、V3.1 health 200 | 相符 | — | ✅ |

## 必核对
- [x] 实体校验：WRONG_ENTITY 路径由 adapter 单测覆盖（WE-1/2/3）；旅程中 amazon/search 无 fixture→no_results→缺口（不污染证据）
- [x] Evidence 引用：报告 factual 句均带 evidenceRefs（API 响应可核）
- [x] 人工 Gate 未被自动通过（GATE_A 等待人工）
- [x] 刷新/恢复（P1 已证；本旅程非终态轮询）
- [x] 无重复副作用（journal 幂等）；无 secret/CoT；console 无未解释错误
- [x] 报告无「能卖/爆款概率/预计月赚」

## 结论
**PASS**。真实浏览器完成「创建 → 计划审核 → 受控市场工具 → 引用完整市场报告 → Gate A」，截图/快照留存。
