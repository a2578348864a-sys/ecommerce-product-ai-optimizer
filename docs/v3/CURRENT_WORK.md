# CURRENT_WORK — 轻选工作台 V3 执行状态

> 主 Agent 维护的唯一权威状态文档（执行包 23_CURRENT_WORK_TEMPLATE.md）。

## 当前版本

- **V3 Core: Phase 0–6 全部 PASS → `V3_CORE = DONE`**
- **人工验收：`MANUAL_CORE_SMOKE = PASS`**（用户 2026-08-15 给出最终结论）
- **Core-Smoke-Fix.1：`CORE_SMOKE_FIX_1 = PASS`（独立复核后恢复）**——问题 2/3 保持 PASS；问题 1 的 BSR≤10 合同假设被独立复核撤销，改为「无搜索排名一律 fail-closed + 多信号辅助建议」（提交 bbaf776 + edca2d9，证据矩阵见 docs/v3/changes/core-smoke-fix-1/report-type-evidence-matrix.md）
- **V3.1 Browser Evidence Spike：`BROWSER_EVIDENCE = APPROVED`**（human-assisted feasibility approved，非 autonomous crawling；worktree `电商工具-v3-1` branch `codex/v3-1-browser-spike` @ 1fa2029 保持隔离，未 merge）
- **V3.2 Skill：`AMAZON_PRODUCT_RESEARCH_SKILL = APPROVED`**（已集成 main，见 docs/v3/changes/v3-2-amazon-skill/）
- **V3.3 Browser Evidence Connector：`V3_3 = PASS` ｜ `V3_3 = DONE` ｜ `V3_3_INTEGRATION_READY = TRUE` ｜ `V3_3_REMOTE_CLOSEOUT = PASS`**（已集成 main + 已 push origin/main）
- **V3.4 VOC / Review Evidence：`VOC = APPROVED` ｜ `V3_4 = DONE` ｜ `V3_4_INTEGRATION_READY = TRUE` ｜ `V3_4_NEGATIVE_RECURRING_REAL_SMOKE = PASS` ｜ `V3_4_REMOTE_CLOSEOUT = PASS`**（已集成 main + 已 push origin/main）
- V3.5/6: 未授权（`V3_5/6_AUTHORIZATION_REQUIRED = TRUE` 强制暂停）
- Current Wave: V3.4 完成，暂停点
- Current Phase: —（暂停）
- Status: **HARD_PAUSE**（等待用户继续授权；未授权 V3.5 / 公网部署；V3.4 完成后再做产品价值评估，路线图非自动执行许可证）

## 权威基线

- repo_root: `D:\Workspace\projects\project-001-跨境电商AI工具\电商工具`
- main HEAD: **b05922d**（**V3.4 Remote Closeout：已 push 至 origin/main，2026-08-15**）
- origin/main: **b05922d**（main == origin/main，ahead=0 / behind=0）
- main clean: 是（tracked 无修改；`.env.local.bak-corrupt-*` 排障备份与 `data/demo-product-batches/` Visitor Smoke 运行数据为未跟踪产物，沿用已授权忽略）

## 最终报告

`docs/v3/V3_CORE_FINAL_REPORT.md`（24_FINAL_REPORT_TEMPLATE 填写）

## 人工验收排障记录（验收准备阶段，不改变 V3_CORE=DONE 语义）

| 提交 | 问题 | 根因 | 修复 |
|---|---|---|---|
| fb41af9 + 7a50f56 | 任务详情仍显示老界面 | Evidence Workbench 挂载在旧组件 WorkflowDecisionSummary（不生效） | 改挂到主组件 TaskRecordDetail（研究结论后、人工决定前），playwright 验证 7 区块渲染 |
| f3c6668 | 商品概览显示"暂无商品概览数据" | GET /api/tasks/[id] 的 sourceMeta 白名单投影缺 productBatchSnapshot / candidateSnapshot（数据本身完好） | sourceMetaSpec 补充两个嵌套投影；hash 字段按惯例输出 12 位指纹；imageSnapshot base64 不外泄 |
| 0d14d3e | 竞品/关键词/AI 总结接口浏览器 401 | evidence 三个组件 buildFetchHeaders 读错 key（qx:access-token）且发 Authorization: Bearer，而认证契约是 x-access-token | 统一改用 buildAccessHeaders()（x-access-token + x-access-password）；API 实测 200 |
| bc50f92 | 关键词保存"解析结果结构无效"；AI 总结门禁未通过（gateResult=fail、列表全空） | ① 关键词前端回传丢 schema 字段；② AI 总结 prompt 未给出输出 schema，deepseek 猜成 field/label/value 结构而校验器只读 text | ① 前端回传完整 report envelope；② prompt 显式输出 schema + 校验器 value→text 兜底；实测 gateResult=pass（17 条：3 facts/1 risk/7 missing/4 nextSteps） |
| 8f07915 | AI 总结偶发"生成失败"（502） | deepseek-v4-flash 偶发返回不可解析 JSON（实测 response_length=1929 json_parse_error，同样 prompt 下次成功） | json_parse_error 重试一次 + maxTokens 4000→8000 防截断；实测 gateResult=pass（4 facts/3 risks/7 missing/3 nextSteps） |

