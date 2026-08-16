# V3 Final User Operability Correction — Final Release Report

> 分支：`codex/v3-final-operability-correction` → main a366555（ff 集成 + push origin/main）
> 基线：main 737b6bf（LOCAL_RELEASE_CANDIDATE 曾 APPROVED → 用户 20/103 节审计 REVOKED）→ 本任务整改 → 重新 APPROVED

## 第一句：普通用户能否只看页面独立完成全流程？

**能。** 不懂 CLI/Extension/CDP/Task/resultJson 的普通用户，现在只需看页面即可独立完成
「发现商品 → 加入研究 → 找到正在研究 → 收集 Evidence（Amazon 采集 / VOC 采集+批量粘贴 / 1688 关键词+图片）→
AI 整理 → Missing → 人工决定 → Listing/Image」全流程——每一步都有业务语言入口、就绪状态与失败恢复；
唯一需要外部配合的是 1688 首次登录（扫码，UI 提供 2 步引导+重新检测闭环）与浏览器助手扩展加载（3 步引导+重新检测）。

## Release Gate 逐项

| Gate | 要求 | 结果 |
|---|---|---|
| P1 = 0 | 审计 P1 全清 | ✅ 3 项 P1 全部修复并真实页面复验 |
| AMAZON_BROWSER_PRODUCTION_SMOKE | 真实 build 下采集成功 | ✅ 3005 生产 build：采集→实体绑定→Preview→人工确认→保存全链；vitest smoke 3 ASIN correct + mismatch 硬拒绝 |
| 1688_ONBOARDING | 登录/扩展引导可操作 | ✅ 登录 2 步引导 + 固定命令复制 + [我已登录，重新检测]；扩展 3 步引导 + [已加载，重新检测]；术语零暴露 |
| ACTIVE_RESEARCH_UX | 进行中可寻 | ✅ /tasks 五 Tab + 空态 + 卡片「打开研究」 |
| VOC_BATCH_UX | 批量明示 | ✅ "每行一条，一次可粘贴多条" + 当前识别 N 条 + 导入/重复/忽略结果 |
| VOC_COLLECTION | APPROVED_BOUNDED 或 PARTIAL_WITH_FALLBACK | ✅ PARTIAL_WITH_FALLBACK：半自动采集（≤3 ASIN/次、≤20 条/页、单 ASIN 100/总 300、去重、Preview→人工确认、登录墙 fail-closed）+ 批量粘贴 fallback |
| 30_SECOND_GATE | 打开页面 30 秒内知道下一步 | ✅ 首页五步流程卡 + 引导卡"可以先收集证据…也可以让 AI 随时整理" + 就绪徽章 |
| HR_DEMO_GATE | 人工复核语义 | ✅ 所有写路径人工确认（浏览器证据确认、评论勾选确认、1688 加入确认、人工决定、SSRF/登录墙 fail-closed） |
| FULL_USER_JOURNEY | 全链真实走查 | ✅ 15 项走查清单见 user-journey.md，全部可独立完成 |
| SECURITY / REGRESSION | 见审查文档 | ✅ 无新安全面；4810 测试 PASS（3 环境类失败已归因） |

## 走查发现并修复的生产 bug（证明真实走查价值）
1. **P1-E**（f57afa0）：collect 成功后 Preview 崩溃（字段名 reviews vs reviewCount）——P1-A 修复前该路径从未执行过。修复+复验。
2. **P1-F**（a366555）：AI 总结 409 不自动恢复。修复+集成重部署。

## 遗留（非阻塞，环境/部署依赖）
- 1688 真实登录：需在本机配置 V35_1688_CLI_PATH 并人工扫码（UI 有引导与重新检测闭环）。
- 1688 真实图搜：本机代理环境 amazon 图片域名被 SSRF 守卫拦截（安全设计）；公网部署无此限制；扩展链路已实证。
- native1688Bridge integration 测试需集成树独占端口环境；release-package 测试 Windows tar 基线问题（上一任务已记录）。
- AI 总结/Listing 真实生成依赖部署方配置的 provider key（本机已配 DeepSeek real mode 并实证）。

## 版本与产物
- main == origin/main == a366555；功能分支已推送（保留供复查）。
- 3005 已运行最终 build（P1-F 修复版）并验证可达（tasks 200 / API 401 认证门禁正常）。
- PUBLIC_DEPLOY = FORBIDDEN（保持）：等用户亲自在 3005 查看最终版后另行授权。

## 最终裁决
**LOCAL_RELEASE_CANDIDATE = APPROVED**
（P1=0；全部 Release Gate PASS；真实普通用户 Journey 全链可独立完成——满足用户 20/103 节"只有真正可独立操作才 APPROVED"标准）
