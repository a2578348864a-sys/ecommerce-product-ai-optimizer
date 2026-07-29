import { describe, expect, it } from "vitest";

import { hasCompleteProfitInput } from "./ProfitSnapshotCard";

describe("ProfitSnapshotCard", () => {
  it("does not publish a profit snapshot before both manual prices are present", () => {
    expect(hasCompleteProfitInput("", "")).toBe(false);
    expect(hasCompleteProfitInput("12", "")).toBe(false);
    expect(hasCompleteProfitInput("", "30")).toBe(false);
    expect(hasCompleteProfitInput("not-a-number", "30")).toBe(false);
    expect(hasCompleteProfitInput("-1", "30")).toBe(false);
  });

  it("publishes a snapshot after both values are explicit, including a real zero", () => {
    expect(hasCompleteProfitInput("12", "30")).toBe(true);
    expect(hasCompleteProfitInput("0", "30")).toBe(true);
    expect(hasCompleteProfitInput(0, 0)).toBe(true);
  });
});
