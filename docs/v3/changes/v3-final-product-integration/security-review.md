# V3 Final Product Integration — Security Review

> 整改后安全复核（F1-F11 变更面）；基线 29c2933 的既有安全架构（Owner/Visitor 隔离、PreviewStore、Bridge、配额）不变。

## 逐项复核

| 项 | 结论 | 证据 |
|---|---|---|
| Owner/Visitor 隔离 | ✅ 未破坏 | start-research：demo 用 `getSandboxCandidate(demoAccessId)` 主体过滤（startResearchTask.ts）；owner 候选全局单一主体；save-task update 复用 `requireAuthenticated` context + task candidateToTask 绑定校验 |
| PreviewStore | ✅ 未接触 | Sourcing/Browser Preview 存储逻辑未改（仅 UI 位置移动） |
| Sourcing bridge | ✅ 未接触 | bridge/server.mjs 未改；分能力 readiness 只新增只读探测（getSharedBridge().getStatus()） |
| AI paid endpoints | ✅ 收缩 | 孤儿真实 AI API（/api/generate、/api/agents/*5）410 下线——**攻击面减少**；正式链 AI 门禁（配额/gate）未改 |
| prompt injection | ✅ 保持 | AI Summary 输入仍为数据字段 + system 固定（aiEvidenceSummary.ts 未改 prompt 结构；新证据字段同样按数据注入） |
| PII | ✅ 保持 | 未新增任何用户敏感字段持久化；VOC draft 用 sessionStorage（与现有 research-decision draft 同机制） |
| arbitrary command | ✅ 保持 | 1688 CLI 只读命令白名单未改 |
| arbitrary JS | ✅ 保持 | 无新 eval/注入面 |
| secret | ✅ 保持 | 未新增密钥处理；draft 明确禁止保存 token/password |
| URL validation | ✅ 强化 | F4 productUrl 继承 fail-closed（仅 https + Amazon 家族域名 + ASIN 匹配才派生）；Browser Evidence 回退仅限 US 市场 |
| Candidate → Task identity | ✅ 受控继承 | 只继承已保存合法 URL 或 ASIN+明确 marketplace；未知市场 null（不猜） |
| Decision write authority | ✅ 收敛 | 列表 legacy 修改移除；仅 Workbench（版本化面板）与 legacy PATCH（mutation layer） |
| orphan API 配额 | ✅ 消除 | 410 后无法再消耗 |

## 边界说明
- research-save writer 拥有 save-task 组装键集（含 sourceMeta，与 visual-reference 共享）——写入时机不同（研究保存 vs 图片参考导入），无并发竞争面；mutation layer 的 CAS + namespace 差异校验仍然生效。
- start-research 创建骨架任务不写 researchRecord；研究保存（save-task update）才写——期间任务处于"研究未开始"状态，无越权面。
