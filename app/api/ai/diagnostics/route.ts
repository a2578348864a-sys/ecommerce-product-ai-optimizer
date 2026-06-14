import { NextRequest, NextResponse } from "next/server";
import {
  checkAiModels,
  getAiDiagnosticsSnapshot,
  isAiDiagnosticsAllowed,
} from "@/lib/server/aiDiagnostics";

export const runtime = "nodejs";

function disabledResponse() {
  return NextResponse.json(
    { ok: false, error: { code: "not_found", message: "Not found." } },
    { status: 404 },
  );
}

export async function GET(request: NextRequest) {
  if (!isAiDiagnosticsAllowed()) {
    return disabledResponse();
  }

  const checkModels = request.nextUrl.searchParams.get("checkModels") === "1";

  if (!checkModels) {
    return NextResponse.json({
      ok: true,
      data: getAiDiagnosticsSnapshot(),
    });
  }

  const result = await checkAiModels();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
