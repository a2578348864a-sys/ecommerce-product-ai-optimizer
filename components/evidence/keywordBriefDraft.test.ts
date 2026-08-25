import { describe, expect, it } from "vitest";
import { buildKeywordBriefDraft } from "./keywordBriefDraft";

describe("buildKeywordBriefDraft（第1轮：主词按相关度，非首行）", () => {
  const ROWS = [
    { keyword: "lunch box", rowNumber: 1 },
    { keyword: "thermos for hot food kids", rowNumber: 2 },
    { keyword: "kids lunch jar", rowNumber: 3 },
  ];
  it("传权威商品名 → 主词为相关词（thermos for hot food kids），非首行 lunch box", () => {
    const d = buildKeywordBriefDraft(ROWS as never, "THERMOS FUNTAINER Kids Food Jar with Spoon 10oz Pink");
    expect(d?.primaryKeyword).toBe("thermos for hot food kids");
    expect(d?.supportingKeywords).not.toContain("thermos for hot food kids");
  });
  it("无 productName → 回退首行（兼容旧行为，不失败）", () => {
    const d = buildKeywordBriefDraft(ROWS as never, null);
    expect(d?.primaryKeyword).toBe("lunch box");
  });
  it("全部无关 → 主词仍取首行但…（无相关词时首行回退）；空行 → null", () => {
    expect(buildKeywordBriefDraft([{ keyword: "  " }] as never, "X Product")).toBeNull();
  });
});

import { addSupportingToTags, removeSupportingTag } from "./keywordBriefDraft";
describe("辅助词标签纯函数（第2轮）", () => {
  it("添加去重且 ≤5", () => {
    let tags = ["a"];
    tags = addSupportingToTags(tags, "b");
    tags = addSupportingToTags(tags, "b"); // 重复
    expect(tags).toEqual(["a", "b"]);
    tags = addSupportingToTags(tags, "c");
    tags = addSupportingToTags(tags, "d");
    tags = addSupportingToTags(tags, "e");
    tags = addSupportingToTags(tags, "f"); // 第6个被截断
    expect(tags).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("删除指定词", () => {
    expect(removeSupportingTag(["a", "b"], "a")).toEqual(["b"]);
  });
});
