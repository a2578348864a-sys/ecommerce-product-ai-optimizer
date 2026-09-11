/**
 * Listing Studio V5 安全检查展示态（唯一来源）。
 *
 * 审计发现：客户端原来的绿色「安全检查通过」只判断 listing 是否存在，
 * 于是 BLOCK / REPAIRABLE / stale / 服务端门禁拒绝的情况下也会显示"通过"。
 * 这里把后端真实状态映射成唯一一份展示态，UI 只负责渲染，不再各自判断。
 *
 * 优先级（高 → 低）：服务端门禁拒绝 > 数据过期(stale) > 无草稿 > 校验状态。
 * stale 刻意排在 PASS 之前：草稿本身可能确实通过了校验，但它对应的是旧版
 * 研究依据，不能再当作本次交付的校验结论。
 */

export type ListingV5SafetyTone = "pass" | "review" | "blocked" | "stale" | "unverified";

export type ListingV5SafetyDisplay = {
  tone: ListingV5SafetyTone;
  /** 徽标短文案。 */
  badge: string;
  /** 一句话说明后端实际返回的状态。 */
  detail: string;
  /** 只有 true 时 UI 才允许出现"安全检查通过"这类通过性结论。 */
  safeToCallPassed: boolean;
};

export type ListingV5SafetyInput = {
  /** 快照里是否存在草稿。 */
  hasListing: boolean;
  /** 持久化快照的 validation.status；缺失表示没有校验结果。 */
  validationStatus?: string | null;
  /** 快照的 stale 标志（研究/交接版本或上下文指纹已变化）。 */
  stale?: boolean | null;
  /** 服务端拒绝构建上下文时返回的错误码（GET 422）。 */
  errorCode?: string | null;
  /** 生成来源，仅用于文案：是否真的跑过修复 / 是否用了确定性回退。 */
  provider?: { fallbackUsed?: boolean; repairAttempted?: boolean } | null;
};

const GATE_REASON_TEXT: Record<string, string> = {
  no_confirmed_facts: "还没有可用于 Listing 的已确认事实。",
  legacy_not_supported: "该任务属于旧版研究流程，V5 不会为它生成 Listing。",
  handoff_required: "还没有可用的 Listing 交接版本。",
  research_stale_requires_reconfirmation: "研究依据已更新，需要重新确认后才能生成。",
};

const STALE_DISPLAY: ListingV5SafetyDisplay = {
  tone: "stale",
  badge: "研究依据已更新，需重新生成",
  detail: "当前草稿对应旧版研究依据（研究/交接版本或上下文指纹已变化），不能作为本次交付使用，请重新生成后再审核。",
  safeToCallPassed: false,
};

export function deriveListingV5SafetyDisplay(input: ListingV5SafetyInput): ListingV5SafetyDisplay {
  const errorCode = typeof input.errorCode === "string" ? input.errorCode.trim() : "";
  if (errorCode) {
    return {
      tone: "blocked",
      badge: "未通过服务端门禁，无法校验",
      detail: `${GATE_REASON_TEXT[errorCode] ?? "服务端未允许本次校验。"}（错误码：${errorCode}）`,
      safeToCallPassed: false,
    };
  }

  if (input.stale === true) return STALE_DISPLAY;

  if (!input.hasListing) {
    return {
      tone: "unverified",
      badge: "尚未生成草稿",
      detail: "还没有草稿，因此没有任何校验结论。",
      safeToCallPassed: false,
    };
  }

  const status = typeof input.validationStatus === "string" ? input.validationStatus.trim().toUpperCase() : "";

  if (status === "PASS") {
    return {
      tone: "pass",
      badge: "安全检查通过",
      detail: "Validator 判定 PASS；仍需人工复核后才能发布。",
      safeToCallPassed: true,
    };
  }

  if (status === "REPAIRABLE") {
    const repaired = input.provider?.repairAttempted === true;
    return {
      tone: "review",
      badge: repaired ? "已自动修复，仍需人工复核" : "存在待修复项，仍需人工复核",
      detail: repaired
        ? "Validator 判定 REPAIRABLE，已执行一次结构化修复；修复后的文本仍未被判定为 PASS。"
        : "Validator 判定 REPAIRABLE，且本次没有执行修复；该草稿不能作为通过校验的交付。",
      safeToCallPassed: false,
    };
  }

  if (!status) {
    return {
      tone: "unverified",
      badge: "缺少校验结论",
      detail: "草稿已存在，但没有读到 Validator 结论，不能视为通过校验。",
      safeToCallPassed: false,
    };
  }

  return {
    tone: "blocked",
    badge: "安全检查未通过",
    detail: `Validator 未给出 PASS（当前状态：${status}），该草稿不能作为交付使用。`,
    safeToCallPassed: false,
  };
}
