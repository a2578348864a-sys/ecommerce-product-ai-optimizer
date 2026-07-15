import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import type { PublicPageNavigationResult } from "../collectors/amazon/browser-control";
import { writeArtifactsIdempotently } from "./artifact-writer";
import { validateStage2AlternativeSourceBrief, type Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";
import type { MadeInChinaProbePageClassification } from "./stage2-alternative-source-probe";
import {
  buildMadeInChinaUnknownPageDiagnostic,
  type MadeInChinaUnknownPageDiagnosticDomSignals,
  type MadeInChinaUnknownPageDiagnosticStatus,
} from "./stage2-alternative-source-unknown-page-diagnostic";

type DiagnosticFixture = {
  schemaVersion: "stage2-alternative-source-unknown-page-diagnostic-fixtures.v1";
  baseNavigation: PublicPageNavigationResult;
  baseSignals: MadeInChinaUnknownPageDiagnosticDomSignals;
  scenarios: Array<{
    scenarioId: string;
    navigationPatch?: Partial<PublicPageNavigationResult>;
    signalsPatch?: Partial<MadeInChinaUnknownPageDiagnosticDomSignals>;
    parentClassification?: MadeInChinaProbePageClassification;
    expectedStatus: MadeInChinaUnknownPageDiagnosticStatus;
    expectedReasonCodes: string[];
  }>;
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(path), "utf8")) as T;
const jsonContent = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function handoff(scenarioCount: number): string {
  return `# Made-in-China unknown_page 离线诊断验收\n\n`
    + `本包使用真实诊断构建函数完成 ${scenarioCount} 个离线场景验证。未访问真实网站，未修改主页面分类选择器或通过阈值。\n\n`
    + `诊断层只在主分类已经是 unknown_page 时补充独立结构计数和安全路径样本；无论诊断结果为何，都保持 fail-closed，不允许采集。\n`;
}

function security(): string {
  return `# unknown_page 诊断安全边界\n\n`
    + `诊断仅保存计数、Origin、安全裁剪路径、限长标题、缺失原因和 Hash；不保存完整 HTML、页面正文、查询参数、Cookie、Token、表单或私人浏览器状态。\n\n`
    + `离线验证不能证明真实站点 DOM 已恢复，也不能追认历史探针成功。下一次真实探针仍需单独授权。\n`;
}

export function generateStage2AlternativeSourceUnknownPageDiagnosticOfflineEvidence(input: {
  briefFile: string;
  fixtureFile: string;
  outputDirectory: string;
  createdAt: string;
}) {
  if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("UNKNOWN_PAGE_DIAGNOSTIC_CREATED_AT_INVALID");
  const brief = readJson<Stage2AlternativeSourceBrief>(input.briefFile);
  if (validateStage2AlternativeSourceBrief(brief).status !== "valid_pending_authorization") {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_BRIEF_INVALID");
  }
  const fixture = readJson<DiagnosticFixture>(input.fixtureFile);
  if (fixture.schemaVersion !== "stage2-alternative-source-unknown-page-diagnostic-fixtures.v1") {
    throw new Error("UNKNOWN_PAGE_DIAGNOSTIC_FIXTURE_SCHEMA_INVALID");
  }

  const scenarioResults = fixture.scenarios.map((scenario) => {
    const parentPageInputHash = stableHash({
      scenarioId: scenario.scenarioId,
      navigation: { ...fixture.baseNavigation, ...scenario.navigationPatch },
    });
    const result = buildMadeInChinaUnknownPageDiagnostic({
      brief,
      navigation: { ...fixture.baseNavigation, ...scenario.navigationPatch },
      parentClassification: scenario.parentClassification ?? "unknown_page",
      parentPageInputHash,
      signals: { ...fixture.baseSignals, ...scenario.signalsPatch },
    });
    const passed = result.status === scenario.expectedStatus
      && scenario.expectedReasonCodes.every((reason) => result.reasonCodes.includes(reason));
    return {
      scenarioId: scenario.scenarioId,
      expectedStatus: scenario.expectedStatus,
      actualStatus: result.status,
      expectedReasonCodes: scenario.expectedReasonCodes,
      actualReasonCodes: result.reasonCodes,
      parentPageInputHash,
      diagnosticInputHash: result.inputHash,
      passed,
    };
  });
  const failedScenarioIds = scenarioResults.filter((result) => !result.passed)
    .map((result) => result.scenarioId);
  if (failedScenarioIds.length > 0) {
    throw new Error(`UNKNOWN_PAGE_DIAGNOSTIC_FIXTURE_VALIDATION_FAILED:${failedScenarioIds.join(",")}`);
  }
  const statusCounts = scenarioResults.reduce<Record<MadeInChinaUnknownPageDiagnosticStatus, number>>(
    (counts, result) => { counts[result.actualStatus] += 1; return counts; },
    {
      diagnostic_evidence_present: 0,
      diagnostic_evidence_absent: 0,
      diagnostic_evidence_insufficient: 0,
      diagnostic_context_blocked: 0,
      diagnostic_input_invalid: 0,
      not_applicable: 0,
    },
  );
  const fixtureHash = stableHash(fixture);
  const validationBody = {
    schemaVersion: "stage2-alternative-source-unknown-page-diagnostic-offline-validation.v1" as const,
    status: "offline_validation_passed" as const,
    proofLevel: "offline_fixture_only" as const,
    briefId: brief.briefId,
    briefHash: brief.briefHash,
    createdAt: input.createdAt,
    fixtureSchemaVersion: fixture.schemaVersion,
    fixtureHash,
    inputHash: stableHash({ briefHash: brief.briefHash, fixtureHash, createdAt: input.createdAt }),
    scenarioCount: scenarioResults.length,
    statusCounts,
    failedScenarioIds,
    scenarioResults,
    diagnosticWiredIntoFutureProbeRunV3: true as const,
    selectorOrThresholdChanged: false as const,
    failClosedPreserved: true as const,
    realWebsiteAccessed: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
    externalAiOrPaidApiCalled: false as const,
  };
  const validation = { ...validationBody, evidenceHash: stableHash(validationBody) };
  const files = [
    "stage2-alternative-source-unknown-page-diagnostic-offline-validation.v1.json",
    "generation-summary.stage2-alternative-source-unknown-page-diagnostic-offline.v1.json",
    "01-离线诊断验收说明.md",
    "02-安全边界审计.md",
  ];
  const summaryBody = {
    schemaVersion: "stage2-alternative-source-unknown-page-diagnostic-offline-summary.v1" as const,
    status: validation.status,
    proofLevel: validation.proofLevel,
    validationEvidenceHash: validation.evidenceHash,
    realWebsiteAccessed: false as const,
    files,
  };
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const artifactWrite = writeArtifactsIdempotently(input.outputDirectory, [
    { relativePath: files[0], content: jsonContent(validation) },
    { relativePath: files[1], content: jsonContent(summary) },
    { relativePath: files[2], content: handoff(scenarioResults.length) },
    { relativePath: files[3], content: security() },
  ], "UNKNOWN_PAGE_DIAGNOSTIC_OFFLINE_OUTPUT_CONFLICT");
  return { validation, summary, artifactWrite };
}
