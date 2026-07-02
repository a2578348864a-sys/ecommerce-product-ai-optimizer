import { describe, expect, it } from "vitest";
import { canSubmitAgentRunSave, getAgentRunSaveErrorMessage } from "@/lib/agentRunSave";

describe("agentRunSave", () => {
  it("maps auth loss to a recovery-safe save message", () => {
    expect(getAgentRunSaveErrorMessage(401, "invalid_access", "Please login")).toBe(
      "登录状态已失效，请回首页重新解锁。当前分析结果已保留，重新解锁后可返回 Agent 主链路继续保存。",
    );
  });

  it("keeps forbidden saves clear without implying result loss", () => {
    expect(getAgentRunSaveErrorMessage(403, "demo_action_forbidden")).toBe(
      "当前登录身份无权保存任务。当前分析结果已保留，可切换 Owner 后重试。",
    );
  });

  it("blocks duplicate or incomplete save submissions", () => {
    expect(canSubmitAgentRunSave({ hasResult: true, saving: false, savedTaskId: "", manualReady: true })).toBe(true);
    expect(canSubmitAgentRunSave({ hasResult: false, saving: false, savedTaskId: "", manualReady: true })).toBe(false);
    expect(canSubmitAgentRunSave({ hasResult: true, saving: true, savedTaskId: "", manualReady: true })).toBe(false);
    expect(canSubmitAgentRunSave({ hasResult: true, saving: false, savedTaskId: "task-1", manualReady: true })).toBe(false);
    expect(canSubmitAgentRunSave({ hasResult: true, saving: false, savedTaskId: "", manualReady: false })).toBe(false);
  });
});
