/**
 * V3 Demo Acquisition Samples — 演示模式采集样本（只读静态数据）
 *
 * 来源：本地真实采集产物（THERMOS FUNTAINER 示例任务，2026-08 本地
 * 浏览器采集 + 真实 VOC + 1688 供应线索）提取的静态样本。
 *
 * 用途：公网 Demo （Visitor 模式）采集入口的演示回放。
 * 诚实性：所有样本都带 demoSource: true 标记，前端展示“演示数据”
 * 说明，不伪装实时采集印象。这些不是实时浏览器操作的结果。
 */
import type { BrowserEvidenceCollectPreview } from "@/lib/server/browserEvidenceCollect";
import type {
  ReviewCollectPageResult,
  ReviewSnippetPreviewItem,
} from "@/lib/server/reviewCollector";
import type { BrowserEvidenceV1 } from "@/lib/server/browserEvidence";
import type { ReviewEvidenceV1 } from "@/lib/server/reviewEvidence";
import type { VocAnalysisV1 } from "@/lib/server/vocAnalysis";
import type { AiEvidenceSummaryV1 } from "@/lib/server/aiEvidenceSummary";
import type { SourcingEvidenceV1 } from "@/lib/upstream/1688/contracts";
import type { AmazonEnvironmentStep } from "@/tools/collectors/amazon/browser-control";

export const DEMO_ACQUISITION_EVIDENCE_ID = "demo-acquisition-sample-v1" as const;

export const DEMO_BROWSER_EVIDENCE_SAMPLE: BrowserEvidenceV1 = {
  "schema": "browser-evidence.v1",
  "version": 1,
  "candidateId": "fixture-vr-cand-001",
  "targetAsin": "B0F2BF31PW",
  "snapshots": [
    {
      "evidenceId": "9f844387-fff4-4e37-bb2f-16b262cabb7c",
      "sourceType": "browser",
      "sourceSite": "amazon",
      "pageUrl": "https://www.amazon.com/dp/B0F2BF31PW?language=en_US&th=1",
      "marketplace": "amazon.com",
      "locale": null,
      "currency": "USD",
      "entityBinding": {
        "bound": true,
        "urlAsin": "B0F2BF31PW",
        "pageAsin": "B0F2BF31PW",
        "proof": {
          "urlMatchesExpected": true,
          "pageAnchorMatchesExpected": true,
          "productContainerFound": true
        }
      },
      "collectorVersion": "amazon-detail-page-extractor.v1",
      "capturedAt": "2026-08-16T19:25:55.749Z",
      "fields": {
        "asin": {
          "value": "B0F2BF31PW",
          "status": "correct",
          "reason": null,
          "nature": "snapshot"
        },
        "title": {
          "value": "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction | Kids Stainless Steel Insulated Water Bottle, Keeps Drinks Cold Longer for School & Play, BPA-Free",
          "status": "correct",
          "reason": null,
          "nature": "snapshot"
        },
        "price": {
          "value": 19.99,
          "status": "correct",
          "reason": null,
          "nature": "snapshot"
        },
        "bsr": {
          "value": 9,
          "status": "correct",
          "reason": null,
          "nature": "snapshot"
        },
        "rating": {
          "value": 4.7,
          "status": "correct",
          "reason": null,
          "nature": "snapshot"
        },
        "reviewCount": {
          "value": 48116,
          "status": "correct",
          "reason": null,
          "nature": "snapshot"
        }
      },
      "failureReasons": [],
      "confirmedBy": {
        "mode": "owner",
        "actorRef": "owner:v1"
      },
      "confirmedAt": "2026-08-16T19:26:11.484Z"
    }
  ],
  "updatedAt": "2026-08-16T19:26:11.486Z"
};

