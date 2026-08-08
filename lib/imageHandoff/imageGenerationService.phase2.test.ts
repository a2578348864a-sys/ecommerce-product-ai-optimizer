import { describe, expect, it } from "vitest";
import {
  buildImageHandoffDraftSnapshot,
  imageDraftSafeSummaries,
} from "./imageGenerationService";

function draft(id: string, revision: number) {
  return {
    id,
    handoffMode: "composition_concept",
    compositionSummary: `Concept ${id}`,
    createdAt: "2026-08-08T00:00:00.000Z",
    sourceHandoffRevision: revision,
  };
}

describe("Phase 2 Task image candidates", () => {
  it("persists both candidates with the authoritative handoff revision", () => {
    const snapshot = buildImageHandoffDraftSnapshot({
      existingSnapshot: null,
      rawDrafts: [draft("image-a", 99), draft("image-b", 99)],
      sourceHandoffRevision: 3,
      accessMode: "owner",
      updatedAt: "2026-08-08T00:00:00.000Z",
    });

    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items.map((item) => item.id)).toEqual(["image-a", "image-b"]);
    expect(snapshot.items.every((item) => (item as unknown as { sourceHandoffRevision: number }).sourceHandoffRevision === 3)).toBe(true);
  });

  it("makes only current-revision images selectable", () => {
    const snapshot = {
      items: [draft("old", 2), draft("current-a", 3), draft("current-b", 3)],
    };

    expect(imageDraftSafeSummaries(snapshot, 3).map((item) => item.id)).toEqual([
      "current-a",
      "current-b",
    ]);
  });
});
