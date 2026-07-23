# OpportunitiesForm 深度架构审计

> Source baseline：`origin/main` commit `9f185eb1afea57003f7498cb296bb678bb112dc0`，tree `677dbee31e1ea16d5003b1385c3f423bc208d69e`
>
> 审计日期：2026-07-24
>
> 事实边界：生产事实只来自上述 main。本文另设候选小节描述 Phase 3D，不把候选写成已发布能力。其他工作树的 dirty、未跟踪 Provider 工具、生产数据库和运行时环境均未纳入。
>
> 复核要求：`origin/main` 变化后重新计算全部数量、引用和数据流。Source baseline 不等于生产服务器当前运行版本。

## 1. 当前结构

### 生产 main

|指标|数量|说明|
|-|-:|-|
|物理行数|2,143|`components/cross-border/OpportunitiesForm.tsx`；Phase 1A 至 1E、Phase 2A 至 2D、Phase 3A 和 Phase 3B 已合入|
|`useState`|29|无 `useReducer`|
|`useEffect`|5|恢复、Candidate hydration、持久化、Task link、portal 定位|
|`useCallback`|11|请求编排、导出、状态、删除和来源导入|
|`useMemo`|6|默认选择、本地草稿数、筛选、统计、决策摘要、当前选中项|
|`useRef`|3|textarea、单次草稿恢复标记和 Preview generation|
|业务 `fetch`|9|父组件 8 个，Phase 3A preview adapter 1 个；endpoint 总数不变|
|直接 localStorage 数据域|2|输入草稿、Candidate 浏览器池|
|间接 sessionStorage 活动 key|5|密码/到期、token、mode、Visitor access，由 access adapter 管理|

生产文件同时承担公开 surface、访问态接入、手工分析、来源预览、Candidate 保存与更新、Task 关联、Agent 交接、localStorage 恢复、portal 菜单和大部分页面 JSX。它是一个浅接口但过宽实现职责的容器，而不是单纯表单。

生产 main 已包含 `lib/opportunityCandidateActions.ts` 的删除 presentation 纯规则、`buildCandidatePoolCounts`、`buildVisibleCandidatePoolItems`、`getCandidateStatusToneClass`、`buildSourceWarningDisplayModel`、`requestSourceImportPreview`，以及 `OpportunitiesLockedPreview`、`OpportunitiesDecisionSummary`、`OpportunitiesFlowGuidance`、`OpportunitiesSourceAvailability`、`OpportunitiesCandidatePoolEmptyState` 五个展示叶子。生产容器仍承担公开 surface、访问态接入、手工分析、来源预览、Candidate 保存与更新、Task 关联、Agent 交接、localStorage 恢复、portal 菜单和大部分页面 JSX。

### Phase 1A（PRODUCTION）

未解锁功能预览 JSX 已移到 171 行的 `OpportunitiesLockedPreview.tsx`。`!unlocked` 条件、surface 文案派生、29 个 state、5 个 effect、11 个 callback、6 个 memo、9 个 fetch、2 个直接 localStorage 数据域、公开 props、渲染 DOM 与数据流均未变化。

### Phase 1B（PRODUCTION）

候选品池五项决策摘要 JSX 已移到 26 行的 `OpportunitiesDecisionSummary.tsx`，生产容器为 2,198 行。`buildDecisionDeskSummary(poolItems)`、memo、29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域、公开 props、条件顺序、DOM 与数据流均未变化。

### Phase 1C（PRODUCTION）

主链路引导 JSX 已移到 16 行的 `OpportunitiesFlowGuidance.tsx`，生产容器为 2,190 行。新叶子无 props，保留原文案和 `/agent/run`、`/tasks` href；29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域、公开 props、条件顺序、DOM 与数据流均未变化。

### Phase 1D（PRODUCTION）

来源可用性说明 JSX 已移到 29 行的 `OpportunitiesSourceAvailability.tsx`，容器变为 2,169 行。新叶子无 props、callback 或 Hook；浏览器原生 `<details>/<summary>` 仍拥有展开状态，四级来源顺序、文本、class 和 key 保持不变。规范化 JSX SHA-256 前后均为 `4b064e0dda4b86415ab577020aee94acc20c7e3cd05a40263533137929f7de14`。29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域、公开 props、API、Storage、权限和数据权威性均未变化。

### Phase 1E（PRODUCTION）

