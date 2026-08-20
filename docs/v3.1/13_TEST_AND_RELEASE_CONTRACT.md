# 契约 13 — 测试与发布（TEST_AND_RELEASE）

## CURRENT_FACT

- 测试栈：vitest + tsx；Husky pre-commit（eslint --fix）。
- 已有可复用测试：`goldenDemoTemplate.test.ts`（惰性/幂等/并发/隔离）、`goldenDemoDataRefresh.test.ts`、
  `studioFlowLayoutContract.test.ts`（AST）。
- 浏览器 QA 栈：**现有 browser-use + CDP**（本仓库既有设施）；**禁止为门禁新增 Playwright**。
- 生产 = v3.0.1 产物（BUILD_ID LgPBXU0cslVkY7C9bEdy0）；无 v3.1.0 标签；HTTPS 未上（契约 11）。

## FROZEN_DECISION

1. **发布顺序（§17 裁定，5 阶段，FROZEN）**：
   - **Phase 1**：Anonymous Guest Core（铸 token 端点 + Cookie + credentialKind + runtimeMode + scope deny-list）——**LOCAL ONLY**；
   - **Phase 2**：**D1 修复** + Quota Atomicity（D2 + 单进程并发测试）+ Global Cost Guard + IP Backstop——**LOCAL ONLY**；
   - **Phase 3**：HTTPS Infrastructure——**先在当前 Public Password-gated release 上完成，guest 不上线**；
   - **Phase 4**：Public Guest Deploy——**Secure Cookie 从第一天启用；此阶段才 REMOVE PUBLIC PASSWORD ENTRY**；
   - **Phase 5**：Public Human Acceptance → **v3.1.0**。
   **禁止：先匿名上线再补 D1（§10 裁定）。**
2. **测试矩阵（guest 上线门禁，全部必须 PASS）**：
   - 单元：`getAccessContext` Cookie 来源 + **双来源冲突矩阵 8 态全覆盖（§8 裁定）**；匿名记录四值 fail-closed 矩阵；
     配额文件锁事务并发（D2 治理后）；全局日上限 + IP 桶阈值公式。
   - **SINGLE_PROCESS_QUOTA_ATOMICITY = PASS（§12 裁定）**：remaining=1 时两个**同时到达的 HTTP 请求** →
     必须恰好 1 success + 1 quota_exhausted；**不得因 PM2 single instance 跳过**（契约 06-7）。
   - 路由/集成：guest 铸造 → Set-Cookie（属性断言 HttpOnly/Secure/SameSite=Lax/Path=/、Max-Age=43200、无 Domain）→
     `/api/demo/golden` 惰性副本 → sandbox CRUD 隔离；scope deny-list 各路由 403；交接链配额接入后的 403/成功矩阵（D1）；
     Origin 校验（契约 09）。
   - **IP Backstop 校准测试（§5 裁定）**：上线前 **NAT / NORMAL USE TEST**——正常单 guest 完整合法使用（listing 1 + image 1
     + 查看无限）不得被 IP Guard 阻断；仅异常创建/明显 burst/批量 session abuse 被拦。
   - 端到端（browser-use + CDP，生产前）：一键进演示 → Cookie 回传 → 金标演示交互（查看无限 + 生成各 1 次）→
     配额/429 文案 → Owner 认证不受影响 → 遗留访客码流程不受影响 → 回滚演练。
3. **Release Gates（§11/§12/§15/§16 裁定汇总，脚本化验证）**：
   - `PUBLIC_SHOWCASE_NODE_INSTANCES = 1`：脚本检查 `pm2 jlist` `exec_mode=fork_mode` 且 `instances=1`；
     `instances > 1` 或 cluster → **PUBLIC_RELEASE = BLOCKED**，直到 `CROSS_PROCESS_ATOMICITY = PASS`；
   - D1 已修复（交接链配额接入）且有测试覆盖——未修复则 **BLOCKED**（§10）；
   - 所有 Provider 路径有 Hard Cap（全局日上限/调用数硬上限）——缺失则 **BLOCKED**（§15）；
   - `AUTO_RENEWAL = PASS`（HTTPS 自动续期验证过一轮）——缺失则 **BLOCKED**（§16）；
   - SINGLE_PROCESS_QUOTA_ATOMICITY = PASS；NAT/NORMAL USE TEST = PASS；U1 核查完成。
