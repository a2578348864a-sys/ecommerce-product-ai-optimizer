export type ProductResearchDecisionStatus =
  | "creative_ready"
  | "needs_information"
  | "abandoned";

export const PRODUCT_RESEARCH_DECISION_OPTIONS: ReadonlyArray<{
  value: ProductResearchDecisionStatus;
  label: string;
  description: string;
}> = [
  {
    value: "creative_ready",
    label: "进入创作准备",
    description: "仅表示可以开始内容准备，不代表采购、盈利、合规或上架成立。",
  },
  {
    value: "needs_information",
    label: "待补信息",
    description: "记录缺失证据与下一步补充动作，研究仍保持开放。",
  },
  {
    value: "abandoned",
    label: "放弃研究",
    description: "停止继续推进，但完整保留 Candidate、研究依据和决定历史。",
  },
];

export function isProductResearchDecisionStatus(
  value: unknown,
): value is ProductResearchDecisionStatus {
  return value === "creative_ready" || value === "needs_information" || value === "abandoned";
}

export function getProductResearchDecisionLabel(status: ProductResearchDecisionStatus): string {
  return PRODUCT_RESEARCH_DECISION_OPTIONS.find((option) => option.value === status)?.label ?? status;
}
