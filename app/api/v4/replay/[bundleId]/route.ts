import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonError, jsonOk, v4DisabledResponse } from "@/lib/v4/apiHelpers";
import { requireV4GraphEnabled } from "@/lib/v4/featureFlag";
import { parseBundle, verifyBundleHash, type ReplayBundle } from "@/lib/v4/replay/schema";
import { createHash } from "node:crypto";

export const runtime = "nodejs";

const BUNDLES_DIR = "data/replay-bundles";

/** GET /api/v4/replay/[bundleId] — 只读母案例（hash 校验失败 → 拒绝）。 */
export async function GET(request: NextRequest, context: { params: Promise<{ bundleId: string }> }) {
  if (!requireV4GraphEnabled().ok) return v4DisabledResponse();
  const params = await context.params;
  const bundleId = params.bundleId?.trim().slice(0, 128) ?? "";
  if (!bundleId) return jsonError("invalid_id", "bundle 标识无效。", 400);
  let raw: string;
  try { raw = readFileSync(join(BUNDLES_DIR, bundleId + ".json"), "utf8"); } catch { return jsonError("bundle_not_found", "案例不存在。", 404); }
  const parsed = parseBundle(raw);
  if (!parsed.ok) return jsonError("bundle_invalid", parsed.code, 400);
  const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
  if (!verifyBundleHash(parsed.bundle, sha256)) {
    return jsonError("bundle_tampered", "案例完整性校验失败。", 409);
  }
  return jsonOk({ replayMode: "historical_redacted", bundle: parsed.bundle });
}
