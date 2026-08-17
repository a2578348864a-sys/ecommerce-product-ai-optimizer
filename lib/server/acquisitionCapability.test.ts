/**
 * V3 Acquisition Capability — resolver 状态矩阵测试（§5/§6/§58）
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/tools/collectors/amazon/browser-control", () => ({
  resolveSystemBrowser: vi.fn(),
}));

import { resolveSystemBrowser } from "@/tools/collectors/amazon/browser-control";
import {
  acquisitionGateError,
  isLocalAcquisitionEnabled,
  resolveBrowserAcquisitionCapability,
  resolveSourcingAcquisitionCapabilities,
} from "@/lib/server/acquisitionCapability";

const env = (flag?: string): NodeJS.ProcessEnv => (
  flag === undefined ? {} : { LOCAL_ACQUISITION_ENABLED: flag }
) as NodeJS.ProcessEnv;

describe("isLocalAcquisitionEnabled（fail-closed）", () => {
  it("未配置 → false", () => {
    expect(isLocalAcquisitionEnabled(env())).toBe(false);
  });
  it("true → true；非 true 值 → false", () => {
    expect(isLocalAcquisitionEnabled(env("true"))).toBe(true);
    expect(isLocalAcquisitionEnabled(env("1"))).toBe(false);
    expect(isLocalAcquisitionEnabled(env("TRUE"))).toBe(false);
  });
});

describe("resolveBrowserAcquisitionCapability", () => {
  it("公网（flag 缺失）→ local_env_required（不是 error）", () => {
    expect(resolveBrowserAcquisitionCapability(env())).toEqual({
      state: "local_env_required",
      reasonCategory: "local_environment_required",
    });
  });
  it("本地 + 浏览器存在 → available", () => {
    vi.mocked(resolveSystemBrowser).mockReturnValueOnce({ browser: "chrome", locationType: "system", executablePath: "C:\\x\\chrome.exe" });
    expect(resolveBrowserAcquisitionCapability(env("true"))).toEqual({ state: "available", reasonCategory: null });
  });
  it("本地 + 浏览器缺失 → unavailable/not_installed（≠ local_env_required，≠ error）", () => {
    vi.mocked(resolveSystemBrowser).mockReturnValueOnce(null);
    expect(resolveBrowserAcquisitionCapability(env("true"))).toEqual({
      state: "unavailable",
      reasonCategory: "not_installed",
    });
  });
});

describe("resolveSourcingAcquisitionCapabilities（1688 三能力）", () => {
  it("公网 → keyword/image/detail 全部 local_env_required", () => {
    const caps = resolveSourcingAcquisitionCapabilities(
      { cliToolAvailable: true, cliLoggedIn: true, imageExtensionAvailable: true, imageVersionCompatible: true },
      env(),
    );
    expect(caps.keyword.state).toBe("local_env_required");
    expect(caps.image.state).toBe("local_env_required");
    expect(caps.detail.state).toBe("local_env_required");
  });
  it("本地 + CLI 登录 + 扩展 READY → 全部 available", () => {
    const caps = resolveSourcingAcquisitionCapabilities(
      { cliToolAvailable: true, cliLoggedIn: true, imageExtensionAvailable: true, imageVersionCompatible: true },
      env("true"),
    );
    expect(caps.keyword).toEqual({ state: "available", reasonCategory: null });
    expect(caps.detail).toEqual({ state: "available", reasonCategory: null });
    expect(caps.image).toEqual({ state: "available", reasonCategory: null });
  });
  it("本地 + CLI 未安装 → keyword/detail unavailable/not_installed", () => {
    const caps = resolveSourcingAcquisitionCapabilities(
      { cliToolAvailable: false, cliLoggedIn: false, imageExtensionAvailable: false, imageVersionCompatible: false },
      env("true"),
    );
    expect(caps.keyword).toEqual({ state: "unavailable", reasonCategory: "not_installed" });
    expect(caps.detail).toEqual({ state: "unavailable", reasonCategory: "not_installed" });
  });
  it("本地 + CLI 在但未登录 → unavailable/not_configured", () => {
    const caps = resolveSourcingAcquisitionCapabilities(
      { cliToolAvailable: true, cliLoggedIn: false, imageExtensionAvailable: false, imageVersionCompatible: false },
      env("true"),
    );
    expect(caps.keyword).toEqual({ state: "unavailable", reasonCategory: "not_configured" });
  });
  it("本地 + 扩展版本不匹配 → image unavailable/not_configured（不假绿）", () => {
    const caps = resolveSourcingAcquisitionCapabilities(
      { cliToolAvailable: true, cliLoggedIn: true, imageExtensionAvailable: true, imageVersionCompatible: false },
      env("true"),
    );
    expect(caps.image).toEqual({ state: "unavailable", reasonCategory: "not_configured" });
    expect(caps.keyword.state).toBe("available");
  });
});

describe("acquisitionGateError（§30/§31：capability missing ≠ ERROR，用 409 不用 500）", () => {
  it("available → null（放行）", () => {
    expect(acquisitionGateError({ state: "available", reasonCategory: null }, "fallback")).toBeNull();
  });
  it("local_env_required → 409 local_environment_required", () => {
    const err = acquisitionGateError({ state: "local_env_required", reasonCategory: "local_environment_required" }, "fallback");
    expect(err).toEqual({ code: "local_environment_required", status: 409, message: "fallback" });
  });
  it("unavailable → 409 acquisition_unavailable（不是 500）", () => {
    const err = acquisitionGateError({ state: "unavailable", reasonCategory: "not_installed" }, "本机未检测到浏览器");
    expect(err).toEqual({ code: "acquisition_unavailable", status: 409, message: "本机未检测到浏览器" });
  });
});
