import { describe, expect, it } from "vitest";
import {
  EMPTY_LISTING_CREATION_BRIEF,
  normalizeListingCreationBriefForm,
  listingCreationBriefFormsEqual,
  resolveLoadedListingCreationBrief,
} from "./listingCreationBriefState";

const F1 = { coreSellingPoint: "a", targetAudience: "b", useScenario: "c", differentiation: "d", contentEmphasis: "e" };

describe("listingCreationBriefState", () => {
  it("null/undefined/非对象归一化为空表单", () => {
    expect(normalizeListingCreationBriefForm(null)).toEqual(EMPTY_LISTING_CREATION_BRIEF);
    expect(normalizeListingCreationBriefForm(undefined)).toEqual(EMPTY_LISTING_CREATION_BRIEF);
    expect(normalizeListingCreationBriefForm(["x"])).toEqual(EMPTY_LISTING_CREATION_BRIEF);
    expect(normalizeListingCreationBriefForm("text")).toEqual(EMPTY_LISTING_CREATION_BRIEF);
  });
  it("合法 DTO 只提取五字段，忽略 schema 与未知字段", () => {
    const out = normalizeListingCreationBriefForm({ schema: "listing-creation-brief.v1", ...F1, requestId: "r", storageVersion: { x: 1 } });
    expect(out).toEqual(F1);
    expect("schema" in out).toBe(false);
  });
  it("非字符串字段安全变为空字符串且输入对象不变", () => {
    const input: Record<string, unknown> = { ...F1, coreSellingPoint: 42, targetAudience: ["b"] };
    const snapshot = JSON.stringify(input);
    const out = normalizeListingCreationBriefForm(input);
    expect(out.coreSellingPoint).toBe("");
    expect(out.targetAudience).toBe("");
    expect(JSON.stringify(input)).toBe(snapshot);
  });
  it("五字段完全一致时 equal=true", () => {
    expect(listingCreationBriefFormsEqual({ ...F1 }, { ...F1 })).toBe(true);
  });
  it("任意字段不同（含 contentEmphasis）equal=false", () => {
    expect(listingCreationBriefFormsEqual({ ...F1 }, { ...F1, contentEmphasis: "x" })).toBe(false);
    expect(listingCreationBriefFormsEqual({ ...F1 }, { ...F1, coreSellingPoint: "x" })).toBe(false);
  });
  it("preserveEdits=false 时 incoming 同时覆盖 editing/saved", () => {
    const r = resolveLoadedListingCreationBrief({ incoming: F1, editing: { ...F1, coreSellingPoint: "dirty" }, saved: { ...F1, targetAudience: "old" }, preserveEdits: false });
    expect(r.editing).toEqual(F1);
    expect(r.saved).toEqual(F1);
  });
  it("preserveEdits=true 且 dirty 时保留 editing、更新 saved", () => {
    const editingDirty = { ...F1, coreSellingPoint: "dirty" };
    const savedOld = { ...F1, targetAudience: "old" };
    const r = resolveLoadedListingCreationBrief({ incoming: F1, editing: editingDirty, saved: savedOld, preserveEdits: true });
    expect(r.editing).toEqual(editingDirty);
    expect(r.saved).toEqual(F1);
  });
  it("preserveEdits=true 且无 dirty 时 editing/saved 都采用 incoming", () => {
    const r = resolveLoadedListingCreationBrief({ incoming: F1, editing: { ...F1 }, saved: { ...F1 }, preserveEdits: true });
    expect(r.editing).toEqual(F1);
    expect(r.saved).toEqual(F1);
  });
  it("resolveLoaded 不修改入参对象", () => {
    const incoming = { ...F1 }; const editing = { ...F1, coreSellingPoint: "dirty" }; const saved = { ...F1 };
    const a = JSON.stringify([incoming, editing, saved]);
    resolveLoadedListingCreationBrief({ incoming, editing, saved, preserveEdits: true });
    expect(JSON.stringify([incoming, editing, saved])).toBe(a);
  });
});
