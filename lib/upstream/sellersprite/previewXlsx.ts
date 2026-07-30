import { inflateRawSync } from "node:zlib";
import { isIP } from "node:net";

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const UTF8_FLAG = 0x0800;
const ENCRYPTION_FLAGS = 0x0001 | 0x0040;
const EXTERNAL_HYPERLINK_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const MAX_EXTERNAL_HYPERLINK_TARGET_LENGTH = 2048;

export const DEFAULT_SELLERSPRITE_PREVIEW_XLSX_LIMITS = {
  maxSourceBytes: 8 * 1024 * 1024,
  maxEntryCount: 128,
  maxEntryUncompressedBytes: 8 * 1024 * 1024,
  maxTotalUncompressedBytes: 20 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxRowsPerSheet: 20_000,
  maxColumnsPerRow: 128,
  maxCellsPerSheet: 250_000,
} as const;

type XlsxLimits = { [Key in keyof typeof DEFAULT_SELLERSPRITE_PREVIEW_XLSX_LIMITS]: number };
export type SellerSpritePreviewXlsxLimits = Partial<XlsxLimits>;

export type ParsedSellerSpritePreviewRow = {
  rowNumber: number;
  values: string[];
};

export type ParsedSellerSpritePreviewSheet = {
  name: string;
  rows: ParsedSellerSpritePreviewRow[];
};

export type ParsedSellerSpritePreviewWorkbook = {
  sheets: ParsedSellerSpritePreviewSheet[];
};

export type SellerSpritePreviewXlsxErrorCode =
  | "invalid_xlsx"
  | "xlsx_limit_exceeded"
  | "unsupported_xlsx_feature";

export type SellerSpritePreviewXlsxErrorStage =
  | "zip_container"
  | "ooxml_package"
  | "workbook"
  | "worksheet"
  | "cell";

export type SellerSpritePreviewXlsxUnsupportedReasonCode =
  | "unsupported_zip_compression"
  | "zip64_rejected"
  | "multidisk_zip_rejected"
  | "encrypted_zip_entry"
  | "unsupported_zip_flags"
  | "unsafe_zip_entry_path"
  | "duplicate_zip_entry"
  | "dtd_or_entity_rejected"
  | "macro_enabled_workbook"
  | "formula_cell_rejected"
  | "external_relationship_rejected"
  | "external_hyperlink_relationship_rejected"
  | "insecure_hyperlink_relationship_rejected"
  | "local_hyperlink_target_rejected"
  | "private_network_hyperlink_rejected"
  | "invalid_hyperlink_target_rejected"
  | "hyperlink_target_too_long"
  | "external_drawing_or_image_relationship_rejected"
  | "external_workbook_relationship_rejected"
  | "external_link_rejected"
  | "ole_object_rejected"
  | "activex_rejected"
  | "workbook_connection_rejected"
  | "embedded_package_rejected"
  | "hidden_worksheet_rejected"
  | "unsupported_ooxml_feature";

export class SellerSpritePreviewXlsxError extends Error {
  readonly reasonCode: SellerSpritePreviewXlsxUnsupportedReasonCode | undefined;
  readonly stage: SellerSpritePreviewXlsxErrorStage | undefined;

  constructor(
    readonly code: SellerSpritePreviewXlsxErrorCode,
    message: string,
    details?: {
      reasonCode: SellerSpritePreviewXlsxUnsupportedReasonCode;
      stage: SellerSpritePreviewXlsxErrorStage;
    },
  ) {
    super(message);
    this.name = "SellerSpritePreviewXlsxError";
    this.reasonCode = details?.reasonCode;
    this.stage = details?.stage;
  }
}

type ZipEntry = {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  localDataEndLimit: number;
};

const decoder = new TextDecoder("utf-8", { fatal: true });

function fail(
  code: "unsupported_xlsx_feature",
  message: string,
  reasonCode: SellerSpritePreviewXlsxUnsupportedReasonCode,
  stage: SellerSpritePreviewXlsxErrorStage,
): never;
function fail(
  code: Exclude<SellerSpritePreviewXlsxErrorCode, "unsupported_xlsx_feature">,
  message: string,
): never;
function fail(
  code: SellerSpritePreviewXlsxErrorCode,
  message: string,
  reasonCode?: SellerSpritePreviewXlsxUnsupportedReasonCode,
  stage?: SellerSpritePreviewXlsxErrorStage,
): never {
  throw new SellerSpritePreviewXlsxError(
    code,
    message,
    reasonCode && stage ? { reasonCode, stage } : undefined,
  );
}

