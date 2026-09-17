# 契约 03 — 访问 Token 传输（ACCESS_TOKEN_TRANSPORT）

## CURRENT_FACT

- signedToken（`lib/server/signedToken.ts`）：`stok_v1.{base64url(payload)}.{sig}`；
  payload `{v:1, mode, demoAccessId?, iat, exp, jti}`（:21-28, :79-89）；HMAC-SHA256，
  密钥 = `createHmac("sha256","qx-agent-signing-key-v1").update(ACCESS_PASSWORD).digest()`
  （:48-56，env 缺失 → 签发抛 SIGNING_KEY_MISSING，:71-74）；验证 `timingSafeEqual`（:123-133）；
  过期 = 绝对过期（`Date.now() > exp`，:150-152）。
- TTL：`ACCESS_TOKEN_TTL_MS = 12h` 硬编码（:44）；无滑动续期；无加密黑名单（jti 只生成不校验）。
- `getAccessContext` 五来源短路（`accessPassword.ts:48-118`）：1) `x-access-token` 头
  （存在但无效 → 立即 null，**不回退**，:79-83）；2) `x-access-password` 头；3) `body.accessToken`；
  4) `body.accessPassword`；5) 遗留 raw owner 密码比对（:104-115）。**全链路不读 Cookie**（grep 零命中）。
- 客户端 `buildAccessHeaders`（`lib/client/accessToken.ts:181-188`）：有 token 时同发
  `x-access-token` + `x-access-password` 两个头；无 token 返回 `{}`。token 存 sessionStorage。
- 生产 ACCESS_PASSWORD 已配置（服务器 .env 存在，掩码核对）→ 签名密钥可用。
- demo 分支校验：token 验签通过后仍要求 记录存在 + isActive（`accessPassword.ts:60-73`）→
  这是**服务端强制撤销点**（见 DESIGN_BOUNDARY D5）。

## FROZEN_DECISION

1. **signedToken 本身不改**：payload / 算法 / 签名 / 前缀 / **TTL（12h）全部不动**。guest token 与 visitor token 同构（mode=demo）。
   **删除旧草案中的 ttlMs 解耦与 24h guest TTL。**
2. **TTL 对齐（§6 裁定）**：`PUBLIC_GUEST_AUTH_TTL = 12h`；`GUEST_COOKIE_MAX_AGE <= 12h`（契约 09 用 43200s）；
   `DEMO_ACCESS_EXPIRES_AT <= TOKEN EXPIRY`（契约 02-6）。禁止 Cookie 24h + Token 12h。
3. **签名密钥语义（§7 裁定）**：ACCESS_PASSWORD 继续作为 **INTERNAL LEGACY TOKEN SIGNING SECRET**（stok_v1 兼容）。
   公开用户永远不知道该值；LOCAL Owner 也不经该密码认证（契约 10）。
   **V3.1 禁止顺手重构 Token crypto / Key rotation / Signing algorithm**；未来迁移
   `ACCESS_TOKEN_SIGNING_SECRET` 必须单独立项。
4. **传输**：guest token **只**经 HttpOnly Cookie 传输（契约 09）；铸 token 响应同时 Set-Cookie；
   浏览器**不**把 guest token 写入 sessionStorage/localStorage；`buildAccessHeaders` 与遗留流程完全不动。
5. **双来源冲突矩阵（§8 裁定，FROZEN；替代旧「头优先短路」草案）**：
   | Cookie | Header | 结果 |
   |---|---|---|
   | 有且有效 | 无 | validate（正常 guest 路径） |
   | 无 | 有且有效 | validate（正常遗留路径） |
   | 有且有效 | 有且有效，**同一身份** | accept |
   | 有且有效 | 有且有效，**不同身份** | **FAIL CLOSED** |
   | 无效 | 有效 | **FAIL CLOSED**（不回退） |
   | 有效 | 无效 | **FAIL CLOSED**（不回退） |
   | 无效 | 无 | FAIL CLOSED |
   | 无 | 无效 | FAIL CLOSED（与现有 x-access-token 短路一致，`accessPassword.ts:79-83`） |
   - 「同一身份」= 同一 mode 且（demo 模式下）同一 demoAccessId。
   - 错误码：`TOKEN_CONTEXT_CONFLICT`（或现有等价安全错误）；**禁止 silent fallback**。
   - body 来源（accessToken/accessPassword/raw owner）仅在 Cookie 与头都缺失时按现状顺序处理（遗留兼容，不新增仲裁）。
6. Cookie 里的 token 与头里的 token 一样，demo 分支继续强制 记录存在 + isActive（不因 Cookie 而放宽）。
7. Owner 路径与 Cookie 完全无关：owner token 仍只走 Owner 登录响应 + 客户端头。

## CONFIRMED_DEFECT

- 无（本契约为增量设计）。

## DESIGN_BOUNDARY

- **D5（§13 裁定，非缺陷）**：`TOKEN_CRYPTOGRAPHIC_BLACKLIST = NONE`（jti 不存储、无加密黑名单）——这是无状态设计的边界；
  但 `ACCESS_CONTEXT_REVOCATION` = demo-access **记录存在 + isActive**，**服务端强制**
  （`accessPassword.ts:60-73` 每次请求都校验；停用记录即全局失效）。除非代码实证 isActive=false 仍可访问，
  D5 保持 DESIGN_BOUNDARY，不算 Confirmed Defect。风险由 12h TTL + HttpOnly/Secure/SameSite（契约 09）
  + 全局硬上限与 IP 兜底（契约 05/08）覆盖。

## FUTURE_IMPLEMENTATION

- Cookie 来源插入 `getAccessContext` + 冲突矩阵实现与单测（矩阵 8 态全覆盖）。
- 铸 token 端点组装：`Set-Cookie: __Host-lqx_guest=stok_v1...; Max-Age=43200; Path=/; Secure; HttpOnly; SameSite=Lax`（契约 09）。
- 公开模式下访客页请求随 Cookie 自动携带（fetch 默认同源带 Cookie，无需前端改 token 存储）。

## UNKNOWN

- 无阻断项。
