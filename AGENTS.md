# 项目协作规则入口

本仓库的共享协作规则正文位于 [`docs/development/AGENTS.md`](docs/development/AGENTS.md)。
开始修改、验证或发布前请先读取该文件；它定义仓库范围、安全边界和验证要求。

根目录 `AGENTS.md` 仅作为工具自动发现入口，完整规则集中维护在开发文档中，避免多份规则漂移。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
