import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_IMAGE_DRAFT_DISCLAIMER,
  type AiImageAccessMode,
  type AiImageDraftItem,
  type AiImageDraftSnapshot,
} from "@/lib/aiImageDraft";

const mocks = vi.hoisted(() => ({
  deleteAiImage: vi.fn(),
  chmod: vi.fn(),
  rename: vi.fn(),
  renameCallCount: 0,
  failRenameAt: 0,
  failFinalManifestChmod: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  mocks.chmod.mockImplementation(async (...args: Parameters<typeof actual.chmod>) => {
    if (mocks.failFinalManifestChmod && String(args[0]).endsWith(".json")) {
      throw new Error("simulated final chmod failure");
    }
    return actual.chmod(...args);
  });
  mocks.rename.mockImplementation(async (...args: Parameters<typeof actual.rename>) => {
    mocks.renameCallCount += 1;
    if (mocks.failRenameAt === mocks.renameCallCount) {
      throw new Error("simulated convergence rename failure");
    }
    return actual.rename(...args);
  });
  return { ...actual, chmod: mocks.chmod, rename: mocks.rename };
});

vi.mock("@/lib/server/aiImageDraftStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/aiImageDraftStorage")>();
  return { ...actual, deleteAiImage: mocks.deleteAiImage };
});

import { buildVisitorImageScope } from "@/lib/server/aiImageDraftStorage";
import {
  loadStudioImageSnapshot,
  saveStudioImageSnapshot,
} from "@/lib/server/studioImageResultStore";

let testRoot = "";

beforeAll(() => {
  testRoot = mkdtempSync(join(tmpdir(), "studio-image-results-"));
});

