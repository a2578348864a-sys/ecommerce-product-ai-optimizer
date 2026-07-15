import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateStage2EvidenceCollectionBrief } from "./generate-stage2-evidence-collection-brief";

const ROOT = resolve(process.cwd(), "../06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01");
const temporaryDirectories: string[] = [];

afterEach(() => temporaryDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe("Stage 2 collection brief generator", () => {
  it("生成 pending authorization 的单样本 Brief、中文确认材料和摘要", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "stage2-collection-brief-"));
    temporaryDirectories.push(outputDirectory);
    const result = generateStage2EvidenceCollectionBrief({
      inventoryFile: resolve(ROOT, "05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json"),
      stage2PacketFile: resolve(ROOT, "02-盲评完成后再打开/stage2-objective-calibration-packet.v1.json"),
      sampleId: "stage2-high-01",
      createdAt: "2026-07-14T14:00:00.000Z",
      outputDirectory,
    });

    expect(result).toMatchObject({ status: "valid_pending_authorization", sampleId: "stage2-high-01" });
    const brief = JSON.parse(readFileSync(join(outputDirectory, "stage2-evidence-collection-brief.v1.json"), "utf8"));
    const guide = readFileSync(join(outputDirectory, "README-授权前请确认.md"), "utf8");
    expect(brief.status).toBe("pending_user_authorization");
    expect(brief.authorization.status).toBe("not_granted");
    expect(guide).toContain("本文件不是授权");
    expect(guide).toContain("最多 4 次页面导航");
    expect(guide).toContain("不会自动执行");

    const replay = generateStage2EvidenceCollectionBrief({
      inventoryFile: resolve(ROOT, "05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json"),
      stage2PacketFile: resolve(ROOT, "02-盲评完成后再打开/stage2-objective-calibration-packet.v1.json"),
      sampleId: "stage2-high-01",
      createdAt: "2026-07-14T14:00:00.000Z",
      outputDirectory,
    });
    expect(replay.artifactWrite).toEqual({ written: [], unchanged: result.files });
    writeFileSync(join(outputDirectory, result.files[0]), "conflict\n", "utf8");
    expect(() => generateStage2EvidenceCollectionBrief({
      inventoryFile: resolve(ROOT, "05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json"),
      stage2PacketFile: resolve(ROOT, "02-盲评完成后再打开/stage2-objective-calibration-packet.v1.json"),
      sampleId: "stage2-high-01",
      createdAt: "2026-07-14T14:00:00.000Z",
      outputDirectory,
    })).toThrow("STAGE2_COLLECTION_BRIEF_OUTPUT_CONFLICT");
  });
});
