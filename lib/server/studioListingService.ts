import "server-only";

import { createHash } from "node:crypto";
import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import type { AccessContext } from "@/lib/server/accessPassword";
import {
  generateRealAiListingDraft,
  type RealAiListingContext,
} from "@/lib/server/aiListingGenerator";
import {
  beginAiImageRequest,
  buildAiCallIdempotencyScopeHash,
  buildAiCallRequestHash,
  updateAiImageRequest,
  type AiImageLedgerEntry,
} from "@/lib/server/aiImageDraftLedger";
import {
  getLatestDemoSnapshot,
  markDemoAiProviderCallStarted,
  reserveDemoAiCalls,
  settleDemoAiCalls,
  type DemoAiQuotaReservation,
  type DemoAccessSnapshot,
} from "@/lib/server/demoGuard";
import {
  loadStudioListingResult,
  saveStudioListingResult,
} from "@/lib/server/studioListingResultStore";

type StudioListingSuccess = {
  ok: true;
  data: AiListingPackDraft;
  demoAccess: DemoAccessSnapshot | null;
  duplicate: boolean;
};

type StudioListingFailure = {
  ok: false;
  status: number;
  error: { code: string; message: string };
};

export type StudioListingResult = StudioListingSuccess | StudioListingFailure;

const inFlightScopes = new Set<string>();
const OPERATION = "studio-listing";
const STUDIO_LISTING_REQUEST_STALE_MS = 5 * 60 * 1_000;

function failure(status: number, code: string, message: string): StudioListingFailure {
  return { ok: false, status, error: { code, message } };
}

function providerErrorStatus(code: string) {
  return ["ai_timeout", "ai_json_parse_failed", "ai_schema_invalid", "ai_provider_error"].includes(code)
    ? 502
    : 500;
}

function identityFor(context: AccessContext, idempotencyKey: string) {
  return {
    accessMode: context.mode === "owner" ? "owner" as const : "visitor" as const,
    accessScope: context.mode === "owner" ? "owner" : context.demoAccessId,
    operation: OPERATION,
    idempotencyKey,
  };
}

function contextFingerprint(context: RealAiListingContext) {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}

function updateLedger(input: Parameters<typeof updateAiImageRequest>[0]) {
  const updated = updateAiImageRequest(input);
  if (!updated) throw new Error("STUDIO_LISTING_LEDGER_ENTRY_MISSING");
}

async function existingRequestResult(input: {
  entry: AiImageLedgerEntry;
  conflict: boolean;
  requestHash: string;
  idempotencyScopeHash: string;
  accessContext: AccessContext;
  accessMode: "owner" | "visitor";
}): Promise<StudioListingResult> {
  const { entry, conflict, requestHash, idempotencyScopeHash, accessContext, accessMode } = input;
  if (conflict) {
    return failure(409, "studio_request_conflict", "同一请求标识不能用于不同的 Listing 参数。");
  }

  let stored: AiListingPackDraft | null;
  try {
    stored = await loadStudioListingResult({
      accessMode,
      requestHash,
      idempotencyScopeHash,
    });
  } catch {
    return failure(500, "studio_result_store_corrupt", "Listing Studio 结果存储损坏，本次没有调用真实 AI。");
  }

  const recoverableStatuses = [
    "reserved",
    "provider_called",
    "provider_result_received",
    "asset_ingested",
    "provider_succeeded",
    "stored",
    "committed",
  ];
  const paidResultTerminal = entry.providerCostConsumed === true
    && ["failed_non_refundable", "failed_after_provider_result"].includes(entry.status);
  if (stored && (recoverableStatuses.includes(entry.status) || paidResultTerminal)) {
    if (entry.status !== "committed" && !paidResultTerminal) {
      try {
        updateLedger({
          requestHash,
          status: "committed",
          providerStage: "completed",
          providerCostConsumed: true,
        });
      } catch {
        return failure(500, "studio_ledger_failed", "Listing 结果已安全保存，但请求账本恢复失败；请使用同一请求重试。");
      }
    }
    let demoAccess: DemoAccessSnapshot | null = null;
    try {
      demoAccess = getLatestDemoSnapshot(accessContext);
    } catch {
      return failure(500, "demo_ai_quota_recovery_failed", "Listing 结果已安全保存，但访客额度状态暂不可用；请使用同一请求重试。");
    }
    return { ok: true, data: stored, demoAccess, duplicate: true };
  }

  if (entry.status === "committed") {
    return failure(500, "studio_result_unavailable", "该 Listing 请求已经完成，但短期结果不可用；请使用新的请求标识重新发起。");
  }

  if (recoverableStatuses.includes(entry.status)) {
    const updatedAt = Date.parse(entry.updatedAt);
    if (Number.isFinite(updatedAt) && Date.now() - updatedAt >= STUDIO_LISTING_REQUEST_STALE_MS) {
      try {
        getLatestDemoSnapshot(accessContext);
        const costConsumed = entry.providerCostConsumed === true
          || ["provider_called", "provider_result_received", "asset_ingested", "provider_succeeded", "stored"].includes(entry.status);
        updateLedger({
          requestHash,
          status: costConsumed ? "failed_non_refundable" : "refunded",
          providerCostConsumed: costConsumed,
          errorCode: "studio_request_stale",
        });
      } catch {
        return failure(500, "studio_ledger_failed", "陈旧 Listing 请求恢复失败；本次没有再次调用真实 AI。");
      }
      return failure(409, "studio_request_already_failed", "上一次 Listing 请求已中断；请使用新的请求标识重新发起。");
    }
    return failure(409, "studio_request_in_progress", "同一 Listing 请求正在处理中，请勿重复提交。");
  }
  return failure(409, "studio_request_already_failed", "该 Listing 请求已有终态，请使用新的请求标识。");
}

