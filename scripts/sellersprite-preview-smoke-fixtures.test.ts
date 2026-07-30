import { describe, expect, it } from "vitest";
import { precheckSellerSpritePreview } from "@/lib/upstream/sellersprite/preview";
import {
  createCriticalConflictFixture,
  createLastRoundDuplicateWarningFixture,
  createNormalSuccessFixture,
} from "./sellersprite-preview-smoke-fixtures";

describe("SellerSprite Preview smoke fixtures", () => {
  it("keeps the prior duplicate-warning plus quarantined-row scenario as a normal preview", () => {
    const result = precheckSellerSpritePreview(createLastRoundDuplicateWarningFixture());
    expect(result.blockingErrors).toEqual([]);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]?.hasCriticalConflict).toBe(false);
    expect(result.acceptedRowCount).toBe(2);
    expect(result.rejectedRows).toHaveLength(1);
  });

  it("has one explicitly defined normal success fixture", () => {
    const result = precheckSellerSpritePreview(createNormalSuccessFixture());
    expect(result.acceptedRowCount).toBe(1);
    expect(result.blockingErrors).toEqual([]);
  });

  it("keeps the critical duplicate fixture as an intentional blocking preview", () => {
    const result = precheckSellerSpritePreview(createCriticalConflictFixture());
    expect(result.blockingErrors).toHaveLength(1);
    expect(result.blockingErrors[0]?.code).toBe("duplicate_asin_conflict");
  });
});
