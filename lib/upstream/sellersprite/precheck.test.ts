import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SELLERSPRITE_SANITIZED_ROWS,
  SELLERSPRITE_SEARCH_EXPORT_HEADERS,
  SELLERSPRITE_SEARCH_EXPORT_SOURCE_HASH,
} from "./fixtures/search-export.sanitized.v1";
import { buildSellerSpriteBriefBoundShadowReport } from "./briefBoundShadowReport";
import { sellerSpriteDeterministicStringCompare } from "./canonical";
import { normalizeSellerSpriteField } from "./fields";
import { buildSellerSpriteMarketSnapshot } from "./marketSnapshot";
import { precheckSellerSpriteXlsx } from "./precheck";
import { createSellerSpriteShadowSelectionBrief } from "./shadowBrief";

const CAPTURED_AT = "2026-07-26T13:45:11.000Z";

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const value of input) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(entries: ReadonlyArray<readonly [string, string]>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const content = Buffer.from(text, "utf8");
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function sheetXml(headers: readonly string[], rows: ReadonlyArray<Readonly<Record<string, string>>>): string {
  const allRows = [
    Object.fromEntries(headers.map((header) => [header, header])),
    ...rows,
  ];
  const renderedRows = allRows.map((row, rowIndex) => {
    const cells = headers.flatMap((header, columnIndex) => {
      const value = row[header];
      if (value === undefined || value === "") return [];
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      return `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    });
    return `<row r="${rowIndex + 1}">${cells.join("")}</row>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<dimension ref="A1:${columnName(headers.length - 1)}${allRows.length}"/>`,
    `<sheetData>${renderedRows.join("")}</sheetData>`,
    "</worksheet>",
  ].join("");
}

function createWorkbook(
  headers: readonly string[] = SELLERSPRITE_SEARCH_EXPORT_HEADERS,
  rows: ReadonlyArray<Readonly<Record<string, string>>> = SELLERSPRITE_SANITIZED_ROWS,
  sheetName = "US",
  additionalEntries: ReadonlyArray<readonly [string, string]> = [],
  secondarySheet: {
    name: string;
    headers: readonly string[];
    rows: ReadonlyArray<Readonly<Record<string, string>>>;
  } | null = {
    name: "Note",
    headers: ["Note"],
    rows: [{ Note: "SellerSprite official export: https://www.sellersprite.com" }],
  },
  transformPrimarySheet: (xml: string) => string = (xml) => xml,
  transformWorkbookRelationships: (xml: string) => string = (xml) => xml,
): Buffer {
  const workbook = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    "<sheets>",
    `<sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/>`,
    ...(secondarySheet
      ? [`<sheet name="${xmlEscape(secondarySheet.name)}" sheetId="2" r:id="rId2"/>`]
      : []),
    "</sheets>",
    "</workbook>",
  ].join("");
  const relationships = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1"',
    ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"',
    ' Target="worksheets/sheet1.xml"/>',
    ...(secondarySheet
      ? [
          '<Relationship Id="rId2"',
          ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"',
          ' Target="worksheets/sheet2.xml"/>',
        ]
      : []),
    "</Relationships>",
  ].join("");
  return createStoredZip([
    ["xl/workbook.xml", workbook],
    ["xl/_rels/workbook.xml.rels", transformWorkbookRelationships(relationships)],
    ["xl/worksheets/sheet1.xml", transformPrimarySheet(sheetXml(headers, rows))],
    ...(secondarySheet
      ? [[
          "xl/worksheets/sheet2.xml",
          sheetXml(secondarySheet.headers, secondarySheet.rows),
        ] as const]
      : []),
    ...additionalEntries,
  ]);
}

function createOfficialShapeWorkbook(options: {
  headers?: readonly string[];
  rows?: ReadonlyArray<Readonly<Record<string, string>>>;
  primaryFirst?: boolean;
  includeBrands?: boolean;
  includeSellers?: boolean;
} = {}): Buffer {
  const headers = options.headers ?? SELLERSPRITE_SEARCH_EXPORT_HEADERS;
  const rows = options.rows ?? SELLERSPRITE_SANITIZED_ROWS;
  const sheetDefinitions = [
    {
      name: "US",
      headers,
      rows,
    },
    ...(options.includeBrands === false ? [] : [{
      name: "Brands",
      headers: ["品牌", "月销量", "月销售额($)", "市场份额"],
      rows: [
        { 品牌: "Sanitized Brand", 月销量: "25957", "月销售额($)": "648665.43", 市场份额: "0.75" },
        { 品牌: "Other Brand", 月销量: "1250", "月销售额($)": "36250", 市场份额: "0.25" },
      ],
    }]),
    ...(options.includeSellers === false ? [] : [{
      name: "Sellers",
      headers: ["卖家", "月销量", "月销售额($)", "市场份额"],
      rows: [
        { 卖家: "Sanitized Seller", 月销量: "25957", "月销售额($)": "648665.43", 市场份额: "0.6" },
        { 卖家: "Other Seller", 月销量: "1250", "月销售额($)": "36250", 市场份额: "0.4" },
      ],
    }]),
    {
      name: "Note",
      headers: ["Note"],
      rows: [{ Note: "指标采用最近更新当日数字；未提供可解析的精确更新时间。" }],
    },
  ];
  if (options.primaryFirst === false) {
    sheetDefinitions.push(sheetDefinitions.shift()!);
  }

  const workbook = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    "<sheets>",
    ...sheetDefinitions.map((sheet, index) => (
      `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    )),
    "</sheets>",
    "</workbook>",
  ].join("");
  const relationships = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...sheetDefinitions.map((_, index) => [
      `<Relationship Id="rId${index + 1}"`,
      ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"',
      ` Target="worksheets/sheet${index + 1}.xml"/>`,
    ].join("")),
    "</Relationships>",
  ].join("");
  return createStoredZip([
    ["xl/workbook.xml", workbook],
    ["xl/_rels/workbook.xml.rels", relationships],
    ...sheetDefinitions.map((sheet, index) => [
      `xl/worksheets/sheet${index + 1}.xml`,
      sheetXml(sheet.headers, sheet.rows),
    ] as const),
  ]);
}

describe("SellerSprite XLSX offline precheck", () => {
  it("parses the sanitized official-search-export fixture and maps only the v1 fields", () => {
    const input = createWorkbook();
    const result = precheckSellerSpriteXlsx(input, { capturedAt: CAPTURED_AT });

    expect(SELLERSPRITE_SEARCH_EXPORT_SOURCE_HASH).toMatch(/^[a-f0-9]{64}$/);
    expect(result).toMatchObject({
      schemaVersion: "sellersprite-xlsx-precheck.v2",
      sourceFileHash: createHash("sha256").update(input).digest("hex"),
      source: "SellerSprite",
      sourceType: "provider_metric",
      sheetName: "US",
      totalRows: 2,
      acceptedRows: 2,
      rejectedRows: 0,
      productionEffect: false,
      productionDatabaseWritten: false,
      errors: [],
    });
    expect(result.fieldMapping).toMatchObject({
      asin: "ASIN",
      searchRank: "搜索排名",
      estimatedMonthlySales: "月销量",
      estimatedMonthlyRevenue: "月销售额($)",
      variationCount: "变体数",
    });
    expect(result.records[0]).toMatchObject({
      rowNumber: 2,
      asin: {
        raw: "B0SAN00001",
        normalized: "B0SAN00001",
        source: "SellerSprite",
        sourceType: "provider_metric",
        capturedAt: CAPTURED_AT,
      },
      estimatedMonthlySales: { raw: "25,957", normalized: 25957 },
      estimatedMonthlyRevenue: { raw: "$648,665.43", normalized: 648665.43 },
      price: { raw: "$24.99", normalized: 24.99 },
      searchRank: {
        raw: "广告位：第1页第1位",
        normalized: { placementType: "sponsored", page: 1, position: 1 },
      },
      extraRaw: { 详细参数: "synthetic fixture value" },
    });
  });

  it("returns missing_required_column instead of guessing absent identity fields", () => {
    const headers = SELLERSPRITE_SEARCH_EXPORT_HEADERS.filter((header) => header !== "商品详情页链接");
    const result = precheckSellerSpriteXlsx(createWorkbook(headers), { capturedAt: CAPTURED_AT });

    expect(result.acceptedRows).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "missing_required_column",
      field: "productUrl",
    }));
  });

  it("keeps empty optional values as null instead of default facts", () => {
    const row = { ...SELLERSPRITE_SANITIZED_ROWS[0], "价格($)": "", 评分: "", 月销量: "" };
    const result = precheckSellerSpriteXlsx(createWorkbook(undefined, [row]), { capturedAt: CAPTURED_AT });

    expect(result.acceptedRows).toBe(1);
    expect(result.records[0].price).toMatchObject({ raw: null, normalized: null });
    expect(result.records[0].rating).toMatchObject({ raw: null, normalized: null });
    expect(result.records[0].estimatedMonthlySales).toMatchObject({ raw: null, normalized: null });
  });

  it("isolates a row with an invalid number format", () => {
    const invalid = { ...SELLERSPRITE_SANITIZED_ROWS[0], ASIN: "B0SAN00003", "价格($)": "1,2,3" };
    const result = precheckSellerSpriteXlsx(createWorkbook(undefined, [SELLERSPRITE_SANITIZED_ROWS[0], invalid]), {
      capturedAt: CAPTURED_AT,
    });

    expect(result.acceptedRows).toBe(1);
    expect(result.rejectedRows).toBe(1);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "invalid_number_format",
      field: "price",
      rowNumber: 3,
    }));
    expect(result.rejectedRecords[0].normalizedRecord?.price).toMatchObject({
      raw: "1,2,3",
      normalized: null,
      source: "SellerSprite",
      sourceType: "provider_metric",
      capturedAt: CAPTURED_AT,
    });
  });

  it.each([
    ["non-Amazon host", "https://example.com/dp/B0SAN00001"],
    ["Amazon-lookalike registrable domain", "https://shop.amazon.xyz.co/dp/B0SAN00001"],
    ["mismatched ASIN", "https://www.amazon.com/dp/B0SAN99999"],
  ])("isolates a Product URL with %s", (_caseName, productUrl) => {
    const row = { ...SELLERSPRITE_SANITIZED_ROWS[0], 商品详情页链接: productUrl };
    const result = precheckSellerSpriteXlsx(createWorkbook(undefined, [row]), {
      capturedAt: CAPTURED_AT,
    });

    expect(result.acceptedRows).toBe(0);
    expect(result.rejectedRows).toBe(1);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "invalid_url",
      field: "productUrl",
      rowNumber: 2,
    }));
  });

  it("reports repeated ASIN rows without merging, dropping, or summing metrics", () => {
    const duplicate = {
      ...SELLERSPRITE_SANITIZED_ROWS[1],
      ASIN: "B0SAN00001",
      商品详情页链接: "https://www.amazon.com/dp/B0SAN00001",
    };
    const result = precheckSellerSpriteXlsx(createWorkbook(undefined, [SELLERSPRITE_SANITIZED_ROWS[0], duplicate]), {
      capturedAt: CAPTURED_AT,
    });

    expect(result.acceptedRows).toBe(2);
    expect(result.rejectedRows).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "duplicate_asin",
      severity: "warning",
      rowNumber: 3,
    }));
    expect(result.records[0].estimatedMonthlySales.normalized).toBe(25957);
    expect(result.records[1].estimatedMonthlySales.normalized).toBe(1250);
  });

  it("reports duplicate ASINs even when the first occurrence is rejected", () => {
    const first = { ...SELLERSPRITE_SANITIZED_ROWS[0], "价格($)": "invalid" };
    const duplicate = {
      ...SELLERSPRITE_SANITIZED_ROWS[1],
      ASIN: "B0SAN00001",
      商品详情页链接: "https://www.amazon.com/dp/B0SAN00001",
    };
    const result = precheckSellerSpriteXlsx(createWorkbook(undefined, [first, duplicate]), {
      capturedAt: CAPTURED_AT,
    });

    expect(result.acceptedRows).toBe(1);
    expect(result.rejectedRows).toBe(1);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "duplicate_asin",
      severity: "warning",
      rowNumber: 3,
    }));
  });

  it("preserves parent and child ASINs as separate records", () => {
    const result = precheckSellerSpriteXlsx(createWorkbook(), { capturedAt: CAPTURED_AT });

    expect(result.records).toHaveLength(2);
    expect(result.records.map((record) => ({
      asin: record.asin.normalized,
      parentAsin: record.parentAsin.normalized,
    }))).toEqual([
      { asin: "B0SAN00001", parentAsin: null },
      { asin: "B0SAN00002", parentAsin: "B0SAN00001" },
    ]);
  });

  it("marks every supported field as provider_metric", () => {
    const result = precheckSellerSpriteXlsx(createWorkbook(), { capturedAt: CAPTURED_AT });
    const record = result.records[0];
    const supportedFields = [
      record.asin,
      record.sku,
      record.brand,
      record.productTitle,
      record.productUrl,
      record.parentAsin,
      record.searchRank,
      record.price,
      record.rating,
      record.reviews,
      record.estimatedMonthlySales,
      record.estimatedMonthlyRevenue,
      record.seller,
      record.variationCount,
    ];

    expect(supportedFields.every((field) => (
      field.source === "SellerSprite"
      && field.sourceType === "provider_metric"
      && field.capturedAt === CAPTURED_AT
    ))).toBe(true);
  });

  it("returns unsupported_sheet when no worksheet resembles a SellerSprite product export", () => {
    const result = precheckSellerSpriteXlsx(
      createWorkbook(["品牌", "月销量", "月销售额($)"], [{ 品牌: "Sanitized Brand", 月销量: "10" }], "Brands"),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.acceptedRows).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "unsupported_sheet" }));
  });

  it("rejects a non-US product worksheet instead of silently labeling it amazon.com US", () => {
    const result = precheckSellerSpriteXlsx(
      createWorkbook(undefined, undefined, "DE"),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.acceptedRows).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "unsupported_sheet" }));
  });

  it("prefers a sheet with all required fields over one with more optional aliases", () => {
    const requiredHeaders = ["ASIN", "商品标题", "商品详情页链接", "搜索排名"];
    const misleadingHeaders = SELLERSPRITE_SEARCH_EXPORT_HEADERS.filter(
      (header) => header !== "商品详情页链接",
    );
    const result = precheckSellerSpriteXlsx(
      createWorkbook(requiredHeaders, SELLERSPRITE_SANITIZED_ROWS, "US", [], {
        name: "Other Products",
        headers: misleadingHeaders,
        rows: SELLERSPRITE_SANITIZED_ROWS,
      }),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.sheetName).toBe("US");
    expect(result.acceptedRows).toBe(2);
    expect(result.fieldMapping).toMatchObject({
      asin: "ASIN",
      productTitle: "商品标题",
      productUrl: "商品详情页链接",
    });
  });

  it("prefers an unambiguous required-field sheet over a wider ambiguous sheet", () => {
    const requiredHeaders = ["ASIN", "商品标题", "商品详情页链接", "搜索排名"];
    const ambiguousHeaders = [...SELLERSPRITE_SEARCH_EXPORT_HEADERS, "Product URL"];
    const result = precheckSellerSpriteXlsx(
      createWorkbook(requiredHeaders, SELLERSPRITE_SANITIZED_ROWS, "US", [], {
        name: "Ambiguous Products",
        headers: ambiguousHeaders,
        rows: SELLERSPRITE_SANITIZED_ROWS,
      }),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.sheetName).toBe("US");
    expect(result.acceptedRows).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it("rejects duplicate unsupported headers before raw values can overwrite each other", () => {
    const headers = [...SELLERSPRITE_SEARCH_EXPORT_HEADERS, "详细参数"];
    const result = precheckSellerSpriteXlsx(createWorkbook(headers), { capturedAt: CAPTURED_AT });

    expect(result.acceptedRows).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "duplicate_column_header",
      column: "详细参数",
      severity: "error",
    }));
    expect(result.rejectedRecords[0].raw).toHaveProperty("详细参数 [column 5]");
    expect(result.rejectedRecords[0].raw).toHaveProperty("详细参数 [column 74]");
  });

  it("rejects executable XLSX content before reading product rows", () => {
    const result = precheckSellerSpriteXlsx(
      createWorkbook(undefined, undefined, "US", [["xl/vbaProject.bin", "not executed"]]),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.acceptedRows).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "unsupported_xlsx_feature",
      severity: "error",
    }));
  });

  it("rejects formula cells even when they are self-closing and have cached values", () => {
    const result = precheckSellerSpriteXlsx(
      createWorkbook(undefined, undefined, "US", [], undefined, (xml) => (
        xml.replace(
          '<c r="AC2" t="inlineStr"><is><t>$24.99</t></is></c>',
          '<c r="AC2"><f/><v>24.99</v></c>',
        )
      )),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.acceptedRows).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "unsupported_xlsx_feature",
      severity: "error",
    }));
  });

  it("rejects namespace-prefixed formula cells with cached values", () => {
    const result = precheckSellerSpriteXlsx(
      createWorkbook(undefined, undefined, "US", [], undefined, (xml) => (
        xml.replace(
          '<c r="AC2" t="inlineStr"><is><t>$24.99</t></is></c>',
          '<c r="AC2" xmlns:x="urn:formula"><x:f>1+1</x:f><v>24.99</v></c>',
        )
      )),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.acceptedRows).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "unsupported_xlsx_feature",
      severity: "error",
    }));
  });

  it("rejects Unicode namespace-prefixed formula cells with cached values", () => {
    const result = precheckSellerSpriteXlsx(
      createWorkbook(undefined, undefined, "US", [], undefined, (xml) => (
        xml.replace(
          '<c r="AC2" t="inlineStr"><is><t>$24.99</t></is></c>',
          '<c r="AC2" xmlns:恶="urn:formula"><恶:f>1+1</恶:f><v>24.99</v></c>',
        )
      )),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.acceptedRows).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "unsupported_xlsx_feature",
      severity: "error",
    }));
  });

  it("rejects external OOXML relationships before reading product values", () => {
    const externalRelationships = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdExternal" Target="https://example.com/data.xml"',
      ' TargetMode="External"',
      ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink"/>',
      "</Relationships>",
    ].join("");
    const result = precheckSellerSpriteXlsx(
      createWorkbook(undefined, undefined, "US", [
        ["xl/worksheets/_rels/sheet1.xml.rels", externalRelationships],
      ]),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.acceptedRows).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "unsupported_xlsx_feature",
      severity: "error",
    }));
  });

  it("rejects Unicode namespace-prefixed external OOXML relationships", () => {
    const externalRelationships = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"',
      ' xmlns:恶="urn:relationships">',
      '<恶:Relationship Id="rIdExternal" Target="https://example.com/data.xml"',
      ' TargetMode="External"',
      ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink"/>',
      "</Relationships>",
    ].join("");
    const result = precheckSellerSpriteXlsx(
      createWorkbook(undefined, undefined, "US", [
        ["xl/worksheets/_rels/sheet1.xml.rels", externalRelationships],
      ]),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.acceptedRows).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "unsupported_xlsx_feature",
      severity: "error",
    }));
  });

  it("rejects duplicate worksheet row numbers that could collide row identities", () => {
    const result = precheckSellerSpriteXlsx(
      createWorkbook(undefined, undefined, "US", [], undefined, (xml) => (
        xml.replace('<row r="3">', '<row r="2">')
      )),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.acceptedRows).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "invalid_xlsx",
      severity: "error",
    }));
  });

  it("rejects worksheets wider than the bounded SellerSprite precheck surface", () => {
    const headers = Array.from({ length: 513 }, (_, index) => `Column ${index + 1}`);
    const result = precheckSellerSpriteXlsx(createWorkbook(headers, []), { capturedAt: CAPTURED_AT });

    expect(result.acceptedRows).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "xlsx_sheet_limit_exceeded",
      severity: "error",
    }));
  });

  it("rejects a date-only capturedAt instead of storing an unstable timestamp", () => {
    const result = precheckSellerSpriteXlsx(createWorkbook(), { capturedAt: "2026-07-26" });

    expect(result.acceptedRows).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "invalid_captured_at",
      severity: "error",
    }));
  });

  it("returns invalid_captured_at for an impossible ISO-shaped timestamp", () => {
    const result = precheckSellerSpriteXlsx(createWorkbook(), {
      capturedAt: "2026-13-40T25:61:61.999Z",
    });

    expect(result.acceptedRows).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "invalid_captured_at",
      severity: "error",
    }));
  });

  it("separates ingestion time from unavailable provider and export timestamps", () => {
    const result = precheckSellerSpriteXlsx(createOfficialShapeWorkbook(), {
      capturedAt: CAPTURED_AT,
    });

    expect(result.ingestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.exportedAt).toBeNull();
    expect(result.providerUpdatedAt).toBeNull();
    expect(result.records[0].price).toMatchObject({
      capturedAt: CAPTURED_AT,
      capturedAtSemantics: "caller_supplied_ingestion_context",
      providerUpdatedAt: null,
      exportedAt: null,
    });
    expect(result.auxiliaryEvidence.note.rawText.join("\n")).toContain("最近更新");
  });

  it("classifies supported metrics without defaulting uncertain identity fields to snapshot", () => {
    const row = {
      ...SELLERSPRITE_SANITIZED_ROWS[0],
      上架时间: "2024-01-01",
      配送方式: "FBA",
      子体销量: "100",
      "子体销售额($)": "2499",
      留评率: "4.75%",
      毛利率: "30%",
      月销量增长率: "5%",
    };
    const result = precheckSellerSpriteXlsx(createOfficialShapeWorkbook({ rows: [row] }), {
      capturedAt: CAPTURED_AT,
    });

    expect(result.records[0].searchRank.metricNature).toBe("snapshot");
    expect(result.records[0].price.metricNature).toBe("snapshot");
    expect(result.records[0].rating.metricNature).toBe("snapshot");
    expect(result.records[0].reviews.metricNature).toBe("snapshot");
    expect(result.records[0].estimatedMonthlySales.metricNature).toBe("estimate");
    expect(result.records[0].estimatedMonthlyRevenue.metricNature).toBe("estimate");
    expect(result.records[0].brand.metricNature).toBe("unknown");
    expect(result.records[0].extraRawMetricNature).toMatchObject({
      上架时间: "snapshot",
      配送方式: "snapshot",
      子体销量: "estimate",
      "子体销售额($)": "estimate",
      留评率: "derived",
      毛利率: "derived",
      月销量增长率: "derived",
    });
    expect(result.auxiliaryEvidence.brands.rows[0].marketShare.metricNature).toBe("derived");
    expect(result.auxiliaryEvidence.sellers.rows[0].marketShare.metricNature).toBe("derived");
  });

  it("reads optional official aggregate sheets but does not infer their results from product rows", () => {
    const complete = precheckSellerSpriteXlsx(createOfficialShapeWorkbook(), {
      capturedAt: CAPTURED_AT,
    });
    expect(complete.auxiliaryEvidence.brands).toMatchObject({
      status: "available",
      sheetName: "Brands",
    });
    expect(complete.auxiliaryEvidence.brands.rows[0]).toMatchObject({
      entity: { raw: "Sanitized Brand", normalized: "Sanitized Brand" },
      marketShare: { raw: "0.75", normalized: 0.75 },
    });

    const missing = precheckSellerSpriteXlsx(createOfficialShapeWorkbook({
      includeBrands: false,
      includeSellers: false,
    }), { capturedAt: CAPTURED_AT });
    expect(missing.acceptedRows).toBe(2);
    expect(missing.auxiliaryEvidence.brands.status).toBe("missing");
    expect(missing.auxiliaryEvidence.sellers.status).toBe("missing");
  });

  it("isolates an ambiguous aggregate share unit without failing the US product sheet", () => {
    const result = precheckSellerSpriteXlsx(createWorkbook(
      undefined,
      SELLERSPRITE_SANITIZED_ROWS,
      "US",
      [],
      {
        name: "Brands",
        headers: ["品牌", "市场份额"],
        rows: [{ 品牌: "Sanitized Brand", 市场份额: "75" }],
      },
    ), { capturedAt: CAPTURED_AT });

    expect(result.acceptedRows).toBe(2);
    expect(result.auxiliaryEvidence.brands.status).toBe("invalid");
    expect(result.auxiliaryEvidence.brands.rows[0].marketShare).toMatchObject({
      raw: "75",
      normalized: null,
    });
    expect(result.auxiliaryEvidence.brands.errors).toContain("invalid_market_share:2");
  });

  it.each([
    {
      sheetName: "Brands" as const,
      headers: ["品牌", "Brand", "市场份额"],
      row: { 品牌: "First Brand", Brand: "Second Brand", 市场份额: "0.75" },
      expectedErrors: ["ambiguous_aggregate_column:entity"],
    },
    {
      sheetName: "Brands" as const,
      headers: ["品牌", "市场份额", "Market Share"],
      row: { 品牌: "First Brand", 市场份额: "0.75", "Market Share": "0.25" },
      expectedErrors: ["ambiguous_aggregate_column:marketShare"],
    },
    {
      sheetName: "Sellers" as const,
      headers: ["卖家", "Seller", "市场份额"],
      row: { 卖家: "First Seller", Seller: "Second Seller", 市场份额: "0.6" },
      expectedErrors: ["ambiguous_aggregate_column:entity"],
    },
    {
      sheetName: "Sellers" as const,
      headers: ["卖家", "市场份额", "Market Share"],
      row: { 卖家: "First Seller", 市场份额: "0.6", "Market Share": "0.4" },
      expectedErrors: ["ambiguous_aggregate_column:marketShare"],
    },
    {
      sheetName: "Brands" as const,
      headers: ["品牌", "Brand", "市场份额", "Market Share"],
      row: {
        品牌: "First Brand",
        Brand: "Second Brand",
        市场份额: "0.75",
        "Market Share": "0.25",
      },
      expectedErrors: [
        "ambiguous_aggregate_column:entity",
        "ambiguous_aggregate_column:marketShare",
      ],
    },
  ])(
    "fails closed for equivalent-column ambiguity in $sheetName aggregate evidence",
    ({ sheetName, headers, row, expectedErrors }) => {
      const aggregateRow: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === "string") aggregateRow[key] = value;
      }
      const result = precheckSellerSpriteXlsx(createWorkbook(
        undefined,
        SELLERSPRITE_SANITIZED_ROWS,
        "US",
        [],
        {
          name: sheetName,
          headers,
          rows: [aggregateRow],
        },
      ), { capturedAt: CAPTURED_AT });

      expect(result.acceptedRows).toBe(2);
      const evidence = sheetName === "Brands"
        ? result.auxiliaryEvidence.brands
        : result.auxiliaryEvidence.sellers;
      expect(evidence).toMatchObject({
        status: "invalid",
        rows: [],
        errors: expectedErrors,
      });
      const snapshot = buildSellerSpriteMarketSnapshot(result);
      const summary = sheetName === "Brands"
        ? snapshot.brandConcentrationSummary
        : snapshot.sellerConcentrationSummary;
      expect(summary).toMatchObject({
        status: "invalid",
        validShareCount: 0,
        missingShareCount: 0,
        topEntity: null,
        topShare: null,
      });
    },
  );
});

