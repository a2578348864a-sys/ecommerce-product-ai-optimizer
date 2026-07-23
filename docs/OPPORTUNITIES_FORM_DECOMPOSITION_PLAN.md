# OpportunitiesForm 分阶段拆分方案

> Source baseline：`origin/main` commit `00e937d7bbc1bb44a9abe5846a85b3d44a988f97`，tree `f17ee10bbf5448edaa890eff219e6ce8f887f3c6`
>
> 制定日期：2026-07-23。本文只定义 module/interface/seam/adapter，不授权当前任务继续拆分主逻辑。

## 1. 原则

- 深 module：小 interface 隐藏复杂实现；
- interface 同时包含类型、authority、顺序、错误和恢复约束；
- seam 只放在有真实变化或测试 adapter 的位置；
- 纯规则由 domain module 提供，视图不复制；
- 旧实现被替换后不长期双轨。

## 2. 已完成准备，不是主逻辑拆分

- 系统、state、Effect、网络、Storage 和权限地图；
- 公开 surface SSR 行为测试；
- local→server→Agent→Task 跨 module 合同测试；
- SourceProof fail-closed 测试隔离；
- 一个纯删除 presentation seam。

29 个 state、5 个 effect、9 个 fetch 和渲染 DOM 层级均未调整。

### Phase 1A：未解锁展示叶子（已完成）

本次只提取 `OpportunitiesLockedPreview`，容器保留 `!unlocked` 条件与 surface 文案派生。原容器区域约 144 行；新叶子 171 行，只接收只读文案并返回既有 JSX。

|候选|原范围|输入/输出|副作用|决定|
|-|-:|-|-|-|
|未解锁功能预览|约 144 行|只读 surface 文案 → JSX|无 Hook、callback、I/O 或 authority 数据|选择；interface 最小且同一 SSR 测试可在提取前后复用|
|解锁后 header/连接提示|约 72 行|surface、fixture、连接状态、toggle → JSX|透传添加区 callback；含降级状态条件|拒绝；行为与权限降级展示面更大|
|结果摘要/header|约 57 行|Candidate 派生摘要、复制/导出 callback → JSX|含多个领域派生值与命令|拒绝；领域标签和 callback 漂移风险更高|

Phase 1A 不代表整个 Phase 1 完成；后续叶子必须单独立项。29 个 state、5 个 effect、9 个 fetch、2 个直接 localStorage 数据域、公开 props、API 和权限数据流均未变化。

### Phase 1B：候选品池决策摘要（已完成）

本次只提取 `OpportunitiesDecisionSummary`。容器保留 `buildDecisionDeskSummary(poolItems)`、memo 与全部 Candidate 状态解释；新叶子只接收一个只读 summary 并返回原五项摘要 JSX。

|候选|原范围|输入/输出|副作用|决定|
|-|-:|-|-|-|
|候选品池五项决策摘要|约 14 行|只读 `DecisionDeskSummary` → JSX|无 Hook、callback、I/O 或 authority 数据|选择；公开 fixture 可在提取前后复用同一 SSR 测试|
|来源可用性说明|约 24 行|来源等级常量 → JSX|无 React Hook 或 I/O|拒绝；只在 intake 展开态出现，现有公开 SSR interface 无法建立提取前行为基线|
|结果分数说明与免责声明|约 23 行|静态文案 → JSX|无 Hook、callback 或 I/O|拒绝；只在分析结果态出现，安全 fixture 不提供该状态|

提取后容器为 2,198 行；29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域、公开 props、DOM 顺序、API 和权限数据流均未变化。Phase 1B 不代表整个 Phase 1 完成。

### Phase 1C：主链路引导（已完成）

本次只提取 `OpportunitiesFlowGuidance`。容器保留 `!unlocked` 条件、surface、页头、连接状态和全部副作用；新叶子无 props，只返回原引导文案及两个声明式链接。

