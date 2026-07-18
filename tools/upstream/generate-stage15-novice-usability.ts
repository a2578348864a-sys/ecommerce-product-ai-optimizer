import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently, type VersionedArtifact } from "./artifact-writer";
import type { NoviceMarketScreeningRun } from "./novice-market-screening";
import { buildStage15NoviceUsabilityMaterials } from "./stage15-novice-usability";

type GenerateInput = {
  screeningRunFile: string;
  outputDirectory: string;
  createdAt: string;
};

function readJson(path: string) {
  const resolved = resolve(path);
  const bytes = readFileSync(resolved);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("STAGE15_USABILITY_SCREENING_JSON_INVALID");
  }
  return {
    name: basename(resolved),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    value,
  };
}

function json(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function generateStage15NoviceUsability(input: GenerateInput) {
  const source = readJson(input.screeningRunFile);
  const materials = buildStage15NoviceUsabilityMaterials(
    source.value as NoviceMarketScreeningRun,
    input.createdAt,
  );
  const files = [
    "stage15-novice-usability-protocol.v1.json",
    "stage15-novice-usability-worksheet.v1.json",
    "stage15-novice-usability-result-template.v1.json",
    "generation-summary.stage15-novice-usability.v1.json",
    "README-新手理解验收说明.md",
  ];
  const summaryBody = {
    schemaVersion: "stage15-novice-usability-generation-summary.v1",
    createdAt: input.createdAt,
    sourceFile: { name: source.name, sha256: source.sha256 },
    sourceScreeningHash: materials.protocol.sourceScreeningHash,
    protocolHash: materials.protocol.protocolHash,
    worksheetHash: materials.worksheet.worksheetHash,
    resultTemplateHash: materials.resultTemplate.resultHash,
    status: "engineering_ready_pending_real_user_session",
    expectedAdvanceCount: 5,
    manualUserInputObserved: false,
    usabilityConclusion: "novice_usability_not_executed",
    timeSavingConclusion: "not_validated_without_comparable_baseline",
    effectivenessConclusion: "screening_effectiveness_not_validated",
    stage2FieldsConsumed: false,
    externalWebsiteAccessed: false,
    externalAiApiCalled: false,
    formalCandidateGenerated: false,
    productionDatabaseWritten: false,
    files,
  } as const;
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const readme = `# Stage 1.5 新手理解与可操作性验收\n\n`
    + `1. 打开本地 http://127.0.0.1:3005/opportunities/screening-preview。\n`
    + `2. 不打开 protocol JSON；只按页面完成 worksheet 中的任务。\n`
    + `3. 找出5个优先调查项，并为每条写主要原因、下一步验证和停止条件。\n`
    + `4. 回答advance含义和是否能区分四态，记录真实耗时与是否被中断。\n\n`
    + `当前worksheet为空，程序没有代填用户答案。耗时只做描述，不证明省时；本材料不能验证筛选正确、盈利或商业可行。\n`;
  const artifacts: VersionedArtifact[] = [
    { relativePath: files[0], content: json(materials.protocol) },
    { relativePath: files[1], content: json(materials.worksheet) },
    { relativePath: files[2], content: json(materials.resultTemplate) },
    { relativePath: files[3], content: json(summary) },
    { relativePath: files[4], content: readme },
  ];
  const artifactWrite = writeArtifactsIdempotently(
    input.outputDirectory,
    artifacts,
    "STAGE15_USABILITY_OUTPUT_CONFLICT",
  );
  return { ...materials, summary, files, artifactWrite };
}
