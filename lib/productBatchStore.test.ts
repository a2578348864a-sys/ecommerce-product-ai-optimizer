import { describe, expect, it } from "vitest";

import {
  PRODUCT_BATCH_CAPABILITY_MATRIX,
  productBatchResponseShape,
} from "@/lib/productBatchStore";

describe("ProductBatch centralized dual-role capability matrix", () => {
  it("gives Owner and Visitor the same ProductBatch product capabilities", () => {
    expect(PRODUCT_BATCH_CAPABILITY_MATRIX.owner).toEqual(
      PRODUCT_BATCH_CAPABILITY_MATRIX.visitor,
    );
    expect(PRODUCT_BATCH_CAPABILITY_MATRIX.owner).toEqual({
      importBatch: true,
      listBatches: true,
      viewItems: true,
      activateBatch: true,
      activateLegacy: true,
      archiveBatch: true,
      deleteBatch: true,
      removeBatchItem: true,
    });
  });

  it("uses one response shape without exposing a storage subject", () => {
    const response = productBatchResponseShape({
      accessMode: "visitor",
      maxProducts: 5,
      usedProducts: 0,
      remainingProducts: 5,
      batches: [],
      selection: null,
      legacyRegistrationId: "production-registration-20260717-01",
    });
    expect(Object.keys(response)).toEqual([
      "accessMode",
      "maxProducts",
      "usedProducts",
      "remainingProducts",
      "batches",
      "selection",
      "legacyRegistrationId",
    ]);
    expect(JSON.stringify(response)).not.toContain("demoAccessId");
    expect(JSON.stringify(response)).not.toContain("ownerSubject");
  });
});
