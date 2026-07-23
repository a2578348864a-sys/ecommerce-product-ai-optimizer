# OpportunitiesForm 行为保护合同

> Source baseline：`origin/main` commit `d611a29315db110b8d0378bfb9f5e8769a14217d`，tree `8443b4779316e2b12b93513dc3bcd0efcac600ed`
>
> 审计日期：2026-07-23。本文记录后续结构调整不得无意改变的现有行为，不是新功能授权。

## 1. 证据等级

- **RENDERED**：通过公开 component interface 做 React SSR 断言；
- **MOUNTED**：通过公开 component interface 挂载并触发用户可观察交互；
- **DOMAIN**：通过生产纯 module interface 验证可观察结果；
- **ROUTE**：通过 Route 测试验证请求、权限和写入 adapter；
- **STATIC**：只证明当前 import/结构，不冒充用户行为；
- **UNKNOWN**：当前环境未自动证明。
- **SSR_RENDERED**：本轮 `RENDERED` 的测试名称标签；
- **MOUNTED_BEHAVIOR**：本轮 `MOUNTED` 的测试名称标签；
- **PURE_CONTRACT**：本轮 `DOMAIN` 纯函数合同的测试名称标签；
- **REQUEST_CONTRACT**：可控 fetch stub 下的 endpoint、method、headers、body、response 与异常边界证据；
- **TIMING_BEHAVIOR**：可控 deferred Promise 下的挂载状态与响应顺序证据；
- **STRUCTURAL**：本轮 `STATIC` 的结构证据标签。

## 2. surface 合同

|surface|行为|证据|
|-|-|-|
|默认|标题“机会雷达”，不显示“高级工具”|RENDERED|
|`advanced_import`|显示“高级工具 / 手工导入外部来源”|RENDERED + 页面测试|
|`visualFixture`|绕过本地 access/draft wrapper；不显示 intake；render phase 不 fetch|RENDERED|

`/opportunities/import` 不是兼容页或退役候选；访问量 UNKNOWN。

## 3. Candidate authority 合同

1. `normalizeCandidate` 产生的 local draft 不能进入 Agent，也不能生成权威 Agent href。**DOMAIN**
2. 只有当前服务端确认的 Owner/Visitor Candidate 才可能进入 Agent。**DOMAIN + ROUTE**
3. server unavailable 时，浏览器恢复项不能绕过 gate。**DOMAIN**
4. Task Snapshot 或 `convertedTaskId` 任一存在即阻止再次 handoff。**DOMAIN + ROUTE**
5. `official_readonly` 不能修改、删除或进入 Agent。**DOMAIN + ROUTE**
6. R2.2 reject/insufficient 阻止；watch 需要显式人工复核。**DOMAIN**
7. URL Evidence/R2.2 是 handoff Snapshot，服务端 Candidate 仍是 authority。**ROUTE**

## 4. Owner / Visitor 合同

- Owner Candidate/Task 只走 Prisma-backed service；
- Visitor 只走匹配 `demoAccessId` 的 Sandbox；
- Visitor 不得读取 Owner Task 或其他 Visitor 数据；
- import-local 在 Owner 与 Visitor 下都经过 legacy preflight；
- Candidate→Task 分别由 Prisma transaction 和 Sandbox 原子写入保证；
- 前端按钮显示不是权限控制。

这些保护区不因 component 提取而改变。

## 5. 分析与保存合同

|场景|必须保持|
|-|-|
|空输入、超过 30 条、access 未就绪|本地阻断，不发分析请求|
|分析成功|先展示临时结果，再尝试权威 Candidate 保存|
|Candidate 保存失败|保留本地结果并显示非权威 notice|
|Candidate 保存成功|refresh 服务端池|
|状态 PATCH 失败|回滚 previous status|
|已关联 Task 删除|UI presentation 和服务端同时保护|

真实点击与重叠请求仍为 UNKNOWN；后续不能把 disabled 状态误写成完整竞态保证。

## 6. 来源导入合同

1. preview 只调用 source-import，不写 Candidate；
2. SourceProof 签名不可用时必须 fail-closed，不能返回未签名 Candidate；
3. confirm 重新检查 `canSave`，使用既有 save adapter；
4. import-local 强制 `legacy_unverified`；
5. Owner/Visitor 使用各自 storage adapter；
6. 保存成功但 refresh 失败要保留“已保存”的事实。

