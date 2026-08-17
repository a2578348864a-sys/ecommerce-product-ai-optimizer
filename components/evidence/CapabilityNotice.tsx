import type { AcquisitionCapabilityView } from "@/lib/client/acquisitionCapability";

/**
 * V3 Acquisition Capability — 共享状态提示（§22/§45）
 * 统一「需要本地研究环境 / 暂不可用」的展示，不复制三套公网判断。
 * 样式沿用现有 slate/amber 小字风格，不改变视觉设计。
 */
export function CapabilityNotice({
  capability,
  localEnvMessage,
  unavailableMessage,
}: {
  capability: AcquisitionCapabilityView | null | undefined;
  /** local_env_required 时的产品文案（§36） */
  localEnvMessage: string;
  /** unavailable（本地诊断）时的文案；缺省用通用文案 */
  unavailableMessage?: string;
}) {
  if (!capability) return null;
  if (capability.state === "available") return null;
  if (capability.state === "local_env_required") {
    return (
      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800" data-testid="capability-notice-local-env">
        {localEnvMessage}
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600" data-testid="capability-notice-unavailable">
      {unavailableMessage ?? "该能力当前暂不可用。"}
    </div>
  );
}
