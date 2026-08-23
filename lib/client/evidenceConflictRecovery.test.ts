import { describe, expect, it } from "vitest";
import { resolveEvidenceConflictRecovery, CONFLICT_RETRY_MESSAGE } from "@/lib/client/evidenceConflictRecovery";

describe("resolveEvidenceConflictRecovery（轮 12：保存/导入/确认共用冲突决策）", () => {
  it("409 且未重试过 → 重试一次（无提示）", () => {
    expect(resolveEvidenceConflictRecovery(409, null, false)).toEqual({ retry: true, message: null });
  });
  it("task_result_conflict 且未重试过 → 重试一次", () => {
    expect(resolveEvidenceConflictRecovery(200, "task_result_conflict", false)).toEqual({ retry: true, message: null });
  });
  it("409 且已重试过 → 不重试 + 简洁重试提示", () => {
    expect(resolveEvidenceConflictRecovery(409, "task_result_conflict", true)).toEqual({ retry: false, message: CONFLICT_RETRY_MESSAGE });
  });
  it("非冲突（500 / server_error）→ 不重试、无提示", () => {
    expect(resolveEvidenceConflictRecovery(500, "server_error", false)).toEqual({ retry: false, message: null });
  });
  it("提示文案统一：资料刚刚更新，请再试一次", () => {
    expect(CONFLICT_RETRY_MESSAGE).toBe("资料刚刚更新，请再试一次。");
  });
});
