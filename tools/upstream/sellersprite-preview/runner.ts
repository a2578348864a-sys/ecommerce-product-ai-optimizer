import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { buildSellerSpriteBriefBoundShadowReport } from "../../../lib/upstream/sellersprite/briefBoundShadowReport";
import {
  buildSellerSpriteMarketSnapshot,
  type SellerSpriteMarketNumericSummaries,
  type SellerSpriteMarketSnapshot,
} from "../../../lib/upstream/sellersprite/marketSnapshot";
import {
  rankSellerSpriteMarketSignals,
  type SellerSpriteMarketSignalRankingReport,
} from "../../../lib/upstream/sellersprite/marketSignalRanking";
import {
  precheckSellerSpriteXlsx,
  type SellerSpritePrecheckResult,
} from "../../../lib/upstream/sellersprite/precheck";
import type {
  SellerSpriteCategoryCurrentRecord,
  SellerSpriteFamilyObservation,
  SellerSpriteProductObservation,
  SellerSpriteSearchAppearance,
  SellerSpriteSourceOccurrence,
} from "../../../lib/upstream/sellersprite/projections";
import type { SellerSpriteReportType } from "../../../lib/upstream/sellersprite/reportType";
import { createSellerSpriteShadowSelectionBrief } from "../../../lib/upstream/sellersprite/shadowBrief";
import {
  buildSellerSpriteLocalPreviewRanking,
  SellerSpriteRankingIntegrityError,
  type SellerSpriteLocalPreviewRanking,
} from "./ranking-report";
import { renderSellerSpritePreviewMarkdown } from "./render-markdown";

export const SELLERSPRITE_PREVIEW_HELP = `SellerSprite 本地市场预览

用法：
  Search:
  npm run sellersprite:preview -- --report-type search-results --input <file.xlsx> --query <关键词> --category <类目> --price-min <数字> --price-max <数字> [--output-dir <目录>] [--format json|markdown|both]

  Category Current:
  npm run sellersprite:preview -- --report-type category-current --input <file.xlsx> --category <类目> --price-min <数字> --price-max <数字> [--output-dir <目录>] [--format json|markdown|both]

参数：
  --report-type search-results 或 category-current；必填，不自动猜测
  --input       SellerSprite 官方 XLSX 本地文件
  --query       Search 必填；Category Current 禁止提供
  --category    当前筛选类目
  --price-min   目标最低价格
  --price-max   目标最高价格
  --output-dir  报告目录；默认使用系统临时目录
  --format      json、markdown 或 both；默认 both
  --help        显示本帮助

当前仅支持 amazon.com / US / USD。
输出 sellersprite-preview.json、sellersprite-preview.md 和本地完整性 Manifest。
数据仅用于非权威市场预筛，不连接数据库或生产系统，不包含亚马逊后台订单数据。
`;

export const SELLERSPRITE_PREVIEW_EXIT_CODES = {
  success: 0,
  invalidArguments: 2,
  invalidInput: 3,
  invalidWorkbook: 4,
  invalidBrief: 5,
  outputFailure: 6,
  internalError: 7,
} as const;

export class SellerSpritePreviewError extends Error {
  constructor(
    readonly code: string,
    readonly exitCode: number,
  ) {
    super(code);
    this.name = "SellerSpritePreviewError";
  }
}

export type SellerSpritePreviewFormat = "json" | "markdown" | "both";

export type SellerSpritePreviewParsedArgs =
  | { kind: "help" }
  | {
    kind: "run";
    reportType?: SellerSpriteReportType;
    input: string;
    query: string | null;
    category: string;
    priceMin: number;
    priceMax: number;
    outputDir: string | null;
    format: SellerSpritePreviewFormat;
  };

export interface SellerSpriteLocalPreviewProduct extends SellerSpriteProductObservation {
  briefPriceBandResult: {
    status: "within" | "outside" | "missing" | "conflict";
    price: number | null;
    currency: "USD";
    priceMin: number;
    priceMax: number;
  };
  provisionalDisposition:
    | "provisional_score_only"
    | "insufficient_hard_gate_evidence"
    | "conflicting_provider_metrics"
    | "insufficient_required_signals";
  promotionEligible: false;
}

