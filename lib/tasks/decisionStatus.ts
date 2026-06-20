export const decisionStatusValues = ["pending", "continue", "need_info", "rejected"] as const;

export type DecisionStatus = (typeof decisionStatusValues)[number];

export const defaultDecisionStatus: DecisionStatus = "pending";

export const decisionStatusOptions: Array<{
  value: "" | DecisionStatus;
  label: string;
  shortLabel: string;
  description: string;
  className: string;
}> = [
  {
    value: "",
    label: "全部人工状态",
    shortLabel: "全部",
    description: "不按人工状态筛选。",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  },
  {
    value: "pending",
    label: "待判断",
    shortLabel: "待判断",
    description: "AI 结果仅供初筛，等待人工决定下一步。",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  },
  {
    value: "continue",
    label: "可继续",
    shortLabel: "可继续",
    description: "人工初步认可，可以继续补资料或小单验证。",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  {
    value: "need_info",
    label: "需补资料",
    shortLabel: "需补资料",
    description: "当前信息不足，需要补供应商、成本、合规或平台规则。",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  {
    value: "rejected",
    label: "已淘汰",
    shortLabel: "已淘汰",
    description: "人工判断风险或成本不适合继续推进。",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
];

const validDecisionStatuses = new Set<string>(decisionStatusValues);

export function normalizeDecisionStatus(value: unknown): DecisionStatus {
  return typeof value === "string" && validDecisionStatuses.has(value)
    ? value as DecisionStatus
    : defaultDecisionStatus;
}

export function isDecisionStatus(value: unknown): value is DecisionStatus {
  return typeof value === "string" && validDecisionStatuses.has(value);
}

export function getDecisionStatusOption(value: unknown) {
  const normalized = normalizeDecisionStatus(value);
  return decisionStatusOptions.find((item) => item.value === normalized) ?? decisionStatusOptions[1];
}
