# OpportunitiesForm 分阶段拆分方案

> Source baseline：`origin/main` commit `9f185eb1afea57003f7498cb296bb678bb112dc0`，tree `677dbee31e1ea16d5003b1385c3f423bc208d69e`
>
> 制定日期：2026-07-24。本文只定义 module/interface/seam/adapter，不授权当前任务继续拆分主逻辑。

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

### Phase 1E：Candidate pool 空状态（已完成）

本次只提取 `OpportunitiesCandidatePoolEmptyState`。容器保留 `poolItems`、`visiblePoolItems`、筛选 state、正常 Candidate 列表和全部 authority 条件；父组件同步派生 `pool_empty`、`filter_empty`、`has_results`，叶子只接收其中两个空态。

|候选|原范围|输入/输出|副作用|决定|
|-|-:|-|-|-|
|Candidate pool 空状态|约 8 行|只读 display state → 两类空状态 JSX|无 Hook、callback、I/O、权限或 authority 对象|选择；提取前已建立两 surface 的空池、筛选为空、恢复列表和锁定态行为基线|
|解锁后 header/连接提示|约 54 行|surface、fixture、连接状态、toggle → JSX|含添加区 callback 和 authority 降级提示|拒绝；interface 与行为面过大，不是纯展示低风险叶子|
|结果摘要与免责声明|约 34 行|分析结果派生模型 → JSX|无直接 I/O，但缺少安全结果态 fixture|拒绝；不能用字符串哨兵替代真实结果态行为|

提取后容器为 2,167 行，新叶子为 17 行；29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域、公开 props、正常列表、API、Storage、权限和数据权威性均未变化。规范化三态展示合同 SHA-256 为 `dd1c6c47f429e5f85160dcbef8cc9cba0a2bfd310633179ab2d80f6bb15ebea7`，提取前后相同。

Phase 1 的高确定性低副作用展示叶子已经正式收口：剩余候选需要结果 fixture、复杂 presentation model、交互状态或业务 callback，继续搬小块的收益低于测试和发布成本。

### Phase 2A：Candidate pool 派生计数 selector（PRODUCTION）

本次只把父组件现有 `poolCounts` 内联计算提取为 `buildCandidatePoolCounts`。`poolItems`、原 `useMemo` 位置、`[poolItems]` 依赖、筛选控件和全部消费者仍由 `OpportunitiesForm` 拥有。

|输入|输出|副作用|语义边界|
|-|-|-|-|
|只读 `OpportunityCandidatePoolItem[]`|`all` 与五个合法状态计数|无网络、Storage、权限、时间或写入|`analyzed` 排除已有 `convertedTaskId`；直接未知状态只进入 `all`|

提取后生产容器为 2,159 行；29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域和 5 个间接 sessionStorage 活动 key 均未变化。提取前后使用同一 UI 计数测试，纯函数另由表驱动测试覆盖空、合法状态、混合、重复、已转 Task、未知状态、正常化、顺序和输入不变性。

### Phase 2B：Candidate pool 过滤排序 selector（PRODUCTION）

本次只把父组件 `visiblePoolItems` memo 内的既有 filter 后 sort 组合提取为 `buildVisibleCandidatePoolItems`。该内部执行顺序由 STRUCTURAL 证据确认；UI 与纯函数输出测试保护最终合同，但不能唯一证明等价实现的内部顺序。`poolItems`、`poolFilter`、`poolSort`、原 memo 位置、`[poolItems, poolFilter, poolSort]` 依赖和全部消费者仍由 `OpportunitiesForm` 拥有。

|输入|输出|副作用|语义边界|
|-|-|-|-|
|只读 Candidate pool、现有 filter、现有 sort|新的有序只读 Candidate 数组|无网络、Storage、权限、时间或写入|直接未知状态只在 `all`；`analyzed` 排除已转 Task；保留原 tie-breaker、稳定排序、`undefined`/`NaN` fallback 与 Infinity 极值语义|

