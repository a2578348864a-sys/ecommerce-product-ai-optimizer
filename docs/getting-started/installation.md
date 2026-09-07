# 快速安装与配置 (Getting Started)

本文档介绍如何在本地机器快速完成轻选工作台的安装与初始配置。

---

## 1. 环境要求

- **Node.js**: `≥ 20.9.0`
- **npm**: `≥ 10.0.0`
- **SQLite**: 内置支持（由 Prisma 自动管理）

---

## 2. 安装步骤

```bash
# 安装依赖包
npm install

# 初始化数据库并生成 Prisma Client
npx prisma generate
npx prisma db push
```

---

## 3. 环境配置

复制环境变量模板：

```bash
cp .env.example .env.local
```

编辑 `.env.local` 文件：
- 默认已配置 `LISTING_PROVIDER_MODE=mock` 与 `IMAGE_PROVIDER_MODE=mock`，无需任何外部大模型 API Key 即可完整体验全流程；
- 如需调用真实大模型（DeepSeek 或 OpenAI），请将相应变量修改为 `real` 并填入有效密钥；
- 详细配置说明请查阅 [配置指南](../guides/configuration.md)。

---

## 4. 启动服务

```bash
# 1. 验证本机环境与数据库就绪状态
npm run check:local

# 2. 启动本地开发服务器 (带环境门禁保护)
npm run dev:local

# 或启动本地生产模式服务
npm run start:local
```

启动完成后，打开浏览器访问终端打印的本地服务地址（例如 `http://localhost:<PORT>`）。

---

## 5. 验证安装

```bash
npm run check:provider-config
```

该命令用于验证模型提供商配置是否正确（绝不输出明文密钥）。

---

## 6. 常用工程脚本

| 命令 | 说明 |
| :--- | :--- |
| `npm run dev:local` | 启动本地开发服务器（推荐，带环境与数据库门禁） |
| `npm run start:local` | 启动本地生产模式服务器 |
| `npm run check:local` | 验证环境依赖与数据库就绪状态（不启动服务） |
| `npm run dev` | 启动纯开发模式服务器 |
| `npm run build` | 执行 Next.js 生产环境打包构建 |
| `npm run test` | 运行 Vitest 全量自动化测试套件 |
| `npm run lint` | 执行 ESLint 代码规范检查 |
| `npm run db:generate` | 重新生成 Prisma Client |

更详细的开发指引与架构设计请参阅 [本地开发指南](../development/local-development.md)。
