# V3 Final Product Integration — User Journey Test

> 目标：真实浏览器验证整改后的完整产品主链（用户 68-80 节）。

## Journey A — Happy Path（候选 → Workbench）
- 候选池「开始研究」→ POST start-research → 创建/获取 Task → **直接进入 /tasks/[id]**（不再经旧决策页）
- 验证 Task identity 继承：ASIN / productUrl / marketplace / title / image

## Journey B — Amazon Browser Evidence
- Workbench 中 Browser Evidence 不再因 productUrl=null 死锁（F4 继承 + ASIN 回退）
- 合法候选：Preview → Confirm → Persist（最小 smoke）

## Journey C — VOC 并发
- 输入长评论 draft → 同 Task 另一 Evidence 更新 → VOC 提交 → **draft 不丢**、自动刷新版本、可重试

## Journey D — Sourcing 独立 readiness（Hard Gate）
- Case 1：CLI 未登录 + 扩展就绪 → 图片找货可用（关键词/URL disabled 各自提示）
- Case 2：CLI 就绪 + 扩展不可用 → 关键词/URL 可用、图片 disabled

## Journey E — Sourcing 位置
- Sourcing 位于证据序列（VOC 后、AI Summary 前），Decision 之前
- 保存 sourcing evidence 后 Workbench 货源区不再显示假"未收集"

## Journey F/G/H — AI Summary / Decision / Handoff
- Summary 输入含多类证据 refs（Browser/VOC/Sourcing/Competitor）
- Decision 在 Evidence 之后（Workbench 唯一 authority）
- Listing/Image Studio 读取研究资料，不自动生成、不改决定

## 执行记录（浏览器验证后填写）
- [ ] Journey A-H 结果
- [ ] Visitor smoke
- [ ] Error journeys
- [ ] console/network 观察
