# 契约 09 — Cookie 与 CSRF（PUBLIC_COOKIE_AND_CSRF）

## CURRENT_FACT

- 全仓库无 Cookie 认证：`lib/server` 与 `app/api` grep `request.cookies|cookies()` 零命中（仅 radar/save 一处无关脱敏正则）；
  `components` 下 `document.cookie` 零命中。
- 客户端认证材料：sessionStorage token + `buildAccessHeaders` 双头（契约 03）。
- 生产仅 HTTP（443 未开）→ 今天任何 Secure Cookie 都不会被浏览器回传。

## FROZEN_DECISION

1. **Cookie 规格（FROZEN）**：名 `__Host-lqx_guest`；值 = signedToken（`stok_v1...`，契约 03）；
   `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`；**无 Domain**（`__Host-` 前缀本身要求
   Secure + Path=/ + 无 Domain，浏览器强制校验）；不设 Partitioned。
2. Cookie = **token 传输层**，不承载任何业务数据；服务器对 guest 只把 Cookie 当 token 来源（契约 03-4 优先级）。
3. 只由铸 token 端点 Set-Cookie；登出（未来）/过期由 Max-Age 自然清除；客户端永不读写该 Cookie。
4. **CSRF 策略**：
   - SameSite=Lax：跨站 POST 不携带该 Cookie（主防线）。
   - 全站同源（无 CORS 放开）；所有 guest 变更端点要求 JSON Content-Type（现状已如此）。
   - 对 demo-mode 的 POST/PATCH 端点增加 **Origin 头校验**（存在时必须等于自身 Origin，否则 403）——实现期补齐，
     与既有 Route 错误契约不冲突（新增 403 code：`origin_mismatch`）。
   - 铸 token 端点本身无 CSRF 风险（无状态副作用），但仍受 L1 限流。
5. **HTTPS 前置**：Secure Cookie 意味着 guest 流程从第一天就只在 HTTPS 下工作；
   **禁止 HTTP guest 过渡期**（HTTP 下 Cookie 不回传 → 流程直接失败，这是特性不是缺陷；契约 11 顺序保证）。
6. 身份冲突语义（FROZEN）：`x-access-token` 头存在且有效 → 以头为准（老访客）；头存在但无效 → 立即拒绝
   （现有 fail-closed 短路不变，`accessPassword.ts:79-83`），**不**回退 Cookie；只有无头时才读 Cookie。

## CONFIRMED_DEFECT

- 无。注：D5（token 无吊销）在本契约范围内由 24h TTL + HttpOnly + IP 兜底缓解（契约 03-6）。

## FUTURE_IMPLEMENTATION

- 铸 token 端点 Set-Cookie 组装（契约 03）；`getAccessContext` Cookie 来源；Origin 校验中间层；
  guest 登出端点（清 Cookie + 可选停用记录，实现期定）。

## UNKNOWN

- 无阻断项。
