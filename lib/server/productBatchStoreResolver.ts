import "server-only";

import type { ProductBatchStore } from "@/lib/productBatchStore";
import { createOwnerProductBatchStore } from "@/lib/server/ownerProductBatchStore";

export function getProductBatchStore(_context?: unknown): ProductBatchStore {
  return createOwnerProductBatchStore();
}

export function getProductBatchAccessSummary(_context?: unknown): {
  accessMode: "owner" | "visitor";
  maxProducts: number | null;
  usedProducts: number | null;
  remainingProducts: number | null;
} {
  return {
    accessMode: "owner",
    maxProducts: null,
    usedProducts: null,
    remainingProducts: null,
  };
}
