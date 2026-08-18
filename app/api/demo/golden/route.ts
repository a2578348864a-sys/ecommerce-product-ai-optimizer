/**
 * V3 UX Closure — Golden Demo 入口 API
 * GET /api/demo/golden  当前 Visitor 的 Golden Demo 副本（Lazy Seed：无则创建，幂等）
 *
 * 安全：demo 主体限定；seed 只写当前 demoAccessId 的 sandbox（不共享 Task、不动 credential/quota/private tasks）。
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { ensureVisitorDemoCopy, findVisitorDemoCopy } from "@/lib/server/goldenDemoTemplate";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = requireAuthenticated(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });
  }
  if (auth.context.mode !== "demo") {
    // Owner 无 Golden Demo（演示体验属 Visitor）；返回空（前端不展示推荐体验）
    return NextResponse.json({ ok: true, data: null });
  }
  try {
    const copy = await ensureVisitorDemoCopy(auth.context.demoAccessId);
    return NextResponse.json({
      ok: true,
      data: copy
        ? {
            taskId: copy.taskId,
            demoTemplateId: copy.demoTemplateId,
            demoTemplateVersion: copy.demoTemplateVersion,
            sourceProductKey: copy.sourceProductKey,
          }
        : null,
    });
  } catch (error) {
    console.error("[demo/golden] seed failed", {
      code: error instanceof Error ? error.message : "unknown",
      demoAccessId: auth.context.demoAccessId,
    });
    // seed 失败不阻断产品使用（降级：无推荐体验）
    const existing = await findVisitorDemoCopy(auth.context.demoAccessId).catch(() => null);
    return NextResponse.json({
      ok: true,
      data: existing
        ? {
            taskId: existing.taskId,
            demoTemplateId: existing.demoTemplateId,
            demoTemplateVersion: existing.demoTemplateVersion,
            sourceProductKey: existing.sourceProductKey,
          }
        : null,
    });
  }
}
