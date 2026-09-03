# V4.1 文档导航

V4.1 是当前商品研究工作台产品线。这个目录同时包含**当前权威文档**、**工程收口记录**和**浏览器验收证据**。

为了避免从大量执行记录中判断“哪个才是现在的结论”，请优先从本页进入。

## 当前权威入口

| 文档 | 用途 |
| --- | --- |
| [FORMAL_V2_RELEASE_FREEZE.md](FORMAL_V2_RELEASE_FREEZE.md) | 正式工作台 UI/UX 产品化冻结记录 |
| [UI_CONTRACT.md](UI_CONTRACT.md) | V4.1 用户界面与交互约束 |
| [PUBLIC_CAPABILITY_MATRIX.md](PUBLIC_CAPABILITY_MATRIX.md) | 本地 Owner / Public Showcase 能力边界 |
| [PUBLIC_READINESS_AUDIT.md](PUBLIC_READINESS_AUDIT.md) | 公网展示就绪审计 |
| [RESEARCH_LISTING_CLOSURE_R5_PROGRESS.md](RESEARCH_LISTING_CLOSURE_R5_PROGRESS.md) | 研究资料 → Listing 依据链最终收口记录 |
| [LISTING_FINAL_COPY_QUALITY_PROGRESS.md](LISTING_FINAL_COPY_QUALITY_PROGRESS.md) | Listing Copy Quality 最终质量收口 |
| [LISTING_HISTORICAL_DRAFT_READ_GUARD_PROGRESS.md](LISTING_HISTORICAL_DRAFT_READ_GUARD_PROGRESS.md) | 历史草稿读取重判与安全守卫 |
| [VOC_REVIEW_CLOSURE_PROGRESS.md](VOC_REVIEW_CLOSURE_PROGRESS.md) | VOC / 买家评论研究区最终收口 |

## 浏览器与 UI 证据

- [`evidence/d-formal-v2/`](evidence/d-formal-v2/) — 当前正式工作台、商品研究、Listing、Image、响应式与交互验收截图
- [`evidence/c-end/`](evidence/c-end/) — 早期 C 端工作台阶段证据
- [`evidence/c-prototype/`](evidence/c-prototype/) — 原型阶段证据，仅供历史对比

> README 展示优先使用 `d-formal-v2` 中的正式验收截图，不使用早期 prototype 作为当前产品截图。

## 如何阅读 `*_PROGRESS.md` / `*_BLOCKED.md`

这些文件主要是 AI Coding 执行过程中的**事实账本与阻塞记录**，用于追溯某一轮任务为什么修改、如何验证、哪里曾经失败。

- `*_PROGRESS.md`：执行过程、测试结果、验收证据。
- `*_BLOCKED.md`：当时未解决或受环境限制的事项。
- 同一主题存在 R2/R3/R4/R5 时，优先阅读编号最高且已经完成收口的版本。
- 历史文件不自动代表当前系统仍存在同样问题；当前状态以代码、测试、最终收口记录和正式浏览器证据为准。

## 核心主链

```text
SellerSprite / Opportunity
        ↓
Candidate Pool
        ↓
Product Research
        ↓
Keyword / Competitor / VOC / 1688 / Cost & Risk
        ↓
Research Conclusions + Fact Candidates
        ↓
Human Confirmed Facts
        ↓
Listing Studio / Image Studio
        ↓
Human Review
```

## 文档边界

如果你只是想了解项目，请先看根目录 [`README.md`](../../README.md)。

如果你要安装、配置或部署，请看：

- [安装](../getting-started/installation.md)
- [架构](../architecture/overview.md)
- [认证与配额](../architecture/auth-and-quota-contract.md)
- [部署](../deployment/production-runbook.md)

本目录不作为“从零上手文档”；它主要保留 V4.1 产品化与验收的可追溯工程证据。