afterAll(() => {
  delete process.env.STUDIO_IMAGE_RESULT_STORE_ROOT;
  rmSync(testRoot, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.renameCallCount = 0;
  mocks.failRenameAt = 0;
  mocks.failFinalManifestChmod = false;
  mocks.deleteAiImage.mockResolvedValue(undefined);
  process.env.STUDIO_IMAGE_RESULT_STORE_ROOT = join(testRoot, randomUUID());
});

function imageItem(
  index: number,
  accessMode: AiImageAccessMode = "owner",
  visitorAccessId = "visitor-1",
  taskId = "studio-image",
): AiImageDraftItem {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const scope = accessMode === "owner"
    ? "owner"
    : `visitor/${buildVisitorImageScope(visitorAccessId)}`;
  return {
    id,
    imageType: "white_background_concept",
    model: "fake-image-model",
    createdAt: new Date(2_000_000_000_000 + index).toISOString(),
    storageKey: `${scope}/${taskId}/${id}.png`,
    mimeType: "image/png",
    actualFormat: "png",
    width: 1,
    height: 1,
    fileSizeBytes: 68,
    sha256: "a".repeat(64),
    reviewStatus: "needs_human_review",
    accessMode,
    source: "real_ai_image_draft",
    safetyWarnings: ["Manual review required."],
    promptHash: "b".repeat(64),
    requestKeyHash: "c".repeat(64),
    generationBasis: {
      productName: "Desk stand",
      sellingPoints: [],
      riskWarnings: [],
      missingFacts: [],
      imageMaterialNeeds: [],
    },
  };
}

function snapshot(items: AiImageDraftItem[], accessMode: AiImageAccessMode = "owner"): AiImageDraftSnapshot {
  return {
    version: 1,
    snapshotType: "ai_image_draft",
    provider: "openai_compatible_relay",
    accessMode,
    humanReviewRequired: true,
    disclaimer: AI_IMAGE_DRAFT_DISCLAIMER,
    updatedAt: "2033-05-18T03:33:20.000Z",
    items,
  };
}

describe("Studio image result manifest safety", () => {
  it("rejects a valid-looking Owner key from a non-Studio task before it can be deleted", async () => {
    const root = process.env.STUDIO_IMAGE_RESULT_STORE_ROOT || "";
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "owner.json"), JSON.stringify({
      version: 1,
      accessMode: "owner",
      snapshot: snapshot([imageItem(1, "owner", "visitor-1", "real-task")]),
    }));

    await expect(loadStudioImageSnapshot({
      accessMode: "owner",
      now: Date.parse("2033-05-18T03:33:21.000Z"),
    })).rejects.toThrow("STUDIO_IMAGE_MANIFEST_CORRUPT");
    expect(mocks.deleteAiImage).not.toHaveBeenCalled();
  });

  it("rejects a valid-looking key from another Visitor scope before cleanup", async () => {
    const root = process.env.STUDIO_IMAGE_RESULT_STORE_ROOT || "";
    mkdirSync(root, { recursive: true });
    const subject = await import("node:crypto").then(({ createHash }) => (
      createHash("sha256").update("visitor-1").digest("hex")
    ));
    writeFileSync(join(root, `visitor-${subject}.json`), JSON.stringify({
      version: 1,
      accessMode: "visitor",
      snapshot: snapshot([imageItem(1, "visitor", "visitor-2")], "visitor"),
    }));

    await expect(loadStudioImageSnapshot({
      accessMode: "visitor",
      visitorAccessId: "visitor-1",
      now: Date.parse("2033-05-18T03:33:21.000Z"),
    })).rejects.toThrow("STUDIO_IMAGE_MANIFEST_CORRUPT");
    expect(mocks.deleteAiImage).not.toHaveBeenCalled();
  });

  it("tracks and precisely deletes items evicted by the 50-item snapshot limit", async () => {
    const firstFifty = Array.from({ length: 50 }, (_, index) => imageItem(index + 1));
    await saveStudioImageSnapshot({
      accessMode: "owner",
      result: { aiImageDraftSnapshot: snapshot(firstFifty) },
    });

    const allFiftyTwo = [...firstFifty, imageItem(51), imageItem(52)];
    await saveStudioImageSnapshot({
      accessMode: "owner",
      result: { aiImageDraftSnapshot: snapshot(allFiftyTwo) },
    });

    expect(mocks.deleteAiImage).toHaveBeenCalledTimes(2);
    expect(mocks.deleteAiImage).toHaveBeenNthCalledWith(1, firstFifty[0].storageKey);
    expect(mocks.deleteAiImage).toHaveBeenNthCalledWith(2, firstFifty[1].storageKey);
    const manifest = JSON.parse(readFileSync(join(
      process.env.STUDIO_IMAGE_RESULT_STORE_ROOT || "",
      "owner.json",
    ), "utf8"));
    expect(manifest.snapshot.items).toHaveLength(50);
    expect(manifest.retiredStorageKeys || []).toEqual([]);
  });

  it("keeps a failed precise deletion in the manifest and retries it later", async () => {
    const firstFifty = Array.from({ length: 50 }, (_, index) => imageItem(index + 1));
    await saveStudioImageSnapshot({
      accessMode: "owner",
      result: { aiImageDraftSnapshot: snapshot(firstFifty) },
    });
    mocks.deleteAiImage.mockRejectedValueOnce(new Error("temporary delete failure"));

    await saveStudioImageSnapshot({
      accessMode: "owner",
      result: { aiImageDraftSnapshot: snapshot([...firstFifty, imageItem(51)]) },
    });

    const path = join(process.env.STUDIO_IMAGE_RESULT_STORE_ROOT || "", "owner.json");
    expect(JSON.parse(readFileSync(path, "utf8")).retiredStorageKeys).toEqual([
      firstFifty[0].storageKey,
    ]);

    mocks.deleteAiImage.mockClear();
    await loadStudioImageSnapshot({
      accessMode: "owner",
      now: Date.parse("2033-05-18T03:33:21.000Z"),
    });

    expect(mocks.deleteAiImage).toHaveBeenCalledWith(firstFifty[0].storageKey);
    expect(JSON.parse(readFileSync(path, "utf8")).retiredStorageKeys || []).toEqual([]);
  });

  it("treats rename as the final manifest commit point", async () => {
    mocks.failFinalManifestChmod = true;

    await expect(saveStudioImageSnapshot({
      accessMode: "owner",
      result: { aiImageDraftSnapshot: snapshot([imageItem(1)]) },
    })).resolves.toBeUndefined();

    expect(JSON.parse(readFileSync(join(
      process.env.STUDIO_IMAGE_RESULT_STORE_ROOT || "",
      "owner.json",
    ), "utf8")).snapshot.items).toHaveLength(1);
  });

  it("keeps the safe cleanup intent when the convergence manifest write fails", async () => {
    const firstFifty = Array.from({ length: 50 }, (_, index) => imageItem(index + 1));
    await saveStudioImageSnapshot({
      accessMode: "owner",
      result: { aiImageDraftSnapshot: snapshot(firstFifty) },
    });
    mocks.failRenameAt = 3;

    await expect(saveStudioImageSnapshot({
      accessMode: "owner",
      result: { aiImageDraftSnapshot: snapshot([...firstFifty, imageItem(51)]) },
    })).resolves.toBeUndefined();

    const manifest = JSON.parse(readFileSync(join(
      process.env.STUDIO_IMAGE_RESULT_STORE_ROOT || "",
      "owner.json",
    ), "utf8"));
    expect(manifest.snapshot.items).toHaveLength(50);
    expect(manifest.retiredStorageKeys).toEqual([firstFifty[0].storageKey]);
  });
});
