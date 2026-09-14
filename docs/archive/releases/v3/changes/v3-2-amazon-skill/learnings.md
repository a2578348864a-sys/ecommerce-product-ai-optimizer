# V3.2 — Amazon Product Research Skill（learnings）

1. **原假设**：商品研究 Skill 应像 sellersprite-market-preview 一样编排某个 CLI。
   **实测**：商品研究没有独立 CLI——证据分布在任务读模型（productBatchSnapshot/decisionEvidence/keywordEvidence/researchRecord）；
   Skill 的正确形态是**方法层规范**（读既有读模型 → 输出白名单结论），不是命令编排。
   **最终规则**：业务 Skill 两种形态——CLI 编排型（sellersprite）与方法规范型（本 Skill）；按数据位置选择。
   **证据**：SKILL.md 只读字段引用；走查输出与页面一致。**失效条件**：未来出现商品研究 CLI 再评估编排。

2. **原假设**：8 步流程（身份/市场/竞争/关键词/VOC/货源/Missing/决定）需要 Skill 新建数据。
   **实测**：身份/市场/关键词/Missing/决定 5 步直接映射 V3 Core 读模型；竞争需人工维护；VOC/货源在 V3 Core **无数据源**。
   **最终规则**：无数据源的步骤固定标记"未收集"（unknown），不猜测、不补造——V3.4（VOC）/V3.5（1688 货源）落地前保持。
   **证据**：走查输出 VOC/货源=未收集。**失效条件**：V3.4/V3.5 提供结构化数据源后更新 Skill。

3. **原假设**：Skill 全文禁止词测试用 not.toContain 即可。
   **实测**：禁止推断范围节**必然列出**被禁止的词（声明禁止），全文 not.toContain 断言自相矛盾。
   **最终规则**：禁止项测试断言"禁止节显式声明" + "输出结构节不含结论句式"两层。
   **证据**：SKILL.test.ts 修正后 9/9。**失效条件**：无。

4. **原假设**：Skill 是纯文档，无需业务验证。
   **实测**：契约测试只证明结构；**真实任务走查**证明输出落在白名单且与页面一致（identity/whitelist/forbidden 4 断言）。
   **最终规则**：业务 Skill 必须同时过契约测试 + 真实样本走查（验收样本记录在 SKILL.md 版本节）。
   **证据**：walkthrough-report.json。**失效条件**：无。

5. **原假设**：V3 Skill 数量无约束。
   **实测**：06 契约明确上限 4（商品研究/关键词/VOC/货源），子流程并入现有 Skill 不拆分。
   **最终规则**：amazon-product-research.v1 冻结为第 2 个；keyword/voc/sourcing Skill 待各自阶段，不提前建。
   **证据**：06_BUSINESS_SKILL_CONTRACT.md §V3 Skill 数量上限。**失效条件**：用户授权修改上限。