export interface SellerSpriteLocalPreviewReport {
  schemaVersion: "sellersprite-local-preview-report.v3";
  reportType: SellerSpriteReportType;
  reportHash: string;
  reportStatus: "complete" | "partial";
  generatedAt: string;
  inputFileName: string;
  sourceFileSha256: string;
  sourceBoundSnapshotHash: string;
  normalizedBusinessHash: string;
  briefHash: string;
  marketplace: "amazon.com";
  market: "US";
  currency: "USD";
  query: string | null;
  category: string;
  priceMin: number;
  priceMax: number;
  source: "SellerSprite";
  sourceType: "provider_metric";
  metricNature: {
    price: "snapshot";
    rating: "snapshot";
    reviews: "snapshot";
    estimatedMonthlySales: "estimate";
    estimatedMonthlyRevenue: "estimate";
  };
  precheckSummary: {
    sheetName: string;
    headerColumnCount: number;
    totalRows: number;
    acceptedRows: number;
    rejectedRows: number;
    errorCounts: Readonly<Record<string, number>>;
  };
  occurrenceSummary: {
    occurrenceCount: number;
    occurrenceLabel: "Search appearances" | "Category Current records";
  };
  appearanceSummary: {
    appearanceCount: number;
    sponsoredPlacementCount: number;
    organicPlacementCount: number;
    unknownPlacementCount: number;
  } | null;
  placementSummary: SellerSpriteMarketSnapshot["placementSummary"];
  productSummary: {
    productCount: number;
    uniqueAsinCount: number;
    duplicateAsinCount: number;
  };
  familySummary: {
    familyCount: number;
    uniqueParentAsinCount: number;
  };
  appearanceWeightedStatistics: SellerSpriteMarketNumericSummaries | null;
  occurrenceWeightedStatistics: SellerSpriteMarketNumericSummaries;
  productWeightedStatistics: SellerSpriteMarketNumericSummaries;
  categoryBsrSummary: SellerSpriteMarketSnapshot["categoryBsrSummary"];
  brandConcentrationSummary: SellerSpriteMarketSnapshot["brandConcentrationSummary"];
  sellerConcentrationSummary: SellerSpriteMarketSnapshot["sellerConcentrationSummary"];
  missingSignals: ReadonlyArray<string>;
  conflictingSignals: ReadonlyArray<string>;
  warnings: ReadonlyArray<string>;
  rejectedRowSummary: Readonly<Record<string, number>>;
  occurrences: ReadonlyArray<SellerSpriteSourceOccurrence>;
  appearances: ReadonlyArray<SellerSpriteSearchAppearance>;
  categoryRecords: ReadonlyArray<SellerSpriteCategoryCurrentRecord>;
  products: ReadonlyArray<SellerSpriteLocalPreviewProduct>;
  families: ReadonlyArray<SellerSpriteFamilyObservation>;
  ranking: SellerSpriteLocalPreviewRanking;
  currentStage1Invoked: false;
  authoritative: false;
  hardGateEvidenceStatus: "unknown";
  hardGateEvaluable: false;
  promotionEligible: false;
  manifestRegistered: false;
  productionEffect: false;
  productionDatabaseWritten: false;
}

export interface SellerSpriteLocalPreviewManifest {
  schemaVersion: "sellersprite-local-preview-manifest.v3";
  reportSchemaVersion: "sellersprite-local-preview-report.v3";
  rankingSchemaVersion: "sellersprite-market-signal-ranking.v2";
  modelVersion: SellerSpriteLocalPreviewRanking["modelVersion"];
  rankingHash: string;
  reportType: SellerSpriteReportType;
  reportHash: string;
  generatedAt: string;
  sourceFileSha256: string;
  sourceBoundSnapshotHash: string;
  normalizedBusinessHash: string;
  briefHash: string;
  jsonFileName: string | null;
  jsonFileSha256: string | null;
  markdownFileName: string | null;
  markdownFileSha256: string | null;
  reportStatus: "complete" | "partial";
  authoritative: false;
  promotionEligible: false;
  manifestRegistered: false;
  productionEffect: false;
  productionDatabaseWritten: false;
}

export interface SellerSpritePreviewRunOptions {
  repositoryRoot?: string;
  now?: () => string;
  atomicRename?: (source: string, destination: string) => void;
  createBrief?: (
    input: Parameters<typeof createSellerSpriteShadowSelectionBrief>[0],
  ) => ReturnType<typeof createSellerSpriteShadowSelectionBrief>;
  rankSignals?: typeof rankSellerSpriteMarketSignals;
}

