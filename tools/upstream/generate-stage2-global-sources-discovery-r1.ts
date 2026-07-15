import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import type { PublicPageNavigationResult } from "../collectors/amazon/browser-control";
import { writeArtifactsIdempotently } from "./artifact-writer";
import {
  buildStage2GlobalSourcesDiscoveryBriefR1,
  classifyGlobalSourcesDiscoveryPage,
  type GlobalSourcesDiscoveryDomSignals,
} from "./stage2-global-sources-discovery-r1";
import {
  GLOBAL_SOURCES_DISCOVERY_R1_AUTHORIZATION_PHRASE,
  buildStage2GlobalSourcesDiscoveryAuthorizationRequest,
  validateStage2GlobalSourcesDiscoveryAuthorizationRequest,
} from "./stage2-global-sources-discovery-r1-authorization";

type Fixture = {
  schemaVersion: "stage2-global-sources-discovery-r1-fixture.v1";
  baseNavigation: PublicPageNavigationResult;
  baseSignals: GlobalSourcesDiscoveryDomSignals;
  scenarios: Array<{
    scenarioId: string;
    navigationPatch?: Partial<PublicPageNavigationResult>;
    signalsPatch?: Partial<GlobalSourcesDiscoveryDomSignals>;
    expectedClassification: string;
    expectedReasonCodes: string[];
  }>;
};