describe("SellerSprite USD currency contract", () => {
  it.each([
    ["price", "24.99", 24.99, undefined],
    ["price", "$24.99", 24.99, undefined],
    ["price", ".99", 0.99, undefined],
    ["price", "€24.99", null, "currency_mismatch"],
    ["price", "24.99€", null, "currency_mismatch"],
    ["price", "£24.99", null, "currency_mismatch"],
    ["price", "24.99£", null, "currency_mismatch"],
    ["price", "¥24.99", null, "currency_mismatch"],
    ["price", "24.99¥", null, "currency_mismatch"],
    ["price", "￥24.99", null, "currency_mismatch"],
    ["price", "24.99￥", null, "currency_mismatch"],
    ["price", "₹24.99", null, "currency_mismatch"],
    ["price", "24.99$", null, "currency_mismatch"],
    ["price", "$$24.99", null, "currency_mismatch"],
    ["price", "+24.99", null, "invalid_number_format"],
    ["price", "$+24.99", null, "invalid_number_format"],
    ["estimatedMonthlyRevenue", "$1,234.56", 1234.56, undefined],
    ["estimatedMonthlyRevenue", "1,234.56", 1234.56, undefined],
    ["estimatedMonthlyRevenue", "1,234.56€", null, "currency_mismatch"],
    ["estimatedMonthlyRevenue", "+1,234.56", null, "invalid_number_format"],
    ["rating", "$4.5", null, "currency_mismatch"],
    ["reviews", "€100", null, "currency_mismatch"],
    ["reviews", "100€", null, "currency_mismatch"],
    ["reviews", "1,000", 1000, undefined],
    ["estimatedMonthlySales", "£200", null, "currency_mismatch"],
    ["variationCount", "10¥", null, "currency_mismatch"],
    ["variationCount", "+10", null, "invalid_number_format"],
  ] as const)(
    "normalizes %s raw value %s with explicit USD boundaries",
    (field, raw, normalized, errorCode) => {
      expect(normalizeSellerSpriteField(field, raw)).toEqual(
        errorCode === undefined
          ? { normalized }
          : { normalized, errorCode },
      );
    },
  );

  const headers = [
    "ASIN",
    "Product Title",
    "Product URL",
    "Price",
    "Rating",
    "Reviews",
    "Estimated Monthly Sales",
    "Estimated Monthly Revenue",
    "Search Rank",
  ];
  const row = {
    ASIN: "B0CUR00001",
    "Product Title": "Sanitized currency fixture",
    "Product URL": "https://www.amazon.com/dp/B0CUR00001",
    Price: "24.99",
    Rating: "4.5",
    Reviews: "100",
    "Estimated Monthly Sales": "200",
    "Estimated Monthly Revenue": "4998",
    "Search Rank": "自然位：第1页第1位",
  };

  it.each([
    ["$24.99", 24.99],
    ["24.99", 24.99],
  ])("accepts an unambiguous USD price %s", (rawPrice, normalizedPrice) => {
    const result = precheckSellerSpriteXlsx(
      createWorkbook(headers, [{ ...row, Price: rawPrice }]),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.acceptedRows).toBe(1);
    expect(result.records[0].price.normalized).toBe(normalizedPrice);
    const snapshot = buildSellerSpriteMarketSnapshot(result);
    expect(snapshot.products[0].providerMetrics.price).toMatchObject({
      status: "resolved",
      normalized: normalizedPrice,
      unit: "USD",
    });
  });

  it.each([
    ["Price", "€24.99", "price"],
    ["Price", "24.99€", "price"],
    ["Price", "£24.99", "price"],
    ["Price", "24.99£", "price"],
    ["Price", "¥24.99", "price"],
    ["Price", "24.99¥", "price"],
    ["Price", "￥24.99", "price"],
    ["Price", "24.99￥", "price"],
    ["Price", "₹24.99", "price"],
    ["Estimated Monthly Revenue", "€4998", "estimatedMonthlyRevenue"],
    ["Estimated Monthly Revenue", "4998€", "estimatedMonthlyRevenue"],
    ["Estimated Monthly Revenue", "£4998", "estimatedMonthlyRevenue"],
    ["Estimated Monthly Revenue", "¥4998", "estimatedMonthlyRevenue"],
  ])("rejects non-USD currency in %s", (header, rawValue, field) => {
    const result = precheckSellerSpriteXlsx(
      createWorkbook(headers, [{ ...row, [header]: rawValue }]),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.acceptedRows).toBe(0);
    expect(result.rejectedRows).toBe(1);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "currency_mismatch",
      field,
      rowNumber: 2,
    }));
    const snapshot = buildSellerSpriteMarketSnapshot(result);
    expect(snapshot.products[0].providerMetrics[field as "price" | "estimatedMonthlyRevenue"])
      .toMatchObject({
        status: "missing",
        normalized: null,
        unit: null,
      });
    expect(snapshot.products[0].appearances[0].providerEvidence)
      .toContainEqual(expect.objectContaining({
        fieldName: field,
        normalized: null,
        unit: null,
      }));
  });

  it.each([
    ["Rating", "$4.5", "rating"],
    ["Reviews", "€100", "reviews"],
    ["Estimated Monthly Sales", "£200", "estimatedMonthlySales"],
  ])("rejects a currency marker on non-currency field %s", (header, rawValue, field) => {
    const result = precheckSellerSpriteXlsx(
      createWorkbook(headers, [{ ...row, [header]: rawValue }]),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.acceptedRows).toBe(0);
    expect(result.rejectedRows).toBe(1);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "currency_mismatch",
      field,
      rowNumber: 2,
    }));
  });
});

