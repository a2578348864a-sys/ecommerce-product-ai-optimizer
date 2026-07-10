import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createDemoAccess, getDemoAccessById, incrementDemoAiCalls, refundDemoAiImageCalls, reserveDemoAiImageCalls } from "@/lib/server/demoAccess";
import { generateAiImageDraft } from "@/lib/server/aiImageDraftService";
import { consumeDemoAiCalls, ensureDemoAiQuota } from "@/lib/server/demoGuard";
import { setRealAiImageEnabledForTests } from "@/lib/server/realAiImageGate";
import type { LoadedAiImageTask } from "@/lib/server/aiImageTaskAccess";
import type { AiImageProvider } from "@/lib/server/openaiImageClient";
import { createMockAiImageProvider } from "@/tests/helpers/mockAiImageProvider";

let root = "";

function ownerTask(taskId = `owner-${randomUUID()}`): LoadedAiImageTask {
  const task = {
    title: "Heated Gloves",
    materialText: "Heated gloves for outdoor use",
    level: "medium",
    oneLineSummary: "Battery facts require review",
    resultJson: JSON.stringify({ existingField: "preserved" }),
  };
  return {
    taskId,
    accessMode: "owner",
    accessContext: { mode: "owner", token: "owner-token" },
    task,
    persistResult: async (result) => { task.resultJson = JSON.stringify(result); },
  };
}

function visitorTask(accessId: string, taskId = `visitor-${randomUUID()}`): LoadedAiImageTask {
  const task = {
    title: "Heated Gloves",
    materialText: "Heated gloves for outdoor use",
    level: "medium",
    oneLineSummary: "Battery facts require review",
    resultJson: "{}",
  };
  return {
    taskId,
    accessMode: "visitor",
    visitorAccessId: accessId,
    accessContext: { mode: "demo", token: "visitor-token", demoAccessId: accessId, isActive: true, isExpired: false, remainingAiCalls: 5 },
    task,
    persistResult: async (result) => { task.resultJson = JSON.stringify(result); },
  };
}

function request(count: 1 | 2 = 1) {
  return { imageType: "white_background_concept" as const, count, confirmed: true as const, idempotencyKey: randomUUID() };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ai-image-service-"));
  process.env.AI_IMAGE_DRAFT_STORAGE_ROOT = join(root, "images");
  process.env.AI_IMAGE_DRAFT_LEDGER_PATH = join(root, "ledger.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(root, "visitor-access.json");
  setRealAiImageEnabledForTests(true);
});

afterEach(() => {
  setRealAiImageEnabledForTests(false);
  delete process.env.AI_IMAGE_DRAFT_STORAGE_ROOT;
  delete process.env.AI_IMAGE_DRAFT_LEDGER_PATH;
  delete process.env.DEMO_ACCESS_STORE_PATH;
  rmSync(root, { recursive: true, force: true });
});

