import {
  SELLERSPRITE_SANITIZED_ROWS,
  SELLERSPRITE_SEARCH_EXPORT_HEADERS,
} from "../../../lib/upstream/sellersprite/fixtures/search-export.sanitized.v1";

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

function sheetXml(
  headers: readonly string[],
  rows: ReadonlyArray<Readonly<Record<string, string>>>,
): string {
  const allRows = [
    Object.fromEntries(headers.map((header) => [header, header])),
    ...rows,
  ];
  const renderedRows = allRows.map((row, rowIndex) => {
    const cells = headers.flatMap((header, columnIndex) => {
      const value = row[header];
      if (value === undefined || value === "") return [];
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      return [`<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`];
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

export interface SellerSpritePreviewWorkbookOptions {
  headers?: readonly string[];
  rows?: ReadonlyArray<Readonly<Record<string, string>>>;
  includeBrands?: boolean;
  includeSellers?: boolean;
  sellersHeaders?: readonly string[];
}

export function createSellerSpritePreviewTestWorkbook(
  options: SellerSpritePreviewWorkbookOptions = {},
): Buffer {
  const sheetDefinitions = [
    {
      name: "US",
      headers: options.headers ?? SELLERSPRITE_SEARCH_EXPORT_HEADERS,
      rows: options.rows ?? SELLERSPRITE_SANITIZED_ROWS,
    },
    ...(options.includeBrands === false ? [] : [{
      name: "Brands",
      headers: ["品牌", "市场份额"],
      rows: [
        { 品牌: "Sanitized Brand", 市场份额: "0.75" },
        { 品牌: "Other Brand", 市场份额: "0.25" },
      ],
    }]),
    ...(options.includeSellers === false ? [] : [{
      name: "Sellers",
      headers: options.sellersHeaders ?? ["卖家", "市场份额"],
      rows: [
        { 卖家: "Sanitized Seller", Seller: "Duplicate Seller", 市场份额: "0.6" },
        { 卖家: "Other Seller", Seller: "Other Duplicate", 市场份额: "0.4" },
      ],
    }]),
    {
      name: "Note",
      headers: ["Note"],
      rows: [{ Note: "脱敏测试说明，不提供精确更新时间。" }],
    },
  ];
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
