import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiListingPackDraft } from "@/lib/aiListingDraft";

const mocks = vi.hoisted(() => ({
  chmod: vi.fn(),
  failFinalResultChmod: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  mocks.chmod.mockImplementation(async (...args: Parameters<typeof actual.chmod>) => {
    if (mocks.failFinalResultChmod && String(args[0]).endsWith(".json")) {
      throw new Error("simulated final chmod failure");
    }
    return actual.chmod(...args);
  });
  return { ...actual, chmod: mocks.chmod };
});

import {
  loadStudioListingResult,
  saveStudioListingResult,
} from "@/lib/server/studioListingResultStore";

const PACK: AiListingPackDraft = {
  source: "real_ai_draft",
  version: 1,
  generatedAt: "2026-07-26T00:00:00.000Z",
  model: "fake-provider",
  humanReviewRequired: true,
  titles: ["Safe test title"],
  bullets: ["Safe test bullet"],
  description: "Safe test description.",
  keywords: ["safe"],
  sellingPoints: ["Safe test point"],
  riskNotes: ["Manual review required."],
  complianceWarnings: ["Manual review required."],
  blockedClaims: [],
  reviewChecklist: ["Review before publishing."],
};

let root = "";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.failFinalResultChmod = false;
  root = mkdtempSync(join(tmpdir(), "studio-listing-results-"));
  process.env.STUDIO_LISTING_RESULT_STORE_ROOT = root;
});

afterEach(() => {
  delete process.env.STUDIO_LISTING_RESULT_STORE_ROOT;
  rmSync(root, { recursive: true, force: true });
});

describe("Studio listing result atomic commit", () => {
  it("treats rename as the final result commit point", async () => {
    mocks.failFinalResultChmod = true;
    const requestHash = "a".repeat(64);
    const idempotencyScopeHash = "b".repeat(64);

    await expect(saveStudioListingResult({
      accessMode: "owner",
      requestHash,
      idempotencyScopeHash,
      data: PACK,
      now: "2026-07-26T00:00:00.000Z",
    })).resolves.toBeUndefined();

    await expect(loadStudioListingResult({
      accessMode: "owner",
      requestHash,
      idempotencyScopeHash,
      now: Date.parse("2026-07-26T00:01:00.000Z"),
    })).resolves.toEqual(PACK);
  });
});
