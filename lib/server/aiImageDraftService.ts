import "server-only";

import { createHash } from "node:crypto";
import {
  buildAiImageGenerationBasis,
  buildAiImagePrompt,
  buildAiImagePromptSummary,
  extractAiImageDraftSnapshot,
  mergeAiImageDraftSnapshot,
  type AiImageDraftItem,
  type AiImageDraftSnapshot,
  type AiImageGenerateRequest,
} from "@/lib/aiImageDraft";
import {
  beginAiImageRequest,
  buildAiImageRequestHash,
  updateAiImageRequest,
} from "@/lib/server/aiImageDraftLedger";
import {
  cleanupAiImageTask,
  deleteAiImage,
  storeAiImage,
} from "@/lib/server/aiImageDraftStorage";
import {
  commitVisitorImageAiCalls,
  reserveVisitorImageAiCalls,
  refundVisitorImageAiCalls,
  type DemoAccessSnapshot,
} from "@/lib/server/demoGuard";
import {
  AiImageProviderError,
  getAiImageProvider,
  type AiImageProvider,
  type AiImageProviderOutput,
} from "@/lib/server/openaiImageClient";
import { isRealAiImageEnabled } from "@/lib/server/realAiImageGate";
import type { LoadedAiImageTask } from "@/lib/server/aiImageTaskAccess";

export type AiImageServiceErrorCode =
  | "real_ai_disabled"
  | "missing_task_context"
  | "image_request_in_progress"
  | "image_request_already_failed"
  | "visitor_ai_quota_exceeded"
  | "image_provider_timeout"
  | "image_provider_rate_limited"
  | "image_provider_unavailable"
  | "image_content_blocked"
  | "image_provider_error"
  | "image_response_invalid"
  | "image_storage_failed"
  | "image_snapshot_save_failed"
  | "image_ledger_failed";

export type AiImageServiceResult =
  | {
      ok: true;
      data: {
        snapshot: AiImageDraftSnapshot;
        items: AiImageDraftItem[];
        duplicate: boolean;
        visitorAccess: DemoAccessSnapshot | null;
      };
    }
  | { ok: false; error: { code: AiImageServiceErrorCode | string; message: string; retryable: boolean } };

const inFlightTasks = new Set<string>();
let providerTail: Promise<void> = Promise.resolve();

async function withProviderSlot<T>(operation: () => Promise<T>): Promise<T> {
  const previous = providerTail;
  let release: () => void = () => {};
  providerTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function fail(code: AiImageServiceErrorCode | string, message: string, retryable = false): AiImageServiceResult {
  return { ok: false, error: { code, message, retryable } };
}

function decodeBase64(value: string): Buffer {
  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new Error("INVALID_BASE64");
  }
  const bytes = Buffer.from(compact, "base64");
  if (!bytes.length) throw new Error("EMPTY_BASE64");
  return bytes;
}

function providerFailure(error: unknown): { code: AiImageServiceErrorCode; message: string; retryable: boolean; refundable: boolean } {
  if (error instanceof AiImageProviderError) {
    const mapped: Record<AiImageProviderError["code"], AiImageServiceErrorCode> = {
      timeout: "image_provider_timeout",
      rate_limited: "image_provider_rate_limited",
      provider_unavailable: "image_provider_unavailable",
      content_blocked: "image_content_blocked",
      invalid_request: "image_provider_error",
      empty_response: "image_response_invalid",
      configuration_error: "image_provider_error",
      provider_error: "image_provider_error",
    };
    return {
      code: mapped[error.code],
      message: error.message,
      retryable: error.retryable,
      refundable: error.code !== "content_blocked",
    };
  }
  return { code: "image_provider_error", message: "图片生成失败，请稍后重试。", retryable: false, refundable: true };
}

async function callProviderWithSingleRetry(provider: AiImageProvider, input: Parameters<AiImageProvider>[0]): Promise<AiImageProviderOutput> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await withProviderSlot(() => provider(input));
    } catch (error) {
      if (!(error instanceof AiImageProviderError) || !error.retryable || attempt === 1) throw error;
      if (process.env.NODE_ENV !== "test") await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("UNREACHABLE_PROVIDER_RETRY");
}

