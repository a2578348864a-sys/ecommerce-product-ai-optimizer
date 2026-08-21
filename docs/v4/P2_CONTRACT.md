# P2 Market Research Skills — 冻结契约（Wave 0）

- executionBatch：V4-FINAL-R2-P2-20260821-2030；authorityChecksum：`848bc4f0…`
- baseCommit：`4e620a7`（P1 PASS 后 main）；Lead：契约/Tool 信封/Evidence 合并/Graph 与 Report UI 接线/真实账号调用/E2E

## 0. 设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 工具信封（06 契约）：ToolCall/ToolResult 类型冻结于 `lib/v4/tools/envelope.ts`（toolCallId/runId/questionId/toolName/toolVersion/targetEntity/marketplace/allowedDomains/requestedFields/maxSteps/timeoutMs/budget/inputHash/idempotencyKey；返回 status/observedEntity/data/rawArtifactRefs/capturedAt/cost/warnings/errors/nextAction） | 06_TOOL_CONTRACTS |
| D2 | 错误码复用 contracts.ERROR_CODES（13 个），Graph 将 AUTH_REQUIRED/CAPTCHA_OR_BOT_CHECK 映射 waiting_auth；WRONG_ENTITY/DOM_CHANGED → 停止该问题；RATE_LIMITED/TIMEOUT → 重试≤2；BUDGET_EXCEEDED → paused_budget | 06、P1 状态机 |
| D3 | 双模式 adapter：`recorded`（fixture 确定性回放，测试/CI 默认）与 `live`（真实浏览器/数据，仅当 Owner 授权且服务端开关开启；登录/验证码→waiting_auth 人工接管，绝不绕过） | P2 卡「敏感数据不提交仓库」+ 禁止自动扩展 |
| D4 | Amazon bounded adapter：复用 tools/collectors/amazon（browser-control/human-assisted/environment-gate/page-diagnostics/extract-*）作为执行层；每次导航后实体校验（host/marketplace/ASIN/关键词/页面类型），不匹配立即停；字段白名单、maxSteps、域名白名单、时间窗；推荐位/相似商品不得误收 | 06、RESEARCH_SKILLS_SPEC amazon-competitor-research |
| D5 | SellerSprite adapter：只读复用现有导入/候选/预览（app/api/opportunities/sellersprite-*、tools/upstream/sellersprite-preview.ts、XLSX案例 本地数据），不复制上传/解析；输出候选与市场指标（保留行号/列名/单位/文件哈希） | P2 卡「不复制上传与解析」 |
| D6 | Keyword adapter：复用 keywordEvidence 语义；输出 keyword/metricType/value/unit/period/source；exact/estimate/index 显式区分，禁止跨时间窗相加、禁止第三方热度冒充精确搜索量 | 06、spec |
| D7 | VOC adapter：复用 reviewEvidence/vocAnalysis 读取 + 采样规则；输出 sampleSize/samplingMethod/themes[频率+evidenceRefs]/scenarios/languagePatterns/biases；最小样本、去重、模板评论提示、版权最小化（仅短摘录/摘要） | 06、spec |
| D8 | Skills（05 十项标准）落为 `lib/v4/skills/registry.ts`（元数据+校验）+ `skills/v4/*.md` 文档：opportunity-prioritization、amazon-competitor-research、keyword-research、review-voc-analysis（本 Phase）；supplier/product-strategy/commercial/compliance 为 P3/P4 占位不实现 | 05、skill-specs |
| D9 | Evidence 合并（Lead 独占）：只有 Schema+实体+单位+来源+时间校验通过才合并；report factual sentence 必须全部带 evidenceRefs（硬指标 100%）；plan revision ≤2 自动修订 | 14、17 |
| D10 | 真实测试数据：3 个候选画像（证据充足/数据不足/冲突明显）用 fixture（脱敏，入库 gitignored 的 `.tmp/v4-fixtures/` 或测试内联）；真实数据仅本地 dev.db 既有候选，不提交 | P2 卡 |

## 1. 文件所有权（写入零重叠）

| Owner | 路径 |
|---|---|
| Lead | docs/v4/P2_*、lib/v4/tools/envelope.ts（冻结）、lib/v4/skills/registry.ts 骨架（冻结后交 A/B 填条目？——否：registry 由 Lead 收口）、lib/v4/report.ts（Evidence→市场报告 + evidenceRefs 校验）、app/api/v4 扩展（research 报告端点）、Run Console 报告 UI 接线、Graph 集成（lib/v4/graph.ts 的 tool dispatch 改接 envelope） |
| A（worktree codex/v4-p2-amazon） | lib/v4/adapters/amazon.ts（bounded adapter + 实体校验 + recorded/live 双模式）、lib/v4/adapters/amazon.test.ts、fixtures（脱敏）、skills/v4/amazon-competitor-research.md |
| B（worktree codex/v4-p2-market） | lib/v4/adapters/sellersprite.ts、keyword.ts、voc.ts + 各自测试 + fixtures、skills/v4/opportunity-prioritization.md、keyword-research.md、review-voc-analysis.md |
| C（只读） | 3 候选画像 fixture 规格 + injection/wrong-entity/gold eval 案例评审（report 返回，不写文件） |

A/B 不触碰：lib/v4/tools/envelope.ts、lib/v4/report.ts、lib/v4/graph.ts、app/api/v4、app/v4、components/v4、prisma、package*.json、V3.1 文件。不调用真实付费 Provider；live 模式仅本机受控浏览器，遇登录/验证码立即 waiting_auth。

## 2. 必测（Gate）

1. 正确候选完整研究（recorded fixture：机会优先级→Amazon→Keyword→VOC→带引用报告）。
2. 失败路径：WRONG_ENTITY、no_results、AUTH_REQUIRED、DOM_CHANGED、RATE_LIMITED、BUDGET_EXCEEDED（adapter 单测 + Graph 状态映射）。
3. 注入：网页/评论/XLSX prompt injection 不改变权限和计划边界（eval 案例）。
4. 报告引用完整性：factual sentence 100% evidenceRefs（report.ts 校验器测试）。
5. 刷新恢复 + 重复调用幂等（复用 P1 checkpoint/journal；新 adapter 幂等键）。
6. 真实浏览器 Owner 旅程到市场报告与 Gate A 前（Lead E2E：live 受控浏览或 waiting_auth 展示 + recorded 全链路；截图）。

## 3. 边界（禁止）

- 无验证码/反爬绕过、无自动登录、无全天采集、无自动采购/询盘/上架。
- 不开始 1688 Fact Gate / 商业计算 / 内容生成（P3/P4/P5）。
- 不输出“能卖/爆款概率”或无来源销量；第三方热度不冒充精确搜索量。

## 4. 执行顺序
1. Lead 冻结 envelope.ts + report.ts 骨架。2. 建 worktree。3. Wave 1 A/B/C 并行。4. Lead 逐个合并 + Graph/API/UI 接线。5. 门禁测试 + 真实浏览器 E2E。6. TASK_REPORT + Gate 判定。