治理候选补充了 `PROOF_SIGNING_SECRET` 的测试隔离，避免本机配置让 fail-closed 用例产生假失败。

来源可用性说明的展示合同：

- 只在已解锁且 intake 展开时出现，锁定 surface 不出现；**RENDERED + MOUNTED**
- default 与 `advanced_import` 使用相同四级顺序、文案和标识；**MOUNTED**
- 初始收起，点击 `<summary>` 展开，再次点击收起；展开状态由浏览器原生 disclosure 拥有；**MOUNTED**
- intake 展开及 disclosure 切换不新增业务 fetch、localStorage 或 sessionStorage 写入；**MOUNTED**

来源 warning 展示合同：

- warning 输入来自 `sourceImportWarnings: string[]`；source-import response 只有在 `warnings.length > 0` 时写入，新的 preview 和“清除结果”继续清空它；**STRUCTURAL**
- failure reason 只识别 warning 末尾的 `[a-z_]+`；已登记 reason 显示既有标题、说明、建议和移除 reason 后的消息；**PURE_CONTRACT + MOUNTED_BEHAVIOR**
- 无 reason 时继续原样显示 warning；字面量 `[unknown]` 继续显示原文，其他未登记 reason 继续显示既有“未知原因”富文本标签；**PURE_CONTRACT + MOUNTED_BEHAVIOR**
- URL 只识别 warning 开头的 `http/https` 加分隔冒号；中间、末尾、非 HTTP URL 不识别。`sourceUrl`、移除 URL 后的 `messageText` 以及 reason/URL/message 组合派生只由纯函数测试证明；**PURE_CONTRACT**
- `reasonKey` 与 `sourceUrl` 属于共享展示模型的当前合同并由纯函数测试覆盖，但唯一生产消费者只读取 `reasonLabel` 与 `messageText`；当前消费者没有读取或渲染 `reasonKey`/`sourceUrl`，也没有链接分支；**STRUCTURAL**
- 当前 warning 区不渲染链接；无 URL 时不出现虚假链接，default 与 `advanced_import` 的标签、消息、顺序和 class 保持一致。页面渲染证据不用于证明 URL 在原字符串中的位置解析；**SSR_RENDERED + MOUNTED_BEHAVIOR**
- 消息清理只移除末尾 reason tag 及其相邻空白，不额外 trim 或改写正文；空、空白、中文和特殊字符保持既有结果；**PURE_CONTRACT**
- default 与 `advanced_import` 保持同一顺序、class 与 fallback；锁定 surface 不显示 warning；目标交互只有既有 source-import POST，且不新增 Storage 写入；**SSR_RENDERED + MOUNTED_BEHAVIOR**

来源 preview command 合同（Phase 3A PRODUCTION；Phase 3B 候选）：

- 空 URL和纯空白在公开按钮路径被本地 disabled 阻断，不发请求、不启动 loading，也不显示 callback 内部的空值错误；非 URL 与特殊 URL 不增加客户端校验，trim 后按原文发送；锁定 surface 不渲染 preview command；**MOUNTED_BEHAVIOR + REQUEST_CONTRACT**
- 非空输入 trim 后只发送一次 `POST /api/opportunities/source-import`；保留 `Content-Type`、access headers、无显式 credentials、`{ input, accessPassword }` body；单次 preview 不调用 confirm、Candidate 或 Task endpoint；**REQUEST_CONTRACT + MOUNTED_BEHAVIOR**
- JSON 成功、空结果、warning、业务错误、200/204/401/403/404/429/500/502 非 JSON、不可解析 JSON、网络异常和 AbortError 均保持 main 的现有分支与文案；warning 顺序和重复项不变；**REQUEST_CONTRACT + MOUNTED_BEHAVIOR**
- 新请求开始时旧 error、warning 和 preview 的可见内容被清除；行为测试没有证明 summary、selection 或全部 setter 的逐调用顺序，后者仅可从当前源码结构确认；**TIMING_BEHAVIOR + STRUCTURAL**
- `requestSourceImportPreview` 只负责请求组装、单次 fetch 和 response 解析；React state、loading/error/warning、confirm、Candidate refresh、Storage 与权限仍由父组件拥有；**REQUEST_CONTRACT + STRUCTURAL**
- 只有通过输入校验并实际启动的 preview 才递增 generation；success、catch 和 finally 仅允许最新 generation 提交 preview、warning、error 或 loading。较旧 success/failure 不可覆盖最新结果，较旧 finally 不可提前结束最新 loading；同一 URL 重复请求也按启动顺序判定。**TIMING_BEHAVIOR**
- 当前没有 preview AbortController，卸载仍不会 abort 在途请求。loading 状态下的公开 UI 禁止不同 URL 或无效输入的第二次用户请求，因此测试明确证明“未发出”，不把它写成跨输入并发或卸载保护。**MOUNTED_BEHAVIOR + STRUCTURAL**

