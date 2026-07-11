import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createDemoAccess, getDemoAccessById, incrementDemoAiCalls, refundDemoAiImageCalls, reserveDemoAiImageCalls } from "@/lib/server/demoAccess";
import { beginAiImageRequest, buildAiImageIdempotencyScopeHash, buildAiImageRequestHash, getAiImageRequest } from "@/lib/server/aiImageDraftLedger";
import { generateAiImageDraft } from "@/lib/server/aiImageDraftService";
import { consumeDemoAiCalls, ensureDemoAiQuota } from "@/lib/server/demoGuard";
import { setRealAiImageEnabledForTests } from "@/lib/server/realAiImageGate";
import type { LoadedAiImageTask } from "@/lib/server/aiImageTaskAccess";
import type { AiImageProvider } from "@/lib/server/openaiImageClient";
import { AiImageProviderError } from "@/lib/server/openaiImageClient";
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
    let providerCalls = 0;
    const provider = createMockAiImageProvider("success", () => { providerCalls += 1; });
    const generateRequest = request(2);
    const first = await generateAiImageDraft({ loadedTask, request: generateRequest, provider });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.items).toHaveLength(2);
    expect(first.data.snapshot.items).toHaveLength(2);
    expect(first.data.items[0]).toMatchObject({ requestedFormat: "webp", actualFormat: "png", mimeType: "image/png" });
    expect(JSON.parse(loadedTask.task.resultJson).existingField).toBe("preserved");
    expect(JSON.stringify(first.data.snapshot)).not.toContain("base64");
    expect(providerCalls).toBe(1);

    const duplicate = await generateAiImageDraft({ loadedTask, request: generateRequest, provider });
    expect(duplicate).toMatchObject({ ok: true, data: { duplicate: true } });
    expect(providerCalls).toBe(1);
    if (!duplicate.ok) return;
    expect(duplicate.data.items.map((item) => item.storageKey)).toEqual(first.data.items.map((item) => item.storageKey));
    expect(duplicate.data.snapshot.items).toHaveLength(2);
  });

  it("does not call the provider, charge quota, or save another image for a duplicate visitor request", async () => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 5 });
    const loadedTask = visitorTask(record.id);
    const generateRequest = request();
    let calls = 0;
    const provider = createMockAiImageProvider("success", () => { calls += 1; });
    const first = await generateAiImageDraft({ loadedTask, request: generateRequest, provider });
    expect(first).toMatchObject({ ok: true, data: { duplicate: false } });
    expect(calls).toBe(1);
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(1);

    const duplicate = await generateAiImageDraft({ loadedTask, request: generateRequest, provider });
    expect(duplicate).toMatchObject({ ok: true, data: { duplicate: true } });
    expect(calls).toBe(1);
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(1);
    if (!duplicate.ok) return;
    expect(duplicate.data.snapshot.items).toHaveLength(1);
  });

  it("rejects reuse of one idempotency key with different request semantics", async () => {
    const loadedTask = ownerTask();
    const generateRequest = request();
    expect((await generateAiImageDraft({ loadedTask, request: generateRequest, provider: createMockAiImageProvider("success") })).ok).toBe(true);
    let calls = 0;
    const conflict = await generateAiImageDraft({
      loadedTask,
      request: { ...generateRequest, imageType: "lifestyle_scene" },
      provider: createMockAiImageProvider("success", () => { calls += 1; }),
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: "image_request_conflict" } });
    expect(calls).toBe(0);
  });

  it.each([
    ["rate_limited", "image_provider_rate_limited"],
    ["server_error", "image_provider_unavailable"],
    ["timeout", "image_provider_timeout"],
    ["network_error", "image_provider_error"],
    ["empty", "image_response_invalid"],
  ] as const)("calls the provider once for %s and returns a refundable error", async (scenario, expectedCode) => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 5 });
    const loadedTask = visitorTask(record.id);
    const generateRequest = request();
    let calls = 0;
    const result = await generateAiImageDraft({
      loadedTask,
      request: generateRequest,
      provider: createMockAiImageProvider(scenario, () => { calls += 1; }),
    });
    expect(result).toMatchObject({ ok: false, error: { code: expectedCode } });
    expect(result.ok ? "" : result.error.message).toMatch(/[\u4e00-\u9fff]/);
    expect(calls).toBe(1);
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(0);
    expect(loadedTask.task.resultJson).toBe("{}");
    expect(existsSync(process.env.AI_IMAGE_DRAFT_STORAGE_ROOT!)).toBe(false);
    const requestHash = buildAiImageRequestHash({
      accessMode: "visitor",
      accessScope: record.id,
      taskId: loadedTask.taskId,
      idempotencyKey: generateRequest.idempotencyKey,
      imageType: generateRequest.imageType,
      count: generateRequest.count,
    });
    expect(getAiImageRequest(requestHash)).toMatchObject({ status: "refunded", errorCode: expectedCode });

    const repeated = await generateAiImageDraft({
      loadedTask,
      request: generateRequest,
      provider: createMockAiImageProvider(scenario, () => { calls += 1; }),
    });
    expect(repeated).toMatchObject({ ok: false, error: { code: "image_request_already_failed" } });
    expect(calls).toBe(1);
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(0);
  });

  it("calls the provider once for content blocks and keeps the visitor call charged", async () => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 5 });
    const loadedTask = visitorTask(record.id);
    const generateRequest = request();
    let calls = 0;
    const result = await generateAiImageDraft({
      loadedTask,
      request: generateRequest,
      provider: createMockAiImageProvider("content_blocked", () => { calls += 1; }),
    });
    expect(result).toMatchObject({ ok: false, error: { code: "image_content_blocked" } });
    expect(result.ok ? "" : result.error.message).toMatch(/[\u4e00-\u9fff]/);
    expect(calls).toBe(1);
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(1);
    expect(loadedTask.task.resultJson).toBe("{}");
    expect(existsSync(process.env.AI_IMAGE_DRAFT_STORAGE_ROOT!)).toBe(false);
    const requestHash = buildAiImageRequestHash({
      accessMode: "visitor",
      accessScope: record.id,
      taskId: loadedTask.taskId,
      idempotencyKey: generateRequest.idempotencyKey,
      imageType: generateRequest.imageType,
      count: generateRequest.count,
    });
    expect(getAiImageRequest(requestHash)).toMatchObject({
      status: "failed_non_refundable",
      errorCode: "image_content_blocked",
    });

    const repeated = await generateAiImageDraft({
      loadedTask,
      request: generateRequest,
      provider: createMockAiImageProvider("content_blocked", () => { calls += 1; }),
    });
    expect(repeated).toMatchObject({ ok: false, error: { code: "image_request_already_failed" } });
    expect(calls).toBe(1);
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(1);
  });

  it.each([
    ["invalid_base64", "image_storage_failed"],
    ["non_image", "image_storage_failed"],
    ["too_large", "image_storage_failed"],
  ] as const)("rejects the %s provider result without refunding consumed quota", async (scenario, expectedCode) => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 5 });
    const loadedTask = visitorTask(record.id);
    const generateRequest = request();
    const result = await generateAiImageDraft({ loadedTask, request: generateRequest, provider: createMockAiImageProvider(scenario) });
    expect(result).toMatchObject({ ok: false, error: { code: expectedCode } });
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(1);
    const requestHash = buildAiImageRequestHash({
      accessMode: "visitor",
      accessScope: record.id,
      taskId: loadedTask.taskId,
      idempotencyKey: generateRequest.idempotencyKey,
      imageType: generateRequest.imageType,
      count: generateRequest.count,
    });
    expect(getAiImageRequest(requestHash)).toMatchObject({
      status: "failed_after_provider_result",
      providerCostConsumed: true,
      failureStage: "asset_validation",
    });
  });

  it("refunds a count mismatch when the provider returned no candidate result", async () => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 5 });
    const result = await generateAiImageDraft({ loadedTask: visitorTask(record.id), request: request(), provider: createMockAiImageProvider("count_mismatch") });
    expect(result).toMatchObject({ ok: false, error: { code: "image_response_invalid" } });
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(0);
  });

  it("charges once when the provider returns a partial candidate batch", async () => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 5 });
    const loadedTask = visitorTask(record.id);
    const generateRequest = request();
    let calls = 0;
    const provider: AiImageProvider = async () => {
      calls += 1;
      return createMockAiImageProvider("success")({ imageType: "white_background_concept", count: 2, prompt: "safe" });
    };
    const result = await generateAiImageDraft({ loadedTask, request: generateRequest, provider });
    expect(result).toMatchObject({ ok: false, error: { code: "image_response_invalid" } });
    expect(calls).toBe(1);
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(1);
    const requestHash = buildAiImageRequestHash({
      accessMode: "visitor", accessScope: record.id, taskId: loadedTask.taskId,
      idempotencyKey: generateRequest.idempotencyKey, imageType: generateRequest.imageType, count: 1,
    });
    expect(getAiImageRequest(requestHash)).toMatchObject({
      status: "failed_after_provider_result",
      providerCostConsumed: true,
      failureStage: "provider_response",
    });
  });

  it("charges once and records asset_storage when private storage I/O fails", async () => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 5 });
    const loadedTask = visitorTask(record.id);
    const generateRequest = request();
    const blockedRoot = join(root, "blocked-storage-file");
    writeFileSync(blockedRoot, "not-a-directory", "utf8");
    process.env.AI_IMAGE_DRAFT_STORAGE_ROOT = blockedRoot;
    const result = await generateAiImageDraft({ loadedTask, request: generateRequest, provider: createMockAiImageProvider("success") });
    expect(result).toMatchObject({ ok: false, error: { code: "image_storage_failed" } });
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(1);
    const requestHash = buildAiImageRequestHash({
      accessMode: "visitor", accessScope: record.id, taskId: loadedTask.taskId,
      idempotencyKey: generateRequest.idempotencyKey, imageType: generateRequest.imageType, count: 1,
    });
    expect(getAiImageRequest(requestHash)).toMatchObject({
      status: "failed_after_provider_result",
      providerCostConsumed: true,
      failureStage: "asset_storage",
    });
  });

  it.each([
    ["image_provider_result_dns_rejected", "asset_download"],
    ["image_provider_result_download_failed", "asset_download"],
    ["image_provider_result_invalid_mime", "asset_validation"],
  ] as const)("does not refund after a relay candidate fails with %s", async (providerCode, failureStage) => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 5 });
    const loadedTask = visitorTask(record.id);
    const generateRequest = request();
    let calls = 0;
    const provider: AiImageProvider = async () => {
      calls += 1;
      throw Object.assign(new AiImageProviderError(providerCode, "图片后处理失败。", false), {
        providerCostConsumed: true,
        failureStage,
      });
    };
    const result = await generateAiImageDraft({ loadedTask, request: generateRequest, provider });
    expect(result).toMatchObject({ ok: false, error: { code: providerCode } });
    expect(calls).toBe(1);
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(1);
    const requestHash = buildAiImageRequestHash({
      accessMode: "visitor", accessScope: record.id, taskId: loadedTask.taskId,
      idempotencyKey: generateRequest.idempotencyKey, imageType: generateRequest.imageType, count: 1,
    });
    expect(getAiImageRequest(requestHash)).toMatchObject({
      status: "failed_after_provider_result",
      providerCostConsumed: true,
      failureStage,
    });
    const repeated = await generateAiImageDraft({ loadedTask, request: generateRequest, provider });
    expect(repeated).toMatchObject({ ok: false, error: { code: "image_request_already_failed" } });
    expect(calls).toBe(1);
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(1);
  });

  it("persists consumed cost as soon as the provider reports a candidate", async () => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 5 });
    const loadedTask = visitorTask(record.id);
    const generateRequest = request();
    let calls = 0;
    const provider: AiImageProvider = async (providerInput) => {
      calls += 1;
      providerInput.onResultReceived?.(1);
      throw new AiImageProviderError("provider_error", "connection ended after result", false);
    };
    const result = await generateAiImageDraft({ loadedTask, request: generateRequest, provider });
    expect(result).toMatchObject({ ok: false, error: { code: "image_provider_error" } });
    expect(calls).toBe(1);
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(1);
    const requestHash = buildAiImageRequestHash({
      accessMode: "visitor", accessScope: record.id, taskId: loadedTask.taskId,
      idempotencyKey: generateRequest.idempotencyKey, imageType: generateRequest.imageType, count: 1,
    });
    expect(getAiImageRequest(requestHash)).toMatchObject({
      status: "failed_after_provider_result",
      providerStage: "provider_result_received",
      providerCostConsumed: true,
    });
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

  it("recovers a stale interrupted request after a process restart boundary", async () => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 1 });
    const loadedTask = visitorTask(record.id, "visitor-stale-task");
    const generateRequest = request();
    const identity = {
      accessMode: "visitor" as const,
      accessScope: record.id,
      taskId: loadedTask.taskId,
      idempotencyKey: generateRequest.idempotencyKey,
    };
    const requestHash = buildAiImageRequestHash({ ...identity, imageType: generateRequest.imageType, count: generateRequest.count });
    beginAiImageRequest({
      requestHash,
      idempotencyScopeHash: buildAiImageIdempotencyScopeHash(identity),
      taskId: loadedTask.taskId,
      accessMode: "visitor",
      now: "2026-07-10T00:00:00.000Z",
    });
    expect(reserveDemoAiImageCalls(record.id, requestHash, 1).ok).toBe(true);
    let calls = 0;
    const recovered = await generateAiImageDraft({
      loadedTask,
      request: generateRequest,
      provider: createMockAiImageProvider("success", () => { calls += 1; }),
      now: "2026-07-10T00:31:00.000Z",
    });
    expect(recovered).toMatchObject({ ok: false, error: { code: "image_request_already_failed" } });
    expect(calls).toBe(0);
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

  it("charges a visitor once when snapshot persistence fails after a provider result", async () => {
    const { record } = createDemoAccess({ label: "Visitor", hours: 24, maxAiCalls: 5 });
    const loadedTask = visitorTask(record.id);
    const generateRequest = request();
    loadedTask.persistResult = async () => { throw new Error("test persistence failure"); };
    const result = await generateAiImageDraft({ loadedTask, request: generateRequest, provider: createMockAiImageProvider("success") });
    expect(result).toMatchObject({ ok: false, error: { code: "image_snapshot_save_failed" } });
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(1);
    const requestHash = buildAiImageRequestHash({
      accessMode: "visitor", accessScope: record.id, taskId: loadedTask.taskId,
      idempotencyKey: generateRequest.idempotencyKey, imageType: generateRequest.imageType, count: 1,
    });
    expect(getAiImageRequest(requestHash)).toMatchObject({
      status: "failed_after_provider_result",
      providerCostConsumed: true,
      failureStage: "snapshot_persistence",
    });
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
