# P0 — UI 基线与审计（V4.1 UI 产品化）

> 阶段定义（V4.1 指令书 §12 P0）：只读审计 + 改造前基线；**未修改任何业务代码**。
> 分支：feature/v4.1-ui-productization（起点 f552ef8 = v4.0.1 f223494 + 1 个本地 run-list 修复提交）；基线核对：origin/main=f223494、v4.0.0/v4.0.1 tag 未动、工作区干净、无不明修改。

## 0. 执行方式

- 三只只读子 Agent 并行审计（A=UI/路由，B=信息架构/文案，C=测试/安全/运行模式）；
- 根 Agent：真实浏览器改造前基线（桌面 1440×900 + 移动 390×844；本地 Local Live + 公网 Public Showcase）；
- 本文件由根 Agent 独占汇总。

## 1. 改造前基线（真实浏览器截图）

| 证据 | 路径 |
|---|---|
| 本地首页 · 桌面 | docs/v4.1/evidence/before-home-desktop.png |
| 本地 /replay · 桌面 | docs/v4.1/evidence/before-replay-desktop.png |
| 本地 /v4/runs · 桌面 | docs/v4.1/evidence/before-runs-desktop.png |
| 本地首页 · 移动 390×844 | docs/v4.1/evidence/before-home-mobile.png |
| 本地 /replay · 移动 390×844 | docs/v4.1/evidence/before-replay-mobile.png |
| 公网首页 · 桌面 | docs/v4.1/evidence/before-public-home.png |

根 Agent 观察（本地首页，flag ON）：
- H1「AI 跨境商品研究工作台」+ 副标题「从候选发现到 Listing 和图片准备…」（app/HomeDashboardClient.tsx:376-380）；
- 首屏主打「你的商品研究路线 · 五步完成一次商品研究」+ 01 发现商品/02 商品研究/03 人工决策/04 创作资料卡片；
- 无「Evidence」「V4」字样；无「真实脱敏案例回放」入口；侧栏 flag-on 时仅有「V4 研究图 → 运行控制台」，无 Replay；
- 移动端（390×844）：WorkspaceMobileNav 存在，但首页主体为 V3 叙事，Replay 不可发现。

## 2. 子 Agent B 审计结论（信息架构与文案）—— 要点

1. **首页像 V3 的根因**：app/page.tsx = V3.1 模式感知落地页，首屏内容全部来自三个 V3 组件：
   - GuestLanding（public 未认证首屏）：H1「3 分钟体验 真实商品研究案例」+「一键进入 THERMOS 金标演示」→ 直达 /tasks/金标任务，**无 Replay 入口**；
   - LoginPage（缺省模式）：H1「AI 跨境商品研究工作台」，含「AI 整理证据/人工决定」但为登录页；
   - HomeDashboardClient（local 已认证）：H1+五步路线（V3 语义），productLanguage() 是 V3 旧名翻译补丁（机会雷达→发现商品等）。
2. **可复用诚实文案资产**：components/v4/labels.ts（NODE_LABELS/STATUS_LABELS/WAIT_KIND_LABELS/EVENT_TYPE_LABELS 全部为流程状态标签）、ReplayView「真实脱敏历史案例回放/只读/不代表当前市场」、app/replay 页面文案——可直接用于首页/侧栏，无夸大表述。
3. **模式现状**：/api/runtime-mode 契约已存在（local_owner/public_showcase，缺省=local_owner 安全默认）；侧栏 isV4NavEnabled() 仅在 NEXT_PUBLIC_QX_V4_GRAPH_ENABLED=1|true 时显示「V4 研究图 → 运行控制台」，**任何模式都没有 Replay 入口**。
4. **风险文案**：首页/落地/Replay 无「自动选品/爆款/稳赚/自动上架/多 Agent/行业基础设施」正面表述（自动上架/自动选品均为否定句或边界声明）；唯一残留：V3「爆款」113 处（app/viral、ViralMockAgent、WorkflowNextStepCard「爆款雷达/爆款拆解」等旧功能名），建议 V4.1 收口时对用户可见处降级/改词。
5. **五秒理解缺口**（vs 指令书 §三/§六A）：首屏缺少「Evidence / Human Decision」作为主张抬头；「脱敏案例回放」资产未被首页/侧栏引用；公网主 CTA 进金标任务而非 Replay。

## 3. 子 Agent A 审计结论（UI/路由）—— 要点

