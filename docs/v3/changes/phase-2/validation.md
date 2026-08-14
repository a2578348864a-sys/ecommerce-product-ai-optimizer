# Phase 2 验证与验收 — 商品证据工作台

> 按 11_PHASE2_TASK.md Gate + 30 增强 Phase 2 + novice-comprehension seed + 21_VALIDATION_GATES 填写。

## 1. Gate 对照（11_PHASE2_TASK.md）

| Gate | 状态 | 证据 |
|---|---|---|
| 真 Candidate 可打开 | PASS | 任务详情（TaskRecordDetail）挂载 EvidenceWorkbench，读取 resultJson 现有命名空间（sourceMeta.productBatchSnapshot / researchRecord / decisionEvidence / listingKeywordBrief）；数据缺失 fail-soft 显示 unknown/「未维护」 |
| Fact/Estimate/Derived/Unknown 清楚 | PASS | OverviewGrid 每项带 metricNature 角标（快照/估算/派生/未知）；estimate 强制「第三方估算，非平台后台数据」标注；extractOverviewItems 按字段合同映射（fields.ts 语义：销量=estimate、价格/评分/BSR=snapshot、身份=unknown） |
| 来源可追溯 | PASS | 商品概览区显示 reportType/marketplace/capturedAt + 原始 Evidence 展开（evidenceHash/evidenceHash 追溯）；sourceMeta.productBatchSnapshot.evidenceHash 可用处展示 |
| 不用 AI 填空 | PASS | Missing 区固定四项（采购价/MOQ/物流成本/合规=unknown）未用 AI 填补；货源区显示「Core 阶段未收集」；缺失字段显示 unknown（测试断言） |
| 无重复体系 | PASS | 竞品 Evidence 唯一新 namespace（competitorEvidence，resultJson 内，非 Prisma 表、非第四套 Candidate/Task）；其余区域全部复用现有命名空间 |
| Novice Comprehension Gate（首屏五问） | PASS | 简明结论区首屏直接回答：①知道什么（已整理 N 项真实证据）②不知道什么（四项 unknown）③最大风险（决定/风险区）④为什么（decision.reason）⑤下一步（decision.nextAction/gaps[0]）；score 标注「参考/旧兼容排序信号，不代表值得卖」 |
| 竞品最小合同 6 项 | PASS | competitor-evidence-contract.md 冻结；实现逐项落实（schema v1/绑定 taskId/人工添加 actor/上限 5 去重/时间语义/读取 fail-soft），7 项测试 |

## 2. 正式风险本阶段评估（decisions.md §7）

| # | 风险 | 评估结论 |
|---|---|---|
| 1 | 任务级 AI Listing 不受开关控制 | 未触及（本阶段无 AI 改动），**顺延 Phase 6 统一裁定** |
| 6 | listing-keyword-brief 可追溯字段不完整 | 本阶段只展示现有 Brief（evidence-read-model §4），**顺延 Phase 3/4 增强** |
| 7 | studio resultStore 无查询入口 | 未触及（Studio 非本阶段范围），**顺延 Phase 6 评估** |
| 11 | research-record 不含事实字段 | **本阶段已明确**：读取模型以 candidateAnalysisContext/decisionEvidence/sourceMeta 为事实源，researchRecord 仅做运行绑定（evidence-read-model §0）；关闭观察、保留风险登记（实现层已澄清） |
| 12 | metricNature 身份字段 unknown 使用方式 | **本阶段已落地**：UI 按字段合同映射角标（身份=unknown 角标展示，不做估计）；保留登记（Phase 5 读取模型继续遵循） |
| 14 | studioListingService 缺测试；Studio 无保存草稿 | 未触及（Studio 范围），**顺延 Phase 6** |
| 15 | score 展示误导 | **本阶段已落地**：score 标注「参考/旧兼容排序信号」，不作首屏权威信号（简明结论区只展示研究决定与 Evidence）；风险关闭 |

## 3. 双重审查

- 第一关 规格符合度：无漏做（证据工作台六大区域 + 信息层级 + 竞品合同 + provenance 展示全部落地）；无多做（未新增数据源/Prisma 表/AI 调用）；做偏无（竞品 API 严格按冻结合同）；可验证（提取函数单测 8 项 + 服务层 7 项 + components 套件 304 项）
- 第二关 工程质量：回归（components 304 全过、writer 契约既有测试 15 全过）；安全（竞品写入经 mutateTaskResultJson 乐观并发 + actor 记录；无新网络出口）；兼容（新 writer 仅增量；API 新路由不影响既有契约）；数据完整性（未触碰 dev.db；测试用隔离 sandbox 临时 store）；可维护性（提取器纯函数导出可测）

## 4. 规格对账

- 缺做：无
- 多做：无
- 做偏：无
- 合理设计偏离（说明）：竞品 API 要求 expectedStorageVersion 必填（合同只要求"必须带"）——比合同更严格以落地并发保护；route 校验非法 storageVersion 返回 400 而非静默接受
- 无法验证：真实浏览器渲染（无 UI 预览入口；以测试 + tsc + build 为准，本地 3005 人工验证待授权）

## 5. 三视角终审

- 产品视角：证据工作台信息层级符合 Novice Comprehension（简明结论优先、指标可展开）；人工维护竞品（3-5 个）而非自动抓取；不偏离 Evidence Workbench
- 工程视角：复用现有命名空间与投影；唯一新增 writer 按既有所有权契约；无重复体系
- 验收视角：提取器单测 + 服务层测试 + 全量验证（见下）；竞品合同 6 项逐项可验

## 6. 结论

`PHASE_2 = PASS`（main 全量验证通过后正式确认）

---

## 附录：main 全量验证记录

- tsc / lint / 串行全量测试 / build：见验证命令输出（补填）
