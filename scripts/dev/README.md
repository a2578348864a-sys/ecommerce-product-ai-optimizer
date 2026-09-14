# 开发脚本

这里放本地开发和验收所需的可复用脚本：

- `local-next-runtime.mjs`：启动、停止和检查本地 Next.js 运行时。
- `local-smoke-runtime.mjs`：为本地 smoke 流程准备隔离运行环境。
- `run-local-service.ps1`：使用项目约定启动本地服务。
- `register-local-autostart.ps1`：管理本机开发服务的自启动注册。
- `create-demo-password.mjs`、`create-guest-codes.mjs`：生成本地演示访问凭据。
- `run-project-materials-tests.mjs`：运行项目材料相关检查。

这些脚本面向本地开发，不会把凭据写入仓库；请先阅读脚本帮助或项目文档，再按需运行。