两类 Candidate pool 空状态 JSX 已移到 17 行的 `OpportunitiesCandidatePoolEmptyState.tsx`，容器变为 2,167 行。父组件保留 `poolItems`、`visiblePoolItems`、筛选 state、三态优先级和正常 Candidate 列表，仅同步派生 `pool_empty`、`filter_empty`、`has_results`。叶子只接收一个只读空态，不接收 Candidate 数组、权限、setter 或 callback；无 Hook 或 I/O。规范化三态展示合同 SHA-256 前后均为 `dd1c6c47f429e5f85160dcbef8cc9cba0a2bfd310633179ab2d80f6bb15ebea7`。

29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域、5 个间接 sessionStorage 活动 key、公开 props、正常列表、API、Storage、权限和数据权威性均未变化。该叶子为 `PRODUCTION / ACTIVE`。

### Phase 2A（PRODUCTION）

`poolItems` 的六字段计数已从父组件内联实现移到现有 Candidate pool 领域模块的纯 selector `buildCandidatePoolCounts`。输入为只读 `OpportunityCandidatePoolItem[]`，输出为 `all`、`pending`、`worth_analyzing`、`analyzed`、`paused`、`rejected`；父组件保留原 `useMemo`、`[poolItems]` 依赖和全部消费者。

提取后生产容器为 2,159 行。29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域、5 个间接 sessionStorage 活动 key 均未变化。已转换 Task 的 `analyzed` Candidate 仍只进入 `all`；绕过正常化的未知状态仍只进入 `all`。服务端未知状态固定回落到 `pending`；Storage 未知状态回落到既有 score/risk 默认状态，可能为 `pending`、`worth_analyzing` 或 `paused`。

### Phase 2B（PRODUCTION）

父组件 `visiblePoolItems` memo 内的 `filterCandidatePool` 后接 `sortCandidatePool` 组合已提取为同一 Candidate pool 领域 module 的 `buildVisibleCandidatePoolItems`。interface 只接收只读 Candidate 数组、现有 `poolFilter` 和现有 `poolSort`，返回有序只读 Candidate 数组。父组件保留原 memo 位置、`[poolItems, poolFilter, poolSort]` 依赖和全部消费者。

生产容器为 2,158 行。29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域和 5 个间接 sessionStorage 活动 key 均未变化。selector 当前实现仍先 filter 后 sort；该内部执行顺序由 source diff 的 STRUCTURAL 证据确认，最终输出测试不能唯一证明等价实现的内部顺序。`updated` 依次按 `updatedAt` 降序、`score` 降序、中文名称升序比较，`score` 依次按 `score` 降序、`updatedAt` 降序、中文名称升序比较。完全相等时保留当前 JavaScript 稳定排序的输入顺序。`undefined` 或 `NaN` 使减法 comparator 进入下一字段；`+Infinity/-Infinity` 与有限值比较时作为可比较极值参与排序，两个相同 Infinity 相减产生 `NaN` 时才进入下一字段。直接未知状态只在 `all` 中出现，已有 `convertedTaskId` 的 `analyzed` Candidate 不进入 `analyzed` filter。

### Phase 2C 状态色调 View Model（PRODUCTION）

生产实现已把父组件本地 `candidateStatusClass` 原样迁移为 Candidate pool 领域 module 的 `getCandidateStatusToneClass`。输入只允许 `CandidateQueueState`，输出是完整且顺序固定的 Tailwind 色调字符串；函数不读取 Candidate、标签、下一步文案、surface、权限、Storage、时间或网络。

五状态合同为：`pending_review → slate`、`pending_analysis → emerald`、`analyzing → indigo`、`converted → teal`、`rejected → rose`。运行时未知值继续落入原末尾分支并返回 slate，不新增或改善 fallback。列表与详情两个消费者继续保留各自外围 class，只把色调调用改为共享函数。

生产容器为 2,150 行。29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域和 5 个间接 sessionStorage 活动 key 均未变化。五状态表驱动纯函数测试、两 surface SSR 和真实挂载测试共同保护完整 class、标签组合及列表/详情一致性。

### Phase 2D 来源 warning 展示模型（PRODUCTION）

