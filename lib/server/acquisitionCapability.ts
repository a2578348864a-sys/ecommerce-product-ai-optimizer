/**
 * V3 Acquisition Capability — 公网/本地采集能力统一判定（TARGETED DEPLOYMENT UX）
 *
 * 区分三类语义（§1/§6）：
 * - local_env_required：该能力属于 Owner 本地研究环境（Windows Chrome / Bridge / Helper / CLI），
 *   当前 runtime（如公网服务器）没有 —— 不是错误，是环境边界。
 * - unavailable：能力理论上属于当前环境，但配置缺失 / 尚未安装 / 未登录。
 * - available：配置存在且 runtime 健康。
 *
 * 判定依据（§3/§39）：LOCAL_ACQUISITION_ENABLED runtime flag（fail-closed 默认 false）
 * + 真实 readiness probe（resolveSystemBrowser / 1688 toolStatus）。
 * 不使用 hostname/IP 硬编码。DTO 只暴露 state/reasonCategory，不泄漏路径/端口/token。
 */

import "server-only";

import { resolveSystemBrowser } from "@/tools/collectors/amazon/browser-control";

export const LOCAL_ACQUISITION_ENV = "LOCAL_ACQUISITION_ENABLED";

export type AcquisitionCapabilityState = "available" | "local_env_required" | "unavailable";
export type AcquisitionCapabilityReason =
  | "local_environment_required"
  | "not_installed"
  | "not_configured"
  | null;

export type AcquisitionCapability = {
  state: AcquisitionCapabilityState;
  reasonCategory: AcquisitionCapabilityReason;
};

export type SourcingAcquisitionCapabilities = {
  keyword: AcquisitionCapability;
  image: AcquisitionCapability;
  detail: AcquisitionCapability;
};

/** 产品文案（§36）——公网环境提示；本地 unavailable 场景保留诊断性 fallback 文案 */
export const BROWSER_LOCAL_ENV_REQUIRED_MESSAGE =
  "实时页面采集需要在本地研究环境使用。已保存的页面证据仍可正常查看。";
export const REVIEW_LOCAL_ENV_REQUIRED_MESSAGE =
  "自动采集评论需要在本地研究环境使用；你仍可粘贴导入评论，并使用已有评论进行 VOC 分析。";
export const SOURCING_LOCAL_ENV_REQUIRED_MESSAGE =
  "实时找货需要在本地研究环境使用。已保存并确认的供应证据仍可正常查看。";

/** fail-closed：未显式开启即视为非本地采集环境 */
export function isLocalAcquisitionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[LOCAL_ACQUISITION_ENV] === "true";
}

/**
 * Amazon Browser / VOC auto-collection 共用同一浏览器采集能力（§42/§43）：
 * 先 flag gate，再真实 probe（resolveSystemBrowser 仅路径检查，不启动浏览器）。
 */
export function resolveBrowserAcquisitionCapability(
  env: NodeJS.ProcessEnv = process.env,
): AcquisitionCapability {
  if (!isLocalAcquisitionEnabled(env)) {
    return { state: "local_env_required", reasonCategory: "local_environment_required" };
  }
  const browser = resolveSystemBrowser();
  return browser
    ? { state: "available", reasonCategory: null }
    : { state: "unavailable", reasonCategory: "not_installed" };
}

/**
 * 1688 三能力（keyword / image / detail）映射（§15/§44）：
 * 复用现有 toolStatus（R13 handshake 结果），不重写握手。
 */
export function resolveSourcingAcquisitionCapabilities(
  input: {
    cliToolAvailable: boolean;
    cliLoggedIn: boolean;
    imageExtensionAvailable: boolean;
    imageVersionCompatible: boolean;
  },
  env: NodeJS.ProcessEnv = process.env,
): SourcingAcquisitionCapabilities {
  const cap = (state: AcquisitionCapabilityState, reasonCategory: AcquisitionCapabilityReason): AcquisitionCapability =>
    ({ state, reasonCategory });
  if (!isLocalAcquisitionEnabled(env)) {
    return {
      keyword: cap("local_env_required", "local_environment_required"),
      image: cap("local_env_required", "local_environment_required"),
      detail: cap("local_env_required", "local_environment_required"),
    };
  }
  const cliCap = (): AcquisitionCapability => {
    if (!input.cliToolAvailable) return cap("unavailable", "not_installed");
    if (!input.cliLoggedIn) return cap("unavailable", "not_configured");
    return cap("available", null);
  };
  const imageCap = (): AcquisitionCapability => {
    if (!input.imageExtensionAvailable) return cap("unavailable", "not_installed");
    if (!input.imageVersionCompatible) return cap("unavailable", "not_configured");
    return cap("available", null);
  };
  return {
    keyword: cliCap(),
    image: imageCap(),
    detail: cliCap(),
  };
}

/**
 * 采集动作前置 Gate（§30/§31）：
 * capability 非 available → 409 typed（local_environment_required / acquisition_unavailable），
 * 不是 500（这不是 server crash）。unavailable 的 fallbackMessage 由调用方给出本地诊断文案。
 */
export function acquisitionGateError(
  capability: AcquisitionCapability,
  fallbackMessage: string,
): { code: string; status: number; message: string } | null {
  if (capability.state === "available") return null;
  if (capability.state === "local_env_required") {
    return { code: "local_environment_required", status: 409, message: fallbackMessage };
  }
  return { code: "acquisition_unavailable", status: 409, message: fallbackMessage };
}

/** 本地 unavailable 场景的浏览器诊断文案（保留本地诊断能力，§38；不泄漏内部路径） */
export function browserUnavailableMessage(reasonCategory: AcquisitionCapabilityReason): string {
  switch (reasonCategory) {
    case "not_installed":
      return "本机未检测到可用的 Chrome/Edge 浏览器，无法进行页面采集。";
    case "not_configured":
      return "浏览器采集工具未完成配置。";
    default:
      return "浏览器采集当前不可用。";
  }
}
