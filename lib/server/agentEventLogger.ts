import "server-only";

import { prisma } from "@/lib/server/db";

export type AgentEventLevel = "info" | "warn" | "error";

export type AgentEventModule =
  | "agent"
  | "amazon"
  | "voc"
  | "1688"
  | "ai"
  | (string & {});

export interface AgentEventInput {
  taskId?: string | null;
  runId?: string | null;
  module: AgentEventModule;
  event: string;
  level: AgentEventLevel;
  message: string;
  metadata?: Record<string, unknown> | unknown;
}

export interface AgentEventRecord {
  id: string;
  createdAt: Date;
  taskId: string | null;
  runId: string | null;
  module: string;
  event: string;
  level: string;
  message: string;
  metadataJson: string;
}

export interface QueryAgentEventsOptions {
  taskId?: string;
  runId?: string;
  module?: string;
  level?: string;
  limit?: number;
  offset?: number;
}

export interface QueryAgentEventsResult {
  events: AgentEventRecord[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * 核心业务事件记录器。
 * 遵循严格的 Fail-Open 原则：若数据库写入失败，仅输出告警日志，绝不抛出异常阻断业务流程。
 */
export async function logAgentEvent(input: AgentEventInput): Promise<boolean> {
  try {
    let metadataJson = "{}";
    if (input.metadata !== undefined && input.metadata !== null) {
      try {
        metadataJson =
          typeof input.metadata === "string"
            ? input.metadata
            : JSON.stringify(input.metadata);
      } catch {
        metadataJson = JSON.stringify({ error: "metadata_serialization_failed" });
      }
    }

    await prisma.agentEvent.create({
      data: {
        taskId: input.taskId ? String(input.taskId).trim() : null,
        runId: input.runId ? String(input.runId).trim() : null,
        module: String(input.module).trim(),
        event: String(input.event).trim(),
        level: input.level,
        message: String(input.message).slice(0, 2000),
        metadataJson,
      },
    });
    return true;
  } catch (error) {
    // Fail-open: 日志写入异常绝不能影响业务主链
    console.warn(
      `[agentEventLogger] Failed to write event (${input.module}.${input.event}):`,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

export function logInfo(
  module: AgentEventModule,
  event: string,
  message: string,
  extra?: Omit<Partial<AgentEventInput>, "module" | "event" | "level" | "message">,
): Promise<boolean> {
  return logAgentEvent({
    module,
    event,
    level: "info",
    message,
    ...extra,
  });
}

export function logWarn(
  module: AgentEventModule,
  event: string,
  message: string,
  extra?: Omit<Partial<AgentEventInput>, "module" | "event" | "level" | "message">,
): Promise<boolean> {
  return logAgentEvent({
    module,
    event,
    level: "warn",
    message,
    ...extra,
  });
}

export function logError(
  module: AgentEventModule,
  event: string,
  message: string,
  extra?: Omit<Partial<AgentEventInput>, "module" | "event" | "level" | "message">,
): Promise<boolean> {
  return logAgentEvent({
    module,
    event,
    level: "error",
    message,
    ...extra,
  });
}

/**
 * 查询业务事件列表（只读支持）
 */
export async function queryAgentEvents(
  options: QueryAgentEventsOptions = {},
): Promise<QueryAgentEventsResult> {
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const offset = Math.max(Number(options.offset) || 0, 0);

  const where: Record<string, unknown> = {};
  if (options.taskId && options.taskId.trim()) {
    where.taskId = options.taskId.trim();
  }
  if (options.runId && options.runId.trim()) {
    where.runId = options.runId.trim();
  }
  if (options.module && options.module.trim()) {
    where.module = options.module.trim();
  }
  if (options.level && options.level.trim()) {
    where.level = options.level.trim();
  }

  try {
    const [events, total] = await Promise.all([
      prisma.agentEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.agentEvent.count({ where }),
    ]);

    return {
      events,
      total,
      limit,
      offset,
    };
  } catch (error) {
    console.error("[agentEventLogger] Failed to query events:", error);
    return {
      events: [],
      total: 0,
      limit,
      offset,
    };
  }
}