export async function generateRealStudioListing(input: {
  accessContext: AccessContext;
  context: RealAiListingContext;
  idempotencyKey: string;
}): Promise<StudioListingResult> {
  const identity = identityFor(input.accessContext, input.idempotencyKey);
  const lockKey = `${identity.accessMode}:${identity.accessScope}:${OPERATION}`;
  if (inFlightScopes.has(lockKey)) {
    return failure(409, "studio_request_in_progress", "当前身份已有 Listing 请求正在生成，请稍候。");
  }
  inFlightScopes.add(lockKey);

  const requestFingerprint = contextFingerprint(input.context);
  const idempotencyScopeHash = buildAiCallIdempotencyScopeHash(identity);
  const requestHash = buildAiCallRequestHash({ ...identity, requestFingerprint });
  let reservation: DemoAiQuotaReservation | null = null;
  let providerStarted = 0;
  let boundaryFailure: StudioListingFailure | null = null;

  try {
    let ledger;
    try {
      ledger = beginAiImageRequest({
        requestHash,
        idempotencyScopeHash,
        taskId: OPERATION,
        accessMode: identity.accessMode,
      });
    } catch {
      return failure(500, "studio_ledger_failed", "AI 请求账本不可用，本次没有调用真实 AI。");
    }
    if (!ledger.created) {
      return existingRequestResult({
        entry: ledger.entry,
        conflict: ledger.conflict,
        requestHash,
        idempotencyScopeHash,
        accessContext: input.accessContext,
        accessMode: identity.accessMode,
      });
    }

    const reserved = reserveDemoAiCalls(input.accessContext, 1);
    if (!reserved.ok) {
      try {
        updateLedger({ requestHash, status: "refunded", errorCode: reserved.code });
      } catch {
        return failure(500, "studio_ledger_failed", "AI 请求账本不可用，本次没有调用真实 AI。");
      }
      return failure(reserved.status, reserved.code, reserved.message);
    }
    reservation = reserved.reservation;

    const generated = await generateRealAiListingDraft(input.context, {
      onProviderCallStart: async () => {
        if (providerStarted > 0 || boundaryFailure) return;
        try {
          updateLedger({
            requestHash,
            status: "provider_called",
            providerStage: "provider_called",
          });
        } catch {
          boundaryFailure = failure(500, "studio_ledger_failed", "AI 请求账本写入失败，本次没有调用真实 AI。");
          throw new Error("STUDIO_LISTING_LEDGER_FAILED");
        }
        const marked = markDemoAiProviderCallStarted(input.accessContext, reservation, 1);
        if (!marked.ok) {
          boundaryFailure = failure(marked.status, marked.code, marked.message);
          throw new Error("STUDIO_LISTING_PROVIDER_BOUNDARY_FAILED");
        }
        providerStarted = 1;
      },
    });

    const providerBoundaryFailure = boundaryFailure as StudioListingFailure | null;
    if (providerBoundaryFailure) {
      const settled = settleDemoAiCalls(input.accessContext, reservation, providerStarted);
      if (!settled.ok) {
        try {
          updateLedger({
            requestHash,
            status: providerStarted ? "failed_non_refundable" : "refunded",
            providerStage: providerStarted ? "provider_called" : "provider_not_called",
            providerCostConsumed: providerStarted > 0,
            errorCode: settled.code,
          });
        } catch {
          // Both failures are fail-closed; the settlement error remains primary.
        }
        return failure(settled.status, settled.code, settled.message);
      }
      try {
        updateLedger({
          requestHash,
          status: providerStarted ? "failed_non_refundable" : "refunded",
          providerStage: providerStarted ? "provider_called" : "provider_not_called",
          providerCostConsumed: providerStarted > 0,
          errorCode: providerBoundaryFailure.error.code,
        });
      } catch {
        // The boundary already prevented the Provider call.
      }
      return providerBoundaryFailure;
    }

    if (!generated.ok) {
      const settled = settleDemoAiCalls(input.accessContext, reservation, providerStarted);
      if (!settled.ok) {
        try {
          updateLedger({
            requestHash,
            status: providerStarted ? "failed_non_refundable" : "refunded",
            providerStage: providerStarted ? "provider_called" : "provider_not_called",
            providerCostConsumed: providerStarted > 0,
            errorCode: settled.code,
          });
        } catch {
          // Both failures are fail-closed; the settlement error remains primary.
        }
        return failure(settled.status, settled.code, settled.message);
      }
      try {
        updateLedger({
          requestHash,
          status: providerStarted ? "failed_non_refundable" : "refunded",
          providerStage: providerStarted ? "provider_called" : "provider_not_called",
          providerCostConsumed: providerStarted > 0,
          errorCode: generated.error.code,
        });
      } catch {
        return failure(500, "studio_ledger_failed", "AI 请求账本结算失败。");
      }
      return failure(providerErrorStatus(generated.error.code), generated.error.code, generated.error.message);
    }

    if (providerStarted !== 1) {
      const settled = settleDemoAiCalls(input.accessContext, reservation, 0);
      if (!settled.ok) return failure(settled.status, settled.code, settled.message);
      try {
        updateLedger({ requestHash, status: "refunded", errorCode: "provider_start_boundary_missing" });
      } catch {
        // Fail closed below.
      }
      return failure(500, "provider_start_boundary_missing", "真实 AI 调用边界缺失，本次结果不可用。");
    }

    try {
      await saveStudioListingResult({
        accessMode: identity.accessMode,
        requestHash,
        idempotencyScopeHash,
        data: generated.data,
      });
    } catch {
      const settled = settleDemoAiCalls(input.accessContext, reservation, 1);
      try {
        updateLedger({
          requestHash,
          status: "failed_non_refundable",
          providerStage: "provider_called",
          providerCostConsumed: true,
          errorCode: "studio_result_store_failed",
        });
      } catch {
        // Result persistence already failed; retain the primary safe failure.
      }
      if (!settled.ok) return failure(settled.status, settled.code, settled.message);
      return failure(500, "studio_result_store_failed", "Listing 结果安全存储失败；不会再次自动调用真实 AI。");
    }

    const settled = settleDemoAiCalls(input.accessContext, reservation, 1);
    if (!settled.ok) {
      // The result is durable. Keep the ledger recoverable so the same key can replay it.
      return failure(settled.status, settled.code, settled.message);
    }

    try {
      updateLedger({
        requestHash,
        status: "committed",
        providerStage: "completed",
        providerCostConsumed: true,
      });
    } catch {
      return failure(500, "studio_ledger_failed", "Listing 结果已安全保存，但请求账本提交失败；请使用同一请求重试。");
    }
    return { ok: true, data: generated.data, demoAccess: settled.snapshot, duplicate: false };
  } finally {
    inFlightScopes.delete(lockKey);
  }
}
