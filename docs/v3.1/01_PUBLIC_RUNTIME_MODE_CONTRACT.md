# 契约 01 — 公开运行模式（PUBLIC_RUNTIME_MODE）

## CURRENT_FACT

- 当前仓库**没有**运行模式概念：所有行为由现有 env 开关拼成（`OPENAI_LISTING_ENABLED`、
  `OPENAI_IMAGE_GENERATION_ENABLED` 等，见 `lib/server/realAiListingGate.ts:6-13`、`realAiImageGate.ts:6-13`）。
- 生产现状（服务器只读审计，2026-08）：PM2 `alibaba-ai-assistant` 为 **fork_mode 单实例**（pid 69943），
  启动参数 `next start -H 127.0.0.1 -p 3005`；端口 3005 仅绑定 127.0.0.1（回环）。
- 生产 env：`OPENAI_LISTING_VISITOR_ENABLED=true`、`OPENAI_IMAGE_VISITOR_ENABLED=true`、`IMAGE_PROVIDER_MODE=real`、
  `DEEPSEEK_MODEL=deepseek-v4-flash`；无 `PUBLIC_SHOWCASE` / `LOCAL_OWNER` 变量。
- nginx 1.18.0 单 `server { listen 80; server_name _; }` 反代到 3005。

## FROZEN_DECISION

1. 引入 `QX_RUNTIME_MODE` env：`local_owner`（缺省 = 现状，安全默认）| `public_showcase`。
2. **模式来源只允许可信部署配置（服务器 env 文件）**；禁止从 Host / Origin / X-Forwarded-Host / URL / IP / Cookie 推断模式。
3. `local_owner`：Visitor 码与配额行为兼容现状；继续回环绑定 3005。
   （Owner 认证方式变更见契约 10：ACCESS_PASSWORD 降为内部签名密钥，不再作登录口令。）
4. `public_showcase`：登录页去掉密码门（一键匿名 guest）；**公开密码入口移除仅发生在 Phase 4（契约 13 阶段顺序）**；
   公开范围的服务器端 deny-list 生效；Cookie 规格按契约 09；配额按契约 04；限流按契约 08。
5. **PUBLIC_GUEST_SCOPE = GOLDEN_DEMO_INTERACTIVE_ONLY**。匿名 guest（credentialKind=anonymous，契约 02）：
   - ON（限额内）：金标演示交互（ensureVisitorDemoCopy 惰性副本）与其 **Listing 生成（默认 1 次）**、
     **Image 生成（默认 1 次）**、Studio、交接链交互；金标演示 / 证据 / AI 摘要 / 既有 Listing / 既有 Image 的
     **查看 = UNLIMITED**。
   - OFF（服务器端 fail-closed，不靠隐藏按钮）：**新建商品研究（研究/AI 动作配额 = 0）**、SellerSprite 文件/插件导入、
     实时 Amazon/SellerSprite/1688 采集、Browser Use 运行时、自定义外部 URL、任何 owner-only 路径。
6. **Listing/Image 生成是真实 Provider 动作**：`LISTING_PROVIDER_EXPOSURE > 0`、`IMAGE_PROVIDER_EXPOSURE > 0`，
   必须同时受 Guest Action Quota（契约 04）+ Global Provider Cap（契约 05）+ IP/Nginx Abuse Backstop（契约 08）三层保护。
7. **PUBLIC_SHOWCASE_NODE_INSTANCES = 1**（硬要求，Release Gate 脚本验证，契约 06/13）。多实例被禁止，直到 D2 治理完成。
8. 模式切换 = 改 env + PM2 重启；**无运行时切换接口**（避免从网络触发切换）。
9. guest 永远拿不到 `mode:"owner"` token：`generateSignedToken("owner")` 只存在于 Owner 登录路径
   （`app/api/auth/login/route.ts:40-57`）；guest 铸 token 端点（契约 02/03）只铸 demo 模式。

## CONFIRMED_DEFECT

- 无（本契约只新增概念；与 D1–D4 的关系见契约 04/05/11）。

## FUTURE_IMPLEMENTATION

- `QX_RUNTIME_MODE` 读取层（`lib/server/runtimeMode.ts`，server-only）：单点读取 + 启动时校验非法值 fail-closed（非法值视为 local_owner 并记日志）。
- 公开模式 deny-list 挂入统一 guard：对 anonymous 记录在 OFF 列表路由返回 403 `guest_scope_denied`。
- 落地页/登录页按模式渲染；**匿名 guest UI 不展示「商品研究 0/5」**（无消费路径的额度不展示，契约 04-4）。
- Owner 认证新机制（契约 10）。

## UNKNOWN

- 无阻断项。
