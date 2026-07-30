import { describe, expect, it } from "vitest";
import {
  corruptCentralDirectoryAsZip64,
  createSellerSpritePreviewWorkbook,
  createStoredZip,
} from "./previewTestFixtures";
import {
  parseSellerSpritePreviewXlsx,
  SellerSpritePreviewXlsxError,
} from "./previewXlsx";

function captureXlsxFailure(input: Uint8Array): SellerSpritePreviewXlsxError & {
  reasonCode?: string;
  stage?: string;
} {
  try {
    parseSellerSpritePreviewXlsx(input);
    throw new Error("expected XLSX to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(SellerSpritePreviewXlsxError);
    return error as SellerSpritePreviewXlsxError & { reasonCode?: string; stage?: string };
  }
}

function expectXlsxFailure(input: Uint8Array, code: SellerSpritePreviewXlsxError["code"]): void {
  expect(captureXlsxFailure(input).code).toBe(code);
}

function expectUnsupported(
  input: Uint8Array,
  reasonCode: string,
  stage: string,
): void {
  const error = captureXlsxFailure(input);
  expect(error.code).toBe("unsupported_xlsx_feature");
  expect(error.reasonCode).toBe(reasonCode);
  expect(error.stage).toBe(stage);
}

function findCentralDirectoryOffset(input: Buffer): number {
  const offset = input.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  expect(offset).toBeGreaterThan(-1);
  return offset;
}

const HYPERLINK_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";

function externalRelationships(
  relationships: ReadonlyArray<{ type: string; target: string; targetMode?: string }>,
): string {
  return [
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...relationships.map((relationship, index) => (
      `<Relationship Id="synthetic-${index}" Type="${relationship.type}" TargetMode="${relationship.targetMode ?? "External"}" Target="${relationship.target}"/>`
    )),
    "</Relationships>",
  ].join("");
}

function externalRelationship(type: string, target = "synthetic-target"): string {
  return externalRelationships([{ type, target }]);
}

describe("SellerSprite Preview XLSX security decoder", () => {
  it("reads one bounded visible worksheet and rejects formulas", () => {
    const valid = createSellerSpritePreviewWorkbook({ headers: ["ASIN"], rows: [["B0TEST0001"]] });
    expect(parseSellerSpritePreviewXlsx(valid).sheets).toEqual([
      {
        name: "US",
        rows: [
          { rowNumber: 1, values: ["ASIN"] },
          { rowNumber: 2, values: ["B0TEST0001"] },
        ],
      },
    ]);

    const formula = createSellerSpritePreviewWorkbook({
      headers: ["ASIN"],
      rows: [],
      sheetXmlOverride: "<worksheet><sheetData><row r=\"1\"><c r=\"A1\"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>",
    });
    expectUnsupported(formula, "formula_cell_rejected", "worksheet");
  });

  it("assigns stable reasons to every rejected ZIP container feature", () => {
    const valid = createSellerSpritePreviewWorkbook({ headers: ["ASIN"], rows: [["B0TEST0001"]] });
    expectUnsupported(corruptCentralDirectoryAsZip64(valid), "zip64_rejected", "zip_container");

    const multiDisk = Buffer.from(valid);
    multiDisk.writeUInt16LE(1, multiDisk.length - 22 + 4);
    expectUnsupported(multiDisk, "multidisk_zip_rejected", "zip_container");

    const centralDisk = Buffer.from(valid);
    centralDisk.writeUInt16LE(1, findCentralDirectoryOffset(centralDisk) + 34);
    expectUnsupported(centralDisk, "multidisk_zip_rejected", "zip_container");

    const centralZip64Offset = Buffer.from(valid);
    centralZip64Offset.writeUInt32LE(0xffffffff, findCentralDirectoryOffset(centralZip64Offset) + 42);
    expectUnsupported(centralZip64Offset, "zip64_rejected", "zip_container");

    const zip64Extra = Buffer.alloc(4);
    zip64Extra.writeUInt16LE(0x0001, 0);
    expectUnsupported(createStoredZip([{
      name: "synthetic.xml",
      content: "x",
      centralExtra: zip64Extra,
    }]), "zip64_rejected", "zip_container");

    expectUnsupported(
      createStoredZip([{ name: "../escape.xml", content: "x" }]),
      "unsafe_zip_entry_path",
      "zip_container",
    );
    expectUnsupported(createStoredZip([
      { name: "same.xml", content: "one" },
      { name: "same.xml", content: "two" },
    ]), "duplicate_zip_entry", "zip_container");
    expectUnsupported(
      createStoredZip([{ name: "encrypted.bin", content: "x", flags: 0x0801 }]),
      "encrypted_zip_entry",
      "zip_container",
    );
    expectUnsupported(
      createStoredZip([{ name: "descriptor.bin", content: "x", flags: 0x0808 }]),
      "unsupported_zip_flags",
      "zip_container",
    );
    expectUnsupported(
      createStoredZip([{ name: "compressed.bin", content: "x", compressionMethod: 12 }]),
      "unsupported_zip_compression",
      "zip_container",
    );
  });

  it.each([
    ["xl/vbaProject.bin", "macro_enabled_workbook"],
    ["xl/connections.xml", "workbook_connection_rejected"],
    ["xl/externalLinks/externalLink1.xml", "external_link_rejected"],
    ["xl/embeddings/package1.bin", "embedded_package_rejected"],
    ["xl/activeX/activeX1.bin", "activex_rejected"],
    ["xl/oleObjects/oleObject1.bin", "ole_object_rejected"],
  ])("classifies unsupported OOXML package part %s without exposing its name", (name, reasonCode) => {
    const input = createSellerSpritePreviewWorkbook({
      headers: ["ASIN"],
      rows: [],
      extraEntries: [{ name, content: "synthetic-sensitive-marker" }],
    });
    expectUnsupported(input, reasonCode, "ooxml_package");
  });

  it.each([
    ["application/vnd.ms-excel.sheet.macroEnabled.main+xml", "macro_enabled_workbook"],
    ["application/vnd.ms-excel.connections+xml", "workbook_connection_rejected"],
    ["application/vnd.ms-office.activeX+xml", "activex_rejected"],
    ["application/vnd.openxmlformats-officedocument.oleObject", "ole_object_rejected"],
  ])("classifies rejected content type %s without returning XML", (contentType, reasonCode) => {
    const input = createSellerSpritePreviewWorkbook({
      headers: ["ASIN"],
      rows: [],
      contentTypesXmlOverride: `<Types><Override ContentType="${contentType}" PartName="/synthetic"/></Types>`,
    });
    expectUnsupported(input, reasonCode, "ooxml_package");
  });

  it.each([
    ["http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", "external_drawing_or_image_relationship_rejected"],
    ["http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing", "external_drawing_or_image_relationship_rejected"],
    ["http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink", "external_workbook_relationship_rejected"],
    ["urn:synthetic:unknown", "external_relationship_rejected"],
  ])("classifies external OOXML relationship type without returning its target", (type, reasonCode) => {
    const input = createSellerSpritePreviewWorkbook({
      headers: ["ASIN"],
      rows: [],
      extraEntries: [{
        name: "xl/custom.rels",
        content: externalRelationship(type),
      }],
    });
    expectUnsupported(input, reasonCode, "ooxml_package");
  });

  it("allows exact external HTTPS hyperlink relationships without returning or dereferencing targets", () => {
    const input = createSellerSpritePreviewWorkbook({
      headers: ["ASIN"],
      rows: [["B0TEST0001"]],
      extraEntries: [{
        name: "xl/worksheets/_rels/sheet1.xml.rels",
        content: externalRelationships([
          { type: HYPERLINK_RELATIONSHIP_TYPE, target: "https://www.amazon.com/dp/B0TEST0001" },
          { type: HYPERLINK_RELATIONSHIP_TYPE, target: "https://example.com/non-business-link" },
        ]),
      }],
    });

    expect(parseSellerSpritePreviewXlsx(input).sheets[0]?.rows).toEqual([
      { rowNumber: 1, values: ["ASIN"] },
      { rowNumber: 2, values: ["B0TEST0001"] },
    ]);
    expect(JSON.stringify(parseSellerSpritePreviewXlsx(input))).not.toContain("non-business-link");
  });

  it.each([
    ["http://www.amazon.com/dp/B0TEST0001", "insecure_hyperlink_relationship_rejected"],
    ["file:///C:/synthetic.xlsx", "local_hyperlink_target_rejected"],
    ["\\\\synthetic-host\\share\\synthetic.xlsx", "local_hyperlink_target_rejected"],
    ["javascript:alert(1)", "insecure_hyperlink_relationship_rejected"],
    ["data:text/plain,synthetic", "insecure_hyperlink_relationship_rejected"],
    ["https://synthetic-user:synthetic-password@example.com/path", "invalid_hyperlink_target_rejected"],
    ["https://localhost/path", "private_network_hyperlink_rejected"],
    ["https://127.0.0.1/path", "private_network_hyperlink_rejected"],
    ["https://[::1]/path", "private_network_hyperlink_rejected"],
    ["https://10.0.0.1/path", "private_network_hyperlink_rejected"],
    ["https://172.16.0.1/path", "private_network_hyperlink_rejected"],
    ["https://192.168.0.1/path", "private_network_hyperlink_rejected"],
    ["../relative-target", "local_hyperlink_target_rejected"],
    [`https://example.com/${"x".repeat(2049)}`, "hyperlink_target_too_long"],
    ["https://[invalid", "invalid_hyperlink_target_rejected"],
    ["https://example.com/\ncontrol", "invalid_hyperlink_target_rejected"],
  ])("rejects an unsafe external hyperlink target without exposing it", (target, reasonCode) => {
    const input = createSellerSpritePreviewWorkbook({
      headers: ["ASIN"],
      rows: [],
      extraEntries: [{
        name: "xl/worksheets/_rels/sheet1.xml.rels",
        content: externalRelationship(HYPERLINK_RELATIONSHIP_TYPE, target),
      }],
    });
    const error = captureXlsxFailure(input);
    expect(error.code).toBe("unsupported_xlsx_feature");
    expect(error.reasonCode).toBe(reasonCode);
    expect(error.stage).toBe("ooxml_package");
    expect(error.message).not.toContain(target);
  });

  it("rejects near-match hyperlink types, non-standard TargetMode, and mixed unsafe relationships", () => {
    const nearMatch = createSellerSpritePreviewWorkbook({
      headers: ["ASIN"],
      rows: [],
      extraEntries: [{
        name: "xl/worksheets/_rels/sheet1.xml.rels",
        content: externalRelationship(`${HYPERLINK_RELATIONSHIP_TYPE}-suffix`, "https://example.com/path"),
      }],
    });
    expectUnsupported(nearMatch, "external_relationship_rejected", "ooxml_package");

    const nonStandardTargetMode = createSellerSpritePreviewWorkbook({
      headers: ["ASIN"],
      rows: [],
      extraEntries: [{
        name: "xl/worksheets/_rels/sheet1.xml.rels",
        content: externalRelationships([{
          type: HYPERLINK_RELATIONSHIP_TYPE,
          target: "https://example.com/path",
          targetMode: "external",
        }]),
      }],
    });
    expectUnsupported(nonStandardTargetMode, "external_relationship_rejected", "ooxml_package");

    const mixed = createSellerSpritePreviewWorkbook({
      headers: ["ASIN"],
      rows: [],
      extraEntries: [{
        name: "xl/worksheets/_rels/sheet1.xml.rels",
        content: externalRelationships([
          { type: HYPERLINK_RELATIONSHIP_TYPE, target: "https://example.com/path" },
          {
            type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink",
            target: "https://example.com/external-workbook",
          },
        ]),
      }],
    });
    expectUnsupported(mixed, "external_workbook_relationship_rejected", "ooxml_package");
  });

  it("classifies XML, shared-string formula, worksheet formula, and hidden-sheet rejections", () => {
    const contentTypesDtd = createSellerSpritePreviewWorkbook({
      headers: ["ASIN"],
      rows: [],
      contentTypesXmlOverride: "<!DOCTYPE Types><Types/>",
    });
    expectUnsupported(contentTypesDtd, "dtd_or_entity_rejected", "ooxml_package");

    const workbookDtd = createSellerSpritePreviewWorkbook({
      headers: ["ASIN"],
      rows: [],
      workbookXmlOverride: "<!DOCTYPE workbook><workbook/>",
    });
    expectUnsupported(workbookDtd, "dtd_or_entity_rejected", "workbook");

    const dtd = createSellerSpritePreviewWorkbook({
      headers: ["ASIN"],
      rows: [],
      sheetXmlOverride: '<!DOCTYPE worksheet><worksheet><sheetData><row r="1"><c r="A1"><v>x</v></c></row></sheetData></worksheet>',
    });
    expectUnsupported(dtd, "dtd_or_entity_rejected", "worksheet");

    const sharedDtd = createSellerSpritePreviewWorkbook({
      headers: ["ASIN"],
      rows: [],
      extraEntries: [{
        name: "xl/sharedStrings.xml",
        content: "<!DOCTYPE sst><sst/>",
      }],
    });
    expectUnsupported(sharedDtd, "dtd_or_entity_rejected", "cell");

    const sharedFormula = createSellerSpritePreviewWorkbook({
      headers: ["ASIN"],
      rows: [],
      extraEntries: [{
        name: "xl/sharedStrings.xml",
        content: "<sst><si><t>synthetic</t><f>1+1</f></si></sst>",
      }],
    });
    expectUnsupported(sharedFormula, "formula_cell_rejected", "cell");

    const worksheetFormula = createSellerSpritePreviewWorkbook({
      headers: ["ASIN"],
      rows: [],
      sheetXmlOverride: '<worksheet><sheetData><row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>',
    });
    expectUnsupported(worksheetFormula, "formula_cell_rejected", "worksheet");

    const hidden = createSellerSpritePreviewWorkbook({ headers: ["ASIN"], rows: [], sheetState: "hidden" });
    expectUnsupported(hidden, "hidden_worksheet_rejected", "workbook");
  });

  it("verifies CRC and local-header consistency and enforces all configured bounds", () => {
    const valid = createSellerSpritePreviewWorkbook({ headers: ["ASIN"], rows: [["B0TEST0001"]] });
    const corruptCrc = Buffer.from(valid);
    const textOffset = corruptCrc.indexOf(Buffer.from("US", "utf8"));
    expect(textOffset).toBeGreaterThan(-1);
    corruptCrc[textOffset] ^= 1;
    const crcError = captureXlsxFailure(corruptCrc);
    expect(crcError.code).toBe("invalid_xlsx");
    expect(crcError.reasonCode).toBeUndefined();
    expect(crcError.stage).toBeUndefined();

    const localNameMismatch = Buffer.from(valid);
    const localNameOffset = localNameMismatch.indexOf(Buffer.from("[Content_Types].xml", "utf8"));
    expect(localNameOffset).toBeGreaterThan(-1);
    localNameMismatch[localNameOffset] = "X".charCodeAt(0);
    const mismatchError = captureXlsxFailure(localNameMismatch);
    expect(mismatchError.code).toBe("invalid_xlsx");
    expect(mismatchError.reasonCode).toBeUndefined();
    expect(mismatchError.stage).toBeUndefined();

    expect(() => parseSellerSpritePreviewXlsx(valid, { maxSourceBytes: valid.length - 1 })).toThrow(SellerSpritePreviewXlsxError);
    expect(() => parseSellerSpritePreviewXlsx(valid, { maxEntryCount: 3 })).toThrow(SellerSpritePreviewXlsxError);
    expect(() => parseSellerSpritePreviewXlsx(valid, { maxEntryUncompressedBytes: 10 })).toThrow(SellerSpritePreviewXlsxError);
    expect(() => parseSellerSpritePreviewXlsx(valid, { maxTotalUncompressedBytes: 100 })).toThrow(SellerSpritePreviewXlsxError);
    expect(() => parseSellerSpritePreviewXlsx(valid, { maxRowsPerSheet: 1 })).toThrow(SellerSpritePreviewXlsxError);

    const twoColumns = createSellerSpritePreviewWorkbook({ headers: ["ASIN", "Title"], rows: [] });
    expect(() => parseSellerSpritePreviewXlsx(twoColumns, { maxColumnsPerRow: 1 })).toThrow(SellerSpritePreviewXlsxError);
    expect(() => parseSellerSpritePreviewXlsx(valid, { maxCellsPerSheet: 1 })).toThrow(SellerSpritePreviewXlsxError);

    const ratio = createSellerSpritePreviewWorkbook({
      headers: ["ASIN"],
      rows: [],
      extraEntries: [{
        name: "xl/worksheets/ratio.xml",
        content: "x",
        centralCompressedSize: 1,
        centralUncompressedSize: 1_000,
        localCompressedSize: 1,
        localUncompressedSize: 1_000,
      }],
    });
    expectXlsxFailure(ratio, "xlsx_limit_exceeded");
  });
});
