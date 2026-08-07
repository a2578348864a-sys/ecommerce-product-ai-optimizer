import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticated } from "@/lib/server/demoGuard";
import { getProductBatchStore } from "@/lib/server/productBatchStoreResolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

function validId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function sameOrigin(request: NextRequest): boolean {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  let expected = url.origin;
  if (host !== null) {
    try {
      expected = new URL(`${url.protocol}//${host}`).origin;
    } catch {
      return false;
    }
  }
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === expected;
  const referer = request.headers.get("referer");
  try {
    return referer !== null && new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

function storeError(error: unknown) {
  const code = error instanceof Error && "code" in error
    ? String((error as { code: unknown }).code)
    : "product_batch_internal_error";
  const status = code === "batch_not_found"
    || code === "batch_item_not_found"
    ? 404
    : code === "batch_is_active"
      || code === "batch_status_transition_forbidden"
      || code === "batch_not_activatable"
      ? 409
      : 500;
  const message = code === "batch_not_found" || code === "batch_item_not_found"
    ? "批次不存在或已被移除。"
    : code === "batch_status_transition_forbidden"
      ? "当前批次状态不支持该操作，请先刷新批次列表后再试。"
      : code === "batch_not_activatable"
        ? "只有已完成导入的批次才能设置为当前批次。"
        : code === "batch_is_active"
          ? "该批次是当前批次，取消当前状态后才能执行该操作。"
          : "商品批次操作失败，请稍后重试。";
  return errorResponse(status, code, message);
}

export async function GET(request: NextRequest, context: Context) {
  const auth = requireAuthenticated(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);
  const { id } = await context.params;
  if (!validId(id)) return errorResponse(404, "batch_not_found", "批次不存在。");
  try {
    const store = getProductBatchStore(auth.context);
    const batch = await store.getBatch(id);
    if (!batch) return errorResponse(404, "batch_not_found", "批次不存在。");
    const items = await store.getBatchItems(id);
    return NextResponse.json({ ok: true, data: { batch, items } });
  } catch (error) {
    return storeError(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const auth = requireAuthenticated(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);
  if (!sameOrigin(request)) {
    return errorResponse(403, "origin_not_allowed", "请求来源不受信任。");
  }
  const { id } = await context.params;
  if (!validId(id)) return errorResponse(404, "batch_not_found", "批次不存在。");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_request", "请求内容无效。");
  }
  if (
    typeof body !== "object"
    || body === null
    || Array.isArray(body)
    || !(
      (body as { action?: unknown }).action === "activate"
      || (body as { action?: unknown }).action === "archive"
      || (body as { action?: unknown }).action === "removeItem"
    )
  ) {
    return errorResponse(400, "invalid_action", "批次操作无效。");
  }
  const action = (body as { action: string }).action;
  if (action === "removeItem") {
    const keys = Object.keys(body).sort();
    if (keys.length !== 2 || keys[0] !== "action" || keys[1] !== "itemId") {
      return errorResponse(400, "invalid_action", "批次操作无效。");
    }
  } else if (Object.keys(body).length !== 1) {
    return errorResponse(400, "invalid_action", "批次操作无效。");
  }
  try {
    const store = getProductBatchStore(auth.context);
    const existing = await store.getBatch(id);
    if (!existing) return errorResponse(404, "batch_not_found", "批次不存在。");
    if (action === "activate") {
      const selection = await store.activateBatch(id);
      return NextResponse.json({ ok: true, data: { selection } });
    }
    if (action === "removeItem") {
      const itemId = (body as { itemId?: unknown }).itemId;
      if (typeof itemId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(itemId)) {
        return errorResponse(400, "invalid_item_id", "商品条目标识无效。");
      }
      const result = await store.removeBatchItem(id, itemId);
      return NextResponse.json({ ok: true, data: result });
    }
    const batch = await store.archiveBatch(id);
    return NextResponse.json({ ok: true, data: { batch } });
  } catch (error) {
    return storeError(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const auth = requireAuthenticated(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);
  if (!sameOrigin(request)) {
    return errorResponse(403, "origin_not_allowed", "请求来源不受信任。");
  }
  const { id } = await context.params;
  if (!validId(id)) return errorResponse(404, "batch_not_found", "批次不存在。");
  try {
    const store = getProductBatchStore(auth.context);
    const existing = await store.getBatch(id);
    if (!existing) return errorResponse(404, "batch_not_found", "批次不存在。");
    const result = await store.deleteBatch(id);
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    return storeError(error);
  }
}
