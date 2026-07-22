import {
  repositoryPath,
  TEST_PROJECT_MATERIALS_ROOT,
} from "../../tests/helpers/project-materials";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import type { PublicPageNavigationResult } from "../collectors/amazon/browser-control";
import {
  buildGlobalSourcesDiscoveryDomExpression,
  buildGlobalSourcesPolicyPreflight,
  buildStage2GlobalSourcesDiscoveryBriefR1,
  classifyGlobalSourcesDiscoveryPage,
  validateStage2GlobalSourcesDiscoveryBriefR1,
  type GlobalSourcesDiscoveryDomSignals,
} from "./stage2-global-sources-discovery-r1";

const PROJECT_ROOT = TEST_PROJECT_MATERIALS_ROOT;
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(PROJECT_ROOT, path), "utf8")) as T;

const selectionFile = "06_测试与验证/2026-07-15-Phase-Stage2-Global-Sources-Discovery-C1A-01/stage2-alternative-source-selection.v1.json";
const historicalBriefFile = "06_测试与验证/2026-07-15-Phase-Stage2-Global-Sources-Discovery-C1A-01/stage2-global-sources-discovery-brief.v1.json";

function buildBrief() {
  return buildStage2GlobalSourcesDiscoveryBriefR1({
    selection: readJson(selectionFile),
    historicalBrief: readJson(historicalBriefFile),
    createdAt: "2026-07-15T06:00:00.000Z",
  });
}

