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
});