export const DEMO_REVIEW_EVIDENCE_SAMPLE: ReviewEvidenceV1 = {
  "schema": "review-evidence.v1",
  "version": 1,
  "candidateId": "fixture-vr-cand-001",
  "dataset": {
    "reviews": [
      {
        "evidenceId": "7326aa26-b63d-4c33-a4df-aa7eafdf9714",
        "reviewId": null,
        "productAsin": "B0F2BF31PW",
        "sourceProductRole": "competitor",
        "sourceType": "browser",
        "sourceSite": "amazon",
        "sourceUrl": "https://www.amazon.com/dp/B0F2BF31PW",
        "sourceRef": "https://www.amazon.com/dp/B0F2BF31PW",
        "reviewTitle": null,
        "reviewText": "<img src=\"https://m.media-amazon.com/images/S/amazon-avatars-global/default._SX48_.png\"/> Great bottle Color: ConstructionSize: 12 Ounces",
        "rating": 5,
        "reviewDate": "July 5, 2026",
        "verifiedPurchase": null,
        "locale": null,
        "language": null,
        "capturedAt": "2026-08-16T19:26:42.530Z",
        "importerVersion": "review-importer.v1",
        "collectorVersion": "amazon-review-snippet-collector.v1",
        "entityBindingProof": {
          "asin": "B0F2BF31PW",
          "sourceProductRole": "competitor",
          "binding": "browser_verified",
          "note": "详情页公开 Top Reviews 片段（评论全文页需登录，未绕过；正文不可见为已知限制）"
        },
        "contentHash": "3d02156b194644bd9c98ea84b8a3957c90e055134d9122249ee81385ae76e0c8",
        "duplicateKey": "key:B0F2BF31PW|3d02156b194644bd9c98ea84b8a3957c90e055134d9122249ee81385ae76e0c8|5|July 5, 2026",
        "nature": "review_observation"
      },
      {
        "evidenceId": "ca4aa1aa-12c6-4061-b19c-1c66d28879c1",
        "reviewId": null,
        "productAsin": "B0F2BF31PW",
        "sourceProductRole": "competitor",
        "sourceType": "browser",
        "sourceSite": "amazon",
        "sourceUrl": "https://www.amazon.com/dp/B0F2BF31PW",
        "sourceRef": "https://www.amazon.com/dp/B0F2BF31PW",
        "reviewTitle": null,
        "reviewText": "<img src=\"https://m.media-amazon.com/images/S/amazon-avatars-global/default._SX48_.png\"/> Great, sturdy, easy to clean toddler cup Color: Butterfly FrenzySize: 12 Ounces",
        "rating": 5,
        "reviewDate": "August 4, 2025",
        "verifiedPurchase": null,
        "locale": null,
        "language": null,
        "capturedAt": "2026-08-16T19:26:42.530Z",
        "importerVersion": "review-importer.v1",
        "collectorVersion": "amazon-review-snippet-collector.v1",
        "entityBindingProof": {
          "asin": "B0F2BF31PW",
          "sourceProductRole": "competitor",
          "binding": "browser_verified",
          "note": "详情页公开 Top Reviews 片段（评论全文页需登录，未绕过；正文不可见为已知限制）"
        },
        "contentHash": "cc9619a12934802c3862081ad9c278d35c58e8f846b4a2ce8175aef96a2563ca",
        "duplicateKey": "key:B0F2BF31PW|cc9619a12934802c3862081ad9c278d35c58e8f846b4a2ce8175aef96a2563ca|5|August 4, 2025",
        "nature": "review_observation"
      },
      {
        "evidenceId": "3b87c328-6329-4098-8a9b-db2806637ebe",
        "reviewId": null,
        "productAsin": "B0F2BF31PW",
        "sourceProductRole": "competitor",
        "sourceType": "browser",
        "sourceSite": "amazon",
        "sourceUrl": "https://www.amazon.com/dp/B0F2BF31PW",
        "sourceRef": "https://www.amazon.com/dp/B0F2BF31PW",
        "reviewTitle": null,
        "reviewText": "<img src=\"https://m.media-amazon.com/images/S/amazon-avatars-global/default._SX48_.png\"/> Leakproof and easy to clean! Color: ConstructionSize: 12 Ounces",
        "rating": 5,
        "reviewDate": "February 12, 2026",
        "verifiedPurchase": null,
        "locale": null,
        "language": null,
        "capturedAt": "2026-08-16T19:26:42.530Z",
        "importerVersion": "review-importer.v1",
        "collectorVersion": "amazon-review-snippet-collector.v1",
        "entityBindingProof": {
          "asin": "B0F2BF31PW",
          "sourceProductRole": "competitor",
          "binding": "browser_verified",
          "note": "详情页公开 Top Reviews 片段（评论全文页需登录，未绕过；正文不可见为已知限制）"
        },
        "contentHash": "4b1a2558cecb20b1b4c44d84d933a4fee4ded947dcaa2f2def3dbb6fb720f7a8",
        "duplicateKey": "key:B0F2BF31PW|4b1a2558cecb20b1b4c44d84d933a4fee4ded947dcaa2f2def3dbb6fb720f7a8|5|February 12, 2026",
        "nature": "review_observation"
      },
      {
        "evidenceId": "dfc7180c-62f5-461e-9d74-6a619847a494",
        "reviewId": null,
        "productAsin": "B0F2BF31PW",
        "sourceProductRole": "competitor",
        "sourceType": "browser",
        "sourceSite": "amazon",
        "sourceUrl": "https://www.amazon.com/dp/B0F2BF31PW",
        "sourceRef": "https://www.amazon.com/dp/B0F2BF31PW",
        "reviewTitle": null,
        "reviewText": "<img src=\"https://m.media-amazon.com/images/S/amazon-avatars-global/default._SX48_.png\"/> My son is obsessed Color: ConstructionSize: 12 Ounces",
        "rating": 5,
        "reviewDate": "July 18, 2026",
        "verifiedPurchase": null,
        "locale": null,
        "language": null,
        "capturedAt": "2026-08-16T19:26:42.530Z",
        "importerVersion": "review-importer.v1",
        "collectorVersion": "amazon-review-snippet-collector.v1",
        "entityBindingProof": {
          "asin": "B0F2BF31PW",
          "sourceProductRole": "competitor",
          "binding": "browser_verified",
          "note": "详情页公开 Top Reviews 片段（评论全文页需登录，未绕过；正文不可见为已知限制）"
        },
        "contentHash": "f9a2c4d0c1864742c32201b8c8efc5695dd180a33220817b1413be3cdd9789eb",
        "duplicateKey": "key:B0F2BF31PW|f9a2c4d0c1864742c32201b8c8efc5695dd180a33220817b1413be3cdd9789eb|5|July 18, 2026",
        "nature": "review_observation"
      },
      {
        "evidenceId": "80ffb4f0-1be1-46c6-a2ad-a44214a7560f",
        "reviewId": null,
        "productAsin": "B0F2BF31PW",
        "sourceProductRole": "competitor",
        "sourceType": "browser",
        "sourceSite": "amazon",
        "sourceUrl": "https://www.amazon.com/dp/B0F2BF31PW",
        "sourceRef": "https://www.amazon.com/dp/B0F2BF31PW",
        "reviewTitle": null,
        "reviewText": "<img src=\"https://m.media-amazon.com/images/S/amazon-avatars-global/default._SX48_.png\"/> Awesome drink bottle Color: PinkSize: 12 Ounces",
        "rating": 5,
        "reviewDate": "July 18, 2026",
        "verifiedPurchase": null,
        "locale": null,
        "language": null,
        "capturedAt": "2026-08-16T19:26:42.530Z",
        "importerVersion": "review-importer.v1",
        "collectorVersion": "amazon-review-snippet-collector.v1",
        "entityBindingProof": {
          "asin": "B0F2BF31PW",
          "sourceProductRole": "competitor",
          "binding": "browser_verified",
          "note": "详情页公开 Top Reviews 片段（评论全文页需登录，未绕过；正文不可见为已知限制）"
        },
        "contentHash": "03c067e500a776d8161df0e6b4c8a8ff444c8e119ba64c3b22de65ca61add632",
        "duplicateKey": "key:B0F2BF31PW|03c067e500a776d8161df0e6b4c8a8ff444c8e119ba64c3b22de65ca61add632|5|July 18, 2026",
        "nature": "review_observation"
      },
      {
        "evidenceId": "b8fb61a3-6812-4c3f-94c0-e467e8bdf2b8",
        "reviewId": null,
        "productAsin": "B0F2BF31PW",
        "sourceProductRole": "competitor",
        "sourceType": "browser",
        "sourceSite": "amazon",
        "sourceUrl": "https://www.amazon.com/dp/B0F2BF31PW",
        "sourceRef": "https://www.amazon.com/dp/B0F2BF31PW",
        "reviewTitle": null,
        "reviewText": "<img src=\"https://m.media-amazon.com/images/S/amazon-avatars-global/default._SX48_.png\"/> Water spills Color: NavySize: 12 Ounces",
        "rating": 4,
        "reviewDate": "March 21, 2025",
        "verifiedPurchase": null,
        "locale": null,
        "language": null,
        "capturedAt": "2026-08-16T19:26:42.530Z",
        "importerVersion": "review-importer.v1",
        "collectorVersion": "amazon-review-snippet-collector.v1",
        "entityBindingProof": {
          "asin": "B0F2BF31PW",
          "sourceProductRole": "competitor",
          "binding": "browser_verified",
          "note": "详情页公开 Top Reviews 片段（评论全文页需登录，未绕过；正文不可见为已知限制）"
        },
        "contentHash": "ccccea65d1c894ff1b1891daae2e3d5e365239b3a28909d99c2abe2a98e7949a",
        "duplicateKey": "key:B0F2BF31PW|ccccea65d1c894ff1b1891daae2e3d5e365239b3a28909d99c2abe2a98e7949a|4|March 21, 2025",
        "nature": "review_observation"
      },
      {
        "evidenceId": "0feb41dd-a607-4a05-bf1e-70a14d0db1ea",
        "reviewId": null,
        "productAsin": "B0F2BF31PW",
        "sourceProductRole": "competitor",
        "sourceType": "browser",
        "sourceSite": "amazon",
        "sourceUrl": "https://www.amazon.com/dp/B0F2BF31PW",
        "sourceRef": "https://www.amazon.com/dp/B0F2BF31PW",
        "reviewTitle": null,
        "reviewText": "<img src=\"https://m.media-amazon.com/images/S/amazon-avatars-global/f7533b8b-c6e9-4aa2-90a5-e3876b28dd5c._CR0%2C26%2C281%2C281_UX460_SX48_.jpg\"/> Made to last and easy to Clean Color: NavySize: 12 Ounces",
        "rating": 5,
        "reviewDate": "May 14, 2026",
        "verifiedPurchase": null,
        "locale": null,
        "language": null,
        "capturedAt": "2026-08-16T19:26:42.530Z",
        "importerVersion": "review-importer.v1",
        "collectorVersion": "amazon-review-snippet-collector.v1",
        "entityBindingProof": {
          "asin": "B0F2BF31PW",
          "sourceProductRole": "competitor",
          "binding": "browser_verified",
          "note": "详情页公开 Top Reviews 片段（评论全文页需登录，未绕过；正文不可见为已知限制）"
        },
        "contentHash": "d7087661b47f998995e95cb0119e2fd22571f3b206636448dcf143664b812b04",
        "duplicateKey": "key:B0F2BF31PW|d7087661b47f998995e95cb0119e2fd22571f3b206636448dcf143664b812b04|5|May 14, 2026",
        "nature": "review_observation"
      },
      {
        "evidenceId": "944c3cba-5242-492f-8682-094c8d339bc4",
        "reviewId": null,
        "productAsin": "B0F2BF31PW",
        "sourceProductRole": "competitor",
        "sourceType": "browser",
        "sourceSite": "amazon",
        "sourceUrl": "https://www.amazon.com/dp/B0F2BF31PW",
        "sourceRef": "https://www.amazon.com/dp/B0F2BF31PW",
        "reviewTitle": null,
        "reviewText": "<img src=\"https://m.media-amazon.com/images/S/amazon-avatars-global/default._SX48_.png\"/> Perfect for toddlers Color: Mint OmbreSize: 12 Ounces",
        "rating": 5,
        "reviewDate": "July 5, 2026",
        "verifiedPurchase": null,
        "locale": null,
        "language": null,
        "capturedAt": "2026-08-16T19:26:42.530Z",
        "importerVersion": "review-importer.v1",
        "collectorVersion": "amazon-review-snippet-collector.v1",
        "entityBindingProof": {
          "asin": "B0F2BF31PW",
          "sourceProductRole": "competitor",
          "binding": "browser_verified",
          "note": "详情页公开 Top Reviews 片段（评论全文页需登录，未绕过；正文不可见为已知限制）"
        },
        "contentHash": "5d8f0c6b01e376b1afc08e9325e8346f59c1e58e157c7843f6d9dc8f7dcdebd5",
        "duplicateKey": "key:B0F2BF31PW|5d8f0c6b01e376b1afc08e9325e8346f59c1e58e157c7843f6d9dc8f7dcdebd5|5|July 5, 2026",
        "nature": "review_observation"
      },
      {
        "evidenceId": "cd82be39-f3d4-46f6-896e-02adb716afa1",
        "reviewId": null,
        "productAsin": "B0F2BF31PW",
        "sourceProductRole": "competitor",
        "sourceType": "browser",
        "sourceSite": "amazon",
        "sourceUrl": "https://www.amazon.com/dp/B0F2BF31PW",
        "sourceRef": "https://www.amazon.com/dp/B0F2BF31PW",
        "reviewTitle": null,
        "reviewText": "<img src=\"https://m.media-amazon.com/images/S/amazon-avatars-global/default._SX48_.png\"/> Muy buen termo para niños a partir de 1.5 años Color: DinosaursSize: 12 Ounces",
        "rating": 5,
        "reviewDate": "October 2, 2023",
        "verifiedPurchase": null,
        "locale": null,
        "language": null,
        "capturedAt": "2026-08-16T19:26:42.530Z",
        "importerVersion": "review-importer.v1",
        "collectorVersion": "amazon-review-snippet-collector.v1",
        "entityBindingProof": {
          "asin": "B0F2BF31PW",
          "sourceProductRole": "competitor",
          "binding": "browser_verified",
          "note": "详情页公开 Top Reviews 片段（评论全文页需登录，未绕过；正文不可见为已知限制）"
        },
        "contentHash": "b1f1a0842ee4f28a7e4b674641f21d347032c4947351ae45ab5879b938f14da8",
        "duplicateKey": "key:B0F2BF31PW|b1f1a0842ee4f28a7e4b674641f21d347032c4947351ae45ab5879b938f14da8|5|October 2, 2023",
        "nature": "review_observation"
      },
      {
        "evidenceId": "055a6c64-8351-4208-82ae-36ea19c6f948",
        "reviewId": null,
        "productAsin": "B0F2BF31PW",
        "sourceProductRole": "competitor",
        "sourceType": "browser",
        "sourceSite": "amazon",
        "sourceUrl": "https://www.amazon.com/dp/B0F2BF31PW",
        "sourceRef": "https://www.amazon.com/dp/B0F2BF31PW",
        "reviewTitle": null,
        "reviewText": "<img src=\"https://m.media-amazon.com/images/S/amazon-avatars-global/default._SX48_.png\"/> Great Thermos Color: TealSize: 12 Ounces",
        "rating": 5,
        "reviewDate": "April 25, 2023",
        "verifiedPurchase": null,
        "locale": null,
        "language": null,
        "capturedAt": "2026-08-16T19:26:42.530Z",
        "importerVersion": "review-importer.v1",
        "collectorVersion": "amazon-review-snippet-collector.v1",
        "entityBindingProof": {
          "asin": "B0F2BF31PW",
          "sourceProductRole": "competitor",
          "binding": "browser_verified",
          "note": "详情页公开 Top Reviews 片段（评论全文页需登录，未绕过；正文不可见为已知限制）"
        },
        "contentHash": "42be9f3cbd1b87e9a2b7400f0256027a94fe3ab1e693e2b7e5263b6814979d26",
        "duplicateKey": "key:B0F2BF31PW|42be9f3cbd1b87e9a2b7400f0256027a94fe3ab1e693e2b7e5263b6814979d26|5|April 25, 2023",
        "nature": "review_observation"
      },
      {
        "evidenceId": "1eacc071-47ef-4128-ab93-1d219eb4888f",
        "reviewId": null,
        "productAsin": "B0F2BF31PW",
        "sourceProductRole": "competitor",
        "sourceType": "browser",
        "sourceSite": "amazon",
        "sourceUrl": "https://www.amazon.com/dp/B0F2BF31PW",
        "sourceRef": "https://www.amazon.com/dp/B0F2BF31PW",
        "reviewTitle": null,
        "reviewText": "<img src=\"https://m.media-amazon.com/images/S/amazon-avatars-global/default._SX48_.png\"/> Great Color: TealSize: 12 Ounces",
        "rating": 5,
        "reviewDate": "June 14, 2026",
        "verifiedPurchase": null,
        "locale": null,
        "language": null,
        "capturedAt": "2026-08-16T19:26:42.530Z",
        "importerVersion": "review-importer.v1",
        "collectorVersion": "amazon-review-snippet-collector.v1",
        "entityBindingProof": {
          "asin": "B0F2BF31PW",
          "sourceProductRole": "competitor",
          "binding": "browser_verified",
          "note": "详情页公开 Top Reviews 片段（评论全文页需登录，未绕过；正文不可见为已知限制）"
        },
        "contentHash": "17e7316bbac5d685e93b76efa67180baa1803a5f8fb3425b795d2288dbdd2ff3",
        "duplicateKey": "key:B0F2BF31PW|17e7316bbac5d685e93b76efa67180baa1803a5f8fb3425b795d2288dbdd2ff3|5|June 14, 2026",
        "nature": "review_observation"
      },
      {
        "evidenceId": "90f1796e-581e-4578-a7b2-828d0667b523",
        "reviewId": null,
        "productAsin": "B0F2BF31PW",
        "sourceProductRole": "competitor",
        "sourceType": "browser",
        "sourceSite": "amazon",
        "sourceUrl": "https://www.amazon.com/dp/B0F2BF31PW",
        "sourceRef": "https://www.amazon.com/dp/B0F2BF31PW",
        "reviewTitle": null,
        "reviewText": "<img src=\"https://m.media-amazon.com/images/S/amazon-avatars-global/default._SX48_.png\"/> Garrafa excelente Color: PinkSize: 12 Ounces",
        "rating": 5,
        "reviewDate": "July 4, 2026",
        "verifiedPurchase": null,
        "locale": null,
        "language": null,
        "capturedAt": "2026-08-16T19:26:42.530Z",
        "importerVersion": "review-importer.v1",
        "collectorVersion": "amazon-review-snippet-collector.v1",
        "entityBindingProof": {
          "asin": "B0F2BF31PW",
          "sourceProductRole": "competitor",
          "binding": "browser_verified",
          "note": "详情页公开 Top Reviews 片段（评论全文页需登录，未绕过；正文不可见为已知限制）"
        },
        "contentHash": "f0f8f16e60b298709ea82608616586efb69db3636ffe12e5df78e98ae00633cb",
        "duplicateKey": "key:B0F2BF31PW|f0f8f16e60b298709ea82608616586efb69db3636ffe12e5df78e98ae00633cb|5|July 4, 2026",
        "nature": "review_observation"
      },
      {
        "evidenceId": "29c4f698-4547-4137-973f-c5526bfafb9a",
        "reviewId": null,
        "productAsin": "B0F2BF31PW",
        "sourceProductRole": "competitor",
        "sourceType": "browser",
        "sourceSite": "amazon",
        "sourceUrl": "https://www.amazon.com/dp/B0F2BF31PW",
        "sourceRef": "https://www.amazon.com/dp/B0F2BF31PW",
        "reviewTitle": null,
        "reviewText": "<img src=\"https://m.media-amazon.com/images/S/amazon-avatars-global/default._SX48_.png\"/> buen producto Color: PinkSize: 12 Ounces",
        "rating": 5,
        "reviewDate": "June 17, 2026",
        "verifiedPurchase": null,
        "locale": null,
        "language": null,
        "capturedAt": "2026-08-16T19:26:42.530Z",
        "importerVersion": "review-importer.v1",
        "collectorVersion": "amazon-review-snippet-collector.v1",
        "entityBindingProof": {
          "asin": "B0F2BF31PW",
          "sourceProductRole": "competitor",
          "binding": "browser_verified",
          "note": "详情页公开 Top Reviews 片段（评论全文页需登录，未绕过；正文不可见为已知限制）"
        },
        "contentHash": "6cf961466cce8154e02e972c4e35284fab727cde75e94a9a3c571c1810910d28",
        "duplicateKey": "key:B0F2BF31PW|6cf961466cce8154e02e972c4e35284fab727cde75e94a9a3c571c1810910d28|5|June 17, 2026",
        "nature": "review_observation"
      }
    ],
    "stats": {
      "totalReviews": 13,
      "reviewsUsed": 13,
      "positiveCount": 13,
      "negativeCount": 0,
      "neutralCount": 0,
      "ratingDistribution": [
        {
          "rating": 1,
          "count": 0
        },
        {
          "rating": 2,
          "count": 0
        },
        {
          "rating": 3,
          "count": 0
        },
        {
          "rating": 4,
          "count": 1
        },
        {
          "rating": 5,
          "count": 12
        }
      ],
      "capturePeriod": {
        "from": "April 25, 2023",
        "to": "October 2, 2023"
      },
      "sourceProductCount": 1,
      "currentCandidateCount": 0,
      "competitorCount": 13
    },
    "sampling": {
      "method": "manual_selected",
      "note": null,
      "reviewsAvailable": null
    },
    "updatedAt": "2026-08-16T19:26:42.532Z"
  }
};

