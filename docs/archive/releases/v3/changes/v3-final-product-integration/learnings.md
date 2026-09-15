# V3 Final Product Integration — Learnings

## 架构层
1. **研究流程双页面倒置是历史演进产物**：旧 /agent/run（AgentRunClient）被迁移为候选研究页（结论+决策+保存），Task Detail 才长出 Evidence Workbench——职责分离正确但入口顺序错误。修复方向是**入口重排**（Start Research → 骨架 Task → Workbench），而非重写组件。
2. **并发模型（whole-document CAS + namespace 写入）正确但令牌过粗**：同页多区块互相失效。最小修复不是改并发核心，而是 **draft 持久化 + 409 自动重载**（保留输入、刷新版本、安全重试）。
3. **capability gate 必须按能力拆分**：单一 CLI 登录态 gate 三入口是"状态合并"错误；readiness 是 UI 可用性 + 文案分流问题，服务端 action 校验本就独立（image 零 CLI 依赖）。
4. **mutation boundary 值得维护**：F1 初版用 `updateSandboxTask` 直写 resultJson 突破边界（被 mutation-boundary 测试拦截）→ 改为新 writer `research-save` 走 mutation layer——**边界测试有效防止了架构退化**。
5. **身份继承 fail-closed**：productUrl 派生必须"ASIN + 明确 marketplace"（Amazon 家族域名映射），未知市场 null——防止猜测导航。

## 过程层
6. 全量并行偶发超时/EPERM 是既有基线现象（单独重跑 PASS），不应误判为回归。
7. 测试断言是产品语义的活文档：导航改名/入口变化需同步更新 navigation/convergence/history 断言（本次 11 个断言文件）。
8. 审计 → Package A（数据/能力）→ Package B（主链）→ Package C（攻击面）的顺序有效：先接通数据，再编排流程，最后收口入口。

## 遗留
- 候选研究页（/opportunity-candidates/[id]）仍可通过直接 URL 进入（研究执行页，从 Workbench 引导卡进入）；主链入口已收敛。
- /products/new 利润试算保留为辅助工具（保存任务已下线）；/workflow/batch 重定向收口。