export interface SellerSpritePreviewRunResult {
  outputDirectory: string;
  report: SellerSpriteLocalPreviewReport;
  manifest: SellerSpriteLocalPreviewManifest;
  writtenFiles: ReadonlyArray<string>;
}

export interface SellerSpritePreviewCliOptions extends SellerSpritePreviewRunOptions {
  stdout?: (value: string) => void;
  stderr?: (value: string) => void;
}

function argumentError(code: string): never {
  throw new SellerSpritePreviewError(
    code,
    SELLERSPRITE_PREVIEW_EXIT_CODES.invalidArguments,
  );
}

export function parseSellerSpritePreviewArgs(
  values: readonly string[],
): SellerSpritePreviewParsedArgs {
  if (values.length === 1 && values[0] === "--help") return { kind: "help" };
  const allowed = new Set([
    "--report-type",
    "--input",
    "--query",
    "--category",
    "--price-min",
    "--price-max",
    "--output-dir",
    "--format",
  ]);
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (
      !key
      || !allowed.has(key)
      || value === undefined
      || value.startsWith("--")
      || parsed.has(key)
    ) {
      argumentError("unsupported_argument");
    }
    parsed.set(key, value);
  }

  const reportTypeRaw = parsed.get("--report-type")?.trim();
  if (!reportTypeRaw) argumentError("report_type_required");
  const reportType = reportTypeRaw === "search-results"
    ? "search_results"
    : reportTypeRaw === "category-current"
      ? "category_current"
      : null;
  if (reportType === null) argumentError("unsupported_report_type");
  const input = parsed.get("--input")?.trim();
  if (!input) argumentError("input_required");
  const queryWasProvided = parsed.has("--query");
  const queryValue = parsed.get("--query")?.trim();
  if (reportType === "search_results" && !queryValue) argumentError("query_required");
  if (reportType === "category_current" && queryWasProvided) {
    argumentError("query_not_applicable");
  }
  const query = reportType === "search_results" ? queryValue! : null;
  const category = parsed.get("--category")?.trim();
  if (!category) argumentError("category_required");

  const priceMinRaw = parsed.get("--price-min");
  const priceMin = priceMinRaw === undefined ? Number.NaN : Number(priceMinRaw);
  if (priceMinRaw?.trim() === "" || !Number.isFinite(priceMin) || priceMin < 0) {
    argumentError("price_min_invalid");
  }
  const priceMaxRaw = parsed.get("--price-max");
  const priceMax = priceMaxRaw === undefined ? Number.NaN : Number(priceMaxRaw);
  if (priceMaxRaw?.trim() === "" || !Number.isFinite(priceMax) || priceMax < 0) {
    argumentError("price_max_invalid");
  }
  if (priceMin > priceMax) argumentError("price_range_invalid");

  const format = parsed.get("--format") ?? "both";
  if (format !== "json" && format !== "markdown" && format !== "both") {
    argumentError("format_invalid");
  }
  const outputDirValue = parsed.get("--output-dir");
  if (outputDirValue !== undefined && outputDirValue.trim() === "") {
    argumentError("output_dir_invalid");
  }
  return {
    kind: "run",
    reportType,
    input,
    query,
    category,
    priceMin,
    priceMax,
    outputDir: outputDirValue?.trim() ?? null,
    format,
  };
}

const JSON_FILE = "sellersprite-preview.json";
const MARKDOWN_FILE = "sellersprite-preview.md";
const MANIFEST_FILE = "sellersprite-preview-manifest.json";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function previewError(code: string, exitCode: number): never {
  throw new SellerSpritePreviewError(code, exitCode);
}

function pathKey(value: string): string {
  const resolved = resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isInside(root: string, target: string): boolean {
  const fromRoot = relative(resolve(root), resolve(target));
  return fromRoot === ""
    || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
}

function potentialRealPath(value: string): string {
  let current = resolve(value);
  const missing: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return resolve(value);
    missing.unshift(basename(current));
    current = parent;
  }
  const real = realpathSync(current);
  return missing.length === 0 ? real : join(real, ...missing);
}

function networkPath(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(value)
    || value.startsWith("\\\\")
    || value.startsWith("//");
}