export const DEMO_VOC_ANALYSIS_SAMPLE: VocAnalysisV1 = {
  "schema": "voc-analysis.v1",
  "version": 1,
  "runId": "cb883429-9785-421e-b8f5-bca989fdc983",
  "candidateId": "fixture-vr-cand-001",
  "model": "deepseek-v4-flash",
  "promptVersion": "voc-analysis.v1",
  "inputEvidenceHash": "f4bbfca88e1d3814b341da13bb0636274ff3298add7f1b18a13d6511e0da7f0c",
  "datasetSnapshot": {
    "totalReviews": 13,
    "reviewsUsed": 13,
    "sampledReviews": [
      "7326aa26-b63d-4c33-a4df-aa7eafdf9714",
      "ca4aa1aa-12c6-4061-b19c-1c66d28879c1",
      "3b87c328-6329-4098-8a9b-db2806637ebe",
      "dfc7180c-62f5-461e-9d74-6a619847a494",
      "80ffb4f0-1be1-46c6-a2ad-a44214a7560f",
      "b8fb61a3-6812-4c3f-94c0-e467e8bdf2b8",
      "0feb41dd-a607-4a05-bf1e-70a14d0db1ea",
      "944c3cba-5242-492f-8682-094c8d339bc4",
      "cd82be39-f3d4-46f6-896e-02adb716afa1",
      "055a6c64-8351-4208-82ae-36ea19c6f948",
      "1eacc071-47ef-4128-ab93-1d219eb4888f",
      "90f1796e-581e-4578-a7b2-828d0667b523",
      "29c4f698-4547-4137-973f-c5526bfafb9a"
    ]
  },
  "startedAt": "2026-08-16T19:26:54.414Z",
  "finishedAt": "2026-08-16T19:27:05.311Z",
  "tokenUsage": {
    "completionTokens": 1378,
    "reasoningTokens": null
  },
  "gateResult": "pass",
  "themes": {
    "positiveThemes": [
      {
        "themeId": "d9613359bb0a0d68",
        "label": "Easy to clean",
        "summary": "Multiple reviews highlight that the bottle is easy to clean, which is a key convenience for parents.",
        "evidenceRefs": [
          "ca4aa1aa-12c6-4061-b19c-1c66d28879c1",
          "3b87c328-6329-4098-8a9b-db2806637ebe",
          "0feb41dd-a607-4a05-bf1e-70a14d0db1ea"
        ],
        "sourceProductRoles": [
          "competitor"
        ],
        "reviewCount": 3,
        "coverage": 0.23076923076923078,
        "strength": "weak",
        "limitations": "No specific cleaning method mentioned."
      },
      {
        "themeId": "74b4f80926b27d3c",
        "label": "Sturdy and durable",
        "summary": "Reviews describe the bottle as sturdy and made to last, suggesting good build quality.",
        "evidenceRefs": [
          "ca4aa1aa-12c6-4061-b19c-1c66d28879c1",
          "0feb41dd-a607-4a05-bf1e-70a14d0db1ea"
        ],
        "sourceProductRoles": [
          "competitor"
        ],
        "reviewCount": 2,
        "coverage": 0.15384615384615385,
        "strength": "weak",
        "limitations": "Only two reviews mention durability."
      },
      {
        "themeId": "33ab211aa13af9e8",
        "label": "Leakproof",
        "summary": "One review explicitly states the bottle is leakproof, a critical feature for toddler cups.",
        "evidenceRefs": [
          "3b87c328-6329-4098-8a9b-db2806637ebe"
        ],
        "sourceProductRoles": [
          "competitor"
        ],
        "reviewCount": 1,
        "coverage": 0.07692307692307693,
        "strength": "isolated",
        "limitations": "Only one review mentions leakproof; another reports spills."
      },
      {
        "themeId": "25a874df5b23c8cd",
        "label": "Great for toddlers",
        "summary": "Reviews indicate the bottle is well-suited for toddlers, with one mentioning it's perfect for toddlers and another for children from 1.5 years.",
        "evidenceRefs": [
          "944c3cba-5242-492f-8682-094c8d339bc4",
          "cd82be39-f3d4-46f6-896e-02adb716afa1"
        ],
        "sourceProductRoles": [
          "competitor"
        ],
        "reviewCount": 2,
        "coverage": 0.15384615384615385,
        "strength": "weak",
        "limitations": "Age range not specified in all reviews."
      },
      {
        "themeId": "5f399000c1ac4c74",
        "label": "Child loves it",
        "summary": "A review mentions the child is obsessed with the bottle, indicating strong appeal.",
        "evidenceRefs": [
          "dfc7180c-62f5-461e-9d74-6a619847a494"
        ],
        "sourceProductRoles": [
          "competitor"
        ],
        "reviewCount": 1,
        "coverage": 0.07692307692307693,
        "strength": "isolated",
        "limitations": "Single review."
      },
      {
        "themeId": "3de708e02ec559f0",
        "label": "Overall great product",
        "summary": "Several reviews simply state 'Great' or 'Awesome', indicating overall satisfaction.",
        "evidenceRefs": [
          "7326aa26-b63d-4c33-a4df-aa7eafdf9714",
          "80ffb4f0-1be1-46c6-a2ad-a44214a7560f",
          "1eacc071-47ef-4128-ab93-1d219eb4888f"
        ],
        "sourceProductRoles": [
          "competitor"
        ],
        "reviewCount": 3,
        "coverage": 0.23076923076923078,
        "strength": "weak",
        "limitations": "Lack specific details."
      }
    ],
    "painPointThemes": [
      {
        "themeId": "9c893bf65d12bb6f",
        "label": "Water spills",
        "summary": "One review reports that water spills, contradicting the leakproof claim.",
        "evidenceRefs": [
          "b8fb61a3-6812-4c3f-94c0-e467e8bdf2b8"
        ],
        "sourceProductRoles": [
          "competitor"
        ],
        "reviewCount": 1,
        "coverage": 0.07692307692307693,
        "strength": "isolated",
        "limitations": "Only one review; no details on circumstances."
      }
    ],
    "usageScenarios": [
      {
        "themeId": "14b13b8cbb07dea3",
        "label": "Toddler drinking cup",
        "summary": "Reviews indicate the bottle is used as a drinking cup for toddlers, with mentions of toddler use and age suitability.",
        "evidenceRefs": [
          "ca4aa1aa-12c6-4061-b19c-1c66d28879c1",
          "944c3cba-5242-492f-8682-094c8d339bc4",
          "cd82be39-f3d4-46f6-896e-02adb716afa1"
        ],
        "sourceProductRoles": [
          "competitor"
        ],
        "reviewCount": 3,
        "coverage": 0.23076923076923078,
        "strength": "weak",
        "limitations": "No specific context like home or travel."
      }
    ],
    "recurringRequests": [],
    "conflicts": [
      {
        "themeId": "5b82cf784e7804b8",
        "label": "Leakproof vs. spills",
        "summary": "One review claims the bottle is leakproof, while another reports water spills.",
        "positive": {
          "evidenceRefs": [
            "3b87c328-6329-4098-8a9b-db2806637ebe"
          ],
          "reviewCount": 1
        },
        "negative": {
          "evidenceRefs": [
            "b8fb61a3-6812-4c3f-94c0-e467e8bdf2b8"
          ],
          "reviewCount": 1
        },
        "note": "Conflicting reports on leak resistance; may depend on usage or specific unit."
      }
    ],
    "weakSignals": [
      {
        "themeId": "3ef9631f2168957a",
        "label": "Child obsession",
        "summary": "A single review mentions the child is obsessed with the bottle, suggesting strong emotional attachment.",
        "evidenceRefs": [
          "dfc7180c-62f5-461e-9d74-6a619847a494"
        ],
        "sourceProductRoles": [
          "competitor"
        ],
        "reviewCount": 1,
        "coverage": 0.07692307692307693,
        "strength": "isolated",
        "limitations": "Only one review; not generalizable."
      }
    ]
  },
  "unknowns": [
    "No negative reviews in the sample, so potential issues beyond spills are unknown.",
    "No information on the bottle's insulation performance despite being called a thermos.",
    "No details on the bottle's capacity, materials, or safety features.",
    "No information on the age range beyond one mention of 1.5 years.",
    "No data on long-term durability beyond a few mentions of 'made to last'.",
    "No information on the bottle's design or ease of use for toddlers (e.g., handles, straw)."
  ],
  "nextResearchSteps": [
    "Investigate the reported spill issue to understand if it's a design flaw or user error.",
    "Gather more reviews to assess the frequency of leak complaints.",
    "Look for reviews mentioning insulation performance to validate the 'thermos' claim.",
    "Search for reviews from parents of different age groups to understand age suitability.",
    "Analyze competitor products to compare features like leakproof design and ease of cleaning."
  ],
  "unverified": [],
  "humanReviewResult": null,
  "updatedAt": "2026-08-16T19:27:05.311Z"
};

