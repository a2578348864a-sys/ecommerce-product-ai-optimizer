import { describe, expect, it } from "vitest";
import { isStage15ScreeningPreviewAvailable } from "@/lib/stage15ScreeningPreviewAvailability";

describe("isStage15ScreeningPreviewAvailable", () => {
  it("allows only the local development environment", () => {
    expect(isStage15ScreeningPreviewAvailable("development")).toBe(true);
    expect(isStage15ScreeningPreviewAvailable("test")).toBe(false);
    expect(isStage15ScreeningPreviewAvailable("production")).toBe(false);
    expect(isStage15ScreeningPreviewAvailable(undefined)).toBe(false);
  });
});