|候选|原范围|输入/输出|副作用|决定|
|-|-:|-|-|-|
|主链路引导|约 10 行|无输入 → 原静态 JSX|无 Hook、callback、I/O 或 authority 数据；保留原 `/agent/run` 与 `/tasks` href|选择；三态公开 SSR 测试可在提取前后复用，规范化 JSX 哈希一致|
|来源可用性说明|约 24 行|来源等级常量 → JSX|无 React Hook 或 I/O|拒绝；只在 intake 展开态出现，尚无提取前真实 DOM 行为基线|
|Candidate pool 空状态|约 8 行|pool/filter 空状态 → JSX|无 I/O，但依赖父级三分支条件|拒绝；需先证明空池、过滤为空和有结果三态顺序|

提取后容器为 2,190 行，新叶子为 16 行；29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域、公开 props、DOM 顺序、API 和权限数据流均未变化。Phase 1C 不代表整个 Phase 1 完成。

### Phase 1D：来源可用性说明（已完成）

本次只提取 `OpportunitiesSourceAvailability`。容器保留 `showCandidateIntake` 条件、来源输入、preview/confirm command 和全部副作用；新叶子无 props，只返回原四级来源说明和浏览器原生 disclosure。

|候选|原范围|输入/输出|副作用|决定|
|-|-:|-|-|-|
|来源可用性说明|约 24 行|生产来源等级常量 → 原 JSX|无 Hook、callback、网络、Storage 或 authority 数据|选择；提取前已建立 default/advanced 的真实挂载展开与收起基线，规范化 JSX SHA-256 前后一致|
|Candidate pool 空状态|约 8 行|pool/filter 三态 → JSX|无 I/O，但依赖父级三分支条件|拒绝；需先证明空池、过滤为空和有结果三态顺序|
|结果分数说明与免责声明|约 23 行|分析结果态 → JSX|无直接 I/O，但缺少安全结果态测试入口|拒绝；不能用字符串哨兵替代真实结果态行为|

提取后容器为 2,169 行，新叶子为 29 行；29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域、公开 props、DOM、API 和权限数据流均未变化。Phase 1D 不代表整个 Phase 1 完成。

### Phase 1E：Candidate pool 空状态（候选已完成）

本次只提取 `OpportunitiesCandidatePoolEmptyState`。容器保留 `poolItems`、`visiblePoolItems`、筛选 state、正常 Candidate 列表和全部 authority 条件；父组件同步派生 `pool_empty`、`filter_empty`、`has_results`，叶子只接收其中两个空态。

|候选|原范围|输入/输出|副作用|决定|
|-|-:|-|-|-|
|Candidate pool 空状态|约 8 行|只读 display state → 两类空状态 JSX|无 Hook、callback、I/O、权限或 authority 对象|选择；提取前已建立两 surface 的空池、筛选为空、恢复列表和锁定态行为基线|
|解锁后 header/连接提示|约 54 行|surface、fixture、连接状态、toggle → JSX|含添加区 callback 和 authority 降级提示|拒绝；interface 与行为面过大，不是纯展示低风险叶子|
|结果摘要与免责声明|约 34 行|分析结果派生模型 → JSX|无直接 I/O，但缺少安全结果态 fixture|拒绝；不能用字符串哨兵替代真实结果态行为|

提取后容器为 2,167 行，新叶子为 17 行；29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域、公开 props、正常列表、API、Storage、权限和数据权威性均未变化。规范化三态展示合同 SHA-256 为 `dd1c6c47f429e5f85160dcbef8cc9cba0a2bfd310633179ab2d80f6bb15ebea7`，提取前后相同。

Phase 1E 合入后，Phase 1 的高确定性低副作用展示叶子达到收口条件：剩余候选需要结果 fixture、复杂 presentation model、交互状态或业务 callback，继续搬小块的收益低于测试和发布成本。Phase 2 尚未执行。

## 3. seam 清单

