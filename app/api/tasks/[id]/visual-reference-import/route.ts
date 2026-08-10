import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import {
  mutateTaskResultJson,
  TaskResultJsonMutationError,
} from "@/lib/server/taskResultJsonMutation";
import {
  fetchSellerSpriteProductImage,
  buildSellerSpriteProductImageSnapshot,
} from "@/lib/server/sellerSpriteProductImage";
import {
  getProductResearchRecord,
  getProductResearchVerification,
} from "@/lib/productResearchRecord";
import { getAuthoritativeCandidate } from "@/lib/server/candidateAuthority";
import {
  parseSellerSpriteCandidateSourceMeta,
} from "@/lib/server/sellerSpriteImportContract";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 8 * 1024;

/**
 * 商品主图导入（按需）—— 唯一允许的外部图片获取入口。
 *
 * 契约：
 *   导入只保留 imageUrl（external_visual_reference_candidate），不下载。
 *   用户点击「使用此图作为商品参考图」后，本 Route 才受控获取这一张图片：
 *     - URL 必须与任务绑定的 SellerSprite 候选快照中 imageUrl 完全一致
 *       （服务器重建，绝不信任浏览器提交的新 URL）
 *     - 下载走既有安全链：Amazon 主机白名单 + 强制 HTTPS + 公网 DNS +
 *       pinned HTTPS + 大小/格式/字节校验 + sha256（fetchSellerSpriteProductImage）
 *     - 成功后构造 product-batch 兼容快照，原子写入任务 sourceMeta.candidateSnapshot
 *       .productImageSnapshot（后续 Creative Handoff 视觉候选 / 批准 / ImageInput
 *       全链复用既有合同）
 *     - 快照 originalUrl 保留 imageUrl 作为 provenance，但不再二次校验通过
 *  失败一律不阻断 Listing / Task：返回 422 visual_reference_unavailable，
 *  页面显示「商品参考图无法安全导入，可手动上传参考图」。
 */

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseStorageVersion(value: unknown): { resultJsonHash: string; updatedAt: string } | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).length !== 2) return null;
  if (typeof value.resultJsonHash !== "string" || !/^[a-f0-9]{64}$/.test(value.resultJsonHash)) return null;
  if (typeof value.updatedAt !== "string" || !value.updatedAt) return null;
  const parsed = new Date(value.updatedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return { resultJsonHash: value.resultJsonHash, updatedAt: parsed.toISOString() };
}

function parseAsin(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Z0-9]{10}$/.test(value)) return null;
  return value;
}

