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

## 4. Final Integration Precheck（2026-08-15）

### 4.1 真实 AI VOC Smoke（PASS）

- 环境：V3.4 worktree + 集成树正式 AI 配置注入（不复制 .env*；密钥不落盘不打印）
- **调用次数：2 次**（第 1 次暴露测试断言对 gateResult 语义的误读——产品 fail-closed 行为正确、零产品代码改动；第 2 次为修正断言后的完整验证。非 provider 故障、非调参循环）
- provider/model：deepseek / **deepseek-v4-flash**；promptVersion=voc-analysis.v1
- token：completionTokens=2206（第 2 次运行）
- schema：一次通过（结构白名单解析成功）
- 11 项验收全部 PASS：
  - schema 可解析 ✓；白名单主题类型 ✓；正式主题均有 evidenceRefs ✓；refs 属于当前 Dataset ✓；不跨 ASIN（role=competitor 全一致）✓；current_candidate/competitor role 正确 ✓；reviewCount/coverage/strength 服务端 deterministic ✓；Review 非 Product Fact（无 fact 写入路径）✓；无禁止判断（值得卖/推荐上架/爆款/盈利预测/建议采购/转化率全 0 命中）✓；Prompt Injection 无指令权（G4 + 结构白名单）✓；run trace 完整（runId/model/promptVersion/inputEvidenceHash/tokenUsage/gateResult）✓
- **gateResult=fail 的真实含义**：1 个无证据主题（"No explicit requests"）被正确拒绝进 unverified（fail-closed 生效），其余 11 个有效主题保留。**未降低合同、未兼容坏结构**。
- 证据：smoke-evidence/ai-smoke-result.json + ai-smoke-replay.json（replay 模式零额外 AI 调用复验）

### 4.2 真实混合星级产品 Smoke（PASS）

- Dataset：3 个真实竞品 ASIN、29 条真实 Top Reviews（28 高星 + 1 低星——Top Reviews 机制天然偏正；低星来源受评论页登录墙限制，如实记录）
- 真实 AI 分析后 Workbench 视图人工审查（precheck-workbench-view.html）：
  - A. 小白能否一眼看懂喜欢/抱怨：**能**——六区中文标题 + 7 个正向主题（含强度标签）+ 1 个痛点主题
  - B. 结论基于多少条：**能**——"引用 X 条 · 占当前样本 Y%" + 样本条"样本：29 条"
  - C. 当前商品 vs 竞品：**能**——"竞品评论"角色标签 + "商品 3 个（当前 0 / 竞品 29）"
  - D. 单条负面标零散：**是**——"Tear in the bag" count=1 → isolated（"个例（1 条）"），未包装成普遍痛点
  - E. 冲突双面展示不裁判：**是**——"Quality perception" 正面 6 条 / 负面 1 条分列展示，note 不裁判
  - F. 星级/采样偏差提示：**是**——星级分布图 + AI unknowns 明确"样本高度偏正（28/29），不代表典型分布"；UI 自动偏差横幅覆盖纯单边场景
- 实际主题：正向 7（heat retention 4→recurring、overall quality 6→recurring、design 3→weak 等）、痛点 1（tear in the bag 1→isolated）、场景 4、冲突 1（quality perception 6v1）、零散信号 2（均 isolated）
- **单条评论未被强化**：痛点/零散信号 count=1 全部 isolated

### 4.3 合同未变

- Review != Product Fact（nature=review_observation 保持）；VOC 不进入 confirmedFacts/Listing/Image/material/certification/performance
- amazon-product-research.v1 只读消费，不自动修改 Decision
- 未开发采集能力：评论页登录墙不绕过；无爬虫/Extension/Cookie/CAPTCHA/登录自动化