生产容器为 2,158 行；29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域和 5 个间接 sessionStorage 活动 key 均未变化。提取前后复用同一 mounted UI 行为测试；纯函数表驱动覆盖全部 filter/sort、组合、未知状态、converted Task、并列键、`undefined`、`NaN`、正负 Infinity、冻结输入、确定性以及与原 inline 输出逐项对照。

### Phase 2C：Candidate 状态色调 View Model（PRODUCTION）

本次只把父组件本地 `candidateStatusClass` 原样迁移为 `lib/opportunityCandidatePool.ts` 的 `getCandidateStatusToneClass`。`getCandidateQueuePresentation` 继续拥有持久化状态和 Task relation 到展示状态、标签、下一步文案的解释；列表与详情继续拥有各自 DOM 和外围 class。

|输入|输出|副作用|语义边界|
|-|-|-|-|
|一个 `CandidateQueueState`|完整且顺序固定的 Tailwind 色调 class 字符串|无 React、网络、Storage、权限、时间、Candidate 读取或写入|五个合法展示状态各自保持原色调；运行时未知值保持原 slate 分支|

生产容器为 2,150 行；29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域和 5 个间接 sessionStorage 活动 key 均未变化。五状态纯函数表驱动测试、default/advanced 的 SSR 与 mounted 测试保护完整 class、标签组合和列表/详情一致性；结构哨兵确认两个消费者都使用共享函数且旧映射已移除。

### Phase 2D：来源 warning 展示模型（PRODUCTION）

Phase 2D 只把来源 warning 唯一消费者中的 reason、URL 和消息清理组合提取为 `buildSourceWarningDisplayModel`。`sourceImportWarnings` state、preview response、清除路径、错误处理、条件和 DOM 均继续由 `OpportunitiesForm` 拥有。

|输入|输出|副作用|语义边界|
|-|-|-|-|
|一个 warning 字符串|只读 `reasonKey`、`reasonLabel`、`sourceUrl`、`messageText`|无 React、网络、Storage、权限、时间或写入|保留 reason 后缀、开头 HTTP URL、消息清理和 fallback；页面仍不渲染 warning 链接|

生产容器为 2,146 行；29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域和 5 个间接 sessionStorage 活动 key 均未变化。纯函数表驱动覆盖空白、reason、URL 位置、未知值、特殊字符、确定性和旧组合逐字段等价；两个 surface 的 mounted 测试与锁定 SSR 测试保护现有文案、class、顺序、无链接及零新增 I/O。

### Phase 3A：来源 preview request adapter（PRODUCTION）

Phase 3A 只把 `handleSourceImport` 内联的请求组装、单次 fetch、content-type 检查和 JSON 解析提取为 `requestSourceImportPreview`。父组件继续拥有 callback、全部 state、loading/error/warning/summary/selection、UI 文案、confirm 和 Candidate refresh；summary、selection及全部setter的逐调用顺序未由本阶段行为测试证明。

|输入|输出|副作用|语义边界|
|-|-|-|-|
|trim 后的 source URL、当前 access password、只读 access headers|保留 HTTP status 的 `json`、`non_json` 或 `invalid_json` 结果|一次 source-import fetch；无 Storage、Candidate/Task 写入或 React state|保留 endpoint、method、headers、无显式 credentials、body、错误分支和异常 throw；adapter 不拥有 stale-response 保护|

生产容器为 2,134 行；29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref不变。9 个业务 fetch 为父组件8个加 adapter1个；2 个直接 localStorage 数据域和5个间接 sessionStorage活动 key不变。confirm callback 未由 Phase 3A 修改。

Phase 3A-0 有44项组件测试：43项行为、请求或时序证据，以及1项 `STRUCTURAL` 结构哨兵。行为证据覆盖空白、非 URL、特殊 URL、锁定态、HTTP/解析/异常矩阵、消息清理及受控重叠响应，并冻结当时缺少 stale-response 保护的风险。公开 UI 在 loading 时会阻止不同 URL 的第二次用户请求。

### Phase 3B：Preview 最新请求获胜保护（PRODUCTION）

