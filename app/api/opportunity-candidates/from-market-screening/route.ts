import { NextRequest, NextResponse } from "next/server";
import { buildCandidateAgentRunHref } from "@/lib/candidateAgentRunLink";
import {
  normalizeCandidateEvidence,
  parseCandidateEvidenceSnapshot,
} from "@/lib/candidateEvidence";
import { loadMarketScreeningBatch } from "@/lib/marketScreeningBatchLoader";
import type { ProductionBatchRegistration } from "@/lib/marketScreeningBatchManifest";
import { getActiveProductionMarketScreeningRegistration } from "@/lib/marketScreeningProductionRegistry";
import { resolveProjectMaterialsRoot } from "@/lib/projectMaterialsRoot";
import {
  buildMarketScreeningWorkbenchRenderModel,
  type MarketScreeningItemView,
  type MarketScreeningWorkbenchView,
} from "@/lib/marketScreeningWorkbench";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import {
  listSandboxCandidates,
  saveLegacySandboxCandidates,
  sandboxCandidateToListItem,
  updateSandboxCandidate,
} from "@/lib/server/demoSandbox";
import {
  buildMarketScreeningCandidateIdentity,
  MarketScreeningCandidateError,
  resolveMarketScreeningCandidate,
  selectMarketScreeningCandidateForResearch,
  type CandidateItem,
  type MarketScreeningCandidateIdentity,
} from "@/lib/server/opportunityCandidateService";
import {
  CandidateSourceSaveError,
  type CandidateSaveItem,
} from "@/lib/server/candidateSourceSave";
import { toPublicOpportunityCandidate } from "@/lib/server/candidateEvidenceReview";
import { parseR22MarketDecisionSnapshot } from "@/lib/r22DecisionModel";
import { stableHash } from "@/lib/upstream/pipeline";

export const runtime = "nodejs";

type CandidateRecord = CandidateItem;

const selectionTails = new Map<string, Promise<void>>();

type ApiResponse =
  | {
      ok: true;
      item: Record<string, unknown>;
      href: string;
      created: boolean;
      isSandbox?: boolean;
    }
  | { ok: false; error: { code: string; message: string } };

class CandidateSelectionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CandidateSelectionError";
  }
}

