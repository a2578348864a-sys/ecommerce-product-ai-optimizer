# V3.1 Phase 3 — HTTPS 基础设施记录（运维笔记）

> 本文件只含配置模板与运维事实，**不含**证书私钥、ACME 凭据、环境密钥。

## 服务器事实（2026-08-20）

- 公网：112.124.54.81；Ubuntu 22.04.5；nginx 1.18.0；PM2 fork_mode 单实例（127.0.0.1:3005）。
- 运行产物：v3.0.1（40470a1 artifact），BUILD_ID `LgPBXU0cslVkY7C9bEdy0`（Phase 3 前后不变）。
- 证书：Let's Encrypt **IP 证书**（SAN = IP Address:112.124.54.81），profile **shortlived（≈160h/6 天）**；
  路径 `/etc/letsencrypt/live/112.124.54.81/`（fullchain.pem 644 / privkey.pem 600，符号链接指向 archive）。
- 签发：certbot 5.7.0（snap），`certonly --preferred-profile shortlived --webroot --webroot-path /var/www/letsencrypt --ip-address 112.124.54.81`（账户已按用户授权 `--register-unsafely-without-email` 注册）。
- ACME webroot：`/var/www/letsencrypt`（755），nginx `^~ /.well-known/acme-challenge/` 不 proxy。
- 自动续期：snap `certbot.renew.timer`（每日 2 次，频率 << 160h 有效期）。
- Deploy hook：`/etc/letsencrypt/renewal-hooks/deploy/30-v31-nginx-reload`（root:root 700；
  renew 成功 → nginx -t → reload；nginx -t 失败则 exit 1 不 reload）。
- HTTP→HTTPS：`return 301 https://$host$request_uri`；ACME 路径保留 HTTP 200；**HSTS 关闭**（便于回滚）。
- Proxy 头（防伪造）：X-Real-IP / X-Forwarded-For 一律覆盖为 `$remote_addr`（可信边界 = 唯一回环 Nginx）。
- Nginx 限流：`limit_req_zone guest_burst`（$binary_remote_addr，20r/m），仅高危路径
  （/api/auth/guest、product-analysis、listing/image-handoff、image-draft）；429；dry-run 阶段观察无误伤后已启用 enforcement。
- 备份：`/root/v31-phase3-backup-20260820-223127/`（nginx 全套 + nginx -T + sha256 清单）。

## 回滚（HSTS=OFF，浏览器不会被长期锁死）

```bash
# 恢复 Phase 3 前配置（备份目录或 .pre-stageB 副本）
cp /root/v31-phase3-backup-20260820-223127/sites-available/alibaba-ai-assistant /etc/nginx/sites-available/alibaba-ai-assistant
nginx -t && systemctl reload nginx
# 证书文件可保留，无需删除（回滚只回 Nginx 配置）
```

## Phase 4 硬门禁（登记，本阶段不执行）

- 部署时必须**显式**设置 `QX_RUNTIME_MODE=public_showcase`（缺省 = v3.0.1 legacy fallback）。
- 显式配置：`PUBLIC_DAILY_TEXT_PROVIDER_CALL_CAP`、`PUBLIC_DAILY_IMAGE_PROVIDER_CALL_CAP`、
  `PUBLIC_GUEST_LISTING_GENERATION_QUOTA`、`PUBLIC_GUEST_IMAGE_GENERATION_QUOTA`（值按冻结 Cost Contract）。
- `QX_TRUSTED_PROXY_IPS=127.0.0.1`（与 Phase 2 IP parser 对齐；未来引入 CDN/LB 必须重新审计可信链）。
- 部署校验：`node scripts/v31-release-gate-check.mjs`（显式模式 + fork_mode 单实例）。
- Secure Cookie 从第一天启用（HTTPS 已就绪）。
