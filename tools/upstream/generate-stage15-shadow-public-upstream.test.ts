import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateStage15ShadowPublicUpstream } from "./generate-stage15-shadow-public-upstream";

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { force: true, recursive: true }));
});

function entry(index: number) {
  const asin = `B0${String(index).padStart(8, "0")}`;
  return `${index}. #${index} [![Image ${index}: Desk Organizer ${index}](https://images-na.ssl-images-amazon.com/images/I/image${index}._AC_UL600.jpg)](https://www.amazon.com/item-${index}/dp/${asin}/ref=rank)[Desk Organizer ${index}](https://www.amazon.com/item-${index}/dp/${asin}/ref=rank)[_4.7 out of 5 stars_ ${1_000 + index}](https://www.amazon.com/product-reviews/${asin}) [$${10 + index}.99](https://www.amazon.com/item-${index}/dp/${asin})\n`;
}

function input(outputDirectory: string) {
  const sourceMarkdown = Array.from({ length: 20 }, (_, index) => entry(index + 1)).join("\n");
  return {
    role: "calibration" as const,
    batchId: "shadow-c-20260717",
    manifestId: "shadow-c-manifest-20260717",
    briefId: "brief-shadow-c-20260717",
    collectionRunId: "run-shadow-c-20260717",
    query: "desk accessories and workspace organizers",
    category: "Desk Accessories & Workspace Organizers",
    targetScenario: "US Amazon desk organization market pre-screen",
    targetPriceRange: { min: 8, max: 45 },
    sourceUrl: "https://www.amazon.com/Best-Sellers/zgbs/office-products/1069514",
    sourceMarkdown,
    sourceFileSha256: createHash("sha256").update(sourceMarkdown, "utf8").digest("hex"),
    page: 1 as const,
    capturedAt: "2026-07-17T04:54:03.000Z",
    accessBudget: {
      maxAggregatePageRequests: 3,
      maxDetailPageRequests: 0,
      maxAutomaticRetries: 0,
      maxImageDownloads: 0,
      actualAggregatePageRequests: 1,
      requestedUrls: ["https://www.amazon.com/Best-Sellers/zgbs/office-products/1069514"],
    },
    forbiddenPlatformProductIds: [] as string[],
    outputDirectory,
  };
}

describe("Stage 1.5 real public upstream generator", () => {
  it("writes an upstream-only, hash-bound and blinded 20-item batch idempotently", () => {
    const root = mkdtempSync(join(tmpdir(), "stage15-shadow-public-"));
    roots.push(root);
    const first = generateStage15ShadowPublicUpstream(input(root));
    const second = generateStage15ShadowPublicUpstream(input(root));
    expect(first.artifactWrite.written.length).toBeGreaterThanOrEqual(10);
    expect(second.artifactWrite.written).toEqual([]);
    expect(second.artifactWrite.unchanged).toEqual(first.files);

    const manifest = JSON.parse(readFileSync(join(root, "stage15-shadow-upstream-manifest.v1.json"), "utf8"));
    const packet = JSON.parse(readFileSync(join(root, "stage15-shadow-combined-human-evaluation-packet.v1.json"), "utf8"));
    const template = JSON.parse(readFileSync(join(root, "stage15-shadow-combined-human-evaluation-result-template.v1.json"), "utf8"));
    expect(manifest.readiness).toBe("upstream_only");
    expect(manifest.stage15.status).toBe("pending_human_evaluation");
    expect(manifest.boundary).toMatchObject({ candidateGenerated: false, databaseWritten: false, productionEffect: false });
    expect(packet.items).toHaveLength(20);
    expect(template.answers).toHaveLength(20);
    expect(template.answers.every((answer: Record<string, unknown>) => answer.productUnderstood === null
      && answer.worthFurtherInvestigation === null)).toBe(true);
    const publicPacket = JSON.stringify(packet);
    expect(publicPacket).not.toContain("B000000001");
    expect(publicPacket).not.toContain("productKey");
    expect(publicPacket).not.toContain("candidateId");
    expect(publicPacket).not.toContain("promotionDecision");
    expect(publicPacket).toContain("imageUrl");
    expect(publicPacket).toContain("reviewCount");
    expect(publicPacket).toContain("categoryRank");
  });

  it("fails closed when a validation identity overlaps the frozen calibration set", () => {
    const root = mkdtempSync(join(tmpdir(), "stage15-shadow-overlap-"));
    roots.push(root);
    expect(() => generateStage15ShadowPublicUpstream({
      ...input(root),
      role: "validation",
      forbiddenPlatformProductIds: ["B000000001"],
    })).toThrow("SHADOW_PUBLIC_BATCH_IDENTITY_OVERLAP");
  });
});
