/**
 * V3 UX Closure — Golden Demo Template Data（演示模板静态数据）
 *
 * 来源：本地真实采集产物（THERMOS FUNTAINER B0F2BF31PW）完整研究任务快照。
 * 含：identity + 全套真实采集证据（Amazon/VOC/1688）+ researchRecord +
 * researchCompletion + creativeHandoff + listing/image snapshot（可体验合法状态）。
 *
 * 安全：无 owner secret / 无绝对路径 / 无凭证 / 无 token；
 * storageKey 为相对引用（图片可不可用，历史展示不影响）。
 * 每个 Visitor seed 时通过正式 sandbox writer 创建独立副本（不共享 Task）。
 */

export const GOLDEN_DEMO_TEMPLATE_RESULT_JSON: Record<string, unknown> = {
  "type": "workflow",
  "productName": "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction",
  "candidateToTask": {
    "version": 1,
    "candidateId": "fixture-vr-cand-001",
    "confirmation": "research_started",
    "confirmedAt": "2026-08-16T19:25:38.349Z"
  },
  "candidateAnalysisContext": {
    "version": "candidate-analysis-context-v1",
    "integrity": "verified_product_batch",
    "facts": {
      "capturedAt": "2026-08-16T11:30:43.519Z",
      "originKind": "seller_sprite_product_batch",
      "productBatchId": "c423c04d-f42d-455d-bd20-97b52abcb584",
      "productBatchItemId": "7336e1de-4eb6-4ef3-a168-780521de6585",
      "productName": "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction",
      "marketplace": "US",
      "asin": "B0F2BF31PW",
      "reportType": "category_current",
      "query": null,
      "category": "Kitchen & Dining",
      "researchPriority": "priority_3",
      "evidenceStatus": "sufficient_for_comparison",
      "provisionalDisposition": "insufficient_hard_gate_evidence",
      "evidenceHash": "06a971c9a7672479aaeff2fd1b2b443fd254a8aa747b3c3a90cbcb06a40dd0dc",
      "itemHash": "8414c17ff9c728a83df01eebfa3ff2ae0bbb0fb2fcdd51a3bc2576c41e05b67d",
      "sellerSpriteDisclaimerVersion": "sellersprite-v1-frozen.2026-07-27",
      "productFacts": {
        "productTitle": "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction",
        "brand": "THERMOS",
        "price": 19.99,
        "rating": 4.7,
        "reviews": 48110,
        "estimatedMonthlySales": 45581,
        "estimatedMonthlyRevenue": 911164,
        "rootCategory": "Kitchen & Dining",
        "rootCategoryBsr": 9,
        "subCategory": "Insulated Bottles",
        "subCategoryBsr": 2,
        "variationCount": 63
      }
    },
    "assessment": {
      "researchMode": "market_research_only",
      "promotionEligible": false
    }
  },
  "browserEvidence": {
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
  },
  "reviewEvidence": {
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
  },
  "vocAnalysis": {
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
  },
  "aiEvidenceSummary": {
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
  },
  "sourcingEvidence": {
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
  },
  "researchRecord": {
    "schema": "product-research-record.v1",
    "revision": 1,
    "researchHash": "7d2d2d19548e75c79800a2caa44774cd6701572cf20e78448c12c29127ee7d65",
    "candidateId": "fixture-vr-cand-001",
    "runId": "fixture-vr-thermos-001",
    "contextHash": "504fd08a76e0e066b09cc877f54557bf06fcf1940c26bdd73cff29a3e3743aaa",
    "createdAt": "2026-08-17T11:59:04.782Z",
    "updatedAt": "2026-08-17T11:59:04.782Z",
    "latestDecision": {
      "decisionId": "d7cfa037-5ab4-477f-ae72-6f33cd1c48c0",
      "status": "creative_ready",
      "reason": "证据已核实，产品适合继续推进创作准备。",
      "nextAction": null,
      "revision": 1,
      "researchHash": "7d2d2d19548e75c79800a2caa44774cd6701572cf20e78448c12c29127ee7d65",
      "decidedAt": "2026-08-17T11:59:04.782Z",
      "actor": {
        "mode": "owner",
        "actorRef": "owner:v1"
      }
    },
    "decisionEvents": [
      {
        "decisionId": "d7cfa037-5ab4-477f-ae72-6f33cd1c48c0",
        "status": "creative_ready",
        "reason": "证据已核实，产品适合继续推进创作准备。",
        "nextAction": null,
        "revision": 1,
        "researchHash": "7d2d2d19548e75c79800a2caa44774cd6701572cf20e78448c12c29127ee7d65",
        "decidedAt": "2026-08-17T11:59:04.782Z",
        "actor": {
          "mode": "owner",
          "actorRef": "owner:v1"
        }
      }
    ]
  },
  "researchVerification": {
    "schema": "product-research-verification.v1",
    "candidateId": "fixture-vr-cand-001",
    "runId": "fixture-vr-thermos-001",
    "contextHash": "504fd08a76e0e066b09cc877f54557bf06fcf1940c26bdd73cff29a3e3743aaa",
    "inputHash": "0df2538ad5bb1be140f6383e44adb4b04d7c2daf313a26e924fed87e587818e9",
    "resultHash": "bc85d796c365bd4b0b26d8df78367538434e3387b2348092749f585d1966da17",
    "workflowStatus": "completed",
    "reviewState": {
      "sourcingReviewed": false,
      "riskReviewed": false,
      "summaryReviewed": false,
      "listingReviewed": false,
      "reviewedCount": 0,
      "totalReviewSteps": 0,
      "allReviewed": true
    }
  },
  "researchCompletion": {
    "schema": "research-completion.v1",
    "status": "completed",
    "completedAt": "2026-08-17T12:05:59.584Z",
    "decisionId": "d7cfa037-5ab4-477f-ae72-6f33cd1c48c0",
    "revision": 1,
    "finalStatus": "creative_ready"
  },
  "creativeHandoff": {
    "schema": "product-creative-handoff.v1",
    "handoffId": "d2953481-d42c-4f69-911b-ad120ffa44e6",
    "taskId": "fixture-vr-thermos-001",
    "candidateId": "fixture-vr-cand-001",
    "currentRevision": 3,
    "controlState": "active",
    "createdAt": "2026-08-17T17:26:27.310Z",
    "createdBy": {
      "mode": "owner",
      "subjectFingerprint": "39c8566f921d86b7"
    },
    "researchMode": "market_research_only",
    "promotionEligible": false,
    "versions": [
      {
        "revision": 1,
        "createdAt": "2026-08-17T17:26:27.310Z",
        "createdBy": {
          "mode": "owner",
          "subjectFingerprint": "39c8566f921d86b7"
        },
        "sourceResearch": {
          "recordSchema": "product-research-record.v1",
          "candidateId": "fixture-vr-cand-001",
          "researchRevision": 1,
          "researchHash": "7d2d2d19548e75c79800a2caa44774cd6701572cf20e78448c12c29127ee7d65",
          "workflowStatus": "completed",
          "decisionStatus": "creative_ready",
          "candidateSourceFingerprint": "504fd08a76e0e066b09cc877f54557bf06fcf1940c26bdd73cff29a3e3743aaa"
        },
        "productIdentity": {
          "displayName": "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction 商品研究",
          "identityConfirmedAt": "2026-08-16T19:25:38.351Z"
        },
        "confirmedFacts": [
          {
            "factId": "2c362463-e00b-4b02-a365-bd01b4a80c86",
            "field": "brand",
            "label": "品牌",
            "value": "THERMOS",
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal",
              "listing",
              "image"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "brand",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T17:26:27.310Z",
              "confirmationReference": "confirm:58754461366e9ffd65abb4ad5cd05b4c"
            },
            "confirmedAt": "2026-08-17T17:26:27.310Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "9ead3565-dbed-440f-a0aa-7044180fff36",
            "field": "product_type",
            "label": "商品类型",
            "value": "Water Bottle",
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal",
              "listing",
              "image"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "product_type",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T17:26:27.310Z",
              "confirmationReference": "confirm:58754461366e9ffd65abb4ad5cd05b4c"
            },
            "confirmedAt": "2026-08-17T17:26:27.310Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "f8c2e054-cda5-4986-b080-a0f128b42fa9",
            "field": "series_or_model",
            "label": "系列/型号",
            "value": "FUNTAINER Water",
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal",
              "listing",
              "image"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "series_or_model",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T17:26:27.310Z",
              "confirmationReference": "confirm:58754461366e9ffd65abb4ad5cd05b4c"
            },
            "confirmedAt": "2026-08-17T17:26:27.310Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "d45c46e3-38e4-4800-80ff-f6f4e6aa02f4",
            "field": "capacity",
            "label": "容量",
            "value": "12oz",
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal",
              "listing",
              "image"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "capacity",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T17:26:27.310Z",
              "confirmationReference": "confirm:58754461366e9ffd65abb4ad5cd05b4c"
            },
            "confirmedAt": "2026-08-17T17:26:27.310Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          }
        ],
        "stableSourceFacts": [
          {
            "factId": "eab7086f-759f-46d2-8de8-8c94b772bafa",
            "field": "asin",
            "label": "ASIN",
            "value": "B0F2BF31PW",
            "evidenceTier": "source_snapshot",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "candidate_snapshot",
              "sourceField": "asin",
              "candidateSnapshotFingerprint": "ea85d95f80064fbdb9326b4a6f452510453c01159e1654537c8850bd524ca992",
              "capturedAt": "2026-08-16T11:30:43.519Z"
            },
            "stabilityRule": "identity_only"
          },
          {
            "factId": "9d89a4de-3129-45f2-8a7c-2a8c34d33def",
            "field": "title",
            "label": "商品标题",
            "value": "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction",
            "evidenceTier": "source_snapshot",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "candidate_snapshot",
              "sourceField": "title",
              "candidateSnapshotFingerprint": "0623ddbf1abd341bb43e1e13313d5537321a64728d7a2a15438e842af7a87071",
              "capturedAt": "2026-08-16T11:30:43.519Z"
            },
            "stabilityRule": "routing_only"
          },
          {
            "factId": "37266836-b5be-4936-8cb8-fa3fee406ff0",
            "field": "category",
            "label": "类目",
            "value": "Kitchen & Dining",
            "evidenceTier": "source_snapshot",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "candidate_snapshot",
              "sourceField": "category",
              "candidateSnapshotFingerprint": "f691fc9182bd87319e9a6080d05ec8885317280935a56f6df8072d056814c9f5",
              "capturedAt": "2026-08-16T11:30:43.519Z"
            },
            "stabilityRule": "human_confirmation_required_for_claim",
            "factCategory": "market_signal"
          },
          {
            "factId": "390cefad-6790-4ece-958a-32b1b8b226c6",
            "field": "price_usd",
            "label": "参考价格 (USD)",
            "value": 19.99,
            "evidenceTier": "source_snapshot",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "candidate_snapshot",
              "sourceField": "price_usd",
              "candidateSnapshotFingerprint": "8cb1f9766686b88d2bc894ea835cfa57519414fc57b4f0d8e51ab70b674c75ff",
              "capturedAt": "2026-08-16T11:30:43.519Z"
            },
            "stabilityRule": "human_confirmation_required_for_claim",
            "factCategory": "market_signal"
          },
          {
            "factId": "7f9247ee-8e31-426f-ba50-ab8d634d46b9",
            "field": "rating",
            "label": "评分",
            "value": 4.7,
            "evidenceTier": "source_snapshot",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "candidate_snapshot",
              "sourceField": "rating",
              "candidateSnapshotFingerprint": "ad590edb4b233f990450c8164af7d5cd8495a72949f853ffbd291d2eabab5d90",
              "capturedAt": "2026-08-16T11:30:43.519Z"
            },
            "stabilityRule": "human_confirmation_required_for_claim",
            "factCategory": "market_signal"
          },
          {
            "factId": "c7dacb8a-fdf7-4d6e-870d-abd4659cab4e",
            "field": "review_count",
            "label": "评论数",
            "value": 48110,
            "evidenceTier": "source_snapshot",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "candidate_snapshot",
              "sourceField": "review_count",
              "candidateSnapshotFingerprint": "2dbafce5ca5e1597fa9b2ed9cd4fb76559fcec1e948635a1b7320da3d456f218",
              "capturedAt": "2026-08-16T11:30:43.519Z"
            },
            "stabilityRule": "human_confirmation_required_for_claim",
            "factCategory": "market_signal"
          },
          {
            "factId": "1bd0b4e7-a254-4762-9478-5437a3370919",
            "field": "bsr",
            "label": "BSR",
            "value": 9,
            "evidenceTier": "source_snapshot",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "amazon_browser_snapshot",
              "sourceField": "bsr",
              "amazonBrowserSnapshotFingerprint": "71ebaef8d5cff91e49027c50c650353064002182755b36e8829f43e7fa02f1aa",
              "capturedAt": "2026-08-16T19:25:55.749Z"
            },
            "stabilityRule": "human_confirmation_required_for_claim",
            "factCategory": "market_signal"
          }
        ],
        "aiCreativeReferences": [],
        "issues": [],
        "prohibitedClaims": [
          {
            "claimId": "00000000-0000-4000-8000-000000000001",
            "category": "absolute_claim",
            "summary": "Do not make absolute claims.",
            "appliesTo": [
              "both"
            ],
            "source": "system_rule"
          }
        ],
        "creativePreferences": {
          "evidenceTier": "creative_preference"
        },
        "visualReferences": [],
        "humanReviewRequired": true,
        "confirmation": {
          "confirmed": true,
          "confirmedAt": "2026-08-17T17:26:27.310Z",
          "confirmedBy": {
            "mode": "owner",
            "subjectFingerprint": "39c8566f921d86b7"
          }
        },
        "handoffFingerprint": "2a1a0764fd8b4445575b2237daef975e3e9ab818dfa17f093309f93685f4b8ee"
      },
      {
        "revision": 2,
        "createdAt": "2026-08-17T19:32:52.367Z",
        "createdBy": {
          "mode": "owner",
          "subjectFingerprint": "39c8566f921d86b7"
        },
        "sourceResearch": {
          "recordSchema": "product-research-record.v1",
          "candidateId": "fixture-vr-cand-001",
          "researchRevision": 1,
          "researchHash": "7d2d2d19548e75c79800a2caa44774cd6701572cf20e78448c12c29127ee7d65",
          "workflowStatus": "completed",
          "decisionStatus": "creative_ready",
          "candidateSourceFingerprint": "504fd08a76e0e066b09cc877f54557bf06fcf1940c26bdd73cff29a3e3743aaa"
        },
        "productIdentity": {
          "displayName": "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction 商品研究",
          "identityConfirmedAt": "2026-08-16T19:25:38.351Z"
        },
        "confirmedFacts": [
          {
            "factId": "2c362463-e00b-4b02-a365-bd01b4a80c86",
            "field": "brand",
            "label": "品牌",
            "value": "THERMOS",
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal",
              "listing",
              "image"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "brand",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T17:26:27.310Z",
              "confirmationReference": "confirm:58754461366e9ffd65abb4ad5cd05b4c"
            },
            "confirmedAt": "2026-08-17T17:26:27.310Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "9ead3565-dbed-440f-a0aa-7044180fff36",
            "field": "product_type",
            "label": "商品类型",
            "value": "Water Bottle",
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal",
              "listing",
              "image"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "product_type",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T17:26:27.310Z",
              "confirmationReference": "confirm:58754461366e9ffd65abb4ad5cd05b4c"
            },
            "confirmedAt": "2026-08-17T17:26:27.310Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "f8c2e054-cda5-4986-b080-a0f128b42fa9",
            "field": "series_or_model",
            "label": "系列/型号",
            "value": "FUNTAINER Water",
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal",
              "listing",
              "image"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "series_or_model",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T17:26:27.310Z",
              "confirmationReference": "confirm:58754461366e9ffd65abb4ad5cd05b4c"
            },
            "confirmedAt": "2026-08-17T17:26:27.310Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "d45c46e3-38e4-4800-80ff-f6f4e6aa02f4",
            "field": "capacity",
            "label": "容量",
            "value": "12oz",
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal",
              "listing",
              "image"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "capacity",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T17:26:27.310Z",
              "confirmationReference": "confirm:58754461366e9ffd65abb4ad5cd05b4c"
            },
            "confirmedAt": "2026-08-17T17:26:27.310Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "4523b584-181c-4d98-8430-5be743583c99",
            "field": "category",
            "label": "类目",
            "value": "Kitchen & Dining",
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "category",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T19:32:52.367Z",
              "confirmationReference": "confirm:62d0af7549541eb91fa6b35f829d4741"
            },
            "confirmedAt": "2026-08-17T19:32:52.367Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "f92417a3-d360-451b-b0f3-5d9f879a89c2",
            "field": "price_usd",
            "label": "参考价格 (USD)",
            "value": 19.99,
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "price_usd",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T19:32:52.367Z",
              "confirmationReference": "confirm:62d0af7549541eb91fa6b35f829d4741"
            },
            "confirmedAt": "2026-08-17T19:32:52.367Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "e2810d62-a8f5-4d7a-a86b-318b7a0b9fe8",
            "field": "rating",
            "label": "评分",
            "value": 4.7,
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "rating",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T19:32:52.367Z",
              "confirmationReference": "confirm:62d0af7549541eb91fa6b35f829d4741"
            },
            "confirmedAt": "2026-08-17T19:32:52.367Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "d53b5f01-bf35-44a2-8219-de90e80d603f",
            "field": "review_count",
            "label": "评论数",
            "value": 48110,
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "review_count",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T19:32:52.367Z",
              "confirmationReference": "confirm:62d0af7549541eb91fa6b35f829d4741"
            },
            "confirmedAt": "2026-08-17T19:32:52.367Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "d37a036d-a972-4776-bf6c-8cfd71dbf19d",
            "field": "bsr",
            "label": "BSR",
            "value": 9,
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "bsr",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T19:32:52.367Z",
              "confirmationReference": "confirm:62d0af7549541eb91fa6b35f829d4741"
            },
            "confirmedAt": "2026-08-17T19:32:52.367Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          }
        ],
        "stableSourceFacts": [
          {
            "factId": "eab7086f-759f-46d2-8de8-8c94b772bafa",
            "field": "asin",
            "label": "ASIN",
            "value": "B0F2BF31PW",
            "evidenceTier": "source_snapshot",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "candidate_snapshot",
              "sourceField": "asin",
              "candidateSnapshotFingerprint": "ea85d95f80064fbdb9326b4a6f452510453c01159e1654537c8850bd524ca992",
              "capturedAt": "2026-08-16T11:30:43.519Z"
            },
            "stabilityRule": "identity_only"
          },
          {
            "factId": "9d89a4de-3129-45f2-8a7c-2a8c34d33def",
            "field": "title",
            "label": "商品标题",
            "value": "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction",
            "evidenceTier": "source_snapshot",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "candidate_snapshot",
              "sourceField": "title",
              "candidateSnapshotFingerprint": "0623ddbf1abd341bb43e1e13313d5537321a64728d7a2a15438e842af7a87071",
              "capturedAt": "2026-08-16T11:30:43.519Z"
            },
            "stabilityRule": "routing_only"
          }
        ],
        "aiCreativeReferences": [],
        "issues": [],
        "prohibitedClaims": [
          {
            "claimId": "00000000-0000-4000-8000-000000000001",
            "category": "absolute_claim",
            "summary": "Do not make absolute claims.",
            "appliesTo": [
              "both"
            ],
            "source": "system_rule"
          }
        ],
        "creativePreferences": {
          "evidenceTier": "creative_preference"
        },
        "visualReferences": [],
        "humanReviewRequired": true,
        "confirmation": {
          "confirmed": true,
          "confirmedAt": "2026-08-17T19:32:52.367Z",
          "confirmedBy": {
            "mode": "owner",
            "subjectFingerprint": "39c8566f921d86b7"
          }
        },
        "handoffFingerprint": "42cef314023c6f08ef1e89dbe47345d68b9ec5e00fb74abcf23821f48ab9298c"
      },
      {
        "revision": 3,
        "createdAt": "2026-08-17T22:12:14.128Z",
        "createdBy": {
          "mode": "owner",
          "subjectFingerprint": "39c8566f921d86b7"
        },
        "sourceResearch": {
          "recordSchema": "product-research-record.v1",
          "candidateId": "fixture-vr-cand-001",
          "researchRevision": 1,
          "researchHash": "7d2d2d19548e75c79800a2caa44774cd6701572cf20e78448c12c29127ee7d65",
          "workflowStatus": "completed",
          "decisionStatus": "creative_ready",
          "candidateSourceFingerprint": "504fd08a76e0e066b09cc877f54557bf06fcf1940c26bdd73cff29a3e3743aaa"
        },
        "productIdentity": {
          "displayName": "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction 商品研究",
          "identityConfirmedAt": "2026-08-16T19:25:38.351Z"
        },
        "confirmedFacts": [
          {
            "factId": "2c362463-e00b-4b02-a365-bd01b4a80c86",
            "field": "brand",
            "label": "品牌",
            "value": "THERMOS",
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal",
              "listing",
              "image"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "brand",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T17:26:27.310Z",
              "confirmationReference": "confirm:58754461366e9ffd65abb4ad5cd05b4c"
            },
            "confirmedAt": "2026-08-17T17:26:27.310Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "9ead3565-dbed-440f-a0aa-7044180fff36",
            "field": "product_type",
            "label": "商品类型",
            "value": "Water Bottle",
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal",
              "listing",
              "image"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "product_type",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T17:26:27.310Z",
              "confirmationReference": "confirm:58754461366e9ffd65abb4ad5cd05b4c"
            },
            "confirmedAt": "2026-08-17T17:26:27.310Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "f8c2e054-cda5-4986-b080-a0f128b42fa9",
            "field": "series_or_model",
            "label": "系列/型号",
            "value": "FUNTAINER Water",
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal",
              "listing",
              "image"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "series_or_model",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T17:26:27.310Z",
              "confirmationReference": "confirm:58754461366e9ffd65abb4ad5cd05b4c"
            },
            "confirmedAt": "2026-08-17T17:26:27.310Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "d45c46e3-38e4-4800-80ff-f6f4e6aa02f4",
            "field": "capacity",
            "label": "容量",
            "value": "12oz",
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal",
              "listing",
              "image"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "capacity",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T17:26:27.310Z",
              "confirmationReference": "confirm:58754461366e9ffd65abb4ad5cd05b4c"
            },
            "confirmedAt": "2026-08-17T17:26:27.310Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "4523b584-181c-4d98-8430-5be743583c99",
            "field": "category",
            "label": "类目",
            "value": "Kitchen & Dining",
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "category",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T19:32:52.367Z",
              "confirmationReference": "confirm:62d0af7549541eb91fa6b35f829d4741"
            },
            "confirmedAt": "2026-08-17T19:32:52.367Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "f92417a3-d360-451b-b0f3-5d9f879a89c2",
            "field": "price_usd",
            "label": "参考价格 (USD)",
            "value": 19.99,
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "price_usd",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T19:32:52.367Z",
              "confirmationReference": "confirm:62d0af7549541eb91fa6b35f829d4741"
            },
            "confirmedAt": "2026-08-17T19:32:52.367Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "e2810d62-a8f5-4d7a-a86b-318b7a0b9fe8",
            "field": "rating",
            "label": "评分",
            "value": 4.7,
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "rating",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T19:32:52.367Z",
              "confirmationReference": "confirm:62d0af7549541eb91fa6b35f829d4741"
            },
            "confirmedAt": "2026-08-17T19:32:52.367Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "d53b5f01-bf35-44a2-8219-de90e80d603f",
            "field": "review_count",
            "label": "评论数",
            "value": 48110,
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "review_count",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T19:32:52.367Z",
              "confirmationReference": "confirm:62d0af7549541eb91fa6b35f829d4741"
            },
            "confirmedAt": "2026-08-17T19:32:52.367Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          },
          {
            "factId": "d37a036d-a972-4776-bf6c-8cfd71dbf19d",
            "field": "bsr",
            "label": "BSR",
            "value": 9,
            "evidenceTier": "human_confirmed",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "user_confirmation",
              "sourceField": "bsr",
              "confirmedBy": {
                "mode": "owner",
                "subjectFingerprint": "39c8566f921d86b7"
              },
              "confirmedAt": "2026-08-17T19:32:52.367Z",
              "confirmationReference": "confirm:62d0af7549541eb91fa6b35f829d4741"
            },
            "confirmedAt": "2026-08-17T19:32:52.367Z",
            "confirmedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            }
          }
        ],
        "stableSourceFacts": [
          {
            "factId": "b1d32f18-16e2-41b9-a59b-d7856ef8ce51",
            "field": "asin",
            "label": "ASIN",
            "value": "B0F2BF31PW",
            "evidenceTier": "source_snapshot",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "candidate_snapshot",
              "sourceField": "asin",
              "candidateSnapshotFingerprint": "a7156ae871537adf653de74a00cd8d07d04d2ffb76304ef5733a846e76143105",
              "capturedAt": "2026-08-16T11:30:43.519Z"
            },
            "stabilityRule": "identity_only"
          },
          {
            "factId": "e5b34e69-2947-4b5c-b00f-6cdfece28dcd",
            "field": "title",
            "label": "商品标题",
            "value": "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction",
            "evidenceTier": "source_snapshot",
            "usageScopes": [
              "internal"
            ],
            "sourceRef": {
              "sourceKind": "candidate_snapshot",
              "sourceField": "title",
              "candidateSnapshotFingerprint": "ea0341be21105b0b652a67cc5d42308990457f1af420254d626caeadfcf415f9",
              "capturedAt": "2026-08-16T11:30:43.519Z"
            },
            "stabilityRule": "routing_only"
          }
        ],
        "aiCreativeReferences": [],
        "issues": [],
        "prohibitedClaims": [
          {
            "claimId": "00000000-0000-4000-8000-000000000001",
            "category": "absolute_claim",
            "summary": "Do not make absolute claims.",
            "appliesTo": [
              "both"
            ],
            "source": "system_rule"
          }
        ],
        "creativePreferences": {
          "evidenceTier": "creative_preference"
        },
        "visualReferences": [
          {
            "assetFingerprint": "f6d3762f2185bc93197d42eb29d88c6916f37ef6369e21d846379736771bed91",
            "sourceTier": "human_confirmed",
            "identityBound": true,
            "humanApprovedForReference": true,
            "approvedBy": {
              "mode": "owner",
              "subjectFingerprint": "39c8566f921d86b7"
            },
            "approvedAt": "2026-08-17T22:12:14.128Z",
            "confirmationReference": "confirm:bdf731dc23e42b222fd4b01774ff1320"
          }
        ],
        "humanReviewRequired": true,
        "confirmation": {
          "confirmed": true,
          "confirmedAt": "2026-08-17T22:12:14.128Z",
          "confirmedBy": {
            "mode": "owner",
            "subjectFingerprint": "39c8566f921d86b7"
          }
        },
        "handoffFingerprint": "efe5252eb4cef43c3f1f33428ee6df63863a244d08f023c160eee5a795cc93b2"
      }
    ]
  },
  "creativeHandoffRequestLedger": {
    "schema": "creative-handoff-request-ledger.v1",
    "version": 1,
    "entries": [
      {
        "requestKeyHash": "sha256:a6d557b4c0312d854342a78c159bf7be8807934ce5ec41c73d95ffaf76b1e37f",
        "requestFingerprint": "sha256:15c93cb3cc27d97cad0bf067bc3eb640abe85f39053dd1fd5ffc630ffa14899d",
        "action": "create",
        "outcomeKind": "created",
        "outcomeRevision": 1,
        "recordedAt": "2026-08-17T17:26:27.310Z"
      },
      {
        "requestKeyHash": "sha256:1cc6ff37c2cd0f0dec8b57b0c8768a9a463a9f6d0a8cf0a872cd12f7d4cbd0f5",
        "requestFingerprint": "sha256:de2c7063712903daf4740c1331ecb349446402a41593dc00fd1b23160f2cb1db",
        "action": "create",
        "outcomeKind": "appended",
        "outcomeRevision": 2,
        "recordedAt": "2026-08-17T19:32:52.367Z"
      },
      {
        "requestKeyHash": "sha256:3fe28c6119406c6c3224811c81477f2e9583622d2ba1cc90340fa43f041c5d00",
        "requestFingerprint": "sha256:008d28144877b5478303b025b78cf7fda25166e0d1767a66ded0c795f1d2a702",
        "action": "create",
        "outcomeKind": "appended",
        "outcomeRevision": 3,
        "recordedAt": "2026-08-17T22:12:14.128Z"
      }
    ]
  },
  "aiImageDraftSnapshot": {
    "version": 1,
    "snapshotType": "ai_image_draft",
    "provider": "openai_compatible_relay",
    "accessMode": "owner",
    "humanReviewRequired": true,
    "disclaimer": "AI 生成图片仅供 Listing 素材方向参考，不代表真实商品实拍，不可直接作为商品事实、认证或平台上架依据。",
    "items": [
      {
        "id": "baa8bd0d-824c-47fd-8b00-3092bfa27597",
        "imageType": "lifestyle_scene",
        "model": "gpt-image-2",
        "createdAt": "2026-08-17T17:28:11.385Z",
        "storageKey": "owner/fixture-vr-thermos-001/baa8bd0d-824c-47fd-8b00-3092bfa27597.png",
        "mimeType": "image/png",
        "width": 1536,
        "height": 1024,
        "fileSizeBytes": 2219060,
        "sha256": "977ee7d2fbfddc62a9c75f14c033cafc8d8b5f83f998a342787ce0c9fa8a7afb",
        "reviewStatus": "needs_human_review",
        "accessMode": "owner",
        "source": "real_ai_image_draft",
        "safetyWarnings": [
          "Composition concept only; does not represent real product appearance.",
          "Real AI image draft; human review required before any use."
        ],
        "promptSummary": "tech; Believable office or commute context.; Balanced bundle layout; include packaging or accessories only when confirmed. Practical in-use composition with uncluttered working space.",
        "generationBasis": {
          "productName": "composition concept",
          "sellingPoints": [],
          "riskWarnings": [],
          "missingFacts": [],
          "imageMaterialNeeds": []
        }
      },
      {
        "id": "4a74ca28-ca79-4c47-a991-6e8ac80c71bf",
        "imageType": "lifestyle_scene",
        "model": "gpt-image-2",
        "createdAt": "2026-08-17T17:29:07.945Z",
        "storageKey": "owner/fixture-vr-thermos-001/4a74ca28-ca79-4c47-a991-6e8ac80c71bf.png",
        "mimeType": "image/png",
        "width": 1536,
        "height": 1024,
        "fileSizeBytes": 1149320,
        "sha256": "3b771d1a01fc4e6ecd606e1e13f05561af809476e5d46da31deb9c1267ad6c52",
        "reviewStatus": "needs_human_review",
        "accessMode": "owner",
        "source": "real_ai_image_draft",
        "safetyWarnings": [
          "Composition concept only; does not represent real product appearance.",
          "Real AI image draft; human review required before any use."
        ],
        "promptSummary": "minimal; Clean white studio background.; Centered product-first composition with a natural shadow.",
        "generationBasis": {
          "productName": "composition concept",
          "sellingPoints": [],
          "riskWarnings": [],
          "missingFacts": [],
          "imageMaterialNeeds": []
        }
      },
      {
        "id": "2b51c7d9-dc3c-4ab6-b576-78ada0001899",
        "imageType": "lifestyle_scene",
        "model": "gpt-image-2",
        "createdAt": "2026-08-17T18:21:07.057Z",
        "storageKey": "owner/fixture-vr-thermos-001/2b51c7d9-dc3c-4ab6-b576-78ada0001899.png",
        "mimeType": "image/png",
        "width": 1536,
        "height": 1024,
        "fileSizeBytes": 1347803,
        "sha256": "8e107c12d61c7aa5bbb6a7409f598ff89cd9f652a7ade98e93ccfbb98096488b",
        "reviewStatus": "needs_human_review",
        "accessMode": "owner",
        "source": "real_ai_image_draft",
        "safetyWarnings": [
          "Composition concept only; does not represent real product appearance.",
          "Real AI image draft; human review required before any use."
        ],
        "promptSummary": "TARGET PRODUCT IDENTITY (HARD CONSTRAINT)\n- Product title: THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction 商品研究\n- Product type: Water Bottle\n- Brand: THERMOS\n- Series/model: FUNTAINER Wa",
        "generationBasis": {
          "productName": "composition concept",
          "sellingPoints": [],
          "riskWarnings": [],
          "missingFacts": [],
          "imageMaterialNeeds": []
        },
        "handoffMode": "composition_concept",
        "compositionSummary": "Abstract composition concept for listing material planning (real AI provider). Background direction, scene mood, whitespace areas and colour direction only.",
        "sourceHandoffRevision": 1
      }
    ],
    "updatedAt": "2026-08-17T18:21:07.057Z"
  },
  "imageHandoffBinding": {
    "version": 1,
    "handoffRevision": null,
    "imageDraft": null
  }
};
