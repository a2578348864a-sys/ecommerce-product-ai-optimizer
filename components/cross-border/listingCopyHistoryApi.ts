import {
  normalizeCachedListingCopy,
  type ListingCopyHistoryItem,
} from "@/components/cross-border/listingCopyStorage";
import type {
  AiAnalysisResult,
  CrossBorderProductInput,
  KeywordGenerationResult,
  ListingCopyResult,
  ProfitCalculationResult,
  StructuredListingData,
} from "@/lib/types";

type ApiError = {
  code?: string;
  message?: string;
};

type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

type ListingCopyHistoryApiItem = {
  id: string;
  productId: string | null;
  productName: string;
  title: string;
  data: ListingCopyResult;
  sourceInput?: unknown;
  createdAt: string;
  updatedAt: string;
};

type ListHistoryApiResponse =
  | { ok: true; data: { items: ListingCopyHistoryApiItem[] } }
  | { ok: false; error?: ApiError };

type CreateHistoryApiResponse =
  | { ok: true; data: ListingCopyHistoryApiItem }
  | { ok: false; error?: ApiError };

type DeleteHistoryApiResponse =
  | { ok: true; data: { id: string } }
  | { ok: false; error?: ApiError };

export type SaveListingCopyHistoryInput = {
  productId?: string;
  productName: string;
  data: ListingCopyResult;
  sourceInput: {
    product: CrossBorderProductInput;
    profit: ProfitCalculationResult;
    listingPreview: StructuredListingData;
    aiAnalysis?: AiAnalysisResult;
    keywords?: KeywordGenerationResult;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getSafeMessage(error: ApiError | undefined, fallback: string) {
  return error?.message?.trim() || fallback;
}

async function readJson(response: Response): Promise<ApiResult<unknown>> {
  try {
    return { ok: true, data: await response.json() };
  } catch {
    return {
      ok: false,
      code: "invalid_json",
      message: "数据库接口返回格式异常，已继续使用本地历史。",
    };
  }
}

function toHistoryItem(value: unknown): ListingCopyHistoryItem | null {
  if (!isRecord(value)) return null;

  const data = normalizeCachedListingCopy(value.data);
  if (!data) return null;

  const id = asString(value.id);
  if (!id) return null;

  return {
    id,
    source: "database",
    savedAt: asString(value.createdAt) || asString(value.updatedAt) || new Date().toISOString(),
    productName: asString(value.productName) || "未命名商品",
    title: asString(value.title) || data.title || "无标题",
    data,
  };
}

export async function fetchListingCopyHistory(limit = 10): Promise<ApiResult<ListingCopyHistoryItem[]>> {
  try {
    const response = await fetch(`/api/products/listing-copy-history?limit=${limit}`, {
      method: "GET",
      cache: "no-store",
    });
    const parsed = await readJson(response);
    if (!parsed.ok) return parsed;

    const payload = parsed.data as ListHistoryApiResponse;
    if (!isRecord(payload) || typeof payload.ok !== "boolean") {
      return {
        ok: false,
        code: "invalid_response",
        message: "数据库接口返回格式异常，已继续使用本地历史。",
      };
    }

    if (!payload.ok) {
      return {
        ok: false,
        code: payload.error?.code || "database_error",
        message: getSafeMessage(payload.error, "数据库读取失败，已继续使用本地历史。"),
      };
    }

    const items = Array.isArray(payload.data.items)
      ? payload.data.items.map(toHistoryItem).filter((item): item is ListingCopyHistoryItem => item !== null)
      : [];

    return { ok: true, data: items };
  } catch {
    return {
      ok: false,
      code: "network_error",
      message: "数据库读取失败，已继续使用本地历史。",
    };
  }
}

export async function saveListingCopyHistory(
  input: SaveListingCopyHistoryInput,
): Promise<ApiResult<ListingCopyHistoryItem>> {
  try {
    const response = await fetch("/api/products/listing-copy-history", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    const parsed = await readJson(response);
    if (!parsed.ok) {
      return {
        ok: false,
        code: parsed.code,
        message: "数据库保存失败，已保存在本地。",
      };
    }

    const payload = parsed.data as CreateHistoryApiResponse;
    if (!isRecord(payload) || typeof payload.ok !== "boolean") {
      return {
        ok: false,
        code: "invalid_response",
        message: "数据库保存失败，已保存在本地。",
      };
    }

    if (!payload.ok) {
      return {
        ok: false,
        code: payload.error?.code || "database_error",
        message: "数据库保存失败，已保存在本地。",
      };
    }

    const item = toHistoryItem(payload.data);
    if (!item) {
      return {
        ok: false,
        code: "invalid_response",
        message: "数据库保存成功但返回格式异常，已保存在本地。",
      };
    }

    return { ok: true, data: item };
  } catch {
    return {
      ok: false,
      code: "network_error",
      message: "数据库保存失败，已保存在本地。",
    };
  }
}

export async function deleteDatabaseListingCopyHistory(id: string): Promise<ApiResult<{ id: string }>> {
  try {
    const response = await fetch(`/api/products/listing-copy-history/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const parsed = await readJson(response);
    if (!parsed.ok) {
      return {
        ok: false,
        code: parsed.code,
        message: "数据库历史删除失败，请稍后再试。",
      };
    }

    const payload = parsed.data as DeleteHistoryApiResponse;
    if (!isRecord(payload) || typeof payload.ok !== "boolean") {
      return {
        ok: false,
        code: "invalid_response",
        message: "数据库历史删除失败，请稍后再试。",
      };
    }

    if (!payload.ok) {
      return {
        ok: false,
        code: payload.error?.code || "database_error",
        message: getSafeMessage(payload.error, "数据库历史删除失败，请稍后再试。"),
      };
    }

    return { ok: true, data: payload.data };
  } catch {
    return {
      ok: false,
      code: "network_error",
      message: "数据库历史删除失败，请检查本地服务后再试。",
    };
  }
}
