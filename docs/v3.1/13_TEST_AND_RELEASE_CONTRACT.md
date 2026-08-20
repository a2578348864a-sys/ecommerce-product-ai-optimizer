# 契约 13 — 测试与发布（TEST_AND_RELEASE）

## CURRENT_FACT

- 测试栈：vitest + tsx；Husky pre-commit（eslint --fix）。
- 已有可复用测试：`goldenDemoTemplate.test.ts`（惰性/幂等/并发/隔离）、`goldenDemoDataRefresh.test.ts`、
  `studioFlowLayoutContract.test.ts`（AST）。
- 浏览器 QA 栈：**现有 browser-use + CDP**（本仓库既有设施）；**禁止为门禁新增 Playwright**。
- 生产 = v3.0.1 产物（BUILD_ID LgPBXU0cslVkY7C9bEdy0）；无 v3.1.0 标签；HTTPS 未上（契约 11）。

## FROZEN_DECISION

1. **测试矩阵（guest 上线门禁，全部必须 PASS）**：
   - 单元：`generateSignedToken` ttlMs（12h/24h 边界）；`getAccessContext` Cookie 来源 + 优先级矩阵
     （含「x-access-token 无效 → 不回退 Cookie」）；匿名记录四值 fail-closed 矩阵；
     配额文件锁事务并发（D2 治理后）；全局日上限 + IP 桶。
   - 路由/集成：guest 铸造 → Set-Cookie（属性断言 HttpOnly/Secure/SameSite=Lax/Path=/、无 Domain）→
     `/api/demo/golden` 惰性副本 → sandbox CRUD 隔离；scope deny-list 各路由 403；
     交接链配额接入后的 403/成功矩阵（D1）；Origin 校验（契约 09）。
   - 端到端（browser-use + CDP，生产前）：一键进演示 → Cookie 回传 → 金标演示交互 → 配额/429 文案 →
     Owner 登录不受影响 → 遗留访客码流程不受影响 → 回滚演练。
2. **发布顺序（与契约 11 同）**：guest 代码（本地）→ 配额/滥用加固（本地）→ HTTPS（v3.0.1 上）→
   部署 v3.1.0（Secure Cookie 第一天）。每阶段独立验证，不跨阶段合并验收。
3. **标签纪律**：v3.0.1 不可变；**v3.1.0 标签只在公开上线授权后创建**；Phase 0 不打任何标签。
4. **回滚**：`QX_RUNTIME_MODE` 缺省（local_owner）+ 恢复 v3.0.1 产物 + PM2 重启；guest 端点随模式失效
   （403/不可用）。回滚在部署演练中实际执行一次。
5. **验收清单（go-live 前）**：HTTPS 在线 + 自动续期验证过一轮；D1/D2 已治理且有测试；limit_req 生效（429 实测）；
   全局日上限生效；成本监控（契约 05-7）就位；U1 核查完成；`PUBLIC_SHOWCASE_NODE_INSTANCES=1` 复验。
6. 发布证据只采信「实际运行结果」：构建日志、测试输出、浏览器验收截图/输出、BUILD_ID 核对、服务器状态核对。

## CONFIRMED_DEFECT

- 无（本契约是流程约束）。D1–D5 的治理与验证分别归契约 04/05/06/11 与上文矩阵。

## FUTURE_IMPLEMENTATION

- 按矩阵逐项落地；发布 runbook 补充（`docs/deployment/production-runbook.md` 在实现期同步更新）。

## UNKNOWN

- 无阻断项。
