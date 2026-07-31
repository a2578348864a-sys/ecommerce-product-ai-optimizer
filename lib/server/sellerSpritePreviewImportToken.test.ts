import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const SYNTHETIC_SECRET = "test-access-password-for-token-signing";

describe("SellerSprite Preview Import Token", () => {
  beforeEach(() => {
    vi.stubEnv("ACCESS_PASSWORD", SYNTHETIC_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function freshModule() {
    return import("./sellerSpritePreviewImportToken");
  }

  const defaults = {
    subjectScope: "owner",
    sourceFileSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    acceptedRowsDigest: "a" + "0".repeat(63),
    acceptedRowCount: 5,
    warningDigest: "b" + "0".repeat(63),
    warningCount: 0,
    parserContractVersion: "sellersprite_preview_import_v1",
  };

  function opts(overrides: Partial<typeof defaults> = {}) {
    return { ...defaults, ...overrides };
  }

  it("generates and verifies an Owner token", async () => {
    const { generateSellerSpritePreviewImportToken, verifySellerSpritePreviewImportToken } =
      await freshModule();
    const token = generateSellerSpritePreviewImportToken(
      "owner", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      defaults.parserContractVersion,
    );
    expect(typeof token).toBe("string");
    expect(token.startsWith("preview-import-v1.")).toBe(true);
    const result = verifySellerSpritePreviewImportToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.version).toBe("sellersprite_preview_import_v1");
      expect(result.payload.subjectScopeHash).toBeDefined();
      expect(typeof result.payload.subjectScopeHash).toBe("string");
    }
  });

  it("generates and verifies a Visitor token", async () => {
    const { generateSellerSpritePreviewImportToken, verifySellerSpritePreviewImportToken } =
      await freshModule();
    const token = generateSellerSpritePreviewImportToken(
      "visitor:demo123", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      defaults.parserContractVersion,
    );
    const result = verifySellerSpritePreviewImportToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.subjectScopeHash).toBeDefined();
    }
  });

  it("produces different subjectScopeHash for Owner vs Visitor", async () => {
    const { generateSellerSpritePreviewImportToken, verifySellerSpritePreviewImportToken } =
      await freshModule();
    const ownerToken = generateSellerSpritePreviewImportToken(
      "owner", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      defaults.parserContractVersion,
    );
    const visitorToken = generateSellerSpritePreviewImportToken(
      "visitor:demo123", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      defaults.parserContractVersion,
    );
    const ownerResult = verifySellerSpritePreviewImportToken(ownerToken);
    const visitorResult = verifySellerSpritePreviewImportToken(visitorToken);
    expect(ownerResult.ok).toBe(true);
    expect(visitorResult.ok).toBe(true);
    if (ownerResult.ok && visitorResult.ok) {
      expect(ownerResult.payload.subjectScopeHash).not.toBe(
        visitorResult.payload.subjectScopeHash,
      );
    }
  });

  it("produces different subjectScopeHash for two different Visitors", async () => {
    const { generateSellerSpritePreviewImportToken, verifySellerSpritePreviewImportToken } =
      await freshModule();
    const tokenA = generateSellerSpritePreviewImportToken(
      "visitor:demo-a", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      defaults.parserContractVersion,
    );
    const tokenB = generateSellerSpritePreviewImportToken(
      "visitor:demo-b", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      defaults.parserContractVersion,
    );
    const resultA = verifySellerSpritePreviewImportToken(tokenA);
    const resultB = verifySellerSpritePreviewImportToken(tokenB);
    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    if (resultA.ok && resultB.ok) {
      expect(resultA.payload.subjectScopeHash).not.toBe(
        resultB.payload.subjectScopeHash,
      );
    }
  });

  it("rejects expired token", async () => {
    // Generate token at current real time
    const { generateSellerSpritePreviewImportToken } = await freshModule();
    const token = generateSellerSpritePreviewImportToken(
      "owner", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      defaults.parserContractVersion,
    );
    // Use fake timers and advance past expiry for verification
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 330_001);
    // Import verify function under fake timer context
    const { verifySellerSpritePreviewImportToken: verify } = await freshModule();
    const result = verify(token);
    vi.useRealTimers();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("preview_token_expired");
    }
  });

  it("rejects token with issuedAt in the far future", async () => {
    const { generateSellerSpritePreviewImportToken, verifySellerSpritePreviewImportToken } =
      await freshModule();
    const token = generateSellerSpritePreviewImportToken(
      "owner", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      defaults.parserContractVersion,
    );
    // Set clock back so issuedAt appears to be 60s in the future (>30s tolerance)
    const pastTime = Date.now() - 60_000;
    vi.spyOn(Date, "now").mockReturnValue(pastTime);
    const result = verifySellerSpritePreviewImportToken(token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("preview_token_not_yet_valid");
    }
    vi.mocked(Date.now).mockRestore();
  });

  it("rejects token with wrong version", async () => {
    const { generateSellerSpritePreviewImportToken, verifySellerSpritePreviewImportToken } =
      await freshModule();
    const token = generateSellerSpritePreviewImportToken(
      "owner", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      "wrong_version",
    );
    const result = verifySellerSpritePreviewImportToken(token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("preview_token_contract_mismatch");
    }
  });

  it("rejects token with wrong parserContractVersion", async () => {
    // parserContractVersion is the same field as the 7th param
    // The verify checks payload.parserContractVersion !== "sellersprite_preview_import_v1"
    const { generateSellerSpritePreviewImportToken, verifySellerSpritePreviewImportToken } =
      await freshModule();
    const token = generateSellerSpritePreviewImportToken(
      "owner", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      "wrong_parser_version",
    );
    const result = verifySellerSpritePreviewImportToken(token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("preview_token_contract_mismatch");
    }
  });

  it("rejects signature tampering (modified payload)", async () => {
    const { generateSellerSpritePreviewImportToken, verifySellerSpritePreviewImportToken } =
      await freshModule();
    const token = generateSellerSpritePreviewImportToken(
      "owner", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      defaults.parserContractVersion,
    );
    // Tamper with the payload portion: increment acceptedRowCount
    const parts = token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    );
    payload.acceptedRowCount = 999;
    const tamperedPayload = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    const result = verifySellerSpritePreviewImportToken(tamperedToken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_preview_token_signature");
    }
  });

  it("rejects signature tampering (modified signature)", async () => {
    const { generateSellerSpritePreviewImportToken, verifySellerSpritePreviewImportToken } =
      await freshModule();
    const token = generateSellerSpritePreviewImportToken(
      "owner", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      defaults.parserContractVersion,
    );
    const parts = token.split(".");
    const sigBytes = Buffer.from(parts[2], "base64url");
    sigBytes[0] ^= 0x01; // flip one bit
    const tamperedToken = `${parts[0]}.${parts[1]}.${sigBytes.toString("base64url")}`;
    const result = verifySellerSpritePreviewImportToken(tamperedToken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_preview_token_signature");
    }
  });

  it("rejects malformed token (not enough parts)", async () => {
    const { verifySellerSpritePreviewImportToken } = await freshModule();
    const result = verifySellerSpritePreviewImportToken("preview-import-v1.onlypayload");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("malformed_preview_token");
    }
  });

  it("rejects malformed token (wrong prefix)", async () => {
    const { verifySellerSpritePreviewImportToken } = await freshModule();
    const result = verifySellerSpritePreviewImportToken("wrong-prefix.a.b");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("malformed_preview_token");
    }
  });

  it("rejects non-string token", async () => {
    const { verifySellerSpritePreviewImportToken } = await freshModule();
    const result = verifySellerSpritePreviewImportToken(null as unknown as string);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("malformed_preview_token");
    }
  });

  it("token payload does not contain ASIN, title, or URL", async () => {
    const { generateSellerSpritePreviewImportToken, verifySellerSpritePreviewImportToken } =
      await freshModule();
    const token = generateSellerSpritePreviewImportToken(
      "owner", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      defaults.parserContractVersion,
    );
    const parts = token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    );
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("B0");
    expect(serialized).not.toContain("asin");
    expect(serialized).not.toContain("title");
    expect(serialized).not.toContain("url");
    expect(serialized).not.toContain("amazon");
  });

  it("token payload does not contain plaintext subject scope", async () => {
    const { generateSellerSpritePreviewImportToken } = await freshModule();
    const token = generateSellerSpritePreviewImportToken(
      "owner", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      defaults.parserContractVersion,
    );
    const parts = token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    );
    expect(JSON.stringify(payload)).not.toContain("owner");
    expect(JSON.stringify(payload)).not.toContain("visitor");
    expect(JSON.stringify(payload)).not.toContain("demo");
  });

  it("token length does not exceed 2048 bytes", async () => {
    const { generateSellerSpritePreviewImportToken } = await freshModule();
    const token = generateSellerSpritePreviewImportToken(
      "owner", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      defaults.parserContractVersion,
    );
    const utf8Bytes = new TextEncoder().encode(token).length;
    expect(utf8Bytes).toBeLessThanOrEqual(2048);
  });

  it("rejects oversized token (>2048 bytes payload)", async () => {
    // Generate token then inflate its payload portion beyond 2048
    const { generateSellerSpritePreviewImportToken, verifySellerSpritePreviewImportToken } =
      await freshModule();
    const token = generateSellerSpritePreviewImportToken(
      "owner", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      defaults.parserContractVersion,
    );
    const parts = token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    );
    // Inflate payload with a large padding field
    (payload as Record<string, unknown>).padding = "x".repeat(3000);
    const bigPayload = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
    const bigToken = `${parts[0]}.${bigPayload}.${parts[2]}`;
    const utf8Bytes = new TextEncoder().encode(bigToken).length;
    expect(utf8Bytes).toBeGreaterThan(2048);
    const result = verifySellerSpritePreviewImportToken(bigToken);
    expect(result.ok).toBe(false);
  });

  it("fails closed when ACCESS_PASSWORD is missing", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("APP_ACCESS_PASSWORD", "");
    const { generateSellerSpritePreviewImportToken } = await import(
      "./sellerSpritePreviewImportToken"
    );
    expect(() =>
      generateSellerSpritePreviewImportToken(
        "owner", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
        defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
        defaults.parserContractVersion,
      ),
    ).toThrow("SIGNING_KEY_MISSING");
  });

  it("verify returns invalid_preview_token_signature when secret is missing", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("APP_ACCESS_PASSWORD", "");
    const { verifySellerSpritePreviewImportToken } = await import(
      "./sellerSpritePreviewImportToken"
    );
    const result = verifySellerSpritePreviewImportToken("preview-import-v1.a.b");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_preview_token_signature");
    }
  });

  it("uses APP_ACCESS_PASSWORD fallback", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("APP_ACCESS_PASSWORD", SYNTHETIC_SECRET);
    const { generateSellerSpritePreviewImportToken, verifySellerSpritePreviewImportToken } =
      await import("./sellerSpritePreviewImportToken");
    const token = generateSellerSpritePreviewImportToken(
      "owner", defaults.sourceFileSha256, defaults.acceptedRowsDigest,
      defaults.acceptedRowCount, defaults.warningDigest, defaults.warningCount,
      defaults.parserContractVersion,
    );
    const result = verifySellerSpritePreviewImportToken(token);
    expect(result.ok).toBe(true);
  });
});