生产实现把 `sourceImportWarnings` 唯一渲染消费者中的 reason、URL 与消息清理组合提取为 `lib/client/sourceImportLabels.ts` 的 `buildSourceWarningDisplayModel`。输入是一个 warning 字符串；输出为只读 `reasonKey`、`reasonLabel`、`sourceUrl` 和 `messageText`。`reasonKey` 与 `sourceUrl` 属于共享模型的纯函数合同，但当前唯一生产消费者只读取 `reasonLabel` 与 `messageText`，当前 UI 不消费这两个字段，也不渲染 URL 链接。函数复用既有 `extractFailureReason` 与 `getFailureReasonLabel`，无 React、网络、Storage、权限、时间、环境变量或写入。

URL 仍只按 warning 开头的 `http/https` 加分隔冒号识别；当前页面仍不渲染 warning 链接。无 reason 时继续显示原 warning；字面量 `[unknown]` 继续走原文 fallback；其他未登记 reason 继续显示既有“未知原因”标签。生产容器为 2,146 行，29 个 state、5 个 effect、11 个 callback、6 个 memo、2 个 ref、9 个 fetch、2 个直接 localStorage 数据域和 5 个间接 sessionStorage 活动 key 均未变化。warning 产生、清除、错误处理和 response 写入路径未改变。

### Phase 3A 来源 preview request adapter（PRODUCTION）

Phase 3A 已把 `handleSourceImport` 内联的请求组装、单次 fetch、content-type 检查和 JSON 解析移到 `lib/client/sourceImportPreview.ts` 的 `requestSourceImportPreview`。adapter 输入为 trim 后的 source URL、当前 access password 和父组件构建的只读 access headers；输出保留 HTTP status，并明确区分 `json`、`non_json` 与 `invalid_json`。网络异常和 AbortError 继续原样抛回父组件。

父组件仍拥有 callback、29 个 state、loading/error/warning/summary/selection、全部文案、confirm 和 Candidate refresh。源码 diff 证明 preview setter 调用序列与 Phase 3A 基线一致；挂载时序测试只直接观察 error、warning、preview 和 loading，不用于证明 summary、selection 或全部 setter 的逐调用顺序。生产容器为 2,134 行；state 29、Effect 5、callback 11、memo 6、ref 2 不变。9 个业务 fetch 为父组件8个加 adapter1个，endpoint 总数不变；Storage 数据域和5个间接 sessionStorage 活动 key不变。

Phase 3A Characterization Test 冻结了当时无 preview generation 或 stale-response 保护的风险，并确认卸载不会中止在途请求。公开 UI 在 loading 时禁用输入和按钮，因此不同 URL 的第二次用户操作当前不会发出请求；这仍不等于 abort 或卸载保护。

### Phase 3B Preview 最新请求获胜保护（PRODUCTION）

生产实现只在 `handleSourceImport` 增加一个单调递增的 `sourcePreviewGenerationRef`。每个通过输入校验并实际启动的 preview 获得 generation；success、catch 和 finally 只有在 generation 仍为最新时才能提交 preview、warning、error 或 loading。较旧请求继续完成网络过程，但不能再写可见状态；没有新增 AbortController，也没有改变 adapter、endpoint、payload、headers、confirm、Candidate refresh、Storage 或权限。

生产容器为 2,143 行；state 29、Effect 5、callback 11、memo 6、ref 由 2 增至 3。业务 fetch 仍为父组件8个加 adapter1个，2 个直接 localStorage 数据域和5个间接 sessionStorage活动 key不变。组件合同测试为56项，其中新增12项覆盖较旧 success/failure、较新 success/failure、stale finally、同 URL 重复、非 JSON 与空结果/warning 分支；既有44项测试未删除。

### Phase 3C Confirm Characterization（PRODUCTION）

Phase 3C 已进入上述生产 main；它只新增46项挂载测试并更新治理文档，`OpportunitiesForm.tsx` 与全部运行时代码相对 Phase 3B Diff 为0。测试通过公开按钮、虚假 Owner/Visitor access、fail-closed 内存 fetch 和 deferred Promise观察当前 Confirm，不调用真实 Route、数据库、Provider或AI。

当前 Confirm 调用链为：

```text
preview Candidate + summary
→ selection 与 canSave 门禁
→ POST /api/opportunity-candidates
→ GET /api/opportunity-candidates?limit=100
→ refresh Candidate pool 与既有浏览器缓存
```

