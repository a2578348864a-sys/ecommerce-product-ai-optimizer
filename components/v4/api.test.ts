import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelRun,
  createRun,
  getEvents,
  getRun,
  listRuns,
  resumeRun,
  startRun,
  V4ApiError,
} from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("v4 api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listRuns GETs the list endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ runs: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await listRuns();
    expect(res.runs).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith("/api/v4/runs", expect.objectContaining({ cache: "no-store" }));
  });

  it("getRun GETs the detail endpoint with encoded runId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ run: {}, events: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await getRun("abc 123");
    expect(fetchMock).toHaveBeenCalledWith("/api/v4/runs/abc%20123", expect.anything());
  });

  it("createRun POSTs candidateId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ run: {} }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await createRun("cand_1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v4/runs",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ candidateId: "cand_1" }) }),
    );
  });

  it("startRun POSTs expectedRevision", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ run: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await startRun("run_1", 3);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v4/runs/run_1/start",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedRevision: 3 }) }),
    );
  });

  it("resumeRun POSTs expectedRevision and payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ run: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await resumeRun("run_1", 3, { kind: "human_decision", decision: "continue" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v4/runs/run_1/resume",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expectedRevision: 3, payload: { kind: "human_decision", decision: "continue" } }),
      }),
    );
  });

  it("cancelRun POSTs expectedRevision", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ run: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await cancelRun("run_1", 3);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v4/runs/run_1/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("getEvents GETs the events endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ events: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await getEvents("run_1");
    expect(fetchMock).toHaveBeenCalledWith("/api/v4/runs/run_1/events", expect.anything());
  });

  it("throws V4ApiError with latestRevision on 409 conflict", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ code: "REVISION_CONFLICT", latestRevision: 7 }, 409),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await resumeRun("run_1", 3, { kind: "retry" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(V4ApiError);
      const apiErr = err as V4ApiError;
      expect(apiErr.code).toBe("REVISION_CONFLICT");
      expect(apiErr.latestRevision).toBe(7);
      expect(apiErr.status).toBe(409);
    }
  });
});
