# V3.5-A — Proposal（1688 Sourcing Evidence Acquisition Spike）

> 状态：静态审计阶段完成（实测待用户配合）。范围：只验证 Acquisition Path；产品边界全部冻结。

## 1. 唯一目标

回答：真实 Amazon Candidate 能否在不绕登录/CAPTCHA、不复制 Cookie/Token、不读密码、不自动询盘采购、不大规模爬站的前提下，自动/半自动获得 3–5 个真实 1688 供应候选 + 足够结构化 Evidence；并选择 ACQUISITION_STRATEGY。

## 2. 四路线

- **Route A**：1688 官方/AI AK/API（next-1688 生态——官方 Skills 网关）
- **Route B**：1688-cli（用户扫码 + 工具自有持久 profile）
- **Route C**：OpenCLI Browser Bridge（用户已登录 Chrome + bind 当前 Tab）
- **Route D**：Manual Import Benchmark（永久 fallback）

## 3. 冻结边界（不因本 Spike 改变）

Sourcing Evidence 定位 / Seller Claim≠Fact / 页面价≠采购成本 / MOQ 语义保护 / Evidence Matrix / Unknown / Question Generation / Supplier Score 禁止 / PROFIT_MODULE=ASSUMPTION_ONLY / 旧 Supplier-Profit-Compliance Agent 不复活 / Search Result→Preview→Human Confirm→Evidence。

## 4. 静态审计结论（2026-08-15）

| Route | 架构/安全静态判定 | 实测状态 |
|---|---|---|
| A | 官方网关 + OAuth/AK + 结构化 + 实体绑定强；**参考代码无 license**；AK 门槛待实测 | NOT_TESTED（ROUTE_A_ACCESS=BLOCKED_BY_ACCESS_REQUIREMENT） |
| B | MIT；OWN_PROFILE+扫码（安全可接受）；**MTOP 内部协议高风险** | NOT_TESTED |
| C | Apache-2.0；EXISTING_BROWSER_SESSION；Bridge 机制真实存在；**Extension 高权限 + daemon 无鉴权需评审**；无 image search | NOT_TESTED |
| D | V3.4 已验证链路 | 设计就绪 |

## 5. 下一步（需用户配合，USER_ACTION_REQUIRED 模式）

1. Route C 实测（装 Bridge + 登录 Chrome）
2. Route B 实测（TEMP 安装 + 扫码）
3. Route A 实测（若用户获取 AK）
4. Manual benchmark（用户手动）

## 6. 成功门禁

某 Route 仅当 10 项成功条件（任务书二十三节）全部满足才 APPROVED；最终策略值限定六选一（API_FIRST/LOCAL_SESSION_CLI/BROWSER_BRIDGE/MANUAL_IMPORT_FIRST/HYBRID/NOT_PROVEN）。