function getAuth(req: NextRequest, id: string) {
  if (isSandboxTaskId(id) || id.startsWith("demo-") || id.startsWith("sandbox-")) {
    const auth = requireAuthenticated(req, {});
    if (!auth.ok) {
      return { ctx: null, error: errorResponse(auth.status, auth.code, auth.message) };
    }
    if (auth.context.mode !== "demo") {
      return { ctx: null, error: errorResponse(404, "task_not_found", "未找到该任务。") };
    }
    return { ctx: auth.context, error: null };
  }
  const auth = requireOwnerOnly(req, {});
  if (!auth.ok) {
    return { ctx: null, error: errorResponse(auth.status, auth.code, auth.message) };
  }
  return { ctx: auth.context, error: null };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id?: string }> },
) {
  const id = (await params).id;
  if (!id) return errorResponse(400, "missing_id", "缺少任务 ID。");

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return errorResponse(413, "request_too_large", "请求体过大。");
  }
  let rawBody: string;
  try {
    const buffer = await req.arrayBuffer();
    if (buffer.byteLength > MAX_BODY_BYTES) {
      return errorResponse(413, "request_too_large", "请求体过大。");
    }
    rawBody = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return errorResponse(400, "invalid_json", "请求格式无效。");
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, "invalid_json", "请求格式无效。");
  }
  if (!isRecord(body)) {
    return errorResponse(400, "invalid_json", "请求格式无效。");
  }
  const allowedTopLevel = new Set(["expectedStorageVersion", "asin"]);
  for (const key of Object.keys(body)) {
    if (!allowedTopLevel.has(key)) {
      return errorResponse(400, "unknown_field", `未知字段: ${key}`);
    }
  }

  const expectedStorageVersion = parseStorageVersion(body.expectedStorageVersion);
  if (!expectedStorageVersion) {
    return errorResponse(400, "invalid_storage_version", "缺少或无效的存储版本。");
  }
  const asin = parseAsin(body.asin);
  if (!asin) {
    return errorResponse(400, "invalid_asin", "ASIN 无效。");
  }

  const { ctx, error } = getAuth(req, id);
  if (error) return error;

  try {
    const result = await mutateTaskResultJson<{ imported: boolean; contentHash: string }>({
      context: ctx,
      taskId: id,
      writer: "visual-reference",
      expectedStorageVersion,
      async mutate(current) {
        // ── 1) 任务研究绑定 ──
        const record = getProductResearchRecord(current);
        const verification = getProductResearchVerification(current);
        if (!record || !verification) {
          throw new TaskResultJsonMutationError("task_not_found", 404, "任务不存在。");
        }
        if (record.candidateId !== verification.candidateId) {
          throw new TaskResultJsonMutationError("invalid_research_record", 409, "研究记录结构异常。");
        }

        // ── 2) 候选归属（Owner=DB / Visitor=Sandbox，跨身份 null）──
        const candidate = await getAuthoritativeCandidate(ctx, record.candidateId);
        if (!candidate) {
          throw new TaskResultJsonMutationError("task_not_found", 404, "任务不存在。");
        }
        if (candidate.convertedTaskId !== id) {
          throw new TaskResultJsonMutationError("task_not_found", 404, "任务不存在。");
        }

        // ── 3) URL 绑定校验：候选快照中的 imageUrl 是唯一授权来源 ──
        const meta = parseSellerSpriteCandidateSourceMeta(candidate.sourceMetaJson);
        if (!meta) {
          throw new TaskResultJsonMutationError("visual_reference_unavailable", 422, "商品参考图无法安全导入，可手动上传参考图。");
        }
        if (meta.identity.asin !== asin) {
          throw new TaskResultJsonMutationError("visual_reference_unavailable", 422, "商品参考图无法安全导入，可手动上传参考图。");
        }
        const sourceUrl = meta.snapshot.imageUrl;
        if (!sourceUrl || !sourceUrl.trim()) {
          throw new TaskResultJsonMutationError("visual_reference_unavailable", 422, "商品参考图无法安全导入，可手动上传参考图。");
        }

        // ── 4) 受控下载（外部 I/O 在 mutation 回调内执行；失败不阻断任务）──
        let fetched;
        try {
          fetched = await fetchSellerSpriteProductImage(sourceUrl);
        } catch {
          fetched = null;
        }
        if (!fetched) {
          throw new TaskResultJsonMutationError("visual_reference_unavailable", 422, "商品参考图无法安全导入，可手动上传参考图。");
        }
        const snapshot = buildSellerSpriteProductImageSnapshot({
          fetched,
          asin,
          capturedAt: new Date().toISOString(),
        });

        // ── 5) 已存在快照：同 hash → 幂等成功；异 hash → 拒绝（不覆盖既有资产）──
        const existing = isRecord(current.sourceMeta) && isRecord(current.sourceMeta.candidateSnapshot)
          ? current.sourceMeta.candidateSnapshot.productImageSnapshot
          : undefined;
        if (existing !== undefined) {
          const existingHash = isRecord(existing) && typeof existing.contentHash === "string"
            ? existing.contentHash
            : null;
          if (existingHash === snapshot.contentHash) {
            return { result: current, value: { imported: false, contentHash: snapshot.contentHash } };
          }
          throw new TaskResultJsonMutationError("visual_reference_conflict", 409, "商品参考图已存在且不一致。");
        }

        // ── 6) 原子写入：sourceMeta.candidateSnapshot.productImageSnapshot ──
        const nextSourceMeta = {
          ...(isRecord(current.sourceMeta) ? current.sourceMeta : {}),
          candidateSnapshot: {
            ...(isRecord(current.sourceMeta) && isRecord(current.sourceMeta.candidateSnapshot)
              ? current.sourceMeta.candidateSnapshot
              : { version: 1, id: candidate.id, name: candidate.name, status: candidate.status, capturedAt: new Date().toISOString() }),
            productImageSnapshot: snapshot,
          },
        };
        return {
          result: { ...current, sourceMeta: nextSourceMeta },
          value: { imported: true, contentHash: snapshot.contentHash },
        };
      },
    });

    return NextResponse.json({ ok: true, imported: result.value.imported, contentHash: result.value.contentHash });
  } catch (err) {
    if (err instanceof TaskResultJsonMutationError) {
      const code = err.code === "not_found" ? "task_not_found" : err.code;
      return errorResponse(err.status, code, err.message);
    }
    throw err;
  }
}
