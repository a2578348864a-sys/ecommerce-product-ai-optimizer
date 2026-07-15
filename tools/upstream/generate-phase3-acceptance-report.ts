import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently, type VersionedArtifact } from "./artifact-writer";
import { buildPhase3AcceptanceReport } from "./phase3-acceptance";

type GenerateInput = {
  stage1SummaryFile: string;
  responsesFile: string;
  comparisonFile: string;
  candidatePreviewFile: string;
  outputDirectory: string;
  evaluatedAt: string;
};

function readJsonFile(path: string, errorCode: string) {
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

function jsonContent(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function generatePhase3AcceptanceReport(input: GenerateInput) {
  const stage1 = readJsonFile(input.stage1SummaryFile, "PHASE3_STAGE1_JSON_INVALID");
  const responses = readJsonFile(input.responsesFile, "PHASE3_RESPONSES_JSON_INVALID");
  const comparison = readJsonFile(input.comparisonFile, "PHASE3_COMPARISON_JSON_INVALID");
  const preview = readJsonFile(input.candidatePreviewFile, "PHASE3_PREVIEW_JSON_INVALID");
  const report = buildPhase3AcceptanceReport({
    stage1Summary: stage1.value,
    responses: responses.value,
    responsesFileSha256: responses.sha256,
    comparison: comparison.value,
    candidatePreview: preview.value,
    evaluatedAt: input.evaluatedAt,
  });
  const files = [
    "phase3-acceptance-report.v1.json",
    "generation-summary.phase3-acceptance.v1.json",
    "README-Phase3验收边界.md",
  ];
  const summaryBody = {
    schemaVersion: "phase3-acceptance-generation-summary.v1",
    status: report.status,
    evaluatedAt: report.evaluatedAt,
    sourceFiles: [stage1, responses, comparison, preview].map(({ name, sha256 }) => ({ name, sha256 })),
    reportEvidenceHash: report.evidenceHash,
    validationConclusion: report.validationConclusion,
    formalCandidateGenerated: false,
    productionDatabaseWritten: false,
    externalWebsiteAccessed: false,
    aiCalled: false,
    files,
  } as const;
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const guide = `# Phase 3 验收边界\n\n`
    + `- 结果：\`${report.status}\`。\n`
    + `- 结论：\`${report.validationConclusion}\`。\n`
    + `- 20条真人回答来自没有 Amazon 运营经验的项目所有者，不是运营专家评审。\n`
    + `- Stage 1 从20条减少4条，只证明有限范围缩减；没有证明商品价值、销量、利润、合规或供应链可行。\n`
    + `- 正式 Candidate 继续为0，保持预览模式；没有调用 API、写数据库或调用 AI。\n`;
  const artifacts: VersionedArtifact[] = [
    { relativePath: files[0], content: jsonContent(report) },
    { relativePath: files[1], content: jsonContent(summary) },
    { relativePath: files[2], content: guide },
  ];
  const artifactWrite = writeArtifactsIdempotently(
    input.outputDirectory,
    artifacts,
    "PHASE3_ACCEPTANCE_OUTPUT_CONFLICT",
  );
  return { status: report.status, files, report, summary, artifactWrite };
}
