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
  buildAiImageIdempotencyScopeHash,
  buildAiImageRequestHash,
  updateAiImageRequest,
} from "@/lib/server/aiImageDraftLedger";
import {
  cleanupAiImageTask,
  decodeAiImageBase64,
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
  | "image_request_conflict"
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
  | "image_ledger_failed"
  | "image_provider_untrusted_result_url"
  | "image_provider_result_dns_rejected"
  | "image_provider_result_redirect_rejected"
  | "image_provider_result_download_failed"
  | "image_provider_result_timeout"
  | "image_provider_result_too_large"
  | "image_provider_result_invalid_mime"
  | "image_provider_result_invalid_image"
  | "image_provider_incompatible_response";

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
const AI_IMAGE_REQUEST_STALE_MS = 30 * 60 * 1000;

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

function providerFailure(error: unknown): {
  code: AiImageServiceErrorCode;
  message: string;
  retryable: boolean;
  refundable: boolean;
  providerCostConsumed: boolean;
  failureStage: "provider_call" | "provider_response" | "asset_download" | "asset_validation";
} {
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
      image_provider_incompatible_response: "image_provider_incompatible_response",
      image_provider_untrusted_result_url: "image_provider_untrusted_result_url",
      image_provider_result_dns_rejected: "image_provider_result_dns_rejected",
      image_provider_result_redirect_rejected: "image_provider_result_redirect_rejected",
      image_provider_result_download_failed: "image_provider_result_download_failed",
      image_provider_result_timeout: "image_provider_result_timeout",
      image_provider_result_too_large: "image_provider_result_too_large",
      image_provider_result_invalid_mime: "image_provider_result_invalid_mime",
      image_provider_result_invalid_image: "image_provider_result_invalid_image",
    };
    const nonRefundableCodes = new Set<AiImageProviderError["code"]>([
      "content_blocked",
      "image_provider_untrusted_result_url",
      "image_provider_incompatible_response",
    ]);
    return {
      code: mapped[error.code],
      message: error.message,
      retryable: error.retryable,
      refundable: !error.providerCostConsumed && !nonRefundableCodes.has(error.code),
      providerCostConsumed: error.providerCostConsumed,
      failureStage: error.failureStage,
    };
  }
  return {
    code: "image_provider_error",
    message: "图片生成失败，请稍后重试。",
    retryable: false,
    refundable: true,
    providerCostConsumed: false,
    failureStage: "provider_call",
  };
}

async function callProviderOnce(provider: AiImageProvider, input: Parameters<AiImageProvider>[0]): Promise<AiImageProviderOutput> {
  return withProviderSlot(() => provider(input));
}

function duplicateResult(task: LoadedAiImageTask, requestHash: string, itemIds: string[]): AiImageServiceResult {
  const snapshot = extractAiImageDraftSnapshot(task.task.resultJson);
  const items = snapshot?.items.filter((item) => (
    item.requestKeyHash === requestHash && (itemIds.length === 0 || itemIds.includes(item.id))
  )) || [];
  if (!snapshot || items.length === 0) {
    return fail("image_request_already_failed", "该请求已有记录，但结果不可用，请使用新的请求重新生成。", false);
  }
  return { ok: true, data: { snapshot, items, duplicate: true, visitorAccess: null } };
}

function safeUpdateLedger(input: Parameters<typeof updateAiImageRequest>[0]): void {
  try {
    updateAiImageRequest(input);
  } catch {
    // The provider result and task snapshot are authoritative after persistence.
  }
}

function safeCommitVisitorQuota(task: LoadedAiImageTask, requestHash: string): DemoAccessSnapshot | null {
  try {
    return commitVisitorImageAiCalls(task.accessContext, requestHash);
  } catch {
    return null;
  }
}

