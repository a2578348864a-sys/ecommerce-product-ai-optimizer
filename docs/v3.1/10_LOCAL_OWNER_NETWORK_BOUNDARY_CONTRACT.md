# 契约 10 — 本地 Owner 网络边界（LOCAL_OWNER_NETWORK_BOUNDARY）

## CURRENT_FACT

- 生产 `next start -H 127.0.0.1 -p 3005`：3005 仅绑定回环（`ss -tlnp | grep 3005` 确认 127.0.0.1:3005）。
- nginx 唯一入口 `listen 80`，`proxy_pass` 到 127.0.0.1:3005；已设 X-Real-IP / X-Forwarded-For / X-Forwarded-Proto。
- Owner 认证 = env ACCESS_PASSWORD（生产 .env 已配置，掩码核对存在）→ 密码登录 → `generateSignedToken("owner")`
  （`app/api/auth/login/route.ts:40-57`）；遗留 raw-password 分支（`accessPassword.ts:104-115`）同样只认 env 密码。
- Owner 数据走 Prisma；Visitor 走文件 sandbox（契约 07）。`requireOwnerOnly` 对 demo token fail-closed。

## FROZEN_DECISION

1. **LOCAL_OWNER = 现状语义**：Owner 密码登录 + Visitor 码 + 现有配额，行为与 v3.0.1 完全一致；
   `QX_RUNTIME_MODE` 缺省即此模式（契约 01）。
2. **回环绑定不变**：`-H 127.0.0.1` 是网络边界的事实执行点（不是 nginx ACL、不是 Host 判断）；
   nginx 只是反向代理。任何「改为 0.0.0.0」都必须单独立项。
3. **PUBLIC_SHOWCASE 下 Owner 依然密码保护**：`/login` 保留、不宣传；guest 铸 token 端点永远只铸 demo token
   （`generateSignedToken("demo", ...)`），**任何代码路径不得**为 guest 铸 owner token（契约 01-8、02-3）。
4. Owner 能力（Browser Use、正式数据、全量研究、自定义 URL）**绝不**随公开模式对 guest 打开；
   授权边界以服务端 `requireOwnerOnly`/route 守卫为准，前端隐藏不算数（仓库不变量）。
5. 模式判定拒绝 Host/Origin/X-Forwarded-Host 等网络输入（契约 01-2）——这是本边界的关键：**不可伪造**。

## CONFIRMED_DEFECT

- 无。既有 raw-password 分支在公开模式下仍只对 env 密码比对，与 demo 记录无关（`accessPassword.ts:104-115`，
  契约 02 已核证）——fail-closed 状态保持。

## FUTURE_IMPLEMENTATION

- `QX_RUNTIME_MODE` 读取与校验（契约 01）；公开模式登录页改版（UI 工作树）。

## UNKNOWN

- 无阻断项。
