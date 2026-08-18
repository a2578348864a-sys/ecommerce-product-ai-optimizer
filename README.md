# 轻选工作台

轻选工作台是一套基于真实电商数据的 AI 商品研究与内容生产工作台，通过 Evidence 驱动的研究流程，把 SellerSprite、Amazon、VOC、1688 供应线索与 AI 内容生产连接起来，并保留人工确认作为关键决策门禁。

（**V3 FROZEN**；最终 HEAD `ae67912`；详见 [Final Release Report](docs/v3/FINAL_RELEASE_REPORT.md)）

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

## Documentation

- [文档索引](docs/README.md)
- [快速开始](docs/getting-started/installation.md)
- [架构总览](docs/architecture/overview.md)
- [认证与配额契约](docs/architecture/auth-and-quota-contract.md)
- [部署手册](docs/deployment/production-runbook.md)

## Project Status

**V3 = FROZEN**（`V3_PRODUCT_INTEGRATION = PASS`、`V3_PUBLIC_DEMO_READINESS = PASS`、`V3_RELEASE_STATUS = APPROVED`、P0=0 / P1=0）。

- **Main**: `main` = 唯一权威基线（HEAD `ae67912`），本地与远端一致，working tree clean；项目进入 **MAINTENANCE ONLY**，不再进行新版本开发。
- **Public Demo**: https://112.124.54.81（V3 公网演示，Visitor 沙箱隔离；部署与运维见 [部署手册](docs/deployment/production-runbook.md)）。
- **Experiment**: `experiment/listing-evidence-expression-v1`（commit `466e8c0`）为历史冻结实验分支，不进入基线、不部署生产；其目标已由 main 能力实现并覆盖，分支仅作历史追溯保留。
- **历史**: V1/V2/V3 全部 Git 历史与 release tag 原样保留，作为开发记录。

## Security

本项目涉及 AI Provider 密钥、访问认证、文件上传与用户数据隔离。请阅读 [SECURITY.md](SECURITY.md) 了解安全边界与报告方式。

## License

MIT License。详见 [LICENSE](LICENSE)。
