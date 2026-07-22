import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PublicPageNavigationResult } from "../collectors/amazon/browser-control";
import type { Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";
import {
  buildStage2AlternativeSourcePolicyPreflight,
  classifyMadeInChinaProbePage,
  validateMadeInChinaProbeUrl,
  type MadeInChinaProbeDomSignals,
  type MadeInChinaProbePageClassification,
} from "./stage2-alternative-source-probe";

const PROJECT_ROOT = TEST_PROJECT_MATERIALS_ROOT;
const brief = JSON.parse(readFileSync(resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json"),
"utf8")) as Stage2AlternativeSourceBrief;

type Fixture = {
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
    termsDecision: "reviewed_allows_public_capability_probe" | "prohibited" | "unknown";
    expectedStatus: "allowed" | "blocked";
    expectedReasonCodes: string[];
  }>;
};

const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname,
  "fixtures/stage2-alternative-source-probe.v1.json"), "utf8")) as Fixture;

describe("Stage 2 alternative source probe offline fixtures", () => {
  it("uses the expected fixture schema and sufficient fail-closed coverage", () => {
    expect(fixture.schemaVersion).toBe("stage2-alternative-source-probe-fixtures.v1");
    expect(fixture.pageScenarios.length).toBeGreaterThanOrEqual(14);
    expect(new Set(fixture.pageScenarios.map((item) => item.expectedClassification))).toEqual(new Set([
      "search_results_ready",
      "loading",
      "captcha_or_robot_check",
      "login_or_inquiry_required",
      "access_denied",
      "service_unavailable",
      "browser_internal_error",
      "unexpected_origin_redirect",
      "unknown_page",
    ]));
  });

  it.each(fixture.pageScenarios)("classifies $scenarioId through the real page classifier", (scenario) => {
    const result = classifyMadeInChinaProbePage({
      brief,
      navigation: { ...fixture.baseNavigation, ...scenario.navigationPatch },
      signals: { ...fixture.baseSignals, ...scenario.signalsPatch },
    });
    expect(result.classification).toBe(scenario.expectedClassification);
    expect(result.classificationReasonCodes).toEqual(expect.arrayContaining(scenario.expectedReasonCodes));
  });

  it.each(fixture.urlScenarios)("validates URL fixture $scenarioId", (scenario) => {
    const result = validateMadeInChinaProbeUrl(scenario.url, scenario.kind, brief);
    expect(result.allowed).toBe(scenario.expectedAllowed);
    expect(result.reasonCode).toBe(scenario.expectedReasonCode);
  });

  it.each(fixture.policyScenarios)("evaluates policy fixture $scenarioId", (scenario) => {
    const result = buildStage2AlternativeSourcePolicyPreflight({
      brief,
      robotsText: scenario.robotsText,
      termsDecision: scenario.termsDecision,
      evaluatedAt: "2026-07-15T02:00:00.000Z",
      requestCount: 1,
    });
    expect(result.status).toBe(scenario.expectedStatus);
    expect(result.reasonCodes).toEqual(expect.arrayContaining(scenario.expectedReasonCodes));
  });
});
