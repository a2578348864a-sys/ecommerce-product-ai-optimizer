# 生产路由生命周期

> Production baseline Commit：`2d4562aea234543ef3862b0d10a07e0ac40039b0`（短哈希 `2d4562a`）
> Production baseline Tree：`f1b4d9bebc51ddca01bd70ab615e02fe90833aa0`
> 审计日期：2026-07-23
> 事实来源：已 fetch 的 `origin/main`；只以该引用中的 Route 文件、导航、redirect、调用和运行条件为生产事实。
> 排除范围：其他分支的 dirty、未跟踪文件和 Provider 工具均为 `IN-FLIGHT / LOCAL / NOT_PRODUCTION`，不进入生产路由表。
> 复核要求：生产 Commit 或 Tree 变化后，必须重新枚举 `app/**/page.tsx` 和 `app/api/**/route.ts`。

## 状态与角色

|状态|含义|
|-|-|
|`PRODUCTION`|生产 main 中的当前正式能力。|
|`COMPATIBILITY`|为旧入口或旧页面消费者保留。|
|`EXPERIMENTAL`|Alpha、诊断或 development-only 能力。|
|`ARCHIVED`|页面明确声明归档/停止维护。|
|`UNKNOWN`|Route 存在，但站内消费者和生命周期无法由静态证据确认。|
|`IN-FLIGHT`|仅在其他本地分支/工作树存在，不属于本表。|

`PRIMARY` 和 `ADVANCED_HIDDEN` 是 `PRODUCTION` 下的入口角色，不是独立生命周期。

## 页面 Route

|Route|生命周期|入口角色|生产证据|
|-|-|-|-|
|`/`|`PRODUCTION`|`PRIMARY`|首页；直接提供 opportunities、agent/run、tasks 三个入口。|
|`/opportunities`|`PRODUCTION`|`PRIMARY`|主导航入口；本地草稿和服务端 Candidate 双层池。|
|`/agent/run`|`PRODUCTION`|`PRIMARY`|主导航入口；支持 Candidate 与 manual 输入。|
|`/tasks`|`PRODUCTION`|`PRIMARY`|主导航入口；Task 列表与推进。|
|`/tasks/[id]`|`PRODUCTION`|`PRIMARY`|Task 详情、生命周期与后续资产。|
|`/opportunities/import`|`PRODUCTION`|`ADVANCED_HIDDEN`|生产可构建、非 redirect、非 development-only；静态站内 href 为 0。|
|`/workflow`|`COMPATIBILITY`|旧入口|保留已知 query 并 `redirect()` 到 `/agent/run`；不渲染旧客户端。|
|`/materials`|`COMPATIBILITY`|旧多页工具|仍渲染旧素材表单，不在主导航。|
|`/products/new`|`COMPATIBILITY`|旧产品页|仍可直接访问并链接 `/workflow`。|
|`/risk`|`COMPATIBILITY`|旧多页工具|旧风险表单。|
|`/sourcing`|`COMPATIBILITY`|旧多页工具|旧供应链表单。|
|`/summary`|`COMPATIBILITY`|旧多页工具|旧总结表单。|
|`/workflow/batch`|`EXPERIMENTAL`|高级 / Alpha|侧边栏明确标为高级 / Alpha；仍有站内链接。|
|`/viral`|`EXPERIMENTAL`|实验入口|Viral Mock Agent；由兼容页面/Task 概念链接，不在主导航。|
|`/agent`|`ARCHIVED`|归档说明|页面文案明确归档，CTA 指向 `/agent/run`、opportunities、tasks。|

页面统计：

- `PRODUCTION 6`：其中 `PRIMARY 5`、`ADVANCED_HIDDEN 1`
- `COMPATIBILITY 6`
- `EXPERIMENTAL 2`
- `ARCHIVED 1`
- `UNKNOWN 0`
- 合计 15

静态代码没有页面 Route 调用 `notFound()`。这只说明没有静态调用，不证明任意 URL 在真实运行时一定返回某个状态码。

## API Route

### PRODUCTION

