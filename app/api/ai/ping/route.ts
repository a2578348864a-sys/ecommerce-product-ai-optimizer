import { NextResponse } from "next/server";
import { isAiDiagnosticsAllowed, pingAiProvider } from "@/lib/server/aiDiagnostics";

export const runtime = "nodejs";

function disabledResponse() {
  return NextResponse.json(
    { ok: false, error: { code: "not_found", message: "Not found." } },
    { status: 404 },
  );
}

export async function POST() {
  if (!isAiDiagnosticsAllowed()) {
    return disabledResponse();
  }

  const result = await pingAiProvider();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