export const DEMO_SOURCING_EVIDENCE_SAMPLE: SourcingEvidenceV1 = {
  "schema": "sourcing-evidence.v1",
  "taskId": "fixture-vr-thermos-001",
  "capturedAt": "2026-08-17T05:24:38.681Z",
  "acquisition": {
    "method": "image",
    "query": "https://m.media-amazon.com/images/I/717sCJ7vxQL._AC_SL1500_.jpg",
    "runTrace": {
      "source": "1688",
      "method": "image",
      "query": "https://m.media-amazon.com/images/I/717sCJ7vxQL._AC_SL1500_.jpg",
      "timestamp": "2026-08-17T05:22:56.865Z",
      "driverVersion": "native-1688-extension-driver.v1",
      "resolverVersion": "native-1688-upload-resolver.v2|native-1688-image-submit-resolver.v2|native-1688-result-extractor.v2",
      "success": true,
      "failClosedReason": null
    }
  },
  "candidates": [
    {
      "schema": "acquisition-candidate.v1",
      "source": "1688",
      "offerId": "734479850549",
      "sourceUrl": "https://detail.1688.com/offer/734479850549.html",
      "capturedAt": "2026-08-17T05:21:57.248Z",
      "acquisitionMethod": "image",
      "sourceProductRole": "similar",
      "title": "亚马逊新款不锈钢儿童保温杯吸管杯 双层304隔热卡通保温杯儿童 永康保温杯 ｜ 功能:便携 ｜ 外壳材质:304不锈钢 ｜ 样式:大容量 ¥ 21 包邮价 5.6万+件 200件起批 包邮 先采后付 回头率7% 入驻9年 武义县钎德五金有限公司",
      "images": [
        "https://cbu01.alicdn.com/img/ibank/O1CN017Mo1Io1DWBBwdN8mq_!!3606660223-0-cib.jpg_460x460q100.jpg_.webp"
      ],
      "displayedPrice": {
        "text": "￥20.00-￥29.00",
        "nature": "displayed_price"
      },
      "priceRange": {
        "min": 20,
        "max": 29,
        "text": "￥20.00-￥29.00"
      },
      "priceTiers": [
        {
          "minQty": 200,
          "price": 20,
          "text": "200 件起 ¥20"
        },
        {
          "minQty": 200,
          "price": 29,
          "text": "200 件起 ¥29"
        }
      ],
      "displayedMoq": {
        "text": "200 个",
        "value": 200,
        "nature": "displayed_moq"
      },
      "skuSpecs": [
        {
          "skuId": "5482084750626",
          "specs": "无印刷&gt;16oz弹跳儿童壶-钢本色",
          "price": 23,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750627",
          "specs": "满版印刷&gt;16oz弹跳儿童壶-钢本色",
          "price": 26,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750622",
          "specs": "无印刷&gt;12oz专利儿童壶-钢本色",
          "price": 24,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750633",
          "specs": "满版印刷&gt;480ml饭盒-钢本色",
          "price": 28.5,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5729753931686",
          "specs": "双饮盖儿童保温杯&gt;18oz儿童壶-钢本色",
          "price": 22,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5729753931687",
          "specs": "双饮盖儿童保温杯&gt;12oz儿童壶-钢本色",
          "price": 21,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5949349710186",
          "specs": "弹跳吸嘴盖儿童保温杯&gt;12oz儿童壶-钢本色",
          "price": 23,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750623",
          "specs": "满版印刷&gt;12oz专利儿童壶-钢本色",
          "price": 27,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750630",
          "specs": "无印刷&gt;350ml饭盒-钢本色",
          "price": 24.5,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5803633442691",
          "specs": "儿童把手杯（专利新品）&gt;12oz儿童壶-钢本色",
          "price": 25,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750625",
          "specs": "满版印刷&gt;18oz专利儿童壶-钢本色",
          "price": 28,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750637",
          "specs": "满版印刷&gt;500ml学饮杯-钢本色",
          "price": 29,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750617",
          "specs": "满版印刷&gt;12oz儿童壶-钢本色",
          "price": 25,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750615",
          "specs": "满版印刷&gt;18oz儿童壶-钢本色",
          "price": 26,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5947996500493",
          "specs": "提手弹跳盖儿童保温杯（耐摔塑底）&gt;12oz儿童壶-钢本色",
          "price": 23,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750629",
          "specs": "满版印刷&gt;280ml饭盒-钢本色",
          "price": 26.5,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750624",
          "specs": "无印刷&gt;18oz专利儿童壶-钢本色",
          "price": 24.5,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5949349710183",
          "specs": "弹跳吸嘴盖儿童保温杯&gt;18oz儿童壶-钢本色",
          "price": 24,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5803633442690",
          "specs": "儿童把手杯（专利新品）&gt;18oz儿童壶-钢本色",
          "price": 27.7,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750619",
          "specs": "满版印刷&gt;12oz新款儿童壶-钢本色",
          "price": 25,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5949349710181",
          "specs": "双饮弹跳盖儿童保温杯（带锁扣）&gt;18oz儿童壶-钢本色",
          "price": 25,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5949349710184",
          "specs": "双饮弹跳盖儿童保温杯（带锁扣）&gt;12oz儿童壶-钢本色",
          "price": 24,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750635",
          "specs": "满版印刷&gt;350ml学饮杯-钢本色",
          "price": 28,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750634",
          "specs": "无印刷&gt;350ml学饮杯-钢本色",
          "price": 25,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750631",
          "specs": "满版印刷&gt;350ml饭盒-钢本色",
          "price": 27.5,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750618",
          "specs": "无印刷&gt;12oz新款儿童壶-钢本色",
          "price": 22,
          "multiPrice": null,
          "stock": 100010
        },
        {
          "skuId": "5482084750620",
          "specs": "无印刷&gt;18oz新款儿童壶-钢本色",
          "price": 23,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "6103866115880",
          "specs": "儿童弹跳盖手柄杯（适配5款杯盖）&gt;12oz儿童壶-钢本色",
          "price": 25.2,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750632",
          "specs": "无印刷&gt;480ml饭盒-钢本色",
          "price": 25.5,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750616",
          "specs": "无印刷&gt;12oz儿童壶-钢本色",
          "price": 20,
          "multiPrice": null,
          "stock": 104742
        },
        {
          "skuId": "5947996500492",
          "specs": "提手弹跳盖儿童保温杯（耐摔塑底）&gt;18oz儿童壶-钢本色",
          "price": 24,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750628",
          "specs": "无印刷&gt;280ml饭盒-钢本色",
          "price": 23.5,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750636",
          "specs": "无印刷&gt;500ml学饮杯-钢本色",
          "price": 26,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750614",
          "specs": "无印刷&gt;18oz儿童壶-钢本色",
          "price": 21,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "6103866115879",
          "specs": "儿童弹跳盖手柄杯（适配5款杯盖）&gt;18oz儿童壶-钢本色",
          "price": 26.4,
          "multiPrice": null,
          "stock": 100000
        },
        {
          "skuId": "5482084750621",
          "specs": "满版印刷&gt;18oz新款儿童壶-钢本色",
          "price": 26,
          "multiPrice": null,
          "stock": 100000
        }
      ],
      "sellerClaims": [
        {
          "name": "内胆材质",
          "value": "304不锈钢",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "品牌",
          "value": "亚马逊新款儿童不锈钢保温吸管杯 双层304隔热卡通便携儿童焖烧杯",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "功能",
          "value": "加厚,常规,家用,便携,真空,保温,可定制,防摔,智能控制",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "保温性能",
          "value": "12-24小时",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "外壳材质",
          "value": "304不锈钢",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "货号",
          "value": "亚马逊新款儿童不锈钢保温吸管杯 双层304隔热卡通便携",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "样式",
          "value": "大容量,汽车杯,大肚杯,带锁扣,直身杯",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "材质",
          "value": "内外304",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "风格",
          "value": "卡通",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "是否进口",
          "value": "否",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "是否有专利",
          "value": "否",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "是否跨境出口专供货源",
          "value": "是",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "版权",
          "value": "无",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "是否属于礼品",
          "value": "是，商务礼品",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "送礼用途",
          "value": "积分换购礼品,商务礼品,广告礼品,促销赠品,会议礼品,福利礼品,节庆礼品,嘉奖纪念,公关礼品",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "适用节日",
          "value": "情人节,春节,父亲节,母亲节,教师节,元旦,七夕,万圣节,复活节,国庆节,儿童节,妇女节,其他",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "适用送礼关系",
          "value": "晚辈,情侣,夫妻,同事,朋友,长辈,孩子,同学,恩师,其他",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "适用送礼场合",
          "value": "满月,旅游纪念,毕业,乔迁,派对聚会,探病慰问,其他",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "产品上市时间",
          "value": "2021年冬",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "产品质量等级",
          "value": "一等品",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "适用人群",
          "value": "女士,男士,儿童,情侣,通用,老年,学生",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "适用场景",
          "value": "运动,婚庆,商务,家居,车载,通用,圣诞节,春节,办公室,户外,旅行,送礼,学校,其他节日",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "是否有第三方检测报告",
          "value": "没有",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "定制工艺选择",
          "value": "激光雕刻,丝印,水转印,水贴膜,3D打印,5d打印,漆转印,内喷陶瓷,其他",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "包装规格",
          "value": "外贸新款保温水杯304不锈钢吸管杯 可爱儿童杯便携16oz大容量水壶",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "价格段",
          "value": "10-20元",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "加工定制",
          "value": "是",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "加印LOGO",
          "value": "可以",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "颜色",
          "value": "无印刷,满版印刷,双饮盖儿童保温杯,儿童把手杯（专利新品）,提手弹跳盖儿童保温杯（耐摔塑底）,弹跳吸嘴盖儿童保温杯,双饮弹跳盖儿童保温杯（带锁扣）,儿童弹跳盖手柄杯（适配5款杯盖）",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "容量",
          "value": "12oz儿童壶-钢本色,18oz儿童壶-钢本色,12oz新款儿童壶-钢本色,18oz新款儿童壶-钢本色,12oz专利儿童壶-钢本色,18oz专利儿童壶-钢本色,16oz弹跳儿童壶-钢本色,280ml饭盒-钢本色,350ml饭盒-钢本色,480ml饭盒-钢本色,350ml学饮杯-钢本色,500ml学饮杯-钢本色",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "代工品牌",
          "value": "stanley hydro flask stanley owala ContigoSwell",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "是否带茶隔",
          "value": "不带茶隔",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "杯子种类",
          "value": "保温杯",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "英文",
          "value": "water bottle kids water bottle with straw",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "贴牌代工厂",
          "value": "鸿凌工贸 哈尔斯 嘉益 戴安 泰硕 哈林 鹏飞 领奇飞剑 匡迪 新力 迎庆 浙成 浩大 新阳光 保康",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "包装种类",
          "value": "基础包装",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "是否显示温度",
          "value": "不支持温度显示",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "杯盖材质",
          "value": "塑料,硅胶,PP",
          "evidenceClass": "seller_claim"
        },
        {
          "name": "杯盖类型",
          "value": "弹盖",
          "evidenceClass": "seller_claim"
        }
      ],
      "platformMetadata": [
        {
          "name": "saledCount",
          "value": "226",
          "evidenceClass": "platform_metadata"
        },
        {
          "name": "categoryId",
          "value": "1043766",
          "evidenceClass": "platform_metadata"
        },
        {
          "name": "unitName",
          "value": "个",
          "evidenceClass": "platform_metadata"
        },
        {
          "name": "mixOrderQty",
          "value": "10000",
          "evidenceClass": "platform_metadata"
        },
        {
          "name": "options",
          "value": "颜色:无印刷,满版印刷,双饮盖儿童保温杯,儿童把手杯（专利新品）,提手弹跳盖儿童保温杯（耐摔塑底）,弹跳吸嘴盖儿童保温杯,双饮弹跳盖儿童保温杯（带锁扣）,儿童弹跳盖手柄杯（适配5款杯盖） | 容量:12oz儿童壶-钢本色,18oz儿童壶-钢本色,12oz新款儿童壶-钢本色,18oz新款儿童壶-钢本色,12oz专利儿童壶-钢本色,18oz专利儿童壶-钢本色,16oz弹跳儿童壶-钢本色,280ml饭盒",
          "evidenceClass": "platform_metadata"
        },
        {
          "name": "packageInfoCount",
          "value": "0",
          "evidenceClass": "platform_metadata"
        }
      ],
      "supplierDisplayName": "武义县钎德五金有限公司",
      "matchState": "unknown"
    }
  ],
  "humanConfirmed": [
    {
      "offerId": "734479850549",
      "confirmedAt": "2026-08-17T05:24:38.681Z",
      "note": null
    }
  ],
  "updatedAt": "2026-08-17T05:24:38.681Z"
};