function duplicateResult(task: LoadedAiImageTask, requestHash: string, itemIds: string[]): AiImageServiceResult {
  const snapshot = extractAiImageDraftSnapshot(task.task.resultJson);
  const items = snapshot?.items.filter((item) => item.requestKeyHash === requestHash && itemIds.includes(item.id)) || [];
  if (!snapshot || items.length === 0) {
    return fail("image_request_already_failed", "该请求已有记录，但结果不可用，请使用新的请求重新生成。", false);
  }
  return { ok: true, data: { snapshot, items, duplicate: true, visitorAccess: null } };
}

export async function generateAiImageDraft(input: {
  loadedTask: LoadedAiImageTask;
  request: AiImageGenerateRequest;
  provider?: AiImageProvider;
  now?: string;
}): Promise<AiImageServiceResult> {
  if (!isRealAiImageEnabled()) return fail("real_ai_disabled", "真实 AI 图片生成暂未开启，本次没有消耗额度。", false);
  const basis = buildAiImageGenerationBasis(input.loadedTask.task);
  if (!basis.productName) return fail("missing_task_context", "当前任务信息不足，无法生成图片草稿。", false);

  const accessScope = input.loadedTask.accessMode === "owner" ? "owner" : input.loadedTask.visitorAccessId || "";
  const requestHash = buildAiImageRequestHash({
    accessMode: input.loadedTask.accessMode,
    accessScope,
    taskId: input.loadedTask.taskId,
    idempotencyKey: input.request.idempotencyKey,
  });
  const taskLockKey = `${input.loadedTask.accessMode}:${accessScope}:${input.loadedTask.taskId}`;
  if (inFlightTasks.has(taskLockKey)) return fail("image_request_in_progress", "当前任务已有图片正在生成，请稍候。", true);
  inFlightTasks.add(taskLockKey);

  let storedKeys: string[] = [];
  let quotaReserved = false;
  try {
    let ledger;
    try {
      ledger = beginAiImageRequest({
        requestHash,
        taskId: input.loadedTask.taskId,
        accessMode: input.loadedTask.accessMode,
        now: input.now,
      });
    } catch {
      return fail("image_ledger_failed", "图片请求账本不可用，本次没有调用 AI。", false);
    }
    if (!ledger.created) {
      if (ledger.entry.status === "committed") return duplicateResult(input.loadedTask, requestHash, ledger.entry.itemIds);
      if (["reserved", "provider_succeeded", "stored"].includes(ledger.entry.status)) {
        return fail("image_request_in_progress", "同一请求正在处理中，请勿重复提交。", true);
      }
      return fail("image_request_already_failed", "同一请求已失败，请修改后使用新的请求标识。", false);
    }

    const reservation = reserveVisitorImageAiCalls(input.loadedTask.accessContext, requestHash, input.request.count);
    if (!reservation.ok) {
      updateAiImageRequest({ requestHash, status: "refunded", errorCode: reservation.code, now: input.now });
      return fail(reservation.code, reservation.message, false);
    }
    quotaReserved = input.loadedTask.accessMode === "visitor";

    const prompt = buildAiImagePrompt({
      imageType: input.request.imageType,
      basis,
      additionalDirection: input.request.additionalDirection,
    });
    const promptHash = createHash("sha256").update(prompt).digest("hex");
    const provider = input.provider || getAiImageProvider();
    let providerResult: AiImageProviderOutput;
    try {
      providerResult = await callProviderWithSingleRetry(provider, {
        imageType: input.request.imageType,
        count: input.request.count,
        prompt,
      });
    } catch (error) {
      const mapped = providerFailure(error);
      if (mapped.refundable && quotaReserved) refundVisitorImageAiCalls(input.loadedTask.accessContext, requestHash);
      if (!mapped.refundable && quotaReserved) commitVisitorImageAiCalls(input.loadedTask.accessContext, requestHash);
      updateAiImageRequest({
        requestHash,
        status: mapped.refundable ? "refunded" : "failed_non_refundable",
        errorCode: mapped.code,
        now: input.now,
      });
      return fail(mapped.code, mapped.message, mapped.retryable);
    }

    if (providerResult.images.length !== input.request.count) {
      if (quotaReserved) refundVisitorImageAiCalls(input.loadedTask.accessContext, requestHash);
      updateAiImageRequest({ requestHash, status: "refunded", errorCode: "image_response_invalid", now: input.now });
      return fail("image_response_invalid", "图片服务返回数量异常，本次额度已返还。", true);
    }
    updateAiImageRequest({ requestHash, status: "provider_succeeded", now: input.now });

    const createdAt = input.now || new Date().toISOString();
    const items: AiImageDraftItem[] = [];
    try {
      for (const image of providerResult.images) {
        const stored = await storeAiImage({
          accessMode: input.loadedTask.accessMode,
          visitorAccessId: input.loadedTask.visitorAccessId,
          taskId: input.loadedTask.taskId,
          bytes: decodeBase64(image.base64),
        });
        storedKeys.push(stored.storageKey);
        items.push({
          id: stored.id,
          imageType: input.request.imageType,
          model: providerResult.model,
          createdAt,
          storageKey: stored.storageKey,
          mimeType: stored.mimeType,
          width: stored.width,
          height: stored.height,
          fileSizeBytes: stored.fileSizeBytes,
          sha256: stored.sha256,
          reviewStatus: "needs_human_review",
          accessMode: input.loadedTask.accessMode,
          source: "real_ai_image_draft",
          safetyWarnings: [
            "概念草稿，不代表真实商品实拍。",
            "尺寸、材质、颜色、认证和功能必须人工复核。",
          ],
          promptSummary: buildAiImagePromptSummary(basis, input.request.imageType),
          promptHash,
          requestKeyHash: requestHash,
          providerRequestId: providerResult.requestId,
          generationBasis: basis,
        });
      }
    } catch {
      await Promise.all(storedKeys.map((key) => deleteAiImage(key).catch(() => undefined)));
      if (quotaReserved) refundVisitorImageAiCalls(input.loadedTask.accessContext, requestHash);
      updateAiImageRequest({ requestHash, status: "refunded", errorCode: "image_storage_failed", now: input.now });
      return fail("image_storage_failed", "图片保存失败，本次额度已返还。", true);
    }
    updateAiImageRequest({ requestHash, status: "stored", itemIds: items.map((item) => item.id), now: input.now });

    const merged = mergeAiImageDraftSnapshot({
      resultJson: input.loadedTask.task.resultJson,
      accessMode: input.loadedTask.accessMode,
      items,
      updatedAt: createdAt,
    });
    try {
      await input.loadedTask.persistResult(merged.result);
    } catch {
      await Promise.all(storedKeys.map((key) => deleteAiImage(key).catch(() => undefined)));
      if (quotaReserved) refundVisitorImageAiCalls(input.loadedTask.accessContext, requestHash);
      updateAiImageRequest({ requestHash, status: "refunded", errorCode: "image_snapshot_save_failed", now: input.now });
      return fail("image_snapshot_save_failed", "任务图片快照保存失败，本次额度已返还。", true);
    }

    updateAiImageRequest({ requestHash, status: "committed", itemIds: items.map((item) => item.id), now: input.now });
    const visitorAccess = quotaReserved
      ? commitVisitorImageAiCalls(input.loadedTask.accessContext, requestHash)
      : null;
    return { ok: true, data: { snapshot: merged.snapshot, items, duplicate: false, visitorAccess } };
  } finally {
    inFlightTasks.delete(taskLockKey);
  }
}

export async function cleanupAiImageDraftsForTask(task: LoadedAiImageTask): Promise<void> {
  await cleanupAiImageTask({
    accessMode: task.accessMode,
    visitorAccessId: task.visitorAccessId,
    taskId: task.taskId,
  });
}