|推荐顺序|建议 module|输入/输出|state owner|副作用/依赖|风险|
|-:|-|-|-|-|-|
|1|Locked preview（Phase 1A 已完成）|只读 locked surface copy → JSX|容器|无|copy/DOM|
|2|Surface header|surface presentation model → JSX|容器|无|copy/ARIA|
|3|Decision summary（Phase 1B 已完成）|只读 `DecisionDeskSummary` → JSX|容器|无|计数标签/顺序漂移|
|4|Flow guidance（Phase 1C 已完成）|无输入 → 静态 JSX|容器|无|文案/href 漂移|
|5|Source availability（Phase 1D 已完成）|无 props → 来源等级 JSX|浏览器原生 disclosure|无|顺序/文案/折叠状态漂移|
|6|Candidate pool empty state（Phase 1E 候选已完成）|只读三态中的空态 → JSX|容器|无|条件优先级/文案漂移|
|7|Decision badges|Candidate presentation → JSX|容器|无|Evidence/R2.2 标签漂移|
|8|Decision View Model|pool + Task links + mode → rows|纯 module|无|authority 条件遗漏|
|9|Source import view|view model + commands → JSX|容器|无直接 fetch|preview/confirm 混淆|
|10|Candidate list/detail|rows + selection + commands → JSX|容器|portal 另行处理|DOM/菜单行为|
|11|Storage recovery module|cache adapter → hydration result|专用 Hook/module|localStorage|覆盖顺序/Strict Mode|
|12|Request module|commands → result/error|专用 module|HTTP adapter|headers/abort/stale response|

## 4. 候选 interface

### Decision View Model

```ts
type CandidateDecisionRow = {
  id: string;
  queue: CandidateQueuePresentation;
  market: MarketPresentation;
  evidence: EvidencePresentation;
  taskLinks: readonly LinkedTaskInfo[];
  actions: CandidateActionPresentation;
};
```

module 内部统一解释 `official_readonly`、local/server、Task、`convertedTaskId`、R2.2 和 Evidence。调用者不应重新拼这些条件。

### Source import commands

```ts
type SourceImportCommands = {
  preview(): void;
  toggle(key: string): void;
  confirm(): void;
};
```

preview 与 confirm 必须保持两个 command，签名 payload 只能由现有 adapter 生成。

### Storage result

```ts
type CandidateHydrationResult = {
  items: OpportunityCandidatePoolItem[];
  source: "server" | "local_fallback" | "fixture";
  serverAvailable: boolean;
  notice: string;
};
```

只有真实 DOM/Effect 测试建立后才考虑此 interface；当前不是实现建议。

## 5. 执行阶段

### Phase 0：行为基线

进入条件：最新 main、clean worktree。退出门禁：行为合同、完整验证和独立复核。Phase 0 准备已进入 main。

### Phase 1：纯展示叶子

一次提取一个区域，不移动 state/effect/fetch。Phase 1A 完成未解锁展示叶子，Phase 1B 完成候选品池五项决策摘要，Phase 1C 完成主链路引导，Phase 1D 完成来源可用性说明，Phase 1E 候选完成 Candidate pool 空状态。Phase 1E 合入后，纯展示叶子阶段正式收口；失败直接 revert 单 Commit。

`phase1_presentation_extraction_closed=true`

### Phase 2：派生 View Model

把散落的 presentation 条件集中为纯 module。必须先用 table-driven tests 覆盖 authority 矩阵。

### Phase 3：来源导入视图

先 view 后 controller。禁止同时改签名、crawler、API 或选择规则。

### Phase 4：Candidate 列表与详情

提取列表/详情/动作视图。portal 必须有 DOM 测试后单独移动。

### Phase 5：Storage 恢复

只有 server-first、fallback、TTL、fixture、Strict Mode 可验证时才提取 Hook。

### Phase 6：请求 module

需要 production HTTP adapter 与 test adapter 两个真实 adapter。逐 endpoint 替换，不做统一 client 大改。

### Phase 7：容器收口

最终容器只组合 modules 和 access adapter。state 数量下降是结果，不是目标。

## 6. 每阶段共同门禁

- 不改 props、路由、API payload、Storage key、认证、Prisma、Sandbox、Artifact；
- 不同时修 UNKNOWN 并发行为；
- 相关测试 + 完整单线程测试 + TypeScript + ESLint + Build；
- production diff 与目标范围逐项核对；
- 独立 detached review；
- 每次 1–3 个紧密文件，可独立 revert。

详细交付顺序和回滚矩阵见 `NEXT_REFACTOR_ROADMAP.md`。
