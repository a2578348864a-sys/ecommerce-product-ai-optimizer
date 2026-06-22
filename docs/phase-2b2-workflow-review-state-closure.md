# Phase 2-B.2 Workflow Review State Closure

## 结论

Phase 2-B.2 已完成、已部署，并通过生产最小验收。

当前生产 HEAD：

```text
1fd894c4706ac9dc676c1fbd20a094d7ee613fd5
```

本阶段可以正式收口。项目已经具备：

```text
AI 分析结果 -> 人工复核状态 -> 保存任务 -> 人工决策状态
```

这一条基础闭环。

## 背景

Phase 2-B.1 已经在 `/workflow` 页面加入人工复核区，用户可以逐项确认：

- 货源判断
- 风险排查
- 小白结论
- Listing 文案

但当时的 checkbox 只存在前端运行时。刷新页面、保存任务、进入任务中心后，人工复核状态不可追踪，也不能在任务列表和任务详情里复查。

Phase 2-B.2 的目标是把这部分人工判断沉淀到任务记录里，让任务中心能区分“待复核”和“已复核”。

## 本阶段目标

- `reviewState` 持久化到 workflow 任务结果中。
- `/tasks` 列表展示复核进度 badge。
- `/tasks/[id]` 详情页展示四步复核状态。
- `decisionStatus` 手动切换回归通过。
- 不自动替用户做继续、补资料、淘汰判断。

## 修改摘要

本阶段核心修改文件：

```text
app/api/workflows/product-analysis/save-task/route.ts
components/cross-border/WorkflowClient.tsx
components/TaskRecordDetail.tsx
components/TaskRecordsList.tsx
```

主要变化：

- `/workflow` 保存任务时带上四步人工复核状态。
- `save-task` API 服务端重新计算 `reviewedCount` 和 `allReviewed`，避免客户端伪造。
- `/tasks` 列表显示 `待复核 2/4` 或 `已复核 4/4`。
- `/tasks/[id]` 详情页显示每一步已确认/未确认。
- `decisionStatus` 仍独立存在，不因 reviewState 写入而自动变化。

## 数据结构

workflow 任务结果中新增：

```text
result.reviewState
```

结构：

```ts
{
  sourcingReviewed: boolean;
  riskReviewed: boolean;
  summaryReviewed: boolean;
  listingReviewed: boolean;
  reviewedCount: number;
  totalReviewSteps: 4;
  allReviewed: boolean;
  reviewedAt: string | null;
}
```

字段说明：

- `sourcingReviewed`：货源判断是否人工确认。
- `riskReviewed`：风险排查是否人工确认。
- `summaryReviewed`：小白结论是否人工确认。
- `listingReviewed`：Listing 文案是否人工确认。
- `reviewedCount`：已确认步骤数。
- `totalReviewSteps`：固定为 `4`。
- `allReviewed`：是否 4/4 全部确认。
- `reviewedAt`：全部确认时写入时间；未全部确认时为 `null`。

## 决策原则

保存任务后，`decisionStatus` 默认仍为：

```text
pending
```

系统不自动推荐：

- `continue`
- `need_info`
- `rejected`

原因：AI 分析和人工复核状态只说明“信息是否看过、是否确认过”，不等于系统能替用户做采购、上架或淘汰决策。

最终决策仍由用户在任务中心手动切换。

## 本地验收

本地轻量验收已通过：

- `npm.cmd run lint`：通过。
- `npm.cmd run test`：通过，`21 files / 262 tests passed`。
- `npm.cmd run build`：通过，`37/37` pages。
- 2/4 待复核保存通过。
- 4/4 已复核保存通过。
- `/tasks` 列表 badge 正确。
- `/tasks/[id]` 详情 review 状态正确。
- `decisionStatus` 手动切换回归通过。
- `decisionStatus` 切换后 `reviewState` 未丢失。

本地验收没有调用真实 AI，使用 save-task API 构造 workflow 结果完成。

## 生产部署

生产部署信息：

- 部署前 HEAD：`1dedc41ba6267f5f8cf41c3121a45cbfcb458450`
- 当前生产 HEAD：`1fd894c4706ac9dc676c1fbd20a094d7ee613fd5`
- commit：`feat: persist workflow review state on task save`
- `npm run build`：通过，`37/37` pages。
- PM2：`alibaba-ai-assistant` online。
- `/api/health`：200，返回 `{"ok":true}`。
- `/workflow`：200。
- `/tasks`：200。
- 公网 `3005`：未暴露。
- 无密码访问受保护 API：仍返回 401。

本次部署没有执行 `npm ci`，因为 `package.json` / `package-lock.json` 未变。

## 生产最小验收

生产最小验收已通过。

验收方式：优先不用真实 AI，直接通过 save-task API 构造 1 条 workflow 任务记录。

验收商品：

```text
验收测试-桌面手机支架
```

验收结果：

- save-task 返回成功：`ok=true`。
- `allReviewed=false`。
- 新建任务 id：`cmqp4jxkx0000bput14ixr3ct`。
- `/tasks` 列表显示 `待复核 2/4`。
- 任务名：`验收测试-桌面手机支架 一键分析`。
- `decisionStatus=pending`。
- `/tasks/[id]` 详情 reviewState 正确：
  - `sourcingReviewed=true`
  - `riskReviewed=true`
  - `summaryReviewed=false`
  - `listingReviewed=false`
  - `reviewedCount=2`
  - `allReviewed=false`
- `decisionStatus` 切换通过：
  - `pending -> continue -> pending`
- `decisionStatus` 切换后 `reviewState` 未丢失。
- PM2 error log 无新增 500 / Next 崩溃 / Prisma 崩溃。

## 安全边界

本阶段和生产验收遵守以下边界：

- 未读取 `.env` / `.env.local` 内容。
- 未打印访问密码。
- 访问密码只通过服务器端 env 临时加载，没有保存到聊天或文件。
- 未调用真实 AI。
- 未改数据库结构。
- 未新增 migration。
- 未改 Nginx 配置。
- 未改 PM2 配置。
- 未进入 Phase 2-C。

## 当前结论

Phase 2-B.2 可正式收口。

项目现在已经具备 Alpha 阶段所需的基础任务闭环：

```text
输入商品 -> AI 分析 -> 人工复核 -> 保存任务 -> 任务中心复查 -> 人工决策状态
```

这是全自动电商 Agent 的 Alpha MVP 受控自动化链路，不是完全无人值守执行系统，也不是完整批量队列系统。

## 剩余风险

- `reviewState` 仍存放在 `resultJson` 的 JSON 中。Alpha 阶段够用；后续如果要做统计、筛选、队列或数据看板，可以考虑拆成独立字段或专门表。
- 当前只是单任务 review 持久化，不是批量任务队列。
- 当前没有自动状态机，不会自动把任务推进到继续、补资料或淘汰。
- 当前尚未实现完全无人值守执行，采购、上架、投放等关键动作仍必须人工确认。

## 下一步建议

不要把全自动电商 Agent 理解为一次性大改无人值守系统。

下一阶段可选：

- A. Phase 2-C：全自动电商 Agent 路线下的批量输入与任务队列 MVP。
- B. 先做 Alpha 数据清理和真人测试材料。
- C. 先优化首页/导航，把 Alpha MVP 已实现能力和规划中能力分开。

推荐优先 A，但必须做成小 MVP：

- 先支持少量商品批量输入。
- 先做任务队列状态展示。
- 不做自动发布、不做外部平台操作、不做多账号批量行为。
- 单次任务仍保持人工复核和人工决策。
