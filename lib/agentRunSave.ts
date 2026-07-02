export function getAgentRunSaveErrorMessage(
  status: number,
  code?: string,
  message?: string,
): string {
  if (status === 401 || code === "invalid_access" || code === "unauthorized") {
    return "登录状态已失效，请回首页重新解锁。当前分析结果已保留，重新解锁后可返回 Agent 主链路继续保存。";
  }
  if (status === 403) {
    return message || "当前登录身份无权保存任务。当前分析结果已保留，可切换 Owner 后重试。";
  }
  return message || "保存任务失败，请稍后重试。";
}

export function canSubmitAgentRunSave(input: {
  hasResult: boolean;
  saving: boolean;
  savedTaskId: string;
  manualReady: boolean;
}): boolean {
  return input.hasResult && !input.saving && !input.savedTaskId && input.manualReady;
}
