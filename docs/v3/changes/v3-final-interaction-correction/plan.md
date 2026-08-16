# V3 Final Interaction & Research Navigation Correction — Plan

> 基线：main == origin/main == a9474ff（PLAYWRIGHT_FINAL_ACCEPTANCE 被用户手工反例 INVALIDATED；LOCAL_RELEASE_CANDIDATE=REVOKED）
> 分支：`codex/v3-final-research-interaction-correction`（独立 worktree）
> 原则：先真实浏览器复现 root cause，再一次性修复，最后 headed Playwright 真实 Journey 回归；不扩大成 V3.6/架构重写/UI redesign。

## 用户 7 个手工反例（全部先复现再修）

| 反例 | 复现结论（headed 真实浏览器） | 修复 |
|---|---|---|
| R1 1688 登录/重新检测无效 | "我已登录，重新检测"检测的是 LocalSession1688CliDriver(whoami) 而非普通 Chrome 1688 登录；bridge /health 只报扩展心跳；CLI 未配置时无闭环；点击无可见反馈 | Package A：两套登录态常驻说明 + 固定安全 capability begin1688KeywordLogin（["login","--headed"]、shell=false、detached、不捕获凭据）+ [打开 1688 登录窗口] + 重新检测反馈（正在检测…/刚刚检测 HH:MM + 分项结果）+ 图片找货如实说明 |
| R2 顶部 AI 整理按钮跳转 | href 硬编码 /opportunity-candidates（候选池链接伪装成 AI 动作） | Package B：删除顶部重复 AI trigger，唯一 AI 动作在「AI 证据总结」区，永不导航离开 Workbench |
| R3 旧版 Decision 无保存 | combobox onChange 自动保存、无按钮无状态 | Package B：下拉只改草稿 + 显式[保存旧版状态] + 未保存提示 + "仅更新兼容状态"说明；新版已有[保存新决定] |
| R4/R6 Listing/Image Studio 断链 | creative-handoff gate 对同 actor 旧版任务返回 legacy_not_supported → route 统一 404 → Studio 显示"不存在或无权限"；Listing/Image 共享同链 | Package C：gate 加 taskAccessible（不存在/跨 actor → 404 防枚举；同 actor 业务态 → 200+gateReason）；Studio 细分错误契约（legacy/decision_not_ready/blocked → 准确文案+[返回商品研究]）；旧版任务 CTA 隐藏 + 重新确认说明 |
| R5 商品研究/研究记录混用 | /tasks 五 Tab 混排、左侧无独立"商品研究" | Package D：/research（active 全集）+ /tasks（历史 only）+ classifyResearchLifecycle 统一分类 + Sidebar 拆分 + highlight + breadcrumb |
| R7 当前研究资料不同步 | evidenceCompletion 从初始 props 派生，EvidenceWorkbench mutation 不触发重算 | Package D：deriveResearchMaterialStatus 统一 resolver（Authority Matrix）+ onDataChanged 冒泡 → refreshKey 重拉 → 顶部自动更新；preview/AI 不参与判定 |

## Commit 拆分（已按 62 节）
1. `3487816` fix(sourcing): 1688 onboarding 真实 session 能力（R1）
2. `4f52a95` fix(workbench): AI summary 唯一动作 + Decision 显式保存（R2/R3）
3. `3b65f1e` fix(studio): 修复 research studio handoff 解析 + 停止假 CTA（R4/R6）
4. `1d93956` fix(workbench): 研究资料状态由已确认 Evidence 派生并自动同步（R7）
5. `114fd77` feat(nav): 拆分商品研究/研究记录（R5）

## Package E — Final Real Browser Acceptance
- 全量回归 / tsc / lint / build
- main 安全 ff 集成 + push（main==origin/main==FINAL_HEAD）
- 3005 重建（health 200）
- headed Playwright 逐反例真实验收（R1-R7 全 PASS）+ 全链 Journey + Visitor + 1688 专项（Playwright 不控制 1688 页面）+ Listing/Image 专项（existing + 新建 active task）
- 安全审查（login CTA 固定命令、SSRF、表达式注入、Studio isolation）
- 文档：plan / packages / user-journey / security / regression / final-report
- Release Gate 全 PASS 才 LOCAL_RELEASE_CANDIDATE=APPROVED；PUBLIC_DEPLOY=FORBIDDEN、V3_6=NOT_AUTHORIZED
