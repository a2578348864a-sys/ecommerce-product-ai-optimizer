import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockChmod = vi.hoisted(() => vi.fn<(path: string, mode: number) => Promise<void>>());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    chmod: mockChmod,
  };
});

import {
  AI_IMAGE_MAX_FILE_BYTES,
  AI_IMAGE_MAX_BASE64_CHARS,
  decodeAiImageBase64,
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
  mockChmod.mockReset();
  mockChmod.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.AI_IMAGE_DRAFT_STORAGE_ROOT;
  rmSync(root, { recursive: true, force: true });
});

describe("private AI image storage", () => {
  it("validates content, stores an owner image atomically, and deletes by task", async () => {
    const bytes = Buffer.from(VALID_ONE_PIXEL_PNG_BASE64, "base64");
    await expect(validateAiImageBytes(bytes)).resolves.toMatchObject({ mimeType: "image/png", width: 1, height: 1 });
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
    await expect(validateAiImageBytes(Buffer.from("not-image"))).rejects.toThrow("AI_IMAGE_UNSUPPORTED_CONTENT");
    await expect(validateAiImageBytes(Buffer.alloc(AI_IMAGE_MAX_FILE_BYTES + 1))).rejects.toThrow("AI_IMAGE_FILE_TOO_LARGE");
    const badPng = Buffer.from(VALID_ONE_PIXEL_PNG_BASE64, "base64");
    badPng.writeUInt32BE(0, 16);
    await expect(validateAiImageBytes(badPng)).rejects.toThrow("AI_IMAGE_INVALID_DIMENSIONS");
    const excessivePixels = Buffer.from(VALID_ONE_PIXEL_PNG_BASE64, "base64");
    excessivePixels.writeUInt32BE(4096, 16);
    excessivePixels.writeUInt32BE(4096, 20);
    await expect(validateAiImageBytes(excessivePixels)).rejects.toThrow("AI_IMAGE_INVALID_DIMENSIONS");
  });

  it("rejects oversized or non-canonical base64 before allocating an image buffer", () => {
    expect(() => decodeAiImageBase64("A".repeat(AI_IMAGE_MAX_BASE64_CHARS + 4))).toThrow("AI_IMAGE_BASE64_TOO_LARGE");
    expect(() => decodeAiImageBase64(`${VALID_ONE_PIXEL_PNG_BASE64}\n`)).toThrow("AI_IMAGE_INVALID_BASE64");
    expect(decodeAiImageBase64(VALID_ONE_PIXEL_PNG_BASE64)).toEqual(Buffer.from(VALID_ONE_PIXEL_PNG_BASE64, "base64"));
  });
});

