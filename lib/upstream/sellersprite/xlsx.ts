import { inflateRawSync } from "node:zlib";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_ENTRY_COUNT = 256;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 200;
const MAX_WORKSHEET_ROWS = 100_000;
const MAX_WORKSHEET_CELLS = 1_000_000;
const MAX_WORKSHEET_COLUMNS = 512;
const WORKSHEET_RELATIONSHIP_TYPES = new Set([
  "http://schemas.openxmlformats.org/officedocument/2006/relationships/worksheet",
  "http://purl.oclc.org/ooxml/officedocument/relationships/worksheet",
]);

interface ZipEntry {
  name: string;
  checksum: number;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  flags: number;
  localHeaderOffset: number;
}

export interface XlsxRow {
  rowNumber: number;
  values: ReadonlyArray<string | null>;
}

export interface XlsxSheet {
  name: string;
  rows: ReadonlyArray<XlsxRow>;
}

export interface XlsxWorkbook {
  sheets: ReadonlyArray<XlsxSheet>;
}

export class SellerSpriteXlsxError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SellerSpriteXlsxError";
  }
}

function fail(code: string, message: string): never {
  throw new SellerSpriteXlsxError(code, message);
}

function assertRange(buffer: Buffer, offset: number, length: number, code = "invalid_xlsx"): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    fail(code, "XLSX archive contains an invalid byte range");
  }
  if (offset + length > buffer.length) {
    fail(code, "XLSX archive is truncated");
  }
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return fail("invalid_xlsx", "XLSX ZIP end record was not found");
}

function isUnsafeArchivePath(name: string): boolean {
  return (
    name.length === 0
    || name.startsWith("/")
    || name.startsWith("\\")
    || name.includes("\\")
    || name.split("/").some((segment) => segment === "..")
  );
}

function readZipEntries(buffer: Buffer): Map<string, ZipEntry> {
  if (buffer.length > MAX_SOURCE_BYTES) {
    fail("xlsx_file_too_large", `XLSX file exceeds ${MAX_SOURCE_BYTES} bytes`);
  }
  if (buffer.length < 22) fail("invalid_xlsx", "XLSX file is too small to be a ZIP archive");

  const endOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(endOffset + 4);
  const centralDisk = buffer.readUInt16LE(endOffset + 6);
  const diskEntries = buffer.readUInt16LE(endOffset + 8);
  const totalEntries = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    fail("unsupported_xlsx_feature", "Multi-disk XLSX archives are not supported");
  }
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    fail("unsupported_xlsx_feature", "ZIP64 XLSX archives are not supported");
  }
  if (totalEntries > MAX_ENTRY_COUNT) {
    fail("xlsx_archive_limit_exceeded", `XLSX archive has more than ${MAX_ENTRY_COUNT} entries`);
  }
  assertRange(buffer, centralOffset, centralSize);

  const entries = new Map<string, ZipEntry>();
  let totalUncompressedBytes = 0;
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    assertRange(buffer, offset, 46);
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      fail("invalid_xlsx", "XLSX central directory is malformed");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const checksum = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    assertRange(buffer, offset + 46, nameLength + extraLength + commentLength);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    if (isUnsafeArchivePath(name)) {
      fail("unsafe_xlsx_archive_path", "XLSX archive contains an unsafe entry path");
    }
    if (entries.has(name)) fail("invalid_xlsx", "XLSX archive contains duplicate entry names");
    if ((flags & 0x0001) !== 0) {
      fail("unsupported_xlsx_feature", "Encrypted XLSX entries are not supported");
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      fail("unsupported_xlsx_feature", `Unsupported XLSX compression method: ${compressionMethod}`);
    }
    if (uncompressedSize > MAX_ENTRY_BYTES) {
      fail("xlsx_archive_limit_exceeded", "An XLSX entry exceeds the uncompressed size limit");
    }
    if (
      uncompressedSize > 1024 * 1024
      && (compressedSize === 0 || uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO)
    ) {
      fail("xlsx_archive_limit_exceeded", "XLSX compression ratio exceeds the safety limit");
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      fail("xlsx_archive_limit_exceeded", "XLSX uncompressed content exceeds the safety limit");
    }

    entries.set(name, {
      name,
      checksum,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      flags,
      localHeaderOffset,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset > centralOffset + centralSize) {
    fail("invalid_xlsx", "XLSX central directory size does not match its entries");
  }
  return entries;
}

function readEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localHeaderOffset;
  assertRange(buffer, offset, 30);
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    fail("invalid_xlsx", "XLSX local ZIP header is malformed");
  }
  const localFlags = buffer.readUInt16LE(offset + 6);
  const localMethod = buffer.readUInt16LE(offset + 8);
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  if (localFlags !== entry.flags || localMethod !== entry.compressionMethod) {
    fail("invalid_xlsx", "XLSX ZIP headers disagree about an entry");
  }
  assertRange(buffer, offset + 30, nameLength + extraLength);
  const localName = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
  if (localName !== entry.name) fail("invalid_xlsx", "XLSX ZIP headers disagree about an entry name");
  const dataOffset = offset + 30 + nameLength + extraLength;
  assertRange(buffer, dataOffset, entry.compressedSize);
  const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);
  const output = entry.compressionMethod === 0
    ? Buffer.from(compressed)
    : inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
  if (output.length !== entry.uncompressedSize) {
    fail("invalid_xlsx", "XLSX entry length does not match its ZIP metadata");
  }
  if (crc32(output) !== entry.checksum) {
    fail("invalid_xlsx", "XLSX entry checksum is invalid");
  }
  return output;
}

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

function decodeXml(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([\da-fA-F]+)|amp|lt|gt|quot|apos);/g, (entity, decimal, hex) => {
    if (decimal !== undefined) return String.fromCodePoint(Number.parseInt(decimal, 10));
    if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
    switch (entity) {
      case "&amp;": return "&";
      case "&lt;": return "<";
      case "&gt;": return ">";
      case "&quot;": return "\"";
      case "&apos;": return "'";
      default: return entity;
    }
  });
}

function parseAttributes(fragment: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of fragment.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1]] = decodeXml(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function textNodes(fragment: string): string {
  return [...fragment.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXml(match[1].replace(/<[^>]+>/g, "")))
    .join("");
}

function parseSharedStrings(xml: string | null): ReadonlyArray<string> {
  if (xml === null) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => textNodes(match[1]));
}

function parseCellReference(reference: string): { columnIndex: number; rowNumber: number } | null {
  const match = /^([A-Za-z]+)([1-9]\d*)$/.exec(reference);
  if (!match) return null;
  let result = 0;
  for (const character of match[1].toUpperCase()) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  const rowNumber = Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(rowNumber)) return null;
  return { columnIndex: result - 1, rowNumber };
}

function parseCellValue(cellAttributes: string, body: string, sharedStrings: ReadonlyArray<string>): string | null {
  const attributes = parseAttributes(cellAttributes);
  if (/<(?:[^<>\s/:]+:)?f(?:\s|\/?>)/.test(body)) {
    fail("unsupported_xlsx_feature", "Formula cells are not supported in SellerSprite imports");
  }
  if (attributes.t === "inlineStr") return textNodes(body);
  const valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
  if (!valueMatch) return null;
  const value = decodeXml(valueMatch[1]);
  if (attributes.t === "s") {
    const index = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(index) || index < 0 || index >= sharedStrings.length) {
      fail("invalid_xlsx", "XLSX shared string index is invalid");
    }
    return sharedStrings[index];
  }
  if (attributes.t === "b") return value === "1" ? "TRUE" : "FALSE";
  if (attributes.t === "e") return null;
  return value;
}

function parseSheetRows(xml: string, sharedStrings: ReadonlyArray<string>): ReadonlyArray<XlsxRow> {
  const rows: XlsxRow[] = [];
  const seenRowNumbers = new Set<number>();
  let implicitRowNumber = 0;
  let cellCount = 0;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= MAX_WORKSHEET_ROWS) {
      fail("xlsx_sheet_limit_exceeded", "XLSX worksheet exceeds the row limit");
    }
    const rowAttributes = parseAttributes(rowMatch[1]);
    const parsedRowNumber = Number.parseInt(rowAttributes.r ?? "", 10);
    const rowNumber = Number.isSafeInteger(parsedRowNumber) && parsedRowNumber > 0
      ? parsedRowNumber
      : implicitRowNumber + 1;
    if (seenRowNumbers.has(rowNumber)) {
      fail("invalid_xlsx", "XLSX worksheet contains duplicate row numbers");
    }
    seenRowNumbers.add(rowNumber);
    implicitRowNumber = rowNumber;
    const values: Array<string | null> = [];
    const seenColumns = new Set<number>();
    let implicitColumn = 0;
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      cellCount += 1;
      if (cellCount > MAX_WORKSHEET_CELLS) {
        fail("xlsx_sheet_limit_exceeded", "XLSX worksheet exceeds the cell limit");
      }
      const attributes = parseAttributes(cellMatch[1]);
      const parsedReference = attributes.r ? parseCellReference(attributes.r) : null;
      if (attributes.r && parsedReference === null) {
        fail("invalid_xlsx", "XLSX cell reference is invalid");
      }
      if (parsedReference !== null && parsedReference.rowNumber !== rowNumber) {
        fail(
          "cell_row_reference_mismatch",
          "XLSX cell row reference does not match its row container",
        );
      }
      const index = parsedReference?.columnIndex ?? implicitColumn;
      if (index < 0 || index >= MAX_WORKSHEET_COLUMNS) {
        fail("xlsx_sheet_limit_exceeded", "XLSX worksheet exceeds the column limit");
      }
      if (seenColumns.has(index)) {
        fail("duplicate_cell_reference", "XLSX worksheet contains duplicate cell references");
      }
      seenColumns.add(index);
      values[index] = parseCellValue(cellMatch[1], cellMatch[2] ?? "", sharedStrings);
      implicitColumn = index + 1;
    }
    if (values.some((value) => value !== null && value !== "")) {
      rows.push({ rowNumber, values });
    }
  }
  return rows;
}

