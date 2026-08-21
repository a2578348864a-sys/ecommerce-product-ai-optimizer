# UI Contract（V4.1 UI 产品化 · P1 冻结）

> 依据 V4.1 指令书 §六（首页）、§七（Shell/导航）、§八（Runs）、§九（Replay）、§十（视觉）、§十三（浏览器验收）、§十四（测试覆盖）冻结。
> 冻结原则：每个 UI 字段都有真实来源或明确空态；禁止为填界面伪造字段；禁止把 74/5/11 硬编码为通用数据。

## 1. 首页模块顺序（两模式）

### A. Local Live（本地 flag ON / 已认证工作台）

1. 顶部品牌条 / Sidebar：轻选工作台 + V4 Badge + 模式 Badge：Local Live · 可执行研究流程
2. Hero：小标签 Evidence-first · Human-in-the-loop；主标题：AI 跨境商品研究与上架准备工作台；副标题：从市场机会、证据、产品事实到 Listing / Image；AI 完成研究，人做关键决策。；诚实边界：不预测爆款，不承诺盈利，不自动采购或上架。
3. 主 CTA：开始商品研究 → /v4/runs（创建入口，真实存在）；次 CTA：查看研究任务 → /v4/runs
4. V4 Workflow 主视觉：7 阶段（Opportunity → Market Research → Evidence → Human Gate A → Supplier & Product Facts → Commercial & Gate B → Content Preparation），突出三闸门：Evidence Gate / Product Fact Gate / Human Decision；不暗示全自动或确定性盈利
5. 四张核心价值卡：Evidence，而不是无来源答案；SupplierClaim 不自动成为产品事实；AI 提建议，人做商业决策；Listing/Image 只能读取已确认事实
6. Featured Replay 选例卡：真实 bundle 动态派生（见 §5 数据来源）；CTA：查看完整研究回放
7. 产品边界区：不保证销量/利润；Replay 为历史脱敏案例；公网不实时抓取；真实事实需供应商材料+人工确认；生成内容导出前须人工审核
8. 现有内容工具（降级区，非首屏主叙事）：V3 金标演示、Listing Studio、Image Studio、研究记录、商品研究

### B. Public Showcase（公网未认证首屏 = GuestLanding 改版）

1. Hero（同上标题体系）+ 模式 Badge：Public Replay · 只读脱敏案例
2. 主 CTA：查看真实脱敏案例 → /replay（一次点击）；次 CTA：了解研究流程 → 首页 Workflow 锚点
3. Workflow 主视觉（同 A，只读语境）
4. 核心价值卡（同 A）
5. Featured Replay 卡（同 A）
6. 产品边界区（同 A；另加：公网不会实时抓取 Amazon/1688）
7. 现有内容工具：金标演示保留（访客契约不变），降级为非首屏区块

### C. 缺省模式（登录页）

保持 LoginPage 功能；标题/产品说明升级为 V4 定位（登录页 H1 文案同步更换）。

## 2. 导航矩阵（侧栏/移动导航）

| 分组 | Public Showcase | Local Live（flag ON） | Local（flag OFF） |
|------|----------------|----------------------|-------------------|
| V4 工作台 | 案例回放 /replay | 研究任务 /v4/runs、案例回放 /replay | 案例回放 /replay（仅此） |
| 研究与决策 | （无 Live 入口） | 商品研究（/research 等现有） | 商品研究 |
| 内容准备 | Listing Studio、Image Studio | Listing Studio、Image Studio | 同左 |
| 历史功能 | 发现商品、待研究商品、研究记录 | 发现商品、待研究商品、研究记录 | 同左 |

