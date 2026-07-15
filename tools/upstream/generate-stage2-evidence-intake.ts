import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  STAGE2_OBJECTIVE_EVIDENCE_FIELDS,
  buildStage2CalibrationFromSubmission,
  buildStage2EvidenceSubmissionTemplate,
  validateStage2EvidenceSubmission,
  type Stage2EvidenceFieldName,
  type Stage2EvidenceGapInventory,
  type Stage2EvidenceSubmission,
} from "./stage2-evidence-intake";
import { writeArtifactsIdempotently } from "./artifact-writer";

type GeneratorInput = {
  inventoryFile: string;
  outputDirectory: string;
  createdAt: string;
};

function jsonContent(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readInventory(path: string): Stage2EvidenceGapInventory {
  const value = JSON.parse(readFileSync(resolve(path), "utf8")) as Stage2EvidenceGapInventory;
  if (value.schemaVersion !== "solo-stage2-evidence-gap-inventory.v1"
    || typeof value.packetHash !== "string"
    || !Array.isArray(value.samples)) {
    throw new Error("STAGE2_GAP_INVENTORY_INVALID");
  }
  return value;
}

function syntheticValue(field: Stage2EvidenceFieldName): string | number {
  const values: Record<Stage2EvidenceFieldName, string | number> = {
    supplierUrl: "https://fixture.invalid/supplier/variant-a",
    supplierCapturedAt: "2026-07-14T12:00:00.000Z",
    moq: 100,
    bom: 4.25,
    packageLengthCm: 30,
    packageWidthCm: 20,
    packageHeightCm: 8,
    packageWeightKg: 0.9,
    firstMile: 1.8,
    logisticsEvidenceUrl: "https://fixture.invalid/logistics/quote-a",
    platformCommission: 2.4,
    fba: 3.2,
    packaging: 0.4,
    storage: 0.25,
    returnReserve: 0.8,
    complianceEvidenceUrl: "https://fixture.invalid/compliance/rule-a",
    executionRiskNotes: "仅用于离线测试计算路径；不是供应链、物流、合规或质量事实。",
  };
  return values[field];
}

function buildSyntheticFixture(template: Stage2EvidenceSubmission, createdAt: string): Stage2EvidenceSubmission {
  const submission = structuredClone(template);
  submission.submissionId = "stage2-synthetic-fixture-01";
  submission.submittedBy = "offline_synthetic_fixture_generator";
  submission.evidenceMode = "synthetic_fixture";
  for (const sample of submission.samples) {
    sample.variantIdentity = {
      status: "confirmed",
      amazonVariant: "synthetic-variant-a",
      supplierVariant: "synthetic-variant-a",
      confirmedAt: createdAt,
      evidence: {
        sourceType: "manual",
        sourceUrl: "https://fixture.invalid/variant-match/variant-a",
        capturedAt: createdAt,
        note: "仅用于离线测试的合成同变体确认。",
        inputHash: null,
      },
    };
    for (const field of STAGE2_OBJECTIVE_EVIDENCE_FIELDS) {
      sample.fields[field] = {
        value: syntheticValue(field),
        missingReason: null,
        evidence: {
          sourceType: "direct_observation",
          sourceUrl: `https://fixture.invalid/evidence/${field}`,
          capturedAt: createdAt,
          note: `仅用于离线测试的合成来源：${field}`,
          inputHash: null,
        },
      };
    }
  }
  return submission;
}

function buildReadme(sampleCount: number) {
  return `# Stage 2 客观证据录入\n\n`
    + `本目录把“还缺什么”推进到“怎样安全录入和校验”，不代表已经获得真实商业证据。\n\n`
    + `## 真实空白模板\n\n`
    + `- 样本数：${sampleCount}\n`
    + `- 所有待取证值保持 null，missingReason=not_collected。\n`
    + `- 不要手填人工继续／停止结论；人工决定属于后续独立契约。\n`
    + `- 每个非空值都必须同时补来源类型、时间、来源 URL 或人工说明。\n`
    + `- 不知道就保持 null，不得从 Amazon 售价、评分、评论、图片或 AI 文案估算。\n\n`
    + `## synthetic-fixture\n\n`
    + `该子目录只证明校验和利润计算代码能运行。所有 URL 使用 fixture.invalid，所有数值都是合成测试值，严禁作为选品、采购、利润或合规结论。\n`;
}

export function generateStage2EvidenceIntakeArtifacts(input: GeneratorInput) {
  const inventory = readInventory(input.inventoryFile);
  const output = resolve(input.outputDirectory);

  const template = buildStage2EvidenceSubmissionTemplate(inventory, {
    submissionId: "stage2-real-evidence-template-01",
    createdAt: input.createdAt,
    submittedBy: "pending_manual_evidence_collection",
    evidenceMode: "real_evidence",
  });
  const incompleteValidation = validateStage2EvidenceSubmission(inventory, template);
  const incompleteCalibration = buildStage2CalibrationFromSubmission(inventory, template);
  const syntheticSubmission = buildSyntheticFixture(template, input.createdAt);
  const syntheticValidation = validateStage2EvidenceSubmission(inventory, syntheticSubmission);
  const syntheticCalibration = buildStage2CalibrationFromSubmission(inventory, syntheticSubmission);

  const files = [
    "stage2-evidence-submission.template.v1.json",
    "stage2-evidence-validation.incomplete.v1.json",
    "stage2-calibration-run.incomplete.v1.json",
    "README-Stage2证据录入说明.md",
    "synthetic-fixture/stage2-evidence-submission.synthetic.v1.json",
    "synthetic-fixture/stage2-evidence-validation.synthetic.v1.json",
    "synthetic-fixture/stage2-calibration-run.synthetic.v1.json",
    "generation-summary.stage2-intake.v1.json",
  ];

  const summaryBody = {
    schemaVersion: "stage2-evidence-intake-generation-summary.v1" as const,
    sourceGapInventoryHash: inventory.packetHash,
    realEvidence: {
      status: incompleteValidation.status,
      sampleCount: template.samples.length,
      readyForCalibrationCount: incompleteValidation.summary.readyForCalibrationCount,
    },
    syntheticFixture: {
      status: syntheticCalibration.status,
      sampleCount: syntheticCalibration.samples.length,
      businessValidationProven: syntheticCalibration.boundary.businessValidationProven,
    },
    boundary: {
      sourceInventoryModified: false,
      realEvidenceCollected: false,
      humanDecisionRecorded: false,
      candidateCreated: false,
      databaseWritten: false,
      externalWebsiteAccessed: false,
      externalAiApiCalled: false,
      stage1RankingModified: false,
    },
    files,
  };
  const artifactWrite = writeArtifactsIdempotently(output, [
    { relativePath: files[0], content: jsonContent(template) },
    { relativePath: files[1], content: jsonContent(incompleteValidation) },
    { relativePath: files[2], content: jsonContent(incompleteCalibration) },
    { relativePath: files[3], content: buildReadme(template.samples.length) },
    { relativePath: files[4], content: jsonContent(syntheticSubmission) },
    { relativePath: files[5], content: jsonContent(syntheticValidation) },
    { relativePath: files[6], content: jsonContent(syntheticCalibration) },
    { relativePath: files[7], content: jsonContent({ ...summaryBody, evidenceHash: stableHash(summaryBody) }) },
  ], "STAGE2_EVIDENCE_INTAKE_OUTPUT_CONFLICT");

  return {
    outputDirectory: output,
    files,
    artifactWrite,
    realEvidence: {
      status: incompleteValidation.status,
      sampleCount: template.samples.length,
    },
    syntheticFixture: {
      status: syntheticCalibration.status,
      sampleCount: syntheticCalibration.samples.length,
      businessValidationProven: syntheticCalibration.boundary.businessValidationProven,
    },
  };
}
