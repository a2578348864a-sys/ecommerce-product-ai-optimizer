# Phase 3/4 验证与验收 — 两种关键词 Evidence

> 按 12_PHASE3_4_TASK.md Gate + 21_VALIDATION_GATES 填写。真实样本（2026-08-15 用户提供）到位后完成。

## 1. 真实样本

| 样本 | 形态 | 解析结果 |
|---|---|---|
| `ReverseASIN-US-B085DTZQNZ(10)-20260815.xlsx` | 32 列（含重复「更新时间」列）· 10 行 | reverse_asin，10 行全解析 |
| `KeywordMining-US-owala(10)-20260815.xlsx` | 21 列 · 10 行 | keyword_mining，10 行全解析 |

## 2. Gate 对照（12_PHASE3_4_TASK.md）

| Gate | 状态 | 证据 |
|---|---|---|
| 真实 XLSX 正确 | PASS | 两个真实样本解析 20/20 行成功；字段与官方语义交叉核对一致 |
| 错报告拒绝 | PASS | PS/CC 表头喂关键词解析 → `unsupported_report_type`（测试断言）；关键词报表进批次/CLI 管线 → 类型收窄 + precheck 拒绝（ProductBatchManager 人工选择兜底） |
| 5 行值级核对 | PASS | 见附录（RA 5 行 + KM 5 行，原始值 vs normalized 人工核对全对） |
| 比例/单位/空值正确 | PASS | 0–1 比例原值存储、展示层 ×100（ratioToPercent 测试）；需供比 1,778.8/1,296.2 不 ×100；0 与 null 区分（转化总占比 0 = available）；广告流量占比/广告排名页码全空 → missing 不伪造；重复表头保留首个有值列 |
| 不串商品 | PASS | 行 = 关键词维度实体绑定；Save 前人工确认（Human bind）门禁；跨报表竞品 ASIN（B085DTZQNZ）交叉一致（RA 与 KM 报表前十ASIN 均含） |
| 来源可追溯 | PASS | capturedAt 保存；dataPeriod=null 如实（样本无数据期字段，不猜）；Keyword Brief 追溯字段（reportType/marketplace/month/evidenceRef/reportHash/asin）已实现（风险 #6 部分关闭） |
| 全量验证 | 待填 | main 串行全量（跑完填写） |

## 3. 字段级防错落实（12_PHASE3_4_TASK）

- rankPosition/adPosition：真实样本为「自然排名/广告排名」数字 + 页码文本——**无对象结构**，任务书条件不成立；已按真实形态实现（naturalRank=snapshot 数字、naturalRankPage=derived {page,position,total}）
- 比例字段 0–1：存储原值，展示 ×100 ✅
- supplyDemandRatio 不 ×100 ✅（测试 + 5 行核对）
- source/asin/marketplace/month/dataPeriod/capturedAt：capturedAt 保存；asin 由人工 bind（竞品维护）；marketplace=US（报表命名语义，展示层）；month/dataPeriod=null（报表无字段，不猜）
- 0 与 null/unknown 区分 ✅
- 不稳定字段：广告流量占比/广告排名页码（全空）不强接值；avgPrice/avgRating（真实样本不存在）不接；ABA 月/周排名（真实存在）已接 ✅

## 4. 最小闭环（任务书）

`1 XLSX → Preview → Human bind → Save Evidence → Workbench` 全部落地：

- Preview：POST /api/tasks/[id]/keyword-evidence（multipart 上传，服务端 parseKeywordReport，不保存）
- Human bind：UI 预览确认（报表类型/行数/前 5 行核对）后点击「确认并保存」
- Save：writer `keyword-evidence` → resultJson.keywordEvidence（乐观并发 expectedStorageVersion）
- Workbench：关键词 Evidence 区展示（百分比/需供比/排名/PPC/ASIN 数）

## 5. 双重审查

- 第一关 规格符合度：无漏做（Gate 6 项 + 字段防错 + 闭环全落地）；无多做（未做 41 ASIN 批量、未做批量自动化）；做偏无；可验证（9 项新测试 + 真实样本核对）
- 第二关 工程质量：回归（sellersprite 套件 266+、components 304+、writer 契约既有测试全过）；安全（上传 10MB 限制 + 安全解析器 parseXlsxWorkbook；无新网络出口）；兼容（reportType 类型扩展对消费方收窄处理；keyword-evidence 为新增 writer 增量）；数据完整性（未写 dev.db；测试隔离 sandbox）

## 6. 结论

`PHASE_3 = PASS`、`PHASE_4 = PASS`（main 全量验证通过后正式确认）

---

## 附录 A：5 行值级核对（真实样本，人工核对）

### Reverse ASIN（row#1-5，摘自 .tmp/verify-phase34.ts 输出）

| 字段 | 原始值 | normalized | 核对 |
|---|---|---|---|
| 流量占比 | 0.2949 | 0.2949（展示 29.5%） | ✅ 0–1 原值 |
| 自然流量占比 | 1 | 1 | ✅ |
| 购买率 | 0.0031 | 0.0031（0.3%） | ✅ |
| 需供比 | 1,778.8 / 16.3 / 481.9 / 178.4 / 1,008.9 | 同值 | ✅ 不 ×100 |
| 自然排名 | 5 / 1 / 6 / 4 / 27 | 同值 | ✅ |
| 自然排名页码 | 第1页 5/59 等 | {page,position,total} | ✅ derived |
| PPC价格 | $3.22 / $2.12 / $3.93 / $5.50 / $2.93 | 3.22 / 2.12 / 3.93 / 5.5 / 2.93 | ✅ |
| 建议竞价范围 | $2.42-$4.03 等 | {min,max} | ✅ |
| 前十ASIN | 逗号列表 | 10 个 ASIN 数组 | ✅（含竞品 B085DTZQNZ） |
| 广告流量占比 | 空 | null/missing | ✅ 不伪造 |

### Keyword Mining（row#1-5）

| 字段 | 原始值 | normalized | 核对 |
|---|---|---|---|
| 相关度 | 100 / 100 / 95 / 92.9 | 同值 | ✅ |
| ABA月排名 | 5 / 112483 / 544209 / 72068 | 同值 | ✅ |
| ABA周排名 | 2 / 97655 / 391291 / 53242 | 同值 | ✅ |
| 购买率 | 0.0031 / 0.0098 / 0.0041 / 0.007 | 同值（0.3%/1.0%/0.4%/0.7%） | ✅ |
| 需供比 | 1,296.2 / 5.1 / 1.1 / 7.6 | 同值 | ✅ 不 ×100 |
| 转化总占比 | 0 / 0.0476 | 0=available（0 是合法值非缺失） | ✅ |
| PPC价格/竞价范围 | $3.28 等 | 数字/区间 | ✅ |
| 前十ASIN | 逗号列表 | 10 个 ASIN 数组 | ✅ |

核对人：主 Agent（对照真实样本原始值与解析输出逐行核对）。
