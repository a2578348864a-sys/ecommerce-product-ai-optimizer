import { NextRequest, NextResponse } from "next/server";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonError, jsonOk, v4DisabledResponse } from "@/lib/v4/apiHelpers";
import { requireV4GraphEnabled } from "@/lib/v4/featureFlag";
import { parseBundle, type ReplayBundle } from "@/lib/v4/replay/schema";

export const runtime = "nodejs";

const BUNDLES_DIR = "data/replay-bundles";

/** GET /api/v4/replay — Visitor 可读的已发布母案例列表（只读 bundle 元数据）。 */
export async function GET(request: NextRequest) {
  if (!requireV4GraphEnabled().ok) return v4DisabledResponse();
  let files: string[] = [];
  try { files = readdirSync(BUNDLES_DIR).filter((f) => f.endsWith(".json")); } catch { files = []; }
  const bundles: { bundleId: string; capturedAt: string; exportedAt: string; sourceRunId: string; title: string }[] = [];
  for (const f of files.sort()) {
    try {
      const raw = readFileSync(join(BUNDLES_DIR, f), "utf8");
      const parsed = parseBundle(raw);
      if (!parsed.ok) continue;
      const b = parsed.bundle;
      bundles.push({
        bundleId: b.bundleId,
        capturedAt: b.capturedAt,
        exportedAt: b.exportedAt,
        sourceRunId: b.sourceRunId,
        title: String((b.data as { candidate?: { name?: string } }).candidate?.name ?? b.bundleId),
      });
    } catch { /* skip */ }
  }
  return jsonOk({ replayMode: "historical_redacted", bundles });
}
