import { describe, expect, it, vi } from "vitest";
import {
  getOrCreateStudioAttempt,
  shouldRetainStudioAttempt,
} from "@/lib/client/studioIdempotency";

describe("Studio client idempotency attempts", () => {
  it("reuses one key for a retry of the same normalized request", () => {
    const createKey = vi.fn()
      .mockReturnValueOnce("key-1")
      .mockReturnValueOnce("key-2");
    const first = getOrCreateStudioAttempt(null, "same-request", createKey);
    const retry = getOrCreateStudioAttempt(first, "same-request", createKey);

    expect(retry).toEqual(first);
    expect(createKey).toHaveBeenCalledTimes(1);
  });

  it("creates a new key after request semantics change", () => {
    const createKey = vi.fn()
      .mockReturnValueOnce("key-1")
      .mockReturnValueOnce("key-2");
    const first = getOrCreateStudioAttempt(null, "request-a", createKey);
    const changed = getOrCreateStudioAttempt(first, "request-b", createKey);

    expect(changed.idempotencyKey).toBe("key-2");
    expect(createKey).toHaveBeenCalledTimes(2);
  });

  it("retains keys by default unless the response proves a safe terminal outcome", () => {
    expect(shouldRetainStudioAttempt("studio_request_in_progress")).toBe(true);
    expect(shouldRetainStudioAttempt("studio_ledger_failed")).toBe(true);
    expect(shouldRetainStudioAttempt("studio_image_result_unavailable")).toBe(true);
    expect(shouldRetainStudioAttempt("visitor_ai_quota_commit_failed")).toBe(true);
    expect(shouldRetainStudioAttempt("unknown_proxy_error")).toBe(true);
    expect(shouldRetainStudioAttempt(null)).toBe(true);
    expect(shouldRetainStudioAttempt("ai_timeout")).toBe(false);
    expect(shouldRetainStudioAttempt("image_request_already_failed")).toBe(false);
    expect(shouldRetainStudioAttempt("invalid_json")).toBe(false);
  });
});