## 7. Storage 合同

- 输入草稿 key 与 10 分钟 TTL 不变；
- Candidate pool key、7 天 TTL 与 version 不变；
- 损坏、过期和版本不符 payload 安全清理；
- localStorage 不持久化可信 Evidence review、R2.2 或 canonical Task relation；
- fixture 不读写 Storage；
- access secret 继续由 session adapter 管理，不作为叶子 UI props 扩散。

## 8. Candidate pool 空状态合同

- `poolItems.length === 0` 优先显示池为空文案；**MOUNTED_BEHAVIOR**
- pool 非空但 `visiblePoolItems.length === 0` 时显示筛选为空文案；**MOUNTED_BEHAVIOR**
- 恢复“全部”后按既有顺序重新显示全部 Candidate，两个空状态均消失；**MOUNTED_BEHAVIOR**
- default 与 `advanced_import` 使用相同三态优先级；锁定 surface 不渲染 Candidate pool；**MOUNTED_BEHAVIOR + SSR_RENDERED**
- 两类空状态的 class、文案、条件优先级和正常列表留在父组件的事实由 source diff 与规范化合同哈希保护；**STRUCTURAL**
- 叶子不接收 Candidate 数组、权限对象或 callback；筛选与 Candidate authority 仍由父组件拥有。

## 9. 自动化矩阵

### Candidate pool 计数合同

- 输出字段固定为 `all`、`pending`、`worth_analyzing`、`analyzed`、`paused`、`rejected`；**PURE_CONTRACT + SSR_RENDERED**
- `all` 按数组元素总数计数，重复元素逐项计入；各合法状态进入对应桶；**PURE_CONTRACT**
- `analyzed` 排除已有 `convertedTaskId` 的 Candidate，但该 Candidate 仍进入 `all`；**PURE_CONTRACT + SSR_RENDERED**
- 绕过正常化的未知状态只进入 `all`；经服务端正常化的未知状态回落到 `pending`；**PURE_CONTRACT**
- 计数与顺序、surface 无关，不修改输入数组或 Candidate 对象；**PURE_CONTRACT + SSR_RENDERED**
- 原 `useMemo`、`[poolItems]` 依赖、筛选消费者和 Candidate authority 仍由父组件拥有；**STRUCTURAL**

### Candidate pool 过滤排序合同

- 默认 `poolFilter` 为 `all`，默认 `poolSort` 为 `updated`；UI 与纯函数测试保护每个 filter/sort 组合的最终可见输出；**MOUNTED_BEHAVIOR + PURE_CONTRACT**
- selector 当前实现先过滤再排序；该内部执行顺序由 source diff 确认，输出等价的未来实现未必能由行为测试区分；**STRUCTURAL**
- `all` 保留直接未知状态和已转 Task Candidate；五个合法状态只保留精确命中，`analyzed` 额外排除已有 `convertedTaskId` 的 Candidate；**MOUNTED_BEHAVIOR + PURE_CONTRACT**
- `updated` 按 `updatedAt` 降序、`score` 降序、中文名称升序；`score` 按 `score` 降序、`updatedAt` 降序、中文名称升序；全部比较键相等时保持输入顺序；**MOUNTED_BEHAVIOR + PURE_CONTRACT**
- `undefined` 或 `NaN` 使当前减法 comparator 进入下一字段；`+Infinity/-Infinity` 与有限值比较时作为可比较极值，只有相同 Infinity 相减产生 `NaN` 时才进入下一字段。Phase 2B 只冻结、不修复或正常化这些语义；**PURE_CONTRACT**
- selector 接收只读数组并返回新的有序数组，不修改输入数组或 Candidate 对象；不读取 surface、权限、Storage、时间或网络；**PURE_CONTRACT**
- 原 `visiblePoolItems` memo、`[poolItems, poolFilter, poolSort]` 依赖、列表/选择/空状态消费者和 Candidate authority 仍由父组件拥有；**STRUCTURAL**

