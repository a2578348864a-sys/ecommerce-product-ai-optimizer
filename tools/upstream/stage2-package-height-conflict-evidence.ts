import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import type { Stage2EvidenceSubmission } from "./stage2-evidence-intake";

type RemainingEvidenceRequest = {
  schemaVersion: string;
  status: string;
  sourceValidationHash: string;
  target: { sampleId: string; productKey: string; acceptedProvisionalBomUsd: number };
  missingFields: string[];
  requestHash: string;
  [key: string]: unknown;
};

export type Stage2PackageHeightConflictInput = {
  request: RemainingEvidenceRequest;
  submission: Stage2EvidenceSubmission;
  receivedAt: string;
  sourceImageSha256: string;
  tableVariantText: string;
  currentSelectorText: string;
  packageLengthCm: number;
  packageWidthCm: number;
  packageHeightCm: number;
  packageVolumeCm3: number;
  packageWeightKg: number;
  existingObservedHeightsCm: number[];
};

function validIso(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function validPositive(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function buildStage2PackageHeightConflictEvidence(input: Stage2PackageHeightConflictInput) {
  const { requestHash, ...requestBody } = input.request;
  const target = input.submission.samples.find((sample) => sample.sampleId === input.request.target.sampleId);
  if (stableHash(requestBody) !== requestHash
    || input.request.schemaVersion !== "stage2-remaining-evidence-request.v1"
    || input.request.status !== "pending_user_evidence"
    || !input.request.missingFields.includes("packageHeightCm")
    || !target
    || target.productKey !== input.request.target.productKey
    || target.fields.packageHeightCm.value !== null
    || target.fields.packageHeightCm.missingReason !== "conflicting_page_values_3_5_vs_3_8") {
    throw new Error("STAGE2_PACKAGE_HEIGHT_EVIDENCE_SOURCE_INVALID");
  }
  const numericValues = [
    input.packageLengthCm,
    input.packageWidthCm,
    input.packageHeightCm,
    input.packageVolumeCm3,
    input.packageWeightKg,
  ];
  if (!validIso(input.receivedAt)
    || !/^[a-f0-9]{64}$/.test(input.sourceImageSha256)
    || input.tableVariantText !== "灰色六层"
    || input.currentSelectorText !== "米色六层"
    || numericValues.some((value) => !validPositive(value))
    || input.packageLengthCm !== 31
    || input.packageWidthCm !== 31
    || input.packageHeightCm !== 3.5
    || input.packageVolumeCm3 !== 3363.5
    || input.packageWeightKg !== 0.58
    || input.existingObservedHeightsCm.length !== 2
    || input.existingObservedHeightsCm[0] !== 3.5
    || input.existingObservedHeightsCm[1] !== 3.8) {
    throw new Error("STAGE2_PACKAGE_HEIGHT_EVIDENCE_OBSERVATION_INVALID");
  }
  const supplierUrl = target.fields.supplierUrl.value;
  if (typeof supplierUrl !== "string" || !supplierUrl.startsWith("https://detail.1688.com/offer/")) {
    throw new Error("STAGE2_PACKAGE_HEIGHT_EVIDENCE_SUPPLIER_INVALID");
  }

  const reasonCodes = [
    "structured_table_supports_3_5",
    "earlier_product_image_supports_3_8",
    "current_selector_is_beige_six_layer",
    "supplier_confirmation_absent",
  ] as const;
  const body = {
    schemaVersion: "stage2-package-height-conflict-evidence.v1" as const,
    evidenceId: `stage2-package-height-conflict-${stableHash({ requestHash, imageHash: input.sourceImageSha256 }).slice(0, 24)}`,
    status: "valid_counterevidence_not_applied" as const,
    receivedAt: input.receivedAt,
    sourceCapturedAt: null,
    sourceCapturedAtMissingReason: "exact_screenshot_capture_time_not_available",
    sourcePageUrl: supplierUrl,
    sourcePageUrlBasis: "bound_from_existing_submission_not_visible_in_new_screenshot" as const,
    sourceImage: {
      sha256: input.sourceImageSha256,
      copiedIntoProject: false as const,
      fullImagePathStored: false as const,
    },
    sourceRequestHash: requestHash,
    sourceValidationHash: input.request.sourceValidationHash,
    sourceSubmissionHash: stableHash(input.submission),
    target: {
      sampleId: target.sampleId,
      productKey: target.productKey,
      supplierUrl,
    },
    observation: {
      tableSection: "商品件重尺",
      tableVariantText: input.tableVariantText,
      currentSelectorText: input.currentSelectorText,
      packageLengthCm: input.packageLengthCm,
      packageWidthCm: input.packageWidthCm,
      packageHeightCm: input.packageHeightCm,
      packageVolumeCm3: input.packageVolumeCm3,
      packageWeightKg: input.packageWeightKg,
      priceRevalidatedForGreySixLayer: false as const,
    },
    conflictAssessment: {
      existingObservedHeightsCm: [...input.existingObservedHeightsCm],
      newStructuredTableValueCm: input.packageHeightCm,
      status: "conflict_confirmed_not_resolved" as const,
      packageHeightCmApplied: null,
      nextRequiredEvidence: "supplier_variant_specific_confirmation_or_current_packaging_document" as const,
    },
    reasonCodes: [...reasonCodes],
    boundary: {
      screenshotCopied: false as const,
      fullHtmlStored: false as const,
      privateSessionDataStored: false as const,
      submissionMutated: false as const,
      fbaCalculationAllowed: false as const,
      databaseWritten: false as const,
      candidateCreated: false as const,
    },
  };
  return { ...body, evidenceHash: stableHash(body) };
}

export function generateStage2PackageHeightConflictEvidence(
  input: Stage2PackageHeightConflictInput & { outputDirectory: string },
) {
  const evidence = buildStage2PackageHeightConflictEvidence(input);
  const files = ["stage2-package-height-conflict-evidence.v1.json", "README-包装高度仍冲突.md"];
  const readme = `# 包装高度证据结果

- 新截图中的结构化“商品件重尺”表明确显示：灰色六层 = 31 × 31 × 3.50 cm，580 g。
- 右侧当前选中项是“米色六层”，所以本截图不重新确认灰色六层价格。
- 既有商品详情图片仍写六层包装高度 3.8 cm；两项来源尚未由供应商确认哪一个是当前准确包装高度。
- 结论保持 fail-closed：packageHeightCm 继续为 null，FBA 不允许计算，原 submission 不修改。
- 下一步只需要供应商针对灰色六层明确回复包装高度，或提供当前变体级包装文件。
`;
  const artifactWrite = writeArtifactsIdempotently(resolve(input.outputDirectory), [
    { relativePath: files[0], content: `${JSON.stringify(evidence, null, 2)}\n` },
    { relativePath: files[1], content: readme },
  ], "STAGE2_PACKAGE_HEIGHT_EVIDENCE_OUTPUT_CONFLICT");
  return { evidence, files, artifactWrite };
}
