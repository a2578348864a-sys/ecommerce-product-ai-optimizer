# 轻选工作台项目结项报告

## 项目定位

轻选工作台是面向跨境电商团队的本地商品研究与上架准备工具。它把商品证据、市场资料、买家反馈和供应链线索整理成可复核的工作流，关键业务决定保留给人工完成。

本项目以可追溯、可复核和安全边界为交付重点。AI 用于整理研究资料和生成候选内容，不能替代事实确认、风险判断或最终发布决定。

## 已完成能力

- 从真实候选商品进入商品研究，并保存研究记录。
- 通过统一编排整理 Amazon 商品资料、关键词与竞品、买家反馈（VOC）和 1688 供应链线索。
- 对页面证据、商品事实、关键词和货源候选提供预览、来源追溯和人工确认流程。
- 以 Confirmed Facts 作为 Listing 事实边界，保留 Claim Evidence、Unknown、Prohibited Claims 和人工复核门禁。
- Listing V5 使用 Writer v9、conversionBlueprint v2、approvedBenefits 安全投影和 Validator v6，支持生成、校验、保存和刷新读取。
- Image Studio 使用已确认研究资料和人工审核门禁生成视觉候选，不自动发布。
- 通过统一导航连接商品研究、研究记录、文案工作台和图片工作台。

## 技术架构

- Next.js 应用承载页面、服务端 API 和本地运行时。
- Prisma + SQLite 保存任务、研究证据、确认事实和 Listing 快照；数据库文件属于运行数据，不进入公开仓库。
- Research Collection Orchestrator 统一协调各研究来源，并以 Preview → Candidate → Human Confirmation 的顺序推进。
- Listing V5 采用 Confirmed Facts → conversionBlueprint → approvedBenefits → Writer → Validator → Snapshot 的链路。
- Writer、Repair、Rewrite、Recovery 共用事实安全合同；策略文本只提供表达 framing，不创建商品事实。
- 文档、开发脚本、运维脚本和历史 release 记录分层存放，运行凭据与本地生成物由仓库规则排除。

## 核心流程

```text
真实候选商品
  → 商品研究
  → 研究资料编排
  → 证据预览与事实候选
  → 人工确认
  → 研究记录与创作资料
  → Listing Studio / Image Studio
  → 生成候选
  → 安全校验与人工复核
```

Listing 和图片结果都必须经过人工复核后才能用于后续业务动作。刷新页面会从服务端快照重新读取，不依赖浏览器内存状态。

## 验证结果

- 3005 本地运行时健康检查通过。
- 首页、研究详情、Listing Studio、Image Studio 均通过真实浏览器打开检查。
- 桌面 1440×900 与移动 390×844 检查通过，页面没有横向溢出。
- 研究详情展示研究完成、资料就绪、事实确认和创作流程状态。
- Listing Studio 展示事实确认、策略参考、生成门禁和人工复核提示。
- Image Studio 展示资料确认、参考图确认和人工选择步骤。
- 浏览器复核期间未捕获未处理异常。
- TypeScript 检查通过；Lint 通过（仅保留既有 warning）。
- 公开文档入口、脚本目录和历史 release 归档已分别提交；敏感运行记录、证据图片和内部冻结材料保持在非公开范围。

## 已知限制

- 1688 助手连接属于外部环境依赖，连接中断时系统应保持失败可见并等待重新连接。
- DeepSeek 请求可能受本地 VPN/TUN 或网络代理影响；这是运行环境注意事项，不代表产品链路绕过安全门禁。
- 研究和 Listing 结果仍需人工复核，项目不宣称转化率或其他商业效果提升。
- 本地数据库、访问凭据、浏览器会话和验收证据不属于公开仓库内容。
- 历史文档中包含运行环境记录的部分仍未公开提交，后续如需公开应先完成逐文件脱敏。

## 后续不再开发范围

本项目已进入结项和展示状态。除安全修复、依赖升级和运行环境维护外，不再继续开发新的研究来源、第二套 Listing 系统、Provider 绕过方案、复杂 UI 重构或大规模 legacy 清理。

## 结项状态

```text
PROJECT_STATUS = COMPLETE
PRODUCT = RELEASED
PUBLIC_REPOSITORY = READY
DOCUMENTATION = COMPLETE
SCRIPT_STRUCTURE = COMPLETE
ARCHIVE = COMPLETE
BUSINESS_SCOPE = FROZEN
GIT_STATUS = CLEAN_OR_EXPECTED_DIRTY_ONLY
```
