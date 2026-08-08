import { describe, expect, it } from "vitest";

import {
  deriveImageStudioProgress,
  deriveListingStudioProgress,
} from "@/lib/client/studioProgress";

describe("Studio progress derivation", () => {
  it("keeps Listing progress on real brief, generation, and review states", () => {
    expect(deriveListingStudioProgress({
      briefReady: false,
      isGenerating: false,
      hasResult: false,
    }).map((step) => step.status)).toEqual(["active", "pending", "pending"]);

    expect(deriveListingStudioProgress({
      briefReady: true,
      isGenerating: true,
      hasResult: false,
    })).toMatchObject([
      { key: "brief", status: "completed" },
      { key: "generate", status: "active", loading: true },
      { key: "review", status: "pending" },
    ]);

    expect(deriveListingStudioProgress({
      briefReady: true,
      isGenerating: false,
      hasResult: true,
    })).toMatchObject([
      { key: "brief", status: "completed" },
      { key: "generate", status: "completed" },
      { key: "review", status: "active" },
    ]);
  });

  it("advances Image progress only from real generation and selection state", () => {
    expect(deriveImageStudioProgress({
      briefReady: true,
      strategyReady: true,
      isGenerating: true,
      candidateCount: 0,
      selectedImageId: null,
    })).toMatchObject([
      { key: "brief", status: "completed" },
      { key: "strategy", status: "completed" },
      { key: "generate", status: "active", loading: true },
      { key: "select", status: "pending" },
    ]);

    expect(deriveImageStudioProgress({
      briefReady: true,
      strategyReady: true,
      isGenerating: false,
      candidateCount: 1,
      selectedImageId: null,
    }).map((step) => step.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "active",
    ]);

    expect(deriveImageStudioProgress({
      briefReady: true,
      strategyReady: true,
      isGenerating: false,
      candidateCount: 2,
      selectedImageId: "image-1",
    }).map((step) => step.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
  });
});
