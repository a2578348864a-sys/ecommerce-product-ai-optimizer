import { NextRequest, NextResponse } from "next/server";
import {
  createListingCopyHistory,
  listListingCopyHistories,
  type ListingCopyHistoryRecord,
} from "@/lib/server/listingCopyHistoryStore";
import { checkAccessPassword } from "@/lib/server/accessPassword";
import type { ListingCopyResult } from "@/lib/types";

export const runtime = "nodejs";

type ApiError = {
  code: string;
  message: string;
};

type ListingCopyHistoryItem = {
  id: string;
  productId: string | null;
  productName: string;
  title: string;
  data: ListingCopyResult;
  sourceInput?: unknown;
  createdAt: string;
  updatedAt: string;
};

type ApiResponse =
  | { ok: true; data: { items: ListingCopyHistoryItem[] } }
  | { ok: true; data: ListingCopyHistoryItem }
  | { ok: false; error: ApiError };

const unnamedProduct = "\u672a\u547d\u540d\u5546\u54c1";

function jsonResponse(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLimit(value: string | null) {
  if (!value) return 10;
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit < 1) return 10;
  return Math.min(Math.trunc(limit), 50);
}

function parseProductName(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : unnamedProduct;
}

function parseOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toHistoryItem(record: ListingCopyHistoryRecord): ListingCopyHistoryItem {
  return {
    id: record.id,
    productId: record.productId,
    productName: record.productName,
    title: record.title,
    data: record.data,
    ...(record.sourceInput === null ? {} : { sourceInput: record.sourceInput }),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function isDatabaseReady() {
  return Boolean(process.env.DATABASE_URL);
}

function databaseError() {
  return jsonResponse({
    ok: false,
    error: {
      code: "database_error",
      message: "\u672c\u5730\u6570\u636e\u5e93\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u786e\u8ba4\u6570\u636e\u5e93\u914d\u7f6e\u540e\u518d\u8bd5\u3002",
    },
  }, 500);
}

function serverError() {
  return jsonResponse({
    ok: false,
    error: {
      code: "server_error",
      message: "\u5386\u53f2\u8bb0\u5f55\u5904\u7406\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002",
    },
  }, 500);
}

function isDatabaseError(error: unknown) {
  return error instanceof Error && (
    error.message.includes("DATABASE_URL") ||
    error.message.includes("Environment variable not found") ||
    error.message.includes("Can't reach database") ||
    error.message.includes("database")
  );
}

export async function GET(request: NextRequest) {
  const authError = checkAccessPassword(request);
  if (authError) return NextResponse.json(authError.body, { status: authError.status });

  if (!isDatabaseReady()) return databaseError();

  try {
    const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
    const items = await listListingCopyHistories(limit);

    return jsonResponse({
      ok: true,
      data: { items: items.map(toHistoryItem) },
    });
  } catch (error) {
    return isDatabaseError(error) ? databaseError() : serverError();
  }
}

export async function POST(request: NextRequest) {
  let rawText = "";
  try {
    rawText = await request.text();
  } catch {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_body", message: "\u65e0\u6cd5\u8bfb\u53d6\u8bf7\u6c42\u4f53\u3002" },
    }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = rawText ? JSON.parse(rawText) : {};
  } catch {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_json", message: "\u8bf7\u6c42\u4f53\u4e0d\u662f\u5408\u6cd5 JSON\u3002" },
    }, 400);
  }

  if (!isRecord(rawBody)) {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_body", message: "\u8bf7\u6c42\u4f53\u5fc5\u987b\u662f JSON object\u3002" },
    }, 400);
  }

  // Auth first \u2014 do not expose DB readiness to unauthenticated callers
  const authError = checkAccessPassword(request, rawBody);
  if (authError) return NextResponse.json(authError.body, { status: authError.status });

  if (!isDatabaseReady()) return databaseError();

  if (!isRecord(rawBody.data)) {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_data", message: "\u8bf7\u63d0\u4f9b\u8981\u4fdd\u5b58\u7684\u82f1\u6587\u4e0a\u67b6\u6587\u6848\u3002" },
    }, 400);
  }

  try {
    const item = await createListingCopyHistory({
      productId: parseOptionalString(rawBody.productId),
      productName: parseProductName(rawBody.productName),
      data: rawBody.data as ListingCopyResult,
      sourceInput: rawBody.sourceInput,
    });

    return jsonResponse({
      ok: true,
      data: toHistoryItem(item),
    });
  } catch (error) {
    return isDatabaseError(error) ? databaseError() : serverError();
  }
}

export async function DELETE(request: NextRequest) {
  const authError = checkAccessPassword(request);
  if (authError) return NextResponse.json(authError.body, { status: authError.status });

  return jsonResponse({
    ok: false,
    error: { code: "invalid_id", message: "\u8bf7\u63d0\u4f9b\u8981\u5220\u9664\u7684\u5386\u53f2\u8bb0\u5f55 ID\u3002" },
  }, 400);
}
