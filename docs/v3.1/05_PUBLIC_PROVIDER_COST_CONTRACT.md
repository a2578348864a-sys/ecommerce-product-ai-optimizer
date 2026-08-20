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
2. 每动作必须声明 `(USER_QUOTA_UNIT, MAX_PROVIDER_CALLS)` 对，新增 Provider 路径必须过配额预留（契约 04-5）。
3. **全局日上限（机制冻结，值为可调 env，缺省 = RECOMMENDED）**：
   | 指标 | LOW | RECOMMENDED（缺省） | MAX_SAFE |
   |---|---|---|---|
   | GLOBAL_TEXT_CALLS_PER_DAY | 50 | 200 | 500 |
   | GLOBAL_IMAGE_CALLS_PER_DAY | 10 | 40 | 100 |
   实现：服务端全局计数器（进程内存 + 文件持久化，fail-closed，按 UTC 日重置）；达到上限 → 403 `global_cap_exceeded`。
4. **guest（anonymous）maxAiCalls 档位**（配置驱动，禁止硬编码）：LOW=0（纯金标演示，真实 AI 全关，**出厂缺省**）、
   RECOMMENDED=10、MAX_SAFE=30（每个 guest 每 24h Cookie 生命周期）。
   档位切换只改 env/记录创建参数，不动代码。
5. **IP HMAC 兜底（仅防滥用，不建身份）**：`bucket = HMAC(serverSecret, ip + 15minBucket)` 仅存服务端；
   每 15 分钟每 IP：文本 ≤ 10、图片 ≤ 2；超限 429。不写 Cookie、不做指纹。
6. 成本模型结论：出厂配置下 guest 真实 AI 消耗 = 0（scope + maxAiCalls=0 双 fail-closed）；
   启用 RECOMMENDED 档的日成本上界 = 200 文本 + 40 图片（与单访客 10 文本 + 3+3 独立额度共同钳制）。
7. 成本监控：全局计数器每日快照 + PM2 日志 grep（`providerCallsStarted`）；超 RECOMMENDED 80% 告警（实现期定告警通道）。

## CONFIRMED_DEFECT

- D1（见契约 04）：交接链无配额 → 上述调用图在交接链上「每动作」可被访客无限触发，是唯一突破成本上界的路径；
  治理后成本模型才成立。

## FUTURE_IMPLEMENTATION

- 全局计数器模块 + 日重置；IP HMAC 桶（内存 LRU）；监控快照端点（owner-only）。

## UNKNOWN

- 无阻断项。