> 说明：任务 `cmstdm6px…` 的第 6 步"partial_failed only allows needs_information"非 bug——该任务是排障早期旧构建（AI 货源 token 预算偏小 → reasoning 吃满 → json_parse_error → fallback → partial_failed）生成。当前构建已修 token 预算（4000），实测 sourcing 返回合法 JSON（finish_reason=stop）。**验收需重新一键分析生成 completed 任务**再走第 4–9 步。

- 排障过程产物：`PROOF_SIGNING_SECRET` 已补入 `.env.local`（研究失败 `run_proof_unavailable` 根因，未提交）；候选/任务数据只读诊断，未写 DB。
- 验收前服务：由 `npm run start:local` 启动（计划任务指向旧 runtime-package，guard 校验固定 buildId 无法拉起新构建——历史遗留，最终报告说明）。

## Core-Smoke-Fix.1 摘要（docs/v3/changes/core-smoke-fix-1/）

| 问题 | 根因 | 修复（含独立复核） |
|---|---|---|
| ① 导入需手动选报表类型/类目 | 复核后：CC 与 PS 新格式表头完全相同（72 列），无确定性结构差异；BSR≤10 是有限样本规律非合同（官方 Top100/400 场景可 >10），原「BSR>10→PS」推导已撤销 | 无搜索排名一律 fail-closed 人工选择；搜索排名列为唯一 deterministic 信号；多信号（BSR 榜形态/单类目/月销高/BestSeller）仅作 UI 辅助建议（建议仅供参考）；对抗样本 cc-bsr-beyond-band 证明 BSR>10 不判 PS |
| ② 开始研究约 20 秒体感慢 | 3 步 AI 串行 + 前端一次性等结果 | sourcing‖risk 并行（实测 51.2s→21.0s）+ 渐进式 UI（<1s 响应）——**复核确认 PASS，未重构** |
| ③ 待研究却提示无待研究商品 | ProductBatch 候选 researchAction=runtime_validation_required 未被前端入口接受 | 统一权威判断 candidatePrimaryHref/isCandidateResearchActionAvailable——**复核确认 PASS，未重构** |

- 页面 Smoke：PS/CC 报表 manual + 建议提示实测正确；问题 2/3 Smoke B–E 保持 PASS
- **Visitor 最小 Smoke（复核新增）**：访客码登录 → 研究池空（无 Owner 串读）→ 导入 10 商品 → 研究页状态正确 → 未触发额外 AI
- 全量测试 4522 passed / 0 failed；tsc / lint / build：PASS

## 正式风险登记（decisions.md §7 终态）

| # | 风险 | 状态 |
|---|---|---|
| 1 | 任务级 AI Listing 开关 | **关闭**（handoff 后默认允许文档化裁定） |
| 2 | 旧 AI 入口配额盲区 | **关闭**（停新入口已生效，保留兼容） |
| 3 | Reverse ASIN / Keyword Mining 无实现 | **关闭**（Phase 3/4 实现） |
| 4 | category_current 快照硬编码 | **关闭**（CC 走批次链动态 reportType） |
| 5 | 旧 listing-copy 无 gate | **关闭**（停新入口） |
| 6 | Keyword Brief 追溯不完整 | **关闭**（Phase 3/4 追溯字段） |
| 7 | studio resultStore 无查询入口 | 保留登记（暂停点后授权处理） |
| 8 | listing-copy-history owner-only | 保留登记（产品决策） |
| 9 | 外部抓取出口无调用方 | **关闭**（保留兼容） |
| 10 | 真实 XLSX 不入 Git | 持续遵守（全程 0 命中） |
| 11 | research-record 不含事实字段 | **关闭**（读取模型边界澄清） |
| 12 | metricNature 身份字段 unknown | **关闭**（UI 角标落地） |
| 13 | research-decision PATCH 三值 | 已关闭（文档化） |
| 14 | studioListingService 缺测试/无保存草稿 | 保留登记（暂停点后授权处理） |
| 15 | score 展示误导 | **关闭**（标注参考信号） |