export const DEMO_AI_EVIDENCE_SUMMARY_SAMPLE: AiEvidenceSummaryV1 = {
  "schema": "ai-evidence-summary.v1",
  "version": 1,
  "runId": "fa15ddc4-324d-4a9e-84e2-c5444fa65c19",
  "candidateId": null,
  "model": "deepseek-v4-flash",
  "promptVersion": "ai-evidence-summary.v1",
  "inputEvidenceHash": "edbec36cebec3da95bb4fceddc5e7a59d6fdcf293500f4b61ec3ea2f92401eb3",
  "startedAt": "2026-08-17T05:25:06.660Z",
  "finishedAt": "2026-08-17T05:25:17.442Z",
  "tokenUsage": {
    "completionTokens": 1417,
    "reasoningTokens": null
  },
  "gateResult": "pass",
  "evidenceRefCoverage": {
    "total": 18,
    "withRefs": 12
  },
  "summary": {
    "facts": [
      {
        "id": "fact-78d2b1bbca73",
        "type": "fact",
        "text": "ASIN B0F2BF31PW 是 THERMOS FUNTAINER 儿童不锈钢保温吸管杯，12oz，价格 19.99 美元，评分 4.7，评论数 48116，BSR 9。",
        "evidenceRefs": [
          "ev:browser:B0F2BF31PW:2026-08-16T19:25:55.749Z"
        ]
      },
      {
        "id": "fact-92b41974d2cd",
        "type": "fact",
        "text": "VOC 评论中多次提到产品易于清洁（3 条）、坚固耐用（2 条）、防漏（1 条）、适合幼儿（2 条）、孩子喜欢（1 条）。",
        "evidenceRefs": [
          "ev:voc:theme:d9613359bb0a0d68",
          "ev:voc:theme:74b4f80926b27d3c",
          "ev:voc:theme:33ab211aa13af9e8",
          "ev:voc:theme:25a874df5b23c8cd",
          "ev:voc:theme:5f399000c1ac4c74"
        ]
      },
      {
        "id": "fact-cdfe0d5cb22c",
        "type": "fact",
        "text": "VOC 评论中有一条提到漏水问题。",
        "evidenceRefs": [
          "ev:voc:theme:9c893bf65d12bb6f"
        ]
      },
      {
        "id": "fact-8faac39ca2fa",
        "type": "fact",
        "text": "1688 上找到类似产品：不锈钢儿童保温杯吸管杯，304 不锈钢，价格 20-29 元，MOQ 200 件，供应商为武义县钎德五金有限公司。",
        "evidenceRefs": [
          "ev:sourcing:734479850549"
        ]
      }
    ],
    "estimates": [
      {
        "id": "estimate-259096f47c89",
        "type": "estimate",
        "text": "基于 1688 供应价格（约 20-29 元人民币）与亚马逊售价（19.99 美元）对比，存在较大的利润空间，但需考虑物流、关税等成本。",
        "evidenceRefs": [
          "ev:sourcing:734479850549",
          "ev:browser:B0F2BF31PW:2026-08-16T19:25:55.749Z"
        ]
      },
      {
        "id": "estimate-53707f4a2950",
        "type": "estimate",
        "text": "评论数 48116 且 BSR 9 表明该产品在亚马逊上销量很高，市场需求旺盛。",
        "evidenceRefs": [
          "ev:browser:B0F2BF31PW:2026-08-16T19:25:55.749Z"
        ]
      }
    ],
    "signals": [
      {
        "id": "signal-4bffdf0bc175",
        "type": "signal",
        "text": "VOC 正面主题中“易于清洁”出现频率最高（3 条），是消费者关注的核心卖点。",
        "evidenceRefs": [
          "ev:voc:theme:d9613359bb0a0d68"
        ]
      },
      {
        "id": "signal-40844a2a383f",
        "type": "signal",
        "text": "VOC 评论显示产品主要作为幼儿饮水杯使用，适合 1.5 岁以上儿童。",
        "evidenceRefs": [
          "ev:voc:theme:25a874df5b23c8cd",
          "ev:voc:cd82be39-f3d4-46f6-896e-02adb716afa1"
        ]
      },
      {
        "id": "signal-37ab60d38a3b",
        "type": "signal",
        "text": "有一条评论提到孩子对产品非常着迷，可能表明产品对孩子有较强吸引力。",
        "evidenceRefs": [
          "ev:voc:theme:3ef9631f2168957a"
        ]
      }
    ],
    "risks": [
      {
        "id": "risk-b448d3da1516",
        "type": "risk",
        "text": "存在漏水投诉，与防漏宣传相矛盾，可能影响消费者信任。",
        "evidenceRefs": [
          "ev:voc:theme:9c893bf65d12bb6f"
        ]
      },
      {
        "id": "risk-59b6345adbc7",
        "type": "risk",
        "text": "1688 供应商为普通五金公司，产品质量和一致性可能无法保证，存在质量风险。",
        "evidenceRefs": [
          "ev:sourcing:734479850549"
        ]
      }
    ],
    "conflicts": [
      {
        "id": "conflict-3e87f75d0a02",
        "type": "conflict",
        "text": "VOC 评论中既有“防漏”的正面评价，也有“漏水”的负面反馈，两者相互矛盾。",
        "evidenceRefs": [
          "ev:voc:theme:33ab211aa13af9e8",
          "ev:voc:theme:9c893bf65d12bb6f"
        ]
      }
    ],
    "missing": [
      {
        "id": "missing-18a465ff4aeb",
        "type": "missing",
        "text": "缺少该产品的具体销售数据（如月销量、销售额）和竞争分析数据。",
        "evidenceRefs": []
      },
      {
        "id": "missing-63087db5f0e4",
        "type": "missing",
        "text": "缺少 1688 供应商的详细资质和样品质量验证信息。",
        "evidenceRefs": []
      },
      {
        "id": "missing-d7f9337785be",
        "type": "missing",
        "text": "缺少目标市场的物流成本和关税估算。",
        "evidenceRefs": []
      }
    ],
    "nextSteps": [
      {
        "id": "next-eae4238ecbe7",
        "type": "next",
        "text": "获取该产品的详细销售数据（如月销量、销售额）和竞争分析。",
        "evidenceRefs": []
      },
      {
        "id": "next-3b1b1b06cb2d",
        "type": "next",
        "text": "联系 1688 供应商索取样品，进行质量测试，特别是防漏性能。",
        "evidenceRefs": []
      },
      {
        "id": "next-073648d3757a",
        "type": "next",
        "text": "计算包含物流、关税、平台费用在内的总成本，评估利润空间。",
        "evidenceRefs": []
      }
    ]
  },
  "noviceExplanation": {
    "whatWeKnow": "我们了解到这款 THERMOS 儿童水杯在亚马逊上评分很高（4.7 星），评论数超过 4.8 万，销量排名第 9，说明它很受欢迎。用户评论中经常提到它容易清洗、坚固耐用、适合幼儿，但也有人反映会漏水。在 1688 上找到了类似产品，价格大约 20-29 元人民币，而亚马逊售价 19.99 美元，看起来有利润空间。",
    "whatWeDontKnow": "我们不知道这款产品的具体月销量和销售额，也不清楚从 1688 采购后加上运费、关税等成本后是否真的能赚钱。另外，1688 供应商的产品质量是否可靠，尤其是防漏性能，还没有验证。",
    "biggestRisk": "最大的风险是产品质量问题，特别是漏水投诉。如果采购的产品漏水，会导致差评和退货，损失惨重。",
    "why": "因为用户评论中已经出现了漏水反馈，而防漏是儿童水杯的关键功能。如果供应商的产品不能保证防漏，销售会受影响。",
    "nextToResearch": "下一步应该联系供应商要样品，测试防漏和耐用性，同时计算所有成本，看看利润是否足够。"
  },
  "unverified": [],
  "humanReviewResult": null,
  "updatedAt": "2026-08-17T05:25:17.442Z"
};

