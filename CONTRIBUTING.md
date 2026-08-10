# Contributing

欢迎参与贡献。详细约定见 [docs/development/contributing.md](docs/development/contributing.md)。

## 快速开始

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

## 提交前检查

```bash
npm run lint
npm run test
npm run build
npx tsc --noEmit
```

## 贡献流程

1. Fork 仓库并创建特性分支
2. 提交改动（遵守提交规范）
3. 通过全部检查
4. 发起 Pull Request

## 行为准则

- 尊重其他贡献者
- 聚焦问题本身，避免人身讨论
- 新功能需附测试
