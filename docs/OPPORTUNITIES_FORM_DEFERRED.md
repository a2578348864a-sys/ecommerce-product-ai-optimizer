# OpportunitiesForm 延后事项

> Source baseline：`origin/main` commit `e536c8bf9771af1b7d615511fdda8449034d3867`，tree `a6d8eaf991b6c733bbb862996fe0cf7d4c11b693`
>
> 记录日期：2026-07-23。本文只记录未获授权、需要产品决定或不能在当前测试环境中安全证明的事项，不代表已批准实施。

## 1. 行为与并发

|事项|为什么延后|进入条件|
|-|-|-|
|为 analyze/preview/confirm/PATCH/DELETE 增加 request generation 或统一 abort|会改变竞态和错误展示行为，不是机械整理|先建立真实 DOM/异步交互测试，逐项定义旧行为和目标行为|
|验证 Strict Mode 下请求次数与恢复顺序|当前 Vitest 是 Node environment，无 DOM mount adapter|单独批准测试基础设施；不得为测试增加生产 seam|
|portal 菜单 viewport/scroll/keyboard 行为|需要真实 DOM、布局和事件环境|补充浏览器或 DOM 测试方案后独立处理|
|把多个 boolean/loading 改为 reducer/state machine|会改变状态结构和错误恢复|先完成 View Model 与 command seam，再单独设计|

## 2. module 拆分

|事项|风险|当前结论|
|-|-|-|
|来源导入 controller|preview 与 confirm、签名输入、错误分支紧密耦合|先提取纯视图，再评估 controller|
|Candidate pool Hook|包含 hydration、authority、Storage、Task link 和 mutations|不能把现有 state 原样搬入一个巨型 Hook|
|统一请求 client|可能改变错误体、headers、abort 和 retry|API 合同不变的前提下另行审计|
|访问态 props 收口|密码/token/session 属保护区|当前不动|

## 3. 代码健康调查

|事项|证据|为什么不在本轮执行|
|-|-|-|
|`hooks/useLocalStorage.ts`|生产和测试静态 import 均为 0|仓外/未来消费者 UNKNOWN；缺少生命周期批准|
|`lib/tasks/filterTaskRecords.ts`|生产 import 为 0，测试直接引用 1|必须先确认测试所保护的历史搜索合同，不能删测试制造通过|
|Profit Snapshot 类型重复|UI 和 `lib/profitSnapshot.ts` 各自声明同名结构|统一可能改变兼容 normalize 和 UI props|
|Candidate status 类型重复|client pool 与 server service 分别声明|跨权限/持久化合同，不能仅为去重合并|
|`aiListingDraft` ↔ `listingClaimFilter` type-level cycle|一个 runtime import + 一个 type-only import|当前无 runtime cycle 证据；先评估类型归属|

## 4. 产品与运行事实 UNKNOWN

- `/opportunities/import` 真实直接 URL 访问量；
- 仓外 `/api/opportunities/crawl` 和 `/api/generate` 消费者；
- 生产服务器当前实际运行 commit；
- 用户是否依赖 Candidate portal 菜单的特定 viewport 行为。

无日志或负责人证据前，不能把 UNKNOWN 写成无人使用、可删除或已验证。