- Confirm 使用 `sourceImportCandidates`、`sourceImportChecked`、`accessPassword`、`hasAccess`、`serverAvailable`、`sourceConfirming` 和 `refreshServerPool`；不读取 Preview generation。
- 正常单次交互发出1个 Candidate POST；成功后发出1个 refresh GET。成功只读取 `ok`、`created`、`unchanged`，refresh失败显示“已导入服务端”事实并保留 preview。
- Owner与Visitor客户端请求形状相同：`Content-Type`加现有access headers，无显式credentials，body为`{ items }`；真实服务端权限和数据库事务不由组件测试证明。
- saving进入DOM后按钮disabled；Phase 3C 证明同一事件周期内连续两个公开DOM click可发出2个Candidate POST。任一finally会关闭共享saving，旧refresh可覆盖较新提示；卸载不abort，写入成功后仍会refresh。
- 服务端测试已证明相同 Evidence 的顺序重复保存：Owner 返回 `unchanged` 且不 create/update，Visitor 返回 `unchanged` 且不重写 Sandbox 文件。真正并发的两个 POST 是否具备原子幂等性仍为 `UNKNOWN`：当前没有并发服务测试，Prisma Candidate 模型也没有身份或 Evidence 唯一约束。Phase 3C 只记录客户端重复权威 POST 风险，不宣称数据库已产生重复 Candidate。

### Phase 3D Confirm Single-Flight（当前候选）

本候选是有意行为修复，不是等价重构。`handleConfirmImport` 在全部现有同步输入、权限、连接、selection 与 `canSave` 校验及 payload 构建通过后、首个异步边界和 Candidate POST 之前，同步取得容器实例私有的 `sourceConfirmInFlightRef`。ref 已为 `true` 时直接返回，不发送请求，也不改变 saving、error、warning、preview、summary、selection 或 Candidate pool。

该 ref 覆盖 Candidate POST、响应处理及紧随其后的 Candidate pool refresh，并在现有 `finally` 中对成功、HTTP/业务/非 JSON/网络/AbortError 以及 refresh 失败全部释放。`sourceConfirming` 仍只负责 UI loading/disabled；请求 endpoint、headers、无显式 credentials、body、Owner/Visitor 客户端合同和 POST→refresh 顺序不变。生产容器候选为2,145行；state 29、Effect 5、callback 11、memo 6、业务 fetch 9、Storage 数据域与5个间接 sessionStorage活动 key不变，ref由3增至4。

46项 Confirm 挂载测试继续使用公开 DOM 与 fail-closed 内存 fetch；其中 `TIMING_BEHAVIOR` 证明旧 main 的同周期双 click 实际发出2个POST，而候选只发出1个。测试也覆盖 POST pending、refresh pending、全部既有错误路径释放、顺序再次 Confirm，以及虚假 Owner/Visitor 请求合同。该客户端 single-flight 仅保护单个组件实例；多标签页、多浏览器、网络重试和服务端真正并发原子幂等性仍为 `UNKNOWN`。候选尚未进入 main、尚未部署，Phase 3E 未实施。

## 2. 真实调用方与 interface

公开 props：

```ts
type OpportunitiesFormProps = {
  surface?: "legacy_default" | "advanced_import";
  visualFixture?: OpportunityCandidatePoolItem[];
};
```

|调用方|surface|角色|
|-|-|-|
|`/opportunities`|默认 `legacy_default`|PRODUCTION 主入口；development + 专用开关时可传隔离 fixture|
|`/opportunities/import`|`advanced_import`|PRODUCTION / ADVANCED_HIDDEN；直接 URL 可访问，静态站内 href 为 0，真实访问量 UNKNOWN|

未发现第三种 surface 或第三个生产页面调用方。

## 3. 全部状态分类

分类是主责任，不代表状态没有跨组耦合。

