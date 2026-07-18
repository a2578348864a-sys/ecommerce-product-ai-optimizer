# 认证、权限与 AI 配额契约

> 本文是认证、Owner / Visitor 隔离、AI 配额和相关 Route 错误语义的按需契约。
> 普通代码任务不必读取；涉及登录、Token、权限、sandbox、真实 AI、配额、幂等或相关状态码时必须读取。
> 本文不保存秘密，也不复制易变时长、额度或租约数值。

## 权威边界

本文回答“应该保持什么契约”。当前实现现状仍以对应代码和测试为准：

- 身份解析：`lib/server/accessPassword.ts`
- Session：`lib/server/accessSession.ts`
- 签名 Token：`lib/server/signedToken.ts`
- Visitor 访问记录和配额：`lib/server/demoAccess.ts`
- 权限与配额 Guard：`lib/server/demoGuard.ts`
- Visitor sandbox：`lib/server/demoSandbox.ts`
- 登录 Route：`app/api/auth/login/route.ts`
- 文本工作流 Route：`app/api/workflows/product-analysis/route.ts`
- 图片生成 Route 与服务：
  - `app/api/tasks/[id]/image-draft/route.ts`
  - `lib/server/aiImageDraftService.ts`
  - `lib/server/aiImageDraftLedger.ts`

实现与本文不一致时，不自动选择一边覆盖另一边；先区分实现缺陷、文档漂移或待批准契约变化。

## 身份与隔离契约

- 内部身份仅为 `owner / demo`；对外可称 Owner / Visitor。
- 身份解析、资源归属和写权限必须在服务端执行。
- Owner 使用 Prisma 正式业务数据。
- Visitor 只使用其 `demoAccessId` 对应的 sandbox 和私有图片作用域。
- Visitor 不得读取或修改 Owner 正式数据，也不得访问其他 Visitor 的 sandbox。
- Owner 正式路径不得误写 Visitor sandbox。
- Token 有效但 Visitor 记录缺失、停用、过期或主体不匹配时必须 fail-closed。
- 前端状态、按钮隐藏、URL 参数、客户端缓存和 ID 前缀都不能替代服务端鉴权。

## 易变参数的唯一来源

本文不抄写具体数值。修改参数前只读取下列权威来源：

| 参数 | 唯一权威来源 |
|---|---|
| 签名访问 Token 有效期 | `lib/server/signedToken.ts` 中 `ACCESS_TOKEN_TTL_MS` |
| 旧内存 Session 兼容时长 | `lib/server/accessSession.ts` 中对应 Session TTL 常量；它是兼容实现，不得反向定义签名 Token 契约 |
| 文本配额预留租约 | `lib/server/demoAccess.ts` 中 `DEMO_TEXT_AI_RESERVATION_LEASE_MS` |
| 图片配额预留租约 | `lib/server/demoAccess.ts` 中 `DEMO_IMAGE_AI_RESERVATION_LEASE_MS` |
| 单个 Visitor 的 AI 总额度 | `lib/server/demoAccess.ts` 中 `DemoAccessRecord.maxAiCalls`，由受控创建流程写入 |
| 已消费额度 | `lib/server/demoAccess.ts` 中 `DemoAccessRecord.usedAiCalls` 和对应 reservation 状态 |
| Visitor 图片 Provider 开关 | `lib/server/realAiImageGate.ts` 的服务端配置读取 |
| 真实图片总开关 | `lib/server/realAiImageGate.ts` 的服务端配置读取 |

当前 Visitor 首次登录有效期没有独立命名常量或配置，创建脚本参数与登录激活实现也不是同一权威源。本文不固化该数值；任何调整前必须先在单独授权的代码任务中建立唯一常量或配置并补齐测试，本次规则重构不处理该实现问题。

如果签名 Token 与旧 Session 兼容常量不一致，以实际使用的签名 Token 路径判断当前行为，并把兼容不一致报告为实现缺口，不在文档中复制第二份数值。

## Route 状态码契约

状态码按 Route 和资源泄露风险设计，不得擅自全局统一。

- 缺少或无效认证通常由认证 Guard 返回 401。
- 已认证 Visitor 调用 Owner-only 动作通常返回 403。
- Visitor 请求 Owner 资源或其他 Visitor 资源时，部分 Route 有意返回 404 以避免泄露资源是否存在；不得统一改为 403。
- Visitor 访问记录停用、过期或额度不足的 Guard 当前使用 403 语义。
- 图片幂等键复用但请求语义冲突使用 409 语义。
- 配额 reservation 缺失、Provider-start 边界无法持久化或结算状态矛盾属于服务端一致性故障，当前相关工作流使用 500 语义。
- 具体 Route 的返回体、错误码和 HTTP 状态以该 Route 及其测试为准；修改任一状态码时必须同步审查客户端分支、信息泄露风险和回归测试。
- 禁止仅因相邻 Route 使用不同状态码就批量替换；差异可能是刻意的安全契约。

重点回归入口：

- `lib/server/demoGuard.test.ts`
- `app/api/tasks/[id]/route.access-control-fix1.test.ts`
- `app/api/opportunity-candidates/route.access-control.test.ts`
- `app/api/tasks/[id]/image-draft/route.test.ts`
- `app/api/workflows/product-analysis/route.quota.test.ts`

