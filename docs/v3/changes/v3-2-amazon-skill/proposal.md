# V3.2 — Amazon Product Research Skill（proposal）

## 目标

冻结 `amazon-product-research.v1`：V3 业务方法层第 2 个正式 Skill（第 1 个是 sellersprite-market-preview.v1）。
只回答"研究到哪、缺什么、下一步补什么"，不回答"这个商品一定值得卖"。

## 输入

- Candidate（sourceMeta.productBatchSnapshot / candidateSnapshot）
- Evidence Snapshot（decisionEvidence.items / missingData / conflicts）
- Keyword Brief（listingKeywordBrief）与关键词 Evidence（keywordEvidence）
- Existing Research Record（researchRecord.latestDecision）

## 输出（白名单）

- 当前研究阶段（8 步已完成/未完成）
- 已有证据（逐步骤，标注来源）
- 缺失证据（逐步骤 unknown 项）
- 风险（仅已有证据可支撑的事实性描述）
- 冲突（decisionEvidence.conflicts；无则明示）
- 建议下一步（只建议补证据或人工动作）

## 禁止输出

- 商品总评分 / 综合推荐指数 / "值得卖 / 不值得卖"
- 爆款概率 / 盈利预测 / 采购建议 / 上架建议 / 自动晋级
- 从估算销量推导真实订单、从评论数推导满意度、从标题推测卖点痛点
- 编造合规/侵权/认证结论、编造采购价/供应商/MOQ
- 内部字段名、哈希、指纹、snake_case 状态码

## 业务流程（8 步）

1. 身份确认（asin/marketplace/title/url/brand/category；不确定 → 停止）
2. 市场需求（price/rating/reviews/估算月销/估算月销额/BSR/小类 BSR）
3. 竞争（竞品 Evidence，人工维护；无则"未维护"）
4. 关键词（Reverse ASIN / Keyword Mining / 人工关键词 / 后续浏览器 Evidence）
5. VOC（V3 Core 未收集 → 固定 unknown）
6. 货源（V3 Core 未收集 → 固定 unknown）
7. Missing / Conflict（decisionEvidence.missingData / conflicts）
8. Human Decision required（researchRecord.latestDecision）

## 实现

- `skills/amazon-product-research/SKILL.md`：权威 Skill（frontmatter + 中文正文，含目标/前置/证据来源/不足处理/继续停止人工条件/输出结构/禁止范围/版本/失效条件/验收样本）
- `skills/amazon-product-research/SKILL.test.ts`：9 项契约断言（8 步顺序、白名单、禁止项、身份门禁、版本纪律、不复制内部逻辑、桥接指向）
- `.agents/skills/amazon-product-research/SKILL.md`：Codex 发现桥接（指向唯一权威）
- 不复制任何解析/哈希/评分/存储逻辑；不写数据、不调 AI、不浏览

## 版本纪律

- 版本：`amazon-product-research.v1`（2026-08-15 冻结）
- 每次修改记录：依据 / 失效条件 / 修改原因 / 验收样本；禁止静默改历史语义
- 失效条件：任务读模型字段结构变更、V3 Core 读模型契约废弃、被新版 Skill 取代

## 结论

**AMAZON_PRODUCT_RESEARCH_SKILL = APPROVED**（见 validation.md）