|类别|状态|初始值|生命周期所有者|持久化/权威性|
|-|-|-|-|-|
|A UI|`poolFilter`|`"all"`|容器；筛选控件修改|不持久化；派生视图|
|A UI|`poolSort`|`"updated"`|容器；排序控件修改|不持久化|
|A UI|`selectedPoolCandidateId`|`null`|容器；列表选择修改|不持久化|
|A UI|`showCandidateIntake`|`false`|容器；添加候选按钮修改|不持久化|
|A UI|`expandedIndex`|`null`|容器；分析结果展开修改|不持久化|
|A UI|`sourceImportChecked`|空 `Set`|来源预览选择区|不持久化；不能证明 Candidate 已保存|
|A UI|`openMoreId`|`null`|Candidate 操作菜单|不持久化|
|A UI|`moreMenuStyle`|`display:none`|portal 定位 effect|不持久化|
|B 本地草稿|`rawText`|空字符串|容器；输入和草稿恢复修改|10 分钟 localStorage；非权威|
|B 本地草稿|`candidates`|空数组|手工分析响应|仅内存；分析结果不等于服务端 Candidate|
|B 本地草稿|`sourceImportUrls`|空字符串|来源输入区|仅内存|
|C Candidate|`poolItems`|fixture 或空数组|容器 Candidate pool|浏览器副本与服务端结果混合；每项 authority 必须单独判断|
|C Candidate|`sourceImportCandidates`|空数组|来源预览响应|仅预览，确认前非持久化 Candidate|
|C Candidate|`candidateTaskLinks`|空 Map|Task GET effect|服务端 Snapshot；用于展示和删除/Agent 门禁|
|D 权限/降级|`serverAvailable`|fixture 为 `false`，否则 `null`|Candidate hydration|三态：检测中/服务端可用/本地降级；不是认证本身|
|E 网络请求|`loading`|`false`|手工分析 command|请求进行态|
|E 网络请求|`currentStep`|空字符串|手工分析 command|进度展示|
|E 网络请求|`importingLocal`|`false`|local import command|请求进行态|
|E 网络请求|`sourceImporting`|`false`|来源 preview command|请求进行态|
|E 网络请求|`sourceConfirming`|`false`|来源 confirm command|请求进行态|
|E 网络请求|`taskLinksLoading`|`false`|Task GET effect|请求进行态|
|F 缓存恢复|`poolHydrated`|fixture 布尔值|Candidate hydration effect|阻止恢复前持久化覆盖|
|G 错误/反馈|`error`|空字符串|手工分析 command|本地展示|
|G 错误/反馈|`importResult`|空字符串|local import command|成功/失败提示|
|G 错误/反馈|`poolSyncNotice`|空字符串|Candidate save/status/delete|权威保存和降级提示|
|G 错误/反馈|`sourceImportError`|空字符串|来源 preview/confirm|错误提示|
|G 错误/反馈|`sourceImportWarnings`|空数组|来源 preview response|预览 warning|
|G 错误/反馈|`sourceImportSummary`|`null`|来源 preview response|URL/候选计数展示|
|G 错误/反馈|`sourceConfirmResult`|空字符串|来源 confirm command|保存/refresh 结果提示|

分类合计：A 8、B 3、C 3、D 1、E 6、F 1、G 7，共 29。

### 主要耦合

- `poolItems` 同时驱动 localStorage、筛选、决策台、导入按钮、Task 门禁和 Agent URL。
- `hasAccess + serverAvailable + identitySource + id + status + Task relation + R2.2` 共同决定 Agent 可用性。
- 来源导入有 preview 与 confirm 两套请求态；preview Candidate 不能被误当成服务端 Candidate。
- `poolHydrated` 是恢复顺序门闩；错误移动会让空初始值覆盖缓存。
- `serverAvailable` 同时表达网络探测和 authority 降级，语义比普通 loading 更重。

## 4. Effect 与生命周期

|Effect|依赖|读取/写入|I/O 与 cleanup|竞态与 Strict Mode|
|-|-|-|-|-|
|输入草稿恢复|`draftRestored`, `draftVal`|读取 hook 恢复值，写 `rawText`|无网络；无 cleanup|`didRestore` 保证只恢复一次|
|Candidate hydration|`hasAccess`, `refreshServerPool`, `visualFixture`|写 pool、hydrated、serverAvailable、notice|服务端 GET；失败读 localStorage；cleanup abort|AbortController 阻止卸载后继续；Strict Mode 会重建请求但旧请求被 abort|
|Candidate 本地持久化|`poolHydrated`, `poolItems`, `visualFixtureMode`|写 Candidate localStorage|无 cleanup|hydration 前和 fixture 模式不写|
|Task link 加载|`hasAccess`, `serverAvailable`, `accessPassword`|写 Task Map/loading|GET tasks；cleanup 只设置 cancelled|阻止 stale setState，但不 abort 网络|
|portal 菜单定位|`openMoreId`|查询按钮并写 style|监听 scroll/resize；cleanup 两个 listener|依赖 DOM 位置，当前无真实 DOM 自动化|

## 5. 网络调用

