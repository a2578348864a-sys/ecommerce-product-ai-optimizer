# Phase 3/4 阶段学习（learnings.md）

> 依据 22_CHANGE_PACKAGE_AND_LEARNING.md：只沉淀有代码/测试/真实样本证据支持的条目。

1. **原假设**：Reverse ASIN 的 rankPosition/adPosition 是对象结构（任务书防错要求）。
   **实测**：真实样本（32 列）是「自然排名/广告排名」数字 + 「自然排名页码」文本（第1页 5/59）——**无对象结构**；任务书条件是「若真实样本如此」。
   **最终规则**：防错规则按真实形态落地：naturalRank=snapshot 数字；naturalRankPage=derived {page,position,total}；不强行套用对象结构。
   **证据**：.tmp/probe-phase34.ts；keywordReports.ts naturalRankPage 解析。
   **失效条件**：SellerSprite 导出结构变化。
   **下一阶段加载**：无需（合同已按真实样本冻结）。

2. **原假设**：Keyword Mining 的 avgPrice/avgRating 等字段应尽量接入。
   **实测**：真实 21 列样本**没有** avgPrice/avgRating；ABA月排名/ABA周排名**存在**（任务书曾怀疑 ABA rank 不存在）；广告流量占比/广告排名页码（RA）全空。
   **最终规则**：字段清单以真实样本出现为准：有的接、全空的不强接、没有的不补；ABA 月/周排名按真实合同接入。
   **证据**：.tmp/probe-phase34-values.ts（每列 nonEmpty 统计）；keywordReports.ts。
   **失效条件**：—。
   **下一阶段加载**：Phase 5（AI Summary 输入字段白名单）。

3. **原假设**：重复表头（更新时间×2）会污染解析。
   **实测**：RA 样本第 13、16 列都是「更新时间」，第 13 列有值、第 16 列全空。
   **最终规则**：表头索引保留**首个出现**的列（有值列），重复列忽略；测试覆盖。
   **证据**：keywordReports.ts indexOf 构建；keywordReports.test.ts。
   **失效条件**：—。
   **下一阶段加载**：持续（任何报表解析）。

4. **原假设**：0–1 比例字段存储时转百分比更直观。
   **实测**：真实样本原值为 0–1（0.2949/0.0031），且 0 是合法值（转化总占比 0）。
   **最终规则**：**存储保持 0–1 原值**，仅展示层 ×100（ratioToPercent）；0 与 null/empty 严格区分（0=available，空=missing）。
   **证据**：keywordReports.ts RATIO_FIELDS + normalize；5 行核对附录。
   **失效条件**：—。
   **下一阶段加载**：Phase 5 AI Summary 输出同一语义。

5. **原假设**：需供比（supplyDemandRatio）可能像 SPR 一样是百分比。
   **实测**：真实值 1,778.8 / 1,296.2——**是比率，不 ×100**（任务书规则验证）。
   **最终规则**：原值存储展示，禁止 ×100；测试断言。
   **证据**：keywordReports.test.ts（1778.8/1296.2）；5 行核对。
   **失效条件**：—。
   **下一阶段加载**：Phase 5。

6. **原假设**：报表类型扩展（reverse_asin/keyword_mining）会破坏 PS/CC 管线。
   **实测**：detect 先查关键词签名（与商品报表表头互斥）；precheck/CLI/批次管线对关键词报表**拒绝**（unsupported_report_type + 类型收窄），ProductBatchManager 人工选择兜底——错报告拒绝成为显式 Gate 而非意外。
   **最终规则**：新报表类型走独立管线（keywordReports），不进商品报表管线；类型扩展点对消费方逐个收窄。
   **证据**：reportType.ts detectKeywordReportType；precheck structuralErrors；ProductBatchManager 收窄。
   **失效条件**：未来商品报表管线需要支持关键词报表。
   **下一阶段加载**：持续。

7. **原假设**：跨报表实体一致性难以验证。
   **实测**：RA 与 KM 两个报表的「前十ASIN」都含竞品 B085DTZQNZ（文件名的 ASIN），且行内容交叉一致——实体绑定的人工核对有交叉验证基础。
   **最终规则**：报表与竞品 ASIN 的绑定由 Workbench 人工维护（竞品 Evidence 功能）完成；解析器不信任文件名（沿用 Phase 1 原则）。
   **证据**：verify-phase34.ts 输出（top10Asins 两报表均含 B085DTZQNZ）。
   **失效条件**：—。
   **下一阶段加载**：V3.2 Skill（竞品研究）。

## 下一阶段是否需要加载

2/4/5 对 Phase 5 必载（AI Summary 字段与数值语义）；6 对 Phase 5/6 持续；3/7 持续。