function json(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

async function withSelectionLock<T>(
  key: string,
  action: () => Promise<T> | T,
): Promise<T> {
  const previous = selectionTails.get(key) ?? Promise.resolve();
  const run = previous.then(action, action);
  const tail = run.then(() => undefined, () => undefined);
  selectionTails.set(key, tail);
  try {
    return await run;
  } finally {
    if (selectionTails.get(key) === tail) {
      selectionTails.delete(key);
    }
  }
}

function buildAmazonProductUrl(asin: string) {
  return /^[A-Z0-9]{10}$/u.test(asin) ? `https://www.amazon.com/dp/${asin}` : null;
}

function buildCandidateInput(
  view: MarketScreeningWorkbenchView,
  item: MarketScreeningItemView,
  productionRegistration: ProductionBatchRegistration,
): {
  input: CandidateSaveItem;
  identity: MarketScreeningCandidateIdentity;
} {
  const name = text(item.title.value);
  if (!name) {
    throw new CandidateSelectionError(
      "candidate_name_missing",
      409,
      "商品名称缺失，无法安全创建 Candidate。",
    );
  }
  if (productionRegistration.manifestId !== view.manifestId) {
    throw new CandidateSelectionError(
      "market_screening_batch_drifted",
      409,
      "当前候选批次与生产注册不一致。",
    );
  }
  const productIdentity = /^amazon:([A-Z]{2,8}):([A-Z0-9]{10})$/u.exec(item.productKey);
  if (!productIdentity || productIdentity[2] !== item.asin) {
    throw new CandidateSelectionError(
      "market_screening_identity_invalid",
      409,
      "当前商品身份不完整或不一致。",
    );
  }
  const marketplace = productIdentity[1];

  const link = buildAmazonProductUrl(item.asin);
  const priceText = item.price.value
    ? `${item.price.value.currency} ${item.price.value.amount}`
    : null;
  const evidenceSnapshot = normalizeCandidateEvidence({
    title: name,
    sourceType: "market_screening_batch",
    sourceName: item.title.source,
    sourceUrl: link,
    candidateType: "product_candidate",
    score: 0,
    priceText,
    hasImage: item.image.status === "available",
    generatedAt: item.title.capturedAt,
  });
  const marketScreening = {
    manifestId: view.manifestId,
    productKey: item.productKey,
    asin: item.asin,
    status: item.status,
    reasonCodes: item.reasonCodes,
    nextActions: item.nextActions,
    evidence: {
      title: item.title,
      price: item.price,
      rating: item.rating,
      reviewCount: item.reviewCount,
    },
  };
  const evidenceHash = stableHash({
    schemaVersion: "market-screening-candidate-evidence.v1",
    manifestId: view.manifestId,
    marketplace,
    productKey: item.productKey,
    asin: item.asin,
    status: item.status,
    imageStatus: item.image.status,
    price: item.price,
    rating: item.rating,
    reviewCount: item.reviewCount,
    features: item.features,
    detailEvidence: item.detailEvidence,
    reasonCodes: item.reasonCodes,
    nextActions: item.nextActions,
  });
  const identity = buildMarketScreeningCandidateIdentity({
    productionRegistrationId: productionRegistration.registrationId,
    batchManifestHash: productionRegistration.manifestSha256,
    manifestId: view.manifestId,
    marketplace,
    productKey: item.productKey,
    asin: item.asin,
    evidenceHash,
  });

  return {
    identity,
    input: {
      name,
      rawInput: name,
      link,
      score: 0,
      source: "现有候选商品池",
      keyword: text(view.brief.query.value),
      riskLevel: "",
      riskLabel: "",
      summaryLabel: "来自现有候选商品池，需人工研究",
      status: "pending",
      sourceMetaJson: JSON.stringify({
        version: "candidate-source-meta-v2",
        integrity: "legacy_unverified",
        origin: "frozen_market_screening_batch",
        marketScreeningIdentity: identity,
        marketScreening,
        evidenceSnapshot,
      }),
      analysisJson: JSON.stringify({
        version: "candidate-analysis-v2",
        integrity: "legacy_unverified",
        origin: "frozen_market_screening_batch",
        marketScreening: {
          identityHash: identity.identityHash,
          evidenceHash: identity.evidenceHash,
          manifestId: view.manifestId,
          productKey: item.productKey,
          status: item.status,
        },
      }),
      convertedTaskId: null,
    },
  };
}

function assertCandidateCanEnterResearch(candidate: CandidateRecord) {
  if (candidate.convertedTaskId) {
    throw new CandidateSelectionError(
      "candidate_has_linked_task",
      409,
      "该 Candidate 已绑定研究任务，请前往研究历史查看。",
    );
  }
  if (candidate.status === "paused" || candidate.status === "rejected") {
    throw new CandidateSelectionError(
      "candidate_not_ready",
      409,
      "该 Candidate 当前状态不可研究。",
    );
  }
}

async function selectOwnerCandidate(
  input: CandidateSaveItem,
  identity: MarketScreeningCandidateIdentity,
  explicitMarketWatchReview: boolean,
) {
  return selectMarketScreeningCandidateForResearch(
    input,
    identity,
    (candidate) => {
      buildHandoff(candidate, explicitMarketWatchReview);
    },
  );
}

function selectSandboxCandidate(
  demoAccessId: string,
  input: CandidateSaveItem,
  identity: MarketScreeningCandidateIdentity,
  explicitMarketWatchReview: boolean,
) {
  const listed = listSandboxCandidates(demoAccessId).map(sandboxCandidateToListItem);
  const resolution = resolveMarketScreeningCandidate(listed, input.name, identity);
  let candidate = resolution.kind === "reuse"
    ? resolution.candidate as CandidateRecord
    : null;
  let created = false;

  if (!candidate) {
    const saved = saveLegacySandboxCandidates(demoAccessId, [input]);
    const sandboxCandidate = saved.items[0] ?? null;
    candidate = sandboxCandidate ? sandboxCandidateToListItem(sandboxCandidate) as CandidateRecord : null;
    created = saved.created > 0;
    if (candidate) {
      const createdResolution = resolveMarketScreeningCandidate([candidate], input.name, identity);
      if (createdResolution.kind !== "reuse") candidate = null;
    }
  }
  if (!candidate) {
    throw new CandidateSelectionError(
      "candidate_create_failed",
      409,
      "Candidate 未能安全创建，已停止进入研究。",
    );
  }

  assertCandidateCanEnterResearch(candidate);
  buildHandoff(candidate, explicitMarketWatchReview);
  if (candidate.status === "pending") {
    const updated = updateSandboxCandidate(
      demoAccessId,
      candidate.id,
      { status: "worth_analyzing" },
      { sourceReviewAcknowledged: true, requestedFields: ["status"] },
    );
    candidate = updated ? sandboxCandidateToListItem(updated) as CandidateRecord : null;
  }
  if (!candidate || (candidate.status !== "worth_analyzing" && candidate.status !== "analyzed")) {
    throw new CandidateSelectionError(
      "candidate_not_ready",
      409,
      "该 Candidate 当前状态不可研究。",
    );
  }

  return { candidate, created };
}

function buildHandoff(candidate: CandidateRecord, explicitMarketWatchReview: boolean) {
  const item = toPublicOpportunityCandidate(candidate);
  const evidenceSnapshot = parseCandidateEvidenceSnapshot(item.evidenceSnapshot);
  const marketDecisionSnapshot = parseR22MarketDecisionSnapshot(item.r22MarketDecisionSnapshot);
  const href = buildCandidateAgentRunHref({
    candidateId: candidate.id,
    name: candidate.name,
    rawInput: candidate.rawInput,
    analyzedName: candidate.name,
    sourceTitle: candidate.summaryLabel || candidate.name,
    sourceUrl: candidate.link,
    source: candidate.source,
    score: candidate.score,
    keyword: candidate.keyword,
    evidenceSnapshot,
    marketDecisionSnapshot,
    explicitMarketWatchReview,
  });
  if (!href) {
    throw new CandidateSelectionError(
      "candidate_handoff_invalid",
      409,
      "Candidate 研究入口不完整，已停止跳转。",
    );
  }
  return { item, href };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: { code: "invalid_json", message: "请求体不是合法 JSON。" } }, 400);
  }
  if (!isRecord(body)) {
    return json({ ok: false, error: { code: "invalid_body", message: "请求体必须是 JSON object。" } }, 400);
  }

  const auth = requireAuthenticated(request, body);
  if (!auth.ok) {
    return json({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status);
  }

  const productKey = text(body.productKey).slice(0, 120);
  if (!productKey) {
    return json({ ok: false, error: { code: "product_key_required", message: "商品标识缺失。" } }, 400);
  }

  try {
    const productionRegistration = getActiveProductionMarketScreeningRegistration();
    if (!productionRegistration) {
      throw new CandidateSelectionError(
        "market_screening_registration_missing",
        409,
        "当前候选批次缺少生产注册。",
      );
    }
    const materialsRoot = resolveProjectMaterialsRoot();
    if (materialsRoot.status !== "ready") {
      throw new CandidateSelectionError(
        materialsRoot.errorCode,
        409,
        "项目材料根不可用，已停止创建 Candidate。",
      );
    }
    const batch = loadMarketScreeningBatch({
      environment: "production",
      projectMaterialsRoot: materialsRoot.projectMaterialsRoot,
      productionRegistration,
    });
    const model = buildMarketScreeningWorkbenchRenderModel(batch);
    if (model.status !== "ready") {
      throw new CandidateSelectionError(
        "market_screening_not_ready",
        409,
        "当前候选批次未通过完整性检查。",
      );
    }

    const matchingItems = model.view.items.filter((candidate) => candidate.productKey === productKey);
    if (matchingItems.length === 0) {
      throw new CandidateSelectionError(
        "market_screening_item_not_found",
        404,
        "当前候选批次中不存在该商品。",
      );
    }
    if (matchingItems.length !== 1) {
      throw new CandidateSelectionError(
        "market_screening_identity_conflict",
        409,
        "当前候选批次存在重复商品身份。",
      );
    }
    const item = matchingItems[0];
    if (item.status === "reject" || item.status === "insufficient") {
      throw new CandidateSelectionError(
        "candidate_not_researchable",
        409,
        "该商品当前证据状态不可研究。",
      );
    }

    const selection = buildCandidateInput(model.view, item, productionRegistration);
    const explicitMarketWatchReview = item.status === "watch";
    let selected: { candidate: CandidateRecord; created: boolean };
    if (auth.context.mode === "demo") {
      const demoAccessId = auth.context.demoAccessId;
      selected = await withSelectionLock(
        `visitor:${demoAccessId}:${selection.identity.identityHash}`,
        () => selectSandboxCandidate(
          demoAccessId,
          selection.input,
          selection.identity,
          explicitMarketWatchReview,
        ),
      );
    } else {
      selected = await withSelectionLock(
        `owner:${selection.identity.identityHash}`,
        () => selectOwnerCandidate(
          selection.input,
          selection.identity,
          explicitMarketWatchReview,
        ),
      );
    }
    const handoff = buildHandoff(selected.candidate, explicitMarketWatchReview);

    return json({
      ok: true,
      item: handoff.item,
      href: handoff.href,
      created: selected.created,
      ...(auth.context.mode === "demo" ? { isSandbox: true } : {}),
    });
  } catch (error) {
    if (error instanceof MarketScreeningCandidateError) {
      const messages: Record<string, string> = {
        candidate_contract_invalid: "Candidate 身份合同无效，已停止进入研究。",
        candidate_identity_conflict: "候选池存在重复商品身份，已停止进入研究。",
        candidate_legacy_identity_conflict: "同名旧 Candidate 缺少稳定身份，已停止进入研究。",
        candidate_evidence_conflict: "同一商品的关键证据发生冲突，已停止进入研究。",
        candidate_has_linked_task: "该 Candidate 已绑定研究任务，请前往研究历史查看。",
        candidate_not_ready: "该 Candidate 当前状态不可研究。",
      };
      return json({
        ok: false,
        error: {
          code: error.code,
          message: messages[error.code] ?? "Candidate 转换失败，已停止进入研究。",
        },
      }, 409);
    }
    if (error instanceof CandidateSelectionError) {
      return json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof CandidateSourceSaveError) {
      return json({
        ok: false,
        error: {
          code: error.code,
          message: error.code === "candidate_source_conflict"
            ? "候选池存在来源或身份冲突，已停止进入研究。"
            : "Candidate 转换失败，已停止进入研究。",
        },
      }, error.code === "invalid_payload" ? 400 : 409);
    }
    return json({
      ok: false,
      error: { code: "server_error", message: "Candidate 转换失败，请稍后重试。" },
    }, 500);
  }
}
