/**
 * [诊断用] AI Image 存储路径复现 —— 不调用任何 Provider，零成本。
 *
 * 载荷 = 本次真实调用 A1/A2 从中转站取回的**同一批字节**（正是线上落盘失败的那两张）。
 * 写入目标为系统临时目录，不触碰生产存储根，运行后自行清理。
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeAiImageBase64, quarantineAiImage, resolveAiImageStorageKey, storeAiImage, validateAiImageBytes } from "@/lib/server/aiImageDraftStorage";

const REAL_IMAGES = [
  { id: "A1", path: "D:/Workspace/image-studio-v21-evidence/2026-09-14T20-35-26/images/A1.png", bytes: 3535943 },
  { id: "A2", path: "D:/Workspace/image-studio-v21-evidence/2026-09-14T20-35-26/images/A2.png", bytes: 3593836 },
];

const tempRoot = mkdtempSync(join(tmpdir(), "ai-img-diag-"));
const originalRoot = process.env.AI_IMAGE_DRAFT_STORAGE_ROOT;
process.env.AI_IMAGE_DRAFT_STORAGE_ROOT = tempRoot;

afterAll(() => {
  if (originalRoot === undefined) delete process.env.AI_IMAGE_DRAFT_STORAGE_ROOT;
  else process.env.AI_IMAGE_DRAFT_STORAGE_ROOT = originalRoot;
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("[diag] quarantine keeps paid bytes that FAIL validation", () => {
  it("校验失败的字节被留档，且隔离区不可经由公开 storageKey 读取", async () => {
    // 故意用「不是图片」的字节：模拟真实事故里被校验拒绝的返回内容
    const junk = Buffer.from("THIS IS NOT AN IMAGE BUT IT WAS PAID FOR", "utf8");
    await expect(validateAiImageBytes(junk)).rejects.toThrow();

    const q = await quarantineAiImage({
      accessMode: "owner",
      taskId: "diag-task-q",
      bytes: junk,
      reason: "AI_IMAGE_UNSUPPORTED_CONTENT",
    });
    expect(q.fileSizeBytes).toBe(junk.length);
    expect(q.quarantineKey.startsWith("_quarantine/owner/diag-task-q/")).toBe(true);

    // 字节确实落盘且可原样取回（key 是相对存储根的真实路径）
    const stored = readFileSync(join(tempRoot, q.quarantineKey));
    expect(stored.equals(junk)).toBe(true);
    // 失败原因随档保留，便于事后判因
    expect(readFileSync(join(tempRoot, q.quarantineKey.replace(/\.bin$/, ".reason.txt")), "utf8"))
      .toContain("AI_IMAGE_UNSUPPORTED_CONTENT");

    // 隔离区绝不进入公开读取路径（readAiImage / resolveAiImageStorageKey 只认正式资产）
    expect(() => resolveAiImageStorageKey(q.quarantineKey)).toThrow();
  });

  it("隔离区拒绝空字节与超限字节（防磁盘滥用）", async () => {
    await expect(quarantineAiImage({ accessMode: "owner", taskId: "t", bytes: Buffer.alloc(0) }))
      .rejects.toThrow("AI_IMAGE_EMPTY_FILE");
    await expect(quarantineAiImage({ accessMode: "owner", taskId: "t", bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }))
      .rejects.toThrow("AI_IMAGE_FILE_TOO_LARGE");
  });
});

describe("[diag] storage path on the EXACT bytes that failed in production", () => {
  for (const image of REAL_IMAGES) {
    it(`${image.id}: decode -> validate -> store 必须成功`, async () => {
      if (!existsSync(image.path)) {
        console.log(`[diag] ${image.id} missing at ${image.path} — skipped`);
        return;
      }
      const png = readFileSync(image.path);
      console.log(`[diag] ${image.id} bytes=${png.length} (expected ${image.bytes})`);
      expect(png.length).toBe(image.bytes);

      const base64 = png.toString("base64");
      console.log(`[diag] ${image.id} base64Chars=${base64.length}`);
      const decoded = decodeAiImageBase64(base64);
      expect(decoded.length).toBe(png.length);

      const validated = await validateAiImageBytes(decoded);
      console.log(`[diag] ${image.id} validated ${validated.mimeType} ${validated.width}x${validated.height}`);

      const stored = await storeAiImage({ accessMode: "owner", taskId: "diag-task-001", bytes: decoded });
      console.log(`[diag] ${image.id} STORED OK -> ${stored.storageKey}`);
      expect(stored.width).toBe(1536);
      expect(stored.height).toBe(1024);
    }, 120_000);
  }
});
