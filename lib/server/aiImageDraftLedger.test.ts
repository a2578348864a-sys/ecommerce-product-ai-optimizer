import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginAiImageRequest, buildAiImageIdempotencyScopeHash, buildAiImageRequestHash, getAiImageRequest, updateAiImageRequest } from "@/lib/server/aiImageDraftLedger";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ai-image-ledger-"));
  process.env.AI_IMAGE_DRAFT_LEDGER_PATH = join(root, "ledger.json");
});

afterEach(() => {
  delete process.env.AI_IMAGE_DRAFT_LEDGER_PATH;
  rmSync(root, { recursive: true, force: true });
});

describe("AI image request ledger", () => {
  it("scopes hashes by access and returns one durable entry for duplicate starts", () => {
    const identity = { accessMode: "owner" as const, accessScope: "owner", taskId: "task-1", idempotencyKey: "key-1" };
    const semantics = { imageType: "white_background_concept" as const, count: 1 as const };
    const hash = buildAiImageRequestHash({ ...identity, ...semantics });
    const scopeHash = buildAiImageIdempotencyScopeHash(identity);
    expect(hash).not.toBe(buildAiImageRequestHash({ ...identity, imageType: "lifestyle_scene", count: 1 }));
    expect(hash).not.toBe(buildAiImageRequestHash({ ...identity, ...semantics, accessMode: "visitor", accessScope: "visitor-1" }));
    expect(beginAiImageRequest({ requestHash: hash, idempotencyScopeHash: scopeHash, taskId: "task-1", accessMode: "owner" }).created).toBe(true);
    expect(beginAiImageRequest({ requestHash: hash, idempotencyScopeHash: scopeHash, taskId: "task-1", accessMode: "owner" })).toMatchObject({ created: false, conflict: false });
    const conflictHash = buildAiImageRequestHash({ ...identity, imageType: "lifestyle_scene", count: 1 });
    expect(beginAiImageRequest({ requestHash: conflictHash, idempotencyScopeHash: scopeHash, taskId: "task-1", accessMode: "owner" })).toMatchObject({ created: false, conflict: true });
    updateAiImageRequest({ requestHash: hash, status: "committed", itemIds: ["item-1"] });
    expect(getAiImageRequest(hash)).toMatchObject({ status: "committed", itemIds: ["item-1"] });
    updateAiImageRequest({ requestHash: hash, status: "refunded", errorCode: "late-change" });
    expect(getAiImageRequest(hash)?.status).toBe("committed");
  });

  it("fails closed when the durable ledger is corrupt", () => {
    writeFileSync(process.env.AI_IMAGE_DRAFT_LEDGER_PATH!, "not-json", "utf8");
    expect(() => beginAiImageRequest({ requestHash: "a".repeat(64), idempotencyScopeHash: "b".repeat(64), taskId: "task-1", accessMode: "owner" })).toThrow("AI_IMAGE_LEDGER_CORRUPT");
  });
});
