# OpportunitiesForm 长期维护路线

> Source baseline：`origin/main` commit `e536c8bf9771af1b7d615511fdda8449034d3867`，tree `a6d8eaf991b6c733bbb862996fe0cf7d4c11b693`
>
> 制定日期：2026-07-23。本文是未来任务入口，不授权自动执行。每个 Phase 必须单独建立分支、验证和人工审查。

## 总门禁

每个 Phase 只做一种结构变化，禁止同时改 copy、API、Storage、权限、数据库、Artifact 或并发语义。最低验证为：相关测试、完整单线程测试、TypeScript、完整 ESLint、Production Build、`git diff --check` 和独立 detached review。

## Phase 1：纯展示 module

- 修改范围：header、状态 badge、只读 summary 或空状态；一次只提取一个低风险 UI 区域。
- 风险：DOM 顺序、copy、ARIA、CSS breakpoint 意外变化。
- 测试：公开 surface SSR、现有 decision desk 测试、人工 viewport/keyboard 检查。
- 回滚：单个可 revert Commit，保留 `OpportunitiesForm` 公开 interface 与 `data-testid`。
- 禁止同时做：state、Effect、fetch、portal 和视觉重设计。

## Phase 2：派生 View Model

- 修改范围：把筛选计数、decision row presentation、Agent/delete eligibility 组合为纯 selector。
- 风险：遗漏 `official_readonly`、Task Snapshot、`convertedTaskId`、R2.2 或 Evidence 优先级。
- 测试：Owner/Visitor、local/server、linked/unlinked、R2.2 四态的 table-driven tests。
- 回滚：旧派生表达式与新 selector 不能长期双轨；失败直接 revert。
- 禁止同时做：更改 Candidate status 或服务端 payload。

## Phase 3：来源导入流程

- 修改范围：先提取 view；行为证据充分后再考虑 preview/confirm controller。
- 风险：把 preview 当保存、丢失签名 trio、refresh 失败误报、选择规则漂移。
- 测试：source-import fail-closed、canSave、Owner/Visitor import-local、保存 adapter。
- 回滚：preview 与 confirm 保持两个 command，任何混合写入立即 revert。
- 禁止同时做：crawler、签名、API 合同、访问策略。

## Phase 4：Candidate 逻辑

- 修改范围：Candidate 列表、详情、Task link 与 actions 的 presentation module。
- 风险：local draft 进入 Agent、已转 Task 被删除、Visitor 越权、R2.2 门禁丢失。
- 测试：跨 module authority handoff、删除策略、Task link、Agent URL、status rollback。
- 回滚：保持现有 `lib/opportunityCandidatePool.ts` 作为唯一纯规则来源。
- 禁止同时做：Candidate→Task transaction、Prisma、Sandbox。

## Phase 5：Storage Hook

- 修改范围：输入草稿恢复与 Candidate pool hydration，分成明确的 local cache adapter。
- 风险：空初始值覆盖缓存、fixture 写存储、过期 payload 恢复、缓存冒充 authority。
- 测试：TTL、损坏 JSON、version mismatch、SSR、server-first/fallback、Strict Mode。
- 回滚：storage key/version 不变；旧 Hook 保留到新 interface 全部通过后再替换。
- 禁止同时做：迁移 key、扩大 TTL、跨 tab 同步。

## Phase 6：请求 module

- 修改范围：Candidate GET/POST/PATCH/DELETE、tasks GET、source preview 的 transport adapter；只在真实测试 adapter 存在后建立 seam。
- 风险：headers、错误码、abort、stale response 和 Owner/Visitor 语义改变。
- 测试：production adapter contract + in-memory test adapter、失败/abort/乱序测试。
- 回滚：逐 endpoint 替换，不做一次性 client 重写。
- 禁止同时做：API Route、重试策略、认证或错误文案变更。

## Phase 7：容器收口

- 修改范围：`OpportunitiesForm` 只保留公开 surface、access adapter 接入、module 组合和少量跨 module 协调。
- 风险：props 爆炸或把实现细节暴露为 interface。
- 测试：完整行为合同、页面集成、人工主链回归。
- 回滚：每个前置 Phase 独立可回滚；不建立大爆炸迁移 Commit。
- 禁止同时做：状态管理库、路由调整、产品功能扩张。

## 下一项唯一推荐

单独启动 Phase 1，只提取一个纯展示叶子区域；不同时调整 state、请求、Storage、权限或 Candidate 规则。

