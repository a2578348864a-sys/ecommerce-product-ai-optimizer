# V3 Final Product Integration — Plan

> 基线：main == origin/main == 29c2933 → 整改分支 `codex/v3-final-product-integration`
> 权威审计：`docs/v3/V3_FINAL_PRODUCT_AUDIT.md`（P0=0，P1=8：F1/F2/F3/F4/F5/F8/F10/F11；P2=5）
> 原则：无 DB migration、无架构重写、每个 Package 后 targeted/tsc/lint + commit。

## Package A — 数据与能力接通
- F4：Candidate → Task identity 继承（productUrl authority + ASIN/marketplace 派生 + Browser ASIN 回退 + 修复文案）
- F3：Sourcing 分能力 readiness（CLI_READY / IMAGE_EXTENSION_READY 独立 gate 与文案）
- F11：AI Evidence Summary 输入重建（接入 Browser/VOC/Sourcing/Competitor + EvidenceRef + NO_EVIDENCE gate）
- F5：VOC draft 会话持久化 + 409 自动重载 + legacy PATCH 收敛到 mutation layer

## Package B — 产品主链重新编排
- F1：Start Research = create/get Research Task → 直达 /tasks/[id]（Research Workbench）；候选页降为 Pre-Research；AI 研究执行入口移到 Workbench 引导卡；保存后自动进入 Workbench
- F2：SourcingEvidencePanel 移入 EvidenceWorkbench 证据序列（VOC 后、AI 总结前）；删除静态"未收集"占位
- F10：决定 authority 收敛（列表不再直接改决定，统一前往 Workbench；导航"研究历史"→"研究记录"）

## Package C — 旧入口与正式攻击面收口
- F8：孤儿真实 AI API（/api/generate、/api/agents/*5）410 下线；/workflow/batch 重定向收口；/products/new 保存到任务中心下线 + 文案如实化
- P2：导航/文案（研究记录）、test drift 修正

## 最终验收
- 全量回归 / tsc / lint / build
- 真实浏览器 User Journey（A-H + Visitor + Error）
- 安全审查 + secret scan
- main 集成（safe fast-forward）+ push + 3005 切换