/**
 * 演示采集 Preview（browser-evidence collect 回放）——返回形状与真实采集一致
 * （amazon-detail-page-extraction.v1 + navigation + calibration），字段值来自
 * 本地真实采集样本（THERMOS FUNTAINER B0F2BF31PW）。三 ASIN 绑定与任务一致。
 *
 * 诚实性：本 preview 仅由 demo 分支使用（route 明确 demo 模式 + local_env_required），
 * 前端必须展示“演示数据”标注；它不是实时浏览器操作的结果。
 */
export function buildDemoBrowserCollectPreview(taskAsin: string): BrowserEvidenceCollectPreview {
  const fields = DEMO_BROWSER_EVIDENCE_SAMPLE.snapshots[0].fields;
  const field = (name: "asin" | "title" | "price" | "bsr" | "rating" | "reviews") => {
    const source = name === "reviews" ? fields.reviewCount : fields[name];
    return {
      field: name,
      value: name === "asin" ? taskAsin : source.value,
      status: "correct" as const,
      reason: null,
    };
  };
  return {
    extraction: {
      schemaVersion: "amazon-detail-page-extraction.v1",
      expectedAsin: taskAsin,
      urlAsin: taskAsin,
      pageAsin: taskAsin,
      entityBound: true,
      bindingProof: {
        urlMatchesExpected: true,
        pageAnchorMatchesExpected: true,
        productContainerFound: true,
      },
      pageStatus: "ok",
      fields: {
        asin: field("asin"),
        title: field("title"),
        price: field("price"),
        bsr: field("bsr"),
        rating: field("rating"),
        reviews: field("reviews"),
      },
      capturedAt: new Date().toISOString(),
      collectorVersion: "amazon-detail-page-extractor.v1",
    },
    navigation: {
      requestedUrl: `https://www.amazon.com/dp/${taskAsin}?language=en_US`,
      finalUrl: `https://www.amazon.com/dp/${taskAsin}?language=en_US&th=1`,
      httpStatus: 200,
      navigationElapsedMs: 1340,
      allowedFinalOrigin: true,
    },
    calibration: {
      attempted: true,
      deliveryConfirmed: true,
      deliveryRegion: "US",
      currencyPreference: "en_US,USD",
      usdPreferencesConfirmed: true,
      steps: [
        {
          stage: "delivery_postal_code",
          selector: "#glow-ingress-line2",
          status: "completed",
          textBefore: null,
          textAfter: "United States",
          detailCode: "postal_code_10001",
        },
        {
          stage: "currency_preference",
          selector: "#nav-global-location-popover-link",
          status: "completed",
          textBefore: null,
          textAfter: "en_US · USD",
          detailCode: "currency_usd",
        },
      ] satisfies AmazonEnvironmentStep[],
    },
  };
}

