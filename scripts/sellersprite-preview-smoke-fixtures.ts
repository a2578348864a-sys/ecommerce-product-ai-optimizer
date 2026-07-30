import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSellerSpritePreviewWorkbook } from "@/lib/upstream/sellersprite/previewTestFixtures";

const headers = [
  "ASIN", "父ASIN", "商品标题", "商品详情页链接", "商品主图", "价格($)", "评分", "评分数", "品牌", "类目路径", "搜索排名", "月销量", "月销售额($)",
] as const;

const validRow = [
  "B0TEST0001", "B0PARENT01", "Test product", "https://www.amazon.com/dp/B0TEST0001?tag=example", "https://images.example.test/product.jpg", "$19.99", "4.5", "123", "Example Brand", "Home & Kitchen > Test", "12", "321", "$4567.89",
] as const;

export function createLastRoundDuplicateWarningFixture(): Buffer {
  return createSellerSpritePreviewWorkbook({
    headers,
    rows: [validRow, validRow, ["invalid", ...validRow.slice(1)]],
  });
}

export function createNormalSuccessFixture(): Buffer {
  return createSellerSpritePreviewWorkbook({ headers, rows: [validRow] });
}

export function createCriticalConflictFixture(): Buffer {
  return createSellerSpritePreviewWorkbook({
    headers,
    rows: [validRow, [...validRow.slice(0, 5), "$20.99", ...validRow.slice(6)]],
  });
}

export function writeSmokeFixture(kind: "last-round" | "normal" | "conflict", outputPath: string): void {
  const source = kind === "last-round"
    ? createLastRoundDuplicateWarningFixture()
    : kind === "normal"
      ? createNormalSuccessFixture()
      : createCriticalConflictFixture();
  writeFileSync(resolve(outputPath), source, { flag: "wx" });
}

if (process.argv[1]?.endsWith("sellersprite-preview-smoke-fixtures.ts")) {
  const [kind, outputPath] = process.argv.slice(2) as ["last-round" | "normal" | "conflict", string | undefined];
  if (!["last-round", "normal", "conflict"].includes(kind) || !outputPath) process.exitCode = 2;
  else writeSmokeFixture(kind, outputPath);
}
