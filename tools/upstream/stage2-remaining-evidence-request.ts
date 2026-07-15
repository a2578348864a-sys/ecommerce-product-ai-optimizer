import { stableHash } from "../../lib/upstream/pipeline";

type ApplicationResult = {
  schemaVersion: string;
  status: string;
  targetSampleId: string;
  appliedField: { field: string; value: number; currency?: string; unit: string; inputHash?: string };
  acceptedProvisionalBomUsd?: number;
  outputValidationHash: string;
  boundary: Record<string, unknown>;
  applicationHash: string;
  [key: string]: unknown;
};

type ValidationResult = {
  schemaVersion: string;
  status: string;
  evidenceHash: string;
  summary: { readyForCalibrationCount: number };
  samples: Array<{
    sampleId: string;
    productKey: string;
    status: string;
    missingFields: string[];
    calibration: { status: string };
  }>;
  [key: string]: unknown;
};

const GROUPS = [
  {
    groupId: "supplier_variant_confirmation",
    fields: ["supplierCapturedAt", "packageHeightCm"],
    beginnerInstruction: "请提供当前六层变体的供应商页面时间证据，以及能明确区分 3.5cm 与 3.8cm 的包装高度证据；不能凭图片猜。",
    acceptedEvidence: ["供应商当前页截图", "变体对应包装参数表", "供应商文字确认的脱敏截图"],
  },
  {
    groupId: "first_mile_quote",
    fields: ["firstMile", "logisticsEvidenceUrl"],
    beginnerInstruction: "请提供这一个变体从供应地到备货/仓库节点的单件头程报价及其公开或脱敏来源；只给总价但没有数量时不能换算。",
    acceptedEvidence: ["货代报价单脱敏截图", "公开物流报价页", "含数量和币种的人工报价记录"],
  },
  {
    groupId: "amazon_fee_confirmation",
    fields: ["platformCommission", "fba"],
    beginnerInstruction: "需要确认该商品实际 Amazon fee category，并用准确包装尺寸和重量匹配当前 FBA 费用；Home and Kitchen 展示费率不能直接当作本商品已确认费率。",
    acceptedEvidence: ["Amazon 官方费用页", "官方 Revenue Calculator 脱敏结果", "实际 fee category 与尺寸档位证据"],
  },
  {
    groupId: "operating_reserves_and_compliance",
    fields: ["packaging", "storage", "returnReserve", "complianceEvidenceUrl"],
    beginnerInstruction: "分别提供包装、仓储、退货准备金和合规依据；不知道就保持空，不要按经验随便填。",
    acceptedEvidence: ["包装报价", "仓储费表", "有计算依据的退货准备金", "官方合规规则页"],
  },
] as const;

function validIso(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

export function buildStage2RemainingEvidenceRequest(input: {
  application: ApplicationResult;
  validation: ValidationResult;
  createdAt: string;
}) {
  const { applicationHash, ...applicationBody } = input.application;
  const { evidenceHash, ...validationBody } = input.validation;
  const isBomApplication = input.application.status === "provisional_bom_applied_locally"
    && input.application.appliedField.field === "bom"
    && input.application.appliedField.currency === "USD";
  const isPackageHeightApplication = input.application.status === "package_height_manual_confirmation_applied_locally"
    && input.application.appliedField.field === "packageHeightCm"
    && input.application.appliedField.unit === "cm"
    && input.application.appliedField.value === 3.5
    && typeof input.application.acceptedProvisionalBomUsd === "number"
    && Number.isFinite(input.application.acceptedProvisionalBomUsd)
    && input.application.acceptedProvisionalBomUsd > 0;
  if (!validIso(input.createdAt)
    || stableHash(applicationBody) !== applicationHash
    || stableHash(validationBody) !== evidenceHash
    || input.application.outputValidationHash !== evidenceHash
    || (!isBomApplication && !isPackageHeightApplication)
    || input.validation.status !== "incomplete"
    || input.validation.summary.readyForCalibrationCount !== 0) {
    throw new Error("STAGE2_REMAINING_EVIDENCE_SOURCE_INVALID");
  }
  const target = input.validation.samples.find((sample) => sample.sampleId === input.application.targetSampleId);
  if (!target || target.status !== "incomplete" || target.calibration.status !== "profit_insufficient_evidence") {
    throw new Error("STAGE2_REMAINING_EVIDENCE_TARGET_INVALID");
  }
  const knownFields = GROUPS.flatMap((group) => [...group.fields]);
  if (target.missingFields.length === 0 || target.missingFields.some((field) => !knownFields.includes(field as never))) {
    throw new Error("STAGE2_REMAINING_EVIDENCE_FIELDS_INVALID");
  }
  const evidenceGroups = GROUPS.map((group) => {
    const fields = group.fields.filter((field) => target.missingFields.includes(field));
    const beginnerInstruction = group.groupId === "supplier_variant_confirmation"
      && !fields.includes("packageHeightCm")
      ? "请提供当前供应商页面或材料的可确认时间证据；包装高度3.5cm已由项目所有者作为人工工作值确认，但不冒充供应商确认。"
      : group.beginnerInstruction;
    return { ...group, beginnerInstruction, fields };
  }).filter((group) => group.fields.length > 0);
  const groupedFields = evidenceGroups.flatMap((group) => group.fields);
  if (groupedFields.length !== target.missingFields.length
    || groupedFields.some((field, index) => field !== target.missingFields[index])) {
    throw new Error("STAGE2_REMAINING_EVIDENCE_ORDER_INVALID");
  }

  const body = {
    schemaVersion: "stage2-remaining-evidence-request.v1" as const,
    requestId: `stage2-remaining-evidence-${stableHash({ applicationHash, evidenceHash, sampleId: target.sampleId }).slice(0, 24)}`,
    status: "pending_user_evidence" as const,
    createdAt: input.createdAt,
    sourceApplicationHash: applicationHash,
    sourceValidationHash: evidenceHash,
    target: {
      sampleId: target.sampleId,
      productKey: target.productKey,
      acceptedProvisionalBomUsd: isBomApplication
        ? input.application.appliedField.value
        : input.application.acceptedProvisionalBomUsd!,
    },
    missingFields: [...target.missingFields],
    evidenceGroups,
    hardRules: [
      "unknown_values_remain_null",
      "do_not_convert_total_quote_without_quantity",
      "do_not_use_unconfirmed_amazon_fee_category",
      ...(target.missingFields.includes("packageHeightCm")
        ? ["do_not_choose_conflicting_package_height_by_guess"]
        : []),
      "preserve_raw_evidence_before_derived_values",
    ],
    boundary: {
      unknownValuesRemainNull: true as const,
      profitMayNotBeCalculated: true as const,
      noDatabaseWrite: true as const,
      noCandidateCreation: true as const,
      noStage1Rewrite: true as const,
    },
  };
  return { ...body, requestHash: stableHash(body) };
}
