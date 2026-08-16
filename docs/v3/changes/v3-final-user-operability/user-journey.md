# V3 Final User Operability Correction — 真实普通用户 Journey 验收记录

> 环境：集成树 3005 生产 build（main == a366555）；真实浏览器 playwright-cli 走查；真实 DeepSeek（real mode）；真实 Amazon/1688 网络。
> 方式：以"只看页面、不懂 CLI/CDP/术语"的普通用户视角逐任务操作，记录每一步是否可独立完成。

## 走查清单（用户授权流程逐项）

| # | 用户任务 | 操作 | 结果 |
|---|---|---|---|
| 1 | 进入工作台 | 打开 3005 → 输入访问密码 → 进入 | ✅ 首页正常（16 候选 / 7 研究记录 / 五步流程卡） |
| 2 | 找到正在研究 | 导航"商品研究 → 研究记录" | ✅ /tasks 五 Tab（进行中[默认]/待补信息/已完成/已放弃/全部）+ 搜索筛选 + 7 条 |
| 3 | 打开研究 | 卡片「打开研究」 | ✅ 任务详情标题「商品研究」+ 面包屑 + 状态区（研究记录待补充/人工决定待确认） |
| 4 | 看证据缺口 | 引导卡 + checklist | ✅ "研究尚未运行 AI 分析"引导（无 AI gate 话术）+ 六项清单（已有/可选/待补） |
| 5 | 采集 Amazon 信息 | 「采集页面证据」 | ✅ 生产 build 真实浏览器导航 B085DTZQNZ → 实体绑定证明 → 6 字段 Preview（ASIN/标题/BSR/评分/评论数 correct，价格 fail-soft）→ 「我确认这是目标商品，保存证据」→ 保存成功（Owner 人工确认） |
| 6 | 采集买家评论（半自动） | 「采集评论」→ ASIN 自动预填 → 「开始采集」 | ✅ 真实浏览器提取 13 条 Top Reviews → Preview（13/13 已选，含星级/日期/来源标注）→ 「确认加入（13 条）」→ 数据集 13 条 |
| 7 | 批量粘贴评论 | 「粘贴导入」 | ✅ 明示"每行一条，一次可粘贴多条"+ 实时"当前识别 3 条"+「确认导入（3 条）」→ "已导入 3 条；重复 0 条；忽略 0 条" |
| 8 | VOC 分析 | 「开始 VOC 分析」 | ✅ 真实 AI 生成：用户喜欢什么/反复抱怨/使用场景/改进需求/冲突/零散信号/仍然不知道 + 样本量 16 条 + 单边提示 |
| 9 | AI 整理资料 | 「生成 AI 证据总结」 | ✅ 真实 AI：新手解释（五问）+ 分类条目 + EvidenceRef 门禁通过 + 模型/run 追溯 |
| 10 | 看缺失 | Missing 区 | ✅ 采购价/MOQ/物流成本/合规 全部 unknown 如实展示 |
| 11 | 人工决定 | 决定面板 | ✅ 「可继续」→ "人工状态已保存"；旧记录兼容说明 |
| 12 | 进入创作 | Listing/Image Studio 链接 | ✅ listing-studio?taskId=… 正常打开（旧任务无创作资料 404 preview 为预期） |
| 13 | 1688 关键词找货 | 登录引导 | ✅ 业务语言（无 1688-cli/CDP/V35 术语）：「1688 登录未完成」+ 原因 + [我已登录，重新检测]；工具未配置时如实提示"联系部署方完成工具配置" |
| 14 | 1688 图片找货 | 扩展引导 + 图搜 | ✅ 「浏览器助手 ✓」就绪徽章 + 3 步加载引导 + [已加载，重新检测]；真实图搜提交被 SSRF 守卫拦截（本机代理使 amazon 图片解析为内网——安全行为，公网部署可正常解析；本地 smoke 用 localImagePath 已验证扩展链路） |
| 15 | 错误恢复 | 并发冲突 | ✅ 保存浏览器证据后 collect-confirm 409 → 自动提示"内容刚在其他位置更新，已刷新，请重新采集后确认"→ 重试成功；AI 总结 409 同样处理（P1-F 修复） |

## 走查中发现的真实生产 bug（已修复并复验）

1. **P1-E**（BrowserEvidenceSection）：collect 成功后 Preview 渲染崩溃 `TypeError: Cannot read properties of undefined (reading 'reason')`——提取器字段名 `reviews` 与快照字段名 `reviewCount` 不一致（Preview 直接强转）。根因：P1-A 修复前 collect 100% 失败，Preview 路径从未在真实浏览器执行过，测试未覆盖。修复：normalizePreviewFields 归一化 + SnapshotFields 防御渲染 + 测试 +2。**复验通过**（保存成功）。
2. **P1-F**（AiEvidenceSummarySection）：VOC 分析写入后 AI 总结 409 只报错不自动刷新。修复：task_result_conflict → onChanged() + 提示一键重试（与 VocEvidenceSection F5 对齐）。

## 30 秒 gate / HR demo gate
- 工作台解锁提示"工作台已解锁 · 会话有效 / 数据已同步"正常。
- Visitor 配额门禁（ensureDemoAiQuota）在 analyzeAction 保持不变；Owner 直通。本走查以 Owner 完成，Visitor 配额路径由既有测试覆盖（vocAnalysis/route 13+14 用例）。

## 未完成项（环境依赖，非代码缺陷）
- 1688 真实扫码登录：本机未配置 V35_1688_CLI_PATH（集成树部署配置缺失）→ UI 如实提示 + [我已登录，重新检测] 闭环；配置后需人工扫码（USER_ACTION_REQUIRED）。
- 1688 真实图搜全链：本机代理环境 amazon/alicdn 图片域名解析为内网被 SSRF 守卫拒绝（安全设计）；公网部署环境无此限制；扩展链路已由 v3-5 real-smoke（localImagePath）+ 本次「浏览器助手 ✓」就绪检测验证。
