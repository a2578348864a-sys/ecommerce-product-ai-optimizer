# 数据模型

数据由 Prisma 管理（`prisma/schema.prisma`），默认 SQLite。

## 核心模型

| 模型 | 用途 |
| --- | --- |
| `OpportunityCandidate` | 候选商品（含 SellerSprite 来源快照） |
| `ViralAnalysisRecord` | 研究任务，存储研究记录与创作状态 |
| `ProductBatch` / `ProductBatchItem` | 商品批次与条目 |
| `ProductDiscoverySelection` | 商品发现选择 |
| `ListingCopyHistory` | Listing 草稿历史 |

## 关键设计

### 候选商品（OpportunityCandidate）

- `sourceMetaJson`：来源快照（SellerSprite 合同、商品身份、资料）
- `analysisJson`：分析侧存储（市场决定、图片快照等）
- 支持批量导入，按 ASIN 去重

### 研究记录（ViralAnalysisRecord.resultJson）

单一 JSON 承载：

- `researchRecord`：版本化研究记录（含哈希校验）
- `researchVerification`：研究验证快照
- `candidateAnalysisContext`：候选分析上下文（商品事实、图片）
- `creativeHandoff`：创作交接（已确认事实、视觉参考、创作偏好）
- `creativeHandoffRequestLedger`：幂等账本

### 创作交接

- 确认事实带 `usageScopes`（internal / listing / image），控制字段进入哪些创作
- 视觉参考带身份绑定（task / candidate / revision / contentHash）
- 每次创作确认写入版本，支持审计

### 图片资产

- 商品图片快照以 dataUrl 内嵌存储，携带 contentHash 校验
- 支持 `product-batch-product-image` 与 `market-screening-product-image` 两种版本格式
