# P7 Release Candidate（Lead 冻结）
- RC SHA：`032f8ac2828983ab560e2df90d59d242e2c16ed`（main，本地；未 push/tag/deploy——按用户授权边界）
- 冻结后审计收口 commit（3 个，均为本地）：`3c6a9fa`（脱敏模式扩展 JWT/AWS/PEM/Bearer）、`4cd1ad0`（.gitignore env 分环境条目）、`032f8ac`（P7-C 收口：preflight 自建存储目录/安装文档/.env.example/P0_CONTRACT）
- build 验证：`032f8ac` 受控窗口实测 PASS（停 3005 → `npm run build` exit 0 → 计划任务重启，health 200、登录页 200、`/api/v4/runs` 404 保持 flag-off 契约）
- 冻结时间：2026-08-21T16:14:32.351Z
- 验证工作包：A=自动化回归；B=安全/Eval；C=文档/干净安装/演示；Lead=全链浏览器 E2E + Go/No-Go
- 发布阻断项（待用户裁定）：B1（handoff quota 基线测试失败，方向 A=route 防御 / B=修 mock）；B3（/api/opportunities legacy 410）；B4（isDemoAccessExpired 语义）；P6 公网部署授权。
