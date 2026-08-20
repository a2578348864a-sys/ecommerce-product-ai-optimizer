# V3.1「公开访客」契约冻结包（Phase 0 / CONTRACT FREEZE）

> 状态：**FINAL_AMENDED_DRAFT**（已按用户最终修订裁定 2026-08-20 修订；等待最后授权，未合并、未推送、未部署）
> 冻结基线：`V3_RELEASE = v3.0.1`（`40470a1df97c3e7ecf95f835e0490709b1cdfb96`，**不可变**）
> 文档分支：`docs/v3.1-phase0-contract-freeze`（纯文档工作树，不进入 main）
> 修订记录：v1（初稿）→ v2（最终修订：配额 0/1/1、TTL 12h、Token 冲突 fail-closed、D1 发布阻断、D5 降级、5 阶段顺序）

## 0. Phase 0 目标（冻结）

回答并冻结一个问题：

> 能否在不重做现有 Visitor / Sandbox 的情况下，把 Visitor Password / Visitor Code 替换成 **Anonymous Guest + HttpOnly Cookie**，
> 并继续复用 demo-access / signedToken / quota / Golden Demo / ensureVisitorDemoCopy / Visitor Isolation？

**答案：能（SANDBOX_REUSE_CONFIRMED = YES）。** 结论：**REMOVE PASSWORD GATE, KEEP EXISTING SANDBOX**。
沙箱机制零改动可复用；唯一新增点是「匿名拿 token 的入口」（新铸 token 端点）+ Cookie 传输 + 公开模式的配额/滥用加固。
代价是 4 个已确认缺陷（D1–D4）必须先按契约治理，1 个设计边界（D5）声明接受，方可公开上线。

## 1. 契约清单（13 份）

| # | 契约 | 一句话 |
|---|---|---|
| 01 | PUBLIC_RUNTIME_MODE | 运行模式只来自可信部署配置；guest 范围 = 金标演示交互（研究 OFF，Listing/Image 各 1 次） |
| 02 | ANONYMOUS_GUEST_IDENTITY | 复用 demo-access 记录；匿名记录对遗留密码登录 fail-closed；12h 对齐 |
| 03 | ACCESS_TOKEN_TRANSPORT | signedToken 不改（12h）；guest token 走 HttpOnly Cookie；双来源冲突 fail-closed |
| 04 | PUBLIC_QUOTA_SEMANTICS | 研究 0 / Listing 1 / Image 1（ENV 可配）；productJourneys 语义保留；D1=P1 发布阻断 |
| 05 | PUBLIC_PROVIDER_COST | 三类 Provider 调用图 + 全局日硬上限（含 Listing/Image）+ IP 兜底原则 |
| 06 | FILE_STORE_ATOMICITY | 单实例冻结 + 脚本验证门禁；单进程配额并发测试必做 |
| 07 | SANDBOX_REUSE | 复用结论 YES；惰性/幂等/身份绑定证据；guest 数据 GC 规划 |
| 08 | ABUSE_AND_GLOBAL_CAP | nginx limit_req + 全局硬上限 + IP 兜底（IP_BACKSTOP IS NOT PRODUCT QUOTA） |
| 09 | COOKIE_AND_CSRF | `__Host-lqx_guest` 规格（Max-Age=12h）+ 冲突矩阵 + CSRF 策略 |
| 10 | LOCAL_OWNER_NETWORK_BOUNDARY | Owner 不再经 ACCESS_PASSWORD 认证；它降为内部签名密钥；回环边界不变 |
| 11 | HTTPS_DEPLOYMENT | 先 HTTPS（IP 证书 ≈160h + 自动续期硬门槛）再 guest；密码入口移除在最后 |
| 12 | LEGACY_VISITOR_COMPATIBILITY | 旧访客码 3/3 全兼容；不动历史数据；productJourneys 不重解释 |
| 13 | TEST_AND_RELEASE | 5 阶段顺序 + 发布门禁（D1/原子性/实例数/硬上限/NAT 测试）+ 回滚 |

## 2. 裁定汇总（用户最终修订，全部冻结）

- **DECISION A（已知缺陷语义）**：CONFIRMED_DEFECT 不阻断 Phase 0；只有无法验证权限/安全边界的 UNKNOWN 才阻断。
- **DECISION B（guest 范围）**：`PUBLIC_GUEST_SCOPE = GOLDEN_DEMO_INTERACTIVE_ONLY`；**研究生成 OFF**；
  Listing/Image 生成仍属真实 Provider 动作（暴露 > 0），受三层防护。
- **DECISION C（契约提交方式）**：docs 分支纯文档提交；不合并、不推送。
- **配额（§3）**：AI_RESEARCH_ACTION=0、LISTING_GENERATION=1、IMAGE_GENERATION=1（均 ENV 可配）；
  VIEW（金标演示/证据/AI 摘要/既有 Listing/Image）= UNLIMITED；Legacy Visitor 3/3 保持兼容。
