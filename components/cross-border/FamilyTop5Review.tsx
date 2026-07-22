"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import {
  FAMILY_REVIEW_EXPORT_SCHEMA_VERSION,
  type FamilyReviewDecision,
  type FamilyReviewDecisionValue,
  type FamilyReviewExport,
  type ProductFamily,
  type SourceArtifactBinding,
} from "@/lib/upstream/family-top5-types";

const REVIEWER_CONFIRMATION = "人工已逐项复核上述 5 个商品家族" as const;
const FAMILY_REVIEW_STORAGE_SCHEMA_VERSION = "family-top5-review-state.v2" as const;

interface StoredFamilyTop5ReviewState {
  schemaVersion?: unknown;
  sourceBindingFingerprint?: unknown;
  decisions?: unknown;
  selectedFamilyIds?: unknown;
  reviewerConfirmed?: unknown;
  confirmationFingerprint?: unknown;
}

export interface FamilyTop5ReviewState {
  decisions: Record<string, FamilyReviewDecision>;
  selectedFamilyIds: string[];
  remoteImagesEnabled: boolean;
  failedImageUrls: string[];
  reviewerConfirmed: boolean;
}

export type FamilyTop5ReviewAction =
  | {
      type: "restore";
      decisions: Record<string, FamilyReviewDecision>;
      selectedFamilyIds: string[];
      reviewerConfirmed: boolean;
    }
  | { type: "decide"; family: ProductFamily; decision: FamilyReviewDecisionValue }
  | { type: "note"; family: ProductFamily; notes: string }
  | { type: "toggle_selected"; familyId: string; selected: boolean }
  | { type: "enable_remote_images" }
  | { type: "image_failed"; url: string }
  | { type: "confirm_review"; confirmed: boolean };

export const INITIAL_FAMILY_TOP5_REVIEW_STATE: FamilyTop5ReviewState = {
  decisions: {},
  selectedFamilyIds: [],
  remoteImagesEnabled: false,
  failedImageUrls: [],
  reviewerConfirmed: false,
};

export function isAllowedThumbnailUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "images.thdstatic.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export function familyTop5ReviewReducer(
  state: FamilyTop5ReviewState,
  action: FamilyTop5ReviewAction,
): FamilyTop5ReviewState {
  switch (action.type) {
    case "restore":
      return {
        ...state,
        decisions: action.decisions,
        selectedFamilyIds: action.selectedFamilyIds.filter(
          (familyId) => action.decisions[familyId]?.decision === "continue_research",
        ),
        reviewerConfirmed: action.reviewerConfirmed,
      };
    case "decide": {
      const current = state.decisions[action.family.familyId];
      const decisions = {
        ...state.decisions,
        [action.family.familyId]: {
          familyId: action.family.familyId,
          representativeStableId: action.family.representativeStableId,
          memberStableIds: [...action.family.memberStableIds],
          decision: action.decision,
          notes: current?.notes ?? "",
        },
      };
      return {
        ...state,
        decisions,
        selectedFamilyIds:
          action.decision === "continue_research"
            ? state.selectedFamilyIds
            : state.selectedFamilyIds.filter((familyId) => familyId !== action.family.familyId),
        reviewerConfirmed: false,
      };
    }
    case "note": {
      const current = state.decisions[action.family.familyId];
      if (!current) return state;
      return {
        ...state,
        decisions: {
          ...state.decisions,
          [action.family.familyId]: { ...current, notes: action.notes.slice(0, 500) },
        },
        reviewerConfirmed: false,
      };
    }
    case "toggle_selected": {
      if (state.decisions[action.familyId]?.decision !== "continue_research") return state;
      const without = state.selectedFamilyIds.filter((familyId) => familyId !== action.familyId);
      return {
        ...state,
        selectedFamilyIds: action.selected ? [...without, action.familyId].slice(0, 5) : without,
        reviewerConfirmed: false,
      };
    }
    case "enable_remote_images":
      return { ...state, remoteImagesEnabled: true };
    case "image_failed":
      return state.failedImageUrls.includes(action.url)
        ? state
        : { ...state, failedImageUrls: [...state.failedImageUrls, action.url] };
    case "confirm_review":
      return { ...state, reviewerConfirmed: action.confirmed };
  }
}