function resolveWorkbookTarget(target: string): string {
  const normalized = target.replaceAll("\\", "/").replace(/^\/+/, "");
  const combined = normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
  const parts: string[] = [];
  for (const part of combined.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) fail("unsafe_xlsx_archive_path", "Workbook relationship escapes the archive root");
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

export function parseXlsxWorkbook(input: Uint8Array): XlsxWorkbook {
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const entries = readZipEntries(buffer);
  const forbiddenEntry = [...entries.keys()].find((name) => (
    /^xl\/externalLinks\//i.test(name)
    || /(?:^|\/)vbaProject\.bin$/i.test(name)
    || /^xl\/connections\.xml$/i.test(name)
    || /^xl\/embeddings\//i.test(name)
    || /^xl\/activeX\//i.test(name)
    || /^customUI\//i.test(name)
  ));
  if (forbiddenEntry) {
    fail("unsupported_xlsx_feature", `Unsupported external or executable XLSX content: ${forbiddenEntry}`);
  }

  const readText = (name: string, required = true): string | null => {
    const entry = entries.get(name);
    if (!entry) {
      if (required) fail("invalid_xlsx", `XLSX entry is missing: ${name}`);
      return null;
    }
    return readEntry(buffer, entry).toString("utf8");
  };

  const contentTypesXml = readText("[Content_Types].xml", false);
  if (
    contentTypesXml !== null
    && /(?:macroEnabled|vbaProject|oleObject|externalLink|activeX|connections)/i.test(contentTypesXml)
  ) {
    fail("unsupported_xlsx_feature", "Unsupported active or external XLSX content type");
  }
  for (const name of entries.keys()) {
    if (!/\.rels$/i.test(name)) continue;
    const relationshipsDocument = readText(name)!;
    for (
      const match of relationshipsDocument.matchAll(
        /<(?:[^<>\s/:]+:)?Relationship\b([^>]*?)\/?>/g,
      )
    ) {
      const attributes = parseAttributes(match[1]);
      const type = (attributes.Type ?? "").toLowerCase();
      const targetMode = (attributes.TargetMode ?? "").toLowerCase();
      if (
        /(?:externallink|oleobject|vbaproject|activex|connections)/.test(type)
        || (targetMode === "external" && !type.endsWith("/hyperlink"))
      ) {
        fail("unsupported_xlsx_feature", "Unsupported active or external XLSX relationship");
      }
    }
  }

  const workbookXml = readText("xl/workbook.xml")!;
  const relationshipsXml = readText("xl/_rels/workbook.xml.rels")!;
  const sharedStrings = parseSharedStrings(readText("xl/sharedStrings.xml", false));
  const relationships = new Map<string, { target: string; type: string }>();
  for (
    const match of relationshipsXml.matchAll(
      /<(?:[^<>\s/:]+:)?Relationship\b([^>]*?)\/?>/g,
    )
  ) {
    const attributes = parseAttributes(match[1]);
    if (!attributes.Id || !attributes.Target || !attributes.Type) continue;
    if (relationships.has(attributes.Id)) {
      fail("invalid_xlsx", "Workbook contains duplicate relationship identifiers");
    }
    relationships.set(attributes.Id, {
      target: attributes.Target,
      type: attributes.Type,
    });
  }

  const sheets: XlsxSheet[] = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const attributes = parseAttributes(match[1]);
    if (!attributes.name || !attributes["r:id"] || attributes.state === "hidden" || attributes.state === "veryHidden") {
      continue;
    }
    const relationship = relationships.get(attributes["r:id"]);
    if (!relationship) fail("invalid_xlsx", "Workbook sheet relationship is missing");
    if (!WORKSHEET_RELATIONSHIP_TYPES.has(relationship.type.toLowerCase())) {
      fail("invalid_xlsx", "Workbook sheet relationship is not a worksheet");
    }
    const sheetPath = resolveWorkbookTarget(relationship.target);
    if (!/^xl\/worksheets\/[^/]+\.xml$/i.test(sheetPath)) {
      fail("invalid_xlsx", "Workbook worksheet target is outside xl/worksheets");
    }
    const sheetXml = readText(sheetPath)!;
    const rows = parseSheetRows(sheetXml, sharedStrings);
    sheets.push({
      name: attributes.name,
      rows,
    });
  }
  if (sheets.length === 0) fail("unsupported_sheet", "XLSX workbook has no visible worksheets");
  return { sheets };
}
