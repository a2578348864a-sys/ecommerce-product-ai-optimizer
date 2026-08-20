# 契约 03 — 访问 Token 传输（ACCESS_TOKEN_TRANSPORT）

## CURRENT_FACT

- signedToken（`lib/server/signedToken.ts`）：`stok_v1.{base64url(payload)}.{sig}`；
  payload `{v:1, mode, demoAccessId?, iat, exp, jti}`（:21-28, :79-89）；HMAC-SHA256，
  密钥 = `createHmac("sha256","qx-agent-signing-key-v1").update(ACCESS_PASSWORD).digest()`
  （:48-56，env 缺失 → 签发抛 SIGNING_KEY_MISSING，:71-74）；验证 `timingSafeEqual`（:123-133）；
  过期 = 绝对过期（`Date.now() > exp`，:150-152）。
- TTL：`ACCESS_TOKEN_TTL_MS = 12h` 硬编码（:44）；无滑动续期；**无吊销**（jti 只生成不校验；grep 无 revoke/refresh）。
- `getAccessContext` 五来源短路（`accessPassword.ts:48-118`）：1) `x-access-token` 头
  （存在但无效 → 立即 null，**不回退**，:79-83）；2) `x-access-password` 头；3) `body.accessToken`；
  4) `body.accessPassword`；5) 遗留 raw owner 密码比对（:104-115）。**全链路不读 Cookie**（grep 零命中）。
- 客户端 `buildAccessHeaders`（`lib/client/accessToken.ts:181-188`）：有 token 时同发
  `x-access-token` + `x-access-password` 两个头；无 token 返回 `{}`。token 存 sessionStorage。
- 生产 ACCESS_PASSWORD 已配置（服务器 .env 存在，长度 8，掩码核对）→ 签名密钥可用。
- demo 分支校验：token 验签通过后仍要求 记录存在 + isActive（`accessPassword.ts:60-73`）。

## FROZEN_DECISION

1. **signedToken 本身不改**：payload / 算法 / 签名 / 前缀 全部复用。guest token 与 visitor token 同构（mode=demo）。
2. **TTL 解耦**：`generateSignedToken` 增加可选 `ttlMs` 参数；缺省 = 现有 12h（密码路径行为不变）；
   guest = **24h**。`verifySignedToken` 不变。`ACCESS_TOKEN_TTL_MS` 常量保留为默认值。
3. **传输**：guest token **只**经 HttpOnly Cookie 传输（Cookie 名与规格见契约 09）；铸 token 响应同时
   Set-Cookie；浏览器**不**把 guest token 写入 sessionStorage/localStorage；`buildAccessHeaders`
   与遗留流程完全不动。服务器对 guest 只从 Cookie 取 token。
4. **解析优先级（FROZEN）**：在 `getAccessContext` 现有第 1 步之后、第 2 步之前插入 Cookie 来源：
   1) `x-access-token` 头（保留「存在但无效 → 立即 null」的 fail-closed 短路，:79-83 不变）；
   2) **Cookie `__Host-lqx_guest`**（仅当第 1 步无头时读取，走同一 `trySession` 管道）；
   3) `x-access-password` 头；4) `body.accessToken`；5) `body.accessPassword`；6) 遗留 raw owner 密码。
   → 老客户端（头）与新 guest（Cookie）互不干扰；两个身份并存时以 x-access-token 头为准（不新增仲裁逻辑）。
5. Cookie 里的 token 与头里的 token 一样，demo 分支继续强制 记录存在 + isActive（不因 Cookie 而放宽）。
6. **无吊销 = 声明边界**（MVP 接受）：签发后过期前不可撤销；风险由 24h TTL + HttpOnly/Secure/SameSite
   （契约 09）+ 全局日上限与 IP HMAC 兜底（契约 05/08）共同覆盖。不做 Redis/黑名单（范围冻结）。
7. Owner 路径与 Cookie 完全无关：owner token 仍只走登录响应 + 客户端头。

## CONFIRMED_DEFECT

- 无（本契约为增量设计）。相关已确认项：D5（token 无吊销）为本设计属性，边界见上。

## FUTURE_IMPLEMENTATION

- `ttlMs` 参数（`signedToken.ts`）＋单测（24h/12h 过期断言）。
- Cookie 来源插入 `getAccessContext`（第 4 条顺序）＋优先级矩阵单测。
- 铸 token 端点组装：`Set-Cookie: __Host-lqx_guest=stok_v1...; Max-Age=86400; Path=/; Secure; HttpOnly; SameSite=Lax`（无 Domain，契约 09）。
- 公开模式下访客页请求随 Cookie 自动携带（fetch 默认同源带 Cookie，无需前端改 token 存储）。

## UNKNOWN

- 无阻断项。