function readUInt16(input: Uint8Array, offset: number): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 2 > input.length) {
    fail("invalid_xlsx", "XLSX ZIP 结构越界。");
  }
  return input[offset] | (input[offset + 1] << 8);
}

function readUInt32(input: Uint8Array, offset: number): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 4 > input.length) {
    fail("invalid_xlsx", "XLSX ZIP 结构越界。");
  }
  return (
    input[offset]
    | (input[offset + 1] << 8)
    | (input[offset + 2] << 16)
    | (input[offset + 3] << 24)
  ) >>> 0;
}

function decodeUtf8(input: Uint8Array): string {
  try {
    return decoder.decode(input);
  } catch {
    fail("invalid_xlsx", "XLSX 包含无效的 UTF-8 文件名或 XML。");
  }
}

function findEndOfCentralDirectory(input: Uint8Array): number {
  const minimumLength = 22;
  const searchStart = Math.max(0, input.length - minimumLength - 0xffff);
  for (let index = input.length - minimumLength; index >= searchStart; index -= 1) {
    if (readUInt32(input, index) === ZIP_END_OF_CENTRAL_DIRECTORY) return index;
  }
  fail("invalid_xlsx", "找不到 XLSX ZIP 中央目录。");
}

function assertSafePath(name: string): void {
  if (
    !name
    || name.includes("\\")
    || name.startsWith("/")
    || name.startsWith("~")
    || name.includes("\u0000")
    || name.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    fail(
      "unsupported_xlsx_feature",
      "XLSX 包含不安全的 ZIP 路径。",
      "unsafe_zip_entry_path",
      "zip_container",
    );
  }
}

function assertNoZip64ExtraField(input: Uint8Array, offset: number, length: number): void {
  if (offset < 0 || length < 0 || offset + length > input.length) {
    fail("invalid_xlsx", "XLSX ZIP 扩展字段越界。");
  }
  let cursor = offset;
  const end = offset + length;
  while (cursor < end) {
    if (cursor + 4 > end) fail("invalid_xlsx", "XLSX ZIP 扩展字段无效。");
    const identifier = readUInt16(input, cursor);
    const size = readUInt16(input, cursor + 2);
    cursor += 4;
    if (cursor + size > end) fail("invalid_xlsx", "XLSX ZIP 扩展字段无效。");
    if (identifier === ZIP64_EXTRA_FIELD_ID) {
      fail("unsupported_xlsx_feature", "不支持 ZIP64 XLSX。", "zip64_rejected", "zip_container");
    }
    cursor += size;
  }
}