- **productJourneys（§4）**：保留旧业务语义，**不重解释为 AI Research Quota**；匿名 guest UI 不展示 0/5。
- **IP Backstop（§5）**：`IP_BACKSTOP IS NOT PRODUCT QUOTA`；阈值 > 单 guest 合法使用上限 + NAT headroom；
  只打异常创建/明显 burst/批量 session abuse；上线前 NAT/NORMAL USE TEST。
- **TTL（§6）**：不修改 Token TTL；PUBLIC_GUEST_AUTH_TTL = 12h；COOKIE_MAX_AGE ≤ 12h；EXPIRES_AT ≤ TOKEN EXPIRY；**禁止 24h 草案**。
- **签名密钥（§7）**：ACCESS_PASSWORD 降为 **INTERNAL LEGACY TOKEN SIGNING SECRET**（stok_v1 兼容）；public 永不知晓；
  LOCAL Owner 也不再经该密码认证；V3.1 禁止重构 Token crypto / rotation / algorithm。
- **Token 冲突（§8）**：Cookie+Header 同身份 → accept；不同身份 → FAIL CLOSED；任一 invalid → FAIL CLOSED；
  错误码 TOKEN_CONTEXT_CONFLICT；无 silent fallback。
- **D1（§10）**：**P1 PUBLIC COST CONTROL DEFECT**；Phase 0 不阻断，但 = **公开匿名上线 HARD BLOCKER**，必须在移除密码门之前修复。
- **D2（§11/12）**：NODE_INSTANCES=1 冻结 + Release Gate 脚本验证；instances>1 或 cluster → BLOCKED 直到跨进程原子性 PASS；
  单进程也必须过并发配额测试（remaining=1 双请求 → 1 成功 1 拒绝）。
- **D5（§13）**：降级为 **DESIGN_BOUNDARY**——TOKEN_CRYPTOGRAPHIC_BLACKLIST=NONE，但 ACCESS_CONTEXT_REVOCATION =
  demo-access isActive/记录存在，服务端强制。
- **成本（§14/15）**：不冻结「guest cost=0」，冻结 **GLOBAL_COST_IS_BOUNDED**；Research/Listing/Image 分别计算
  用户动作 × 最大调用 × 成本暴露；即使 Research=0，Listing/Image 也必须入 GLOBAL DAILY HARD CAP；
  单价未知时允许 Call Count Hard Cap 作绝对保险；Provider 路径无 Hard Cap → Release BLOCK。
- **HTTPS（§16）**：LE IP 证书已 GA，≈160h 短寿命；certbot 5.4+（IP + webroot）；需 webroot 签发 + 手动 Nginx TLS +
  自动续期 + deploy-hook reload；**AUTO_RENEWAL=PASS = HARD RELEASE GATE**。
- **阶段（§17）**：P1 Guest Core（LOCAL）→ P2 D1+原子性+全局成本+IP 兜底（LOCAL）→ P3 HTTPS（当前密码版先上，guest 不上线）→
  P4 Public Guest Deploy（Secure Cookie 第一天，**此阶段才移除公开密码入口**）→ P5 Public Human Acceptance → v3.1.0。

## 3. 门禁结果（Phase 0 GATE）

**PHASE_0_CONTRACT_FREEZE = FINAL_PASS_WITH_CONFIRMED_DEFECTS**

| 项 | 计数 | 说明 |
|---|---|---|
| CONFIRMED_DEFECT | 4 | D1 交接链缺配额（P1，发布阻断）、D2 跨进程非原子（单实例冻结+门禁）、D3 文档漂移、D4 部署溯源卫生 |
| DESIGN_BOUNDARY | 1 | D5：无加密黑名单，但 isActive/记录存在 = 服务端强制撤销（§13） |
| OPEN_UNKNOWN_P0 | 0 | — |
| OPEN_UNKNOWN_P1 | 0 | — |
| OTHER_UNKNOWN | 1 | U1：存量 demo-access.json 字段清单（代码层 fail-closed 已验证；实现期只读布尔核查，契约 12） |

## 4. 术语

- **signedToken**：`stok_v1.{payload}.{sig}`，HMAC-SHA256；密钥由 ACCESS_PASSWORD 派生（= 内部签名密钥，非登录口令）；**12h 绝对过期**。
- **demoAccessId**：访客身份主体；沙箱隔离 = 按此字段等值过滤，fail-closed。
- **PUBLIC_SHOWCASE / LOCAL_OWNER**：见契约 01。模式只能来自服务端部署配置（env），绝不来自 Host/Origin/URL/IP。
- **USER_QUOTA_UNIT ≠ PROVIDER_COST_UNIT**：见契约 04/05。

## 5. 审阅方法

每份契约带五标签段：`CURRENT_FACT` / `FROZEN_DECISION` / `CONFIRMED_DEFECT` / `FUTURE_IMPLEMENTATION` / `UNKNOWN`。
最终修订门禁的 17 项条件见契约 13（§门禁清单），全部 PASS 后本包为最终冻结版。