## 文本 AI 配额生命周期

Visitor 文本 AI 调用保持以下顺序：

1. 在 Provider 调用前按计划调用数原子预留额度。
2. 每次真正跨过 Provider 调用边界前，持久化累计 `providerStartedCount`。
3. 请求结束时按实际启动数结算。
4. 未启动的计划额度退回；已启动调用保持计费。
5. reservation 缺失、越序累计、重复但不一致的结算必须 fail-closed，不能静默绕过。
6. Owner 路径不建立或结算 Visitor reservation。

批量串行 Provider 调用使用调用方明确传入的 lease 需求，但不得低于文本默认租约；具体数值只读取代码常量和调用点。

## 图片 AI 配额与幂等生命周期

Visitor 图片调用同时受访问主体、任务、幂等键、请求语义、配额 reservation 和持久化 ledger 约束。

- Provider 调用前先原子预扣共享 Visitor 额度。
- 同一作用域和相同请求语义的重复请求复用既有结果，不重复调用 Provider、重复写图片或重复扣费。
- 同一幂等键对应不同请求语义时返回冲突，不覆盖旧记录。
- Provider 尚未产生候选结果且调用失败时，允许幂等退款。
- Provider 已返回候选结果后，即使后续 MIME、下载、解码、资产校验或存储失败，也视为 Provider 成本已发生，不退款。
- `provider_result_received` 及其后的失败状态必须由 ledger 持久化，不能回退成可退款状态。
- 退款、提交和终态更新必须幂等；重复恢复不得二次退款或二次扣费。
- Owner 图片路径不消耗 Visitor 配额，但仍受真实 AI 总开关、幂等和存储安全约束。

## 并发与恢复契约

- 额度检查和 reservation 写入必须在同一受控存储更新中完成，不能先读剩余额度再无锁写入。
- 并发请求只能有不超过剩余额度的 reservation 成功；失败请求不得造成负额度或覆盖已有 reservation。
- reservation 使用请求标识区分；相同标识但数量或语义不一致时显式冲突。
- 过期的未启动文本 reservation 退回全部未用额度。
- 过期但已经记录部分 Provider 启动的文本 reservation 只保留已启动部分计费。
- 已提交或已退款 reservation 的恢复不得再次改变额度。
- 图片恢复同时核对 quota store 和 durable ledger；若已经进入不可退款边界，不得因进程重启或后续失败退款。
- 损坏、缺失或互相矛盾的持久化状态必须 fail-closed，并返回受控错误，不猜测修复真实额度。

## 专项测试矩阵

### 认证与资源隔离

- 未认证、无效 Token、过期 Token。
- Owner。
- 当前 Visitor。
- 停用或过期 Visitor。
- 其他 Visitor。
- Visitor 请求 Owner 正式资源。
- Visitor 请求其他 Visitor sandbox。
- Owner 正式路径不写入 sandbox。
- 错误响应不泄露资源是否存在或内部秘密。

### 文本配额

- 额度充足、不足和恰好耗尽。
- Owner 不预留、不结算 Visitor 额度。
- 计划调用全部启动。
- 只启动部分调用并释放未使用额度。
- Provider 启动前失败。
- Provider 启动后失败。
- reservation 缺失、重复结算、越序累计和数量冲突。
- 并发 reservation。
- lease 过期前后恢复。
- 进程中断后保留已启动调用计费。

### 图片配额与 ledger

- Visitor 开关关闭和开启。
- 请求数量限制。
- 相同幂等键、相同语义的成功重放。
- 相同幂等键、不同语义的冲突。
- Provider 调用前失败并退款。
- Provider 无候选结果并退款。
- Provider 已返回候选结果后，下游失败不退款。
- MIME、下载、解码、资产校验和存储失败边界。
- 并发请求只成功预扣允许的次数。
- 重复 refund / commit 幂等。
- 进程重启后的 stale reservation 和 ledger 恢复。
- 受保护图片文件和任务数据不被跨主体访问。

### 状态码与消费者

- 对每个被修改 Route 锁定当前 HTTP 状态、业务错误码和响应体。
- 覆盖客户端对 401、403、404、409 和 500 的现有处理。
- 验证隐藏资源存在性的 Route 继续使用其既有 404 语义。
- 禁止用一份全局替换测试把不同 Route 强制成相同状态码。

## 修改与验证要求

涉及本文范围的任务至少需要：

1. 读取直接相关 Route、Guard、存储实现和测试。
2. 明确这是实现修复、契约变化还是参数调整。
3. 先建立或更新能证明目标边界的专项测试。
4. 运行直接相关测试和受影响消费者测试。
5. 涉及共享 Guard、Token、sandbox 或 quota store 时扩大到相关 Route 测试。
6. 涉及构建加载、环境配置或服务端边界时运行构建。
7. 确认真实 `data/demo-access.json`、`data/demo-sandbox.json` 和 `prisma/dev.db` 未发生非授权漂移。
8. 只报告实际验证结果和未覆盖范围。

真实 AI、真实外部调用、运行数据写入、迁移、部署和任何秘密读取仍需用户当前明确授权。
