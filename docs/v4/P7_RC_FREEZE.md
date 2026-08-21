# P7 Release Candidate（Lead 冻结）
- RC SHA：`1494e77a1b6e44f4f97cf5054338eadc284269a6`（main，本地；未 push/tag/deploy——按用户授权边界）
- 冻结时间：2026-08-21T16:14:32.351Z
- 验证工作包：A=自动化回归；B=安全/Eval；C=文档/干净安装/演示；Lead=全链浏览器 E2E + Go/No-Go
- 发布阻断项（待用户裁定）：B1（handoff quota 基线测试失败，方向 A=route 防御 / B=修 mock）；B3（/api/opportunities legacy 410）；B4（isDemoAccessExpired 语义）；P6 公网部署授权。