function validateInputPath(value: string): string {
  if (networkPath(value)) {
    previewError("input_path_invalid", SELLERSPRITE_PREVIEW_EXIT_CODES.invalidInput);
  }
  const inputPath = resolve(value);
  if (extname(inputPath).toLowerCase() !== ".xlsx") {
    previewError("input_file_type_invalid", SELLERSPRITE_PREVIEW_EXIT_CODES.invalidInput);
  }
  try {
    if (!lstatSync(inputPath).isFile()) {
      previewError("input_not_regular_file", SELLERSPRITE_PREVIEW_EXIT_CODES.invalidInput);
    }
  } catch (error) {
    if (error instanceof SellerSpritePreviewError) throw error;
    previewError("input_file_unavailable", SELLERSPRITE_PREVIEW_EXIT_CODES.invalidInput);
  }
  return inputPath;
}

function validateOutputDirectory(
  value: string | null,
  repositoryRoot: string,
  inputPath: string,
  format: SellerSpritePreviewFormat,
): string {
  if (value !== null && networkPath(value)) {
    previewError("output_path_invalid", SELLERSPRITE_PREVIEW_EXIT_CODES.outputFailure);
  }
  const outputDirectory = value === null
    ? join(tmpdir(), `sellersprite-preview-${randomUUID()}`)
    : resolve(value);
  const realRepository = potentialRealPath(repositoryRoot);
  const realOutput = potentialRealPath(outputDirectory);
  if (
    isInside(repositoryRoot, outputDirectory)
    || isInside(realRepository, realOutput)
  ) {
    previewError(
      "output_inside_repository_not_allowed",
      SELLERSPRITE_PREVIEW_EXIT_CODES.outputFailure,
    );
  }
  if (existsSync(outputDirectory) && !lstatSync(outputDirectory).isDirectory()) {
    previewError("output_path_invalid", SELLERSPRITE_PREVIEW_EXIT_CODES.outputFailure);
  }
  const reportNames = [
    ...(format === "json" || format === "both" ? [JSON_FILE] : []),
    ...(format === "markdown" || format === "both" ? [MARKDOWN_FILE] : []),
    MANIFEST_FILE,
  ];
  const inputKey = pathKey(inputPath);
  for (const name of reportNames) {
    const target = join(outputDirectory, name);
    if (pathKey(target) === inputKey) {
      previewError("output_would_overwrite_input", SELLERSPRITE_PREVIEW_EXIT_CODES.outputFailure);
    }
    if (existsSync(target)) {
      previewError("output_file_already_exists", SELLERSPRITE_PREVIEW_EXIT_CODES.outputFailure);
    }
  }
  return outputDirectory;
}

function countErrors(
  codes: ReadonlyArray<{ code: string; severity?: "error" | "warning" }>,
  severity?: "error" | "warning",
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of codes) {
    if (severity !== undefined && item.severity !== severity) continue;
    counts[item.code] = (counts[item.code] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )));
}

