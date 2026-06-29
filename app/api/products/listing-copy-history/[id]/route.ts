import { NextRequest, NextResponse } from "next/server";
import { deleteListingCopyHistory } from "@/lib/server/listingCopyHistoryStore";
import { getAccessPassword } from "@/lib/server/accessPassword";
import { requireOwnerOnly } from "@/lib/server/demoGuard";

export const runtime = "nodejs";

type ApiError = {
  code: string;
  message: string;
};

type ApiResponse =
  | { ok: true; data: { id: string } }
  | { ok: false; error: ApiError };

type RouteContext = {
  params: Promise<{
    id?: string;
  }>;
};

function jsonResponse(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
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

function accessPasswordNotConfigured() {
  return NextResponse.json({ error: "ACCESS_PASSWORD is not configured." }, { status: 500 });
}

function serverError() {
  return jsonResponse({
    ok: false,
    error: {
      code: "server_error",
      message: "\u5386\u53f2\u8bb0\u5f55\u5220\u9664\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002",
    },
  }, 500);
}

function isDatabaseReady() {
  return Boolean(process.env.DATABASE_URL);
}

function isDatabaseError(error: unknown) {
  return error instanceof Error && (
    error.message.includes("DATABASE_URL") ||
    error.message.includes("Environment variable not found") ||
    error.message.includes("Can't reach database") ||
    error.message.includes("database")
  );
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  if (!getAccessPassword()) return accessPasswordNotConfigured();

  const auth = requireOwnerOnly(_request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

  if (!isDatabaseReady()) return databaseError();

  const { id: rawId } = await context.params;
  const id = typeof rawId === "string" ? rawId.trim() : "";

  if (!id) {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_id", message: "\u8bf7\u63d0\u4f9b\u8981\u5220\u9664\u7684\u5386\u53f2\u8bb0\u5f55 ID\u3002" },
    }, 400);
  }

  try {
    const deleted = await deleteListingCopyHistory(id);
    if (!deleted) {
      return jsonResponse({
        ok: false,
        error: { code: "not_found", message: "\u5386\u53f2\u8bb0\u5f55\u4e0d\u5b58\u5728\u6216\u5df2\u5220\u9664\u3002" },
      }, 404);
    }

    return jsonResponse({
      ok: true,
      data: { id },
    });
  } catch (error) {
    return isDatabaseError(error) ? databaseError() : serverError();
  }
}
