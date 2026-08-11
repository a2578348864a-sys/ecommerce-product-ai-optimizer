import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "components/listing-handoff/ListingHandoffSection.tsx"), "utf8");

describe("v2.2.16 Listing Studio creation brief UI", () => {
  it("keeps the five optional marketing fields visibly separate from confirmed facts", () => {
    for (const label of [
      "商品创作补充（可选）",
      "用于帮助AI理解营销方向，不代表已验证商品事实。",
      "不会写入已确认事实，也不会放宽 Claim Safety。",
      "核心卖点",
      "目标用户",
      "使用场景",
      "差异化优势",
      "内容强调方向",
    ]) {
      expect(source).toContain(label);
    }
    expect(source).toContain("setRequestId(null)");
    expect(source).toContain("setRetryBody(null)");
    expect(source).toContain("...(hasListingBrief ? { listingBrief } : {})");
  });
});
