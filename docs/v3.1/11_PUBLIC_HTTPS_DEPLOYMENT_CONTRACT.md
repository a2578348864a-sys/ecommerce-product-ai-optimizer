# 契约 11 — HTTPS 部署（PUBLIC_HTTPS_DEPLOYMENT）

## CURRENT_FACT（服务器只读审计 2026-08-20）

- OS：Ubuntu 22.04.5 LTS；PM2 单实例（契约 06）；nginx 1.18.0；`limit_req` = 0（契约 08）。
- **certbot 未安装**（`command not found`）；`/etc/letsencrypt/live/` 不存在；无 systemd cert 定时器、无 cron cert；
  ufw inactive；`.snap` 存在（snap 可用）。
- 端口：`http://112.124.54.81/api/health` = 200；`https://112.124.54.81` = 超时 → **443 未放行（阿里云安全组，需控制台操作）**。
- 生产运行构建：`/www/alibaba-ai-assistant/.next/BUILD_ID = LgPBXU0cslVkY7C9bEdy0`
  = 集成树 40470a1 构建产物（本地 `.next/BUILD_ID` 一致）→ 部署 = **预构建产物上传**，不是服务器 git 检出构建。
- 服务器 git 检出（`/www/alibaba-ai-assistant`）HEAD = `3b9ef89b`（是 40470a1 的祖先），且有 2 个未提交修改
  （`lib/aiListingDraft.ts`、`lib/listingHandoff/listingClaimEvidenceResolver.ts`）→ **该检出不是运行代码来源**。
- Let's Encrypt IP 证书：已 GA（2026-01-15），6 天短有效期 → 自动续期是硬门槛。

## FROZEN_DECISION

1. **发布顺序（不可调换）**：① guest 代码本地完成 → ② 配额/滥用加固本地完成 → ③ 在 v3.0.1 上完成 HTTPS 基础设施
   → ④ 部署 guest v3.1.0（Secure Cookie 从第一天生效，**无 HTTP guest 过渡**，契约 09-5）。
2. **证书方案**：Let's Encrypt IP 证书（域名为 IP 112.124.54.81）；客户端用最新 certbot（snap 安装）或 acme.sh。
   **自动续期 = 硬门槛**：systemd timer（每日 2 次）+ 续期后 nginx reload 钩子 + 失败告警；6 天证书的续期窗口必须按 LE 建议执行。
3. **前置条件（用户控制台操作，已记录）**：阿里云安全组放行 443。此项不完成则第 4 步禁止。
4. nginx 变更（仅 HTTPS 阶段）：新增 443 server 块（证书路径 + HTTP/2）；80 → 301 到 https；
   保留 X-Real-IP 等头；按契约 08 加 limit_req zone。
5. **部署产物溯源（D4 治理）**：继续「集成树构建 → 上传产物 → BUILD_ID 核对」流水线；
   服务器 git 检出**不是**部署状态来源，HTTPS 阶段顺带清理/重置该检出（或明确冻结其只读用途）。
6. v3.0.1 标签不可变：HTTPS 基础设施以「配置变更」形式叠加在 v3.0.1 上，不移动标签、不重写历史。
7. 回滚：guest v3.1.0 回滚 = 恢复 v3.0.1 产物 + `QX_RUNTIME_MODE` 缺省（契约 13）。

## CONFIRMED_DEFECT

- **D4（部署溯源卫生）**：服务器 git 检出 ≠ 运行产物（HEAD 落后于部署提交且带未提交修改）。
  影响：任何「在服务器上改代码再 git pull」的操作都会产生幻觉式差异；运行代码溯源只能靠 BUILD_ID。
  治理：见第 5 条（HTTPS 阶段清理）。不阻断 Phase 0（运行构建已核证 = 40470a1 产物）。
- 现状 HTTPS_IP_CERT_STATUS = **NEEDS_UPGRADE**（certbot 缺失 + 443 未开 + 无续期设施）——非缺陷，是既定升级路径。

## FUTURE_IMPLEMENTATION

- certbot/acme.sh 安装与签发；systemd timer + reload 钩子；443 安全组（用户操作）；nginx 443 块；服务器检出清理。

## UNKNOWN

- 无阻断项（443 安全组是用户控制台步骤，已作为前置条件记录）。