4. **标签纪律**：v3.0.1 不可变；**v3.1.0 标签只在 Phase 5 公开验收授权后创建**；Phase 0 不打任何标签。
5. **回滚**：`QX_RUNTIME_MODE` 缺省（local_owner）+ 恢复 v3.0.1 产物 + PM2 重启；guest 端点随模式失效（403/不可用）。
   回滚在部署演练中实际执行一次。
6. 发布证据只采信「实际运行结果」：构建日志、测试输出、浏览器验收截图/输出、BUILD_ID 核对、服务器状态核对。

## 最终门禁清单（§20 裁定，逐项状态）

| 条件 | 状态 |
|---|---|
| GUEST_AI_RESEARCH_SCOPE = FROZEN | PASS（契约 01-5/04-2，研究 OFF，暴露 = 0） |
| GUEST_LISTING_QUOTA = FROZEN | PASS（契约 04-2，默认 1，ENV 可配） |
| GUEST_IMAGE_QUOTA = FROZEN | PASS（契约 04-2，默认 1，ENV 可配） |
| PRODUCT_JOURNEY_SEMANTICS = FROZEN | PASS（契约 04-4/12-3，不重解释，guest UI 不展示 0/5） |
| IP_BACKSTOP_NO_NORMAL_USER_CONFLICT = PASS | PASS（契约 08-3，阈值 > 正常上限 + NAT headroom，NAT 测试上线前必做） |
| TOKEN_COOKIE_TTL_ALIGNED = PASS | PASS（契约 02-6/03-2/09-1，全部 12h，24h 草案已删） |
| SIGNING_SECRET_SEMANTICS = FROZEN | PASS（契约 03-3/10-1，内部签名密钥，禁止 crypto 重构） |
| TOKEN_SOURCE_CONFLICT = FAIL_CLOSED | PASS（契约 03-5/09-6，8 态矩阵，TOKEN_CONTEXT_CONFLICT） |
| ANONYMOUS_LEGACY_AUTH = DENIED | PASS（契约 02-9/12-5，四值 fail-closed 已代码核证） |
| D1_RELEASE_BLOCKER = FROZEN | PASS（契约 04 D1 重分类 + 契约 13-1 顺序） |
| SINGLE_PROCESS_DEPLOYMENT_INVARIANT = FROZEN | PASS（契约 06-1/13-3，脚本验证门禁） |
| D5_DESIGN_BOUNDARY = FROZEN | PASS（契约 03/09，撤销 = isActive 服务端强制） |
| GLOBAL_COST_MODEL_COVERS_ALL_PROVIDERS = PASS | PASS（契约 05-3/4，Research/Listing/Image 全纳入，含 Research=0 情形） |
| HTTPS_ORDER = FROZEN | PASS（契约 11-1/13-1，5 阶段，密码移除在 Phase 4） |
| CONTRACT_DRIFT = 0 | PASS（修订后六权威 + 六专项复核，见最终报告） |
| OPEN_UNKNOWN_P0 = 0 | PASS |
| OPEN_UNKNOWN_P1 = 0 | PASS |

→ **PHASE_0_CONTRACT_FREEZE = FINAL_PASS_WITH_CONFIRMED_DEFECTS**

## CONFIRMED_DEFECT

- 无（本契约是流程约束）。D1–D4 的治理与验证分别归契约 04/05/06/11 与上文矩阵。

## FUTURE_IMPLEMENTATION

- 按矩阵逐项落地；发布 runbook 补充（`docs/deployment/production-runbook.md` 在实现期同步更新）。

## UNKNOWN

- 无阻断项。
