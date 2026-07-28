import { buildAccessHeaders } from "@/lib/client/accessToken";

export type StudioTaskPrefill = {
  taskId: string;
  productName: string;
  description: string;
  category: string;
  sellingPoints: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanTextList(value: unknown, maxItems = 8) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, maxItems)
    : [];
}

export function extractStudioTaskPrefill(value: unknown): StudioTaskPrefill | null {
  if (!isRecord(value)) return null;
  const taskId = cleanText(value.id, 200);
  if (!taskId) return null;

  const result = isRecord(value.result) ? value.result : {};
  const listing = isRecord(result.listing) ? result.listing : {};
  const productName = cleanText(value.title, 200)
    || cleanText(result.productName, 200)
    || cleanText(value.materialText, 200);
  const description = cleanText(value.materialText, 1_000)
    || cleanText(value.oneLineSummary, 1_000);
  const category = cleanText(result.category, 200)
    || cleanText(listing.category, 200);
  const sellingPoints = cleanTextList(result.sellingPoints).join(", ")
    || cleanTextList(listing.sellingPoints).join(", ");

  return {
    taskId,
    productName,
    description,
    category,
    sellingPoints: sellingPoints.slice(0, 1_000),
  };
}

export async function loadStudioTaskPrefill(taskId: string, signal: AbortSignal) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: buildAccessHeaders(),
    cache: "no-store",
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(payload) || payload.ok !== true) {
    throw new Error("TASK_PREFILL_UNAVAILABLE");
  }

  const prefill = extractStudioTaskPrefill(payload.data);
  if (!prefill) throw new Error("TASK_PREFILL_INVALID");
  return prefill;
}