describe("SellerSprite market snapshot and Stage 1 shadow compatibility", () => {
  it("uses deterministic code-unit ordering for tied summaries and offline projections", () => {
    expect(["中", "Zulu", "ä", "Alpha"].sort(sellerSpriteDeterministicStringCompare))
      .toEqual(["Alpha", "Zulu", "ä", "中"]);

    const aggregateRows = [
      { Brand: "Zulu", "Market Share": "0.5" },
      { Brand: "Alpha", "Market Share": "0.5" },
    ];
    const first = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createWorkbook(undefined, SELLERSPRITE_SANITIZED_ROWS, "US", [], {
        name: "Brands",
        headers: ["Brand", "Market Share"],
        rows: aggregateRows,
      }),
      { capturedAt: CAPTURED_AT },
    ));
    const second = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createWorkbook(undefined, [...SELLERSPRITE_SANITIZED_ROWS].reverse(), "US", [], {
        name: "Brands",
        headers: ["Brand", "Market Share"],
        rows: [...aggregateRows].reverse(),
      }),
      { capturedAt: CAPTURED_AT },
    ));

    expect(first.brandConcentrationSummary.topEntity).toBe("Alpha");
    expect(second.brandConcentrationSummary.topEntity).toBe("Alpha");
    expect(second.products.map((product) => product.asin))
      .toEqual(first.products.map((product) => product.asin));
    expect(second.families.map((family) => family.familyIdentity))
      .toEqual(first.families.map((family) => family.familyIdentity));
    expect(second.normalizedBusinessHash).toBe(first.normalizedBusinessHash);
  });

  it("creates deterministic row identities, statistics, and a runtime-time-independent canonical hash", () => {
    const duplicate = {
      ...SELLERSPRITE_SANITIZED_ROWS[1],
      ASIN: "B0SAN00001",
      商品详情页链接: "https://www.amazon.com/dp/B0SAN00001",
      搜索排名: "自然位：第1页第2位",
    };
    const workbook = createOfficialShapeWorkbook({
      rows: [SELLERSPRITE_SANITIZED_ROWS[0], duplicate],
    });
    const first = precheckSellerSpriteXlsx(workbook, { capturedAt: "2026-07-26T13:45:11.000Z" });
    const second = precheckSellerSpriteXlsx(workbook, { capturedAt: "2026-07-26T14:45:11.000Z" });
    const firstSnapshot = buildSellerSpriteMarketSnapshot(first);
    const secondSnapshot = buildSellerSpriteMarketSnapshot(second);
    const shiftedIngestionSnapshot = buildSellerSpriteMarketSnapshot({
      ...first,
      ingestedAt: "2026-07-27T00:00:00.000Z",
    });

    expect(firstSnapshot).toMatchObject({
      schemaVersion: "sellersprite-market-snapshot.v3",
      sourceFileSha256: createHash("sha256").update(workbook).digest("hex"),
      source: "SellerSprite",
      marketplace: "amazon.com",
      totalRows: 2,
      acceptedRows: 2,
      rejectedRows: 0,
      uniqueAsinCount: 1,
      duplicateAsinCount: 1,
      sponsoredPlacementCount: 1,
      organicPlacementCount: 1,
      unknownPlacementCount: 0,
      productionEffect: false,
      productionDatabaseWritten: false,
    });
    expect(firstSnapshot.records.map((record) => record.rowIdentity)).toHaveLength(2);
    expect(new Set(firstSnapshot.records.map((record) => record.rowIdentity)).size).toBe(2);
    expect(firstSnapshot.appearanceWeightedSummary!.estimatedMonthlySales).toMatchObject({
      validCount: 2,
      missingCount: 0,
      minimum: 1250,
      median: 13603.5,
      maximum: 25957,
    });
    expect(secondSnapshot.sourceBoundSnapshotHash).toBe(firstSnapshot.sourceBoundSnapshotHash);
    expect(secondSnapshot.normalizedBusinessHash).toBe(firstSnapshot.normalizedBusinessHash);
    expect(shiftedIngestionSnapshot.sourceBoundSnapshotHash).toBe(
      firstSnapshot.sourceBoundSnapshotHash,
    );
    expect(shiftedIngestionSnapshot.normalizedBusinessHash).toBe(
      firstSnapshot.normalizedBusinessHash,
    );
  });

  it("changes both hashes for a business value but not normalizedBusinessHash for column order", () => {
    const baseRows = [SELLERSPRITE_SANITIZED_ROWS[0]];
    const changedRows = [{ ...SELLERSPRITE_SANITIZED_ROWS[0], "价格($)": "26.99" }];
    const reorderedHeaders = [...SELLERSPRITE_SEARCH_EXPORT_HEADERS].reverse();
    const base = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: baseRows }),
      { capturedAt: CAPTURED_AT },
    ));
    const changed = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: changedRows }),
      { capturedAt: CAPTURED_AT },
    ));
    const reordered = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ headers: reorderedHeaders, rows: baseRows }),
      { capturedAt: CAPTURED_AT },
    ));

    expect(changed.sourceBoundSnapshotHash).not.toBe(base.sourceBoundSnapshotHash);
    expect(changed.normalizedBusinessHash).not.toBe(base.normalizedBusinessHash);
    expect(reordered.records[0].price.normalized).toBe(24.99);
    expect(reordered.fieldMapping).toEqual(base.fieldMapping);
    expect(reordered.normalizedBusinessHash).toBe(base.normalizedBusinessHash);
  });

  it("locates the official product report despite worksheet order changes", () => {
    const result = precheckSellerSpriteXlsx(createOfficialShapeWorkbook({ primaryFirst: false }), {
      capturedAt: CAPTURED_AT,
    });
    const snapshot = buildSellerSpriteMarketSnapshot(result);

    expect(result.sheetName).toBe("US");
    expect(result.acceptedRows).toBe(2);
    expect(snapshot.brandConcentrationSummary.status).toBe("available");
    expect(snapshot.sellerConcentrationSummary.status).toBe("available");
  });

  it("keeps the main report usable when Brands and Sellers are missing", () => {
    const result = precheckSellerSpriteXlsx(createOfficialShapeWorkbook({
      includeBrands: false,
      includeSellers: false,
    }), { capturedAt: CAPTURED_AT });
    const snapshot = buildSellerSpriteMarketSnapshot(result);

    expect(result.acceptedRows).toBe(2);
    expect(snapshot.missingSignals).toEqual(expect.arrayContaining([
      "brands_aggregate_sheet",
      "sellers_aggregate_sheet",
    ]));
    expect(snapshot.brandConcentrationSummary.status).toBe("missing");
    expect(snapshot.sellerConcentrationSummary.status).toBe("missing");
  });

  it("keeps isolated rejected rows visible in a successful market snapshot", () => {
    const invalid = { ...SELLERSPRITE_SANITIZED_ROWS[1], "价格($)": "invalid" };
    const result = precheckSellerSpriteXlsx(createOfficialShapeWorkbook({
      rows: [SELLERSPRITE_SANITIZED_ROWS[0], invalid],
    }), { capturedAt: CAPTURED_AT });
    const snapshot = buildSellerSpriteMarketSnapshot(result);

    expect(snapshot.acceptedRows).toBe(1);
    expect(snapshot.rejectedRows).toBe(1);
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.rejectedRecords).toHaveLength(1);
    expect(snapshot.rejectedRecords[0].rowIdentity).toMatch(/^[a-f0-9]{64}$/);
  });

});

