import type { OpportunityCandidatePoolItem } from "@/lib/opportunityCandidatePool";

export type DecisionDeskTone = "positive" | "warning" | "danger" | "neutral";

export type DecisionDeskPresentation = {
  label: string;
  tone: DecisionDeskTone;
};

export function createLatestRequestGuard() {
  let latestRequestId = 0;
  let active = true;

  return {
    begin() {
      latestRequestId += 1;
      return latestRequestId;
    },
    isCurrent(requestId: number) {
      return active && requestId === latestRequestId;
    },
    activate() {
      active = true;
      latestRequestId += 1;
    },
    invalidate() {
      active = false;
      latestRequestId += 1;
    },
  };
}

type LatestRequestGuard = ReturnType<typeof createLatestRequestGuard>;

type LatestRequestHandlers<T> = {
  onStart?: () => void;
  onSuccess?: (value: T) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
};

export type LatestRequestResult<T> =
  | { status: "success"; value: T }
  | { status: "error"; error: unknown }
  | { status: "stale" };

export async function runLatestRequest<T>(
  guard: LatestRequestGuard,
  request: () => Promise<T>,
  handlers: LatestRequestHandlers<T> = {},
): Promise<LatestRequestResult<T>> {
  const requestId = guard.begin();
  if (guard.isCurrent(requestId)) handlers.onStart?.();
  try {
    const value = await request();
    if (!guard.isCurrent(requestId)) return { status: "stale" };
    handlers.onSuccess?.(value);
    return { status: "success", value };
  } catch (error) {
    if (!guard.isCurrent(requestId)) return { status: "stale" };
    handlers.onError?.(error);
    return { status: "error", error };
  } finally {
    if (guard.isCurrent(requestId)) handlers.onSettled?.();
  }
}

export type DecisionDeskSummary = {
  all: number;
  pending: number;
  worthAnalyzing: number;
  analyzing: number;
  converted: number;
};

function normalizedRiskText(item: OpportunityCandidatePoolItem) {
  return `${item.riskLevel} ${item.riskLabel}`.trim().toLowerCase();
}

const HIGH_RISK_FLAGS = new Set([
  "ip_risk",
  "brand_risk",
  "confirmed_fatal_risk",
  "fatal_risk",
  "infringement",
  "compliance_block",
  "platform_restriction",
]);

function hasHighRiskFlag(flags: string[]) {
  return flags.some((flag) => {
    const normalized = flag.trim().toLowerCase();
    return HIGH_RISK_FLAGS.has(normalized)
      || normalized.includes("fatal")
      || normalized.includes("high_risk");
  });
}

export function getDecisionDeskMarketPresentation(
  item: OpportunityCandidatePoolItem,
): DecisionDeskPresentation {
  const snapshot = item.r22MarketDecisionSnapshot;
  if (!snapshot || snapshot.candidateId !== item.id) {
    return { label: "尚未评估", tone: "neutral" };
  }
  if (snapshot.marketDecision === "market_shortlisted") {
    return { label: "晋级", tone: "positive" };
  }
  if (snapshot.marketDecision === "market_watch") {
    return { label: "观察", tone: "warning" };
  }
  if (snapshot.marketDecision === "market_reject") {
    return { label: "拒绝", tone: "danger" };
  }
  return { label: "数据不足", tone: "neutral" };
}

export function getDecisionDeskRiskPresentation(
  item: OpportunityCandidatePoolItem,
): DecisionDeskPresentation {
  const risk = normalizedRiskText(item);
  const flags = item.evidenceSnapshot?.riskFlags ?? [];
  if (risk.includes("red") || risk.includes("高风险") || risk.includes("致命") || hasHighRiskFlag(flags)) {
    return { label: "高风险", tone: "danger" };
  }
  if (risk.includes("yellow") || risk.includes("中风险") || risk.includes("待核对")) {
    return { label: "待核对", tone: "warning" };
  }
  if (flags.length) {
    return { label: "待核对", tone: "warning" };
  }
  return { label: "未确认", tone: "neutral" };
}

export function getDecisionDeskScorePresentation(item: OpportunityCandidatePoolItem) {
  if (item.scoreAvailable === false || !Number.isFinite(item.score)) return "—";
  return String(item.score);
}

export function getDecisionDeskEvidencePresentation(
  item: OpportunityCandidatePoolItem,
): DecisionDeskPresentation {
  if (item.sourceIntegrity === "verified_public") {
    return { label: "可追溯", tone: "positive" };
  }
  if (item.link || item.evidenceSnapshot?.sourceUrl) {
    return { label: "来源待复核", tone: "warning" };
  }
  return { label: "证据不足", tone: "neutral" };
}

export function buildDecisionDeskSummary(
  items: OpportunityCandidatePoolItem[],
): DecisionDeskSummary {
  return items.reduce<DecisionDeskSummary>((summary, item) => {
    summary.all += 1;
    if (item.convertedTaskId) {
      summary.converted += 1;
    } else if (item.candidateStatus === "worth_analyzing") {
      summary.worthAnalyzing += 1;
    } else if (item.candidateStatus === "analyzed") {
      summary.analyzing += 1;
    } else if (item.candidateStatus === "pending" || item.candidateStatus === "paused") {
      summary.pending += 1;
    }
    return summary;
  }, {
    all: 0,
    pending: 0,
    worthAnalyzing: 0,
    analyzing: 0,
    converted: 0,
  });
}

export function resolveDecisionDeskSelection(
  items: OpportunityCandidatePoolItem[],
  selectedId: string | null,
) {
  return items.find((item) => item.id === selectedId) ?? items[0] ?? null;
}