function parseZipEntries(input: Uint8Array, limits: XlsxLimits): ZipEntry[] {
  const endOffset = findEndOfCentralDirectory(input);
  const diskNumber = readUInt16(input, endOffset + 4);
  const centralDisk = readUInt16(input, endOffset + 6);
  const entriesOnDisk = readUInt16(input, endOffset + 8);
  const entryCount = readUInt16(input, endOffset + 10);
  const centralSize = readUInt32(input, endOffset + 12);
  const centralOffset = readUInt32(input, endOffset + 16);
  const commentLength = readUInt16(input, endOffset + 20);

  if (endOffset + 22 + commentLength !== input.length) {
    fail("invalid_xlsx", "XLSX ZIP 尾部注释结构无效。");
  }
  if (
    entryCount === ZIP64_SENTINEL_16
    || centralSize === ZIP64_SENTINEL_32
    || centralOffset === ZIP64_SENTINEL_32
  ) {
    fail("unsupported_xlsx_feature", "不支持 ZIP64 XLSX。", "zip64_rejected", "zip_container");
  }
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    fail(
      "unsupported_xlsx_feature",
      "不支持多磁盘 XLSX ZIP。",
      "multidisk_zip_rejected",
      "zip_container",
    );
  }
  if (entryCount === 0 || entryCount > limits.maxEntryCount) {
    fail("xlsx_limit_exceeded", "XLSX ZIP 条目数量超出限制。");
  }
  if (centralOffset + centralSize !== endOffset) {
    fail("invalid_xlsx", "XLSX ZIP 中央目录边界无效。");
  }

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(input, offset) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      fail("invalid_xlsx", "XLSX ZIP 中央目录条目无效。");
    }
    const flags = readUInt16(input, offset + 8);
    const method = readUInt16(input, offset + 10);
    const crc = readUInt32(input, offset + 16);
    const compressedSize = readUInt32(input, offset + 20);
    const uncompressedSize = readUInt32(input, offset + 24);
    const nameLength = readUInt16(input, offset + 28);
    const extraLength = readUInt16(input, offset + 30);
    const commentLength = readUInt16(input, offset + 32);
    const diskStart = readUInt16(input, offset + 34);
    const localOffset = readUInt32(input, offset + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    if (offset + recordLength > centralOffset + centralSize) {
      fail("invalid_xlsx", "XLSX ZIP 中央目录条目越界。");
    }
    if (diskStart !== 0) {
      fail(
        "unsupported_xlsx_feature",
        "不支持多磁盘 XLSX。",
        "multidisk_zip_rejected",
        "zip_container",
      );
    }
    if (localOffset === ZIP64_SENTINEL_32) {
      fail("unsupported_xlsx_feature", "不支持 ZIP64 XLSX。", "zip64_rejected", "zip_container");
    }
    assertNoZip64ExtraField(input, offset + 46 + nameLength, extraLength);
    const unsupportedFlags = flags & ~UTF8_FLAG;
    if ((unsupportedFlags & ENCRYPTION_FLAGS) !== 0) {
      fail(
        "unsupported_xlsx_feature",
        "不支持加密 ZIP 条目。",
        "encrypted_zip_entry",
        "zip_container",
      );
    }
    if (unsupportedFlags !== 0) {
      fail(
        "unsupported_xlsx_feature",
        "不支持数据描述符或其他 ZIP 标志。",
        "unsupported_zip_flags",
        "zip_container",
      );
    }
    if (method !== 0 && method !== 8) {
      fail(
        "unsupported_xlsx_feature",
        "XLSX 使用了不支持的压缩方式。",
        "unsupported_zip_compression",
        "zip_container",
      );
    }
    if (
      compressedSize === ZIP64_SENTINEL_32
      || uncompressedSize === ZIP64_SENTINEL_32
      || uncompressedSize > limits.maxEntryUncompressedBytes
    ) {
      fail("xlsx_limit_exceeded", "XLSX 条目解压后体积超出限制。");
    }
    if (compressedSize === 0
      ? uncompressedSize > 0
      : uncompressedSize / compressedSize > limits.maxCompressionRatio) {
      fail("xlsx_limit_exceeded", "XLSX 条目压缩比超出限制。");
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalUncompressedBytes) {
      fail("xlsx_limit_exceeded", "XLSX 解压总量超出限制。");
    }
    const name = decodeUtf8(input.subarray(offset + 46, offset + 46 + nameLength));
    assertSafePath(name);
    if (names.has(name)) {
      fail(
        "unsupported_xlsx_feature",
        "XLSX 包含重复 ZIP 条目。",
        "duplicate_zip_entry",
        "zip_container",
      );
    }
    names.add(name);
    entries.push({
      name,
      flags,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
      localDataEndLimit: centralOffset,
    });
    offset += recordLength;
  }
  if (offset !== centralOffset + centralSize) {
    fail("invalid_xlsx", "XLSX ZIP 中央目录长度无效。");
  }
  return entries;
}