本次不移动 adapter、state 或 callback，只在父组件增加一个 generation ref。合法 preview 启动时递增；success、catch 和 finally 仅在 generation 仍为最新时提交可见状态。网络请求不取消，卸载行为不变。

生产容器为2,143行；29个 state、5个 effect、11个 callback、6个 memo不变，ref从2增至3。9个业务 fetch、2个直接 localStorage数据域和5个间接sessionStorage活动key不变。56项组件测试包含既有44项和新增12项竞态证据；公开UI loading阻断仍由既有用例覆盖。

### Phase 3C：Confirm command Characterization（PRODUCTION）

Phase 3C 已进入上述 production main；它只新增 `OpportunitiesForm.source-confirm-command.test.ts` 并更新治理文档，没有修改 `OpportunitiesForm.tsx`、request adapter、API、Candidate/Task写入、权限、Storage或任何生产代码。46项挂载测试冻结：

- Owner/default 与 Visitor/advanced_import 的客户端请求合同；
- preview、summary、selection、`canSave`、服务端连接和锁定门禁；
- 单次 Candidate POST、success counters、已有 Candidate 与 refresh 成功/空池/失败；
- 200业务错误、空/非 JSON、204、主要 HTTP 状态、网络、普通 Error 与 AbortError；
- saving 进入 DOM 后的 disabled、同一事件周期双 POST、成功/失败返回顺序、refresh 交错和卸载。

证据显示常规 saving DOM 能阻止后续点击，但同一事件周期内两个公开 DOM click 可发出两个权威 POST；任一 finally 会关闭共享 saving，旧 refresh 也可覆盖较新提示。Confirm 没有 generation、single-flight、幂等 key 或 AbortController。服务端测试已证明相同 Evidence 的顺序重复保存对 Owner 与 Visitor 都返回 `unchanged`；真正并发双 POST 的原子幂等性仍为 `UNKNOWN`，因为当前没有并发服务测试或 Candidate 身份/Evidence 唯一约束。这些是已记录风险，不是 Phase 3C 修复结果。

### Phase 3D：Confirm Single-Flight（当前候选）

Phase 3D 是有意行为修复，只在父组件增加一个 `sourceConfirmInFlightRef`。现有同步输入、权限、连接、selection、`canSave` 校验和 payload 构建通过后，ref 在首个异步边界与 Candidate POST 前同步取得；重复触发直接返回且不改变任何页面状态。ref 覆盖 POST、响应处理与后续 refresh，并在现有 `finally` 中对所有成功、失败和 refresh 失败路径释放。

生产容器候选为2,145行；state 29、Effect 5、callback 11、memo 6、业务 fetch 9、Storage 数据域和5个间接 sessionStorage活动 key不变，ref从3增至4。Phase 3D 套件为47项：46项挂载测试保留Phase 3C请求/权限/错误/卸载证据，并将同周期双POST矩阵转为single-flight合同；新增1项STRUCTURAL哨兵证明ref release位于refresh之后。POST pending只允许一个POST；pending refresh期间公开DOM由既有state guard禁用且不产生新增POST；所有既有错误路径均释放；可恢复的preview/selection/`canSave`/summary门禁和顺序第二次Confirm可执行。锁定surface与服务端池不可用只声明公开UI阻断和ref前置的STRUCTURAL证据。`sourceConfirming`继续承担UI和既有渲染后guard，ref只关闭重渲染前窗口。endpoint、headers、body、无显式credentials、Owner/Visitor、Preview和Candidate refresh语义均不变。

该候选只保护单个组件实例；多标签页、多浏览器、网络重试及服务端并发原子幂等仍为 `UNKNOWN`。候选尚未进入 main、尚未部署；Phase 3E 未实施。

## 3. seam 清单

