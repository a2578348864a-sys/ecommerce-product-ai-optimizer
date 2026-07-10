import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AI_IMAGE_MAX_FILE_BYTES,
  AI_IMAGE_VISITOR_GRACE_MS,
  aiImageExists,
  cleanupAiImageTask,
  cleanupExpiredVisitorAiImages,
  readAiImage,
  storeAiImage,
  validateAiImageBytes,
} from "@/lib/server/aiImageDraftStorage";
import { VALID_ONE_PIXEL_PNG_BASE64 } from "@/tests/helpers/mockAiImageProvider";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ai-image-storage-"));
  process.env.AI_IMAGE_DRAFT_STORAGE_ROOT = root;
});

afterEach(() => {
  delete process.env.AI_IMAGE_DRAFT_STORAGE_ROOT;
  rmSync(root, { recursive: true, force: true });
});

describe("private AI image storage", () => {
  it("validates content, stores an owner image atomically, and deletes by task", async () => {
    const bytes = Buffer.from(VALID_ONE_PIXEL_PNG_BASE64, "base64");
    expect(validateAiImageBytes(bytes)).toMatchObject({ mimeType: "image/png", width: 1, height: 1 });
    const stored = await storeAiImage({ accessMode: "owner", taskId: "task-1", bytes });
    expect(stored.storageKey).toMatch(/^owner\/task-1\/[0-9a-f-]+\.png$/);
    expect(await readAiImage(stored.storageKey)).toEqual(bytes);
    await cleanupAiImageTask({ accessMode: "owner", taskId: "task-1" });
    expect(await aiImageExists(stored.storageKey)).toBe(false);
  });

  it("separates visitor storage and cleans it only after expiry plus grace period", async () => {
    const stored = await storeAiImage({ accessMode: "visitor", visitorAccessId: "visitor-secret-id", taskId: "sandbox_task-1", bytes: Buffer.from(VALID_ONE_PIXEL_PNG_BASE64, "base64") });
    expect(stored.storageKey).toMatch(/^visitor\/[0-9a-f]{32}\/sandbox_task-1\//);
    expect(stored.storageKey).not.toContain("visitor-secret-id");
    const expiresAt = new Date(1_000_000).toISOString();
    expect(await cleanupExpiredVisitorAiImages({ visitorAccessId: "visitor-secret-id", expiresAt, now: 1_000_000 + AI_IMAGE_VISITOR_GRACE_MS - 1 })).toBe(false);
    expect(await aiImageExists(stored.storageKey)).toBe(true);
    expect(await cleanupExpiredVisitorAiImages({ visitorAccessId: "visitor-secret-id", expiresAt, now: 1_000_000 + AI_IMAGE_VISITOR_GRACE_MS })).toBe(true);
    expect(await aiImageExists(stored.storageKey)).toBe(false);
  });

  it("rejects traversal, non-images, invalid dimensions, and oversized files", async () => {
    await expect(readAiImage("../outside.png")).rejects.toThrow("AI_IMAGE_INVALID_STORAGE_KEY");
    expect(() => validateAiImageBytes(Buffer.from("not-image"))).toThrow("AI_IMAGE_UNSUPPORTED_CONTENT");
    expect(() => validateAiImageBytes(Buffer.alloc(AI_IMAGE_MAX_FILE_BYTES + 1))).toThrow("AI_IMAGE_FILE_TOO_LARGE");
    const badPng = Buffer.from(VALID_ONE_PIXEL_PNG_BASE64, "base64");
    badPng.writeUInt32BE(0, 16);
    expect(() => validateAiImageBytes(badPng)).toThrow("AI_IMAGE_INVALID_DIMENSIONS");
  });
});