function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of input) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readZipEntry(input: Uint8Array, entry: ZipEntry): Uint8Array {
  const offset = entry.localOffset;
  if (readUInt32(input, offset) !== ZIP_LOCAL_FILE_HEADER) {
    fail("invalid_xlsx", "XLSX ZIP 本地条目无效。");
  }
  const flags = readUInt16(input, offset + 6);
  const method = readUInt16(input, offset + 8);
  const crc = readUInt32(input, offset + 14);
  const compressedSize = readUInt32(input, offset + 18);
  const uncompressedSize = readUInt32(input, offset + 22);
  const nameLength = readUInt16(input, offset + 26);
  const extraLength = readUInt16(input, offset + 28);
  const localName = decodeUtf8(input.subarray(offset + 30, offset + 30 + nameLength));
  assertSafePath(localName);
  assertNoZip64ExtraField(input, offset + 30 + nameLength, extraLength);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;

  if (
    flags !== entry.flags
    || method !== entry.method
    || crc !== entry.crc
    || compressedSize !== entry.compressedSize
    || uncompressedSize !== entry.uncompressedSize
    || localName !== entry.name
    || dataEnd > entry.localDataEndLimit
  ) {
    fail("invalid_xlsx", "XLSX ZIP 本地条目与中央目录不一致。");
  }

  const compressed = input.subarray(dataStart, dataEnd);
  let result: Uint8Array;
  try {
    result = entry.method === 0 ? Uint8Array.from(compressed) : inflateRawSync(compressed);
  } catch {
    fail("invalid_xlsx", "XLSX ZIP 解压失败。");
  }
  if (result.length !== entry.uncompressedSize || crc32(result) !== entry.crc) {
    fail("invalid_xlsx", "XLSX ZIP 校验失败。");
  }
  return result;
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function assertSafeXml(xml: string, stage: SellerSpritePreviewXlsxErrorStage): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    fail(
      "unsupported_xlsx_feature",
      "不支持包含 DTD 或实体定义的 XLSX XML。",
      "dtd_or_entity_rejected",
      stage,
    );
  }
}

function columnIndex(reference: string): number {
  const match = /^([A-Z]+)\d+$/i.exec(reference);
  if (!match) fail("invalid_xlsx", "XLSX 单元格引用无效。");
  let result = 0;
  for (const character of match[1].toUpperCase()) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result - 1;
}

function readCellValue(cellXml: string, sharedStrings: readonly string[]): string {
  if (/<(?:\w+:)?f(?:\s[^>]*)?>/i.test(cellXml)) {
    fail(
      "unsupported_xlsx_feature",
      "不支持包含公式的 XLSX。",
      "formula_cell_rejected",
      "cell",
    );
  }
  const type = /\bt="([^"]+)"/i.exec(cellXml)?.[1];
  if (type === "inlineStr") {
    return [...cellXml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/gi)]
      .map((match) => decodeXmlEntities(match[1]))
      .join("");
  }
  const value = /<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/i.exec(cellXml)?.[1] ?? "";
  if (type === "s") {
    const sharedIndex = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(sharedIndex) || sharedIndex < 0 || sharedIndex >= sharedStrings.length) {
      fail("invalid_xlsx", "XLSX 共享字符串引用无效。");
    }
    return sharedStrings[sharedIndex];
  }
  if (type === "e") fail("invalid_xlsx", "XLSX 包含错误单元格。");
  return decodeXmlEntities(value);
}

function parseSharedStrings(xml: string): string[] {
  assertSafeXml(xml, "cell");
  if (/<(?:\w+:)?f(?:\s[^>]*)?>/i.test(xml)) {
    fail(
      "unsupported_xlsx_feature",
      "不支持包含公式的 XLSX。",
      "formula_cell_rejected",
      "cell",
    );
  }
  return [...xml.matchAll(/<(?:\w+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?si>/gi)].map((match) => (
    [...match[1].matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/gi)]
      .map((textMatch) => decodeXmlEntities(textMatch[1]))
      .join("")
  ));
}

