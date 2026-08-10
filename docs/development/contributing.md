# 参与贡献

欢迎提交 Issue 与 Pull Request。

## 开发环境

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

## 代码检查

提交前请通过以下检查：

```bash
npm run lint      # ESLint
npm run test      # Vitest 测试
npm run build     # 生产构建
npx tsc --noEmit  # 类型检查
```

## 目录结构

```
app/           Next.js 页面与 API Routes
components/    React 组件
lib/           业务逻辑与服务
lib/server/    服务端专用逻辑
prisma/        数据模型与迁移
scripts/       开发与运维脚本
tools/         上游数据处理工具
docs/          文档
```

## 约定

- 不修改被冻结的 Prompt / Schema / Quality 规则（如涉及请先提出 Issue）
- 外部图片获取必须经安全校验链，不允许任意 URL 直连
- 访客体验与正式数据保持隔离
- 新功能需附测试；测试使用 Vitest

## 提交规范

- 提交信息使用简洁祈使句（如 `feat: add ...` / `fix: correct ...`）
- 不提交 `.env.local`、密钥、数据库文件与构建产物

## 安全说明

发现安全问题时，请通过 Issue 或邮件私下联系维护者，避免公开披露漏洞细节。
