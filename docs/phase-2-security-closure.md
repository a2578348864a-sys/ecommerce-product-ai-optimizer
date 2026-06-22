# Phase 2-Security Closure — 自动化 Agent 前置安全地基

> **状态**：✅ 已完成并归档。两个安全修复均已 commit/push，lint/test/build 全部通过。
> **日期**：2026-06-22
> **commits**：`e0cae79`、`f2c6b71`

---

## 为什么先做安全修复

Phase 2 的核心目标是沿着「全自动电商 Agent」路线，把单品受控自动化链路扩展为可复核的自动工作流。在进入 Phase 2-B.2（review 持久化 + 决策状态）之前，必须先补齐两个安全地基：

1. **Products API 服务端鉴权**：自动化 Agent 会通过 `/api/products/*` 批量调用 AI 分析，如果这些接口没有服务端密码校验，任何人都可以绕过前端直接调用，导致 AI token 被盗刷、历史文案数据被泄露。
2. **radarCrawler SSRF 防护**：自动化 Agent 未来需要从合规数据源抓取信息。radarCrawler 是 Phase 1E 打下的基础，但其 SSRF 防护只检查了 hostname 字符串，未覆盖 HTTP 重定向目标校验和 DNS 解析后 IP 检测，存在绕过风险。

**结论**：不先修安全，自动化 Agent 每多一条自动链路就多一个攻击面。先修地基，再盖楼。

---

## Security.1 — Products API 服务端鉴权补齐

**commit**：`e0cae79`

### 修复内容

| 接口 | 方法 | 修复前 | 修复后 |
|------|------|--------|--------|
| `/api/products/ai-analysis` | POST | ❌ 无鉴权 | ✅ `checkAccessPassword(request, body)` |
| `/api/products/listing-copy` | POST | ❌ 无鉴权 | ✅ `checkAccessPassword(request, body)` |
| `/api/products/keywords` | POST | ❌ 无鉴权 | ✅ `checkAccessPassword(request, body)` |
| `/api/products/listing-copy-history` | GET | ❌ 无鉴权 | ✅ `checkAccessPassword(request)` |
| `/api/products/listing-copy-history` | POST | ❌ 无鉴权 | ✅ `checkAccessPassword(request, body)` |
| `/api/products/listing-copy-history` | DELETE | ❌ 无鉴权 | ✅ `checkAccessPassword(request)` |
| `/api/products/listing-copy-history/[id]` | DELETE | ❌ 无鉴权 | ✅ `checkAccessPassword(request)` |

### 测试覆盖

- 新增 `app/api/products/products-auth.test.ts`：32 个鉴权测试
- 更新 `ai-analysis/route.test.ts`、`listing-copy/route.test.ts`：适配鉴权密码
- 覆盖场景：无密码 → 401、错误密码 → 401、正确密码（body/header）→ 通过、未配置密码 → 500

---

## Security.2 — radarCrawler SSRF 防护加固

**commit**：`f2c6b71`

### 修复内容

**新增 `lib/server/ssrfGuard.ts`**（可复用 SSRF 防护模块）：
- `isPrivateIPv4()` — 覆盖 127.0.0.0/8、10.0.0.0/8、172.16.0.0/12、192.168.0.0/16、169.254.0.0/16、0.0.0.0
- `isPrivateIPv6()` — 覆盖 ::1、fe80::/10、fc00::/7
- `isBlockedHostname()` — hostname 正则黑名单
- `isAllowedProtocol()` — 仅允许 http/https
- `resolveToPublicIp()` — DNS 解析（v4+v6 同时查询），**任意一个 IP 为内网即拒绝**
- `isValidTargetUrl()` — 综合校验

**修改 `lib/server/radarCrawler.ts`**：
- `fetch` 从 `redirect: "follow"` 改为 `redirect: "manual"`
- 手动跟随 301/302/303/307/308 重定向，每次对目标 URL 重新调用 `isValidTargetUrl()` 校验
- 初始 URL 增加 DNS 解析后 IP 校验

### 关键安全策略

**DNS 多 IP 保守拒绝策略**：如果 hostname 解析出多个 IP，**只要任意一个**落在内网/loopback/link-local 范围就拒绝。不采用"只要有公网就放行"的宽松策略，防止 DNS rebinding 攻击。

### 测试覆盖

- 新增 `lib/server/ssrfGuard.test.ts`：78 个 SSRF 测试
- 覆盖：15 IPv4 范围 + 7 IPv6 范围 + 14 hostname 模式 + 10 协议 + 16 DNS 解析（含混合 v4+v6、公网+内网混合等场景）
- 全部 mock DNS，零真实网络请求

---

## 验收结果

| 检查项 | Security.1 | Security.2 |
|--------|-----------|-----------|
| lint | ✅ 0 warnings | ✅ 0 warnings |
| test | ✅ 20 files / 179 passed | ✅ 21 files / 258 passed |
| build | ✅ 37/37 pages | ✅ 37/37 pages |
| origin/main | ✅ e0cae79 已 push | ✅ f2c6b71 已 push |

---

## 明确边界

- ❌ **未部署**。所有修复仅限本地代码和 GitHub 远端，未部署到生产服务器。
- ❌ **未调用真实 AI**。所有测试使用 mock（mock AI client / mock DNS），零真实网络请求。
- ❌ **未读取 .env / .env.local**。测试使用 `vi.stubEnv` 注入密码，不读取真实环境变量。
- ❌ **未恢复 radar 生产能力**。radar 在生产环境仍为禁用状态，本次只加固代码安全逻辑。
- ❌ **未进入 Phase 2-B.2 代码开发**。本次为安全前置修复，不涉及 review 持久化、决策状态、批量任务队列等 2-B.2 功能。

---

## 下一步建议

1. **回到 Phase 2-B.2 自动化 Agent 主链路**
   - 第一刀：Workflow Run 状态沉淀方案检查
   - 确认 review 状态持久化方案（localStorage → DB 还是最小方案）
   - 确认决策动作（继续/补资料/淘汰）写入 `decisionStatus`
2. **不要直接做外部平台自动执行**
   - 上架、联系供应商、投广告等操作仍需人工确认
   - 保持现有的 L2→L3 渐进策略
3. **部署时机**
   - 建议在 Phase 2-B.2 完成并与生产对齐后一起部署
   - 如果单独部署安全修复，需要通知所有 Alpha 用户重新输入密码

---

**Phase 2-Security 可归档。** ✅
