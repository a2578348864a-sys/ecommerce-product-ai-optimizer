# 契约 08 — 滥用防护与全局上限（PUBLIC_ABUSE_AND_GLOBAL_CAP）

## CURRENT_FACT

- 生产 nginx 1.18.0 单 `server { listen 80; }`；`limit_req` 出现次数 = **0**（服务器只读审计 `nginx -T | grep -c limit_req`）。
- ufw inactive；443 端口未开（安全组未放行，https 探测超时）。
- 现有服务端配额（契约 04）是**身份级**（按 demoAccessId），无全局日上限、无 IP 维度兜底。
- 无 Cookie、无指纹、无身份追踪设施（grep 零命中；`docs/v3/PUBLIC_DEPLOYMENT_READINESS.md:149` 同）。

## FROZEN_DECISION

1. 滥用防护**只做可用性/成本防护，不建身份**：不用指纹、不跟踪、不写持久化 IP 档案（范围冻结）。
2. 四层防护（自上而下）：
   - **L1 nginx limit_req（429）**：只对 4 类端点生效——guest 铸造、AI 研究、listing 生成、image 生成。
     建议缺省：guest 铸造 `rate=10r/m burst=20`；三个生成类 `rate=5r/m burst=10`（每 IP，`$binary_remote_addr` 键）。
     配置随 HTTPS 阶段（契约 11）一起上线。
   - **L2 全局 Provider 日上限**（契约 05-3）：服务端 fail-closed 403 `global_cap_exceeded`。
   - **L3 每身份配额**（契约 04）：productJourneys / standalone / maxAiCalls（guest 出厂 0）。
   - **L4 IP HMAC 兜底**（契约 05-5）：每 15 分钟每 IP 文本 ≤10、图片 ≤2，429；仅内存，HMAC 盐化，不落盘、不入 Cookie。
3. L1/L2/L4 全部为**服务器端强制**，前端提示只是体验层。
4. Cookie TTL 24h（契约 03/09）与铸造限流共同钳制「刷新即新身份」的循环：每 IP 每 15 分钟最多 ~10 次铸造。
5. 429/403 响应不泄露内部计数细节（统一错误码，中文人话提示）。

## CONFIRMED_DEFECT

- 无（现状「没有防护」是事实缺位，由本契约补齐；当前公开面 = 密码码时代，风险已由 D1 单列）。

## FUTURE_IMPLEMENTATION

- nginx limit_req zone 定义（HTTPS 阶段）；全局计数器与 IP 桶（契约 05）；429 客户端提示文案。

## UNKNOWN

- 无阻断项。
