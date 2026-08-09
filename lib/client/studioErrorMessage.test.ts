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

  it.each([
    ["real_ai_disabled", "真实 AI 服务暂未开启，本次没有消耗额度。"],
    ["provider_config_invalid", "AI 服务配置异常，请联系管理员检查服务配置。"],
    ["provider_auth_failed", "AI 服务认证失败，请联系管理员检查服务配置。"],
    ["provider_quota", "AI 服务额度不足，请补充额度后重试。"],
    ["provider_timeout", "AI 服务响应超时，请稍后重试。"],
    ["provider_unavailable", "AI 服务暂时不可用，请稍后重试。"],
    ["image_response_invalid", "图片服务返回的候选结果无效，请使用新的请求重新生成。"],
    ["image_validation_failed", "生成图片未通过格式或内容校验，请重新生成。"],
    ["image_storage_failed", "图片保存失败，请稍后重试。"],
    ["invalid_access", "登录状态已失效，请重新登录后再试。"],
  ])("maps %s to a stable product-facing Chinese message", (code, expected) => {
    expect(studioErrorMessage({ error: { code, message: "raw provider detail" } }, "fallback")).toBe(expected);
  });

  it("maps a non-JSON gateway response to timeout without exposing HTML", () => {
    const message = studioErrorMessage({
      error: { code: "unexpected_non_json_response", status: 504, message: "<html>gateway</html>" },
    }, "fallback");

    expect(message).toBe("AI 服务响应超时，请稍后重试。");
    expect(message).not.toContain("html");
  });
});
