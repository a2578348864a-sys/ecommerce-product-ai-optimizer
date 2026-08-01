import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DRIVER = resolve("scripts/sellersprite-preview-auth-smoke.mjs");

describe("SellerSprite Preview acceptance driver credential flow", () => {
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
});