export function buildFamilyReviewExport(args: {
  topFamilies: ProductFamily[];
  state: FamilyTop5ReviewState;
  reviewedAt: string;
  sourceArtifactBinding: SourceArtifactBinding;
}): FamilyReviewExport {
  const { topFamilies, state, reviewedAt, sourceArtifactBinding } = args;
  if (topFamilies.length !== 5 || new Set(topFamilies.map((family) => family.familyId)).size !== 5) {
    throw new Error("family_review_contract_invalid");
  }
  const reviewedFamilies = topFamilies.map((family) => {
    const saved = state.decisions[family.familyId];
    if (
      !saved ||
      !(["continue_research", "watch", "reject"] as const).includes(saved.decision) ||
      typeof saved.notes !== "string" ||
      saved.notes.length > 500
    ) throw new Error("human_review_incomplete");
    return {
      familyId: family.familyId,
      representativeStableId: family.representativeStableId,
      memberStableIds: [...family.memberStableIds],
      decision: saved.decision,
      notes: saved.notes,
    };
  });
  if (!state.reviewerConfirmed) {
    throw new Error("human_review_incomplete");
  }
  const knownIds = new Set(topFamilies.map((family) => family.familyId));
  if (
    state.selectedFamilyIds.length > 5 ||
    new Set(state.selectedFamilyIds).size !== state.selectedFamilyIds.length ||
    state.selectedFamilyIds.some(
      (familyId) => !knownIds.has(familyId) || state.decisions[familyId]?.decision !== "continue_research",
    )
  ) throw new Error("selected_family_contract_invalid");

  const selectedFamilies = state.selectedFamilyIds.map((familyId) => {
    const family = topFamilies.find((candidate) => candidate.familyId === familyId);
    if (!family) throw new Error("selected_family_contract_invalid");
    return {
      familyId,
      representativeStableId: family.representativeStableId,
      memberStableIds: [...family.memberStableIds],
    };
  });

  return {
    schemaVersion: FAMILY_REVIEW_EXPORT_SCHEMA_VERSION,
    reviewedAt,
    reviewedFamilies,
    selectedFamilyIds: [...state.selectedFamilyIds],
    selectedFamilies,
    reviewerConfirmation: { confirmedByHuman: true, statement: REVIEWER_CONFIRMATION },
    sourceArtifactBinding,
  };
}

function storageKey(binding: SourceArtifactBinding): string {
  return `family-top5-human-review-v1:${binding.familyDataSha256}`;
}

function sourceBindingFingerprint(binding: SourceArtifactBinding): string {
  return JSON.stringify([
    binding.sourceArtifactId,
    binding.probeInputHash,
    binding.probeRunBindingHash,
    binding.providerAwareV2InputHash,
    binding.providerAwareV2ContentHash,
    binding.familyDataSha256,
    binding.familyManifestSha256,
    binding.appManifestSha256,
    binding.provenanceSha256,
  ]);
}

