# V3.4 — Validation

> V3.4 VOC / Review Evidence 验证记录（任务书三十九节 PASS 门禁对照）。

## 1. 门禁对照

| 门禁 | 状态 | 证据 |
|---|---|---|
| Review Evidence 合同冻结 | PASS | docs/v3/changes/v3-4-voc/contract.md（review-evidence.v1 + voc-analysis.v1） |
| Review → ASIN 可证明 | PASS | entityBindingProof（manual_confirmed）+ ASIN 格式校验 + 走查 29 条全绑定 |
| Candidate / Competitor role 明确 | PASS | sourceProductRole 强制字段 + UI 角色标签 + 自动测试（route/组件） |
| 样本量显式 | PASS | DatasetStats 全字段 + UI 样本条 + 分析 datasetSnapshot |
| bounded dataset | PASS | 100/商品、300 总数、2000 字符、4KB/条、256KB/集；超限明确拒绝（测试） |
| 去重 | PASS | reviewId 或 asin+hash+rating+date；重复导入幂等（测试） |
| Prompt Injection 隔离 | PASS | Review 只进 user 数据字段；system 固定；G4 测试无结构泄漏 |
| VOC Theme 有 evidenceRefs | PASS | 无 refs 主题 → unverified 拒绝（测试） |
| reviewCount deterministic | PASS | 服务端按 evidenceRefs 计算；LLM 不写数量（vocAnalysis.ts + 测试） |
| 无证据主题拒绝 | PASS | validateVocOutput 硬门禁（测试） |
| 一条评论不升级为普遍痛点 | PASS | strength 阈值 isolated(1)/weak(2-3)/recurring(4+)（UI 展示规则，可配置） |
| Review 不转 Product Fact | PASS | nature=review_observation；无任何写入 confirmedFacts 的路径 |
| VOC 不直入 Listing confirmed facts | PASS | 独立 namespace；本 Phase 未扩 Content Handoff |
| Workbench 新手可理解 | PASS | 六区展示 + 主题展开回链 + 无 score/无"值得卖"（组件测试） |
| Product Research Skill 只读消费 | PASS | SKILL.md 更新 + 测试（不自动改 Decision、不评分） |
| Owner / Visitor 隔离 | PASS | mutateTaskResultJson 分流；跨 visitor 404（测试） |
| Golden Eval PASS | PASS | G1-G4 全部断言通过（vocAnalysis.test.ts） |
| 最小真实业务走查 PASS | PASS | 3 真实 ASIN、29 条真实 Top Reviews 全链路（smoke-evidence/walkthrough-result.json） |
| targeted tests PASS | PASS | 43 用例（数据层 13 + 分析层 13 + route 9 + 前端 7 + Skill 1） |
| full tests PASS | PASS | 4639 passed / 1 已知环境差异（release-package，worktree 无 BUILD_ID；集成树验证通过） |
| tsc PASS | PASS | 0 errors |
| lint PASS | PASS | 0 errors（4 条既有 warning 与本次无关） |
| build PASS | 待集成树 | worktree 未跑 build（依赖环境）；tsc 全绿 |

## 2. 测试清单（V3.4 新增 43 用例）

- `lib/server/reviewEvidence.test.ts`（13）：规范化/哈希/去重键/ASIN 校验/实体绑定构建/导入统计/去重幂等/per-ASIN 上限/总数上限/clear 联动清除分析/parse fail-soft/跨 visitor 隔离
- `lib/server/vocAnalysis.test.ts`（13）：强度阈值/evidenceRefs 硬门禁/无效引用丢弃/冲突双面证据/未知项与下一步/parse fail-soft/finalizeTheme deterministic/Golden G1-G4
- `app/api/tasks/[id]/review-evidence/route.test.ts`（9）：GET 空态/import 计数与版本/非法载荷/storageVersion 缺失/重复导入/analyze 全链路（mock callAiJson）/无数据 fail-closed/clear/跨 visitor 隔离/并发冲突
- `components/evidence/VocEvidenceSection.test.ts`（7）：投影解析/空态/六区渲染/角色区分/采样透明（"仅使用 2/10 条"）/单边样本提示
- `skills/amazon-product-research/SKILL.test.ts`（+1）：VOC 只读接入断言

## 3. 真实走查限制（如实记录）

- 评论页（/product-reviews/）当前环境需登录 → **未绕过**（诊断证据 review-page-diag.txt）
- 走查使用详情页公开 Top Reviews 片段：真实星级/日期/标题，**正文折叠不可见**（已知限制；不影响"评论证据真实可追溯"，但主题深度受限于标题级信息）
- 本 worktree 无 AI 密钥（不复制 .env*）→ **真实 AI Smoke 未执行**；AI 全链路由 mock callAiJson 的 route 测试 + Golden Eval 覆盖，真实 AI Smoke 留待集成树密钥环境（已记录为遗留项）
