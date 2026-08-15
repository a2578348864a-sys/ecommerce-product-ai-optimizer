# V3.4 — VOC / Review Evidence 最终报告

> 状态：**VOC = APPROVED** ｜ **V3_4 = DONE** ｜ **V3_4_INTEGRATION_READY = TRUE**（Final Integration Precheck + Supplement 通过，2026-08-15）
> **V3_4_NEGATIVE_RECURRING_REAL_SMOKE = PASS**（真实低星样本未形成共同痛点，系统正确未伪造 recurring——"没有足够证据"路径通过）
> 不 merge main / 不 push / 不部署；V3.1 worktree 未删除；V3.5/6 未授权。

## 第一句话（大白话回答）

**VOC 这块确实能帮用户看懂消费者**：把真实买家评论（当前商品或竞品）导入后，工作台直接告诉用户"喜欢什么 / 抱怨什么 / 什么场景用 / 哪些只是个例 / 还不知道什么 / 下一步研究什么"，每个结论都标了基于多少条评论、引用哪几条原文，且绝不冒充"用户普遍认为"。

## 34 项报告

| # | 项目 | 结果 |
|---|---|---|
| 1 | Review 数据从哪里来 | 人工导入（首选）+ 详情页公开 Top Reviews 片段（降级路径，真实星级/日期/标题） |
| 2 | 是否自动采集 | 否；human-assisted 单页浏览器获取 + 人工确认导入；无自动爬取 |
| 3 | 是否涉及登录/CAPTCHA | 评论页需登录 → **未绕过**（诊断证据 review-page-diag.txt）；详情页公开可用 |
| 4 | Review Evidence 合同 | review-evidence.v1 + voc-analysis.v1（contract.md 冻结） |
| 5 | ASIN binding | entityBindingProof（manual_confirmed/browser_verified/source_declared）+ ASIN 格式校验；走查 29 条全绑定 |
| 6 | Current Candidate / Competitor 区分 | sourceProductRole 强制字段 + UI 角色标签 + 自动测试 |
| 7 | 数据集上限 | 100/商品、300 总数、2000 字符/条、4KB/条、256KB/集；超限明确拒绝 |
| 8 | 去重 | reviewId 或 asin+contentHash+rating+date；重复导入幂等（走查验证） |
| 9 | 样本量 | DatasetStats 全字段（total/used/正负中/星级分布/评论期/商品数/角色数）+ UI 样本条 |
| 10 | Sampling | sampling.method/note/reviewsAvailable；采样时 UI 显示"仅使用 X/Y 条" |
| 11 | 正向主题 | positiveThemes（有 evidenceRefs 才输出） |
| 12 | 痛点主题 | painPointThemes（同上） |
| 13 | 使用场景 | usageScenarios（同上） |
| 14 | 冲突 | conflicts 双面证据 + 各自计数 + note 不裁判 |
| 15 | 零散信号 | weakSignals + strength 标签（1 条 isolated / 2-3 weak / 4+ recurring，UI 展示规则可配置） |
| 16 | evidenceRefs | 硬门禁：无效引用丢弃、全无效主题拒绝（unverified）；UI 展示"未采用" |
| 17 | reviewCount 是否 deterministic | 是；服务端按 evidenceRefs 计算，LLM 不写数量 |
| 18 | Prompt Injection | Review 全为 UNTRUSTED DATA 只进 user 字段；system 固定；G4 测试无结构泄漏 |
| 19 | Review → Fact 隔离 | nature=review_observation；全仓无 confirmedFacts 写入路径 |
| 20 | Listing 隔离 | 独立 namespace；本 Phase 未扩 Content Handoff；Skill 只读 |
| 21 | Research Skill 接入 | SKILL.md 升级：VOC available 时只读消费；不自动改 Decision、不评分、无 VOC 行为不变 |
| 22 | Workbench 新手体验 | 六区中文标题 + 主题展开回链原文/星级/ASIN/角色/日期/sourceRef；无 score/无"值得卖" |
| 23 | Golden Eval | G1-G4 全 PASS（重复痛点/正负冲突/样本太少/注入隔离） |
| 24 | 真实业务走查 | PASS：3 真实 ASIN、29 条真实 Top Reviews 全链路（实体绑定/去重/统计；正文折叠为已知限制） |
| 25 | AI provider / model | deepseek（现有 callAiJson 体系）；promptVersion=voc-analysis.v1 |
| 26 | token / 成本 | run trace 记录 tokenUsage；json_parse_error 仅重试一次；不循环烧 API |
| 27 | Owner / Visitor | mutateTaskResultJson 分流；跨 visitor 404；quota 沿用现有体系 |
| 28 | tests | 新增 43 用例全绿；全量 4639 passed（1 个已知 worktree 环境差异：release-package） |
| 29 | tsc | 0 errors |
| 30 | lint | 0 errors（4 条既有 warning 与本次无关） |
| 31 | build | 成功（worktree） |
| 32 | Git branch / commits / clean | branch codex/v3-4-voc-evidence @ 77c3135 基线；本地 commit 见 git log；worktree clean（commit 前） |
| 33 | 当前已知限制 | 评论页登录墙不绕过；详情页 Top Reviews 正文折叠不可见（标题级信息）；真实 AI Smoke 未执行（worktree 无密钥）——见遗留项 |
| 34 | 是否值得进入 V3.5 | 建议：V3.4 独立价值成立（真实评论可追溯分析）；V3.5（1688）为独立授权决策，不因本 Phase 自动推进 |

