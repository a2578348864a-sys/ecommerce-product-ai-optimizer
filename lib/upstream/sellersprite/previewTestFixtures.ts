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

export type StoredZipEntry = {
  name: string;
  content: string | Buffer;
  flags?: number;
  compressionMethod?: number;
  centralChecksum?: number;
  centralCompressedSize?: number;
  centralUncompressedSize?: number;
  localChecksum?: number;
  localCompressedSize?: number;
  localUncompressedSize?: number;
  centralExtra?: Buffer;
  localExtra?: Buffer;
};

export function createStoredZip(entries: readonly StoredZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf8");
    const checksum = crc32(content);
    const flags = entry.flags ?? 0x0800;
    const compressionMethod = entry.compressionMethod ?? 0;
    const localExtra = entry.localExtra ?? Buffer.alloc(0);
    const centralExtra = entry.centralExtra ?? Buffer.alloc(0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(compressionMethod, 8);
    local.writeUInt32LE(entry.localChecksum ?? checksum, 14);
    local.writeUInt32LE(entry.localCompressedSize ?? content.length, 18);
    local.writeUInt32LE(entry.localUncompressedSize ?? content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    localParts.push(local, nameBytes, localExtra, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(compressionMethod, 10);
    central.writeUInt32LE(entry.centralChecksum ?? checksum, 16);
    central.writeUInt32LE(entry.centralCompressedSize ?? content.length, 20);
    central.writeUInt32LE(entry.centralUncompressedSize ?? content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(centralExtra.length, 30);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes, centralExtra);
    offset += local.length + nameBytes.length + localExtra.length + content.length;
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
    .replaceAll('"', "&quot;")
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

function buildWorksheetXml(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | null>>,
): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
    `<row r="1">${headers.map((header, index) => `<c r="${columnName(index)}1" t="inlineStr"><is><t>${xmlEscape(header)}</t></is></c>`).join("")}</row>`,
    ...rows.map((row, rowIndex) => {
      const rowNumber = rowIndex + 2;
      const cells = row.flatMap((value, columnIndex) => value === null
        ? []
        : [`<c r="${columnName(columnIndex)}${rowNumber}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`]);
      return `<row r="${rowNumber}">${cells.join("")}</row>`;
    }),
    "</sheetData></worksheet>",
  ].join("");
}

export function createSellerSpritePreviewWorkbook(options: {
  headers: readonly string[];
  rows: ReadonlyArray<ReadonlyArray<string | null>>;
  sheetName?: string;
  sheetXmlOverride?: string;
  sheetState?: "hidden" | "veryHidden";
  contentTypesXmlOverride?: string;
  workbookXmlOverride?: string;
  workbookRelationshipsXmlOverride?: string;
  extraEntries?: readonly StoredZipEntry[];
}): Buffer {
  const sheetXml = options.sheetXmlOverride ?? buildWorksheetXml(options.headers, options.rows);

  return createStoredZip([
    {
      name: "[Content_Types].xml",
      content: options.contentTypesXmlOverride
        ?? '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    },
    {
      name: "xl/workbook.xml",
      content: options.workbookXmlOverride
        ?? `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${options.sheetName ?? "US"}" sheetId="1" r:id="rId1"${options.sheetState ? ` state="${options.sheetState}"` : ""}/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: options.workbookRelationshipsXmlOverride
        ?? '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml },
    ...(options.extraEntries ?? []),
  ]);
}

export type PreviewFixtureSheetSpec = {
  name: string;
  state?: "hidden" | "veryHidden";
  headers?: readonly string[];
  rows?: ReadonlyArray<ReadonlyArray<string | null>>;
};

/**
 * Build a multi-worksheet workbook fixture with fully controlled sheet order.
 * Used to model the real SellerSprite layout: a "US" business sheet plus
 * optional "Brands" / "Sellers" / "Note" metadata sheets.
 */
export function createSellerSpritePreviewWorkbookWithSheets(
  sheets: readonly PreviewFixtureSheetSpec[],
  options: {
    extraEntries?: readonly StoredZipEntry[];
    contentTypesXmlOverride?: string;
    workbookRelationshipsXmlOverride?: string;
    activeTab?: number;
  } = {},
): Buffer {
  if (sheets.length === 0) throw new Error("at least one sheet required");
  const seen = new Set<string>();
  for (const sheet of sheets) {
    if (!sheet.name || seen.has(sheet.name)) throw new Error("duplicate or missing sheet name");
    seen.add(sheet.name);
  }

  const workbookPr = options.activeTab !== undefined
    ? `<workbookPr activeTab="${options.activeTab}"/>`
    : "";
  const workbookXml = [
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    workbookPr,
    `<sheets>${sheets.map((sheet, index) => (
      `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"${sheet.state ? ` state="${sheet.state}"` : ""}/>`
    )).join("")}</sheets></workbook>`,
  ].join("");

  const relsXml = options.workbookRelationshipsXmlOverride
    ?? [
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      sheets.map((_, index) => (
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
      )).join(""),
      "</Relationships>",
    ].join("");

  return createStoredZip([
    {
      name: "[Content_Types].xml",
      content: options.contentTypesXmlOverride
        ?? '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    },
    { name: "xl/workbook.xml", content: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", content: relsXml },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: buildWorksheetXml(sheet.headers ?? [], sheet.rows ?? []),
    })),
    ...(options.extraEntries ?? []),
  ]);
}

export function corruptCentralDirectoryAsZip64(input: Buffer): Buffer {
  const output = Buffer.from(input);
  const endOffset = output.length - 22;
  output.writeUInt16LE(0xffff, endOffset + 10);
  return output;
}