1. **全局 Shell**：app/layout.tsx 仅 `<html lang=zh-CN><body>{children}`（无 Topbar/全局品牌标识）；WorkspaceSidebar（238 行）品牌卡为「轻选工作台 / AI 跨境商品研究工作台 / 辅助研究·人工决定」（V3 语义）；V4 段（L200-205）仅 isV4NavEnabled() 为真时渲染「V4 研究图 → 运行控制台 /v4/runs」；**移动导航不含 V4 项**。
2. **首页**：page.tsx（148 行）模式感知分发（public→GuestLanding|HomeDashboard；local noAuthOwner→HomeDashboard；缺省→LoginPage）；HomeDashboardClient（657 行）首屏 = Header（H1「AI 跨境商品研究工作台」）→ V3 金标演示卡（CTA→/tasks/{taskId}）→「五步完成一次商品研究」workflow 卡（全指向 V3 路径）→ 密码/解锁 → StatCard×3 → 推荐 → 新手 → 边界声明。**零 V4/Evidence/Fact Gate/Content Guard/Replay/Featured Replay 元素**。
3. **路由/组件图**：/v4/runs、/v4/runs/[runId] = server page（force-dynamic + isV4GraphEnabled 门禁）+ client 数据壳（RunListClient→api.ts fetch→RunListTable；RunConsoleClient→getRun/getReport/getFacts/getCommercial→RunConsoleView 含 PlanSummary/InterruptPanel/ErrorPanel/NodeFlow/BudgetMeter/FactGatePanel/CommercialPanel/GateBPanel/ContentReviewPanel/ReportPanel/EventStream）；/replay、/replay/[bundleId] = server page + 只读文件直读 data/replay-bundles（parseBundle+verifyBundleHash）→ ReplayView（ReplayTimeline + resolve* 系列）。
4. **可复用组件**：labels.ts（零依赖）、NodeFlow、RunStatusBadge、BudgetMeter、PlanSummary、EventStream、ScenarioCard/CommercialFormulaExpansion/RulesMeta/FactStatusBadge、ReplayTimeline+resolve*、RunListTable（绑定 RunSummary）；StatCard 为 HomeDashboardClient 私有未导出（需提取或重建）。
5. **所有权（对照 §11）**：WorkspaceSidebar/MobileNav/NavGroups + app/layout.tsx → 根 Agent；components/v4/api.ts → B 组（契约冻结）；labels.ts → 根 Agent（三组共用）；共享展示件（RunStatusBadge/BudgetMeter/NodeFlow/FactGatePanel/ScenarioCard/FactStatusBadge）→ A 组收口；page.tsx+HomeDashboardClient → A 实现、根 Agent 冻结 CTA/模式契约；flag 双源（NEXT_PUBLIC_QX_V4_GRAPH_ENABLED vs QX_V4_GRAPH_ENABLED）→ 根 Agent 统一。
6. **V3 回归入口已验证存在**：/api/demo/golden + /api/auth/guest + GuestLanding/DemoAccessBanner + 各测试；/opportunities*、listing-studio、image-studio、/tasks*、research、agent/run。
7. **缺口**：/replay 两页无 page.test；演示页（listing-studio/image-studio/tasks/research）无 page.test（仅 API 层）；移动导航无 V4/Replay 项；首页零 V4 元素直接违反 §三/§四。

## 4. 子 Agent C 审计结论（测试/安全/模式）——（待补）

## 5. 文件所有权表（草案，子 Agent A 复核后定稿）

| 文件/区域 | 所有权 |
|---|---|
| components/WorkspaceSidebar.tsx / WorkspaceMobileNav / app/layout.tsx | 根 Agent（共享高冲突） |
| app/page.tsx + components/{GuestLanding,HomeDashboardClient,LoginPage} 改造 | 子 Agent A（首页与 V4 展示组件） |
| app/v4/runs、app/v4/runs/[runId] 与 components/v4 运行面板 | 子 Agent B（Runs 体验） |
| app/replay、[bundleId]、components/v4/{ReplayView,ReplayTimeline,labels} | 子 Agent C（Replay 展示增强） |
| lib/v4/**、app/api/v4/**、prisma/**、package.json | 禁止修改（非目标范围） |

## 6. 风险与停止条件检查

- 未命中指令书 §16 停止条件（基线一致、无不明修改、不依赖 DB/API/公网 Live 实现、无敏感泄露）；
- 本地 .env.local 已启用 QX_V4_GRAPH_ENABLED=on + NEXT_PUBLIC_QX_V4_GRAPH_ENABLED=true（本地预览；公网部署保持 OFF，未改动公网环境）。

---
审计状态：A ✅ 已并入；B ✅ 已并入；C ⏳ 运行中（并入后定稿）。本文件不含任何业务代码修改。
