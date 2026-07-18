import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateStage15ShadowPublicUpstream } from "./generate-stage15-shadow-public-upstream";
import { generateStage15ShadowDetailAccessRequest } from "./generate-stage15-shadow-detail-access-request";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { force: true, recursive: true })));

function entry(index: number) {
  const asin = `B0${String(index).padStart(8, "0")}`;
  return `${index}. #${index} [![Image ${index}: Organizer ${index}](https://images.example.test/${index}.jpg)](https://www.amazon.com/item-${index}/dp/${asin}/ref=rank)[Organizer ${index}](https://www.amazon.com/item-${index}/dp/${asin}/ref=rank)[_4.7 out of 5 stars_ ${1_000 + index}](https://www.amazon.com/product-reviews/${asin}) [$${10 + index}.99](https://www.amazon.com/item-${index}/dp/${asin})\n`;
}

function fixture(role: "calibration" | "validation" = "calibration") {
  const root = mkdtempSync(join(tmpdir(), "stage15-detail-request-"));
  roots.push(root);
  const sourceMarkdown = Array.from({ length: 20 }, (_, index) => entry(index + 1)).join("\n");
  generateStage15ShadowPublicUpstream({
    role,
    batchId: role === "calibration" ? "stage15-shadow-calibration-c-20260717-01" : "stage15-shadow-validation-v-20260717-01",
    manifestId: role === "calibration" ? "manifest-c" : "manifest-v",
    briefId: role === "calibration" ? "brief-c" : "brief-v",
    collectionRunId: role === "calibration" ? "run-c" : "run-v",
    query: "desk organizers",
    category: "Desk Organizers",
    targetScenario: "desk organization",
    targetPriceRange: { min: 8, max: 45 },
    sourceUrl: "https://www.amazon.com/Best-Sellers/zgbs/office-products/1069514",
    sourceMarkdown,
    sourceFileSha256: createHash("sha256").update(sourceMarkdown, "utf8").digest("hex"),
    page: 1,
    capturedAt: "2026-07-17T05:00:00.000Z",
    accessBudget: {
      maxAggregatePageRequests: 1,
      maxDetailPageRequests: 0,
      maxAutomaticRetries: 0,
      maxImageDownloads: 0,
      actualAggregatePageRequests: 1,
      requestedUrls: ["https://www.amazon.com/Best-Sellers/zgbs/office-products/1069514"],
    },
    forbiddenPlatformProductIds: [],
    outputDirectory: root,
  });
  return root;
}

describe("Stage 1.5 detail access request generator", () => {
  it("writes an idempotent pending request and a human-evaluation hold gate without changing the source manifest", () => {
    const root = fixture();
    const manifestFile = join(root, "stage15-shadow-upstream-manifest.v1.json");
    const before = createHash("sha256").update(readFileSync(manifestFile)).digest("hex");
    const first = generateStage15ShadowDetailAccessRequest({
      batchDirectory: root,
      createdAt: "2026-07-17T06:30:00.000Z",
    });
    const second = generateStage15ShadowDetailAccessRequest({
      batchDirectory: root,
      createdAt: "2026-07-17T06:30:00.000Z",
    });
    expect(first.artifactWrite.written).toHaveLength(4);
    expect(second.artifactWrite.unchanged).toEqual(first.files);
    expect(first.request).toMatchObject({ authorizationStatus: "pending_user_approval", executionAllowed: false });
    expect(first.request.targets).toHaveLength(20);
    expect(first.startGate).toMatchObject({
      status: "hold_pending_detail_access_decision",
      humanEvaluationAllowed: false,
      existingWorkbenchInvalidated: false,
    });
    expect(createHash("sha256").update(readFileSync(manifestFile)).digest("hex")).toBe(before);
  });

  it("rejects validation batches and source artifacts whose hash binding drifted", () => {
    expect(() => generateStage15ShadowDetailAccessRequest({
      batchDirectory: fixture("validation"),
      createdAt: "2026-07-17T06:30:00.000Z",
    })).toThrow("SHADOW_DETAIL_REQUEST_CALIBRATION_ONLY");
  });
});
