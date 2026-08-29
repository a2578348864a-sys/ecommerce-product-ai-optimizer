import { describe, expect, it } from "vitest";
import { browserUseCollectStateReducer, buildSaveBrowserUsePayload, INITIAL_BROWSER_USE_COLLECT_STATE, type BrowserUseCollectState } from "./BrowserUseCollectButton";

describe("BrowserUseCollectButton 状态机（轮 9）", () => {
  const preview = {
    schema: "browser-use-research-preview.v1", kind: "competitor", seedAsin: "B0SAMPLE12", marketplace: "US",
    sourceUrl: "https://www.amazon.com/dp/B0SAMPLE12", capturedAt: "2026-08-14T02:00:00.000Z",
    results: [{ asin: "B0COMP0002", title: "T", price: 10 }], missing: [], failureReason: null,
  };

  it("START→collecting；成功→preview（带预览 ID）；取消→idle 且无数据残留", () => {
    const started = browserUseCollectStateReducer(INITIAL_BROWSER_USE_COLLECT_STATE, { type: "START" });
    expect(started.phase).toBe("collecting");
    const previewed = browserUseCollectStateReducer(started, { type: "COLLECT_SUCCEEDED", preview: preview as never, previewId: "bup_preview_abc1234567" });
    expect(previewed.phase).toBe("preview");
    expect(previewed.previewId).toBe("bup_preview_abc1234567");
    const cancelled = browserUseCollectStateReducer(previewed, { type: "CANCEL" });
    expect(cancelled.phase).toBe("idle");
    expect(cancelled.previewId).toBeNull();
    expect(cancelled.preview).toBeNull();
  });

  it("需登录/验证码/权限不足 → 对应阶段（fail-closed，未保存）；普通失败→collect_failed", () => {
    const s1 = browserUseCollectStateReducer(INITIAL_BROWSER_USE_COLLECT_STATE, { type: "COLLECT_FAILED", code: "login_required", message: "x" });
    expect(s1.phase).toBe("login_required");
    const s2 = browserUseCollectStateReducer(INITIAL_BROWSER_USE_COLLECT_STATE, { type: "COLLECT_FAILED", code: "captcha_required", message: "x" });
    expect(s2.phase).toBe("captcha_required");
    const s3 = browserUseCollectStateReducer(INITIAL_BROWSER_USE_COLLECT_STATE, { type: "COLLECT_FAILED", code: "permission_insufficient", message: "x" });
    expect(s3.phase).toBe("permission_insufficient");
    const s4 = browserUseCollectStateReducer(INITIAL_BROWSER_USE_COLLECT_STATE, { type: "COLLECT_FAILED", code: "other", message: "x" });
    expect(s4.phase).toBe("collect_failed");
  });

  it("确认保存成功/失败不会伪造成功；无预览时保存被拒绝", () => {
    const started = browserUseCollectStateReducer(INITIAL_BROWSER_USE_COLLECT_STATE, { type: "START" });
    const previewed = browserUseCollectStateReducer(started, { type: "COLLECT_SUCCEEDED", preview: preview as never, previewId: "bup_preview_abc1234567" });
    const saving = browserUseCollectStateReducer(previewed, { type: "SAVING" });
    expect(saving.phase).toBe("saving");
    const saved = browserUseCollectStateReducer(saving, { type: "SAVED", count: 1, skipped: [] });
    expect(saved.phase).toBe("idle");
    expect(saved.savedCount).toBe(1);
    expect(saved.message).toBe("已保存 1 条自动采集证据。");
    const failed = browserUseCollectStateReducer(INITIAL_BROWSER_USE_COLLECT_STATE, { type: "SAVE_FAILED", message: "conflict" });
    expect(failed.phase).toBe("error");
  });
});

describe("确认保存契约（轮 11）", () => {
  it("buildSaveBrowserUsePayload：必须原样携带当前证据区版本；缺失版本或预览 → null（禁止发送 undefined）", () => {
    const version = { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-14T02:00:00.000Z" };
    const payload = buildSaveBrowserUsePayload("bup_preview_abc1234567", version);
    expect(payload).toEqual({ action: "save_browser_use", previewId: "bup_preview_abc1234567", expectedStorageVersion: version });
    expect(buildSaveBrowserUsePayload("bup_preview_abc1234567", null)).toBeNull();
    expect(buildSaveBrowserUsePayload("bup_preview_abc1234567", undefined)).toBeNull();
    expect(buildSaveBrowserUsePayload(null, version)).toBeNull();
    expect(buildSaveBrowserUsePayload("bup_preview_abc1234567", { resultJsonHash: "", updatedAt: "2026-08-14T02:00:00.000Z" })).toBeNull();
  });

  it("版本未就绪时确认保存被拒（phase=error，提示刷新；不发送请求）", () => {
    const withPreview = browserUseCollectStateReducer(INITIAL_BROWSER_USE_COLLECT_STATE, { type: "START" });
    const previewed = browserUseCollectStateReducer(withPreview, { type: "COLLECT_SUCCEEDED", preview: { kind: "competitor", results: [] } as never, previewId: "bup_preview_abc1234567" });
    const blocked = browserUseCollectStateReducer(previewed, { type: "SAVE_FAILED", message: "版本信息尚未就绪，请刷新后重试。未发送保存请求。" });
    expect(blocked.phase).toBe("error");
    expect(blocked.message).toContain("版本信息尚未就绪");
  });

  it("409 并发冲突必须以明确文案呈现（内容已变化，请重新采集/刷新），不冒充保存成功", () => {
    const withPreview = browserUseCollectStateReducer(INITIAL_BROWSER_USE_COLLECT_STATE, { type: "START" });
    const previewed = browserUseCollectStateReducer(withPreview, { type: "COLLECT_SUCCEEDED", preview: { kind: "keyword", results: [] } as never, previewId: "bup_preview_x" });
    const conflicted = browserUseCollectStateReducer(previewed, { type: "SAVE_FAILED", message: "内容已变化，请重新采集/刷新后重试。" });
    expect(conflicted.phase).toBe("error");
    expect(conflicted.message).toContain("内容已变化");
    expect(conflicted.savedCount).toBeNull();
  });
});
