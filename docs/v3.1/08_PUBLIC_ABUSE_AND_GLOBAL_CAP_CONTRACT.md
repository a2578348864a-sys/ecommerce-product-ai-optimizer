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
     （研究对 guest 已 OFF，但 L1 对遗留访客路径仍生效。）
   - **L2 全局 Provider 日硬上限**（契约 05-4）：服务端 fail-closed 403 `global_cap_exceeded`；
     **任何 Provider 路径没有 Hard Cap → Release BLOCK**。
   - **L3 每身份配额**（契约 04）：guest 研究 0 / Listing 1 / Image 1；legacy Visitor 3/3 不变。
   - **L4 IP HMAC 兜底**（见下）。
3. **IP_BACKSTOP IS NOT PRODUCT QUOTA（§5 裁定，FROZEN）**：
   - 阈值必须 **> 单个正常 Guest 完整合法使用上限**，并预留 **NAT HEADROOM**；
   - 不得出现「Guest UI 还有剩余额度，但正常使用被 IP Guard 提前阻断」；
   - IP Guard 只针对：明显异常创建、明显 burst、批量 Session Abuse；
   - 所有阈值 **ENV CONFIGURABLE**，**禁止散落硬编码**；
   - 上线前必须通过 **NAT / NORMAL USE TEST**。
   - 实现：`bucket = HMAC(serverSecret, ip + 15minBucket)`，仅服务端内存 LRU；不写 Cookie、不落盘、不做指纹。
   - 初始建议值（仅配置起点，非冻结数字，须经 NAT 测试校准）：每 IP 每 15 分钟——guest 铸造 ≤ 30、
     文本 Provider 调用 ≤ 20、图片 Provider 调用 ≤ 10。正常 guest 每 12h 合法上限 = 文本 ≤ 1（listing 1 次）
     + 图片 ≤ 2（image count=2 上限），建议阈值 = 该上限 × NAT headroom 系数（初始 10）再取整。
4. **TTL 对齐（§6 裁定）**：guest 铸造速率钳制按 12h 周期核算（`PUBLIC_GUEST_AUTH_TTL = 12h`，
   契约 02/03/09）；每 IP 每 15 分钟铸造上限远高于正常单客需求（正常 = 每 12h 1 次）。
5. L1/L2/L4 全部为**服务器端强制**，前端提示只是体验层。
6. 429/403 响应不泄露内部计数细节（统一错误码，中文人话提示）。

## CONFIRMED_DEFECT

- 无（现状「没有防护」是事实缺位，由本契约补齐；当前公开面 = 密码码时代，风险已由 D1 单列）。

## FUTURE_IMPLEMENTATION

- nginx limit_req zone 定义（HTTPS 阶段）；全局计数器与 IP 桶（契约 05）；NAT/NORMAL USE TEST 脚本；
  429 客户端提示文案。

## UNKNOWN

- 无阻断项。
