# 轻选工作台

轻选工作台是一套基于真实电商数据的 AI 商品研究与内容生产工作台，通过 Evidence 驱动的研究流程，把 SellerSprite、Amazon、VOC、1688 供应线索与 AI 内容生产连接起来，并保留人工确认作为关键决策门禁。

（V4 已发布 **v4.0.0**：Evidence 驱动研究图 + 人工决策门禁 + Local Live / Public Replay，详见 [V4 文档索引](docs/v4/README.md)；V3 保持 FROZEN，详见 [Final Release Report](docs/v3/FINAL_RELEASE_REPORT.md)）

## Overview

跨境商品研究依赖大量分散数据（报表、市场信号、产品资料），人工整理耗时且容易出错。轻选工作台把「数据整理 → 事实确认 → AI 辅助生成」组织成一条可控流程：机器处理数据与草稿，人在关键节点做决定。

系统是辅助研究工具，**不会**自动采购、上架或投放广告。

## Features

- **SellerSprite 商品数据导入** — 上传 SellerSprite XLSX，自动解析商品资料、市场信号与卖点，生成可确认的商品事实候选
- **AI 商品研究** — 对单个商品执行来源、风险、总结与 Listing 维度的研究分析
- **Evidence Workbench** — Amazon 商品证据、关键词/竞品证据、VOC/Review 证据与 1688 供应线索证据统一呈现（已知 / 未知 / 风险 / 下一步）
- **1688 供应线索** — 关键词找货 / 图片找货 / 1688 URL 三入口 → Preview → 人工确认 → sourcing-evidence.v1；图片找货由普通 Chrome + 窄权限扩展驱动（零 CDP），关键词/详情由本地 1688 CLI 驱动
- **商品事实确认** — 人工确认哪些研究事实可用于创作，未确认内容不进入权威创作输入
- **AI Listing 生成** — 基于已确认事实生成 Listing 草稿，附质量校验与降级兜底
- **AI 图片创作** — 基于共享商品事实与已批准视觉参考生成图片草稿
- **Human-in-the-loop 工作流** — 研究决定（continue / need_info / rejected）、事实确认、Listing 与图片复核均由人工完成
- **数据隔离与安全机制** — 访客沙箱隔离、外部图片安全下载、市场信号与创作事实隔离

## How It Works

```mermaid
flowchart LR
    A[SellerSprite XLSX 导入] --> B[Candidate 候选池]
    B --> C[商品研究 / Evidence Workbench]
    C --> D[人工决策]
    D --> E[Listing Studio]
    D --> F[Image Studio]
    C -. 1688 供应线索 .-> G[Preview → Human Confirm → Evidence]
```

- **SellerSprite 导入**：解析 XLSX，提取商品资料与市场信号
- **商品研究 / Evidence Workbench**：AI 生成来源 / 风险 / 总结 / Listing 四层分析；Amazon、关键词、VOC、1688 Sourcing 证据统一呈现
- **人工决策**：continue / need_info / rejected；事实确认后进入创作
- **Listing Studio**：基于确认事实生成 Listing 草稿
- **Image Studio**：基于共享事实与批准参考图生成图片草稿

## Architecture

- **Frontend** — Next.js 应用，工作台 / Listing Studio / Image Studio 等页面
- **Backend** — Next.js API Routes，业务逻辑与 AI 编排
- **Database** — Prisma + SQLite，存储候选、研究记录与创作产物
- **AI Provider** — 可插拔：文本（Listing/研究）与图片（创作）独立配置，支持 Mock 模式
- **Storage** — 本地文件存储，承载图片草稿与导入数据

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Prisma 5 + SQLite
- OpenAI-compatible AI Provider（可替换）

## Getting Started

### 环境要求

- Node.js ≥ 20.9
- npm

### 安装

```bash
npm install
npx prisma generate
npx prisma db push
```

### 启动

带 SQLite 门禁的本地入口（推荐，端口 3005）：

```bash
npm run check:local   # 先验证本机端口与 SQLite 数据库就绪（不启动服务）
npm run start:local   # 启动正式本地服务（带数据库门禁）
npm run dev:local     # 启动开发服务器（带数据库门禁）
```

浏览器打开 http://localhost:3005 进入登录页。

本机长期预览可注册 Windows 计划任务自动管理：

```bash
npm run autostart:local        # 注册计划任务（登录后自动拉起 3005）
npm run autostart:local:status # 查看状态
```

如只需纯开发服务器（无数据库门禁）可执行 `npm run dev`（http://localhost:3000）。

详细步骤见 [快速开始](docs/getting-started/installation.md)。

## Environment Variables

复制 `.env.example` 为 `.env.local` 并填写。完整说明见 [配置说明](docs/guides/configuration.md)。

