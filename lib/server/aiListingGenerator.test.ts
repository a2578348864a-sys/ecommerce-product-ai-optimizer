import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateRealAiListingDraft, setRealAiListingClientForTests } from "@/lib/server/aiListingGenerator";
import { validateAiListingPackDraft } from "@/lib/aiListingDraft";

const mocks = vi.hoisted(() => ({
  callAiJson: vi.fn(),
}));

vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: mocks.callAiJson,
}));

const context = {
  taskTitle: "Desktop Phone Stand",
  productName: "Desktop Phone Stand",
  decisionSummary: "Can test small batch after manual review.",
  riskLevel: "yellow",
  category: "phone accessory",
  sellingPoints: ["Adjustable angle", "Compact desktop use"],
};

function providerPayload(overrides: Record<string, unknown> = {}) {
  return {
    source: "real_ai_draft",
    titleCandidates: ["Desktop Phone Stand for Workspace Use"],
    bulletPoints: [
      "Adjustable stand for desk organization.",
      "FDA Approved claim should be filtered.",
    ],
    description: "A practical desktop phone stand for hands-free viewing.",
    keywords: ["desktop phone stand", "workspace accessory"],
    sellingPoints: ["Adjustable viewing angle"],
    riskWarnings: ["Confirm material and dimensions before publishing."],
    reviewWarnings: [],
    reviewChecklist: ["Check supplier documents before publishing."],
    ...overrides,
  };
}

describe("generateRealAiListingDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRealAiListingClientForTests(null);
  });

  it("uses the default callAiJson client and normalizes provider schema aliases", async () => {
    mocks.callAiJson.mockResolvedValue({ ok: true, data: providerPayload({ model: "deepseek-chat" }) });

    const result = await generateRealAiListingDraft(context);

    expect(result.ok).toBe(true);
    expect(mocks.callAiJson).toHaveBeenCalledTimes(1);
    const prompt = mocks.callAiJson.mock.calls[0][0].messages.map((item: { content: string }) => item.content).join("\n");
    expect(prompt).toContain("Return strict JSON only");
    expect(prompt).toContain("source must be exactly real_ai_draft");
    expect(prompt).toContain("Do not fabricate certifications");
    if (!result.ok) throw new Error("Expected real AI listing draft generation to succeed.");
    expect(result.data.source).toBe("real_ai_draft");
    expect(result.data.model).toBe("deepseek-chat");
    expect(result.data.titles).toEqual(["Desktop Phone Stand for Workspace Use"]);
    expect(result.data.bullets[1]).not.toMatch(/FDA Approved/);
    expect(result.data.blockedClaims).toContain("FDA Approved");
    expect(validateAiListingPackDraft(result.data).ok).toBe(true);
  });

  it("keeps the injected fake client path available for tests", async () => {
    const fakeClient = vi.fn().mockResolvedValue(providerPayload({ model: "fake-listing-model" }));
    setRealAiListingClientForTests(fakeClient);

    const result = await generateRealAiListingDraft(context);

    expect(result.ok).toBe(true);
    expect(fakeClient).toHaveBeenCalledTimes(1);
    expect(mocks.callAiJson).not.toHaveBeenCalled();
  });

  it("maps AI timeout errors without returning a draft", async () => {
    mocks.callAiJson.mockResolvedValue({ ok: false, error: { code: "timeout", message: "timeout" } });

    const result = await generateRealAiListingDraft(context);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected timeout error.");
    expect(result.error.code).toBe("ai_timeout");
  });

  it("maps AI JSON parse errors without returning a draft", async () => {
    mocks.callAiJson.mockResolvedValue({ ok: false, error: { code: "json_parse_error", message: "bad json" } });

    const result = await generateRealAiListingDraft(context);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected JSON parse error.");
    expect(result.error.code).toBe("ai_json_parse_failed");
  });

  it("maps incomplete provider output to schema invalid", async () => {
    mocks.callAiJson.mockResolvedValue({ ok: true, data: { source: "real_ai_draft", titleCandidates: [] } });

    const result = await generateRealAiListingDraft(context);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected schema error.");
    expect(result.error.code).toBe("ai_schema_invalid");
  });

  it("maps provider errors without returning a draft", async () => {
    mocks.callAiJson.mockResolvedValue({ ok: false, error: { code: "invalid_api_key", message: "invalid" } });

    const result = await generateRealAiListingDraft(context);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected provider error.");
    expect(result.error.code).toBe("ai_provider_error");
  });
});