### Candidate 状态色调合同

- 输入是 `CandidateQueueState`，不是持久化 Candidate status：`pending_review` 使用 `border-slate-200 bg-slate-50 text-slate-700`，`pending_analysis` 使用 `border-emerald-200 bg-emerald-50 text-emerald-700`，`analyzing` 使用 `border-indigo-200 bg-indigo-50 text-indigo-700`，`converted` 使用 `border-teal-200 bg-teal-50 text-teal-700`，`rejected` 使用 `border-rose-200 bg-rose-50 text-rose-700`；**PURE_CONTRACT**
- 运行时未知值保持原末尾分支的 slate 色调；函数确定、无副作用，不读取 Candidate、surface、权限、Storage、时间或网络；**PURE_CONTRACT**
- default 与 `advanced_import` 的列表和详情对同一状态使用相同色调；列表/详情各自的外围 class、标签和 DOM 不变；**SSR_RENDERED + MOUNTED_BEHAVIOR**
- 共享函数只有列表与详情两个生产消费者，原本地映射不存在；这项调用关系由源码结构哨兵证明，不冒充渲染行为；**STRUCTURAL**

|保护面|测试|
|-|-|
|公开 surface、fixture|`components/cross-border/OpportunitiesForm.behavior.test.ts`|
|Candidate pool UI 计数|`components/cross-border/OpportunitiesForm.pool-counts.test.ts`|
|Candidate pool UI 过滤与排序|`components/cross-border/OpportunitiesForm.visible-items.test.ts`|
|Candidate 状态色调与列表/详情一致性|`components/cross-border/OpportunitiesForm.status-tones.test.ts`|
|来源 warning 组合渲染与无链接合同|`components/cross-border/OpportunitiesForm.source-warnings.test.ts`|
|来源 warning 纯模型、reason/URL/消息合同|`lib/client/sourceImportLabels.test.ts`|
|来源 preview 请求、错误、loading、重叠响应与卸载合同|`components/cross-border/OpportunitiesForm.source-preview-command.test.ts`|
|来源 preview adapter 请求与解析合同|`lib/client/sourceImportPreview.test.ts`|
|来源可用性 disclosure|`components/cross-border/OpportunitiesForm.source-availability.test.ts`|
|Candidate pool 空池、筛选为空、恢复列表|`components/cross-border/OpportunitiesForm.candidate-pool-empty-state.test.ts`|
|local→server→Agent→Task authority 链|同上|
|删除 presentation|`components/cross-border/OpportunitiesForm.delete-policy.test.ts`|
|Candidate pool selector、Storage、R2.2|`lib/opportunityCandidatePool.test.ts`|
|Agent href|`lib/candidateAgentRunLink.test.ts`|
|Task relation|`lib/candidateTaskLinks.test.ts`|
|Owner/Visitor import-local|`app/api/opportunity-candidates/import-local/route.test.ts`|
|signed source fail-closed|`app/api/opportunities/source-import/route.test.ts`|

## 10. 未自动化风险

- 除来源 disclosure 外的 DOM 输入、confirm、portal 与 keyboard；
- Strict Mode Effect 时序；
- analyze/confirm/PATCH/DELETE 的重叠响应仍为 UNKNOWN；preview 已有 latest-started generation 写入保护，但没有 abort 或卸载失效保护；
- 真实 Owner/Visitor 服务端集成；
- `/opportunities/import` 实际访问量。

这些项目进入 `OPPORTUNITIES_FORM_DEFERRED.md`，不能用字符串扫描替代行为证据。

## 11. 后续变更门禁

任何 Phase 必须保持 props、路由、payload、Storage key、authority、错误合同和 Candidate→Task 原子边界。测试失败不得通过删测试、放宽断言、改 Fixture 或绕过 Guard 制造通过。