const jsonContent = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export function generateStage2GlobalSourcesDiscoveryR1Materials(input: {
  selectionFile: string;
  historicalBriefFile: string;
  fixtureFile: string;
  outputDirectory: string;
  createdAt: string;
}) {
  const selection = JSON.parse(readFileSync(resolve(input.selectionFile), "utf8")) as Record<string, unknown>;
  const historicalBrief = JSON.parse(readFileSync(resolve(input.historicalBriefFile), "utf8")) as Record<string, unknown>;
  const fixture = JSON.parse(readFileSync(resolve(input.fixtureFile), "utf8")) as Fixture;
  if (fixture.schemaVersion !== "stage2-global-sources-discovery-r1-fixture.v1"
    || !Array.isArray(fixture.scenarios) || fixture.scenarios.length === 0) {
    throw new Error("STAGE2_GLOBAL_SOURCES_R1_FIXTURE_INVALID");
  }
  const brief = buildStage2GlobalSourcesDiscoveryBriefR1({ selection, historicalBrief, createdAt: input.createdAt });
  const failedScenarioIds: string[] = [];
  for (const scenario of fixture.scenarios) {
    const result = classifyGlobalSourcesDiscoveryPage({
      brief,
      navigation: { ...fixture.baseNavigation, ...scenario.navigationPatch },
      signals: { ...fixture.baseSignals, ...scenario.signalsPatch },
    });
    if (result.classification !== scenario.expectedClassification
      || !scenario.expectedReasonCodes.every((reason) => result.classificationReasonCodes.includes(reason))) {
      failedScenarioIds.push(scenario.scenarioId);
    }
  }
  const offlineBody = {
    schemaVersion: "stage2-global-sources-discovery-offline-validation.v1" as const,
    status: failedScenarioIds.length === 0 ? "offline_validation_passed" as const : "offline_validation_failed" as const,
    proofLevel: "offline_fixture_only" as const,
    briefId: brief.briefId,
    briefHash: brief.briefHash,
    fixtureSchemaVersion: fixture.schemaVersion,
    scenarioCount: fixture.scenarios.length,
    passedScenarioCount: fixture.scenarios.length - failedScenarioIds.length,
    failedScenarioIds,
    realWebsiteAccessed: false as const,
    runtimeDiscoveryExecuted: false as const,
  };
  const offlineValidation = { ...offlineBody, evidenceHash: stableHash(offlineBody) };
  if (offlineValidation.status !== "offline_validation_passed") {
    throw new Error(`STAGE2_GLOBAL_SOURCES_R1_OFFLINE_VALIDATION_FAILED:${failedScenarioIds.join(",")}`);
  }
  const authorizationRequest = buildStage2GlobalSourcesDiscoveryAuthorizationRequest({
    brief,
    offlineValidation,
    createdAt: input.createdAt,
  });
  const authorizationValidation = validateStage2GlobalSourcesDiscoveryAuthorizationRequest({
    request: authorizationRequest,
    brief,
    offlineValidation,
  });
  if (authorizationValidation.status !== "valid_pending_user_authorization") {
    throw new Error("STAGE2_GLOBAL_SOURCES_R1_AUTHORIZATION_REQUEST_INVALID");
  }
  const handoff = [
    "# Global Sources C1A-R1 真实来源发现授权交接",
    "",
    "当前仅完成离线工具链和 Fixture 验证，未访问任何真实网站。历史 C1A v1 产物保持不变。",
    "",
    "## 固定真实运行范围",
    "",
    "- robots：`https://www.globalsources.com/robots.txt`，最多 1 次。",
    "- 浏览器：系统 Chrome、全新临时 Profile、动态 loopback CDP。",
    "- 页面：`https://www.globalsources.com/` 首页，最多 1 次主导航。",
    "- 搜索页、商品页、供应商字段、自动重试：全部 0。",
    "- 任一重定向、登录/注册、Captcha、访问拒绝、错误页、unknown 或清理不完整均 fail-closed。",
    "",
    "## 授权短语",
    "",
    `\`${GLOBAL_SOURCES_DISCOVERY_R1_AUTHORIZATION_PHRASE}\``,
    "",
    "本文件不是授权。只有用户在未来当前对话中完整回复上述短语，runner 才能生成单次 grant。",
    "",
  ].join("\n");
  const summaryBody = {
    schemaVersion: "stage2-global-sources-discovery-r1-generation-summary.v1" as const,
    briefId: brief.briefId,
    briefHash: brief.briefHash,
    offlineValidationEvidenceHash: offlineValidation.evidenceHash,
    authorizationRequestId: authorizationRequest.authorizationRequestId,
    authorizationRequestHash: authorizationRequest.requestHash,
    authorizationValidationInputHash: authorizationValidation.inputHash,
    historicalSelectionHash: selection.selectionHash,
    historicalBriefHash: historicalBrief.briefHash,
    generatedAt: input.createdAt,
    realWebsiteAccessedDuringGeneration: false as const,
    runtimeDiscoveryExecuted: false as const,
    policyRequests: 0 as const,
    homepageNavigations: 0 as const,
    searchPageNavigations: 0 as const,
    productPageNavigations: 0 as const,
    supplierFieldsCollected: 0 as const,
    stage2SubmissionGenerated: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
    externalAiOrPaidApiCalled: false as const,
  };
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const artifactWrite = writeArtifactsIdempotently(resolve(input.outputDirectory), [
    { relativePath: "stage2-global-sources-discovery-brief.v2.json", content: jsonContent(brief) },
    { relativePath: "stage2-global-sources-discovery-offline-validation.v1.json", content: jsonContent(offlineValidation) },
    { relativePath: "stage2-global-sources-discovery-authorization-request.v1.json", content: jsonContent(authorizationRequest) },
    { relativePath: "stage2-global-sources-discovery-authorization-validation.v1.json", content: jsonContent(authorizationValidation) },
    { relativePath: "01-Global-Sources-C1A-R1真实来源发现授权交接.md", content: handoff },
    { relativePath: "generation-summary.stage2-global-sources-discovery-r1.v1.json", content: jsonContent(summary) },
  ], "STAGE2_GLOBAL_SOURCES_R1_OFFLINE_OUTPUT_CONFLICT");
  return {
    brief,
    offlineValidation,
    authorizationRequest,
    authorizationValidation,
    summary,
    artifactWrite,
  };
}
