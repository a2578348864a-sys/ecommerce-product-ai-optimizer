import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  SELLERSPRITE_SANITIZED_ROWS,
} from "../../../lib/upstream/sellersprite/fixtures/search-export.sanitized.v1";
import { rankSellerSpriteMarketSignals } from "../../../lib/upstream/sellersprite/marketSignalRanking";
import {
  SellerSpritePreviewError,
  runSellerSpritePreview,
} from "./runner";
import { createSellerSpritePreviewTestWorkbook } from "./test-fixtures";

describe("SellerSprite local preview Ranking v2 report", () => {
  it("publishes a whitelisted Ranking v2 JSON, Chinese Markdown, and bound Manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "sellersprite-ranking-report-"));
    try {
      const input = join(root, "search.xlsx");
      const output = join(root, "output");
      writeFileSync(input, createSellerSpritePreviewTestWorkbook({
        rows: [
          SELLERSPRITE_SANITIZED_ROWS[0],
          {
            ...SELLERSPRITE_SANITIZED_ROWS[1],
            月销量: "",
            "月销售额($)": "",
          },
        ],
      }));

      const result = runSellerSpritePreview({
        kind: "run",
        reportType: "search_results",
        input,
        query: "storage boxes",
        category: "Storage & Organization",
        priceMin: 20,
        priceMax: 100,
        outputDir: output,
        format: "both",
      }, {
        repositoryRoot: join(root, "repository"),
        now: () => "2026-07-27T02:00:00.000Z",
      });

      const jsonText = readFileSync(join(output, "sellersprite-preview.json"), "utf8");
      const markdown = readFileSync(join(output, "sellersprite-preview.md"), "utf8");
      const manifestText = readFileSync(
        join(output, "sellersprite-preview-manifest.json"),
        "utf8",
      );
      const report = JSON.parse(jsonText) as {
        schemaVersion: string;
        ranking: {
          schemaVersion: string;
          modelVersion: string;
          rankingHash: string;
          reportType: string;
          productCount: number;
          rankableProductCount: number;
          unrankedProductCount: number;
          familyResearchListCount: number;
          products: Array<Record<string, unknown> & {
            asin: string;
            scoreRank: number | null;
            signalScore: number | null;
            evidenceCoverage: number;
            evidenceStatus: string;
            evidenceStatusLabel: string;
            researchPriority: string;
            researchPriorityLabel: string;
            missingSignals: string[];
            missingSignalLabels: string[];
            positiveReasons: Array<{ code: string; label: string }>;
            counterSignals: Array<{ code: string; label: string }>;
            components: Array<{
              component: string;
              label: string;
              sourceType: string;
              explanation: string;
            }>;
            promotionEligible: boolean;
          }>;
          safety: {
            authoritative: boolean;
            currentStage1Invoked: boolean;
            hardGateEvaluable: boolean;
            promotionEligible: boolean;
            manifestRegistered: boolean;
            productionEffect: boolean;
            productionDatabaseWritten: boolean;
          };
        };
      };
      const manifest = JSON.parse(manifestText) as {
        schemaVersion: string;
        reportSchemaVersion: string;
        rankingSchemaVersion: string;
        modelVersion: string;
        rankingHash: string;
        jsonFileSha256: string;
        markdownFileSha256: string;
      };

      expect(report.schemaVersion).toBe("sellersprite-local-preview-report.v3");
      expect(report.ranking).toMatchObject({
        schemaVersion: "sellersprite-market-signal-ranking.v2",
        modelVersion: "sellersprite-market-signal-ranking.search.v2",
        reportType: "search_results",
        productCount: 2,
        rankableProductCount: 1,
        unrankedProductCount: 1,
      });
      expect(report.ranking.rankingHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(report.ranking.products).toHaveLength(2);
      expect(report.ranking.products.every((product) => (
        typeof product.evidenceStatusLabel === "string"
        && typeof product.researchPriorityLabel === "string"
        && product.promotionEligible === false
      ))).toBe(true);
      expect(report.ranking.products.every((product) => (
        !("order" in product)
        && !("componentEvidence" in product)
        && !("providerMetrics" in product)
        && !("extraRaw" in product)
      ))).toBe(true);
      expect(report.ranking.products.flatMap((product) => product.components))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({
            component: "organicVisibility",
            label: "自然位可见性",
            sourceType: "provider_metric",
          }),
          expect.objectContaining({
            component: "sponsoredExposure",
            label: "广告曝光",
            sourceType: "provider_metric",
          }),
        ]));
      const unranked = report.ranking.products.find((product) => product.scoreRank === null);
      expect(unranked).toMatchObject({
        signalScore: null,
        evidenceStatusLabel: "证据有限，暂不参与排名",
        researchPriorityLabel: "暂不排名：证据不足或存在冲突",
      });
      expect(unranked?.missingSignalLabels).toContain("缺少预估月销量");
      expect(report.ranking.safety).toEqual({
        authoritative: false,
        currentStage1Invoked: false,
        hardGateEvaluable: false,
        promotionEligible: false,
        manifestRegistered: false,
        productionEffect: false,
        productionDatabaseWritten: false,
      });

      expect(markdown).toContain("# 市场信号排序（非正式）");
      expect(markdown).toContain("## 优先研究商品");
      expect(markdown).toContain("市场信号分");
      expect(markdown).toContain("证据覆盖度");
      expect(markdown).toContain("优先研究组 1");
      expect(markdown).toContain("正向理由");
      expect(markdown).toContain("主要反向信号");
      expect(markdown).toContain("已知证据条件分（不用于排名）");
      expect(markdown).toContain("## 暂不排名商品");
      expect(markdown).toContain("未计算正式比较分");
      expect(markdown).toContain("## 家族研究列表");
      expect(markdown).toContain("广告位仅代表付费曝光，不等于自然需求");
      expect(markdown).not.toMatch(
        /provisionalDisposition|product_field_partial|sufficient_for_comparison|limited_evidence|insufficient_evidence|priority_[123]|unranked_insufficient_evidence/u,
      );
      expect(markdown).not.toMatch(/\b[a-z]+_[a-z0-9_]+\b/u);
      expect(markdown).not.toContain(["Amazon", "真实订单"].join(" "));
      expect(markdown).not.toMatch(/\b(?:advance|watch|reject|promoted)\b/u);

      expect(manifest).toMatchObject({
        schemaVersion: "sellersprite-local-preview-manifest.v3",
        reportSchemaVersion: "sellersprite-local-preview-report.v3",
        rankingSchemaVersion: "sellersprite-market-signal-ranking.v2",
        modelVersion: "sellersprite-market-signal-ranking.search.v2",
        rankingHash: report.ranking.rankingHash,
        jsonFileSha256: createHash("sha256").update(jsonText).digest("hex"),
        markdownFileSha256: createHash("sha256").update(markdown).digest("hex"),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed before writing when Ranking integrity does not match the Snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "sellersprite-ranking-integrity-"));
    try {
      const input = join(root, "search.xlsx");
      const output = join(root, "output");
      writeFileSync(input, createSellerSpritePreviewTestWorkbook({
        rows: SELLERSPRITE_SANITIZED_ROWS,
      }));

      expect(() => runSellerSpritePreview({
        kind: "run",
        reportType: "search_results",
        input,
        query: "storage boxes",
        category: "Storage & Organization",
        priceMin: 20,
        priceMax: 100,
        outputDir: output,
        format: "both",
      }, {
        repositoryRoot: join(root, "repository"),
        now: () => "2026-07-27T02:00:00.000Z",
        rankSignals: (rankingInput) => ({
          ...rankSellerSpriteMarketSignals(rankingInput),
          normalizedBusinessHash: "0".repeat(64),
        }),
      })).toThrow(expect.objectContaining({
        code: "ranking_integrity_failed",
        exitCode: 7,
      }) satisfies Partial<SellerSpritePreviewError>);
      expect(() => readFileSync(join(output, "sellersprite-preview.json"), "utf8"))
        .toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
