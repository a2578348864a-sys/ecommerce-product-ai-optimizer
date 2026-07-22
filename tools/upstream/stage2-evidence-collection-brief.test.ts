import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Stage2EvidenceGapInventory } from "./stage2-evidence-intake";
import type { Stage2SourcePacket } from "./stage2-advancement";
import {
  buildStage2EvidenceCollectionBrief,
  validateStage2EvidenceCollectionBrief,
} from "./stage2-evidence-collection-brief";

const ROOT = resolve(TEST_PROJECT_MATERIALS_ROOT, "06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sources() {
  return {
    inventory: readJson<Stage2EvidenceGapInventory>(resolve(ROOT, "05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json")),
    stage2Packet: readJson<Stage2SourcePacket>(resolve(ROOT, "02-盲评完成后再打开/stage2-objective-calibration-packet.v1.json")),
  };
}

describe("Stage 2 单样本公开证据采集 Brief", () => {
  it("只为 stage2-high-01 冻结供应商第一轮取证范围，不伪装成已授权", () => {
    const { inventory, stage2Packet } = sources();
    const brief = buildStage2EvidenceCollectionBrief({
      inventory,
      stage2Packet,
      sampleId: "stage2-high-01",
      createdAt: "2026-07-14T14:00:00.000Z",
    });

    expect(brief.status).toBe("pending_user_authorization");
    expect(brief.sample).toMatchObject({
      sampleId: "stage2-high-01",
      productKey: "amazon:US:B07SYPLVTG",
    });
    expect(brief.requestedScope).toMatchObject({
      requestedOrigin: "https://www.alibaba.com",
      maxTotalNavigations: 4,
      maxSearchResultPages: 1,
      maxSupplierProductPages: 3,
    });
    expect(brief.requestedEvidenceFields).toEqual([
      "supplierUrl", "supplierCapturedAt", "moq", "bom",
      "packageLengthCm", "packageWidthCm", "packageHeightCm", "packageWeightKg",
    ]);
    expect(JSON.stringify(brief)).not.toContain("humanContinueDecision");
    expect(brief.boundary).toMatchObject({
      noLogin: true,
      noCaptchaBypass: true,
      noPaidApi: true,
      noDatabaseWrite: true,
      noCandidateCreation: true,
      thisBriefIsNotAuthorization: true,
    });
    expect(validateStage2EvidenceCollectionBrief(brief).status).toBe("valid_pending_authorization");
  });

  it("相同输入得到相同 Brief 和 Hash，关键范围变化会改变 Hash", () => {
    const source = sources();
    const input = {
      ...source,
      sampleId: "stage2-high-01",
      createdAt: "2026-07-14T14:00:00.000Z",
    };
    const first = buildStage2EvidenceCollectionBrief(input);
    const second = buildStage2EvidenceCollectionBrief(input);
    const changed = structuredClone(first);
    (changed.requestedScope as unknown as { maxSupplierProductPages: number }).maxSupplierProductPages = 4;

    expect(first).toEqual(second);
    expect(validateStage2EvidenceCollectionBrief(changed).status).toBe("invalid_hash");
  });

  it("样本不存在或上游 Hash 被篡改时 fail-closed", () => {
    const source = sources();
    expect(() => buildStage2EvidenceCollectionBrief({
      ...source,
      sampleId: "stage2-unknown",
      createdAt: "2026-07-14T14:00:00.000Z",
    })).toThrow("STAGE2_COLLECTION_SAMPLE_NOT_FOUND");

    const tampered = structuredClone(source.stage2Packet);
    tampered.samples[0].productKey = "amazon:US:TAMPERED";
    expect(() => buildStage2EvidenceCollectionBrief({
      inventory: source.inventory,
      stage2Packet: tampered,
      sampleId: "stage2-high-01",
      createdAt: "2026-07-14T14:00:00.000Z",
    })).toThrow("STAGE2_COLLECTION_SOURCE_INVALID");
  });

  it("Brief 只能请求白名单字段、固定 origin 和固定访问上限", () => {
    const { inventory, stage2Packet } = sources();
    const brief = buildStage2EvidenceCollectionBrief({
      inventory,
      stage2Packet,
      sampleId: "stage2-high-01",
      createdAt: "2026-07-14T14:00:00.000Z",
    });
    const expanded = structuredClone(brief);
    (expanded.requestedEvidenceFields as string[]).push("humanDecision");
    (expanded.requestedScope as unknown as { requestedOrigin: string }).requestedOrigin = "https://example.com";
    const result = validateStage2EvidenceCollectionBrief(expanded);

    expect(result.status).toBe("invalid_hash");
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      "brief_hash_mismatch",
      "requested_evidence_fields_invalid",
      "requested_origin_invalid",
    ]));
  });
});