describe("SellerSprite Offline Contract R2 XLSX integrity", () => {
  it("rejects a cell whose row reference disagrees with its row container", () => {
    const result = precheckSellerSpriteXlsx(
      createWorkbook(undefined, undefined, "US", [], undefined, (xml) => (
        xml.replace('r="A2"', 'r="A3"')
      )),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "cell_row_reference_mismatch",
      severity: "error",
    }));
  });

  it("rejects two explicit cells with the same reference", () => {
    const result = precheckSellerSpriteXlsx(
      createWorkbook(undefined, undefined, "US", [], undefined, (xml) => (
        xml.replace(
          /(<c r="A2"[\s\S]*?<\/c>)/,
          "$1$1",
        )
      )),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "duplicate_cell_reference",
      severity: "error",
    }));
  });

  it("rejects an implicit and explicit cell collision", () => {
    const result = precheckSellerSpriteXlsx(
      createWorkbook(undefined, undefined, "US", [], undefined, (xml) => (
        xml.replace(
          /(<c r="A2"[\s\S]*?<\/c>)/,
          (cell) => `${cell.replace(' r="A2"', "")}${cell}`,
        )
      )),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "duplicate_cell_reference",
      severity: "error",
    }));
  });

  it("rejects a workbook sheet relationship whose Type is not worksheet", () => {
    const result = precheckSellerSpriteXlsx(
      createWorkbook(
        undefined,
        undefined,
        "US",
        [],
        undefined,
        undefined,
        (xml) => xml.replace(
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
          "https://untrusted.example/worksheet",
        ),
      ),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "invalid_xlsx",
      severity: "error",
    }));
  });

  it("rejects a worksheet relationship target outside xl/worksheets", () => {
    const result = precheckSellerSpriteXlsx(
      createWorkbook(
        undefined,
        undefined,
        "US",
        [],
        undefined,
        undefined,
        (xml) => xml.replace(
          'Target="worksheets/sheet1.xml"',
          'Target="workbook.xml"',
        ),
      ),
      { capturedAt: CAPTURED_AT },
    );

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "invalid_xlsx",
      severity: "error",
    }));
  });
});

