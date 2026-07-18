import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently, type VersionedArtifact } from "./artifact-writer";
import { buildStage15EffectivenessHumanEvaluation } from "./stage15-effectiveness-human-evaluation";

type GenerateInput = {
  briefFile: string;
  runFile: string;
  outputDirectory: string;
  createdAt: string;
};

function readJson(path: string, errorCode: string) {
  const resolved = resolve(path);
  const bytes = readFileSync(resolved);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(errorCode);
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

type HumanEvaluationFormField = {
  value: unknown;
  missingReason: string | null;
};

type HumanEvaluationFormPacket = {
  items: Array<{
    evaluationItemId: string;
    evidence: {
      title: HumanEvaluationFormField;
      variantText: HumanEvaluationFormField;
      dimensionsAndWeight: HumanEvaluationFormField;
      materialAndConstruction: HumanEvaluationFormField;
      assemblyUsageAndRiskFacts: HumanEvaluationFormField;
      featureBullets: HumanEvaluationFormField;
      reviewSnippets: HumanEvaluationFormField;
    };
  }>;
};

function safeText(value: unknown) {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return (raw ?? "missing").replace(/\r?\n/g, " ").replace(/[\\`*_[\]<>#]/g, "\\$&");
}

function renderField(label: string, field: HumanEvaluationFormField) {
  const values = Array.isArray(field.value) ? field.value : field.value === null ? [] : [field.value];
  if (values.length === 0) return `- ${label}: missing (${safeText(field.missingReason ?? "not_observed")})`;
  if (values.length === 1) return `- ${label}: ${safeText(values[0])}`;
  return `- ${label}:\n${values.map((value) => `  - ${safeText(value)}`).join("\n")}`;
}

export function renderStage15EffectivenessHumanEvaluationForm(packet: HumanEvaluationFormPacket) {
  const sections = packet.items.map((item, index) => [
    `## Item ${index + 1}`,
    "",
    `Evaluation ID: \`${safeText(item.evaluationItemId)}\``,
    "",
    renderField("Title", item.evidence.title),
    renderField("Variant", item.evidence.variantText),
    renderField("Dimensions and weight", item.evidence.dimensionsAndWeight),
    renderField("Material and construction", item.evidence.materialAndConstruction),
    renderField("Assembly, usage, and risk facts", item.evidence.assemblyUsageAndRiskFacts),
    renderField("Feature bullets", item.evidence.featureBullets),
    renderField("Independent review counter-evidence", item.evidence.reviewSnippets),
    "",
    "- worthFurtherInvestigation:",
    "- evidenceSufficient:",
    "- obviousStopReason:",
    "- confidence:",
    "- reason:",
  ].join("\n"));
  return `# Stage 1.5 A Human Evaluation Form\n\n${sections.join("\n\n")}\n`;
}


export function generateStage15EffectivenessHumanEvaluation(input: GenerateInput) {
  const brief = readJson(input.briefFile, "STAGE15_HUMAN_EVALUATION_BRIEF_JSON_INVALID");
  const run = readJson(input.runFile, "STAGE15_HUMAN_EVALUATION_RUN_JSON_INVALID");
  const built = buildStage15EffectivenessHumanEvaluation({
    brief: brief.value as Record<string, unknown>,
    run: run.value as Record<string, unknown>,
  });
  const files = [
    "stage15-effectiveness-human-evaluation-packet.v1.json",
    "stage15-effectiveness-human-evaluation-result-template.v1.json",
    "generation-summary.stage15-effectiveness-human-evaluation.v1.json",
    "README-human-evaluation-instructions.md",
    "human-evaluation-form.md",
  ];
  const summaryBody = {
    schemaVersion: "stage15-effectiveness-human-evaluation-generation-summary.v1",
    createdAt: input.createdAt,
    sourceFiles: [brief, run].map(({ name, sha256 }) => ({ name, sha256 })),
    sourceBriefHash: built.packet.sourceBriefHash,
    sourceRunEvidenceHash: built.packet.sourceRunEvidenceHash,
    packetHash: built.packet.packetHash,
    resultTemplateHash: built.resultTemplate.evidenceHash,
    status: "pending_human_evaluation",
    itemCount: built.packet.items.length,
    evidenceCoverage: built.packet.evidenceCoverage,
    reviewerBoundary: built.packet.reviewerBoundary,
    sourceRunWebsiteAccessVerified: true,
    externalWebsiteAccessedDuringGeneration: false,
    externalAiOrPaidApiCalled: false,
    databaseWritten: false,
    stage1OrStage15Mutated: false,
    stage2FieldsConsumed: false,
    candidateGenerated: false,
    outcomeAutoDecisionGenerated: false,
    effectivenessConclusion: "screening_effectiveness_not_validated",
    files,
  } as const;
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const readme = `# Stage 1.5 A blinded human evaluation\n\n`
    + `Status: \`pending_human_evaluation\`. This packet does not prove screening effectiveness.\n\n`
    + `## Complete each item\n\n`
    + `1. Set \`worthFurtherInvestigation\` to \`yes\`, \`no\`, or \`insufficient_evidence\`.\n`
    + `2. Set \`evidenceSufficient\` to \`yes\` or \`no\`.\n`
    + `3. Fill \`obviousStopReason\` only when the shown evidence supports one; otherwise keep \`null\`.\n`
    + `4. Set \`confidence\` to \`high\`, \`medium\`, or \`low\`.\n`
    + `5. Write one evidence-based sentence in \`reason\`; do not infer missing facts.\n\n`
    + `## Boundaries\n\n`
    + `- Review only the evidence shown in the packet. Do not recover group, rank, ASIN, URL, locked answers, or Stage 2 fields.\n`
    + `- All ten items lack independent review counter-evidence. Structured size/weight, material/construction, and execution-risk evidence are also missing.\n`
    + `- \`insufficient_evidence\` is an expected and valid answer.\n`
    + `- Do not access external websites or AI to complete answers.\n`
    + `- Do not auto-generate an Outcome, mutate Stage 1/1.5, create Candidate/Task records, or write a database.\n`
    + `- A completed packet still does not prove commercial viability, profitability, or professional Stage 2 validation.\n`;
  const artifacts: VersionedArtifact[] = [
    { relativePath: files[4], content: renderStage15EffectivenessHumanEvaluationForm(built.packet) },
    { relativePath: files[0], content: json(built.packet) },
    { relativePath: files[1], content: json(built.resultTemplate) },
    { relativePath: files[2], content: json(summary) },
    { relativePath: files[3], content: readme },
  ];
  const artifactWrite = writeArtifactsIdempotently(
    input.outputDirectory,
    artifacts,
    "STAGE15_HUMAN_EVALUATION_OUTPUT_CONFLICT",
  );
  return { ...built, summary, files, artifactWrite };
}
