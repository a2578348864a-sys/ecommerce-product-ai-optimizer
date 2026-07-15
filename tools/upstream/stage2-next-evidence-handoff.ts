import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import {
  validateStage2EvidenceSubmission,
  type Stage2EvidenceGapInventory,
  type Stage2EvidenceSubmission,
} from "./stage2-evidence-intake";

type ValidationResult = ReturnType<typeof validateStage2EvidenceSubmission>;

type RemainingEvidenceRequest = {
  schemaVersion: string;
  status: string;
  sourceValidationHash: string;
  target: { sampleId: string; productKey: string; acceptedProvisionalBomUsd: number };
  missingFields: string[];
  requestHash: string;
  [key: string]: unknown;
};

export type Stage2NextEvidenceHandoffInput = {
  inventory: Stage2EvidenceGapInventory;
  submission: Stage2EvidenceSubmission;
  validation: ValidationResult;
  request: RemainingEvidenceRequest;
  createdAt: string;
};

function validIso(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function buildStage2NextEvidenceHandoff(input: Stage2NextEvidenceHandoffInput) {
  let expectedValidation: ValidationResult;
  try {
    expectedValidation = validateStage2EvidenceSubmission(input.inventory, input.submission);
  } catch {
    throw new Error("STAGE2_NEXT_EVIDENCE_HANDOFF_SOURCE_INVALID");
  }
  const { requestHash, ...requestBody } = input.request;
  const target = input.submission.samples.find((sample) => sample.sampleId === input.request.target.sampleId);
  const inventoryTarget = input.inventory.samples.find((sample) => sample.sampleId === input.request.target.sampleId);
  const requiredMissingFields = [
    "supplierCapturedAt",
    "firstMile",
    "logisticsEvidenceUrl",
    "platformCommission",
    "fba",
    "packaging",
    "storage",
    "returnReserve",
    "complianceEvidenceUrl",
  ];
  if (!validIso(input.createdAt)
    || expectedValidation.status !== "incomplete"
    || input.validation.evidenceHash !== expectedValidation.evidenceHash
    || input.validation.submissionHash !== expectedValidation.submissionHash
    || input.request.schemaVersion !== "stage2-remaining-evidence-request.v1"
    || input.request.status !== "pending_user_evidence"
    || stableHash(requestBody) !== requestHash
    || input.request.sourceValidationHash !== input.validation.evidenceHash
    || input.request.missingFields.length !== requiredMissingFields.length
    || input.request.missingFields.some((field, index) => field !== requiredMissingFields[index])
    || !target
    || !inventoryTarget
    || target.productKey !== input.request.target.productKey
    || inventoryTarget.productKey !== target.productKey) {
    throw new Error("STAGE2_NEXT_EVIDENCE_HANDOFF_SOURCE_INVALID");
  }

  const salePrice = inventoryTarget.sourceEvidence.salePrice;
  const bom = target.fields.bom.value;
  const lengthCm = target.fields.packageLengthCm.value;
  const widthCm = target.fields.packageWidthCm.value;
  const heightCm = target.fields.packageHeightCm.value;
  const weightKg = target.fields.packageWeightKg.value;
  if ([salePrice, bom, lengthCm, widthCm, heightCm, weightKg].some(
    (value) => typeof value !== "number" || !Number.isFinite(value) || value <= 0,
  )
    || bom !== input.request.target.acceptedProvisionalBomUsd
    || heightCm !== 3.5) {
    throw new Error("STAGE2_NEXT_EVIDENCE_HANDOFF_KNOWN_INPUT_INVALID");
  }
  const asin = target.productKey.split(":").at(-1);
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
    throw new Error("STAGE2_NEXT_EVIDENCE_HANDOFF_TARGET_INVALID");
  }

  const body = {
    schemaVersion: "stage2-next-evidence-handoff.v1" as const,
    handoffId: `stage2-next-evidence-handoff-${stableHash({
      requestHash,
      submissionHash: input.validation.submissionHash,
    }).slice(0, 24)}`,
    status: "pending_manual_evidence_capture" as const,
    createdAt: input.createdAt,
    sourceSubmissionHash: input.validation.submissionHash,
    sourceValidationHash: input.validation.evidenceHash,
    sourceRequestHash: requestHash,
    target: {
      sampleId: target.sampleId,
      productKey: target.productKey,
      asin,
    },
    knownInputs: {
      salePriceUsd: salePrice as number,
      provisionalBomUsdPerItem: bom as number,
      packageMetric: {
        lengthCm: lengthCm as number,
        widthCm: widthCm as number,
        heightCm: heightCm as number,
        weightKg: weightKg as number,
      },
      packageImperialDiagnostic: {
        lengthIn: round((lengthCm as number) / 2.54, 2),
        widthIn: round((widthCm as number) / 2.54, 2),
        heightIn: round((heightCm as number) / 2.54, 2),
        weightLb: round((weightKg as number) * 2.2046226218, 2),
        weightOz: round((weightKg as number) * 35.27396195, 2),
      },
      packageHeightBasis: "project_owner_manual_working_value_not_supplier_confirmation" as const,
    },
    tracks: [
      {
        trackId: "amazon_fee_evidence" as const,
        priority: 1 as const,
        requestedFields: ["platformCommission", "fba"] as const,
        manualAction: "在Amazon官方Revenue Calculator或官方费用工具中查询ASIN并保存结果截图。" as const,
        prefilledInputs: { asin, salePriceUsd: salePrice as number },
        returnEvidence: [
          "official_tool_result_screenshot",
          "result_captured_at",
          "fee_category_or_referral_rate",
          "referral_fee_usd_per_item",
          "fba_fee_usd_per_item",
          "calculator_dimensions_and_weight_if_visible",
        ],
        caution: "现有ASIN计算结果仅作为参考证据；若工具使用Amazon目录尺寸，不能冒充未来自有商品的最终包装费用。" as const,
      },
      {
        trackId: "first_mile_quote" as const,
        priority: 2 as const,
        requestedFields: ["firstMile", "logisticsEvidenceUrl"] as const,
        manualAction: "把预填报价文字发给货代，并返回包含数量、币种、路线、费用组成和有效期的脱敏截图。" as const,
        prefilledInputs: {
          packageLengthCm: lengthCm as number,
          packageWidthCm: widthCm as number,
          packageHeightCm: heightCm as number,
          packageWeightKg: weightKg as number,
          quoteQuantityUnits: null,
        },
        returnEvidence: [
          "quoted_quantity_units",
          "route_and_transport_mode",
          "total_quote_and_currency",
          "included_and_excluded_charges",
          "quote_valid_until",
          "redacted_quote_screenshot_or_public_url",
        ],
        caution: "数量或费用组成不明确时不得换算单件头程；页面国内运费不能代替美国头程。" as const,
      },
    ],
    remainingLaterFields: [
      "supplierCapturedAt",
      "packaging",
      "storage",
      "returnReserve",
      "complianceEvidenceUrl",
    ],
    boundary: {
      doesNotCalculateAmazonFees: true as const,
      doesNotCalculateFreight: true as const,
      doesNotCalculateProfit: true as const,
      doesNotMutateSubmission: true as const,
      doesNotCreateCandidate: true as const,
      doesNotWriteDatabase: true as const,
      externalWebsiteAccessed: false as const,
      externalAiCalled: false as const,
    },
  };
  return { ...body, handoffHash: stableHash(body) };
}

