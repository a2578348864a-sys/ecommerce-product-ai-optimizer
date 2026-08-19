import type { NextRequest } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { hasSellerSpritePreviewSameOrigin } from "@/lib/server/sellerSpritePreviewOrigin";
import { generateSellerSpritePreviewImportToken } from "@/lib/server/sellerSpritePreviewImportToken";
import {
  checkDuplicateAsin,
  confirmedIsTrue,
  reconcileSellerSpritePreviewAgainstToken,
  selectedRowHashesAreSubset,
  verifySellerSpritePreviewTokenForImport,
} from "@/lib/server/sellerSpriteImportContract";
import { importSellerSpriteCandidates } from "@/lib/server/sellerSpriteCandidateImport";
import {
  SELLERSPRITE_PLUGIN_MAX_BODY_UTF8_BYTES,
  SELLERSPRITE_PLUGIN_PARSER_CONTRACT_VERSION,
  SELLERSPRITE_PLUGIN_SOURCE_FILE_SHA256,
  SELLERSPRITE_PLUGIN_WARNING_COUNT,
  mapPluginRowToSellerSpriteImportRow,
  sellerSpritePluginAcceptedRowsDigest,
  sellerSpritePluginWarningDigest,
  validateSellerSpritePluginRows,
  validateSellerSpritePluginSelectedRowHashes,
  type SellerSpritePluginRow,
} from "@/lib/server/sellerSpritePluginContract";

export const runtime = "nodejs";

const JSON_MIME_PREFIX = "application/json";