describe("cleanup safety — never deletes existing images", () => {
  const bytes = Buffer.from(VALID_ONE_PIXEL_PNG_BASE64, "base64");

  function fakePng(name: string, taskDir: string) {
    writeFileSync(join(taskDir, name), bytes);
  }

  function taskDirPath(taskId: string) {
    return join(root, "owner", taskId);
  }

  // ---- dir chmod failure on PRE-EXISTING directory ----

  it("preserves old images in an existing taskDir when dir chmod fails", async () => {
    const td = taskDirPath("existing-task");
    mkdirSync(td, { recursive: true });
    fakePng("old-image.png", td);

    // All dir chmod calls fail (first one = storage root)
    mockChmod.mockRejectedValue(new Error("EACCES"));

    await expect(
      storeAiImage({ accessMode: "owner", taskId: "existing-task", bytes }),
    ).rejects.toThrow("AI_IMAGE_CHMOD_DIR_FAILED");

    // Old image MUST still exist
    const oldExists = (() => {
      try { statSync(join(td, "old-image.png")); return true; } catch { return false; }
    })();
    expect(oldExists).toBe(true);
    // The task directory itself MUST still exist
    expect(statSync(td).isDirectory()).toBe(true);
  });

  it("preserves all old images when dir chmod fails on an existing taskDir", async () => {
    const td = taskDirPath("multi-image-task");
    mkdirSync(td, { recursive: true });
    fakePng("img-a.png", td);
    fakePng("img-b.png", td);
    fakePng("img-c.png", td);

    mockChmod.mockRejectedValue(new Error("EACCES"));

    await expect(
      storeAiImage({ accessMode: "owner", taskId: "multi-image-task", bytes }),
    ).rejects.toThrow("AI_IMAGE_CHMOD_DIR_FAILED");

    const files = readdirSync(td);
    expect(files).toContain("img-a.png");
    expect(files).toContain("img-b.png");
    expect(files).toContain("img-c.png");
    expect(files.length).toBe(3);
  });

  // ---- dir chmod failure on NEWLY-CREATED directory ----

  it("removes an empty newly-created taskDir when dir chmod fails", async () => {
    const td = taskDirPath("new-task");
    // Ensure it doesn't exist
    try { rmSync(td, { recursive: true, force: true }); } catch {}

    mockChmod.mockRejectedValue(new Error("EACCES"));

    await expect(
      storeAiImage({ accessMode: "owner", taskId: "new-task", bytes }),
    ).rejects.toThrow("AI_IMAGE_CHMOD_DIR_FAILED");

    // Newly-created empty dir should be cleaned up
    const dirExists = (() => {
      try { statSync(td); return true; } catch { return false; }
    })();
    expect(dirExists).toBe(false);
  });

  it("does NOT delete storage root when dir chmod fails", async () => {
    mockChmod.mockRejectedValue(new Error("EACCES"));

    await expect(
      storeAiImage({ accessMode: "owner", taskId: "root-safe", bytes }),
    ).rejects.toThrow("AI_IMAGE_CHMOD_DIR_FAILED");

    // Storage root MUST still exist
    expect(statSync(root).isDirectory()).toBe(true);
  });

  it("does NOT delete the Owner scope directory when dir chmod fails", async () => {
    // Pre-populate to ensure owner dir exists
    await storeAiImage({ accessMode: "owner", taskId: "prepop", bytes });
    mockChmod.mockReset();
    mockChmod.mockRejectedValue(new Error("EACCES"));

    await expect(
      storeAiImage({ accessMode: "owner", taskId: "owner-safe", bytes }),
    ).rejects.toThrow("AI_IMAGE_CHMOD_DIR_FAILED");

    const ownerDir = join(root, "owner");
    expect(statSync(ownerDir).isDirectory()).toBe(true);
  });

  // ---- file chmod failure ----

  it("only deletes this call's finalPath on file chmod failure, preserves old images", async () => {
    const td = taskDirPath("file-fail-task");
    mkdirSync(td, { recursive: true });
    fakePng("old-image.png", td);

    // All dir chmod calls succeed, file chmod fails
    mockChmod.mockResolvedValueOnce(undefined); // root
    mockChmod.mockResolvedValueOnce(undefined); // owner
    mockChmod.mockResolvedValueOnce(undefined); // task dir
    mockChmod.mockRejectedValueOnce(new Error("EACCES")); // final file

    await expect(
      storeAiImage({ accessMode: "owner", taskId: "file-fail-task", bytes }),
    ).rejects.toThrow("AI_IMAGE_CHMOD_FILE_FAILED");

    // Old image MUST still exist
    expect(statSync(join(td, "old-image.png")).isFile()).toBe(true);
    // Task directory MUST still exist
    expect(statSync(td).isDirectory()).toBe(true);
    // Only 1 file (the old image) should remain
    const files = readdirSync(td);
    expect(files).toEqual(["old-image.png"]);
  });

  it("deletes finalPath and tempPath on file chmod failure", async () => {
    // All dir chmod calls succeed, file chmod fails
    mockChmod.mockResolvedValueOnce(undefined); // root
    mockChmod.mockResolvedValueOnce(undefined); // owner
    mockChmod.mockResolvedValueOnce(undefined); // task dir
    mockChmod.mockRejectedValueOnce(new Error("EACCES")); // file

    await expect(
      storeAiImage({ accessMode: "owner", taskId: "file-fail-cleanup", bytes }),
    ).rejects.toThrow("AI_IMAGE_CHMOD_FILE_FAILED");

    // No .part or .png files should remain
    const td = taskDirPath("file-fail-cleanup");
    const files = readdirSync(td);
    const partFiles = files.filter((f) => f.endsWith(".part"));
    const pngFiles = files.filter((f) => f.endsWith(".png"));
    expect(partFiles.length).toBe(0);
    expect(pngFiles.length).toBe(0);
  });

  // ---- other tasks completely preserved ----

  it("does not affect other task directories on failure", async () => {
    // Successfully store an image for task-A
    mockChmod.mockResolvedValue(undefined);
    await storeAiImage({ accessMode: "owner", taskId: "task-A", bytes });

    // Now try task-B with chmod failure
    mockChmod.mockReset();
    mockChmod.mockRejectedValue(new Error("EACCES"));
    await expect(
      storeAiImage({ accessMode: "owner", taskId: "task-B", bytes }),
    ).rejects.toThrow();

    // task-A must be completely intact
    const taskADir = taskDirPath("task-A");
    expect(statSync(taskADir).isDirectory()).toBe(true);
    const taskAFiles = readdirSync(taskADir);
    expect(taskAFiles.length).toBeGreaterThanOrEqual(1);
  });

  // ---- chmod 0700/0600 logic still passes ----

  it("chmods root to 0o700", async () => {
    await storeAiImage({ accessMode: "owner", taskId: "chmod-root", bytes });
    const rootCalls = mockChmod.mock.calls.filter(([p, m]) => p === root && m === 0o700);
    expect(rootCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("chmods the dir chain to 0o700 (root + scope + task-dir)", async () => {
    await storeAiImage({ accessMode: "owner", taskId: "chmod-chain", bytes });
    const dirCalls = mockChmod.mock.calls.filter(([_p, m]) => m === 0o700);
    expect(dirCalls.length).toBeGreaterThanOrEqual(3);
  });

  it("chmods the final file to 0o600", async () => {
    await storeAiImage({ accessMode: "owner", taskId: "chmod-file", bytes });
    const fileCalls = mockChmod.mock.calls.filter(([_p, m]) => m === 0o600);
    expect(fileCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ---- Owner/Visitor isolation ----

  it("preserves Owner/Visitor directory isolation", async () => {
    await storeAiImage({ accessMode: "owner", taskId: "isolated", bytes });
    await storeAiImage({ accessMode: "visitor", visitorAccessId: "vid-1", taskId: "isolated", bytes });

    const ownerCalls = mockChmod.mock.calls.filter(([p]) =>
      p.includes("owner") && !p.includes("visitor"),
    );
    const visitorCalls = mockChmod.mock.calls.filter(([p]) =>
      p.includes("visitor"),
    );
    expect(ownerCalls.length).toBeGreaterThan(0);
    expect(visitorCalls.length).toBeGreaterThan(0);
  });

  // ---- path traversal still blocked ----

  it("still blocks path traversal", async () => {
    await expect(readAiImage("../outside.png")).rejects.toThrow("AI_IMAGE_INVALID_STORAGE_KEY");
  });

  // ---- read-back works ----

  it("can read back a stored image after safe storage", async () => {
    const stored = await storeAiImage({ accessMode: "owner", taskId: "readback", bytes });
    const result = await readAiImage(stored.storageKey);
    expect(result).toEqual(bytes);
  });

  // ---- chmod ok, write ok, everything works ----

  it("stores successfully and returns correct storageKey", async () => {
    const stored = await storeAiImage({ accessMode: "owner", taskId: "success", bytes });
    expect(stored.storageKey).toMatch(/^owner\/success\/[0-9a-f-]+\.png$/);
    expect(stored.mimeType).toBe("image/png");
  });
});
