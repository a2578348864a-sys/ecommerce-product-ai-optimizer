import { describe, expect, it } from "vitest";
import { studioErrorMessage } from "./studioErrorMessage";

describe("studioErrorMessage", () => {
  it("maps stable provider categories to Chinese without exposing upstream text", () => {
    expect(studioErrorMessage({
      error: { code: "provider_auth_failed", message: "secret upstream stack and token" },
    }, "fallback")).toBe("AI 服务认证失败，请联系管理员检查服务配置。");
  });

  it("uses a controlled fallback for unknown errors", () => {
    expect(studioErrorMessage({
      error: { code: "unknown_provider_shape", message: "raw provider response" },
    }, "生成失败，请稍后重试。")).toBe("生成失败，请稍后重试。");
  });
});
