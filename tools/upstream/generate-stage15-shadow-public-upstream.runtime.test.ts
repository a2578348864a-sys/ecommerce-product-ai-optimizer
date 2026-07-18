import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStage15ShadowPublicUpstream } from "./generate-stage15-shadow-public-upstream";

const role = process.env.SHADOW_PUBLIC_BATCH_ROLE as "calibration" | "validation" | undefined;
const sourceFile = process.env.SHADOW_PUBLIC_SOURCE_FILE;
const outputDirectory = process.env.SHADOW_PUBLIC_OUTPUT_DIR;
const calibrationDirectory = process.env.SHADOW_PUBLIC_CALIBRATION_DIR;

describe("Stage 1.5 real public upstream runtime", () => {
  it.runIf(Boolean(role && sourceFile && outputDirectory))(
    "generates one explicitly configured real upstream-only batch",
    () => {
      if (!role || !sourceFile || !outputDirectory) throw new Error("SHADOW_PUBLIC_RUNTIME_CONFIGURATION_MISSING");
      const batchRole = role;
      const sourceMarkdown = readFileSync(sourceFile!, "utf8");
      const sourceFileSha256 = createHash("sha256").update(sourceMarkdown, "utf8").digest("hex");
      const forbiddenPlatformProductIds = batchRole === "validation"
        ? JSON.parse(readFileSync(join(calibrationDirectory!, "stage15-shadow-combined-human-evaluation-bindings.private.v1.json"), "utf8"))
          .bindings.map((binding: { platformProductId: string }) => binding.platformProductId)
        : [];
      const common = {
        sourceMarkdown,
        sourceFileSha256,
        forbiddenPlatformProductIds,
        outputDirectory: outputDirectory!,
      };
      const result = batchRole === "calibration"
        ? generateStage15ShadowPublicUpstream({
          ...common,
          role: batchRole,
          batchId: "stage15-shadow-calibration-c-20260717-01",
          manifestId: "stage15-shadow-calibration-c-manifest-20260717-01",
          briefId: "stage15-shadow-calibration-c-brief-20260717-01",
          collectionRunId: "stage15-shadow-calibration-c-run-20260717-01",
          query: "desk accessories and workspace organizers",
          category: "Desk Accessories & Workspace Organizers",
          targetScenario: "US Amazon home-office desk organization market pre-screen",
          targetPriceRange: { min: 7, max: 60 },
          sourceUrl: "https://www.amazon.com/Best-Sellers-Office-Products-Desk-Accessories-Workspace-Organizers/zgbs/office-products/1069514/ref=zg_bs_pg_2_office-products?_encoding=UTF8&pg=2",
          page: 2,
          capturedAt: "2026-07-17T04:54:03.000Z",
          accessBudget: {
            maxAggregatePageRequests: 3,
            maxDetailPageRequests: 0,
            maxAutomaticRetries: 0,
            maxImageDownloads: 0,
            actualAggregatePageRequests: 3,
            requestedUrls: [
              "https://www.amazon.com/Best-Sellers/zgbs/office-products/1069242",
              "https://www.amazon.com/Best-Sellers-Office-Products-Desk-Accessories-Workspace-Organizers/zgbs/office-products/1069514",
              "https://www.amazon.com/Best-Sellers-Office-Products-Desk-Accessories-Workspace-Organizers/zgbs/office-products/1069514/ref=zg_bs_pg_2_office-products?_encoding=UTF8&pg=2",
            ],
          },
        })
        : generateStage15ShadowPublicUpstream({
          ...common,
          role: batchRole,
          batchId: "stage15-shadow-validation-v-20260717-01",
          manifestId: "stage15-shadow-validation-v-manifest-20260717-01",
          briefId: "stage15-shadow-validation-v-brief-20260717-01",
          collectionRunId: "stage15-shadow-validation-v-run-20260717-01",
          query: "bedding, sheets, mattress protectors and pillows",
          category: "Bedding (observed page content; URL path label is inconsistent)",
          targetScenario: "US Amazon bedding market pre-screen",
          targetPriceRange: { min: 10, max: 80 },
          sourceUrl: "https://www.amazon.com/Best-Sellers-Home-Kitchen-Bathroom-Trays-Holders-Organizers/zgbs/home-garden/1063252",
          page: 1,
          capturedAt: "2026-07-17T04:54:33.000Z",
          accessBudget: {
            maxAggregatePageRequests: 3,
            maxDetailPageRequests: 0,
            maxAutomaticRetries: 0,
            maxImageDownloads: 0,
            actualAggregatePageRequests: 1,
            requestedUrls: ["https://www.amazon.com/Best-Sellers-Home-Kitchen-Bathroom-Trays-Holders-Organizers/zgbs/home-garden/1063252"],
          },
        });
      expect(result.source.importPackage.candidates).toHaveLength(20);
      expect(result.manifest.readiness).toBe("upstream_only");
      expect(result.manifest.stage15.status).toBe("pending_human_evaluation");
      expect(result.summary.boundary).toMatchObject({ candidateGenerated: false, databaseWritten: false, productionEffect: false });
    },
  );
});