describe("AI image draft service", () => {
  it("saves owner results, preserves task data, and returns the committed result for the same idempotency key", async () => {
    const loadedTask = ownerTask();
    const provider = createMockAiImageProvider("success");
    const generateRequest = request(2);
    const first = await generateAiImageDraft({ loadedTask, request: generateRequest, provider });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.items).toHaveLength(2);
    expect(first.data.snapshot.items).toHaveLength(2);
    expect(JSON.parse(loadedTask.task.resultJson).existingField).toBe("preserved");
    expect(JSON.stringify(first.data.snapshot)).not.toContain("base64");

    let duplicateCalls = 0;
    const duplicate = await generateAiImageDraft({ loadedTask, request: generateRequest, provider: createMockAiImageProvider("success", () => { duplicateCalls += 1; }) });
    expect(duplicate).toMatchObject({ ok: true, data: { duplicate: true } });
    expect(duplicateCalls).toBe(0);
  });

  it.each([
    ["rate_limited", "image_provider_rate_limited"],
    ["server_error", "image_provider_unavailable"],
    ["timeout", "image_provider_timeout"],
    ["empty", "image_response_invalid"],
  ] as const)("retries %s once and returns a refundable error", async (scenario, expectedCode) => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 5 });
    let calls = 0;
    const result = await generateAiImageDraft({
      loadedTask: visitorTask(record.id),
      request: request(),
      provider: createMockAiImageProvider(scenario, () => { calls += 1; }),
    });
    expect(result).toMatchObject({ ok: false, error: { code: expectedCode } });
    expect(calls).toBe(2);
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(0);
  });

  it("does not retry content blocks and keeps the visitor call charged", async () => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 5 });
    let calls = 0;
    const result = await generateAiImageDraft({
      loadedTask: visitorTask(record.id),
      request: request(),
      provider: createMockAiImageProvider("content_blocked", () => { calls += 1; }),
    });
    expect(result).toMatchObject({ ok: false, error: { code: "image_content_blocked" } });
    expect(calls).toBe(1);
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(1);
  });

  it.each([
    ["invalid_base64", "image_storage_failed"],
    ["non_image", "image_storage_failed"],
    ["too_large", "image_storage_failed"],
    ["count_mismatch", "image_response_invalid"],
  ] as const)("rejects the %s mock response and refunds visitor quota", async (scenario, expectedCode) => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 5 });
    const result = await generateAiImageDraft({ loadedTask: visitorTask(record.id), request: request(), provider: createMockAiImageProvider(scenario) });
    expect(result).toMatchObject({ ok: false, error: { code: expectedCode } });
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(0);
  });

  it("atomically precharges one shared visitor call under concurrent requests", async () => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 1 });
    let calls = 0;
    const slowProvider: AiImageProvider = async (input) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return createMockAiImageProvider("success")(input);
    };
    const [first, second] = await Promise.all([
      generateAiImageDraft({ loadedTask: visitorTask(record.id), request: request(), provider: slowProvider }),
      generateAiImageDraft({ loadedTask: visitorTask(record.id), request: request(), provider: slowProvider }),
    ]);
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect([first, second].find((result) => !result.ok)).toMatchObject({ ok: false, error: { code: "visitor_ai_quota_exceeded" } });
    expect(calls).toBe(1);
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(1);
  });

  it("shares the existing counter with prior text AI use and refuses calls after the fifth use", async () => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 5 });
    incrementDemoAiCalls(record.id, 4);
    const first = await generateAiImageDraft({ loadedTask: visitorTask(record.id), request: request(), provider: createMockAiImageProvider("success") });
    expect(first.ok).toBe(true);
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(5);
    const blocked = await generateAiImageDraft({ loadedTask: visitorTask(record.id), request: request(), provider: createMockAiImageProvider("success") });
    expect(blocked).toMatchObject({ ok: false, error: { code: "visitor_ai_quota_exceeded" } });
  });

  it("does not let text and image requests both pass the final shared call", async () => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 1 });
    const textContext = { mode: "demo" as const, token: "visitor-token", demoAccessId: record.id, isActive: true, isExpired: false, remainingAiCalls: 1 };
    expect(ensureDemoAiQuota(textContext, 1)).toEqual({ ok: true });
    let imageCalls = 0;
    const imageResult = await generateAiImageDraft({
      loadedTask: visitorTask(record.id),
      request: request(),
      provider: createMockAiImageProvider("success", () => { imageCalls += 1; }),
    });
    expect(imageResult).toMatchObject({ ok: false, error: { code: "visitor_ai_quota_exceeded" } });
    expect(imageCalls).toBe(0);
    expect(consumeDemoAiCalls(textContext, 1)?.usedAiCalls).toBe(1);
  });

  it("makes reservation refunds idempotent", () => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 5 });
    const reservationHash = "f".repeat(64);
    expect(reserveDemoAiImageCalls(record.id, reservationHash, 1).ok).toBe(true);
    refundDemoAiImageCalls(record.id, reservationHash);
    refundDemoAiImageCalls(record.id, reservationHash);
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(0);
  });

  it("serializes provider work globally and rejects simultaneous work on the same task", async () => {
    let active = 0;
    let maxActive = 0;
    const provider: AiImageProvider = async (input) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return createMockAiImageProvider("success")(input);
    };
    const taskA = ownerTask();
    const taskB = ownerTask();
    const firstPromise = generateAiImageDraft({ loadedTask: taskA, request: request(), provider });
    const sameTask = await generateAiImageDraft({ loadedTask: taskA, request: request(), provider });
    const differentTask = generateAiImageDraft({ loadedTask: taskB, request: request(), provider });
    expect(sameTask).toMatchObject({ ok: false, error: { code: "image_request_in_progress" } });
    await Promise.all([firstPromise, differentTask]);
    expect(maxActive).toBe(1);
  });

  it("fails before provider access when the real image gate is off", async () => {
    setRealAiImageEnabledForTests(false);
    let calls = 0;
    const result = await generateAiImageDraft({ loadedTask: ownerTask(), request: request(), provider: createMockAiImageProvider("success", () => { calls += 1; }) });
    expect(result).toMatchObject({ ok: false, error: { code: "real_ai_disabled" } });
    expect(calls).toBe(0);
  });

  it("does not write a success snapshot and removes stored files when task persistence fails", async () => {
    const loadedTask = ownerTask();
    const original = loadedTask.task.resultJson;
    loadedTask.persistResult = async () => { throw new Error("test persistence failure"); };
    const result = await generateAiImageDraft({ loadedTask, request: request(), provider: createMockAiImageProvider("success") });
    expect(result).toMatchObject({ ok: false, error: { code: "image_snapshot_save_failed" } });
    expect(loadedTask.task.resultJson).toBe(original);
    const imageRoot = process.env.AI_IMAGE_DRAFT_STORAGE_ROOT!;
    const files = existsSync(imageRoot)
      ? readdirSync(imageRoot, { recursive: true }).filter((name) => String(name).endsWith(".png"))
      : [];
    expect(files).toHaveLength(0);
  });

  it("refuses empty task context before provider access", async () => {
    const loadedTask = ownerTask();
    loadedTask.task.title = "";
    loadedTask.task.materialText = "";
    let calls = 0;
    const result = await generateAiImageDraft({ loadedTask, request: request(), provider: createMockAiImageProvider("success", () => { calls += 1; }) });
    expect(result).toMatchObject({ ok: false, error: { code: "missing_task_context" } });
    expect(calls).toBe(0);
  });
});