function confirmationFingerprint(args: {
  topFamilies: ProductFamily[];
  decisions: Record<string, FamilyReviewDecision>;
  selectedFamilyIds: string[];
  sourceArtifactBinding: SourceArtifactBinding;
}): string {
  return JSON.stringify({
    sourceBinding: sourceBindingFingerprint(args.sourceArtifactBinding),
    families: [...args.topFamilies]
      .sort((left, right) => left.familyId.localeCompare(right.familyId))
      .map((family) => {
        const decision = args.decisions[family.familyId];
        return {
          familyId: family.familyId,
          representativeStableId: family.representativeStableId,
          memberStableIds: [...family.memberStableIds].sort(),
          decision: decision
            ? {
                decision: decision.decision,
                notes: decision.notes,
                representativeStableId: decision.representativeStableId,
                memberStableIds: [...decision.memberStableIds].sort(),
              }
            : null,
        };
      }),
    selectedFamilyIds: [...args.selectedFamilyIds].sort(),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeStoredContent(
  stored: StoredFamilyTop5ReviewState,
  topFamilies: ProductFamily[],
): Pick<FamilyTop5ReviewState, "decisions" | "selectedFamilyIds"> | null {
  if (!isRecord(stored.decisions) || !Array.isArray(stored.selectedFamilyIds)) return null;
  const families = new Map(topFamilies.map((family) => [family.familyId, family]));
  const decisions: Record<string, FamilyReviewDecision> = {};

  for (const [familyId, candidate] of Object.entries(stored.decisions)) {
    const family = families.get(familyId);
    if (
      !family ||
      !isRecord(candidate) ||
      candidate.familyId !== familyId ||
      candidate.representativeStableId !== family.representativeStableId ||
      !Array.isArray(candidate.memberStableIds) ||
      !candidate.memberStableIds.every((value) => typeof value === "string") ||
      !sameStrings(candidate.memberStableIds, family.memberStableIds) ||
      !(candidate.decision === "continue_research" || candidate.decision === "watch" || candidate.decision === "reject") ||
      typeof candidate.notes !== "string" ||
      candidate.notes.length > 500
    ) return null;
    decisions[familyId] = {
      familyId,
      representativeStableId: candidate.representativeStableId,
      memberStableIds: [...candidate.memberStableIds],
      decision: candidate.decision,
      notes: candidate.notes,
    };
  }

  if (
    stored.selectedFamilyIds.length > 5 ||
    !stored.selectedFamilyIds.every((value) => typeof value === "string") ||
    new Set(stored.selectedFamilyIds).size !== stored.selectedFamilyIds.length ||
    stored.selectedFamilyIds.some(
      (familyId) => !families.has(familyId) || decisions[familyId]?.decision !== "continue_research",
    )
  ) return null;

  return { decisions, selectedFamilyIds: [...stored.selectedFamilyIds] };
}

function loadStoredState(
  binding: SourceArtifactBinding,
  topFamilies: ProductFamily[],
): Pick<FamilyTop5ReviewState, "decisions" | "selectedFamilyIds" | "reviewerConfirmed"> | null {
  try {
    const raw = window.localStorage.getItem(storageKey(binding));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredFamilyTop5ReviewState;
    if (!isRecord(parsed)) return null;
    const content = normalizeStoredContent(parsed, topFamilies);
    if (!content) return null;
    const expectedBindingFingerprint = sourceBindingFingerprint(binding);
    const expectedConfirmationFingerprint = confirmationFingerprint({
      topFamilies,
      decisions: content.decisions,
      selectedFamilyIds: content.selectedFamilyIds,
      sourceArtifactBinding: binding,
    });
    const reviewComplete = topFamilies.every((family) => Boolean(content.decisions[family.familyId]));
    const reviewerConfirmed =
      parsed.schemaVersion === FAMILY_REVIEW_STORAGE_SCHEMA_VERSION &&
      parsed.reviewerConfirmed === true &&
      parsed.sourceBindingFingerprint === expectedBindingFingerprint &&
      parsed.confirmationFingerprint === expectedConfirmationFingerprint &&
      reviewComplete;
    return { ...content, reviewerConfirmed };
  } catch {
    return null;
  }
}

function storedState(args: {
  topFamilies: ProductFamily[];
  state: FamilyTop5ReviewState;
  sourceArtifactBinding: SourceArtifactBinding;
}): StoredFamilyTop5ReviewState {
  const reviewComplete = args.topFamilies.every((family) => Boolean(args.state.decisions[family.familyId]));
  const reviewerConfirmed = args.state.reviewerConfirmed && reviewComplete;
  return {
    schemaVersion: FAMILY_REVIEW_STORAGE_SCHEMA_VERSION,
    sourceBindingFingerprint: sourceBindingFingerprint(args.sourceArtifactBinding),
    decisions: args.state.decisions,
    selectedFamilyIds: args.state.selectedFamilyIds,
    reviewerConfirmed,
    confirmationFingerprint: reviewerConfirmed
      ? confirmationFingerprint({
          topFamilies: args.topFamilies,
          decisions: args.state.decisions,
          selectedFamilyIds: args.state.selectedFamilyIds,
          sourceArtifactBinding: args.sourceArtifactBinding,
        })
      : null,
  };
}

function downloadReview(exported: FamilyReviewExport): void {
  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
  const anchor = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  anchor.href = objectUrl;
  anchor.download = "family-top5-human-review.v1.json";
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export default function FamilyTop5Review(props: {
  topFamilies: ProductFamily[];
  remainingFamilies: ProductFamily[];
  sourceArtifactBinding: SourceArtifactBinding;
}) {
  const [state, dispatch] = useReducer(familyTop5ReviewReducer, INITIAL_FAMILY_TOP5_REVIEW_STATE);
  const currentStorageKey = storageKey(props.sourceArtifactBinding);
  const currentSourceBindingFingerprint = sourceBindingFingerprint(props.sourceArtifactBinding);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);

  useEffect(() => {
    const restored = loadStoredState(props.sourceArtifactBinding, props.topFamilies);
    dispatch({
      type: "restore",
      decisions: restored?.decisions ?? {},
      selectedFamilyIds: restored?.selectedFamilyIds ?? [],
      reviewerConfirmed: restored?.reviewerConfirmed ?? false,
    });
    setHydratedStorageKey(currentStorageKey);
  }, [currentSourceBindingFingerprint, currentStorageKey, props.sourceArtifactBinding, props.topFamilies]);

  useEffect(() => {
    if (hydratedStorageKey !== currentStorageKey) return;
    try {
      window.localStorage.setItem(
        currentStorageKey,
        JSON.stringify(storedState({
          topFamilies: props.topFamilies,
          state,
          sourceArtifactBinding: props.sourceArtifactBinding,
        })),
      );
    } catch {
      // Browser-local persistence is optional; no server or database write is attempted.
    }
  }, [
    currentSourceBindingFingerprint,
    currentStorageKey,
    hydratedStorageKey,
    props.sourceArtifactBinding,
    props.topFamilies,
    state,
  ]);

  return (
    <FamilyTop5ReviewView
      {...props}
      state={state}
      dispatch={dispatch}
      onExport={(reviewedAt) =>
        downloadReview(
          buildFamilyReviewExport({
            topFamilies: props.topFamilies,
            state,
            reviewedAt,
            sourceArtifactBinding: props.sourceArtifactBinding,
          }),
        )
      }
    />
  );
}

export function FamilyTop5ReviewView(props: {
  topFamilies: ProductFamily[];
  remainingFamilies: ProductFamily[];
  sourceArtifactBinding: SourceArtifactBinding;
  state: FamilyTop5ReviewState;
  dispatch: (action: FamilyTop5ReviewAction) => void;
  onExport: (reviewedAt: string) => void;
}) {
  const { topFamilies, remainingFamilies, state, dispatch } = props;
  const reviewComplete = topFamilies.every((family) => Boolean(state.decisions[family.familyId]));
  const selected = useMemo(() => new Set(state.selectedFamilyIds), [state.selectedFamilyIds]);

  return (
    <section data-testid="family-top5-review" style={pageStyle}>
      <h1 style={{ fontSize: "1.35rem", color: "#245c3a", marginBottom: 4 }}>商品家族 Top 5 人工复核</h1>
      <p style={noticeStyle}>
        当前结果仅用于公开市场预筛与人工继续调查，不代表采购、利润、合规或上架结论。
      </p>
      <div style={metaStyle}>
        <span>Listing：23</span><span>商品家族：22</span><span>Top：5</span><span>其余：{remainingFamilies.length}</span>
        <span>状态：默认离线展示，可选加载公开缩略图</span>
      </div>
      <p style={{ fontSize: 13, color: "#7a4f12" }}>缩略图来自公开远程地址，点击加载后将产生网络请求。</p>
      {!state.remoteImagesEnabled && (
        <button type="button" onClick={() => dispatch({ type: "enable_remote_images" })} style={primaryButtonStyle}>
          加载公开商品缩略图
        </button>
      )}

      {topFamilies.map((family) => {
        const representative = family.representativeListing;
        const decision = state.decisions[family.familyId];
        return (
          <article key={family.familyId} data-testid="family-card" data-family-id={family.familyId} style={cardStyle}>
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <SafeThumbnail
                url={representative.thumbnailUrl}
                alt={representative.parsedNameZh}
                enabled={state.remoteImagesEnabled}
                failed={Boolean(representative.thumbnailUrl && state.failedImageUrls.includes(representative.thumbnailUrl))}
                onError={(url) => dispatch({ type: "image_failed", url })}
              />
              <div>
                <h2 style={{ fontSize: "1.08rem", margin: 0, color: "#245c3a" }}>
                  家族 #{family.familyRank} · {representative.parsedNameZh}
                </h2>
                <p style={{ margin: "4px 0", color: "#5b6470", fontSize: 14 }}>{representative.title}</p>
                <p style={{ margin: "4px 0", fontSize: 13 }}>
                  Family ID：{family.familyId} · 代表商品：{family.representativeStableId} · 成员：{family.memberStableIds.join("、")}
                </p>
              </div>
            </div>

            <div style={factsStyle}>
              <span>品牌：{family.normalizedBrand}</span>
              <span>价格：${representative.price.toFixed(2)}</span>
              <span>评分：{representative.rating}</span>
              <span>评论：{representative.reviewCount}</span>
              <span>包装：{representative.packInfo}</span>
            </div>

            {family.memberListings.length > 1 && (
              <div data-testid="family-members">
                <strong>同一家族 Listing 差异</strong>
                <ul>{family.variantDifferences.map((difference) => <li key={difference}>{difference}</li>)}</ul>
                {family.memberListings.map((member) => (
                  <div key={member.stableId} style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0" }}>
                    <SafeThumbnail
                      url={member.thumbnailUrl}
                      alt={member.title}
                      enabled={state.remoteImagesEnabled}
                      failed={Boolean(member.thumbnailUrl && state.failedImageUrls.includes(member.thumbnailUrl))}
                      onError={(url) => dispatch({ type: "image_failed", url })}
                      small
                    />
                    <span>{member.stableId} · {member.packInfo}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              {([
                ["continue_research", "继续调查"],
                ["watch", "观察"],
                ["reject", "不继续调查"],
              ] as const).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={decision?.decision === value}
                  onClick={() => dispatch({ type: "decide", family, decision: value })}
                  style={decision?.decision === value ? selectedDecisionStyle : decisionButtonStyle}
                >
                  {label}
                </button>
              ))}
            </div>
            <textarea
              aria-label={`${family.familyId} 备注`}
              placeholder="人工备注（可选）"
              maxLength={500}
              value={decision?.notes ?? ""}
              disabled={!decision}
              onChange={(event) => dispatch({ type: "note", family, notes: event.target.value })}
              style={{ width: "100%", minHeight: 48, marginTop: 8, padding: 8 }}
            />
            <label style={{ display: "block", marginTop: 8 }}>
              <input
                type="checkbox"
                disabled={decision?.decision !== "continue_research"}
                checked={selected.has(family.familyId)}
                onChange={(event) =>
                  dispatch({ type: "toggle_selected", familyId: family.familyId, selected: event.target.checked })
                }
              />{" "}
              选为继续调查对象
            </label>
          </article>
        );
      })}

      <details style={{ marginTop: 16 }}>
        <summary>查看其余 {remainingFamilies.length} 个商品家族</summary>
        <ol>
          {remainingFamilies.map((family) => (
            <li key={family.familyId}>{family.familyRank}. {family.representativeListing.parsedNameZh}（{family.familyId}）</li>
          ))}
        </ol>
      </details>

      <div style={{ ...noticeStyle, marginTop: 18 }}>
        <label>
          <input
            type="checkbox"
            checked={state.reviewerConfirmed}
            disabled={!reviewComplete}
            onChange={(event) => dispatch({ type: "confirm_review", confirmed: event.target.checked })}
          />{" "}
          {REVIEWER_CONFIRMATION}
        </label>
        <p>已选择 {state.selectedFamilyIds.length} / 5 个继续调查对象；允许最终选择 0～5 个。</p>
        <button
          type="button"
          disabled={!reviewComplete || !state.reviewerConfirmed}
          onClick={() => props.onExport(new Date().toISOString())}
          style={primaryButtonStyle}
        >
          导出人工复核结果
        </button>
      </div>
      <p style={{ color: "#64707c", fontSize: 13 }}>
        当前决定仅保存在本浏览器并可下载 JSON；不会创建 Candidate、Task，不会写数据库，也不会调用 Provider。
      </p>
    </section>
  );
}

function SafeThumbnail(props: {
  url: string | null;
  alt: string;
  enabled: boolean;
  failed: boolean;
  onError: (url: string) => void;
  small?: boolean;
}) {
  const size = props.small ? 56 : 112;
  const safeUrl = isAllowedThumbnailUrl(props.url) ? props.url : null;
  if (!props.enabled || props.failed || !safeUrl) {
    return (
      <div data-testid="thumbnail-placeholder" style={{ ...placeholderStyle, width: size, height: size }}>
        {props.failed ? "图片加载失败" : "缩略图未加载"}
      </div>
    );
  }
  return (
    // Raw img avoids Next.js image optimization proxy and only appears after explicit consent.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-testid="remote-thumbnail"
      src={safeUrl}
      alt={props.alt}
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => props.onError(safeUrl)}
      style={{ objectFit: "contain", border: "1px solid #d6dadd", borderRadius: 8 }}
    />
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: 960,
  margin: "0 auto",
  padding: "24px 16px",
  background: "#fffdf7",
  color: "#24313b",
  fontFamily: "system-ui, sans-serif",
};
const noticeStyle: React.CSSProperties = { background: "#eef7ef", borderLeft: "4px solid #4f8a5b", padding: 12 };
const metaStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12, fontSize: 13, color: "#5b6470" };
const cardStyle: React.CSSProperties = { background: "white", border: "1px solid #cbdccb", borderRadius: 10, padding: 16, marginTop: 14 };
const factsStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12, margin: "12px 0", fontSize: 14 };
const primaryButtonStyle: React.CSSProperties = { padding: "9px 16px", border: 0, borderRadius: 6, background: "#2e7d4a", color: "white", cursor: "pointer" };
const decisionButtonStyle: React.CSSProperties = { padding: "7px 14px", border: "1px solid #90a498", borderRadius: 18, background: "white" };
const selectedDecisionStyle: React.CSSProperties = { ...decisionButtonStyle, background: "#2e7d4a", color: "white" };
const placeholderStyle: React.CSSProperties = { flexShrink: 0, display: "grid", placeItems: "center", background: "#edf0f2", color: "#6f7880", fontSize: 12, borderRadius: 8 };
