# 契约 02 — 匿名访客身份（ANONYMOUS_GUEST_IDENTITY）

## CURRENT_FACT

- demo-access 记录 schema（`lib/server/demoAccess.ts:44-113`）：`id`（`demo_<hex>`）、`label`、
  `passwordHash`、`salt`、`expiresAt`（V2.1.7 起恒 null，`isDemoAccessExpired` 恒 false，
  `demoAccess.ts:315-318`）、`maxAiCalls`（脚本默认 0，`scripts/create-demo-password.mjs:98`）、
  `usedAiCalls`、`isActive`、`createdAt`、`lastUsedAt`、`notes`、`productJourneyReservations`、
  `standaloneListingUsed`、`standaloneImageUnitsUsed` 等配额台账字段。
- 身份 = `demoAccessId`；signedToken payload 内嵌 `demoAccessId`（`lib/server/signedToken.ts:87-89`）。
- **匿名记录对遗留密码登录 fail-closed（已逐分支验证）**：`verifyDemoPassword` 恒等式比较
  （`demoAccess.ts:169-172`）；passwordHash 缺失 / null / 空串 / 空白 四种情况全部拒绝；
  `findDemoAccessByPassword`（`demoAccess.ts:303-311`）无「无 hash 即放行」兜底 → 登录 401
  （`app/api/auth/login/route.ts:110-114`）。`getAccessContext` 的遗留 raw-password 分支只对 env
  ACCESS_PASSWORD（owner），从不比对 demo 记录 hash（`accessPassword.ts:104-115`）。
- 记录加载器不做字段级校验（`demoAccess.ts:188-204` 仅 JSON.parse + version 检查）。
- 目前 demo token 只有一条铸造路径：密码登录成功后 `generateSignedToken("demo", id)`
  （`login/route.ts:60→94`）。仓库内无 anonymous/guest 铸 token 路由（grep 零命中）。

## FROZEN_DECISION

1. **复用 DemoAccessRecord**，新增可选字段 `credentialKind?: "password" | "anonymous"`（缺省 = "password"，向后兼容）。
   加载器归一化：passwordHash 缺失/空 且 credentialKind 未标注 → 归一化为 anonymous（不改写存量文件）。
2. 匿名记录：`passwordHash` 缺省不写（保持 ABSENT）、`salt` 空、`expiresAt` null、`isActive` true。
3. **匿名 guest 默认额度（§3 裁定，ENV 可配，禁止散落硬编码）**：
   - `PUBLIC_GUEST_AI_RESEARCH_ACTION_QUOTA = 0`（研究/AI 动作 OFF，`maxAiCalls` 缺省 0 维持 fail-closed）；
   - `PUBLIC_GUEST_LISTING_GENERATION_QUOTA = 1`（独立/交接链 listing 生成合计 1 次）；
   - `PUBLIC_GUEST_IMAGE_GENERATION_QUOTA = 1`（独立/交接链 image 生成合计 1 次）。
   - **Legacy Visitor 3/3 保持兼容；不得为匿名 guest 修改历史 Visitor 数据。**
   - 金标演示 / 证据 / AI 摘要 / 既有 Listing / 既有 Image 的查看 = UNLIMITED（模板静态数据，零 Provider 成本）。
4. **productJourneys 保留旧业务语义（= 新建商品研究链计数），不重解释为 AI Research Quota**；
   匿名 guest 研究 OFF（契约 01-5），故该额度无消费路径，**guest UI 不展示「商品研究 0/5」**（契约 01 FUTURE）。
5. 匿名拿 token 的唯一入口 = 新增铸 token 端点（命名在实现期冻结，建议 `POST /api/auth/guest`）：
   服务端创建（或复用）匿名记录 → `generateSignedToken("demo", id)` → `Set-Cookie`（契约 09）→ 返回最小资料。
   该端点**绝不**接受密码、绝不铸 owner token。
6. **TTL 对齐（§6 裁定）**：`PUBLIC_GUEST_AUTH_TTL = 12h`（Token 不改，沿用现有 12h）；`GUEST_COOKIE_MAX_AGE <= 12h`；
   `DEMO_ACCESS_EXPIRES_AT <= TOKEN EXPIRY`（若启用 expiresAt，不得超过 token 过期时刻；现状 null = 记录无过期，
   访问始终由 12h token 门控）。**禁止 Cookie 24h + Token 12h 的错配。**
7. Cookie 有效期内复用同一记录（`getDemoAccessById`）；Cookie 过期 → 重新铸造（新 cookie）；
   旧匿名记录进入 GC 策略（契约 07）。每次铸造即「新 guest」，不重建身份画像。
8. 存量记录**零迁移、零批量改写**：旧 Visitor 码保持 password 语义原样工作（契约 12）。
9. **匿名记录对遗留密码登录必须继续 fail-closed（§9 裁定重申）**：empty / null / missing password 均不得产生
   authentication success（现有代码已满足；回归测试纳入契约 13）。

## CONFIRMED_DEFECT

- 无（本契约范围内的 fail-closed 行为已逐分支代码验证）。

## FUTURE_IMPLEMENTATION

- `credentialKind` 字段 + 加载器归一化（`demoAccess.ts`）。
- 铸 token 端点：创建记录必须走 `withDemoAccessStoreTransaction`（契约 06）以避免公开并发下的丢更新；
  端点本身受 nginx limit_req（契约 08）。
- 匿名记录的 listing/image 生成配额字段缺省值（1/1）由 env 驱动（契约 04），创建记录时读取。
- 服务端 demo 分支继续复现「记录存在 + isActive」校验（`accessPassword.ts:60-73`，已具备，无需改）。

## UNKNOWN

- U1（非阻断）：真实 `data/demo-access.json` 的存量记录字段清单未读取（仓库策略禁止读取受保护运行数据）。
  代码层 fail-closed 已验证；实现期执行一次只读核查脚本（只输出 字段是否存在 的布尔统计，不打印内容），
  确认无「半成品记录」被误归一化（契约 12 规定）。
