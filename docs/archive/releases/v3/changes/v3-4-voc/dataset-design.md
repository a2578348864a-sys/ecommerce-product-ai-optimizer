# V3.4 — VOC Dataset 设计（dataset-design）

> 真实 Review 数据如何进入工作台、如何被规范化、去重与有界存储。

## 1. 数据来源（实测结论，2026-08-15）

| 来源 | 状态 | 说明 |
|---|---|---|
| A. 人工导入 Review 样本 | **PASS（首选路径）** | 用户粘贴真实评论（ASIN + 角色 + 星级 + 文本），服务端规范化/去重/有界校验后入库 |
| B. 评论页 /product-reviews/{ASIN} | **不可用（不绕过）** | 当前环境评论页重定向到 Amazon 登录墙（`/ap/signin`，诊断证据见 smoke-evidence/review-page-diag.txt）；不绕过登录/CAPTCHA |
| B'. 详情页公开 Top Reviews 片段 | **PASS（降级路径）** | 商品详情页公开展示 Top Reviews（真实星级/日期/标题），可绑定 ASIN 与 sourceUrl；正文折叠不可见（已知限制） |
| C. 其他方式 | 未评估 | 需独立验证 |

**走查证据**：`smoke-evidence/walkthrough-result.json`——3 个真实 ASIN（B0C3NFB3CZ / B0BG3C7CNJ / B07G4VTV2F）经 human-assisted 浏览器获取 29 条真实 Top Reviews，导入链路全通。

## 2. 规范化（deterministic）

- 文本：trim + 压缩空白 + 控制字符清理；原文保留在 `reviewText`
- contentHash = sha256(normalizeReviewText(reviewText))（大小写/空白不敏感）
- rating：1-5 整数校验
- ASIN：`^[A-Z0-9]{10}$` 校验
- 实体绑定：`productAsin` + `sourceProductRole`（current_candidate / competitor）强制；`entityBindingProof.binding` = manual_confirmed（人工导入）/ browser_verified / source_declared

## 3. 去重（dedupe）

- 优先 `reviewId`（来源提供时）
- 否则 `asin | contentHash | rating | reviewDate` 组合键
- 重复导入 → 幂等跳过（duplicateCount），不重复计数，不抬高主题频次

## 4. 有界存储（bounded）

| 规则 | 值 | 超限行为 |
|---|---|---|
| 每商品上限 | 100 条 | 拒绝该商品超限条目（rejectedCount） |
| 总数据集上限 | 300 条 | 409 review_dataset_limit（明确拒绝，不静默截断） |
| 单条文本 | 2000 字符 | 413 review_text_too_long |
| 单条 payload | 4KB | 413 review_item_too_large |
| 数据集 JSON | 256KB | 413 review_dataset_too_large |

> 数值由当前架构与测试决定（300 条 × 平均结构开销 ≈ 135KB < 256KB，留足真实长文本余量）；如需调整必须同步 contract.md 与常量。

## 5. 样本统计（DatasetStats，每次分析携带）

totalReviews / reviewsUsed / positiveCount(≥4) / negativeCount(≤2) / neutralCount(=3) /
ratingDistribution(1-5) / capturePeriod(from,to) / sourceProductCount / currentCandidateCount / competitorCount。

## 6. 采样透明

- `sampling.method`（manual_selected / browser_assisted / source_order）+ `note` + `reviewsAvailable`
- UI 不得显示"分析了全部用户评论"除非 reviewsUsed == totalReviews；采样时显示"仅使用 X/Y 条（采样）"
- 单边样本（如仅低星或仅高星）→ UI 显式提示（negative-biased / positive-biased）

## 7. 真实评论不入 Git

- 走查/验收用真实评论只进临时 sandbox；仓库只保留统计摘要 + contentHash 摘要（`smoke-evidence/walkthrough-result.json`）
- 测试 fixture 为脱敏/合成文本（Golden Eval 场景）
