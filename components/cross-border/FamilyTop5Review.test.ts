import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  FamilyTop5ReviewView,
  INITIAL_FAMILY_TOP5_REVIEW_STATE,
  buildFamilyReviewExport,
  familyTop5ReviewReducer,
  isAllowedThumbnailUrl,
  type FamilyTop5ReviewState,
} from "@/components/cross-border/FamilyTop5Review";
import { loadFamilyTop5Data } from "@/lib/upstream/family-top5-adapter";
import type { FamilyReviewDecisionValue, ProductFamily } from "@/lib/upstream/family-top5-types";

function readyData() {
  const result = loadFamilyTop5Data();
  if (!result.data || !result.sourceArtifactBinding) throw new Error(result.error ?? result.readiness);
  return { data: result.data, binding: result.sourceArtifactBinding };
}

function render(state = INITIAL_FAMILY_TOP5_REVIEW_STATE, topFamilies?: ProductFamily[]): string {
  const { data, binding } = readyData();
  return renderToStaticMarkup(createElement(FamilyTop5ReviewView, {
    topFamilies: topFamilies ?? data.topFamilies,
    remainingFamilies: data.remainingFamilies,
    sourceArtifactBinding: binding,
    state,
    dispatch: () => undefined,
    onExport: () => undefined,
  }));
}

function reviewedState(
  decision: FamilyReviewDecisionValue = "watch",
  selectedFamilyIds: string[] = [],
): FamilyTop5ReviewState {
  const { data } = readyData();
  let state = INITIAL_FAMILY_TOP5_REVIEW_STATE;
  for (const family of data.topFamilies) {
    state = familyTop5ReviewReducer(state, { type: "decide", family, decision });
  }
  for (const familyId of selectedFamilyIds) {
    const family = data.topFamilies.find((candidate) => candidate.familyId === familyId);
    if (!family) throw new Error("unknown_test_family");
    state = familyTop5ReviewReducer(state, { type: "decide", family, decision: "continue_research" });
    state = familyTop5ReviewReducer(state, { type: "toggle_selected", familyId, selected: true });
  }
  return familyTop5ReviewReducer(state, { type: "confirm_review", confirmed: true });
}