type Fixture = {
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

describe("Global Sources C1A-R1 successor brief", () => {
  it("binds the historical C1A evidence while reducing live scope to one origin and one homepage", () => {
    const historicalBefore = readFileSync(resolve(PROJECT_ROOT, historicalBriefFile), "utf8");
    const brief = buildBrief();
    const historicalAfter = readFileSync(resolve(PROJECT_ROOT, historicalBriefFile), "utf8");

    expect(brief).toMatchObject({
      schemaVersion: "stage2-global-sources-discovery-brief.v2",
      status: "pending_user_authorization",
      selectedOrigin: "https://www.globalsources.com",
      homepage: { path: "/", url: "https://www.globalsources.com/" },
      requestedScope: {
        maxRobotsRequests: 1,
        maxHomepageNavigations: 1,
        maxSearchPageNavigations: 0,
        maxProductPageNavigations: 0,
        maxTotalExternalActions: 2,
        maxSupplierFields: 0,
        automaticRetryCount: 0,
      },
      offlineReference: {
        origin: "https://s.globalsources.com",
        liveNavigationAllowed: false,
      },
      sourceCapabilityValidated: false,
    });
    expect(historicalAfter).toBe(historicalBefore);
    expect(validateStage2GlobalSourcesDiscoveryBriefR1({
      selection: readJson(selectionFile), historicalBrief: readJson(historicalBriefFile), brief,
    })).toMatchObject({ status: "valid_pending_user_authorization", reasonCodes: [] });
  });

  it("fails closed when scope or evidence binding is altered", () => {
    const brief = buildBrief();
    const tampered = {
      ...brief,
      requestedScope: { ...brief.requestedScope, maxHomepageNavigations: 2 },
    };
    const result = validateStage2GlobalSourcesDiscoveryBriefR1({
      selection: readJson(selectionFile), historicalBrief: readJson(historicalBriefFile), brief: tampered,
    });
    expect(result.status).toBe("invalid");
    expect(result.reasonCodes).toEqual(expect.arrayContaining(["brief_hash_invalid", "brief_scope_invalid"]));
  });

  it("fails closed when a re-hashed brief replaces its deterministic provenance identity", () => {
    const original = buildBrief();
    const { briefHash: _oldHash, ...originalBody } = original;
    const tamperedBody = { ...originalBody, briefId: "stage2-global-sources-discovery-r1-forged" };
    const tampered = { ...tamperedBody, briefHash: stableHash(tamperedBody) };
    const result = validateStage2GlobalSourcesDiscoveryBriefR1({
      selection: readJson(selectionFile), historicalBrief: readJson(historicalBriefFile), brief: tampered,
    });
    expect(result.status).toBe("invalid");
    expect(result.reasonCodes).toContain("brief_semantics_invalid");
  });
});

describe("Global Sources C1A-R1 page classification", () => {
  const fixture = JSON.parse(readFileSync(
    repositoryPath("tools/upstream/fixtures/stage2-global-sources-discovery-r1.v1.json"),
    "utf8",
  )) as Fixture;

  for (const scenario of fixture.scenarios) {
    it(`classifies ${scenario.scenarioId} through the real classifier`, () => {
      const result = classifyGlobalSourcesDiscoveryPage({
        brief: buildBrief(),
        navigation: { ...fixture.baseNavigation, ...scenario.navigationPatch },
        signals: { ...fixture.baseSignals, ...scenario.signalsPatch },
      });
      expect(result.classification).toBe(scenario.expectedClassification);
      expect(result.classificationReasonCodes).toEqual(expect.arrayContaining(scenario.expectedReasonCodes));
      expect(result.candidateSearchPaths.length).toBeLessThanOrEqual(5);
    });
  }

  it("stores only safe de-duplicated paths and excludes query/hash", () => {
    const result = classifyGlobalSourcesDiscoveryPage({
      brief: buildBrief(),
      navigation: fixture.baseNavigation,
      signals: {
        ...fixture.baseSignals,
        candidateSearchLinks: [
          "https://www.globalsources.com/search?q=one#x",
          "https://www.globalsources.com/search?q=two#y",
        ],
      },
    });
    expect(result.candidateSearchPaths).toEqual(["/search"]);
    expect(JSON.stringify(result)).not.toContain("q=one");
  });

  it("changes inputHash when a key diagnostic field changes", () => {
    const first = classifyGlobalSourcesDiscoveryPage({
      brief: buildBrief(), navigation: fixture.baseNavigation, signals: fixture.baseSignals,
    });
    const second = classifyGlobalSourcesDiscoveryPage({
      brief: buildBrief(), navigation: { ...fixture.baseNavigation, navigationElapsedMs: 421 }, signals: fixture.baseSignals,
    });
    expect(second.inputHash).not.toBe(first.inputHash);
  });

  it("builds a DOM expression that uses allowlisted output and excludes sensitive stores", () => {
    const expression = buildGlobalSourcesDiscoveryDomExpression();
    expect(expression).toContain("candidateSearchLinks");
    expect(expression).not.toMatch(/cookie|localStorage|sessionStorage|outerHTML|innerHTML/i);
  });
});

describe("Global Sources C1A-R1 robots policy", () => {
  it("allows the homepage only when a valid wildcard policy does not disallow slash", () => {
    const allowed = buildGlobalSourcesPolicyPreflight({
      brief: buildBrief(), robotsText: "User-agent: *\nDisallow: /private", evaluatedAt: "2026-07-15T06:00:00.000Z", requestCount: 1,
    });
    const blocked = buildGlobalSourcesPolicyPreflight({
      brief: buildBrief(), robotsText: "User-agent: *\nDisallow: /", evaluatedAt: "2026-07-15T06:00:00.000Z", requestCount: 1,
    });
    const unknown = buildGlobalSourcesPolicyPreflight({
      brief: buildBrief(), robotsText: "", evaluatedAt: "2026-07-15T06:00:00.000Z", requestCount: 1,
    });
    expect(allowed.status).toBe("allowed");
    expect(blocked).toMatchObject({ status: "blocked", robotsDecision: "disallowed" });
    expect(unknown).toMatchObject({ status: "blocked", robotsDecision: "unknown" });
  });

  it("applies wildcard rules when one robots group lists multiple user agents", () => {
    const result = buildGlobalSourcesPolicyPreflight({
      brief: buildBrief(),
      robotsText: "User-agent: *\nUser-agent: GlobalSourcesBot\nDisallow: /",
      evaluatedAt: "2026-07-15T06:00:00.000Z",
      requestCount: 1,
    });
    expect(result).toMatchObject({
      status: "blocked",
      robotsDecision: "disallowed",
      reasonCodes: ["robots_disallows_homepage"],
    });
  });

  it("fails closed when robots rules use unsupported wildcard syntax", () => {
    const result = buildGlobalSourcesPolicyPreflight({
      brief: buildBrief(),
      robotsText: "User-agent: *\nDisallow: /*",
      evaluatedAt: "2026-07-15T06:00:00.000Z",
      requestCount: 1,
    });
    expect(result).toMatchObject({
      status: "blocked",
      robotsDecision: "unknown",
      reasonCodes: ["robots_policy_unknown"],
    });
  });
});