| 变量 | 作用 |
| --- | --- |
| `ACCESS_PASSWORD` | 登录访问密码（必填） |
| `PROOF_SIGNING_SECRET` | 会话令牌签发用独立随机密钥 |
| `AI_PROVIDER` | 文本 AI Provider（`deepseek` 等） |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | DeepSeek Provider 配置 |
| `LISTING_PROVIDER_MODE` / `IMAGE_PROVIDER_MODE` | `mock` 或 `real`（默认 mock，不调用真实付费 API） |
| `OPENAI_LISTING_ENABLED` | Listing AI 门禁（realAiListingGate 读取；与 `LISTING_PROVIDER_MODE=real` 同时为真才放行真实调用） |
| `OPENAI_LISTING_VISITOR_ENABLED` | 访客是否允许真实 Listing AI（默认 false） |
| `OPENAI_API_KEY` / `OPENAI_IMAGE_BASE_URL` / `OPENAI_IMAGE_MODEL` | 图片 Provider 配置 |
| `OPENAI_IMAGE_RESULT_HOSTS` | 图片下载结果域名白名单 |
| `DATABASE_URL` | SQLite 数据库路径 |
| `AI_IMAGE_DRAFT_STORAGE_ROOT` | 图片草稿存储目录 |

> 真实密钥值只存在于 `.env.local`，**绝不提交到版本库**。

## Testing

```bash
npm test          # Vitest 单元/集成测试
npm run lint      # ESLint
npx tsc --noEmit  # 类型检查
npm run build     # 生产构建
npm run check     # lint + test + build
```

测试不调用真实 AI Provider（默认 Mock），不访问生产数据库。

## Project Structure

| 目录 | 说明 |
| --- | --- |
| `app/` | Next.js 页面与 API Routes |
| `components/` | React 组件 |
| `lib/` | 业务逻辑、服务端门禁与数据层 |
| `prisma/` | Prisma Schema 与数据库 |
| `hooks/` | React Hooks |
| `scripts/` | 本地运行、验证与工具脚本 |
| `tools/` | 上游数据工具（SellerSprite、Amazon 采集等） |
| `tests/` | 测试辅助 |
| `docs/` | 项目文档 |


## V4 — 商品研究图（Local Live / Public Replay）

V4 把研究流程组织为**单一有状态 Research Workflow**（LangGraph，`QX_V4_GRAPH_ENABLED` 特性开关控制）：来源证据 → 商业/产品事实门禁 → 人工决策 → 内容草稿。

- **Evidence 链**：每条事实性结论都必须携带可追溯证据引用（`evidenceRefs`），无证据的断言不进入报告
- **Product Fact Gate**：商业计算（乐观/基线/悲观三情景，固定合同版本）与商品事实（SupplierClaim 不自动晋级；只读已确认事实）均设门禁，缺失时 fail-closed
- **Human Decision**：Gate A（继续研究 / 需信息 / 放弃）、Fact Gate、Gate B（内容就绪 / 改商品 / 需信息 / 放弃）、Content Review（批准导出 / 要求修订 / 拒绝资产）均由人工完成
- **Local Live**：本地 `QX_V4_GRAPH_ENABLED=on` 时 `/v4/runs` 全链运行（加载上下文 → 市场工具 → 商业检查 → 内容技能 → 人工中断点 → 完整报告）
- **Public Replay**：公网只读展示**已脱敏、含完整性校验**的历史案例回放（`/replay`），回放不进入任何真实浏览器 / 数据源，不代表当前市场或经营现况

**诚实边界（V4 同样适用）**：系统是辅助研究工具，不会自动选品、自动采购、自动上架或投放广告；不承诺盈利或销量；公网不提供实时采集；真实 Provider 调用受服务端开关与配额门禁（本机默认 Mock）。

已知限制与发布详情见 [KNOWN_LIMITATIONS.md](docs/v4/KNOWN_LIMITATIONS.md)、[RELEASE_NOTES_V4.md](docs/v4/RELEASE_NOTES_V4.md) 与 [CHANGELOG.md](CHANGELOG.md)。

## Documentation

- [文档索引](docs/README.md)
- [快速开始](docs/getting-started/installation.md)
- [架构总览](docs/architecture/overview.md)
- [认证与配额契约](docs/architecture/auth-and-quota-contract.md)
- [部署手册](docs/deployment/production-runbook.md)

## Project Status

**V3 = FROZEN**（`V3_PRODUCT_INTEGRATION = PASS`、`V3_PUBLIC_DEMO_READINESS = PASS`、`V3_RELEASE_STATUS = APPROVED`、P0=0 / P1=0）。

- **Main**: `main` = 唯一权威基线（V4 发布 HEAD，tag `v4.0.0`），本地与远端一致，working tree clean；V4 为当前版本线，V3 历史冻结保留。
- **Public**: https://112.124.54.81（Public Showcase：`QX_RUNTIME_MODE=public_showcase`，公网只读 Replay 历史案例回放 + V3 公网演示遗产；Visitor 沙箱隔离；部署与运维见 [部署手册](docs/deployment/production-runbook.md)）。
- **Experiment**: `experiment/listing-evidence-expression-v1`（commit `466e8c0`）为历史冻结实验分支，不进入基线、不部署生产；其目标已由 main 能力实现并覆盖，分支仅作历史追溯保留。
- **历史**: V1/V2/V3 全部 Git 历史与 release tag 原样保留，作为开发记录。

## Security

本项目涉及 AI Provider 密钥、访问认证、文件上传与用户数据隔离。请阅读 [SECURITY.md](SECURITY.md) 了解安全边界与报告方式。

## License

MIT License。详见 [LICENSE](LICENSE)。
