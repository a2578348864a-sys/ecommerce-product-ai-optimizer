# V3 Final Interaction & Research Navigation Correction — 回归审查

## 验证矩阵（实际运行）

| 项 | 结果 |
|---|---|
| 全量回归 | 4828 tests PASS（2 环境类失败：native1688Bridge 端口被集成树占用 + release-package Windows tar，均既有基线） |
| tsc | PASS |
| lint | 0 errors（既有 warnings 除外） |
| build（功能树 + 集成树） | PASS（含 /research 路由） |
| targeted（nav/history/handoff/completion/sourcing） | 全 PASS |
| headed Playwright 全链 | PASS（R1-R7 + 币种校准，见 user-journey.md） |

## 走查发现并修复的回归
1. **任务详情页卡"正在读取研究记录…"**（c477522 引入）：R7 清单迁移时误删 TaskRecordDetail 的 loadRecord useEffect/refreshRecord/reqIdRef → 客户端不发 fetch。修复：完整恢复（71ca36e），复验通过。
2. **/tasks 混入 active 任务**（初始实现）：TaskRecordsList safeScope 默认值未按视图生效 + owner API 缺 lifecycle JS 过滤。修复：视图默认 scope + classifyResearchLifecycle 过滤 + total 重算（a11f223），复验 /tasks=历史 0 条、/research=active 9 条。
3. **Sidebar 双高亮**（active 任务页 /research 与 /tasks 同时高亮）：isActivePath 前缀匹配冲突。修复：/tasks 特判 isTasksHighlight（b7a509e），复验单高亮。
4. **SSR useSearchParams CSR bailout**（/agent prerender 失败）：Sidebar 改 client location 读取（e1a4f38），build 通过。

## 币种校准回归
- calibrateEnvironment 为可选（默认不启用）——search canary / homepage diagnostic / stage2 probes 行为不变（mock 补 calibration:null 字段）。
- 校准失败 fail-closed（不阻断采集，价格按既有 currency 门禁处理）。
- 无 DB schema 变更、无汇率换算、无 DOM 伪造。

## 结论
REGRESSION=PASS（2 环境类失败已归因，非代码回归）。
