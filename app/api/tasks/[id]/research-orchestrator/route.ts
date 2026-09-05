/**
 * 研究采集编排器 API 路由
 * POST /api/tasks/[id]/research-orchestrator
 * GET  /api/tasks/[id]/research-orchestrator (便捷只读 inspect)
 *
 * 请求体 Body (POST):
 * - { action: "inspect" }：只读状态检查，不触发任何采集
 * - { action: "orchestrate" }：触发采集编排（缺省默认）
 *
 * 响应契约：
 * - 始终返回统一规范：{ ok: true, data: ResearchOrchestratorResult }
 * - 错误信息均已脱敏，严禁泄漏 secret / token / raw exception stack
 * - 单源采集失败（如 SellerSprite 或 Amazon 竞品搜素超时）不返回 500，返回 200 OK 且 sources.keywordCompetitor.status = "failed"
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import type { AccessContext } from "@/lib/server/accessPassword";
import {
  orchestrateResearchCollection,
  ResearchOrchestratorError,
  sanitizeErrorMessage,
  type OrchestratorAction,
  type ResearchOrchestratorResult,
} from "@/lib/server/researchCollectionOrchestrator";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

async function getId(context: { params: Promise<{ id: string }> }): Promise<string | null> {
  try {
    const { id } = await context.params;
    return id || null;
  } catch {
    return null;
  }
}

async function resolveContext(
  request: NextRequest,
  taskId: string,
  bodyRecord?: Record<string, unknown>,
): Promise<{ ok: true; context: AccessContext } | { ok: false; response: NextResponse }> {
  if (isSandboxTaskId(taskId)) {
    const auth = requireAuthenticated(request, bodyRecord);
    if (!auth.ok) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: { code: auth.code, message: auth.message } },
          { status: auth.status },
        ),
      };
    }
    if (auth.context.mode !== "demo") {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: { code: "not_found", message: "未找到该任务。" } },
          { status: 404 },
        ),
      };
    }
    return { ok: true, context: auth.context };
  }
  const auth = requireOwnerOnly(request, bodyRecord);
  if (!auth.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: { code: auth.code, message: auth.message } },
        { status: auth.status },
      ),
    };
  }
  return { ok: true, context: auth.context };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const id = await getId(context);
  if (!id) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_id", message: "缺少有效 task id。" } },
      { status: 400 },
    );
  }
  const resolved = await resolveContext(request, id);
  if (!resolved.ok) return resolved.response;

  try {
    const result = await orchestrateResearchCollection({
      context: resolved.context,
      taskId: id,
      action: "inspect",
    });
    return NextResponse.json({ ok: true, data: result }, { status: 200 });
  } catch (error) {
    if (error instanceof ResearchOrchestratorError) {
      return NextResponse.json(
        { ok: false, error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { ok: false, error: { code: "server_error", message: sanitizeErrorMessage(error) } },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const id = await getId(context);
  if (!id) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_id", message: "缺少有效 task id。" } },
      { status: 400 },
    );
  }

  let bodyRecord: Record<string, unknown> = {};
  try {
    const body = await request.json();
    if (isRecord(body)) {
      bodyRecord = body;
    }
  } catch {
    // 允许空请求体，缺省使用默认参数
    bodyRecord = {};
  }

  const resolved = await resolveContext(request, id, bodyRecord);
  if (!resolved.ok) return resolved.response;

  // action 缺省时默认为 "orchestrate"
  const rawAction = asString(bodyRecord.action);
  let action: OrchestratorAction = "orchestrate";
  if (rawAction) {
    if (rawAction === "inspect" || rawAction === "orchestrate") {
      action = rawAction;
    } else {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "invalid_action",
            message: "非法的 action 操作，仅支持 'inspect' 或 'orchestrate'。",
          },
        },
        { status: 400 },
      );
    }
  }

  try {
    const result = await orchestrateResearchCollection({
      context: resolved.context,
      taskId: id,
      action,
    });
    return NextResponse.json({ ok: true, data: result }, { status: 200 });
  } catch (error) {
    if (error instanceof ResearchOrchestratorError) {
      return NextResponse.json(
        { ok: false, error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { ok: false, error: { code: "server_error", message: sanitizeErrorMessage(error) } },
      { status: 500 },
    );
  }
}