function buildReport(
  inputFileName: string,
  generatedAt: string,
  precheck: SellerSpritePrecheckResult,
  snapshot: SellerSpriteMarketSnapshot,
  shadow: ReturnType<typeof buildSellerSpriteBriefBoundShadowReport>,
  ranking: SellerSpriteLocalPreviewRanking,
): SellerSpriteLocalPreviewReport {
  const shadowProducts = new Map(shadow.products.map((product) => [product.asin, product]));
  if (shadow.brief.priceMin === null || shadow.brief.priceMax === null) {
    previewError("brief_price_range_required", SELLERSPRITE_PREVIEW_EXIT_CODES.internalError);
  }
  const priceMin = shadow.brief.priceMin;
  const priceMax = shadow.brief.priceMax;
  const products = snapshot.products.map((product): SellerSpriteLocalPreviewProduct => {
    const compatibility = shadowProducts.get(product.asin);
    if (!compatibility) {
      previewError("shadow_product_missing", SELLERSPRITE_PREVIEW_EXIT_CODES.internalError);
    }
    return {
      ...product,
      briefPriceBandResult: {
        ...compatibility.briefPriceBandResult,
        priceMin,
        priceMax,
      },
      provisionalDisposition: compatibility.provisionalDisposition,
      promotionEligible: false,
    };
  });
  const conflictingSignals = [...new Set(products.flatMap(
    (product) => product.conflictingProviderMetrics,
  ))].sort();
  return {
    schemaVersion: "sellersprite-local-preview-report.v3",
    reportType: snapshot.reportType,
    reportHash: shadow.reportHash,
    reportStatus: snapshot.rejectedRows > 0 ? "partial" : "complete",
    generatedAt,
    inputFileName,
    sourceFileSha256: snapshot.sourceFileSha256,
    sourceBoundSnapshotHash: snapshot.sourceBoundSnapshotHash,
    normalizedBusinessHash: snapshot.normalizedBusinessHash,
    briefHash: shadow.briefHash,
    marketplace: "amazon.com",
    market: "US",
    currency: "USD",
    query: shadow.brief.query,
    category: shadow.brief.category ?? "",
    priceMin,
    priceMax,
    source: "SellerSprite",
    sourceType: "provider_metric",
    metricNature: {
      price: "snapshot",
      rating: "snapshot",
      reviews: "snapshot",
      estimatedMonthlySales: "estimate",
      estimatedMonthlyRevenue: "estimate",
    },
    precheckSummary: {
      sheetName: snapshot.sheetName,
      headerColumnCount: precheck.headerColumnCount,
      totalRows: snapshot.totalRows,
      acceptedRows: snapshot.acceptedRows,
      rejectedRows: snapshot.rejectedRows,
      errorCounts: countErrors(precheck.errors, "error"),
    },
    occurrenceSummary: {
      occurrenceCount: snapshot.occurrences.length,
      occurrenceLabel: snapshot.reportType === "search_results"
        ? "Search appearances"
        : "Category Current records",
    },
    appearanceSummary: snapshot.reportType === "search_results" ? {
      appearanceCount: snapshot.appearances.length,
      sponsoredPlacementCount: snapshot.sponsoredPlacementCount ?? 0,
      organicPlacementCount: snapshot.organicPlacementCount ?? 0,
      unknownPlacementCount: snapshot.unknownPlacementCount ?? 0,
    } : null,
    placementSummary: snapshot.placementSummary,
    productSummary: {
      productCount: snapshot.products.length,
      uniqueAsinCount: snapshot.uniqueAsinCount,
      duplicateAsinCount: snapshot.duplicateAsinCount,
    },
    familySummary: {
      familyCount: snapshot.families.length,
      uniqueParentAsinCount: snapshot.uniqueParentAsinCount,
    },
    appearanceWeightedStatistics: snapshot.appearanceWeightedSummary,
    occurrenceWeightedStatistics: snapshot.occurrenceWeightedSummary,
    productWeightedStatistics: snapshot.productWeightedSummary,
    categoryBsrSummary: snapshot.categoryBsrSummary,
    brandConcentrationSummary: snapshot.brandConcentrationSummary,
    sellerConcentrationSummary: snapshot.sellerConcentrationSummary,
    missingSignals: snapshot.missingSignals,
    conflictingSignals,
    warnings: [...new Set([
      ...Object.keys(snapshot.warningCounts),
      ...shadow.warnings,
    ])].sort(),
    rejectedRowSummary: Object.fromEntries(Object.entries(
      countErrors(snapshot.rejectedRecords.flatMap((record) => (
        record.errorCodes.map((code) => ({ code, severity: "error" as const }))
      ))),
    )),
    occurrences: snapshot.occurrences,
    appearances: snapshot.appearances,
    categoryRecords: snapshot.categoryRecords,
    products,
    families: snapshot.families,
    ranking,
    currentStage1Invoked: false,
    authoritative: false,
    hardGateEvidenceStatus: "unknown",
    hardGateEvaluable: false,
    promotionEligible: false,
    manifestRegistered: false,
    productionEffect: false,
    productionDatabaseWritten: false,
  };
}

interface PreviewArtifact {
  name: string;
  content: string;
}

