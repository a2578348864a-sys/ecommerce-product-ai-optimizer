# V3 Final User Operability Correction — Plan

> 基线：main == origin/main == 737b6bf（上一任务 LOCAL_RELEASE_CANDIDATE 重新 APPROVED 后撤回）
> 权威审计：`docs/v3/V3_FINAL_USER_OPERABILITY_AUDIT.md`（P0=0，P1=3：OA6/OA7（Amazon 生产 100% 失败+泄漏）、OA4（1688 onboarding）、OA1（Active Research 入口）；P2=4：OA2/OA3/OA5/预填）
> 原则：无 DB migration、无架构重写、不新建 review crawling platform；self-contained 表达式优先；错误双层（用户文案+诊断日志）；禁止技术串直出；每个 Package 后 targeted/tsc/lint + commit（Commit 0-6 策略）
> 授权：GOAL MODE（普通问题自行解决；仅扫码/CAPTCHA/登录墙/扩展安装/destructive/安全风险才 USER_ACTION_REQUIRED，最多 1-3 个）

## Package A — Core Operability Bugs（P1，最先；Commit 1-2）
- OA6：`fn.toString()` → 生产 minify 破坏（root cause 实证：`${z(s)}`）；browser 端代码改为显式字符串工件（detail-page/search-page expression-source + `__OPTIONS__` 占位替换 + production-bundle.invariant.test）
- OA7：错误双层机制（`lib/client/apiErrorMessage.ts` code→用户文案 + fallback）；browserEvidenceCollect / sourcingAcquisition / sourcingImageAcquisition / 10 个 evidence route 的 expectedStorageVersion 泄漏清理
- 四区（keyword/browser/voc/aiSummary）SectionStatusBar loading/error/retry；AiEvidenceSummarySection 重新生成失败也渲染 error；全库 fetch AbortSignal.timeout（普通 60s / AI 120s）

## Package B — Navigation / Active Research（Commit 3）
- Option B：/tasks 内部四 Tab（进行中/待补信息/已完成/已放弃/全部），零新路由
- 标题「商品研究记录」→「商品研究」（无 researchRecord 时）；CTA 统一（AI gate 文案删除：AI 是"整理当前已有资料"非 gate）
- Evidence Completion State：research-evidence-checklist（商品基础资料/竞品/关键词/Amazon 页面/买家评论/供应线索）

## Package D — 1688 Onboarding（Commit 4；与 C 独立）
- SourcingEvidencePanel 业务优先：三入口就绪徽章（1688 登录 / 浏览器助手）；need_login → 2 步登录引导 + 服务端构造固定命令（loginHint）+ 复制 + [我已登录，重新检测]；Image 扩展 3 步引导 + [已加载，重新检测]
- 术语隐藏：UI 与用户可见服务端消息彻底移除 1688-cli / Qingxuan / V35 / CDP 等

## Package C — VOC / Automation UX（Commit 5）
- 批量粘贴显性化：每行一条可多条 + 当前识别 N 条 + 结果 导入/重复/忽略
- VOC ASIN 预填：review-evidence GET 返回 taskAsin；角色=当前商品自动预填
- 半自动 Review Collector：review-snippet-extract 自包含工件（P1-A 机制）+ collect/collect-confirm（Preview 服务端缓存、跨主体/任务 fail-closed、单次 ≤3 ASIN × ≤20 条、browser_verified 绑定、去重标记、登录墙 fail-closed）

## Package E — Final User Journey Acceptance（Commit 6-7）
- 全量回归 / tsc / lint / build + production-bundle.invariant（全 chunk 扫描）
- 真实浏览器 Amazon production smoke（RUN_V33_BROWSER_SMOKE / RUN_V34_REVIEW_SMOKE）
- 真实普通用户 Journey（3005）逐任务走查：找商品→加入研究→找到正在研究→收集 Evidence→Amazon 采集→VOC→1688 找货→AI 整理→Missing→人工决定→Listing/Image
- 安全审查（expression injection / review prompt injection / 1688 login CTA 固定命令 / 泄漏）
- 文档：plan / package-a-d / package-b / package-c / user-journey / security-review / regression-review / final-report + 审计 Resolution references
- main 集成（fetch 确认 737b6bf → ff）+ push + 3005 切换最终 build
- 最终 Report 第一句回答"普通用户能否只看页面独立完成全流程" + LOCAL_RELEASE_CANDIDATE 裁决
