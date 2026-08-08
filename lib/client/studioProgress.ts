export type StudioProgressStatus = "pending" | "active" | "completed";

export type StudioProgressStep = {
  key: string;
  label: string;
  status: StudioProgressStatus;
  loading?: boolean;
};

function step(
  key: string,
  label: string,
  status: StudioProgressStatus,
  loading = false,
): StudioProgressStep {
  return { key, label, status, ...(loading ? { loading: true } : {}) };
}

export function deriveListingStudioProgress(input: {
  briefReady: boolean;
  isGenerating: boolean;
  hasResult: boolean;
}): StudioProgressStep[] {
  if (!input.briefReady) {
    return [
      step("brief", "资料确认", "active"),
      step("generate", "生成草稿", "pending"),
      step("review", "结果复核", "pending"),
    ];
  }
  if (input.hasResult) {
    return [
      step("brief", "资料确认", "completed"),
      step("generate", "生成草稿", "completed"),
      step("review", "结果复核", "active"),
    ];
  }
  return [
    step("brief", "资料确认", "completed"),
    step("generate", "生成草稿", "active", input.isGenerating),
    step("review", "结果复核", "pending"),
  ];
}

export function deriveImageStudioProgress(input: {
  briefReady: boolean;
  strategyReady: boolean;
  isGenerating: boolean;
  candidateCount: number;
  selectedImageId: string | null;
}): StudioProgressStep[] {
  if (!input.briefReady) {
    return [
      step("brief", "资料确认", "active"),
      step("strategy", "图片策略", "pending"),
      step("generate", "生成候选", "pending"),
      step("select", "人工选择", "pending"),
    ];
  }
  if (input.candidateCount > 0) {
    return [
      step("brief", "资料确认", "completed"),
      step("strategy", "图片策略", "completed"),
      step("generate", "生成候选", "completed"),
      step("select", "人工选择", input.selectedImageId ? "completed" : "active"),
    ];
  }
  if (input.isGenerating) {
    return [
      step("brief", "资料确认", "completed"),
      step("strategy", "图片策略", "completed"),
      step("generate", "生成候选", "active", true),
      step("select", "人工选择", "pending"),
    ];
  }
  return [
    step("brief", "资料确认", "completed"),
    step("strategy", "图片策略", "active"),
    step("generate", "生成候选", "pending"),
    step("select", "人工选择", "pending"),
  ];
}