## 最终验证（V3_CORE = DONE 门禁 + 人工验收）

- lint / tsc / build：PASS
- tests：4519 passed / 0 failed（main 串行全量，含验收排障新增测试）
- 9 步 Core Smoke：自动化矩阵 PASS + 人工页面步骤文档化（validation.md §3）
- **人工验收：MANUAL_CORE_SMOKE = PASS**（用户 2026-08-15 实测：主链跑通、商品不串、数据正确、AI 不胡编、新手可懂、分数不误导）
- 验收反馈细节（验收点 D）：用户确认"未看到分数"——SellerSprite ProductBatch 候选 score 字段恒为 0（旧兼容字段，批次商品不评分），页面无 87/63 类数字，仅有"候选参考分 0（参考信号，不代表值得卖）"小字标注；**无分数可显示 = 无误导风险**，判定通过
- 3005：验收服务由 start:local 提供（异常进程 10596 已清理，密码校验恢复正常）
- 公网部署：NO；force push：NO；DB 写：NO；样本入库：NO
- 验收排障共修复 5 个真实 bug（见上表），全部经测试 + 页面实测

## 下一步（等待用户授权，三选一）

1. **授权「继续 V3.5」**：解除 V3_5_AUTHORIZATION_REQUIRED，按 V3.5 1688 推进（V3.6 Content Tools 同样需逐项授权；V3.4 完成后再做产品价值评估，路线图非自动执行许可证）
2. **授权「部署公网」**：仅当 V3_FINAL = DONE 后，按 28_PUBLIC_RELEASE.md 执行 Release R1
3. **V3.1 worktree 处置**：等用户单独决定 archive / delete worktree / retain for reference（本轮不自动处理）

> V3 Core Remote Closeout（2026-08-15）：main 已推送至 origin/main（d9c503e），形成远端 Core checkpoint。
> V3.3 Remote Closeout（2026-08-15）：V3.3 已正式集成 main 并推送至 origin/main（49c76d2，fast-forward 2e20581→49c76d2，无冲突/无历史重写）。
> V3.3 产品定位：**Local Human-Assisted Amazon Browser Evidence Connector**（本地服务启动隔离 Chrome → loopback CDP → Amazon 商品页 → deterministic extraction → Preview → Human Confirm → Evidence；**不支持**读取用户已开 Tab；`EXTENSION_NOT_REQUIRED_FOR_LOCAL_V1 = TRUE`，无 FOREVER 声明；公网部署 limitation 保留，见 docs/v3/changes/v3-3-amazon-browser-connector/integration-precheck.md）。
> V3.4 Remote Closeout（2026-08-15）：V3.4 VOC 已正式集成 main 并推送至 origin/main（fast-forward 77c3135→b05922d，无冲突/无历史重写；远端 checkpoint 见 v3-4-voc/final-report.md）。
> V3.4 记录：VOC = APPROVED；Real AI Smoke PASS（deepseek-v4-flash，replay 模式可复验）；Negative recurring real Smoke PASS（真实低星样本未形成共同痛点时系统正确未伪造 recurring）；Amazon Review 评论页登录墙继续不绕（人工导入是正式降级路径）；Top Reviews 有正向采样偏差（UI 显式提示）；Review != Product Fact、VOC 不进 Listing confirmedFacts 保持。
> V3.1 已验证能力已被 V3.3 选择性吸收（selectively absorbed），V3.1 worktree 仍隔离保留。
> `V3_5_AUTHORIZATION_REQUIRED = TRUE` ｜ `V3_6_AUTHORIZATION_REQUIRED = TRUE` ｜ `PUBLIC_DEPLOY = FORBIDDEN` 保持。
