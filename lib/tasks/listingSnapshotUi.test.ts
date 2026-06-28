import { describe, expect, it } from "vitest";
import {
  LISTING_PACK_ANCHOR_ID,
  LISTING_PACK_SHORTCUT_LABEL,
  buildBatchDeleteConfirmationMessage,
  buildListingPackBadges,
  buildTaskDeleteConfirmationMessage,
  getAiListingPackSnapshot,
  shouldShowListingPackShortcut,
} from "./listingSnapshotUi";

const realSnapshot = {
  snapshotType: "ai_listing_pack",
  source: "real_ai_draft",
  version: 1,
};

const mockSnapshot = {
  snapshotType: "ai_listing_pack",
  source: "mock_ai_draft",
  version: 1,
};

describe("listing snapshot UI helpers", () => {
  it("detects only saved AI Listing pack snapshots", () => {
    expect(getAiListingPackSnapshot({ aiListingPackSnapshot: realSnapshot })).toEqual(realSnapshot);
    expect(getAiListingPackSnapshot({ aiListingPackSnapshot: { snapshotType: "legacy" } })).toBeNull();
    expect(getAiListingPackSnapshot({})).toBeNull();
    expect(getAiListingPackSnapshot(null)).toBeNull();
  });

  it("builds task list badges for saved real and mock listing snapshots", () => {
    expect(buildListingPackBadges({ aiListingPackSnapshot: realSnapshot })).toEqual([
      "已保存 Listing 包",
      "真实 AI draft",
    ]);

    expect(buildListingPackBadges({ aiListingPackSnapshot: mockSnapshot })).toEqual([
      "已保存 Listing 包",
      "模拟草稿",
    ]);

    expect(buildListingPackBadges({})).toEqual([]);
  });

  it("exposes the detail shortcut only when a snapshot exists", () => {
    expect(shouldShowListingPackShortcut({ aiListingPackSnapshot: realSnapshot })).toBe(true);
    expect(shouldShowListingPackShortcut({})).toBe(false);
    expect(LISTING_PACK_SHORTCUT_LABEL).toBe("查看 Listing 包");
    expect(LISTING_PACK_ANCHOR_ID).toBe("listing-pack");
  });

  it("uses a stronger delete warning when the task contains a saved listing pack", () => {
    const message = buildTaskDeleteConfirmationMessage({
      title: "折叠露营桌",
      result: { aiListingPackSnapshot: realSnapshot },
    });

    expect(message).toContain("折叠露营桌");
    expect(message).toContain("Listing 包也会一并删除");
    expect(message).toContain("无法在任务详情中继续查看");
  });

  it("keeps the ordinary delete warning when the task has no listing snapshot", () => {
    expect(buildTaskDeleteConfirmationMessage({ title: "普通任务", result: {} }))
      .toBe("确定删除「普通任务」这条任务记录吗？删除后无法恢复。");
    expect(buildTaskDeleteConfirmationMessage({ result: {} }))
      .toBe("确定删除这条任务记录吗？删除后无法恢复。");
  });

  it("warns batch deletion when any selected task contains a saved listing pack", () => {
    expect(buildBatchDeleteConfirmationMessage({ count: 2, hasListingPackSnapshot: true }))
      .toContain("选中的任务中包含已保存的 Listing 包");
    expect(buildBatchDeleteConfirmationMessage({ count: 2, hasListingPackSnapshot: true }))
      .toContain("Listing 包也会一并删除");
    expect(buildBatchDeleteConfirmationMessage({ count: 2, hasListingPackSnapshot: false }))
      .toBe("确认删除选中的 2 条任务？此操作不可恢复。");
  });
});