- 公网不得出现「开始 Live Research」或可调用 /api/v4/* 的按钮/链接；
- flag OFF 时（含公网）不渲染「研究任务」「开始商品研究」（不泄露 Live 入口和 API）；
- 移动导航必须包含与桌面一致的 V4 项（当前缺失，P2 修复）；
- 当前页 active 状态与键盘 focus 可见。

## 3. 运行模式 CTA 矩阵

| 模式 | 主 CTA | 目标 | 次 CTA | 目标 |
|------|--------|------|--------|------|
| Public | 查看真实脱敏案例 | /replay | 了解研究流程 | 首页 Workflow 锚点 |
| Local Live | 开始商品研究 | /v4/runs（创建） | 查看研究任务 | /v4/runs |
| Local OFF | （不显示 Live CTA） | — | 案例回放 | /replay |

## 4. 文案真值表（不可夸大清单）

- 允许：Evidence-first · Human-in-the-loop；AI 完成研究，人做关键决策；不预测爆款，不承诺盈利；只读脱敏案例；历史回放不代表当前市场；不实时抓取；Listing/Image 只能读取已确认事实；SupplierClaim 不自动成为产品事实。
- 禁止：自动选品/自动发现爆款/自动赚钱/自动采购/自动上架/自动投放/多 Agent 操作系统/Amazon 行业基础设施/高胜率/稳赚/必卖；LangGraph、Checkpoint 等技术名词作为首页主卖点。
- V3「爆款」文案：用户可见的 app/viral、WorkflowNextStepCard 等收口时降级/改词（内容方向/趋势拆解），不与 V4 首页混淆。
- 复用 labels.ts 的 NODE_LABELS/STATUS_LABELS/WAIT_KIND_LABELS 作为流程状态（真实、无夸大）。

## 5. 页面数据来源表（只读）

| 字段 | 来源 | 规则 |
|------|------|------|
| Featured Replay 卡：bundleId/回放时间/来源 Run/脱敏状态/时间线步数/人工决策数/Guard 数 | 服务端只读 loader 复用 /replay 逻辑：读 data/replay-bundles/*.json → parseBundle → verifyBundleHash → resolveMetrics | 全部动态派生；无合法 bundle → 诚实空态；不硬编码 74/5/11 |
| Hero 模式 Badge | /api/runtime-mode（服务端权威） | 沿用现有契约；避免组件自行猜 env |
| 首页 Runs 统计 | （不强行展示） | 当前 API 未返回的字段不显示；如展示必须来自 /api/v4/runs 且 flag ON |
| Workflow 阶段/闸门 | 静态产品叙事（组件常量） | 仅文案；不造假进度/步骤计数 |

## 6. 不可伪造字段清单

- 时间线步数、人工决策数、Content Guard 数、scanOk、脱敏字段数、bundle hash：仅从真实 bundle 派生；
- 任何伪进度条；任何星级/评分冒充真实数据；任何「当前状态/统计」数字无 API 来源即省略或空态。

## 7. E2E 验收矩阵（§十三，P0-C 定稿）

- Public：/ 首屏 V4 定位+Evidence/Human Decision+Public Badge；主 CTA 无滚动可见；一次点击进 /replay；真实 bundle 74 步/5 Gate/11 Guard/blocked/hash/脱敏；刷新一致；console 0；**网络断言**（P0-C 定稿）：允许 = 页面文档 + RSC 预取 + 静态资源 + /api/runtime-mode（自带探针）+（点击后）/api/auth/guest、/api/demo/golden（金标演示区）；**禁止** = /api/v4/*、Owner 会话端点、Browser 端点、Amazon/1688、/api/tasks/*（评审白名单外）、任何写 API；不消耗访客 Provider 配额。
- Local：flag OFF→V4 API 404 + 不渲染 Live CTA；flag ON→Local Live Badge + 主 CTA 进 /v4/runs；列表/详情可走；Evidence/Gate/Fact/Commercial/Content 可理解；interrupt/resume 不回归；console 0；刷新一致；无重复 Provider 副作用。
- V3 回归：访客入口、Listing/Image Studio、研究记录可用；配额契约不变；/api/opportunities 根 410 保留；B1 creative gate fail-closed。

## 8. 视觉与无障碍规范（§十 摘录）

- Teal/Blue/Amber/Rose/Slate 颜色语义沿用现有 Tailwind 组件体系；不引入大型 UI 依赖；
- 语义化 heading；键盘可达；focus 可见；状态不只靠颜色；对比度合格；icon-only 控件 aria-label；prefers-reduced-motion；移动端触控目标不小于 44px；390×844 无横向溢出。