function parseWorksheet(
  xml: string,
  sharedStrings: readonly string[],
  limits: XlsxLimits,
): ParsedSellerSpritePreviewRow[] {
  assertSafeXml(xml, "worksheet");
  if (/<(?:\w+:)?f(?:\s[^>]*)?>/i.test(xml)) {
    fail(
      "unsupported_xlsx_feature",
      "不支持包含公式的 XLSX。",
      "formula_cell_rejected",
      "worksheet",
    );
  }
  const rows: ParsedSellerSpritePreviewRow[] = [];
  let cellCount = 0;
  let physicalRowCount = 0;
  for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/gi)) {
    physicalRowCount += 1;
    if (physicalRowCount > limits.maxRowsPerSheet) {
      fail("xlsx_limit_exceeded", "XLSX 行数超出限制。");
    }
    const rowNumber = Number.parseInt(/\br="(\d+)"/i.exec(rowMatch[1])?.[1] ?? "", 10);
    if (!Number.isSafeInteger(rowNumber) || rowNumber < 1) {
      fail("invalid_xlsx", "XLSX 行号无效。");
    }
    const values: string[] = [];
    let previousColumn = -1;
    for (const cellMatch of rowMatch[2].matchAll(/<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/gi)) {
      const reference = /\br="([A-Z]+\d+)"/i.exec(cellMatch[1])?.[1];
      if (!reference) fail("invalid_xlsx", "XLSX 单元格缺少引用。");
      const index = columnIndex(reference);
      if (index <= previousColumn || index >= limits.maxColumnsPerRow) {
        fail("xlsx_limit_exceeded", "XLSX 列数超出限制或单元格顺序无效。");
      }
      previousColumn = index;
      cellCount += 1;
      if (cellCount > limits.maxCellsPerSheet) {
        fail("xlsx_limit_exceeded", "XLSX 单元格数量超出限制。");
      }
      values[index] = readCellValue(cellMatch[0], sharedStrings);
    }
    rows.push({ rowNumber, values });
  }
  if (rows.length === 0) fail("invalid_xlsx", "XLSX 工作表没有可读取的行。");
  return rows;
}

function isUnsafeIpv4Literal(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }
  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

function isUnsafeIpv6Literal(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("ff")) {
    return true;
  }
  if (/^fe[89ab]/.test(normalized)) return true;
  return normalized.startsWith("::ffff:");
}

function isUnsafeHyperlinkHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (
    normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || normalized.endsWith(".lan")
  ) {
    return true;
  }
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return isUnsafeIpv4Literal(normalized);
  if (ipVersion === 6) return isUnsafeIpv6Literal(normalized);
  return false;
}

