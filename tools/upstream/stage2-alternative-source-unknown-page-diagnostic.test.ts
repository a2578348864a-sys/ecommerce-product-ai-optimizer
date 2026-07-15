import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import { validatePublicDomExpression, type PublicPageNavigationResult } from "../collectors/amazon/browser-control";
import type { Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";
import type { MadeInChinaProbePageClassification } from "./stage2-alternative-source-probe";
import {
  buildMadeInChinaUnknownPageDiagnostic,
  buildMadeInChinaUnknownPageDiagnosticDomExpression,
  type MadeInChinaUnknownPageDiagnosticDomSignals,
  type MadeInChinaUnknownPageDiagnosticStatus,
} from "./stage2-alternative-source-unknown-page-diagnostic";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const brief = JSON.parse(readFileSync(resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json"),
"utf8")) as Stage2AlternativeSourceBrief;
type Fixture = {
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
const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname,
  "fixtures/stage2-alternative-source-unknown-page-diagnostic.v1.json"), "utf8")) as Fixture;

describe("Stage 2 alternative source unknown-page diagnostic", () => {
  it("uses a bounded whitelist-only DOM expression and stores no page text or private browser state", () => {
    const expression = buildMadeInChinaUnknownPageDiagnosticDomExpression();
    expect(() => validatePublicDomExpression(expression)).not.toThrow();
    expect(expression).not.toMatch(/document\s*\.\s*cookie|localStorage|sessionStorage|indexedDB/i);
    expect(expression).not.toContain("innerHTML");
    expect(expression).not.toContain("innerText");
    expect(expression).toContain("safeSameOriginPathSamples");
  });

  it.each(fixture.scenarios)("classifies $scenarioId through the real diagnostic builder", (scenario) => {
    const result = buildMadeInChinaUnknownPageDiagnostic({
      brief,
      navigation: { ...fixture.baseNavigation, ...scenario.navigationPatch },
      parentClassification: scenario.parentClassification ?? "unknown_page",
      parentPageInputHash: "b".repeat(64),
      signals: { ...fixture.baseSignals, ...scenario.signalsPatch },
    });
    expect(result.status).toBe(scenario.expectedStatus);
    expect(result.reasonCodes).toEqual(expect.arrayContaining(scenario.expectedReasonCodes));
    expect(result).toMatchObject({
      failClosedRequired: true,
      allowsCollection: false,
      fullHtmlStored: false,
      pageBodyTextStored: false,
    });
    const { inputHash, ...body } = result;
    expect(inputHash).toBe(stableHash(body));
  });

  it("changes the hash when an independent diagnostic count or safe path changes", () => {
    const baseline = buildMadeInChinaUnknownPageDiagnostic({
      brief,
      navigation: fixture.baseNavigation,
      parentClassification: "unknown_page",
      parentPageInputHash: "b".repeat(64),
      signals: fixture.baseSignals,
    });
    const changedCount = buildMadeInChinaUnknownPageDiagnostic({
      brief,
      navigation: fixture.baseNavigation,
      parentClassification: "unknown_page",
      parentPageInputHash: "b".repeat(64),
      signals: { ...fixture.baseSignals, anchorCount: (fixture.baseSignals.anchorCount ?? 0) + 1 },
    });
    const changedPath = buildMadeInChinaUnknownPageDiagnostic({
      brief,
      navigation: fixture.baseNavigation,
      parentClassification: "unknown_page",
      parentPageInputHash: "b".repeat(64),
      signals: { ...fixture.baseSignals, safeSameOriginPathSamples: ["/different-safe-path.html"] },
    });
    expect(new Set([baseline.inputHash, changedCount.inputHash, changedPath.inputHash]).size).toBe(3);
  });
});
