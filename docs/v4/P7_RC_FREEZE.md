# P7 Release Candidate（Lead 冻结 — 最终）
- RC SHA：`2feb848fa46ccb88b770c80874dad8beddd5865f`（main，本地；未 push/tag/deploy——按用户授权边界）
- 冻结时间：2026-08-21T16:14:32.351Z（初始）；最终复核：2026-08-22 01:30 +08:00
- 验证工作包：A=自动化回归；B=安全/Eval；C=文档/干净安装/演示；Lead=全链浏览器 E2E + Go/No-Go
- B1 / B3 / B4：已于 `2feb848` 收口——B1=image-handoff gate fail-closed（409 creative_gate_unavailable，不生成不写数据）+ 回归测试；B3=/api/opportunities 根路由 410 + 契约测试（子路由保留）；B4=记录不失效契约确认（注释补强，逻辑不变）
- 最终验收证据（`2feb848` 实测）：lint 0 error/8 warning；tsc exit 0；npm test 5769 passed / 0 failed / 78 skipped；npm run build exit 0；真实浏览器：Image Studio ContentHandoff 空值失败→批准参考图→生成 2 候选成功链 + Public Replay 浏览/刷新持久链
- 剩余发布动作（需用户显式授权）：push / tag / 部署 / README V4 声明（G6）/ 公网无痕 E2E