function writeArtifactsAtomically(
  outputDirectory: string,
  artifacts: readonly PreviewArtifact[],
  atomicRename: (source: string, destination: string) => void,
): string[] {
  const createdOutputDirectory = !existsSync(outputDirectory);
  const temporary: string[] = [];
  const finalized: string[] = [];
  try {
    mkdirSync(outputDirectory, { recursive: true });
    for (const artifact of artifacts) {
      if (existsSync(join(outputDirectory, artifact.name))) {
        previewError("output_file_already_exists", SELLERSPRITE_PREVIEW_EXIT_CODES.outputFailure);
      }
    }
    for (const artifact of artifacts) {
      const temporaryPath = join(
        outputDirectory,
        `.${artifact.name}.${process.pid}.${randomUUID()}.tmp`,
      );
      writeFileSync(temporaryPath, artifact.content, { encoding: "utf8", flag: "wx" });
      temporary.push(temporaryPath);
    }
    for (let index = 0; index < artifacts.length; index += 1) {
      const target = join(outputDirectory, artifacts[index].name);
      atomicRename(temporary[index], target);
      finalized.push(target);
    }
    return artifacts.map((artifact) => artifact.name);
  } catch (error) {
    for (const path of temporary) {
      if (existsSync(path)) rmSync(path, { force: true });
    }
    for (const path of finalized) {
      if (existsSync(path)) unlinkSync(path);
    }
    if (createdOutputDirectory && existsSync(outputDirectory)) {
      try {
        rmdirSync(outputDirectory);
      } catch {
        // Preserve the original, sanitized output error if the directory is no longer empty.
      }
    }
    if (error instanceof SellerSpritePreviewError) throw error;
    previewError("output_write_failed", SELLERSPRITE_PREVIEW_EXIT_CODES.outputFailure);
  }
}

export function runSellerSpritePreview(
  args: Extract<SellerSpritePreviewParsedArgs, { kind: "run" }>,
  options: SellerSpritePreviewRunOptions = {},
): SellerSpritePreviewRunResult {
  const expectedReportType = args.reportType ?? "search_results";
  const generatedAt = (options.now ?? (() => new Date().toISOString()))();
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const inputPath = validateInputPath(args.input);
  const outputDirectory = validateOutputDirectory(
    args.outputDir,
    repositoryRoot,
    inputPath,
    args.format,
  );
  let input: Buffer;
  try {
    input = readFileSync(inputPath);
  } catch {
    previewError("input_file_unavailable", SELLERSPRITE_PREVIEW_EXIT_CODES.invalidInput);
  }
  const precheck = precheckSellerSpriteXlsx(input, {
    capturedAt: generatedAt,
    expectedReportType,
  });
  if (precheck.errors.some((error) => error.code === "report_type_mismatch")) {
    previewError("report_type_mismatch", SELLERSPRITE_PREVIEW_EXIT_CODES.invalidWorkbook);
  }
  if (precheck.errors.some((error) => error.code === "unsupported_report_type")) {
    previewError("unsupported_report_type", SELLERSPRITE_PREVIEW_EXIT_CODES.invalidWorkbook);
  }
  const structuralFailure = precheck.sheetName === null
    || precheck.errors.some((error) => (
      error.severity === "error" && error.rowNumber === undefined
    ));
  if (structuralFailure || precheck.acceptedRows === 0) {
    previewError("xlsx_precheck_failed", SELLERSPRITE_PREVIEW_EXIT_CODES.invalidWorkbook);
  }
  const snapshot = buildSellerSpriteMarketSnapshot(precheck);
  let brief;
  try {
    const briefCommon = {
      marketplace: "amazon.com",
      market: "US",
      currency: "USD",
      category: args.category,
      priceMin: args.priceMin,
      priceMax: args.priceMax,
      requiredSignals: ["price", "rating", "reviews"],
      optionalSignals: ["estimatedMonthlySales", "estimatedMonthlyRevenue"],
      createdAt: generatedAt,
      briefSource: "local_cli_explicit_input",
    };
    brief = expectedReportType === "search_results"
      ? (options.createBrief ?? createSellerSpriteShadowSelectionBrief)({
          ...briefCommon,
          reportType: expectedReportType,
          query: args.query ?? "",
        })
      : (options.createBrief ?? createSellerSpriteShadowSelectionBrief)({
          ...briefCommon,
          reportType: expectedReportType,
          query: null,
        });
  } catch {
    previewError("selection_brief_invalid", SELLERSPRITE_PREVIEW_EXIT_CODES.invalidBrief);
  }
  const shadow = buildSellerSpriteBriefBoundShadowReport(snapshot, brief);
  let rawRanking: SellerSpriteMarketSignalRankingReport;
  try {
    rawRanking = (options.rankSignals ?? rankSellerSpriteMarketSignals)({
      snapshot,
      brief,
    });
  } catch {
    previewError("ranking_integrity_failed", SELLERSPRITE_PREVIEW_EXIT_CODES.internalError);
  }
  let ranking: SellerSpriteLocalPreviewRanking;
  try {
    ranking = buildSellerSpriteLocalPreviewRanking(rawRanking, snapshot, brief);
  } catch (error) {
    if (error instanceof SellerSpriteRankingIntegrityError) {
      previewError("ranking_integrity_failed", SELLERSPRITE_PREVIEW_EXIT_CODES.internalError);
    }
    throw error;
  }
  const report = buildReport(
    basename(inputPath),
    generatedAt,
    precheck,
    snapshot,
    shadow,
    ranking,
  );
  const jsonContent = `${JSON.stringify(report, null, 2)}\n`;
  const markdownContent = renderSellerSpritePreviewMarkdown(report);
  const manifest: SellerSpriteLocalPreviewManifest = {
    schemaVersion: "sellersprite-local-preview-manifest.v3",
    reportSchemaVersion: report.schemaVersion,
    rankingSchemaVersion: report.ranking.schemaVersion,
    modelVersion: report.ranking.modelVersion,
    rankingHash: report.ranking.rankingHash,
    reportType: report.reportType,
    reportHash: report.reportHash,
    generatedAt,
    sourceFileSha256: report.sourceFileSha256,
    sourceBoundSnapshotHash: report.sourceBoundSnapshotHash,
    normalizedBusinessHash: report.normalizedBusinessHash,
    briefHash: report.briefHash,
    jsonFileName: args.format === "json" || args.format === "both" ? JSON_FILE : null,
    jsonFileSha256: args.format === "json" || args.format === "both"
      ? sha256(jsonContent)
      : null,
    markdownFileName: args.format === "markdown" || args.format === "both"
      ? MARKDOWN_FILE
      : null,
    markdownFileSha256: args.format === "markdown" || args.format === "both"
      ? sha256(markdownContent)
      : null,
    reportStatus: report.reportStatus,
    authoritative: false,
    promotionEligible: false,
    manifestRegistered: false,
    productionEffect: false,
    productionDatabaseWritten: false,
  };
  const artifacts: PreviewArtifact[] = [
    ...(manifest.jsonFileName ? [{ name: JSON_FILE, content: jsonContent }] : []),
    ...(manifest.markdownFileName ? [{ name: MARKDOWN_FILE, content: markdownContent }] : []),
    { name: MANIFEST_FILE, content: `${JSON.stringify(manifest, null, 2)}\n` },
  ];
  const writtenFiles = writeArtifactsAtomically(
    outputDirectory,
    artifacts,
    options.atomicRename ?? renameSync,
  );
  return {
    outputDirectory,
    report,
    manifest,
    writtenFiles,
  };
}

