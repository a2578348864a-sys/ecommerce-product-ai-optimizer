import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently, type VersionedArtifact } from "./artifact-writer";
import { buildPhase2AcceptanceReportFromHumanAssistedRun } from "./phase2-acceptance";

type GenerateInput = {
  sourceFile: string;
  outputDirectory: string;
  evaluatedAt: string;
};

function jsonContent(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fileSha256(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

export function generatePhase2AcceptanceReport(input: GenerateInput) {
  const sourcePath = resolve(input.sourceFile);
  const sourceBytes = readFileSync(sourcePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceBytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("PHASE2_ACCEPTANCE_SOURCE_JSON_INVALID");
  }
  const report = buildPhase2AcceptanceReportFromHumanAssistedRun(parsed, input.evaluatedAt);
  const files = [
    "phase2-acceptance-report.v1.json",
    "generation-summary.phase2-acceptance.v1.json",
    "README-Phase2验收边界.md",
  ];
  const summaryBody = {
    schemaVersion: "phase2-acceptance-generation-summary.v1",
    status: report.status,
    evaluatedAt: report.evaluatedAt,
    sourceFileName: basename(sourcePath),
    sourceFileSha256: fileSha256(sourceBytes),
    sourceEvidenceHash: report.sourceEvidenceHash,
    reportEvidenceHash: report.evidenceHash,
    proofLevel: report.proofLevel,
    formalCandidateGenerated: false,
    productionDatabaseWritten: false,
    externalWebsiteAccessed: false,
    files,
  } as const;
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const guide = `# Phase 2 验收边界\n\n`
    + `- 结果：\`${report.status}\`。\n`
    + `- 证明级别：\`${report.proofLevel}\`。\n`
    + `- 本报告使用已保存的 Canary 15 本地 JSON 重建身份、Evidence、Quality Gate 与导入预览；没有重新访问 Amazon。\n`
    + `- 通过只表示 Phase 2 的纯函数、Fixture、真实来源包重放和内存边界满足当前门禁。\n`
    + `- 不证明 API 接入、数据库事务、数据库并发、Owner/Visitor 鉴权或 ID 猜测防护。\n`
    + `- 没有创建正式 Candidate，没有写数据库，没有调用 AI。\n`;
  const artifacts: VersionedArtifact[] = [
    { relativePath: files[0], content: jsonContent(report) },
    { relativePath: files[1], content: jsonContent(summary) },
    { relativePath: files[2], content: guide },
  ];
  const artifactWrite = writeArtifactsIdempotently(
    input.outputDirectory,
    artifacts,
    "PHASE2_ACCEPTANCE_OUTPUT_CONFLICT",
  );
  return { status: report.status, files, report, summary, artifactWrite };
}