export function generateStage2NextEvidenceHandoff(
  input: Stage2NextEvidenceHandoffInput & { outputDirectory: string },
) {
  const handoff = buildStage2NextEvidenceHandoff(input);
  const files = [
    "stage2-next-evidence-handoff.v1.json",
    "README-醒来后只做这两步.md",
    "README-给货代复制这段话.md",
  ];
  const readme = `# 醒来后只做这两步

你不需要计算，也不需要判断利润。把结果截图发回来即可。

## 第一步：Amazon官方费用结果

1. 打开 Amazon 官方 Revenue Calculator 或官方费用工具。
2. 查询 ASIN：\`${handoff.target.asin}\`。
3. 售价先填：\`${handoff.knownInputs.salePriceUsd} USD\`。
4. 截图必须能看见：收费类目或推荐费率、单件Referral fee、单件FBA fee；若页面显示尺寸重量，也一起保留。
5. 不要发送账号、Cookie、Token、密码或完整浏览器资料。

注意：这个ASIN的费用结果只是参考证据，不自动等于未来自有商品的最终费用。

## 第二步：问一次货代

已确认工作参数：\`${handoff.knownInputs.packageMetric.lengthCm} × ${handoff.knownInputs.packageMetric.widthCm} × ${handoff.knownInputs.packageMetric.heightCm} cm\`，\`${handoff.knownInputs.packageMetric.weightKg} kg/件\`。

打开同目录的“给货代复制这段话”，只需自己填写计划询价数量，然后把货代完整报价截图发回来。数量、总价或费用组成缺一项时，系统不会强行换算。

## 暂时不用做

包装耗材、仓储、退货准备金和合规证据先继续留空；系统仍保持 profit_insufficient_evidence。
`;
  const freight = `# 给货代复制这段话

你好，我想询一款产品发往美国 Amazon 仓的头程价格。

- 商品：六层悬挂式衣柜收纳架
- 单件折叠包装：31 × 31 × 3.5 cm
- 单件重量：0.58 kg
- 计划询价数量：[请填写数量] 件

请帮我明确回复：

1. 运输方式和起运地／目的地；
2. 计费重量；
3. 总费用及币种；
4. 是否包含清关、关税、派送和其他附加费；
5. 报价有效期；
6. 如果可以，请同时给出每件折算费用，但仍保留总数量和总费用。

谢谢。
`;
  const artifactWrite = writeArtifactsIdempotently(resolve(input.outputDirectory), [
    { relativePath: files[0], content: `${JSON.stringify(handoff, null, 2)}\n` },
    { relativePath: files[1], content: readme },
    { relativePath: files[2], content: freight },
  ], "STAGE2_NEXT_EVIDENCE_HANDOFF_OUTPUT_CONFLICT");
  return { handoff, files, artifactWrite };
}