describe("SellerSprite Offline Contract R2 dual hashes and projections", () => {
  it("uses the v2 snapshot contract and produces two distinct audit hashes", () => {
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook(),
      { capturedAt: CAPTURED_AT },
    ));

    expect(snapshot).toMatchObject({
      schemaVersion: "sellersprite-market-snapshot.v3",
      sourceBoundSnapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      normalizedBusinessHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect("canonicalDataHash" in snapshot).toBe(false);
  });

  it("keeps both hashes stable when only ingestedAt changes", () => {
    const precheck = precheckSellerSpriteXlsx(createOfficialShapeWorkbook(), {
      capturedAt: CAPTURED_AT,
    });
    const first = buildSellerSpriteMarketSnapshot(precheck);
    const second = buildSellerSpriteMarketSnapshot({
      ...precheck,
      ingestedAt: "2026-07-27T00:00:00.000Z",
    });

    expect(second.sourceBoundSnapshotHash).toBe(first.sourceBoundSnapshotHash);
    expect(second.normalizedBusinessHash).toBe(first.normalizedBusinessHash);
  });

  it("changes only the source-bound hash for irrelevant ZIP metadata bytes", () => {
    const base = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createWorkbook(),
      { capturedAt: CAPTURED_AT },
    ));
    const changedBytes = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createWorkbook(undefined, undefined, "US", [["docProps/custom.xml", "<metadata/>"]]),
      { capturedAt: CAPTURED_AT },
    ));

    expect(changedBytes.sourceBoundSnapshotHash).not.toBe(base.sourceBoundSnapshotHash);
    expect(changedBytes.normalizedBusinessHash).toBe(base.normalizedBusinessHash);
  });

  it("changes both hashes when a normalized business value changes", () => {
    const base = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createWorkbook(undefined, [SELLERSPRITE_SANITIZED_ROWS[0]]),
      { capturedAt: CAPTURED_AT },
    ));
    const changed = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createWorkbook(undefined, [{
        ...SELLERSPRITE_SANITIZED_ROWS[0],
        "价格($)": "26.99",
      }]),
      { capturedAt: CAPTURED_AT },
    ));

    expect(changed.sourceBoundSnapshotHash).not.toBe(base.sourceBoundSnapshotHash);
    expect(changed.normalizedBusinessHash).not.toBe(base.normalizedBusinessHash);
  });

  it("ignores source row positions in normalizedBusinessHash", () => {
    const base = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createWorkbook(undefined, [SELLERSPRITE_SANITIZED_ROWS[0]]),
      { capturedAt: CAPTURED_AT },
    ));
    const shifted = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createWorkbook(undefined, [SELLERSPRITE_SANITIZED_ROWS[0]], "US", [], undefined, (xml) => (
        xml
          .replace('<row r="2">', '<row r="12">')
          .replace(/r="([A-Z]+)2"/g, (_match, column: string) => `r="${column}12"`)
      )),
      { capturedAt: CAPTURED_AT },
    ));

    expect(shifted.sourceBoundSnapshotHash).not.toBe(base.sourceBoundSnapshotHash);
    expect(shifted.normalizedBusinessHash).toBe(base.normalizedBusinessHash);
  });

  it("ignores column order in normalizedBusinessHash", () => {
    const base = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: [SELLERSPRITE_SANITIZED_ROWS[0]] }),
      { capturedAt: CAPTURED_AT },
    ));
    const reordered = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({
        headers: [...SELLERSPRITE_SEARCH_EXPORT_HEADERS].reverse(),
        rows: [SELLERSPRITE_SANITIZED_ROWS[0]],
      }),
      { capturedAt: CAPTURED_AT },
    ));

    expect(reordered.normalizedBusinessHash).toBe(base.normalizedBusinessHash);
  });

  it("ignores worksheet order in normalizedBusinessHash", () => {
    const base = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook(),
      { capturedAt: CAPTURED_AT },
    ));
    const reordered = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ primaryFirst: false }),
      { capturedAt: CAPTURED_AT },
    ));

    expect(reordered.normalizedBusinessHash).toBe(base.normalizedBusinessHash);
  });

  it("projects every raw result row to a distinct search appearance", () => {
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook(),
      { capturedAt: CAPTURED_AT },
    ));

    expect(snapshot.appearances).toHaveLength(2);
    expect(new Set(snapshot.appearances.map((item) => item.appearanceIdentity)).size).toBe(2);
    expect(snapshot.appearances.every((item) => item.schemaVersion === "sellersprite-search-appearance.v2")).toBe(true);
    expect(snapshot.products[0]).toMatchObject({
      sponsoredAppearanceCount: 1,
      organicAppearanceCount: 0,
      unknownAppearanceCount: 0,
      bestSponsoredPage: 1,
      bestSponsoredPosition: 1,
      bestOrganicPage: null,
      bestOrganicPosition: null,
    });
  });

  it("preserves duplicate identical appearances instead of deduplicating them", () => {
    const row = SELLERSPRITE_SANITIZED_ROWS[0];
    const single = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: [row] }),
      { capturedAt: CAPTURED_AT },
    ));
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: [row, row] }),
      { capturedAt: CAPTURED_AT },
    ));

    expect(snapshot.appearances).toHaveLength(2);
    expect(snapshot.products).toHaveLength(1);
    expect(snapshot.products[0].appearances).toHaveLength(2);
    expect(snapshot.normalizedBusinessHash).not.toBe(single.normalizedBusinessHash);
  });

  it("resolves one product observation per ASIN without summing provider estimates", () => {
    const duplicate = {
      ...SELLERSPRITE_SANITIZED_ROWS[1],
      ASIN: "B0SAN00001",
      商品详情页链接: "https://www.amazon.com/dp/B0SAN00001",
      搜索排名: "自然位：第1页第2位",
      月销量: SELLERSPRITE_SANITIZED_ROWS[0].月销量,
    };
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: [SELLERSPRITE_SANITIZED_ROWS[0], duplicate] }),
      { capturedAt: CAPTURED_AT },
    ));

    expect(snapshot.products).toHaveLength(1);
    expect(snapshot.products[0].providerMetrics.estimatedMonthlySales.normalized).toBe(25957);
  });

  it("marks conflicting provider metrics unresolved and preserves all raw values", () => {
    const conflict = {
      ...SELLERSPRITE_SANITIZED_ROWS[0],
      搜索排名: "自然位：第1页第2位",
      "价格($)": "99.99",
    };
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: [SELLERSPRITE_SANITIZED_ROWS[0], conflict] }),
      { capturedAt: CAPTURED_AT },
    ));
    const price = snapshot.products[0].providerMetrics.price;

    expect(price.normalized).toBeNull();
    expect(price.status).toBe("conflict");
    expect(price.rawValues).toEqual(expect.arrayContaining(["$24.99", "99.99"]));
    expect(snapshot.products[0].warnings).toContain("conflicting_provider_metric:price");
  });

  it("does not select the first, minimum, or maximum monthly-sales estimate on conflict", () => {
    const conflict = {
      ...SELLERSPRITE_SANITIZED_ROWS[0],
      搜索排名: "自然位：第1页第2位",
      月销量: "999",
    };
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: [SELLERSPRITE_SANITIZED_ROWS[0], conflict] }),
      { capturedAt: CAPTURED_AT },
    ));
    const sales = snapshot.products[0].providerMetrics.estimatedMonthlySales;

    expect(sales).toMatchObject({
      status: "conflict",
      normalized: null,
      rawValues: ["25,957", "999"],
    });
    expect(snapshot.productWeightedSummary.estimatedMonthlySales).toMatchObject({
      validCount: 0,
      missingCount: 0,
      conflictCount: 1,
      minimum: null,
      median: null,
      maximum: null,
    });
  });

  it("does not double-weight a duplicated product in the default product median", () => {
    const duplicated = {
      ...SELLERSPRITE_SANITIZED_ROWS[0],
      搜索排名: "自然位：第1页第2位",
      月销量: "100",
    };
    const first = { ...SELLERSPRITE_SANITIZED_ROWS[0], 月销量: "100" };
    const second = { ...SELLERSPRITE_SANITIZED_ROWS[1], 月销量: "1000" };
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: [first, duplicated, second] }),
      { capturedAt: CAPTURED_AT },
    ));

    expect(snapshot.appearanceWeightedSummary!.estimatedMonthlySales.median).toBe(100);
    expect(snapshot.productWeightedSummary.estimatedMonthlySales.median).toBe(550);
  });

  it("groups families only from explicit Parent ASIN values", () => {
    const explicitChild = {
      ...SELLERSPRITE_SANITIZED_ROWS[1],
      父ASIN: "B0SAN00001",
    };
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: [SELLERSPRITE_SANITIZED_ROWS[0], explicitChild] }),
      { capturedAt: CAPTURED_AT },
    ));

    expect(snapshot.families).toContainEqual(expect.objectContaining({
      schemaVersion: "sellersprite-family-observation.v2",
      familyIdentity: expect.stringMatching(/^sellersprite-family-[a-f0-9]{24}$/),
      parentAsin: "B0SAN00001",
      childAsins: ["B0SAN00002"],
      productCount: 2,
      appearanceCount: 2,
      sponsoredAppearanceCount: 1,
      organicAppearanceCount: 1,
      conflictingMetricWarnings: [],
    }));
  });

  it("does not infer a family from matching titles or brands", () => {
    const similar = {
      ...SELLERSPRITE_SANITIZED_ROWS[1],
      品牌: SELLERSPRITE_SANITIZED_ROWS[0].品牌,
      商品标题: SELLERSPRITE_SANITIZED_ROWS[0].商品标题,
      父ASIN: "",
    };
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: [SELLERSPRITE_SANITIZED_ROWS[0], similar] }),
      { capturedAt: CAPTURED_AT },
    ));

    expect(snapshot.families).toEqual([]);
  });

  it("does not assign a child to either family when Parent ASIN evidence conflicts", () => {
    const first = {
      ...SELLERSPRITE_SANITIZED_ROWS[0],
      父ASIN: "B0PARENT01",
    };
    const second = {
      ...SELLERSPRITE_SANITIZED_ROWS[0],
      搜索排名: "自然位：第1页第2位",
      父ASIN: "B0PARENT02",
    };
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: [first, second] }),
      { capturedAt: CAPTURED_AT },
    ));

    expect(snapshot.products[0]).toMatchObject({
      parentAsin: null,
      conflictingMetrics: expect.arrayContaining(["parentAsin"]),
      warnings: expect.arrayContaining(["conflicting_provider_metric:parentAsin"]),
    });
    expect(snapshot.appearances.map((appearance) => appearance.parentAsin)).toEqual([
      "B0PARENT01",
      "B0PARENT02",
    ]);
    expect(snapshot.families).toEqual([]);
  });

  it("labels Provider Evidence with usage policy and never upgrades estimates to facts", () => {
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: [SELLERSPRITE_SANITIZED_ROWS[0]] }),
      { capturedAt: CAPTURED_AT },
    ));
    const evidence = snapshot.appearances[0].providerEvidence;
    const sales = evidence.find((item) => item.fieldName === "estimatedMonthlySales");

    expect(sales).toMatchObject({
      source: "SellerSprite",
      sourceType: "provider_metric",
      metricNature: "estimate",
      usagePolicy: "screening_signal_only",
      fieldName: "estimatedMonthlySales",
      raw: "25,957",
      normalized: 25957,
      unit: "units_per_month_estimate",
      marketplace: "amazon.com",
      sourceFileSha256: snapshot.sourceFileSha256,
      appearanceIdentity: snapshot.appearances[0].appearanceIdentity,
      asin: "B0SAN00001",
      capturedAt: CAPTURED_AT,
      capturedAtSemantics: "caller_supplied_ingestion_context",
      exportedAt: null,
      providerUpdatedAt: null,
      freshnessStatus: "unknown",
      warnings: [],
    });
    expect(new Set(evidence.map((item) => item.sourceType))).toEqual(new Set(["provider_metric"]));
  });

  it("classifies variation count and raw seller/logistics fields as snapshot", () => {
    const row = {
      ...SELLERSPRITE_SANITIZED_ROWS[0],
      变体数: "12",
      卖家数: "4",
      配送方式: "FBA",
      上架时间: "2024-01-01",
    };
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: [row] }),
      { capturedAt: CAPTURED_AT },
    ));

    expect(snapshot.records[0].variationCount.metricNature).toBe("snapshot");
    expect(snapshot.records[0].extraRawMetricNature).toMatchObject({
      卖家数: "snapshot",
      配送方式: "snapshot",
      上架时间: "snapshot",
    });
  });

  it("reports both appearance-weighted and conflict-safe product-weighted statistics", () => {
    const conflict = {
      ...SELLERSPRITE_SANITIZED_ROWS[0],
      搜索排名: "自然位：第1页第2位",
      "价格($)": "99.99",
    };
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: [SELLERSPRITE_SANITIZED_ROWS[0], conflict] }),
      { capturedAt: CAPTURED_AT },
    ));

    expect(snapshot.appearanceWeightedSummary!.price).toMatchObject({
      validCount: 2,
      missingCount: 0,
      conflictCount: 0,
    });
    expect(snapshot.productWeightedSummary.price).toMatchObject({
      validCount: 0,
      missingCount: 0,
      conflictCount: 1,
      minimum: null,
      median: null,
      maximum: null,
    });
  });
});

