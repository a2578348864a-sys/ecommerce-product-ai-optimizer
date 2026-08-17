/**
 * V3 Acquisition Capability — 客户端视图类型与解析（纯函数）
 *
 * 只消费服务端 capability DTO（state / reasonCategory），
 * 不携带任何内部实现信息（路径/端口/token/版本）。
 */

export type AcquisitionCapabilityState = "available" | "local_env_required" | "unavailable";
export type AcquisitionCapabilityReason =
  | "local_environment_required"
  | "not_installed"
  | "not_configured"
  | null;

export type AcquisitionCapabilityView = {
  state: AcquisitionCapabilityState;
  reasonCategory: AcquisitionCapabilityReason;
};

export type SourcingCapabilitiesView = {
  keyword: AcquisitionCapabilityView;
  image: AcquisitionCapabilityView;
  detail: AcquisitionCapabilityView;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAcquisitionCapability(value: unknown): AcquisitionCapabilityView | null {
  if (!isRecord(value)) return null;
  const state = value.state;
  if (state !== "available" && state !== "local_env_required" && state !== "unavailable") return null;
  const reason = value.reasonCategory;
  const reasonCategory =
    reason === "local_environment_required" || reason === "not_installed" || reason === "not_configured" || reason === null
      ? reason
      : null;
  return { state, reasonCategory };
}

export function parseSourcingCapabilities(value: unknown): SourcingCapabilitiesView | null {
  if (!isRecord(value)) return null;
  const keyword = parseAcquisitionCapability(value.keyword);
  const image = parseAcquisitionCapability(value.image);
  const detail = parseAcquisitionCapability(value.detail);
  if (!keyword || !image || !detail) return null;
  return { keyword, image, detail };
}