## 遗留项（如实记录）

1. ~~真实 AI Smoke 未执行~~ → **已闭环**（2026-08-15 Final Integration Precheck：真实 deepseek-v4-flash 调用 2 次，11 项验收 PASS；见 validation.md §4.1）
2. **评论页登录墙**：不绕过；详情页 Top Reviews 正文折叠不可见（标题级信息，已知限制）——真实低星评论样本受此限制（混合样本 28 高星/1 低星；Supplement 扩至 9 ASIN 得 4 条真实低星）
3. **Top Reviews 样本偏正向**：UI 星级分布图 + AI unknowns 显式提示偏差；用户可人工导入低星评论补足（导入时如实标注）
4. **真实 recurring negative pain point 未在真实样本中形成**（4 条真实低星主题各异）——系统正确输出 weak 而非 recurring（Supplement 已闭环：V3_4_NEGATIVE_RECURRING_REAL_SMOKE = PASS，路径 2）；若产品需要更强低星证据，用户人工导入低星评论即可
5. **Smoke 提取解析限制**：Supplement 探测中 Amazon 返回含 `<img .../> ` 字面前缀的 review 文本（布局差异）——已记录 learnings（#9），未改产品代码（人工导入链路对干净文本行为正确）

## Final Integration Precheck 结论（16 项）

1. 真实 AI provider/model：deepseek / deepseek-v4-flash
2. 调用次数：2（第 1 次暴露测试断言对 gateResult 语义误读——产品零改动；第 2 次完整验证；非调参循环）
3. token/cost：completionTokens=2206（第 2 次）
4. schema 一次通过：是（结构白名单解析成功）
5. evidenceRefs 验证：正式主题全部有 refs 且属于 Dataset；1 个无证据主题正确拒绝（unverified）
6. Review-Fact isolation：保持（无 fact 写入路径；禁止词 0 命中）
7. 混合星级 Dataset 规模：29 条（3 个真实竞品 ASIN）
8. 正/负星级分布：28 高星 / 1 低星（Top Reviews 机制天然偏正；如实记录）
9. 实际正向主题：7 个（heat retention 4、overall quality 6、design 3、size 1、versatile 1、no-leak 1、value 1）
10. 实际痛点主题：1 个（"Tear in the bag" count=1 → isolated）
11. 实际冲突：1 个（"Quality perception" 6 正 vs 1 负，双面展示不裁判）
12. 单条评论被强化：**否**（count=1 主题全部 isolated）
13. sourceProductRole 正确：全 competitor（3 竞品 ASIN）
14. Novice Comprehension 人工结果：A-F 六问全 PASS（见 validation.md §4.2）
15. tests / tsc / lint / build：targeted 全绿；full 4639 passed（1 已知环境差异）；tsc 0；lint 0 errors；build 成功
16. commit / worktree：`c221901` + 本 Precheck 增量 commit；worktree clean

**V3_4_INTEGRATION_READY = TRUE**

## 结论

**VOC = APPROVED**（真实 Review Evidence 进入工作台并被正确解释的核心价值已成立；评论页限制如实降级未绕过，AI 链路由 Golden Eval + mock 全链路验证）

**V3_4 = DONE** ｜ **V3_5_AUTHORIZATION_REQUIRED = TRUE** ｜ **V3_6_AUTHORIZATION_REQUIRED = TRUE** ｜ **PUBLIC_DEPLOY = FORBIDDEN**
