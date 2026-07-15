import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import type { PublicPageNavigationResult } from "../collectors/amazon/browser-control";
import { writeArtifactsIdempotently } from "./artifact-writer";
import type { Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";
import { validateStage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";
import {
  buildStage2AlternativeSourcePolicyPreflight,
  classifyMadeInChinaProbePage,
  validateMadeInChinaProbeUrl,
  type MadeInChinaProbeDomSignals,
  type MadeInChinaProbePageClassification,
  type Stage2AlternativeSourcePolicyPreflight,
} from "./stage2-alternative-source-probe";

type Stage2AlternativeSourceProbeFixture = {
  schemaVersion: "stage2-alternative-source-probe-fixtures.v1";
  baseNavigation: PublicPageNavigationResult;
  baseSignals: MadeInChinaProbeDomSignals;
  pageScenarios: Array<{
    scenarioId: string;
    navigationPatch?: Partial<PublicPageNavigationResult>;
    signalsPatch?: Partial<MadeInChinaProbeDomSignals>;
    expectedClassification: MadeInChinaProbePageClassification;
    expectedReasonCodes: string[];
  }>;
  urlScenarios: Array<{
    scenarioId: string;
    kind: "search" | "product";
    url: string;
    expectedAllowed: boolean;
    expectedReasonCode: string | null;
  }>;
  policyScenarios: Array<{
    scenarioId: string;
    robotsText: string;
    termsDecision: Stage2AlternativeSourcePolicyPreflight["termsDecision"];
    expectedStatus: "allowed" | "blocked";
    expectedReasonCodes: string[];
  }>;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function jsonContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function includesAll(actual: readonly string[], expected: readonly string[]): boolean {
  return expected.every((reason) => actual.includes(reason));
}

function buildHandoff(briefId: string, briefHash: string, scenarioTotal: number): string {
  return `# Stage 2 替代来源离线能力探针验收说明\n\n`
    + `本轮只完成离线代码、Fixture 和 fail-closed 编排验证，没有访问 Made-in-China 或其他真实网站。\n\n`
    + `- Brief ID：\`${briefId}\`\n`
    + `- Brief Hash：\`${briefHash}\`\n`
    + `- 离线场景总数：${scenarioTotal}\n`
    + `- 证明级别：\`offline_fixture_only\`\n`
    + `- 供应商字段采集：0\n`
    + `- Stage 2 submission、Candidate、数据库写入：均未发生\n\n`
    + `此结果只代表独立浏览器能力探针的 URL、政策、页面分类、预算和清理契约已离线实现并验证；不代表真实网站可访问，也不代表供应商证据已取得。真实能力探针仍需用户另行授权。\n`;
}

function buildSecurityAudit(): string {
  return `# Stage 2 替代来源离线能力探针安全审计\n\n`
    + `本轮运行路径只读取本地 Brief 与 Fixture，没有调用系统浏览器，没有发起网络请求，没有使用私人 Profile，也没有读取私人会话数据。\n\n`
    + `实现采用精确 HTTPS Origin、精确路径白名单、robots 与条款双门禁、异常重定向阻断、页面分类 fail-closed、请求预算和 finally 清理契约。离线会话工厂必须显式标记为 \`offline_fixture\`，避免把本生成链误接到真实浏览器入口。\n\n`
    + `尚未验证的事实包括：真实站点当下政策、真实 DOM、真实重定向链、真实浏览器资源清理和来源可持续性。上述事实只能在另行授权的单次真实能力探针中确认。\n`;
}

export function generateStage2AlternativeSourceProbeOfflineEvidence(input: {
  briefFile: string;
  fixtureFile: string;
  outputDirectory: string;
  createdAt: string;
}) {
  if (!Number.isFinite(Date.parse(input.createdAt))) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_PROBE_CREATED_AT_INVALID");
  }
  const brief = readJson<Stage2AlternativeSourceBrief>(input.briefFile);
  if (validateStage2AlternativeSourceBrief(brief).status !== "valid_pending_authorization") {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_BRIEF_INVALID");
  }
  const fixture = readJson<Stage2AlternativeSourceProbeFixture>(input.fixtureFile);
  if (fixture.schemaVersion !== "stage2-alternative-source-probe-fixtures.v1") {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_PROBE_FIXTURE_SCHEMA_INVALID");
  }

  const pageResults = fixture.pageScenarios.map((scenario) => {
    const result = classifyMadeInChinaProbePage({
      brief,
      navigation: { ...fixture.baseNavigation, ...scenario.navigationPatch },
      signals: { ...fixture.baseSignals, ...scenario.signalsPatch },
    });
    return {
      scenarioId: scenario.scenarioId,
      expectedClassification: scenario.expectedClassification,
      actualClassification: result.classification,
      expectedReasonCodes: scenario.expectedReasonCodes,
      actualReasonCodes: result.classificationReasonCodes,
      pageInputHash: result.inputHash,
      passed: result.classification === scenario.expectedClassification
        && includesAll(result.classificationReasonCodes, scenario.expectedReasonCodes),
    };
  });
  const urlResults = fixture.urlScenarios.map((scenario) => {
    const result = validateMadeInChinaProbeUrl(scenario.url, scenario.kind, brief);
    return {
      scenarioId: scenario.scenarioId,
      kind: scenario.kind,
      expectedAllowed: scenario.expectedAllowed,
      actualAllowed: result.allowed,
      expectedReasonCode: scenario.expectedReasonCode,
      actualReasonCode: result.reasonCode,
      passed: result.allowed === scenario.expectedAllowed && result.reasonCode === scenario.expectedReasonCode,
    };
  });
  const policyResults = fixture.policyScenarios.map((scenario) => {
    const result = buildStage2AlternativeSourcePolicyPreflight({
      brief,
      robotsText: scenario.robotsText,
      termsDecision: scenario.termsDecision,
      evaluatedAt: input.createdAt,
      requestCount: 1,
    });
    return {
      scenarioId: scenario.scenarioId,
      expectedStatus: scenario.expectedStatus,
      actualStatus: result.status,
      expectedReasonCodes: scenario.expectedReasonCodes,
      actualReasonCodes: result.reasonCodes,
      robotsBodyHash: result.robotsBodyHash,
      policyInputHash: result.inputHash,
      passed: result.status === scenario.expectedStatus
        && includesAll(result.reasonCodes, scenario.expectedReasonCodes),
    };
  });
  const allResults = [...pageResults, ...urlResults, ...policyResults];
  const failedScenarioIds = allResults.filter((result) => !result.passed).map((result) => result.scenarioId);
  if (failedScenarioIds.length > 0) {
    throw new Error(`STAGE2_ALTERNATIVE_SOURCE_PROBE_FIXTURE_VALIDATION_FAILED:${failedScenarioIds.join(",")}`);
  }

  const pageClassificationCounts = pageResults.reduce<Record<MadeInChinaProbePageClassification, number>>(
    (counts, result) => {
      counts[result.actualClassification] += 1;
      return counts;
    },
    {
      search_results_ready: 0,
      loading: 0,
      captcha_or_robot_check: 0,
      login_or_inquiry_required: 0,
      access_denied: 0,
      service_unavailable: 0,
      browser_internal_error: 0,
      unexpected_origin_redirect: 0,
      unknown_page: 0,
    },
  );
  const fixtureHash = stableHash(fixture);
  const inputHash = stableHash({ briefHash: brief.briefHash, fixtureHash, createdAt: input.createdAt });
  const validationBody = {
    schemaVersion: "stage2-alternative-source-capability-probe-offline-validation.v1" as const,
    status: "offline_validation_passed" as const,
    proofLevel: "offline_fixture_only" as const,
    briefId: brief.briefId,
    briefHash: brief.briefHash,
    createdAt: input.createdAt,
    fixtureSchemaVersion: fixture.schemaVersion,
    fixtureHash,
    inputHash,
    scenarioCounts: {
      page: pageResults.length,
      url: urlResults.length,
      policy: policyResults.length,
      total: allResults.length,
    },
    pageClassificationCounts,
    failedScenarioIds,
    pageResults,
    urlResults,
    policyResults,
    browserControlContractReused: true as const,
    realWebsiteAccessed: false as const,
    runtimeAuthorizationGranted: false as const,
    runtimeProbeExecuted: false as const,
    supplierFieldsCollected: 0 as const,
    stage2SubmissionGenerated: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
    externalAiOrPaidApiCalled: false as const,
  };
  const validation = { ...validationBody, evidenceHash: stableHash(validationBody) };
  const files = [
    "stage2-alternative-source-capability-probe-offline-validation.v1.json",
    "generation-summary.stage2-alternative-source-probe-offline.v1.json",
    "01-离线能力探针验收说明.md",
    "02-安全边界审计.md",
  ];
  const summaryBody = {
    schemaVersion: "stage2-alternative-source-capability-probe-offline-generation-summary.v1" as const,
    status: validation.status,
    proofLevel: validation.proofLevel,
    briefId: brief.briefId,
    briefHash: brief.briefHash,
    validationEvidenceHash: validation.evidenceHash,
    realWebsiteAccessed: false as const,
    runtimeProbeExecuted: false as const,
    files,
  };
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const artifactWrite = writeArtifactsIdempotently(input.outputDirectory, [
    { relativePath: files[0], content: jsonContent(validation) },
    { relativePath: files[1], content: jsonContent(summary) },
    { relativePath: files[2], content: buildHandoff(brief.briefId, brief.briefHash, allResults.length) },
    { relativePath: files[3], content: buildSecurityAudit() },
  ], "STAGE2_ALTERNATIVE_SOURCE_PROBE_OFFLINE_OUTPUT_CONFLICT");
  return { validation, summary, artifactWrite };
}
