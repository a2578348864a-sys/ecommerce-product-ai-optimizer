# 契约 11 — HTTPS 部署（PUBLIC_HTTPS_DEPLOYMENT）

## CURRENT_FACT（服务器只读审计 2026-08-20 + 外部事实复验）

- OS：Ubuntu 22.04.5 LTS；PM2 单实例（契约 06）；nginx 1.18.0；`limit_req` = 0（契约 08）。
- **certbot 未安装**（`command not found`）；`/etc/letsencrypt/live/` 不存在；无 systemd cert 定时器、无 cron cert；
  ufw inactive；`.snap` 存在（snap 可用）。
- 端口：`http://112.124.54.81/api/health` = 200；`https://112.124.54.81` = 超时 → **443 未放行（阿里云安全组，需控制台操作）**。
- 生产运行构建：`/www/alibaba-ai-assistant/.next/BUILD_ID = LgPBXU0cslVkY7C9bEdy0`
  = 集成树 40470a1 构建产物（本地 `.next/BUILD_ID` 一致）→ 部署 = **预构建产物上传**，不是服务器 git 检出构建。
- 服务器 git 检出（`/www/alibaba-ai-assistant`）HEAD = `3b9ef89b`（是 40470a1 的祖先），且有 2 个未提交修改
  （`lib/aiListingDraft.ts`、`lib/listingHandoff/listingClaimEvidenceResolver.ts`）→ **该检出不是运行代码来源**。
- **外部事实（§16 裁定，已复验）**：Let's Encrypt IP Address Certificates 已 GA；IP 证书为 **short-lived，约 160h**；
  **Certbot 5.4+ 推荐用于 IP + webroot**；当前 Certbot **不会自动完成 Nginx IP 证书安装** →
  需要 **webroot 签发 + 手动 Nginx TLS 配置 + 自动续期 + deploy-hook nginx reload**。

## FROZEN_DECISION

1. **发布顺序（§17 裁定，5 阶段，不可调换；详见契约 13）**：
   **Phase 1** Anonymous Guest Core（LOCAL ONLY）→ **Phase 2** D1 + Quota Atomicity + Global Cost Guard + IP Backstop
   （LOCAL ONLY）→ **Phase 3** HTTPS Infrastructure（**先在当前 Public Password-gated release 上完成，guest 不上线**）→
   **Phase 4** Public Guest Deploy（Secure Cookie 从第一天启用，**此阶段才 REMOVE PUBLIC PASSWORD ENTRY**）→
   **Phase 5** Public Human Acceptance → v3.1.0。
2. **证书方案**：Let's Encrypt IP 证书（IP 112.124.54.81）；**webroot 签发**（Certbot 5.4+，IP + webroot 模式）；
   **手动 Nginx TLS 配置**（Certbot 不会自动装 IP 证书的 Nginx 配置）；
   **自动续期 = HARD RELEASE GATE（AUTO_RENEWAL = PASS）**：systemd timer（针对 ≈160h 短寿命，建议每日 2 次）+
   **deploy-hook nginx reload** + 失败告警。
3. **前置条件（用户控制台操作，已记录）**：阿里云安全组放行 443。此项不完成则 Phase 4 禁止。
4. nginx 变更（仅 Phase 3）：新增 443 server 块（证书路径 + HTTP/2）；80 → 301 到 https；
   保留 X-Real-IP 等头；按契约 08 加 limit_req zone。
5. **部署产物溯源（D4 治理）**：继续「集成树构建 → 上传产物 → BUILD_ID 核对」流水线；
   服务器 git 检出**不是**部署状态来源，Phase 3 顺带清理/重置该检出（或明确冻结其只读用途）。
6. v3.0.1 标签不可变：HTTPS 基础设施以「配置变更」形式叠加在 v3.0.1 上，不移动标签、不重写历史。
7. 回滚：guest v3.1.0 回滚 = 恢复 v3.0.1 产物 + `QX_RUNTIME_MODE` 缺省（契约 13）。

## CONFIRMED_DEFECT

- **D4（部署溯源卫生）**：服务器 git 检出 ≠ 运行产物（HEAD 落后于部署提交且带未提交修改）。
  影响：任何「在服务器上改代码再 git pull」的操作都会产生幻觉式差异；运行代码溯源只能靠 BUILD_ID。
  治理：见第 5 条（Phase 3 清理）。不阻断 Phase 0（运行构建已核证 = 40470a1 产物）。
- 现状 HTTPS_IP_CERT_STATUS = **NEEDS_UPGRADE**（certbot 缺失 + 443 未开 + 无续期设施）——非缺陷，是既定升级路径。

## FUTURE_IMPLEMENTATION

- Certbot 5.4+（snap）安装与 webroot 签发；systemd timer + deploy-hook nginx reload + 告警；
  443 安全组（用户操作）；nginx 443 块 + limit_req；服务器检出清理。

## UNKNOWN

- 无阻断项（443 安全组是用户控制台步骤，已作为前置条件记录）。
