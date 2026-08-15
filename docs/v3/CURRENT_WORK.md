# CURRENT_WORK — 轻选工作台 V3 执行状态

> 主 Agent 维护的唯一权威状态文档（执行包 23_CURRENT_WORK_TEMPLATE.md）。

## 当前版本

- **V3 Core: Phase 0–6 全部 PASS → `V3_CORE = DONE`**
- **人工验收：`MANUAL_CORE_SMOKE = PASS`**（用户 2026-08-15 给出最终结论）
- **Core-Smoke-Fix.1：`CORE_SMOKE_FIX_1 = PASS`**（3 个 Smoke 缺陷修复完成，页面 Smoke A–E 全通过，提交 2c8afd3，docs/v3/changes/core-smoke-fix-1/）
- V3.x: 未授权（v3x_auto_start=false 硬约束；`V3X_AUTHORIZATION_REQUIRED = TRUE` 强制暂停中）
- Current Wave: Core 完成，暂停点
- Current Phase: —（暂停）
- Status: **HARD_PAUSE**（等待用户继续人工验收；未授权 push / V3.x / 公网部署）

## 权威基线

- repo_root: `D:\Workspace\projects\project-001-跨境电商AI工具\电商工具`
- main HEAD: 2c8afd3（Core-Smoke-Fix.1）
- origin/main: 76e2c96（main 领先 57 提交，**push 等待用户明确授权**）
- main clean: 是（`.env.local.bak-corrupt-*` 为排障备份，未跟踪）

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

| 问题 | 根因 | 修复 |
|---|---|---|
| ① 导入需手动选报表类型/类目 | 新格式 PS（无搜索排名）BSR>10 被判 unknown(ambiguous_ps_without_search_rank)，类目检测因此无输入 | BSR 值域三分支：>10→search_results（值域互斥确定性）、≤10→category_current、无值→人工；UI 三态提示（已自动识别/无法可靠识别请手动）；真实 Products(10) 实测自动识别成功 |
| ② 开始研究约 20 秒体感慢 | 3 步 AI 串行（sourcing/risk/summary）+ 前端一次性等结果 | sourcing‖risk 并行（实测串行 51.2s→并行 21.0s，省 59%）；渐进式 UI（点击 <1s 响应 + 真实进度提示）；计数按步独立跟踪 |
| ③ 待研究却提示无待研究商品 | ProductBatch 候选 researchAction=runtime_validation_required，前端只认 research_available | 统一权威判断 candidatePrimaryHref/isCandidateResearchActionAvailable（两处入口同源） |

- 页面 Smoke A–E（3005 真实页面）：全部 PASS；刷新无重复任务/重复 AI；Owner 实测 + Visitor 由既有权限测试覆盖
- 全量测试 4519 passed / 0 failed；tsc / lint / build：PASS

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

## 下一步（等待用户授权，三项之一）

1. **授权 push**：main（领先 origin 57 提交）→ origin/main
2. **授权「继续 V3.x」**：解除 V3X_AUTHORIZATION_REQUIRED，按 V3.1 Browser Evidence Spike → V3.2 → … → V3.6 推进
3. **授权「部署公网」**：仅当 V3_FINAL = DONE 后，按 28_PUBLIC_RELEASE.md 执行 Release R1