|Route|生产职责|
|-|-|
|`/api/auth/login`|访问解锁。|
|`/api/health`|生产健康检查。|
|`/api/opportunities`|机会分析；返回分析结果，不等同于已持久化 Candidate。|
|`/api/opportunities/source-import`|URL/RSS/Sitemap 来源导入与 Evidence 生成。|
|`/api/opportunity-candidates`|权威 Candidate 列表/创建。|
|`/api/opportunity-candidates/[id]`|Candidate 状态更新与删除边界。|
|`/api/opportunity-candidates/import-local`|本地草稿显式转成服务端 Candidate。|
|`/api/workflows/product-analysis`|Candidate/manual 分析和 Run Proof。|
|`/api/workflows/product-analysis/save-task`|人工复核后保存 Task；Candidate 路径执行原子转换。|
|`/api/tasks`|Task 列表/创建。|
|`/api/tasks/aggregate`|Task 聚合。|
|`/api/tasks/[id]`|Task 详情/更新/删除。|
|`/api/tasks/[id]/lifecycle`|Task 生命周期。|
|`/api/tasks/[id]/listing-pack`|Listing Pack。|
|`/api/tasks/[id]/listing-pack/ai-generate`|受控 AI Listing 生成。|
|`/api/tasks/[id]/listing-pack/ai-save`|AI Listing 保存。|
|`/api/tasks/[id]/image-draft`|图片草稿创建/列表。|
|`/api/tasks/[id]/image-draft/[imageId]`|图片草稿单项访问/清理。|

### COMPATIBILITY

|Route|兼容职责|
|-|-|
|`/api/agents/material`|旧素材页面后端。|
|`/api/agents/risk`|旧风险页面后端。|
|`/api/agents/sourcing`|旧供应链页面后端。|
|`/api/agents/summary`|旧总结页面后端。|
|`/api/products/ai-analysis`|旧产品分析 API。|
|`/api/products/keywords`|旧关键词 API。|
|`/api/products/listing-copy`|旧 Listing Copy API。|
|`/api/products/listing-copy-history`|旧 Listing 历史列表。|
|`/api/products/listing-copy-history/[id]`|旧 Listing 历史单项。|

### EXPERIMENTAL

|Route|静态生产行为|
|-|-|
|`/api/agents/viral`|服务 `/viral` 实验页；没有 production 404 条件。|
|`/api/ai/diagnostics`|仅非 production 且诊断开关开启时可用；production 返回 404。|
|`/api/ai/ping`|同上；production 返回 404。|
|`/api/radar/search`|非 production + localhost 辅助；production 返回 404。|
|`/api/radar/analyze-links`|非 production + localhost 辅助；production 返回 404。|
|`/api/radar/analyze-materials`|非 production + localhost 辅助；production 返回 404。|
|`/api/radar/save`|非 production + localhost 辅助；production 返回 404。|

### UNKNOWN

|Route|证据与不确定项|
|-|-|
|`/api/opportunities/crawl`|Route 在 production 可执行，但生产 TS/TSX 中静态调用为 0；是否有仓外消费者未知。不能仅因 source-import 复用同一底层 crawler 就称它为兼容入口。|
|`/api/generate`|Route 在 production 可执行，生产 TS/TSX 中静态调用为 0；仓外消费者和保留期限未知。|

API 统计：

- `PRODUCTION 18`
- `COMPATIBILITY 9`
- `EXPERIMENTAL 7`
- `ARCHIVED 0`
- `UNKNOWN 2`
- 合计 36

## redirect、404 与 development-only 汇总

|对象|行为|证据边界|
|-|-|-|
|`/workflow`|代码调用 Next `redirect()` 到 `/agent/run`|未启动运行时，不声明实测 HTTP 状态。|
|AI diagnostics 两个 API|production 返回 404|Route 和 `isAiDiagnosticsAllowed()` 条件。|
|Radar 四个 API|production 返回 404|每个 Route 的 `NODE_ENV` 条件。|
|`/opportunities` visual fixture|只在 development + 专用开关下启用|生产页面仍为正常 `OpportunitiesForm`。|
|`/opportunities/import`|无 development 条件、无 redirect|`PRODUCTION / ADVANCED_HIDDEN`。|

## 本地在途边界

其他分支的 dirty、未跟踪 Provider 工具或新增 Route 一律是 `IN-FLIGHT / LOCAL / NOT_PRODUCTION`。只有出现在后续 `origin/main` Commit 中并重新完成本表扫描，才能进入生产统计。
