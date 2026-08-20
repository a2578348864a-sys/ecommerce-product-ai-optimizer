# 契约 05 — 公开 Provider 成本（PUBLIC_PROVIDER_COST）

## CURRENT_FACT（三张 Provider 调用图，代码核证）

**图 1：一次「AI 研究」= product-analysis 工作流（`lib/workflows/productAnalysis.ts`）**
| 步骤 | 并行/串行 | 重试 | 最大调用 |
|---|---|---|---|
| sourcing（`:171-179`） | 与 risk 并行（route:488-501） | 无（失败→兜底） | 1 |
| risk（`:259-267`） | 并行 | 无 | 1 |
| summary（`:335-343`） | sourcing+risk 后 | 无 | 1 |
| listing（`:419-437`） | summary 后 | 无 | 1 |

**最大 Provider 调用 = 4 / 1 个 productJourney 单位**；`createAiClient` `maxRetries:0`（`aiClient.ts:225`），SDK 层零自动重试。

**图 2：一次 Listing 动作 = 最大 1 次调用**（task 链 `taskLinkedAiListing.ts:178`；独立 studio `aiListingGenerator.ts:194`；
研究内 listing step；均无重试无兜底二次调用；失败走结构化兜底不再调用 Provider）。

**图 3：一次 Image 动作 = 最大 2 次调用**（handoff count=2 时逐个调用 `imageGenerationService.ts:349-359`；
image-draft/独立 studio 单次调用 n=1|2；`maxRetries:0`；错误只分类不自动重试）。

例外（重试型）：ai-evidence-summary 与 VOC 分析各 1 次 json_parse_error 重试 → **1 配额单位 = 最多 2 次调用**
（`aiEvidenceSummary.ts:608-628`、`vocAnalysis.ts:371-387`）。

生产模型：文本 deepseek-v4-flash（服务器 .env 实测）；图片 OpenAI gpt-image（API key 已配置，掩码核对）。
当前生产对访客暴露 D1 无配额缺口（契约 04）。

## FROZEN_DECISION

1. **MAX_PROVIDER_CALLS_PER_ACTION 冻结**：RESEARCH = 4、LISTING = 1、IMAGE = 2（每动作）。
2. 每动作必须声明 `(USER_QUOTA_UNIT, MAX_PROVIDER_CALLS)` 对，新增 Provider 路径必须过配额预留（契约 04-7）。
3. **成本模型必须覆盖三类（§14 裁定）**，分别计算 `User Actions × Max Provider Calls × Cost Exposure`：
   - RESEARCH：guest 动作数 = **0**（研究 OFF，`RESEARCH_PROVIDER_EXPOSURE = 0`）→ guest 研究侧暴露为 0；
   - LISTING：guest 动作数 ≤ 1（配额 1）→ 每 guest 每 12h ≤ **1 次调用** → `LISTING_PROVIDER_EXPOSURE > 0`；
   - IMAGE：guest 动作数 ≤ 1（配额 1）→ 每 guest 每 12h ≤ **2 次调用**（count=2 上限）→ `IMAGE_PROVIDER_EXPOSURE > 0`。
   **即使 Research=0，Listing/Image 仍必须纳入 GLOBAL DAILY HARD CAP（§14 裁定）。**
4. **不冻结「guest cost = 0」（§15 裁定）；冻结 GLOBAL_COST_IS_BOUNDED**：
   - `GLOBAL_TEXT_CALLS_HARD_CAP_PER_DAY` 与 `GLOBAL_IMAGE_CALLS_HARD_CAP_PER_DAY` 均为 **ENV 可配**；
   - 文本硬上限覆盖 Research/Listing/所有文本 Provider 调用；图片硬上限覆盖所有图片 Provider 调用；
   - **若真实单价未知，允许以 Call Count Hard Cap 作为绝对保险**（§15 裁定）；两种 cap 语义等价接受其一或并用。
   - 参考档位（初始建议值，ENV 可配，非冻结数字）：文本 50/200/500（LOW/REC/MAX_SAFE）、图片 10/40/100；
     上线前按真实成本与流量校准。
   - 实现：服务端全局计数器（进程内存 + 文件持久化，fail-closed，按 UTC 日重置）；达到上限 → 403 `global_cap_exceeded`。
   - **Release Gate：任何 Provider 路径没有 Hard Cap → BLOCK（§15 裁定）。**
5. **IP HMAC 兜底原则（§5 裁定，具体数字 ENV 可配）**：`IP_BACKSTOP IS NOT PRODUCT QUOTA`；
   `IP_THRESHOLD > 单个正常 Guest 完整合法使用上限` 且预留 **NAT HEADROOM**；
   不得出现「Guest UI 还有剩余额度，但正常使用被 IP Guard 提前阻断」；IP Guard 只针对明显异常创建、
   明显 burst、批量 Session Abuse。上线前必须通过 **NAT / NORMAL USE TEST**。
   实现：`bucket = HMAC(serverSecret, ip + 15minBucket)` 仅存服务端内存；不写 Cookie、不做指纹（契约 08）。
6. 成本监控：全局计数器每日快照 + PM2 日志 grep（`providerCallsStarted`）；超配置值 80% 告警（实现期定告警通道）。

## CONFIRMED_DEFECT

- D1（见契约 04）：交接链无配额 → 调用图在交接链上「每动作」可被访客无限触发，是唯一突破成本上界的路径；
  治理（契约 04-7）完成前 PUBLIC RELEASE 被 D1 阻断。

## FUTURE_IMPLEMENTATION

- 全局计数器模块 + 日重置；IP HMAC 桶（内存 LRU，阈值公式 + NAT headroom 校准）；监控快照端点（owner-only）；
  NAT/NORMAL USE TEST 脚本。

## UNKNOWN

- 真实 Provider 单价未知（§15 裁定已允许 Call Count Hard Cap 先行）——不阻断。