|推荐顺序|建议 module|输入/输出|state owner|副作用/依赖|风险|
|-:|-|-|-|-|-|
|1|Locked preview（Phase 1A 已完成）|只读 locked surface copy → JSX|容器|无|copy/DOM|
|2|Surface header|surface presentation model → JSX|容器|无|copy/ARIA|
|3|Decision summary（Phase 1B 已完成）|只读 `DecisionDeskSummary` → JSX|容器|无|计数标签/顺序漂移|
|4|Flow guidance（Phase 1C 已完成）|无输入 → 静态 JSX|容器|无|文案/href 漂移|
|5|Source availability（Phase 1D 已完成）|无 props → 来源等级 JSX|浏览器原生 disclosure|无|顺序/文案/折叠状态漂移|
|6|Candidate pool empty state（Phase 1E 已完成）|只读三态中的空态 → JSX|容器|无|条件优先级/文案漂移|
|7|Candidate pool counts（Phase 2A PRODUCTION）|只读 Candidate pool → 六字段计数|容器 memo|无|未知状态/converted Task 语义漂移|
|8|Candidate pool visible items（Phase 2B PRODUCTION）|只读 pool + filter + sort → 有序只读数组|容器 memo|无|过滤顺序/tie-breaker/缺失值语义漂移|
|9|Candidate status tone（Phase 2C PRODUCTION）|展示状态 → 完整色调 class|纯 module|无|class/顺序/消费者漂移|
|10|Source warning display（Phase 2D PRODUCTION）|warning 字符串 → reason/URL/消息模型|纯 module|无|fallback/清理/无链接行为漂移|
|11|Decision badges|Candidate presentation → JSX|容器|无|Evidence/R2.2 标签漂移|
|12|Decision View Model|pool + Task links + mode → rows|纯 module|无|authority 条件遗漏|
|13|Source import view|view model + commands → JSX|容器|无直接 fetch|preview/confirm 混淆|
|14|Candidate list/detail|rows + selection + commands → JSX|容器|portal 另行处理|DOM/菜单行为|
|15|Storage recovery module|cache adapter → hydration result|专用 Hook/module|localStorage|覆盖顺序/Strict Mode|
|16|Source preview request adapter（Phase 3A PRODUCTION）|source URL + access 参数 → preview result|父组件 command|单次 HTTP fetch|headers/body/error|
|17|Preview generation guard（Phase 3B PRODUCTION）|合法请求启动顺序 → 可见状态提交资格|父组件 command|无新增 I/O|stale success/catch/finally、卸载不 abort|
|18|Confirm Characterization（Phase 3C PRODUCTION）|公开交互 + 虚假身份 + 内存 fetch → 请求/刷新/竞态证据|父组件 command|测试内存 I/O；生产不变|重复权威 POST、共享 saving；顺序重复保存返回 `unchanged`，并发原子性 UNKNOWN|
|19|Confirm Single-Flight（Phase 3D 当前候选）|合法 Confirm + 同步 ref → 单实例一次在途 POST/refresh|父组件 command|无新增 I/O；一个 ref|仅保护单实例；多标签页/服务端并发 UNKNOWN|

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

一次提取一个区域，不移动 state/effect/fetch。Phase 1A 完成未解锁展示叶子，Phase 1B 完成候选品池五项决策摘要，Phase 1C 完成主链路引导，Phase 1D 完成来源可用性说明，Phase 1E 完成 Candidate pool 空状态。纯展示叶子阶段已正式收口。

`phase1_presentation_extraction_closed=true`

### Phase 2：派生 View Model

把散落的 presentation 条件集中为纯 module。Phase 2A 至 2D 已生产，四个函数均由 table-driven tests 固定既有语义。剩余候选开始涉及复杂权限、Candidate authority、callback、API、Storage 或多状态组合；本阶段已关闭，不为减少行数继续提取低收益模型。

`phase2_pure_derivation_closed=true`

### Phase 3：来源导入视图

先保护 command 行为，再逐 endpoint 建立窄 adapter。Phase 3A adapter、Phase 3B preview generation 与 Phase 3C Confirm Characterization 已进入 production main；state、签名、crawler、API 和选择规则均未移动。Phase 3D 当前候选只以一个同步 ref 关闭单组件实例的 Confirm 双 POST 窗口，不提取 adapter、不改变请求协议，也不解决服务端并发幂等。Phase 3E 尚未实施。

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
