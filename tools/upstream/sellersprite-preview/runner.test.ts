import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  SELLERSPRITE_SANITIZED_ROWS,
  SELLERSPRITE_SEARCH_EXPORT_HEADERS,
} from "../../../lib/upstream/sellersprite/fixtures/search-export.sanitized.v1";
import {
  SELLERSPRITE_PREVIEW_HELP,
  SELLERSPRITE_PREVIEW_EXIT_CODES,
  SellerSpritePreviewError,
  parseSellerSpritePreviewArgs,
  runSellerSpritePreview,
  runSellerSpritePreviewCli,
} from "./runner";
import { createSellerSpritePreviewTestWorkbook } from "./test-fixtures";

function runArgs(input: string, outputDir: string | null) {
  return {
    kind: "run" as const,
    reportType: "search_results" as const,
    input,
    query: "storage boxes",
    category: "Storage & Organization",
    priceMin: 20,
    priceMax: 100,
    outputDir,
    format: "both" as const,
  };
}

function expectPreviewError(
  action: () => unknown,
  code: string,
  exitCode: number,
): void {
  try {
    action();
    throw new Error("expected preview to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(SellerSpritePreviewError);
    expect(error).toMatchObject({ code, exitCode });
  }
}

describe("SellerSprite local preview CLI", () => {
  it("returns the documented help contract without requiring report arguments", () => {
    expect(parseSellerSpritePreviewArgs(["--help"])).toEqual({ kind: "help" });
    expect(SELLERSPRITE_PREVIEW_HELP).toContain("仅支持 amazon.com / US / USD");
    expect(SELLERSPRITE_PREVIEW_HELP).toContain("不连接数据库或生产系统");
  });

  it("parses the explicit US/USD preview arguments without guessing values", () => {
    expect(parseSellerSpritePreviewArgs([
      "--report-type", "search-results",
      "--input", "sample.xlsx",
      "--query", "  storage boxes ",
      "--category", " Storage & Organization ",
      "--price-min", "20",
      "--price-max", "100",
      "--output-dir", "reports",
    ])).toEqual({
      kind: "run",
      reportType: "search_results",
      input: "sample.xlsx",
      query: "storage boxes",
      category: "Storage & Organization",
      priceMin: 20,
      priceMax: 100,
      outputDir: "reports",
      format: "both",
    });
  });

  it.each([
    [[], "input_required"],
    [["--input", "sample.xlsx"], "query_required"],
    [[
      "--input", "sample.xlsx",
      "--query", "   ",
      "--category", "Storage",
      "--price-min", "20",
      "--price-max", "100",
    ], "query_required"],
    [[
      "--input", "sample.xlsx",
      "--query", "boxes",
      "--price-min", "20",
      "--price-max", "100",
    ], "category_required"],
    [[
      "--input", "sample.xlsx",
      "--query", "boxes",
      "--category", "Storage",
      "--price-min", "not-a-number",
      "--price-max", "100",
    ], "price_min_invalid"],
    [[
      "--input", "sample.xlsx",
      "--query", "boxes",
      "--category", "Storage",
      "--price-min", "20",
      "--price-max", "not-a-number",
    ], "price_max_invalid"],
    [[
      "--input", "sample.xlsx",
      "--query", "boxes",
      "--category", "Storage",
      "--price-min", "-1",
      "--price-max", "100",
    ], "price_min_invalid"],
    [[
      "--input", "sample.xlsx",
      "--query", "boxes",
      "--category", "Storage",
      "--price-min", "20",
      "--price-max", "-1",
    ], "price_max_invalid"],
    [[
      "--input", "sample.xlsx",
      "--query", "boxes",
      "--category", "Storage",
      "--price-min", "101",
      "--price-max", "100",
    ], "price_range_invalid"],
    [[
      "--input", "sample.xlsx",
      "--query", "boxes",
      "--category", "Storage",
      "--price-min", "20",
      "--price-max", "100",
      "--format", "xml",
    ], "format_invalid"],
    [[
      "--input", "sample.xlsx",
      "--query", "boxes",
      "--category", "Storage",
      "--price-min", "20",
      "--price-max", "100",
      "--market", "US",
    ], "unsupported_argument"],
    [[
      "--input", "sample.xlsx",
      "--query", "boxes",
      "--category", "Storage",
      "--price-min", "20",
      "--price-max", "100",
      "--currency", "USD",
    ], "unsupported_argument"],
  ] as const)("rejects invalid argument contract %#", (values, code) => {
    try {
      parseSellerSpritePreviewArgs(["--report-type", "search-results", ...values]);
      throw new Error("expected parser to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SellerSpritePreviewError);
      expect(error).toMatchObject({ code, exitCode: 2 });
    }
  });

  it("generates audited JSON, Chinese Markdown, and a local integrity manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "sellersprite-preview-test-"));
    try {
      const inputPath = join(root, "sanitized.xlsx");
      const outputDirectory = join(root, "reports");
      writeFileSync(inputPath, createSellerSpritePreviewTestWorkbook());
      const result = runSellerSpritePreview({
        kind: "run",
        input: inputPath,
        query: "storage boxes",
        category: "Storage & Organization",
        priceMin: 20,
        priceMax: 100,
        outputDir: outputDirectory,
        format: "both",
      }, {
        repositoryRoot: join(root, "repository"),
        now: () => "2026-07-27T02:00:00.000Z",
      });

      expect(result.outputDirectory).toBe(outputDirectory);
      expect(readdirSync(outputDirectory).sort()).toEqual([
        "sellersprite-preview-manifest.json",
        "sellersprite-preview.json",
        "sellersprite-preview.md",
      ]);
      const jsonText = readFileSync(join(outputDirectory, "sellersprite-preview.json"), "utf8");
      const markdown = readFileSync(join(outputDirectory, "sellersprite-preview.md"), "utf8");
      const manifestText = readFileSync(
        join(outputDirectory, "sellersprite-preview-manifest.json"),
        "utf8",
      );
      const manifest = JSON.parse(manifestText) as Record<string, unknown>;
      const report = JSON.parse(jsonText) as {
        schemaVersion: string;
        sourceType: string;
        precheckSummary: { totalRows: number; acceptedRows: number; rejectedRows: number };
        productSummary: { productCount: number };
        products: Array<{
          promotionEligible: boolean;
          providerMetrics: {
            estimatedMonthlySales: { nature: string };
            estimatedMonthlyRevenue: { nature: string };
          };
        }>;
        currentStage1Invoked: boolean;
        authoritative: boolean;
        manifestRegistered: boolean;
        productionEffect: boolean;
        productionDatabaseWritten: boolean;
      };

      expect(report).toMatchObject({
        schemaVersion: "sellersprite-local-preview-report.v3",
        sourceType: "provider_metric",
        precheckSummary: {
          headerColumnCount: 73,
          totalRows: 2,
          acceptedRows: 2,
          rejectedRows: 0,
        },
        productSummary: { productCount: 2 },
        currentStage1Invoked: false,
        authoritative: false,
        manifestRegistered: false,
        productionEffect: false,
        productionDatabaseWritten: false,
      });
      expect(report.products.every((product) => product.promotionEligible === false)).toBe(true);
      expect(report.products.every((product) => (
        product.providerMetrics.estimatedMonthlySales.nature === "estimate"
        && product.providerMetrics.estimatedMonthlyRevenue.nature === "estimate"
      ))).toBe(true);
      expect(jsonText).not.toContain(inputPath);
      expect(markdown).not.toContain(inputPath);
      expect(manifestText).not.toContain(inputPath);
      expect(jsonText).not.toMatch(
        /"(?:advance|watch|reject|promoted|promotionDecision|shadowDistribution)"/u,
      );
      expect(markdown).toContain("# SellerSprite 关键词搜索市场预筛报告");
      expect(markdown).toContain("## 当前不能判断的内容");
      expect(manifest).toMatchObject({
        schemaVersion: "sellersprite-local-preview-manifest.v3",
        jsonFileName: "sellersprite-preview.json",
        jsonFileSha256: createHash("sha256").update(jsonText).digest("hex"),
        markdownFileName: "sellersprite-preview.md",
        markdownFileSha256: createHash("sha256").update(markdown).digest("hex"),
        authoritative: false,
        promotionEligible: false,
        manifestRegistered: false,
        productionEffect: false,
        productionDatabaseWritten: false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe input and output paths without overwriting existing files", () => {
    const root = mkdtempSync(join(tmpdir(), "sellersprite-preview-paths-"));
    try {
      const repositoryRoot = join(root, "repository");
      const inputPath = join(root, "sanitized.xlsx");
      const directoryInput = join(root, "directory.xlsx");
      mkdirSync(repositoryRoot);
      mkdirSync(directoryInput);
      writeFileSync(inputPath, createSellerSpritePreviewTestWorkbook());

      expectPreviewError(
        () => runSellerSpritePreview(runArgs("https://example.com/report.xlsx", join(root, "url")), {
          repositoryRoot,
        }),
        "input_path_invalid",
        3,
      );
      expectPreviewError(
        () => runSellerSpritePreview(runArgs(join(root, "missing.xlsx"), join(root, "missing")), {
          repositoryRoot,
        }),
        "input_file_unavailable",
        3,
      );
      expectPreviewError(
        () => runSellerSpritePreview(runArgs(directoryInput, join(root, "directory")), {
          repositoryRoot,
        }),
        "input_not_regular_file",
        3,
      );
      expectPreviewError(
        () => runSellerSpritePreview(runArgs(inputPath, join(repositoryRoot, "reports")), {
          repositoryRoot,
        }),
        "output_inside_repository_not_allowed",
        6,
      );
      expectPreviewError(
        () => runSellerSpritePreview(runArgs(inputPath, inputPath), { repositoryRoot }),
        "output_path_invalid",
        6,
      );

      const existingOutput = join(root, "existing");
      mkdirSync(existingOutput);
      const existingJson = join(existingOutput, "sellersprite-preview.json");
      writeFileSync(existingJson, "keep-me");
      expectPreviewError(
        () => runSellerSpritePreview(runArgs(inputPath, existingOutput), { repositoryRoot }),
        "output_file_already_exists",
        6,
      );
      expect(readFileSync(existingJson, "utf8")).toBe("keep-me");

      const blockedParent = join(root, "blocked-parent");
      writeFileSync(blockedParent, "not a directory");
      expectPreviewError(
        () => runSellerSpritePreview(
          runArgs(inputPath, join(blockedParent, "reports")),
          { repositoryRoot },
        ),
        "output_write_failed",
        6,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("publishes partial reports but rejects structural failures or zero accepted rows", () => {
    const root = mkdtempSync(join(tmpdir(), "sellersprite-preview-partial-"));
    try {
      const repositoryRoot = join(root, "repository");
      const partialInput = join(root, "partial.xlsx");
      const rejectedRow = {
        ...SELLERSPRITE_SANITIZED_ROWS[1],
        "价格($)": "24.99€",
      };
      writeFileSync(partialInput, createSellerSpritePreviewTestWorkbook({
        rows: [SELLERSPRITE_SANITIZED_ROWS[0], rejectedRow],
      }));
      const partial = runSellerSpritePreview(
        runArgs(partialInput, join(root, "partial-output")),
        { repositoryRoot, now: () => "2026-07-27T02:00:00.000Z" },
      );
      expect(partial.report).toMatchObject({
        reportStatus: "partial",
        precheckSummary: {
          totalRows: 2,
          acceptedRows: 1,
          rejectedRows: 1,
          errorCounts: { currency_mismatch: 1 },
        },
        rejectedRowSummary: { currency_mismatch: 1 },
      });
      expect(partial.report.products.every((product) => product.promotionEligible === false))
        .toBe(true);

      const zeroAccepted = join(root, "zero.xlsx");
      const zeroOutput = join(root, "zero-output");
      writeFileSync(zeroAccepted, createSellerSpritePreviewTestWorkbook({ rows: [rejectedRow] }));
      expectPreviewError(
        () => runSellerSpritePreview(runArgs(zeroAccepted, zeroOutput), { repositoryRoot }),
        "xlsx_precheck_failed",
        4,
      );
      expect(existsSync(zeroOutput)).toBe(false);

      const structural = join(root, "structural.xlsx");
      const structuralOutput = join(root, "structural-output");
      writeFileSync(structural, createSellerSpritePreviewTestWorkbook({
        headers: SELLERSPRITE_SEARCH_EXPORT_HEADERS.filter((header) => header !== "商品标题"),
      }));
      expectPreviewError(
        () => runSellerSpritePreview(runArgs(structural, structuralOutput), { repositoryRoot }),
        "unsupported_report_type",
        4,
      );
      expect(existsSync(structuralOutput)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps missing or invalid aggregate sheets explicit without guessing concentration", () => {
    const root = mkdtempSync(join(tmpdir(), "sellersprite-preview-aggregates-"));
    try {
      const repositoryRoot = join(root, "repository");
      const missingPath = join(root, "missing-brands.xlsx");
      writeFileSync(missingPath, createSellerSpritePreviewTestWorkbook({ includeBrands: false }));
      const missing = runSellerSpritePreview(
        runArgs(missingPath, join(root, "missing-brands-output")),
        { repositoryRoot },
      );
      expect(missing.report.brandConcentrationSummary).toMatchObject({
        status: "missing",
        rows: [],
      });

      const invalidPath = join(root, "invalid-sellers.xlsx");
      writeFileSync(invalidPath, createSellerSpritePreviewTestWorkbook({
        sellersHeaders: ["卖家", "Seller", "市场份额"],
      }));
      const invalid = runSellerSpritePreview(
        runArgs(invalidPath, join(root, "invalid-sellers-output")),
        { repositoryRoot },
      );
      expect(invalid.report.sellerConcentrationSummary).toMatchObject({
        status: "invalid",
        rows: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps business hashes, product order, statistics, and dispositions deterministic", () => {
    const root = mkdtempSync(join(tmpdir(), "sellersprite-preview-determinism-"));
    try {
      const inputPath = join(root, "sanitized.xlsx");
      writeFileSync(inputPath, createSellerSpritePreviewTestWorkbook());
      const first = runSellerSpritePreview(
        runArgs(inputPath, join(root, "first")),
        {
          repositoryRoot: join(root, "repository"),
          now: () => "2026-07-27T02:00:00.000Z",
        },
      );
      const second = runSellerSpritePreview(
        runArgs(inputPath, join(root, "second")),
        {
          repositoryRoot: join(root, "repository"),
          now: () => "2026-07-27T03:00:00.000Z",
        },
      );
      expect(second.report.generatedAt).not.toBe(first.report.generatedAt);
      expect(second.report.sourceFileSha256).toBe(first.report.sourceFileSha256);
      expect(second.report.sourceBoundSnapshotHash).toBe(first.report.sourceBoundSnapshotHash);
      expect(second.report.normalizedBusinessHash).toBe(first.report.normalizedBusinessHash);
      expect(second.report.briefHash).toBe(first.report.briefHash);
      expect(second.report.productWeightedStatistics).toEqual(first.report.productWeightedStatistics);
      expect(second.report.products.map((product) => product.asin))
        .toEqual(first.report.products.map((product) => product.asin));
      expect(second.report.products.map((product) => product.provisionalDisposition))
        .toEqual(first.report.products.map((product) => product.provisionalDisposition));
      expect(second.report.families.map((family) => family.familyIdentity))
        .toEqual(first.report.families.map((family) => family.familyIdentity));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses an external temporary directory by default and honors single-format output", () => {
    const root = mkdtempSync(join(tmpdir(), "sellersprite-preview-default-"));
    let generatedOutput: string | null = null;
    try {
      const inputPath = join(root, "sanitized.xlsx");
      writeFileSync(inputPath, createSellerSpritePreviewTestWorkbook());
      const result = runSellerSpritePreview({
        ...runArgs(inputPath, null),
        format: "json",
      }, {
        repositoryRoot: join(root, "repository"),
      });
      generatedOutput = result.outputDirectory;
      expect(generatedOutput.startsWith(tmpdir())).toBe(true);
      expect(readdirSync(generatedOutput).sort()).toEqual([
        "sellersprite-preview-manifest.json",
        "sellersprite-preview.json",
      ]);
      expect(result.manifest.markdownFileName).toBeNull();
      expect(result.manifest.markdownFileSha256).toBeNull();
    } finally {
      if (generatedOutput) rmSync(generatedOutput, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes every temporary and final artifact when an atomic publish step fails", () => {
    const root = mkdtempSync(join(tmpdir(), "sellersprite-preview-atomic-"));
    try {
      const inputPath = join(root, "sanitized.xlsx");
      const outputDirectory = join(root, "reports");
      writeFileSync(inputPath, createSellerSpritePreviewTestWorkbook());
      let renameCount = 0;
      expectPreviewError(
        () => runSellerSpritePreview(runArgs(inputPath, outputDirectory), {
          repositoryRoot: join(root, "repository"),
          atomicRename: (source, destination) => {
            renameCount += 1;
            if (renameCount === 2) throw new Error("injected rename failure");
            renameSync(source, destination);
          },
        }),
        "output_write_failed",
        6,
      );
      expect(existsSync(outputDirectory)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("maps CLI outcomes to stable exit codes without exposing local paths", () => {
    const root = mkdtempSync(join(tmpdir(), "sellersprite-preview-cli-exits-"));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = {
      repositoryRoot: join(root, "repository"),
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
    };
    try {
      expect(runSellerSpritePreviewCli(["--help"], io))
        .toBe(SELLERSPRITE_PREVIEW_EXIT_CODES.success);
      expect(stdout.join("")).toContain("SellerSprite 本地市场预览");
      expect(stderr).toEqual([]);

      const missingPath = join(root, "seller-sprite-sensitive-name.xlsx");
      expect(runSellerSpritePreviewCli([], io))
        .toBe(SELLERSPRITE_PREVIEW_EXIT_CODES.invalidArguments);
      expect(runSellerSpritePreviewCli([
        "--report-type", "search-results",
        "--input", missingPath,
        "--query", "boxes",
        "--category", "Storage",
        "--price-min", "20",
        "--price-max", "100",
      ], io)).toBe(SELLERSPRITE_PREVIEW_EXIT_CODES.invalidInput);

      const invalidWorkbook = join(root, "invalid.xlsx");
      writeFileSync(invalidWorkbook, "not an OOXML workbook");
      expect(runSellerSpritePreviewCli([
        "--report-type", "search-results",
        "--input", invalidWorkbook,
        "--query", "boxes",
        "--category", "Storage",
        "--price-min", "20",
        "--price-max", "100",
      ], io)).toBe(SELLERSPRITE_PREVIEW_EXIT_CODES.invalidWorkbook);

      const validWorkbook = join(root, "valid.xlsx");
      writeFileSync(validWorkbook, createSellerSpritePreviewTestWorkbook());
      const validValues = [
        "--report-type", "search-results",
        "--input", validWorkbook,
        "--query", "boxes",
        "--category", "Storage",
        "--price-min", "20",
        "--price-max", "100",
      ];
      expect(runSellerSpritePreviewCli(validValues, {
        ...io,
        createBrief: () => {
          throw new Error("injected invalid brief");
        },
      })).toBe(SELLERSPRITE_PREVIEW_EXIT_CODES.invalidBrief);
      expect(runSellerSpritePreviewCli(validValues, {
        ...io,
        now: () => {
          throw new Error("unexpected sensitive implementation detail");
        },
      })).toBe(SELLERSPRITE_PREVIEW_EXIT_CODES.internalError);

      const blockedOutput = join(root, "blocked");
      mkdirSync(blockedOutput);
      writeFileSync(join(blockedOutput, "sellersprite-preview.json"), "keep");
      expect(runSellerSpritePreviewCli([
        ...validValues,
        "--output-dir", blockedOutput,
      ], io)).toBe(SELLERSPRITE_PREVIEW_EXIT_CODES.outputFailure);

      const successOutput = join(root, "success");
      expect(runSellerSpritePreviewCli([
        ...validValues,
        "--output-dir", successOutput,
      ], io)).toBe(SELLERSPRITE_PREVIEW_EXIT_CODES.success);
      expect(stdout.join("")).toContain(`OUTPUT_DIRECTORY=${successOutput}`);
      expect(stderr.join("")).not.toContain(missingPath);
      expect(stderr.join("")).not.toContain(validWorkbook);
      expect(stderr.join("")).not.toContain("unexpected sensitive implementation detail");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