/**
 * 演示 VOC 采集 Preview items（review-evidence collect 回放）——来自本地真实
 * 采集样本（THERMOS Top Reviews 片段）。collect → collect-confirm 全链可用。
 */
export function buildDemoReviewCollectPreviewItems(): ReviewSnippetPreviewItem[] {
  return DEMO_REVIEW_EVIDENCE_SAMPLE.dataset.reviews.map((review) => ({
    asin: review.productAsin,
    role: review.sourceProductRole === "current_candidate" ? "current_candidate" : "competitor",
    rating: review.rating,
    date: review.reviewDate,
    title: review.reviewText,
    sourceUrl: review.sourceUrl ?? "",
    bindingNote: review.entityBindingProof?.note ?? "browser_verified",
  }));
}

/** 演示 VOC 采集 pageResults（与正式返回同形） */
export function buildDemoReviewCollectPageResults(): ReviewCollectPageResult[] {
  const asins = [...new Set(DEMO_REVIEW_EVIDENCE_SAMPLE.dataset.reviews.map((review) => review.productAsin))];
  return asins.map((asin) => ({
    asin,
    status: "ok" as const,
    note: null,
    extractedCount: DEMO_REVIEW_EVIDENCE_SAMPLE.dataset.reviews.filter((review) => review.productAsin === asin).length,
  }));
}

