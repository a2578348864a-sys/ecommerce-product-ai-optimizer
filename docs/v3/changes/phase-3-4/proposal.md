# Phase 3/4 提议 — 两种关键词 Evidence（无真实样本准备路径）

> 来源：`12_PHASE3_4_TASK.md`、`decisions.md §7`（风险 #3/#6）
> **状态声明**：材料根 XLSX案例 目录确认**无 Reverse ASIN / Keyword Mining 真实 XLSX**（仅有 Products + 12 个 BSR 文件）。
> 按任务书「无真实样本」条款：本阶段只做 官方字段研究 / Adapter 设计 / 风险清单 / 测试计划；
> **禁止**猜表头、猜单位、宣称正式 XLSX 合同完成。Gate 中「真实 XLSX 正确 / 5 行值级核对」待真实样本到位后补齐。

## 1. 阶段结构

- 谁先有真实 XLSX 样本，谁先做（Reverse ASIN → Phase 3；Keyword Mining → Phase 4）。
- 生产实现必须串行（12_PHASE3_4_TASK.md）。
- 无样本期间：两个报告的「准备」并行只读（设计/风险/测试计划不写生产解析代码，不冻结正式合同）。

## 2. 最小闭环（样本到位后目标，现在只设计）

- Phase 3（Reverse ASIN）：`1 Candidate → 1 competitor ASIN → 1 real XLSX → Preview → Human bind → Save Evidence → Workbench`
- Phase 4（Keyword Mining）：`1 Seed → 1 real XLSX → Preview → Human bind → Save Evidence → Workbench`
- 不做 41 ASIN 批量；不做批量自动化。

## 3. Adapter 设计（草案，样本验证前不冻结）

### 3.1 Reverse ASIN Adapter

- 输入：真实 Reverse ASIN XLSX（1 个 competitor ASIN 报表）
- 字段级防错（任务书强制，设计即落实）：
  - `rankPosition` / `adPosition`：**若真实样本为对象结构**（如 `{position, page}`），必须显式读取 `.position` 或等价字段，禁止把对象当数字；样本验证前标 `pending_sample_verification`
  - `trafficPercentage` / `naturalRatio` / `adRatio` / Top3 click/conversion 等比例字段：**原值 0–1 则展示层才 ×100**；存储保持原值 + metricNature=derived/snapshot
  - `supplyDemandRatio`：**比率，不得 ×100**
  - 必须保存：`source`、`asin`、`marketplace`、`month/dataPeriod`、`capturedAt`
  - **0 与 null/unknown 必须区分**（沿用 fields.ts normalize 语义：0 是合法值，null 是缺失）
  - 字段语义与真实样本/官方资料冲突 → 以真实样本+官方语义重新冻结，不猜
- 存储：resultJson versioned namespace（`reverseAsinEvidence`，writer `reverse-asin-evidence`），候选绑定 taskId + candidateId 冗余；不建 Prisma 表
- 消费：Workbench「竞品 Evidence」扩展（竞品 ASIN 绑定 Reverse ASIN 证据）

### 3.2 Keyword Mining Adapter

- 输入：真实 Keyword Mining XLSX（1 个 Seed 关键词报表）
- 字段优先范围（任务书已调研）：keyword / searches / purchases / purchaseRate / products / adProducts / supplyDemandRatio / bid / bidMin / bidMax / spr / titleDensity / wordCount / monopolyClickRate / cvsShareRate / avgPrice / avgRating / amazonChoice
- 字段级规则（设计即落实）：
  - `purchaseRate` 等 0–1 比例只在展示层 ×100
  - `supplyDemandRatio` 不 ×100
  - **不稳定/持续空值字段不强接**（如历史核对中的 avgReviews 等价缺陷字段）——样本验证后按真实出现率决定
  - 历史趋势属于独立报告，不得混入当前合同
  - ABA rank 等未被当前真实合同证明的字段不得自行补
- 存储：resultJson versioned namespace（`keywordMiningEvidence`，writer `keyword-mining-evidence`）
- 消费：Workbench「关键词 Evidence」扩展（Seed 维度）

### 3.3 Keyword Brief 可追溯增强（正式风险 #6）——**已完成（2026-08 本轮）**

- 人工确认后才能进入 Keyword Brief（现有流程已具备：listing-handoff save_keyword_brief）
- 可追溯字段已落地：`reportType / marketplace / month（数据期）/ evidenceRef / reportHash / asin`（可选，旧数据缺失 → undefined，读取侧按 unknown，不伪造）
- capturedAt（采集时刻）与 month（数据期）语义分离，测试断言不混淆
- 落点：listing-keyword-brief.v1 增量字段（向后兼容）；route 白名单安全（非字符串忽略）；Workbench 关键词区展示
- 状态：风险 #6 **部分关闭**（可追溯字段已实现；Reverse ASIN/Keyword Mining 报告类型的真实数据仍待样本）

## 4. 风险清单（样本验证前登记）

| # | 风险 | 说明 |
|---|---|---|
| K1 | 表头猜错 | 无样本时禁止写解析器；样本到位先做表头探测（Phase 1 方法：只读探测脚本） |
| K2 | 单位/比例猜错 | 0–1 vs 百分比、×100 规则一律等真实样本验证后冻结 |
| K3 | rankPosition/adPosition 对象结构误读 | 设计已防（显式读 .position），样本验证强制 |
| K4 | 0/null 混淆 | 沿用 fields normalize 语义；值级核对覆盖 |
| K5 | 跨商品/跨关键词串绑 | Preview → Human bind 人工确认门禁（复用 sellersprite-preview token 链模式） |
| K6 | 不稳定字段强接 | 按真实出现率决定字段清单，禁止为完整性强接 |
| K7 | 样本缺口无限期阻塞 | 向用户征集样本；无样本则 Phase 3/4 保持 NOT_PASS 状态登记 |

## 5. 测试计划（样本到位后执行）

- 表头探测（.tmp 只读脚本）→ 真实表头 vs 设计字段映射对账
- Golden fixture（脱敏）+ Parser Replay（沿用 Phase 1 golden 模式）
- **5 行值级核对**（任务书 Gate）：人工核对 5 行原始值 → normalized/display 一致性（比例、单位、0/null）
- 错报告拒绝（PS/CC 样本喂给 Reverse ASIN/Keyword Mining 解析 → 拒绝）
- 不串商品断言（实体绑定）
- 来源可追溯断言（source/asin/marketplace/month/dataPeriod/capturedAt 齐全）
- 全量验证（lint/tsc/test/build）

## 6. Gate 现状

| Gate | 状态 |
|---|---|
| 真实 XLSX 正确 | **BLOCKED_ON_REAL_SAMPLE**（无样本） |
| 错报告拒绝 | 待实现 |
| 5 行值级核对 | **BLOCKED_ON_REAL_SAMPLE** |
| 比例/单位/空值正确 | 待实现（设计已防） |
| 不串商品 | 待实现（人工绑定门禁设计） |
| 来源可追溯 | 设计已含（字段清单） |
| 全量验证 | 待实现 |

结论：`PHASE_3/4 = BLOCKED_ON_REAL_SAMPLE`（准备完成，Gate 完整达成待样本）；样本到位后按测试计划补齐并转 PASS。
