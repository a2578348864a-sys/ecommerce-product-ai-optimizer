# 运维与环境检查脚本

- `provider-preflight.mjs`：检查本地 Provider 配置是否具备运行条件（不会输出密钥）。
- `db/protect-sqlite-db.mjs`：执行本地 SQLite 备份和保护操作。
- `launch-1688-login.ps1`、`probe-1688-window.ps1`：本地 1688 助手诊断。

这些脚本只用于开发环境或人工维护。执行涉及数据库或浏览器状态的命令前，请确认目标是本地环境。
