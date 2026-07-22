import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  default as FamilyTop5Review,
  FamilyTop5ReviewView,
  INITIAL_FAMILY_TOP5_REVIEW_STATE,
  buildFamilyReviewExport,
  familyTop5ReviewReducer,
  isAllowedThumbnailUrl,
  type FamilyTop5ReviewState,
} from "@/components/cross-border/FamilyTop5Review";
import { loadFamilyTop5Data } from "@/lib/upstream/family-top5-adapter";
import type {
  FamilyReviewDecisionValue,
  ProductFamily,
  SourceArtifactBinding,
} from "@/lib/upstream/family-top5-types";
import {
  TestElement,
  TestEvent,
  findAll,
  findByText,
  installTestDom,
  setNativeValue,
  type TestDom,
} from "@/tests/helpers/minimal-react-dom";

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

describe("FamilyTop5Review mounted browser behavior", () => {
  let dom: TestDom;
  let container: TestElement;
  let root: import("react-dom/client").Root | null;

  beforeEach(() => {
    dom = installTestDom();
    container = dom.document.createElement("div");
    dom.document.body.appendChild(container);
    root = null;
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    dom.restore();
  });

  function monitorNetwork() {
    const fetch = vi.fn();
    const xhr = vi.fn();
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("XMLHttpRequest", class {
      constructor() {
        xhr();
      }
    });
    Object.defineProperty(globalThis.navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });
    return { fetch, xhr, sendBeacon };
  }

  async function mountReview() {
    const { data, binding } = readyData();
    const client = await import("react-dom/client");
    root = client.createRoot(container as unknown as Element);
    await act(async () => {
      root?.render(createElement(FamilyTop5Review, {
        topFamilies: data.topFamilies,
        remainingFamilies: data.remainingFamilies,
        sourceArtifactBinding: binding,
      }));
    });
    return { data, binding };
  }

  async function click(element: TestElement): Promise<void> {
    await act(async () => element.click());
  }

  function reviewStorageKey(binding: SourceArtifactBinding): string {
    return `family-top5-human-review-v1:${binding.familyDataSha256}`;
  }

  function confirmationCheckbox(): TestElement {
    const checkbox = findAll(
      container,
      (element) => element.localName === "input" && element.type === "checkbox",
    ).at(-1);
    if (!checkbox) throw new Error("missing_confirmation_checkbox");
    return checkbox;
  }

  async function remountReview(): Promise<void> {
    await act(async () => root?.unmount());
    root = null;
    container = dom.document.createElement("div");
    dom.document.body.appendChild(container);
    await mountReview();
  }

  function familyCard(familyId: string): TestElement {
    const card = findAll(container, (element) => element.getAttribute("data-family-id") === familyId)[0];
    if (!card) throw new Error(`missing_family_card:${familyId}`);
    return card;
  }

  async function decideAll(firstDecision: FamilyReviewDecisionValue = "continue_research") {
    const { data } = readyData();
    for (const [index, family] of data.topFamilies.entries()) {
      const decision = index === 0 ? firstDecision : "watch";
      const label = decision === "continue_research" ? "继续调查" : "观察";
      await click(findByText(familyCard(family.familyId), "button", label));
    }
    return data;
  }

  async function createConfirmedReview() {
    const { data, binding } = await mountReview();
    await decideAll();
    const firstCard = familyCard(data.topFamilies[0].familyId);
    const note = findAll(firstCard, (element) => element.localName === "textarea")[0];
    await act(async () => {
      setNativeValue(note, "人工复核备注");
      note.dispatchEvent(new TestEvent("input"));
    });
    await click(findAll(firstCard, (element) => element.localName === "input" && element.type === "checkbox")[0]);
    await click(confirmationCheckbox());
    const key = reviewStorageKey(binding);
    const stored = JSON.parse(dom.localStorage.getItem(key) ?? "null") as Record<string, unknown>;
    return { data, binding, key, stored };
  }

  function expectNoNetwork(network: ReturnType<typeof monitorNetwork>): void {
    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.xhr).not.toHaveBeenCalled();
    expect(network.sendBeacon).not.toHaveBeenCalled();
  }

  it("restores decisions, notes, selection, and the saved confirmation without network writes", async () => {
    const network = monitorNetwork();
    const { data, stored } = await createConfirmedReview();
    expect(stored).toMatchObject({
      schemaVersion: "family-top5-review-state.v2",
      reviewerConfirmed: true,
    });
    expect(typeof stored.sourceBindingFingerprint).toBe("string");
    expect(typeof stored.confirmationFingerprint).toBe("string");

    await remountReview();

    const firstCard = familyCard(data.topFamilies[0].familyId);
    const note = findAll(firstCard, (element) => element.localName === "textarea")[0];
    const selected = findAll(firstCard, (element) => element.localName === "input" && element.type === "checkbox")[0];
    expect(findByText(firstCard, "button", "继续调查").getAttribute("aria-pressed")).toBe("true");
    expect(note.value).toBe("人工复核备注");
    expect(selected.checked).toBe(true);
    expect(confirmationCheckbox().checked).toBe(true);
    expectNoNetwork(network);
  });

  it("restores legacy decisions and selection but never trusts a legacy confirmation", async () => {
    const { data, binding } = readyData();
    const legacy = reviewedState("watch", [data.topFamilies[0].familyId]);
    dom.localStorage.setItem(reviewStorageKey(binding), JSON.stringify({
      decisions: legacy.decisions,
      selectedFamilyIds: legacy.selectedFamilyIds,
      reviewerConfirmed: true,
    }));
    const network = monitorNetwork();

    await mountReview();

    expect(findByText(familyCard(data.topFamilies[0].familyId), "button", "继续调查").getAttribute("aria-pressed")).toBe("true");
    expect(confirmationCheckbox().checked).toBe(false);
    expectNoNetwork(network);
  });

  it.each([
    ["invalid JSON", (_stored: Record<string, unknown>): string => "{not-json"],
    ["unsupported schema", (stored: Record<string, unknown>): string => JSON.stringify({ ...stored, schemaVersion: "unknown" })],
    ["source binding mismatch", (stored: Record<string, unknown>): string => JSON.stringify({ ...stored, sourceBindingFingerprint: "mismatch" })],
    ["confirmation fingerprint mismatch", (stored: Record<string, unknown>): string => JSON.stringify({ ...stored, confirmationFingerprint: "mismatch" })],
    ["invalid decisions", (stored: Record<string, unknown>): string => {
      const decisions = structuredClone(stored.decisions) as Record<string, Record<string, unknown>>;
      const familyId = Object.keys(decisions)[0];
      decisions[familyId] = { ...decisions[familyId], notes: 42 };
      return JSON.stringify({ ...stored, decisions });
    }],
    ["unknown selected family", (stored: Record<string, unknown>): string => JSON.stringify({ ...stored, selectedFamilyIds: ["unknown-family"] })],
    ["more than five selections", (stored: Record<string, unknown>): string => JSON.stringify({ ...stored, selectedFamilyIds: ["1", "2", "3", "4", "5", "6"] })],
  ] as const)("fails closed for %s stored state", async (_label, corrupt) => {
    const network = monitorNetwork();
    const { key, stored } = await createConfirmedReview();
    dom.localStorage.setItem(key, corrupt(stored));

    await remountReview();

    expect(confirmationCheckbox().checked).toBe(false);
    expectNoNetwork(network);
  });

  it.each(["decision", "note", "selection"] as const)(
    "invalidates and persists the cleared confirmation after a %s change",
    async (change) => {
      const network = monitorNetwork();
      const { data, key } = await createConfirmedReview();
      const firstCard = familyCard(data.topFamilies[0].familyId);

      if (change === "decision") {
        await click(findByText(firstCard, "button", "不继续调查"));
      } else if (change === "note") {
        const note = findAll(firstCard, (element) => element.localName === "textarea")[0];
        await act(async () => {
          setNativeValue(note, "changed after confirmation");
          note.dispatchEvent(new TestEvent("input"));
        });
      } else {
        await click(findAll(firstCard, (element) => element.localName === "input" && element.type === "checkbox")[0]);
      }

      expect(confirmationCheckbox().checked).toBe(false);
      const stored = JSON.parse(dom.localStorage.getItem(key) ?? "null") as Record<string, unknown>;
      expect(stored.reviewerConfirmed).toBe(false);
      expect(stored.confirmationFingerprint).toBeNull();
      await remountReview();
      expect(confirmationCheckbox().checked).toBe(false);
      expectNoNetwork(network);
    },
  );

  it("allows a fresh confirmation after an edit and restores only the new confirmation", async () => {
    const network = monitorNetwork();
    const { data, key } = await createConfirmedReview();
    const firstCard = familyCard(data.topFamilies[0].familyId);
    const note = findAll(firstCard, (element) => element.localName === "textarea")[0];
    await act(async () => {
      setNativeValue(note, "new confirmed note");
      note.dispatchEvent(new TestEvent("input"));
    });
    expect(confirmationCheckbox().checked).toBe(false);
    await click(confirmationCheckbox());
    const stored = JSON.parse(dom.localStorage.getItem(key) ?? "null") as Record<string, unknown>;
    expect(stored.reviewerConfirmed).toBe(true);

    await remountReview();

    expect(confirmationCheckbox().checked).toBe(true);
    expect(findAll(familyCard(data.topFamilies[0].familyId), (element) => element.localName === "textarea")[0].value).toBe("new confirmed note");
    expectNoNetwork(network);
  });

  it("persists real decisions and notes, then restores them after remounting without business requests", async () => {
    const network = monitorNetwork();
    const { data } = await mountReview();
    await decideAll();

    const firstCard = familyCard(data.topFamilies[0].familyId);
    const note = findAll(firstCard, (element) => element.localName === "textarea")[0];
    await act(async () => {
      setNativeValue(note, "继续核对包装差异");
      note.dispatchEvent(new TestEvent("input"));
    });
    const selection = findAll(firstCard, (element) => element.localName === "input" && element.type === "checkbox")[0];
    await click(selection);

    const stored = JSON.parse(dom.localStorage.getItem(0 === dom.localStorage.length ? "" : dom.localStorage.key(0)!) ?? "null") as FamilyTop5ReviewState;
    expect(stored.decisions[data.topFamilies[0].familyId].notes).toBe("继续核对包装差异");
    expect(stored.selectedFamilyIds).toEqual([data.topFamilies[0].familyId]);

    await act(async () => root?.unmount());
    root = null;
    container = dom.document.createElement("div");
    dom.document.body.appendChild(container);
    await mountReview();
    const restoredCard = familyCard(data.topFamilies[0].familyId);
    expect(findAll(restoredCard, (element) => element.localName === "textarea")[0].value).toBe("继续核对包装差异");
    expect(findAll(restoredCard, (element) => element.localName === "input" && element.type === "checkbox")[0].checked).toBe(true);
    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.xhr).not.toHaveBeenCalled();
    expect(network.sendBeacon).not.toHaveBeenCalled();
  });

  it("downloads the real schema-bound JSON and revokes its object URL without network writes", async () => {
    const network = monitorNetwork();
    const objectUrl = "blob:family-review-test";
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue(objectUrl);
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { data, binding } = await mountReview();
    await decideAll();

    const firstCard = familyCard(data.topFamilies[0].familyId);
    await click(findAll(firstCard, (element) => element.localName === "input" && element.type === "checkbox")[0]);
    const confirmation = findAll(container, (element) => element.localName === "input" && element.type === "checkbox").at(-1);
    if (!confirmation) throw new Error("missing_confirmation_checkbox");
    await click(confirmation);
    await click(findByText(container, "button", "导出人工复核结果"));

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    if (!(blob instanceof Blob)) throw new Error("export_is_not_blob");
    const exported = JSON.parse(await blob.text());
    expect(exported.schemaVersion).toBe("family-top5-human-review.v1");
    expect(exported.reviewedFamilies).toHaveLength(5);
    expect(exported.selectedFamilyIds).toEqual([data.topFamilies[0].familyId]);
    expect(exported.selectedFamilies.map((family: { familyId: string }) => family.familyId)).toEqual(exported.selectedFamilyIds);
    expect(exported.sourceArtifactBinding).toEqual(binding);
    const anchor = dom.document.createdElements.filter((element) => element.localName === "a").at(-1);
    expect(anchor).toMatchObject({ href: objectUrl, download: "family-top5-human-review.v1.json", clickCount: 1 });
    expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl);
    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.xhr).not.toHaveBeenCalled();
    expect(network.sendBeacon).not.toHaveBeenCalled();
  });

  it("mounts the real client component and runs its effects", async () => {
    const network = monitorNetwork();
    await mountReview();

    expect(findAll(container, (element) => element.getAttribute("data-testid") === "family-card")).toHaveLength(5);
    expect(dom.localStorage.length).toBe(1);
    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.xhr).not.toHaveBeenCalled();
    expect(network.sendBeacon).not.toHaveBeenCalled();
  });
});