|请求|触发|业务写入|降级/保护|
|-|-|-|-|
|`GET /api/opportunity-candidates?limit=100`|初始加载和 refresh|否|server-first；失败回退浏览器 pool；可 abort|
|`GET /api/tasks?limit=50`|服务端 Candidate 可用|否|失败静默降级；cancelled flag|
|`POST /api/opportunities`|手工分析|可能触发真实 AI/Visitor quota|认证与数量门禁；本任务不调用|
|`POST /api/opportunity-candidates`|分析后保存|Owner Prisma 或 Visitor Sandbox|失败保留本地分析结果并显示 notice|
|`PATCH /api/opportunity-candidates/[id]`|状态修改|是|optimistic update；失败回滚 previous status|
|`DELETE /api/opportunity-candidates/[id]`|确认删除|是|服务端保护已关联 Task；本地草稿只删浏览器|
|`POST /api/opportunities/source-import`|来源 preview；Phase 3A PRODUCTION client adapter 发出|不写 Candidate|签名不可用 fail-closed；Phase 3B PRODUCTION 只允许最新启动请求提交可见状态|
|`POST /api/opportunity-candidates`|确认签名预览|是|重新检查 canSave；成功后 refresh|
|`POST /api/opportunity-candidates/import-local`|显式升级草稿|是|强制 legacy_unverified；Owner/Visitor 分流|

组件没有统一 request id。Phase 3B 只为 preview 增加 generation 写入门禁；分析、PATCH 和 DELETE 仍主要依赖 disabled/loading 状态减少重复触发。Phase 3C 证明 Confirm 在同一事件周期可双 POST；Phase 3D 当前候选以单实例同步 ref 关闭该窗口，但不增加 stale-response、请求取消或服务端幂等保护。

## 6. Storage 与 URL

|对象|位置|TTL/版本|authority|
|-|-|-|-|
|输入草稿 `qx:opportunities-draft:v1`|localStorage|10 分钟 / v1|非权威|
|Candidate pool `qx:opportunity-candidate-pool:v1`|localStorage|7 天 / v1|非权威；不恢复 Evidence、R2.2、`convertedTaskId`|
|密码/到期|sessionStorage adapter|当前 tab|访问状态，不由表单直接读写|
|token/mode/Visitor access|sessionStorage adapter|当前 tab|访问状态，不由表单直接读写|
|Agent query|`buildCandidateAgentRunHref`|一次导航|交接材料，不是服务端 Candidate authority|

组件不读取 query string，只构建 `/agent/run` URL。

## 7. 权限与权威数据流

```mermaid
flowchart TD
  I["输入/来源预览"] --> L["local draft 或 preview\n非权威"]
  L -->|"POST Candidate / import-local"| S{"服务端身份"}
  S -->|Owner| P["Prisma Candidate"]
  S -->|Visitor| D["demoAccessId Sandbox Candidate"]
  P --> G["状态 + Task + R2.2 + Evidence 门禁"]
  D --> G
  G -->|通过| A["/agent/run"]
  G -->|不通过| B["阻止交接"]
  A --> R["服务端重新读取 Candidate + Run Proof"]
  R --> H["人工复核"]
  H --> T["Owner transaction / Visitor 原子 Sandbox 写入"]
```

- Owner authority：Prisma Candidate 与 Task。
- Visitor authority：匹配 `demoAccessId` 的 Sandbox Candidate 与 Task。
- localStorage、URL 和 preview 均不能覆盖服务端 authority。
- `official_readonly` Visitor Candidate 不能修改、删除或进入 Agent。
- Task Snapshot 或 `convertedTaskId` 任一存在时，Candidate 不得再次进入 Agent，删除也必须被保护。

## 8. UI 职责分区

- surface header、主路径说明和权限/fixture 提示；
- Candidate intake：手工输入、分析、结果、复制与导出；
- source import：URL/RSS/Sitemap preview、warning、选择与确认；
- Candidate pool：筛选、排序、计数、local import；
- decision desk：列表、详情、Evidence、风险、R2.2 与处理状态；
- actions：状态、Agent、Task link、删除和 portal 菜单；
- empty/error/degraded states。

## 9. 审计结论

Phase 1 和 Phase 2 已正式收口，Phase 3A request adapter、Phase 3B preview generation 与 Phase 3C Confirm Characterization 已进入 production main。Phase 3D 当前候选只为父组件增加一个同步 single-flight ref，关闭同一组件实例内的 Confirm 双 POST 窗口；请求取消、stale response、卸载、多标签页及服务端并发幂等仍未解决。