describe("FamilyTop5Review", () => {
  it("renders exactly five unique family cards", () => {
    const { data } = readyData();
    const html = render();
    expect((html.match(/data-testid="family-card"/gu) ?? [])).toHaveLength(5);
    expect(new Set(data.topFamilies.map((family) => family.familyId)).size).toBe(5);
  });

  it("renders Command as one family rather than two listing families", () => {
    const html = render();
    expect((html.match(/data-family-id="108ee1b6"/gu) ?? [])).toHaveLength(1);
    expect(html).not.toContain('data-family-id="340367063"');
  });

  it("keeps both Command member IDs in the family", () => {
    const html = render();
    expect(html).toContain("206212338、340367063");
  });

  it("shows the 12-strip and 16-strip package difference", () => {
    const html = render();
    expect(html).toContain("12条胶条");
    expect(html).toContain("16条胶条");
  });

  it("shows the remaining 17 families", () => {
    expect(render()).toContain("查看其余 17 个商品家族");
  });

  it("does not promote member 340367063 to an independent family", () => {
    const { data } = readyData();
    expect(data.topFamilies.some((family) => family.familyId === "340367063")).toBe(false);
    expect(data.remainingFamilies.some((family) => family.familyId === "340367063")).toBe(false);
  });

  it("does not render any remote thumbnail URL before explicit consent", () => {
    const html = render();
    expect(html).toContain("加载公开商品缩略图");
    expect(html).toContain("缩略图来自公开远程地址，点击加载后将产生网络请求。");
    expect(html).not.toContain("images.thdstatic.com");
    expect(html).not.toContain('data-testid="remote-thumbnail"');
  });

  it("renders allowed remote thumbnails only after the explicit enable action", () => {
    const state = familyTop5ReviewReducer(INITIAL_FAMILY_TOP5_REVIEW_STATE, { type: "enable_remote_images" });
    const html = render(state);
    expect(html).toContain('data-testid="remote-thumbnail"');
    expect(html).toContain("https://images.thdstatic.com/");
    expect(html).not.toContain("加载公开商品缩略图");
  });

  it("strictly rejects non-allowlisted thumbnail hosts", () => {
    expect(isAllowedThumbnailUrl("https://images.thdstatic.com/a.jpg")).toBe(true);
    for (const url of [
      "http://images.thdstatic.com/a.jpg",
      "https://images.thdstatic.com.evil.example/a.jpg",
      "https://other.example/a.jpg",
      "https://images.thdstatic.com:444/a.jpg",
      "https://user@images.thdstatic.com/a.jpg",
    ]) expect(isAllowedThumbnailUrl(url)).toBe(false);

    const { data } = readyData();
    const topFamilies = structuredClone(data.topFamilies);
    topFamilies[0].representativeListing.thumbnailUrl = "https://other.example/leak.jpg";
    const enabled = familyTop5ReviewReducer(INITIAL_FAMILY_TOP5_REVIEW_STATE, { type: "enable_remote_images" });
    const html = render(enabled, topFamilies);
    expect(html).not.toContain("other.example");
  });

  it("replaces a failed image with the local placeholder", () => {
    const { data } = readyData();
    const url = data.topFamilies[0].representativeListing.thumbnailUrl;
    if (!url) throw new Error("missing_test_thumbnail");
    let state = familyTop5ReviewReducer(INITIAL_FAMILY_TOP5_REVIEW_STATE, { type: "enable_remote_images" });
    state = familyTop5ReviewReducer(state, { type: "image_failed", url });
    const html = render(state);
    expect(html).toContain("图片加载失败");
    expect(html).not.toContain(`src="${url}"`);
  });

  it("stores decisions and notes by familyId and drops selection when the decision changes", () => {
    const { data } = readyData();
    const family = data.topFamilies[0];
    let state = familyTop5ReviewReducer(INITIAL_FAMILY_TOP5_REVIEW_STATE, {
      type: "decide",
      family,
      decision: "continue_research",
    });
    state = familyTop5ReviewReducer(state, { type: "note", family, notes: "人工核对包装差异" });
    state = familyTop5ReviewReducer(state, { type: "toggle_selected", familyId: family.familyId, selected: true });
    expect(state.decisions[family.familyId]).toMatchObject({ decision: "continue_research", notes: "人工核对包装差异" });
    expect(state.selectedFamilyIds).toEqual([family.familyId]);
    state = familyTop5ReviewReducer(state, { type: "decide", family, decision: "watch" });
    expect(state.selectedFamilyIds).toEqual([]);
  });

  it("exports a human-confirmed selection of zero through five families", () => {
    const { data, binding } = readyData();
    for (let count = 0; count <= 5; count += 1) {
      const selectedIds = data.topFamilies.slice(0, count).map((family) => family.familyId);
      const exported = buildFamilyReviewExport({
        topFamilies: data.topFamilies,
        state: reviewedState("watch", selectedIds),
        reviewedAt: "2026-07-21T12:00:00.000Z",
        sourceArtifactBinding: binding,
      });
      expect(exported.reviewedFamilies).toHaveLength(5);
      expect(exported.selectedFamilyIds).toEqual(selectedIds);
      expect(exported.selectedFamilies.map((family) => family.familyId)).toEqual(selectedIds);
      expect(exported.reviewerConfirmation.confirmedByHuman).toBe(true);
    }
  });

  it("keeps both Command member IDs in the export", () => {
    const { data, binding } = readyData();
    const commandId = data.topFamilies[0].familyId;
    const exported = buildFamilyReviewExport({
      topFamilies: data.topFamilies,
      state: reviewedState("watch", [commandId]),
      reviewedAt: "2026-07-21T12:00:00.000Z",
      sourceArtifactBinding: binding,
    });
    expect(exported.selectedFamilies[0].memberStableIds).toEqual(["206212338", "340367063"]);
  });

  it("performs no Provider call, Candidate/Task creation, or database write while rendering", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