function assertSafeExternalHyperlinkTarget(target: string): void {
  if (target.length > MAX_EXTERNAL_HYPERLINK_TARGET_LENGTH) {
    fail(
      "unsupported_xlsx_feature",
      "XLSX 外部超链接目标超出安全长度限制。",
      "hyperlink_target_too_long",
      "ooxml_package",
    );
  }
  if (!target || /[\u0000-\u001f\u007f]/.test(target)) {
    fail(
      "unsupported_xlsx_feature",
      "XLSX 外部超链接目标无效。",
      "invalid_hyperlink_target_rejected",
      "ooxml_package",
    );
  }
  if (target.startsWith("\\\\") || target.startsWith("//")) {
    fail(
      "unsupported_xlsx_feature",
      "XLSX 外部超链接不能指向本地或共享路径。",
      "local_hyperlink_target_rejected",
      "ooxml_package",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    const reasonCode = /^[a-z][a-z0-9+.-]*:/i.test(target)
      ? "invalid_hyperlink_target_rejected"
      : "local_hyperlink_target_rejected";
    fail(
      "unsupported_xlsx_feature",
      "XLSX 外部超链接目标无效。",
      reasonCode,
      "ooxml_package",
    );
  }
  if (parsed.protocol !== "https:") {
    const reasonCode = parsed.protocol === "file:"
      ? "local_hyperlink_target_rejected"
      : "insecure_hyperlink_relationship_rejected";
    fail(
      "unsupported_xlsx_feature",
      "XLSX 外部超链接仅允许使用 HTTPS。",
      reasonCode,
      "ooxml_package",
    );
  }
  if (parsed.username || parsed.password || !parsed.hostname || parsed.port) {
    fail(
      "unsupported_xlsx_feature",
      "XLSX 外部超链接目标无效。",
      "invalid_hyperlink_target_rejected",
      "ooxml_package",
    );
  }
  if (isUnsafeHyperlinkHostname(parsed.hostname)) {
    fail(
      "unsupported_xlsx_feature",
      "XLSX 外部超链接不能指向本地、回环或私网地址。",
      "private_network_hyperlink_rejected",
      "ooxml_package",
    );
  }
}

function rejectUnsupportedParts(entries: readonly ZipEntry[], input: Uint8Array): void {
  const names = new Set(entries.map((entry) => entry.name.toLowerCase()));
  for (const name of names) {
    let reasonCode: SellerSpritePreviewXlsxUnsupportedReasonCode | null = null;
    if (name === "xl/vbaproject.bin") reasonCode = "macro_enabled_workbook";
    else if (name === "xl/connections.xml" || name.startsWith("xl/connections/")) {
      reasonCode = "workbook_connection_rejected";
    } else if (name.startsWith("xl/externallinks/")) reasonCode = "external_link_rejected";
    else if (name.startsWith("xl/activex/")) reasonCode = "activex_rejected";
    else if (name.includes("oleobject")) reasonCode = "ole_object_rejected";
    else if (name.startsWith("xl/embeddings/")) reasonCode = "embedded_package_rejected";
    if (reasonCode) {
      fail(
        "unsupported_xlsx_feature",
        "不支持包含主动内容、外部关系或嵌入对象的 XLSX。",
        reasonCode,
        "ooxml_package",
      );
    }
  }
  const contentTypes = entries.find((entry) => entry.name === "[Content_Types].xml");
  if (contentTypes) {
    const xml = decodeUtf8(readZipEntry(input, contentTypes));
    assertSafeXml(xml, "ooxml_package");
    let reasonCode: SellerSpritePreviewXlsxUnsupportedReasonCode | null = null;
    if (/macroenabled/i.test(xml)) reasonCode = "macro_enabled_workbook";
    else if (/oleobject/i.test(xml)) reasonCode = "ole_object_rejected";
    else if (/activex/i.test(xml)) reasonCode = "activex_rejected";
    else if (/connections/i.test(xml)) reasonCode = "workbook_connection_rejected";
    if (reasonCode) {
      fail(
        "unsupported_xlsx_feature",
        "不支持包含主动内容、连接或嵌入对象的 XLSX。",
        reasonCode,
        "ooxml_package",
      );
    }
  }
  for (const relationship of entries.filter((entry) => entry.name.endsWith(".rels"))) {
    const xml = decodeUtf8(readZipEntry(input, relationship));
    assertSafeXml(xml, "ooxml_package");
    let handledExternalRelationshipCount = 0;
    for (const match of xml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>(?:<\/(?:\w+:)?Relationship>)?/gi)) {
      const targetMode = /\bTargetMode\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1];
      if (targetMode?.toLowerCase() !== "external") continue;
      handledExternalRelationshipCount += 1;
      if (targetMode !== "External") {
        fail(
          "unsupported_xlsx_feature",
          "不支持包含非标准外部关系的 XLSX。",
          "external_relationship_rejected",
          "ooxml_package",
        );
      }
      const type = /\bType\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1] ?? "";
      if (type === EXTERNAL_HYPERLINK_RELATIONSHIP_TYPE) {
        const target = /\bTarget\s*=\s*["']([^"']*)["']/i.exec(match[1])?.[1] ?? "";
        assertSafeExternalHyperlinkTarget(target);
        continue;
      }
      let reasonCode: SellerSpritePreviewXlsxUnsupportedReasonCode = "external_relationship_rejected";
      if (/\/(?:drawing|image)$/i.test(type)) {
        reasonCode = "external_drawing_or_image_relationship_rejected";
      } else if (/\/externalLink$/i.test(type)) {
        reasonCode = "external_workbook_relationship_rejected";
      }
      fail(
        "unsupported_xlsx_feature",
        "不支持包含外部关系的 XLSX。",
        reasonCode,
        "ooxml_package",
      );
    }
    const externalMarkerCount = [...xml.matchAll(/\bTargetMode\s*=\s*["']External["']/gi)].length;
    if (externalMarkerCount !== handledExternalRelationshipCount) {
      fail(
        "unsupported_xlsx_feature",
        "不支持包含外部关系的 XLSX。",
        "external_relationship_rejected",
        "ooxml_package",
      );
    }
  }
}

function resolveWorksheetPath(target: string): string {
  if (
    !target
    || target.includes("\\")
    || target.startsWith("/")
    || target.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    fail("invalid_xlsx", "XLSX 工作表关系路径无效。");
  }
  return `xl/${target.replace(/^\.\//, "")}`;
}

function mergeLimits(requestedLimits: SellerSpritePreviewXlsxLimits): XlsxLimits {
  const limits: XlsxLimits = { ...DEFAULT_SELLERSPRITE_PREVIEW_XLSX_LIMITS, ...requestedLimits };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      fail("invalid_xlsx", "XLSX 安全限制配置无效。");
    }
  }
  return limits;
}