function error(
  status: number,
  code: string,
  message: string,
  details?: { rowIndex?: number; field?: string; stage?: string },
): Response {
  return Response.json(
    { ok: false, error: { code, ...(details ?? {}), message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function subjectFromAccessContext(context: { mode: string; demoAccessId?: string }): string {
  return context.mode === "demo" && context.demoAccessId
    ? `visitor:${context.demoAccessId}`
    : "owner";
}

function tokenStatusFor(code: string): number {
  if (code === "malformed_preview_token") return 400;
  if (code === "invalid_preview_token_signature" || code === "preview_token_subject_mismatch") return 403;
  return 422;
}

/**
 * 在硬字节上限下流式读取 JSON body，防止伪造 content-length 导致无界内存缓冲。
 */
async function readBoundedJsonText(
  request: Request,
): Promise<{ ok: true; text: string } | { ok: false; reason: "too_large" | "unreadable" }> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: "unreadable" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > SELLERSPRITE_PLUGIN_MAX_BODY_UTF8_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(buffer) };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

function rowValidationStatus(code: string): number {
  // 白名单越权 / 行级 schema 问题都是客户端提交数据错误 → 400。
  return 400;
}

function capturedAtFromBody(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function POST(request: NextRequest): Promise<Response> {
  // 1. Authentication（Token subject 的服务端绑定）。
  const guard = requireAuthenticated(request);
  if (!guard.ok) return error(guard.status, guard.code, guard.message);

  // 2. Same-origin check。
  if (!hasSellerSpritePreviewSameOrigin(request)) {
    return error(403, "same_origin_required", "请求来源无效。");
  }

  // 3. Content-Type 必须是 application/json。
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith(JSON_MIME_PREFIX)) {
    return error(415, "json_required", "只接受 application/json 提交。");
  }

  // 4. 有界读取 + JSON 解析。
  const bounded = await readBoundedJsonText(request);
  if (!bounded.ok) {
    return bounded.reason === "too_large"
      ? error(413, "payload_too_large", "请求体超出大小限制。")
      : error(400, "invalid_json_body", "无法读取请求体。");
  }
  let body: unknown;
  try {
    body = JSON.parse(bounded.text);
  } catch {
    return error(400, "invalid_json_body", "请求体不是有效 JSON。");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return error(400, "invalid_json_body", "请求体必须是 JSON 对象。");
  }
  const payload = body as Record<string, unknown>;

  // 5. stage 判别。
  const stage = payload.stage;
  if (stage !== "preview" && stage !== "confirm") {
    return error(400, "invalid_stage", "stage 必须是 preview 或 confirm。");
  }

  const subjectScope = subjectFromAccessContext(guard.context);
  const capturedAt = capturedAtFromBody(payload.capturedAt);

  // 6. 行级校验（两阶段共用；白名单/类型/ASIN/列身份）。
  const validated = validateSellerSpritePluginRows(payload.rows);
  if (!validated.ok) {
    return error(
      rowValidationStatus(validated.error.code),
      validated.error.code,
      validated.error.message,
      {
        ...(validated.error.rowIndex !== null ? { rowIndex: validated.error.rowIndex } : {}),
        ...(validated.error.field ? { field: validated.error.field } : {}),
        stage,
      },
    );
  }
  const importRows = validated.rows.map((row: SellerSpritePluginRow, index: number) =>
    mapPluginRowToSellerSpriteImportRow(row, index, capturedAt));

  // 7. 请求内重复 ASIN 拒绝（任何写入之前）。
  const duplicateAsin = checkDuplicateAsin(importRows);
  if (duplicateAsin) {
    return error(422, "duplicate_selected_candidate_identity", "提交行包含重复 ASIN。", { stage });
  }

  if (stage === "preview") {
    // 8. Preview：签名 Token + acceptedRows（同 sellersprite-import 链 Token 合同）。
    const acceptedRowsDigest = sellerSpritePluginAcceptedRowsDigest(importRows);
    let previewToken: string;
    try {
      previewToken = generateSellerSpritePreviewImportToken(
        subjectScope,
        SELLERSPRITE_PLUGIN_SOURCE_FILE_SHA256,
        acceptedRowsDigest,
        importRows.length,
        sellerSpritePluginWarningDigest(),
        SELLERSPRITE_PLUGIN_WARNING_COUNT,
        SELLERSPRITE_PLUGIN_PARSER_CONTRACT_VERSION,
      );
    } catch {
      return error(500, "preview_token_unavailable", "Preview Token 签名不可用，请检查服务端配置。", { stage });
    }
    return Response.json(
      {
        ok: true,
        preview: {
          acceptedRows: importRows,
          acceptedRowCount: importRows.length,
          acceptedRowsDigest,
          warningCount: SELLERSPRITE_PLUGIN_WARNING_COUNT,
          warnings: [],
          parserContractVersion: SELLERSPRITE_PLUGIN_PARSER_CONTRACT_VERSION,
          previewToken,
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  // ── stage === "confirm" ────────────────────────────────────────────────
  // 9. Preview Token 格式/签名/subject/时间。
  if (typeof payload.previewToken !== "string" || payload.previewToken.length === 0) {
    return error(400, "malformed_preview_token", "缺少 previewToken。", { stage });
  }
  const tokenResult = verifySellerSpritePreviewTokenForImport(payload.previewToken, subjectScope);
  if (!tokenResult.ok) {
    return error(tokenStatusFor(tokenResult.code), tokenResult.code, "Preview Token 校验失败。", { stage });
  }

  // 10. 服务端重校验行 + 摘要对账（不接受客户端声明的内容）。
  const reconciled = reconcileSellerSpritePreviewAgainstToken(
    {
      sourceFileSha256: SELLERSPRITE_PLUGIN_SOURCE_FILE_SHA256,
      acceptedRowsDigest: sellerSpritePluginAcceptedRowsDigest(importRows),
      acceptedRowCount: importRows.length,
      warningDigest: sellerSpritePluginWarningDigest(),
      warnings: [],
      acceptedRowHashes: importRows.map((row) => row.rowHash),
    },
    tokenResult.payload,
  );
  if (!reconciled.ok) {
    return error(422, reconciled.code, "提交行与 Preview Token 内容不一致。", { stage });
  }

  // 11. 选行解析与子集校验。
  const selected = validateSellerSpritePluginSelectedRowHashes(payload.selectedRowHashes);
  if (!selected.ok) {
    return error(400, selected.code, "selectedRowHashes 无效。", { stage });
  }
  if (!selectedRowHashesAreSubset(selected.selectedRowHashes, reconciled.value.acceptedRowHashes)) {
    return error(422, "selected_rows_not_subset", "选中行不在合法 Preview 行集合内。", { stage });
  }

  // 12. 人工确认。
  if (!confirmedIsTrue(String(payload.confirmed))) {
    return error(422, "confirmation_required", "需要确认导入。", { stage });
  }

  // 13. 仅用服务端重建的选中行 → Candidate Authority（幂等键 marketplace:asin 复用）。
  const byHash = new Map(importRows.map((row) => [row.rowHash, row]));
  const selectedRows = selected.selectedRowHashes.map((hash) => byHash.get(hash)!);
  const importedAt = new Date().toISOString();
  const summary = await importSellerSpriteCandidates({
    context: guard.context,
    rows: selectedRows,
    sourceFileSha256: SELLERSPRITE_PLUGIN_SOURCE_FILE_SHA256,
    importedAt,
  });

  return Response.json(
    { ok: true, ...summary, warnings: [] },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
