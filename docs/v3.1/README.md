# V3.1「公开访客」契约冻结包（Phase 0 / CONTRACT FREEZE）

> 状态：**DRAFT_FOR_REVIEW**（等待用户审阅批准；未合并、未推送、未部署）
> 日期：2026-08-20
> 冻结基线：`V3_RELEASE = v3.0.1`（`40470a1df97c3e7ecf95f835e0490709b1cdfb96`，**不可变**）
> 文档分支：`docs/v3.1-phase0-contract-freeze`（纯文档工作树，不进入 main）

## 0. Phase 0 目标（冻结）

回答并冻结一个问题：

> 能否在不重做现有 Visitor / Sandbox 的情况下，把 Visitor Password / Visitor Code 替换成 **Anonymous Guest + HttpOnly Cookie**，
> 并继续复用 demo-access / signedToken / quota / Golden Demo / ensureVisitorDemoCopy / Visitor Isolation？

**答案：能（SANDBOX_REUSE_CONFIRMED = YES）。** 结论：**REMOVE PASSWORD GATE, KEEP EXISTING SANDBOX**。
沙箱机制零改动可复用；唯一新增点是「匿名拿 token 的入口」（新铸 token 端点）+ Cookie 传输 + 公开模式的配额/滥用加固。
代价是 5 个已确认缺陷（D1–D5，见 §3）必须先按契约治理，方可公开上线。

## 1. 契约清单（13 份）

| # | 契约 | 一句话 |
|---|---|---|
| 01 | PUBLIC_RUNTIME_MODE | 运行模式只来自可信部署配置；PUBLIC_SHOWCASE 范围 = 仅金标演示交互 |
| 02 | ANONYMOUS_GUEST_IDENTITY | 复用 demo-access 记录，加 credentialKind；匿名记录对遗留密码登录 fail-closed |
| 03 | ACCESS_TOKEN_TRANSPORT | signedToken 不改；guest token 走 HttpOnly Cookie；TTL 解耦 12h/24h |
| 04 | PUBLIC_QUOTA_SEMANTICS | 用户配额单位 ≠ Provider 成本单位；guest 默认值；D1/D2/D3 治理 |
| 05 | PUBLIC_PROVIDER_COST | 三张 Provider 调用图 + 全局日上限 + IP HMAC 兜底 + 成本分级 |
| 06 | FILE_STORE_ATOMICITY | 单实例冻结；跨进程非原子（D2）上线前必须治理 |
| 07 | SANDBOX_REUSE | 复用结论 YES；惰性/幂等/身份绑定证据；guest 数据 GC 规划 |
| 08 | ABUSE_AND_GLOBAL_CAP | nginx limit_req + 全局日上限 + IP 兜底（仅防滥用，不建身份） |
| 09 | COOKIE_AND_CSRF | `__Host-lqx_guest` 规格 + 优先级 + CSRF 策略 |
| 10 | LOCAL_OWNER_NETWORK_BOUNDARY | Owner 仍走密码登录；回环绑定不变；guest 永不能铸 owner token |
| 11 | HTTPS_DEPLOYMENT | 先上 HTTPS（IP 证书 + 自动续期硬门槛）再上 guest；部署产物溯源 |
| 12 | LEGACY_VISITOR_COMPATIBILITY | 旧访客码全兼容；不动现有记录；文档漂移 D3 治理 |
| 13 | TEST_AND_RELEASE | 测试矩阵、发布顺序、回滚、v3.0.1 不可变 |

## 2. 三大决策（用户已裁定，全部冻结）

- **DECISION A（已知缺陷语义）**：CONFIRMED_DEFECT（有代码证据 + 复现 + 影响 + 治理契约 + 责任人）**不阻断 Phase 0**；
  只有「无法验证权限/安全边界」的 UNKNOWN 才阻断。门禁只计 `OPEN_UNKNOWN_P0` / `OPEN_UNKNOWN_P1`。
- **DECISION B（guest 范围）**：`PUBLIC_GUEST_SCOPE = GOLDEN_DEMO_INTERACTIVE_ONLY`。
  OFF：新建商品研究、SellerSprite 文件导入、实时 Amazon/SellerSprite/1688 采集、Browser Use 运行时、自定义外部 URL。不扩展 productJourneys。
- **DECISION C（契约提交方式）**：契约落在 `docs/v3.1/**` 的纯文档分支 `docs/v3.1-phase0-contract-freeze`，仅文档提交；
  **不合并 main、不推送**，等用户审阅报告并授权。

## 3. 门禁结果（Phase 0 GATE）

**GATE = PASS_WITH_CONFIRMED_DEFECTS**

| 项 | 计数 | 说明 |
|---|---|---|
| CONFIRMED_DEFECT | 5 | D1 交接链绕过配额（生产实测暴露）、D2 跨进程非原子、D3 契约文档漂移、D4 服务器 git 检出≠部署产物、D5 token 无吊销（设计属性，声明边界） |
| OPEN_UNKNOWN_P0 | 0 | — |
| OPEN_UNKNOWN_P1 | 0 | — |
| OTHER_UNKNOWN | 1 | U1：真实 demo-access.json 存量记录字段清单（仓库策略禁止读取；安全边界已在代码层验证，不阻断；契约 12 规定实现期核查） |

## 4. 术语

- **signedToken**：`stok_v1.{payload}.{sig}`，HMAC-SHA256，密钥由 ACCESS_PASSWORD 派生；12h 绝对过期；无吊销（无状态）。
- **demoAccessId**：访客身份主体；沙箱隔离 = 按此字段等值过滤，fail-closed。
- **PUBLIC_SHOWCASE / LOCAL_OWNER**：见契约 01。模式只能来自服务端部署配置（env），绝不来自 Host/Origin/URL/IP。
- **USER_QUOTA_UNIT ≠ PROVIDER_COST_UNIT**：见契约 04/05。

## 5. 审阅方法

每份契约都带五个标签段：`CURRENT_FACT`（已核实事实，含 文件:行号 证据）、`FROZEN_DECISION`（冻结决定）、
`CONFIRMED_DEFECT`（已确认缺陷+治理）、`FUTURE_IMPLEMENTATION`（未来实施项）、`UNKNOWN`（未决项）。
审阅时请核对：CURRENT_FACT 是否与代码一致；FROZEN_DECISION 是否接受；CONFIRMED_DEFECT 的治理顺序是否接受。