export function isSellerSpritePreviewXlsxZipMagic(input: Uint8Array): boolean {
  return input.length >= 4
    && input[0] === 0x50
    && input[1] === 0x4b
    && input[2] === 0x03
    && input[3] === 0x04;
}

export function parseSellerSpritePreviewXlsx(
  input: Uint8Array,
  requestedLimits: SellerSpritePreviewXlsxLimits = {},
): ParsedSellerSpritePreviewWorkbook {
  const limits = mergeLimits(requestedLimits);
  if (!input.length || input.length > limits.maxSourceBytes) {
    fail("xlsx_limit_exceeded", "XLSX 源文件大小超出限制。");
  }
  if (!isSellerSpritePreviewXlsxZipMagic(input)) {
    fail("invalid_xlsx", "上传内容不是有效的 XLSX ZIP 文件。");
  }
  const entries = parseZipEntries(input, limits);
  rejectUnsupportedParts(entries, input);
  const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
  const workbook = entryByName.get("xl/workbook.xml");
  const relationships = entryByName.get("xl/_rels/workbook.xml.rels");
  if (!workbook || !relationships) fail("invalid_xlsx", "XLSX 缺少工作簿关系文件。");

  const workbookXml = decodeUtf8(readZipEntry(input, workbook));
  const relationshipXml = decodeUtf8(readZipEntry(input, relationships));
  assertSafeXml(workbookXml, "workbook");
  assertSafeXml(relationshipXml, "workbook");
  const relationshipTargets = new Map<string, string>();
  for (const match of relationshipXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>(?:<\/(?:\w+:)?Relationship>)?/gi)) {
    const id = /\bId="([^"]+)"/i.exec(match[1])?.[1];
    const target = /\bTarget="([^"]+)"/i.exec(match[1])?.[1];
    const type = /\bType="([^"]+)"/i.exec(match[1])?.[1] ?? "";
    if (id && target && /\/worksheet$/i.test(type)) {
      relationshipTargets.set(id, resolveWorksheetPath(target));
    }
  }
  const sharedStrings = entryByName.get("xl/sharedStrings.xml");
  const parsedSharedStrings = sharedStrings
    ? parseSharedStrings(decodeUtf8(readZipEntry(input, sharedStrings)))
    : [];
  const sheets: ParsedSellerSpritePreviewSheet[] = [];
  for (const match of workbookXml.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>(?:<\/(?:\w+:)?sheet>)?/gi)) {
    const name = /\bname="([^"]+)"/i.exec(match[1])?.[1];
    const relationId = /(?:\br:id|\bid)="([^"]+)"/i.exec(match[1])?.[1];
    const state = /\bstate="([^"]+)"/i.exec(match[1])?.[1];
    if (!name || !relationId) fail("invalid_xlsx", "XLSX 工作表定义无效。");
    if (state === "hidden" || state === "veryHidden") {
      fail(
        "unsupported_xlsx_feature",
        "不支持包含隐藏工作表的 XLSX。",
        "hidden_worksheet_rejected",
        "workbook",
      );
    }
    const worksheetPath = relationshipTargets.get(relationId);
    const worksheet = worksheetPath ? entryByName.get(worksheetPath) : undefined;
    if (!worksheet) fail("invalid_xlsx", "XLSX 工作表关系缺失。");
    sheets.push({
      name: decodeXmlEntities(name),
      rows: parseWorksheet(decodeUtf8(readZipEntry(input, worksheet)), parsedSharedStrings, limits),
    });
  }
  if (sheets.length === 0) fail("invalid_xlsx", "XLSX 没有可见工作表。");
  return { sheets };
}