function safeRefundVisitorQuota(task: LoadedAiImageTask, requestHash: string): DemoAccessSnapshot | null {
  try {
    return refundVisitorImageAiCalls(task.accessContext, requestHash);
  } catch {
    return null;
  }
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
  const requestIdentity = {
    accessMode: input.loadedTask.accessMode,
    accessScope,
    taskId: input.loadedTask.taskId,
    idempotencyKey: input.request.idempotencyKey,
  };
  const idempotencyScopeHash = buildAiImageIdempotencyScopeHash(requestIdentity);
  const requestHash = buildAiImageRequestHash({
    ...requestIdentity,
    imageType: input.request.imageType,
    count: input.request.count,
    additionalDirection: input.request.additionalDirection,
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
        idempotencyScopeHash,
        taskId: input.loadedTask.taskId,
        accessMode: input.loadedTask.accessMode,
        now: input.now,
      });
    } catch {
      return fail("image_ledger_failed", "图片请求账本不可用，本次没有调用 AI。", false);
    }
    if (!ledger.created) {
      if (ledger.conflict) {
        return fail("image_request_conflict", "同一请求标识不能用于不同的图片参数，请重新发起。", false);
      }
      if (ledger.entry.status === "committed") {
        const duplicate = duplicateResult(input.loadedTask, requestHash, ledger.entry.itemIds);
        if (duplicate.ok && input.loadedTask.accessMode === "visitor") {
          duplicate.data.visitorAccess = safeCommitVisitorQuota(input.loadedTask, requestHash);
        }
        return duplicate;
      }
      if (["reserved", "provider_called", "provider_result_received", "asset_ingested", "provider_succeeded", "stored"].includes(ledger.entry.status)) {
        const recovered = duplicateResult(input.loadedTask, requestHash, ledger.entry.itemIds);
        if (recovered.ok) {
          safeUpdateLedger({ requestHash, status: "committed", itemIds: recovered.data.items.map((item) => item.id), now: input.now });
          if (input.loadedTask.accessMode === "visitor") {
            recovered.data.visitorAccess = safeCommitVisitorQuota(input.loadedTask, requestHash);
          }
          return recovered;
        }
        const nowMs = Date.parse(input.now || new Date().toISOString());
        const updatedAtMs = Date.parse(ledger.entry.updatedAt);
        if (Number.isFinite(updatedAtMs) && nowMs - updatedAtMs >= AI_IMAGE_REQUEST_STALE_MS) {
          const costConsumed = ledger.entry.providerCostConsumed === true
            || ["provider_result_received", "asset_ingested", "provider_succeeded", "stored"].includes(ledger.entry.status);
          if (input.loadedTask.accessMode === "visitor") {
            if (costConsumed) safeCommitVisitorQuota(input.loadedTask, requestHash);
            else safeRefundVisitorQuota(input.loadedTask, requestHash);
          }
          safeUpdateLedger({
            requestHash,
            status: costConsumed ? "failed_after_provider_result" : "refunded",
            providerCostConsumed: costConsumed,
            failureStage: costConsumed ? "snapshot_persistence" : "provider_call",
            errorCode: "image_request_stale",
            now: input.now,
          });
          return fail("image_request_already_failed", costConsumed
            ? "上一次请求已在 Provider 返回结果后中断，额度已消耗，请使用新的请求标识重新发起。"
            : "上一次请求已中断且额度已恢复，请使用新的请求标识重新发起。", false);
        }
        return fail("image_request_in_progress", "同一请求正在处理中，请勿重复提交。", true);
      }
      return fail("image_request_already_failed", "同一请求已失败，请修改后使用新的请求标识。", false);
    }

    const reservation = reserveVisitorImageAiCalls(input.loadedTask.accessContext, requestHash, input.request.count);
    if (!reservation.ok) {
      safeUpdateLedger({ requestHash, status: "refunded", errorCode: reservation.code, now: input.now });
      return fail(reservation.code, reservation.message, false);
    }
    quotaReserved = input.loadedTask.accessMode === "visitor";

    safeUpdateLedger({
      requestHash,
      status: "provider_called",
      providerStage: "provider_called",
      now: input.now,
    });

    const prompt = buildAiImagePrompt({
      imageType: input.request.imageType,
      basis,
      additionalDirection: input.request.additionalDirection,
    });
    const promptHash = createHash("sha256").update(prompt).digest("hex");
    const provider = input.provider || getAiImageProvider();
    let providerResult: AiImageProviderOutput;
    let providerResultObserved = false;
    const markProviderResultReceived = () => {
      if (providerResultObserved) return;
      providerResultObserved = true;
      if (quotaReserved) safeCommitVisitorQuota(input.loadedTask, requestHash);
      safeUpdateLedger({
        requestHash,
        status: "provider_result_received",
        providerStage: "provider_result_received",
        providerCostConsumed: true,
        now: input.now,
      });
    };
    try {
      providerResult = await callProviderOnce(provider, {
        imageType: input.request.imageType,
        count: input.request.count,
        prompt,
        onResultReceived: markProviderResultReceived,
      });
    } catch (error) {
      const mapped = providerFailure(error);
      const providerCostConsumed = mapped.providerCostConsumed || providerResultObserved;
      const refundable = !providerCostConsumed && mapped.refundable;
      if (quotaReserved) {
        if (refundable) safeRefundVisitorQuota(input.loadedTask, requestHash);
        else safeCommitVisitorQuota(input.loadedTask, requestHash);
      }
      safeUpdateLedger({
        requestHash,
        status: providerCostConsumed
          ? "failed_after_provider_result"
          : refundable ? "refunded" : "failed_non_refundable",
        providerStage: providerCostConsumed ? "provider_result_received" : "provider_called",
        providerCostConsumed,
        failureStage: mapped.failureStage,
        errorCode: mapped.code,
        now: input.now,
      });
      return fail(mapped.code, mapped.message, mapped.retryable);
    }

    const providerCostConsumed = providerResult.images.length > 0;
    if (providerCostConsumed) markProviderResultReceived();
    if (providerResult.images.length !== input.request.count) {
      if (quotaReserved) {
        if (providerCostConsumed) safeCommitVisitorQuota(input.loadedTask, requestHash);
        else safeRefundVisitorQuota(input.loadedTask, requestHash);
      }
      safeUpdateLedger({
        requestHash,
        status: providerCostConsumed ? "failed_after_provider_result" : "refunded",
        providerStage: providerCostConsumed ? "provider_result_received" : "provider_called",
        providerCostConsumed,
        failureStage: providerCostConsumed ? "provider_response" : "provider_call",
        errorCode: "image_response_invalid",
        now: input.now,
      });
      return fail("image_response_invalid", providerCostConsumed
        ? "图片服务返回数量异常，Provider 调用已消耗。"
        : "图片服务没有返回候选结果，本次额度已返还。", true);
    }

    const createdAt = input.now || new Date().toISOString();
    const items: AiImageDraftItem[] = [];
    try {
      for (const image of providerResult.images) {
        const stored = await storeAiImage({
          accessMode: input.loadedTask.accessMode,
          visitorAccessId: input.loadedTask.visitorAccessId,
          taskId: input.loadedTask.taskId,
          bytes: decodeAiImageBase64(image.base64),
        });
        storedKeys.push(stored.storageKey);
        items.push({
          id: stored.id,
          imageType: input.request.imageType,
          model: providerResult.model,
          createdAt,
          storageKey: stored.storageKey,
          mimeType: stored.mimeType,
          requestedFormat: providerResult.requestedFormat || "webp",
          actualFormat: stored.mimeType === "image/png" ? "png" : stored.mimeType === "image/jpeg" ? "jpeg" : "webp",
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
    } catch (error) {
      await Promise.all(storedKeys.map((key) => deleteAiImage(key).catch(() => undefined)));
      const failureStage = error instanceof Error && error.message.startsWith("AI_IMAGE_")
        ? "asset_validation"
        : "asset_storage";
      if (quotaReserved) safeCommitVisitorQuota(input.loadedTask, requestHash);
      safeUpdateLedger({
        requestHash,
        status: "failed_after_provider_result",
        providerStage: "provider_result_received",
        providerCostConsumed: true,
        failureStage,
        errorCode: "image_storage_failed",
        now: input.now,
      });
      return fail("image_storage_failed", "图片保存或校验失败，Provider 调用已消耗。", true);
    }
    safeUpdateLedger({
      requestHash,
      status: "asset_ingested",
      providerStage: "asset_ingested",
      providerCostConsumed: true,
      itemIds: items.map((item) => item.id),
      now: input.now,
    });

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
      if (quotaReserved) safeCommitVisitorQuota(input.loadedTask, requestHash);
      safeUpdateLedger({
        requestHash,
        status: "failed_after_provider_result",
        providerStage: "asset_ingested",
        providerCostConsumed: true,
        failureStage: "snapshot_persistence",
        errorCode: "image_snapshot_save_failed",
        now: input.now,
      });
      return fail("image_snapshot_save_failed", "任务图片快照保存失败，Provider 调用已消耗。", true);
    }

    safeUpdateLedger({
      requestHash,
      status: "committed",
      providerStage: "completed",
      providerCostConsumed: true,
      itemIds: items.map((item) => item.id),
      now: input.now,
    });
    const visitorAccess = quotaReserved
      ? safeCommitVisitorQuota(input.loadedTask, requestHash) || reservation.snapshot
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
