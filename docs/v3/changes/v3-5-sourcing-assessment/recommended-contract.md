# V3.5 — Recommended Contract（sourcing-evidence.v1 合同评估）

> **Historical（2026-08-15 初始价值评估阶段）**：本文件为早期合同草案；正式权威合同以 `docs/v3/V3_5_PRE_IMPLEMENTATION_CONTRACT.md` 为准（Supersession 规则见 Contract §41）。
>
> 任务书三十节：仅在文档中评估，不正式实现。字段 Nature 分类基于 field-availability.md。

## 1. 定位

- namespace：`taskResultJson.sourcingEvidence`（复用 versioned resultJson + Evidence Read Model；**不新建 Prisma 表**）
- writer：`sourcing-evidence` → OWNED_NAMESPACES `["sourcingEvidence"]`
- 产品语义：**供应线索（Sourcing Evidence）**——真实 1688 页面快照的结构化保存 + 差异推导 + 待确认清单；**不是**供应商推荐/采购判断。

## 2. 建议最小模型

```ts
type SourcingEvidenceV1 = {
  schema: "sourcing-evidence.v1";
  version: 1;
  candidateId: string | null;
  entries: SourcingOfferEntry[];        // ≤ 有界上限（建议 20）
  updatedAt: string;
};

type SourcingOfferEntry = {
  entryId: string;                      // uuid
  sourceOfferId: string | null;         // 1688 offerId（用户提供/URL 解析；CONDITIONAL）
  sourceUrl: string;                    // 用户提供（RELIABLE）
  sourceSite: "1688";
  sourceProductRole: "current_candidate" | "competitor" | "sourcing_candidate";
  targetCandidateId: string | null;     // 绑定的工作台候选
  title: string | null;                 // Page Snapshot
  images: string[] | null;              // 仅 URL 引用（不保存图片二进制）；DISPLAY_ONLY
  displayedPrice: string | null;        // 页面展示价原文（如 "¥18–26" / "¥9.9 起"）；Page Snapshot
  displayedPriceNature: "single" | "range" | "starting_at" | "tiered" | "unknown";
  displayedMOQ: string | null;          // MOQ 原文（不归一化）；Page Snapshot
  displayedMOQNote: string | null;      // "可能对应单SKU/混批/定制" 等；CONDITIONAL
  specs: Array<{ name: string; value: string; nature: "page_snapshot" | "seller_claim" | "unknown" }>;
  materialClaims: string | null;        // Seller Claim
  dimensions: string | null;            // Page Snapshot（口径需确认）
  customizationClaims: string | null;   // Seller Claim
  dropshipClaim: boolean | null;        // Seller Claim
  supplierDisplayName: string | null;   // Page Snapshot（仅展示）
  supplierPlatformMetadata: {           // Platform Metadata（仅展示，禁止推导）
    storeAge: string | null;
    badges: string[] | null;
    salesInfo: string | null;
  } | null;
  capturedAt: string;
  importerVersion: string;              // 人工导入版本
  entityBindingProof: {                 // 绑定（人工确认）
    binding: "manual_confirmed" | "source_declared";
    note: string | null;
  };
  matchAssessment:                       // 匹配合同（任务书十四节；无 AI 概率）
    "exact_match" | "likely_similar" | "partial_match" | "different" | "unknown";
  matchEvidence: Array<{                // 每条：形态/功能/材质/尺寸/规格…
    item: string;
    status: "consistent" | "inconsistent" | "unknown";
    detail: string | null;
  }>;
  unknowns: string[];                   // 无法确认项
  manualConfirmationRequired: string[]; // 下一步人工/询盘确认项
  nature: "source_snapshot" | "review_observation" | "sourcing_clue";
};

// 有界（建议）
const SOURCING_ENTRY_LIMIT = 20;         // 每候选
const SOURCING_TEXT_MAX = 2000;          // 单文本字段
const SOURCING_PAYLOAD_MAX = 64 * 1024;  // namespace 上限
```

## 3. 字段 Nature 对照（任务书三十节要求）

| 字段 | Nature |
|---|---|
| sourceOfferId / sourceUrl / supplierDisplayName | SOURCE SNAPSHOT（可追溯标识） |
| title / displayedPrice / displayedMOQ / dimensions / specs(部分) | SOURCE SNAPSHOT（展示层） |
| materialClaims / customizationClaims / dropshipClaim / supplier 类型 | SELLER CLAIM（≠ Human Confirmed Fact） |
| storeAge / badges / salesInfo | PLATFORM METADATA（仅展示） |
| matchEvidence（consistent/inconsistent） | DERIVED（系统按双源对比推导） |
| unknowns / manualConfirmationRequired | UNKNOWN / NEEDS CONFIRMATION |

## 4. 禁止（合同级）

- **无 Supplier Score / Sourcing Score / 匹配概率**（任务书十五/三十一节）——匹配只用 evidence 清单 + 五态结论。
- **displayedPrice 不得转换为采购成本**；MOQ 不归一化（任务书十六/十七节）。
- **AI 输出白名单**（若未来有 AI 解释层，复用 V3.4 模式）：允许解释页面/比较差异/生成待确认问题；禁止宣称可靠/同款/成本/利润/合规/推荐采购。
- **不进入 confirmedFacts / Listing / Creative Handoff**（与 VOC 相同的 Review-Fact 隔离精神）。

## 5. 与 V3 主链接法（任务书三十四/三十五节）

- 进入 Evidence Workbench「货源 Evidence」区域（替代当前"未收集"占位，无数据时保持 unknown 不变）。
- amazon-product-research.v1 未来只读识别 `sourcingEvidence available`：已知什么/缺什么/需人工确认；禁止"供应商可采购/利润足够/建议上架"。
- 不重建旧 Supplier/Profit/Compliance Agent 链。

