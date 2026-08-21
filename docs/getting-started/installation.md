# 安装

## 环境要求

- Node.js ≥ 20.9
- npm
- SQLite（Prisma 驱动，通常无需单独安装）

## 安装

```bash
npm install
```

初始化数据库并生成 Prisma Client：

```bash
npx prisma generate
npx prisma db push
```

## 配置

复制环境变量模板：

```bash
cp .env.example .env.local
```

编辑 `.env.local`，至少设置 `ACCESS_PASSWORD`（登录密码）。Listing/Image Provider 默认为 Mock 模式，本地研究演示无需真实 API Key；研究 AI Provider（`AI_PROVIDER=deepseek|openai`）需要有效密钥——`.env.example` 中的 key 为占位值，真实调用前必须替换。详见 [configuration.md](../guides/configuration.md)。

## 启动开发服务器

带 SQLite 门禁的本地入口（推荐，端口 3005）：

```bash
npm run check:local   # 验证本机端口与 SQLite 数据库就绪（不启动服务）
npm run dev:local     # 启动开发服务器（带数据库门禁）
```

浏览器打开 http://localhost:3005 进入登录页。

纯开发服务器（无数据库门禁）可执行 `npm run dev`（http://localhost:3000）；生产模式本地入口用 `npm run start:local`（同样带门禁）。

## 验证安装

```bash
npm run check:provider-config
```

该命令检查 Provider 配置是否就绪（不暴露密钥值）。preflight 会自动创建 `data/ai-image-drafts/` 存储目录（与运行时一致），全新克隆无需手工建目录。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev:local` | 启动开发服务器（带 SQLite 门禁，端口 3005） |
| `npm run start:local` | 启动生产模式（带 SQLite 门禁，端口 3005） |
| `npm run check:local` | 验证本机端口与 SQLite 就绪（不启动服务） |
| `npm run autostart:local` | 注册登录自启动计划任务（3005） |
| `npm run dev` | 纯开发服务器（无数据库门禁，端口 3000） |
| `npm run build` | 生产构建 |
| `npm run start` | 启动生产服务器 |
| `npm run test` | 运行测试（Vitest） |
| `npm run lint` | ESLint 检查 |
| `npm run db:generate` | 重新生成 Prisma Client |
| `npm run demo:create` | 创建访客体验密码 |
