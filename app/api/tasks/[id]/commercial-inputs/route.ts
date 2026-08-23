import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getAccessContext, checkAccessPassword } from "@/lib/server/accessPassword";
import { getSandboxTask } from "@/lib/server/demoSandbox";
import { prisma } from "@/lib/server/db";
import { parseCommercialInputs, readCommercialInputs, type CommercialInputs } from "@/lib/server/commercialInputs";
import { taskResultWriterPersistence } from "@/lib/server/taskResultWriterServices";
import { getResearchStaleState } from "@/lib/productResearchRecord";

export const runtime = "nodejs";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function safeParse(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

async function loadOwnerTask(taskId: string) {
  return prisma.viralAnalysisRecord.findUnique({ where: { id: taskId } });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id?: string }> }) {
  const authError = checkAccessPassword(request);
  if (authError) return NextResponse.json(authError.body, { status: authError.status });
  const access = getAccessContext(request);
  if (!access) return json({ ok: false, error: { code: "invalid_access", message: "请先登录后再操作。" } }, 401);
  const { id } = await context.params;
  if (!id?.trim()) return json({ ok: false, error: { code: "invalid_id", message: "缺少任务 ID。" } }, 400);
  try {
    let resultJson: string | null = null;
    let updatedAt: Date | string | null = null;
    if (access.mode === "demo") {
      const task = getSandboxTask(access.demoAccessId, id);
      resultJson = task?.resultJson ?? null;
      updatedAt = task?.updatedAt ?? null;
    } else {
      const task = await loadOwnerTask(id);
      resultJson = task?.resultJson ?? null;
      updatedAt = task?.updatedAt ?? null;
    }
    if (resultJson === null) return json({ ok: false, error: { code: "not_found", message: "任务不存在。" } }, 404);
    const result = safeParse(resultJson) ?? {};
    const inputs = readCommercialInputs(result);
    return json({
      ok: true,
      inputs,
      stale: getResearchStaleState(result).stale,
      storageVersion: {
        updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt ?? ""),
        resultJsonHash: createHash("sha256").update(resultJson, "utf8").digest("hex"),
      },
    });
  } catch {
    return json({ ok: false, error: { code: "server_error", message: "读取失败，请稍后重试。" } }, 500);
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id?: string }> }) {
  const authError = checkAccessPassword(request);
  if (authError) return NextResponse.json(authError.body, { status: authError.status });
  const access = getAccessContext(request);
  if (!access) return json({ ok: false, error: { code: "invalid_access", message: "请先登录后再操作。" } }, 401);
  const { id } = await context.params;
  if (!id?.trim()) return json({ ok: false, error: { code: "invalid_id", message: "缺少任务 ID。" } }, 400);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ ok: false, error: { code: "invalid_json", message: "请求体不是合法 JSON。" } }, 400); }
  const payload = body as { storageVersion?: unknown };
  const version = (typeof payload.storageVersion === "object" && payload.storageVersion !== null)
    ? payload.storageVersion as Record<string, unknown>
    : undefined;
  // 只校验资料字段（storageVersion 是并发控制元数据，不属于商业输入）
  const { storageVersion: _meta, ...inputsBody } = payload;
  const parsed = parseCommercialInputs(inputsBody);
  if (!parsed.ok) return json({ ok: false, error: { code: parsed.error, message: "资料校验失败。" } }, 400);
  try {
    const output = await taskResultWriterPersistence.persistCommercialInputs({
      context: access,
      taskId: id,
      inputs: parsed.inputs as unknown as Record<string, unknown>,
      expectedStorageVersion:
        version && typeof version.updatedAt === "string" && typeof version.resultJsonHash === "string"
          ? { updatedAt: version.updatedAt, resultJsonHash: version.resultJsonHash }
          : undefined,
    });
    const finalResult = safeParse(output.resultJson) ?? {};
    return json({
      ok: true,
      inputs: parsed.inputs as CommercialInputs,
      stale: getResearchStaleState(finalResult).stale,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/REVISION_CONFLICT|REVISION|conflict|task_result_conflict|已在其他页面更新/i.test(message)) {
      return json({ ok: false, error: { code: "revision_conflict", message: "资料已被其它保存更新，请刷新后重试。不做覆盖。" } }, 409);
    }
    return json({ ok: false, error: { code: "server_error", message: "保存失败：" + message.slice(0, 140) } }, 500);
  }
}
