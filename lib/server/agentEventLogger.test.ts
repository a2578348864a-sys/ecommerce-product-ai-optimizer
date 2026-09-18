import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  logAgentEvent,
  logInfo,
  logWarn,
  logError,
  queryAgentEvents,
} from "./agentEventLogger";
import { prisma } from "./db";

describe("agentEventLogger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should create agent event successfully with valid data", async () => {
    const createSpy = vi.spyOn(prisma.agentEvent, "create").mockResolvedValueOnce({
      id: "evt-123",
      createdAt: new Date(),
      taskId: "task-001",
      runId: null,
      module: "agent",
      event: "orchestration_started",
      level: "info",
      message: "Orchestration test",
      metadataJson: JSON.stringify({ test: true }),
    });

    const ok = await logInfo("agent", "orchestration_started", "Orchestration test", {
      taskId: "task-001",
      metadata: { test: true },
    });

    expect(ok).toBe(true);
    expect(createSpy).toHaveBeenCalledWith({
      data: {
        taskId: "task-001",
        runId: null,
        module: "agent",
        event: "orchestration_started",
        level: "info",
        message: "Orchestration test",
        metadataJson: JSON.stringify({ test: true }),
      },
    });
  });

  it("should fail open and return false without throwing when prisma throws", async () => {
    vi.spyOn(prisma.agentEvent, "create").mockRejectedValueOnce(new Error("DB disk I/O error"));
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    let errorThrown = false;
    let result = false;
    try {
      result = await logError("amazon", "collect_failed", "Network error", {
        taskId: "task-002",
      });
    } catch {
      errorThrown = true;
    }

    expect(errorThrown).toBe(false);
    expect(result).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  it("should query agent events with filters and bounds", async () => {
    const mockEvents = [
      {
        id: "evt-1",
        createdAt: new Date(),
        taskId: "task-001",
        runId: null,
        module: "amazon",
        event: "collect_started",
        level: "info",
        message: "started",
        metadataJson: "{}",
      },
    ];

    vi.spyOn(prisma.agentEvent, "findMany").mockResolvedValueOnce(mockEvents);
    vi.spyOn(prisma.agentEvent, "count").mockResolvedValueOnce(1);

    const result = await queryAgentEvents({
      taskId: "task-001",
      module: "amazon",
      level: "info",
      limit: 10,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.events.length).toBe(1);
    expect(result.events[0].id).toBe("evt-1");
  });
});