describe("SellerSprite Offline Contract R2 Brief-bound safe shadow report", () => {
  function validBrief(overrides: Record<string, unknown> = {}) {
    return createSellerSpriteShadowSelectionBrief({
      marketplace: "amazon.com",
      market: "US",
      currency: "USD",
      query: "storage boxes",
      category: "Home & Kitchen",
      priceMin: 20,
      priceMax: 100,
      requiredSignals: ["price", "rating", "reviews"],
      optionalSignals: ["estimatedMonthlySales", "estimatedMonthlyRevenue"],
      createdAt: CAPTURED_AT,
      briefSource: "user_supplied",
      ...overrides,
    });
  }

  it("requires a nonempty query", () => {
    expect(() => validBrief({ query: " " })).toThrow("SELLERSPRITE_BRIEF_QUERY_REQUIRED");
  });

  it("requires the amazon.com US marketplace", () => {
    expect(() => validBrief({ marketplace: "amazon.co.uk" })).toThrow(
      "SELLERSPRITE_BRIEF_MARKETPLACE_INVALID",
    );
  });

  it("requires USD for the US marketplace", () => {
    expect(() => validBrief({ currency: "EUR" })).toThrow(
      "SELLERSPRITE_BRIEF_CURRENCY_INVALID",
    );
  });

  it("rejects an inverted price range instead of generating a fallback", () => {
    expect(() => validBrief({ priceMin: 101, priceMax: 100 })).toThrow(
      "SELLERSPRITE_BRIEF_PRICE_RANGE_INVALID",
    );
  });

  it("produces a deterministic briefHash that excludes createdAt", () => {
    const first = validBrief();
    const second = validBrief({ createdAt: "2026-07-27T00:00:00.000Z" });
    const changed = validBrief({ priceMax: 101 });

    expect(second.briefHash).toBe(first.briefHash);
    expect(changed.briefHash).not.toBe(first.briefHash);
  });

  it.each([
    ["priceMin", 21],
    ["priceMax", 101],
    ["query", "changed storage boxes"],
    ["requiredSignals", ["price", "rating", "reviews", "seller"]],
    ["optionalSignals", ["estimatedMonthlySales", "variationCount"]],
  ] as const)("rejects a stale briefHash after %s is changed", (field, value) => {
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook(),
      { capturedAt: CAPTURED_AT },
    ));
    const brief = validBrief();
    const tampered = { ...brief, [field]: value } as ReturnType<typeof validBrief>;

    expect(() => buildSellerSpriteBriefBoundShadowReport(snapshot, tampered)).toThrow(
      "SELLERSPRITE_BRIEF_HASH_MISMATCH",
    );
  });

  it("rejects an invalid currency even when a stale briefHash is supplied", () => {
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook(),
      { capturedAt: CAPTURED_AT },
    ));
    const brief = validBrief();

    expect(() => buildSellerSpriteBriefBoundShadowReport(
      snapshot,
      { ...brief, currency: "EUR" } as never,
    )).toThrow("SELLERSPRITE_BRIEF_CURRENCY_INVALID");
  });

  it("rejects a missing business field even when the old briefHash is retained", () => {
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook(),
      { capturedAt: CAPTURED_AT },
    ));
    const tampered = { ...validBrief() } as Partial<ReturnType<typeof validBrief>>;
    delete tampered.category;

    expect(() => buildSellerSpriteBriefBoundShadowReport(
      snapshot,
      tampered as never,
    )).toThrow("SELLERSPRITE_BRIEF_CATEGORY_INVALID");
  });

  it("rejects an explicitly incorrect briefHash", () => {
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook(),
      { capturedAt: CAPTURED_AT },
    ));
    const brief = validBrief();

    expect(() => buildSellerSpriteBriefBoundShadowReport(
      snapshot,
      { ...brief, briefHash: "0".repeat(64) },
    )).toThrow("SELLERSPRITE_BRIEF_HASH_MISMATCH");
  });

  it("copies caller arrays during Brief creation and report validation", () => {
    const requiredSignals = ["reviews", "price"];
    const optionalSignals = ["estimatedMonthlySales"];
    const brief = createSellerSpriteShadowSelectionBrief({
      marketplace: "amazon.com",
      market: "US",
      currency: "USD",
      query: "storage boxes",
      category: "Home & Kitchen",
      priceMin: 20,
      priceMax: 100,
      requiredSignals,
      optionalSignals,
      createdAt: CAPTURED_AT,
      briefSource: "user_supplied",
    });
    requiredSignals.push("seller");
    optionalSignals.push("variationCount");
    expect(brief.requiredSignals).toEqual(["price", "reviews"]);
    expect(brief.optionalSignals).toEqual(["estimatedMonthlySales"]);

    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook(),
      { capturedAt: CAPTURED_AT },
    ));
    const report = buildSellerSpriteBriefBoundShadowReport(snapshot, brief);
    (brief.requiredSignals as string[]).push("seller");
    (brief.optionalSignals as string[]).push("variationCount");

    expect(report.brief.requiredSignals).toEqual(["price", "reviews"]);
    expect(report.brief.optionalSignals).toEqual(["estimatedMonthlySales"]);
  });

  it("normalizes equivalent Brief inputs to the same hash", () => {
    const first = validBrief({
      query: " storage boxes ",
      category: " Home & Kitchen ",
      requiredSignals: ["reviews", "price", "reviews"],
      optionalSignals: ["estimatedMonthlySales", "price"],
    });
    const second = validBrief({
      query: "storage boxes",
      category: "Home & Kitchen",
      requiredSignals: ["price", "reviews"],
      optionalSignals: ["estimatedMonthlySales"],
    });

    expect(first.briefHash).toBe(second.briefHash);
    expect(first.requiredSignals).toEqual(second.requiredSignals);
    expect(first.optionalSignals).toEqual(second.optionalSignals);
  });

  it("fails closed when the Brief is absent", () => {
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook(),
      { capturedAt: CAPTURED_AT },
    ));

    expect(() => buildSellerSpriteBriefBoundShadowReport(
      snapshot,
      undefined as never,
    )).toThrow("SELLERSPRITE_SHADOW_BRIEF_VERSION_INVALID");
  });

  it("binds price fit to the supplied Brief instead of the legacy 15-45 band", () => {
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: [{
        ...SELLERSPRITE_SANITIZED_ROWS[1],
        "价格($)": "79",
      }] }),
      { capturedAt: CAPTURED_AT },
    ));
    const report = buildSellerSpriteBriefBoundShadowReport(snapshot, validBrief({
      priceMin: 70,
      priceMax: 90,
    }));
    const priceComponent = report.products[0].scoreSources.find(
      (item) => item.component === "briefPriceFit",
    );

    expect(priceComponent?.normalizedValue).toBe(79);
    expect(priceComponent?.provisionalPoints).toBeGreaterThan(0);
  });

  it("keeps hard gates unknown and makes every product ineligible for promotion", () => {
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook(),
      { capturedAt: CAPTURED_AT },
    ));
    const report = buildSellerSpriteBriefBoundShadowReport(snapshot, validBrief());

    expect(report).toMatchObject({
      schemaVersion: "sellersprite-brief-bound-shadow-report.v2",
      authoritative: false,
      promotionAllowed: false,
      promotionEligible: false,
      hardGateEvidenceStatus: "unknown",
      hardGateEvaluable: false,
      productionEffect: false,
      productionDatabaseWritten: false,
      manifestRegistered: false,
      query: "storage boxes",
      appearanceCount: 2,
      productCount: 2,
      familyCount: snapshot.families.length,
      fieldCoverage: expect.any(Object),
      conflictCounts: {},
      missingSignals: expect.any(Array),
    });
    expect(report.products.every((product) => (
      product.promotionEligible === false
      && product.hardGateEvidenceStatus === "unknown"
      && product.hardGateEvaluable === false
    ))).toBe(true);
    expect("shadowDistribution" in report).toBe(false);
    expect("legacyUsesEmptyObservedRiskFlags" in report).toBe(false);
    expect("observedRiskFlags" in report).toBe(false);
    expect(report.products.every((product) => !("observedRiskFlags" in product))).toBe(true);
    expect(report.products[0]).toMatchObject({
      parentAsin: null,
      appearanceSummary: {
        appearanceCount: 1,
        sponsoredCount: 1,
        organicCount: 0,
        unknownCount: 0,
      },
      providerEvidenceSummary: {
        evidenceCount: 18,
        sourceTypes: ["provider_metric"],
      },
      missingSignals: expect.any(Array),
      conflictingSignals: [],
      briefPriceBandResult: {
        currency: "USD",
        priceMin: 20,
        priceMax: 100,
      },
      scoreBreakdown: expect.any(Array),
      distortionReasons: expect.arrayContaining([
        "hard_gate_evidence_unknown",
        "provider_metrics_are_not_direct_observations",
      ]),
    });
  });

  it("uses only provisional dispositions and never emits advance, watch, or reject", () => {
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook(),
      { capturedAt: CAPTURED_AT },
    ));
    const report = buildSellerSpriteBriefBoundShadowReport(snapshot, validBrief());

    expect(report.products.every((product) => [
      "provisional_score_only",
      "insufficient_hard_gate_evidence",
      "conflicting_provider_metrics",
      "insufficient_required_signals",
    ].includes(product.provisionalDisposition))).toBe(true);
    expect(Object.keys(report.provisionalDistribution)).toEqual([
      "provisional_score_only",
      "insufficient_hard_gate_evidence",
      "conflicting_provider_metrics",
      "insufficient_required_signals",
    ]);
    for (const key of ["advance", "watch", "reject", "formalDisposition", "promotionDecision"]) {
      expect(key in report).toBe(false);
      expect(report.products.every((product) => !(key in product))).toBe(true);
    }
  });

  it("does not calculate a favorable score for conflicting provider metrics", () => {
    const conflict = {
      ...SELLERSPRITE_SANITIZED_ROWS[0],
      搜索排名: "自然位：第1页第2位",
      "价格($)": "99.99",
    };
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: [SELLERSPRITE_SANITIZED_ROWS[0], conflict] }),
      { capturedAt: CAPTURED_AT },
    ));
    const report = buildSellerSpriteBriefBoundShadowReport(snapshot, validBrief());

    expect(report.products[0]).toMatchObject({
      provisionalNumericScore: null,
      provisionalDisposition: "conflicting_provider_metrics",
      promotionEligible: false,
    });
  });

  it("reports missing required signals without converting them to zero", () => {
    const missing = { ...SELLERSPRITE_SANITIZED_ROWS[0], 评分: "" };
    const snapshot = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createOfficialShapeWorkbook({ rows: [missing] }),
      { capturedAt: CAPTURED_AT },
    ));
    const report = buildSellerSpriteBriefBoundShadowReport(snapshot, validBrief());

    expect(report.products[0]).toMatchObject({
      provisionalNumericScore: null,
      provisionalDisposition: "insufficient_required_signals",
      missingRequiredSignals: ["rating"],
    });
  });
});