export function runSellerSpritePreviewCli(
  values: readonly string[],
  options: SellerSpritePreviewCliOptions = {},
): number {
  const stdout = options.stdout ?? ((value: string) => {
    process.stdout.write(value);
  });
  const stderr = options.stderr ?? ((value: string) => {
    process.stderr.write(value);
  });
  try {
    const parsed = parseSellerSpritePreviewArgs(values);
    if (parsed.kind === "help") {
      stdout(SELLERSPRITE_PREVIEW_HELP);
      return SELLERSPRITE_PREVIEW_EXIT_CODES.success;
    }
    const result = runSellerSpritePreview(parsed, options);
    stdout([
      "SELLERSPRITE_PREVIEW_OK",
      `OUTPUT_DIRECTORY=${result.outputDirectory}`,
      `REPORT_STATUS=${result.report.reportStatus}`,
      `WRITTEN_FILES=${result.writtenFiles.join(",")}`,
      "",
    ].join("\n"));
    return SELLERSPRITE_PREVIEW_EXIT_CODES.success;
  } catch (error) {
    if (error instanceof SellerSpritePreviewError) {
      stderr(`SELLERSPRITE_PREVIEW_FAILED:${error.code}\n`);
      return error.exitCode;
    }
    stderr("SELLERSPRITE_PREVIEW_FAILED:internal_error\n");
    return SELLERSPRITE_PREVIEW_EXIT_CODES.internalError;
  }
}
