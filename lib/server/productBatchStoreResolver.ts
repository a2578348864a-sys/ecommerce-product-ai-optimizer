import "server-only";

import type { AccessContext } from "@/lib/server/accessPassword";
import { getDemoProductJourneySnapshot } from "@/lib/server/demoProductJourneyQuota";
import { createDemoProductBatchStore } from "@/lib/server/demoProductBatchStore";
import { createOwnerProductBatchStore } from "@/lib/server/ownerProductBatchStore";
import type { ProductBatchStore } from "@/lib/productBatchStore";

export class ProductBatchAccessStateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductBatchAccessStateError";
  }
}

export function getProductBatchStore(context: AccessContext): ProductBatchStore {
  return context.mode === "owner"
    ? createOwnerProductBatchStore()
    : createDemoProductBatchStore(context.demoAccessId);
}

export function getProductBatchAccessSummary(context: AccessContext): {
  accessMode: "owner" | "visitor";
  maxProducts: number | null;
  usedProducts: number | null;
  remainingProducts: number | null;
} {
  if (context.mode === "owner") {
    return { accessMode: "owner", maxProducts: null, usedProducts: null, remainingProducts: null };
  }
  let snapshot;
  try {
    snapshot = getDemoProductJourneySnapshot(context.demoAccessId);
  } catch {
    throw new ProductBatchAccessStateError(
      "visitor_access_state_unavailable",
      "Visitor access state is unavailable.",
    );
  }
  return {
    accessMode: "visitor",
    maxProducts: snapshot.maxProducts,
    usedProducts: snapshot.usedProducts,
    remainingProducts: snapshot.remainingProducts,
  };
}
