---
name: amazon-product-research
description: Conduct or explain the current state of an Amazon product research journey in the workbench, using only already-stored evidence (candidate snapshot, decision evidence, keyword evidence, research record). Use when the user asks what is known/unknown about a researched product, what evidence is missing, what the risks or conflicts are, or what to research next for a product task. It only reports the research stage, available evidence, missing evidence, risks, conflicts and the recommended next step; it never outputs an overall product score, a "definitely worth selling" verdict, or an automatic sourcing/purchase recommendation. Do not use it to write database records, modify research decisions, run AI, browse the web, or promote products.
---

# Amazon 商品研究（amazon-product-research.v1）

只汇报"研究到哪、缺什么、下一步补什么"。禁止回答"这个商品一定值得卖"。

## 目标

基于任务中**已保存的结构化证据**，输出当前研究阶段、已有证据、缺失证据、风险、冲突和建议下一步。本 Skill 是方法层规范：只读取 V3 Core 已冻结的读模型字段，不复制解析、哈希、评分或存储逻辑，不写任何数据。

## 前置条件

- 存在有效的商品研究任务（研究历史中的一条任务记录）。
- 任务结果包含 `sourceMeta`（候选来源元数据）。
- 能确认商品身份（见步骤 1）。
- 缺失任务或无法确认身份时，不开始任何分析，只报告前置条件不满足。

## 需要的 Evidence 与来源（8 步流程）

按顺序核对，每步只读下列字段；字段来自任务 `result` 的既有读模型：

1. **身份确认**
   - `sourceMeta.productBatchSnapshot.asin`、`.marketplace`、`.productName`
   - `sourceMeta.candidateSnapshot.id`
   - 身份不确定（asin 缺失、marketplace 非 US 等）→ **停止**，不输出任何结论。

2. **市场需求**
   - `sourceMeta.productBatchSnapshot.productFacts`：`price` / `rating` / `reviews` / `estimatedMonthlySales` / `estimatedMonthlyRevenue` / `rootCategory` / `rootCategoryBsr` / `subCategory` / `subCategoryBsr`
   - 字段缺失或为 null → 记为缺失证据，不猜测。

3. **竞争**
   - 竞品 Evidence（任务竞品列表，人工维护，最多 5 个）：竞品 ASIN 与备注。
   - 由 `productFacts` 可引出的价格带/评分/评论数对比只在已有证据内描述。
   - 无竞品维护 → 标记"竞品证据未维护"。

4. **关键词**
   - 已导入的关键词 Evidence（Reverse ASIN / Keyword Mining）：`keywordEvidence` 的报表类型、行数、主要关键词。
   - 任务里的关键词 Brief（`listingKeywordBrief`）：主关键词/辅助关键词/后台搜索词。
   - 未导入 → 标记"关键词证据未导入"。

5. **VOC（用户之声）**
   - V3 Core 未收集 VOC 结构化证据 → 固定标记"VOC 证据未收集（高频优点/痛点/场景/未满足需求均未知）"。
   - 禁止从评论数字或标题推测卖点/痛点。

6. **货源**
   - V3 Core 未收集货源证据 → 固定标记"货源证据未收集（类似产品/价格/MOQ/SKU/supplier 均未知）"。
   - 禁止编造采购价、供应商、MOQ 或供应链结论。

7. **Missing / Conflict**
   - `decisionEvidence.missingData`：缺失证据条目摘要。
   - `decisionEvidence.conflicts`：证据冲突条目摘要。
   - 两者均从任务已保存的 decisionEvidence 读取；无冲突不虚构冲突。

8. **Human Decision required**
   - `researchRecord.latestDecision`：`status`（creative_ready / needs_information / abandoned）与 `reason` / `nextAction`。
   - 无正式决定 → 标记"尚未形成正式人工决定"。

## 证据不足时怎么处理

- 字段不存在、为 null、未导入或未收集 → 该证据标记 `unknown`，写进"缺失证据"，**不猜测、不跨商品补值、不调用 AI 填空**。
- 单一字段缺失不影响其他步骤；身份（步骤 1）缺失则整体停止。

## 什么情况继续

- 步骤 1 身份确认通过，且至少存在一项市场需求证据（price/rating/reviews/BSR 任一非空）。

## 什么情况停止

- 身份无法确认（asin/marketplace 缺失或不一致）。
- 任务不存在、来源元数据缺失或任务状态异常。
- 停止时只报告停止原因，不输出部分结论。

## 什么情况必须人工判断

- 步骤 8 人工决定：是否继续研究、是否进入创作、是否放弃。
- 货源、合规、利润、物流、采购成本等任何无证据事项的结论。
- 竞品相关性判断（人工维护的竞品是否可比）。

## 输出结构（只输出以下内容）

### 当前研究阶段

- 已完成步骤（1–8 中已获得证据的步骤）与未完成步骤。

### 已有证据

- 逐步骤列出非空证据（身份/市场需求/关键词等），标注来源（候选快照 / 决策证据 / 关键词证据 / 人工决定）。

### 缺失证据

- 逐步骤列出 unknown 项（含 VOC、货源、合规、采购价、MOQ、物流等未收集项）。

### 风险

- 仅从已有证据可支撑的风险（如 `decisionEvidence` 中的风险条目、rating 偏低、reviews 少、BSR 靠后等事实性描述）。
- 禁止输出"风险很高所以不要做"类判断结论。

### 冲突

- `decisionEvidence.conflicts` 中的冲突条目；无则写"无记录到结构化冲突"。

### 建议下一步

- 基于缺失证据给出"下一步补什么证据"（如：补关键词报表、补竞品、补货源信息、人工确认品牌授权）。
- 只建议补证据或人工动作，**不替用户做商业决定**。

## 禁止推断范围

- 商品总评分、综合推荐指数、"值得卖 / 不值得卖"。
- 爆款概率、盈利预测、采购建议、上架建议、自动晋级。
- 从估算月销量推导真实订单、从评论数推导满意度、从标题/图片推测卖点或痛点。
- 编造合规/侵权/认证结论。
- 输出内部字段名、哈希、指纹或 snake_case 状态码。

## 版本

- 当前版本：`amazon-product-research.v1`（2026-08-15 冻结）。
- 版本纪律：每次修改记录依据、失效条件、修改原因、验收样本；禁止静默改历史语义。
- 失效条件：任务读模型字段结构变更（如 productBatchSnapshot / decisionEvidence / keywordEvidence / researchRecord 字段重命名或删除）、V3 Core 读模型契约废弃、或本 Skill 被新版取代。
- 验收样本：使用真实任务（如 John Boos 砧板研究记录）按本流程走查，输出必须落在上述白名单内，且 Wrong Entity 场景（身份不确定）必须停止。
