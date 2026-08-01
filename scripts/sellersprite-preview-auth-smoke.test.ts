import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DRIVER = resolve("scripts/sellersprite-preview-auth-smoke.mjs");

describe("SellerSprite Preview acceptance driver credential flow", () => {
  it("accepts an explicit converted-task fixture mode without adding a second browser entrypoint", () => {
    const source = readFileSync(DRIVER, "utf8");

    expect(source).toContain('args.length === 1 && args[0] === "--converted-task-fixture"');
    expect(source).toContain('mode: "converted-task-fixture"');
    expect(source).toContain('mode: "preview"');
    expect(source).toContain("const tabList = document.querySelector('[role=\"tablist\"]')");
    expect(source).toContain("tabs[1]?.click()");
  });

  it("uses the programmatic Smoke Runtime result and never parses or prints credentials", () => {
    const source = readFileSync(DRIVER, "utf8");

    expect(source).toContain("startSmokeRuntime");
    expect(source).toContain("delete smoke.ownerPassword");
    expect(source).toContain("delete smoke.visitorPassword");
    expect(source).toContain("ownerPassword = undefined");
    expect(source).toContain("visitorAPassword = undefined");
    expect(source).toContain("visitorBPassword = undefined");
    expect(source).toContain("credentialLeakCheck");
    expect(source).toContain("cliStdoutCredentialFree");
    expect(source).toContain("cliStderrCredentialFree");
    expect(source).toContain("markerCredentialFree");
    expect(source).toContain("statusCredentialFree");
    expect(source).toContain("runtimeLogCredentialFree");
    expect(source).toContain("driverLogCredentialFree");
    expect(source).toContain("finalEvidenceSummaryCredentialFree");
    expect(source).not.toMatch(/process\.(?:stdout|stderr)|\.(?:stdout|stderr)\b|show-credentials|formatOneTimeSmokeCredentials/i);
    expect(source).not.toMatch(/console\.(?:log|error)\([^\n]*(?:password|credential|token)/i);
  });

  it("extends the existing isolated driver through Candidate import and recovery without embedding a real file", () => {
    const source = readFileSync(DRIVER, "utf8");

    expect(source).toContain("importFirstPreviewCandidate");
    expect(source).toContain("readCandidatePool");
    expect(source).toContain("createSyntheticCandidatePage");
    expect(source).toContain("verifyPoolRecovery");
    expect(source).toContain("verifyHomeAndSidebar");
    expect(source).toContain("readTaskTotal");
    expect(source).toContain("readSyntheticAiUsage");
    expect(source).toContain("--real-file");
    expect(source).toContain("--real-sha256");
    expect(source).not.toContain("Search(powder-sunscreen-for-face)-10-US-20260730.xlsx");
    expect(source).not.toContain("C:\\Users\\a2578\\Downloads");
  });

  it("reuses the existing driver for converted-task navigation and cross-identity denial", () => {
    const source = readFileSync(DRIVER, "utf8");

    expect(source).toContain("seedConvertedTaskFixture");
    expect(source).toContain("verifyConvertedCandidateFlow");
    expect(source).toContain("probeTaskAccess");
    expect(source).toContain("convertedTaskFixture");
    expect(source).toContain("researchContextRequestCount");
    expect(source).toContain("agentNavigationCount");
    expect(source).toContain("taskCreateCount");
    expect(source).toContain("candidateCreateCount");
    expect(source).not.toContain("ownerTaskId:");
    expect(source).not.toContain("visitorTaskId:");
  });
});
