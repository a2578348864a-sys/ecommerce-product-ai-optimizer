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
  /**
   * true = 服务端已经明确拒绝构建 Listing 上下文（研究未完成 / 旧版任务 / 不存在等）。
   * 这类状态重试不可能成功，UI 必须禁用生成类按钮，避免用户点进死循环请求。
   * 与 safeToCallPassed 的区别：后者是"不能宣称通过"，这里是"根本没法开始"。
   */
  gateBlocked: boolean;
};

export type ListingV5SafetyInput = {
  /** 快照里是否存在草稿。 */
  hasListing: boolean;
  /** 持久化快照的 validation.status；缺失表示没有校验结果。 */
  validationStatus?: string | null;
  /** 快照的 stale 标志（研究/交接版本或上下文指纹已变化）。 */
  stale?: boolean | null;
  /** 服务端拒绝构建上下文时返回的错误码（GET 422 / 404）。 */
  errorCode?: string | null;
  /** 生成来源，仅用于文案：是否真的跑过修复 / 是否用了确定性回退。 */
  provider?: { fallbackUsed?: boolean; repairAttempted?: boolean } | null;
};

/**
 * 服务端拒绝构建上下文的错误码 → 用户可读原因。
 * 只有登记在这里的码才被视为"重试无意义"（isGateRefusalCode）。
 */
const GATE_REASON_TEXT: Record<string, string> = {
  // 该 reason 只在研究记录、hash、creative_ready、completion、stale、researchMode 全部通过后
  // 才可能出现（gate 阶梯第 4-9 级），所以这里可以如实说"研究已完成"。
  no_confirmed_facts: "研究已完成，但创作资料还没有人工确认：请在下方的确认区核对已确认事实并继续。",
  creative_confirmation_required: "还差一步：确认创作资料。研究中已有可用于 Listing 的商品事实，请先确认创作资料后再生成文案。",
  legacy_not_supported: "该任务属于旧版研究流程，V5 不会为它生成 Listing。",
  handoff_required: "还没有可用的 Listing 交接版本。",
  research_stale_requires_reconfirmation: "研究依据已更新，需要重新确认后才能生成。",
  research_not_completed: "商品研究尚未完成。请先完成研究，再生成 Listing。",
  decision_not_creative_ready: "研究决定尚未进入可创作状态（需要「继续」），请先完成人工决定。",
  research_hash_invalid: "研究合同校验未通过，请返回研究记录核对资料。",
  research_mode_invalid: "该任务的研究模式不支持生成 Listing。",
  blocking_issue_present: "研究资料存在阻断问题，请先在商品研究中处理。",
  task_not_found: "任务不存在，或当前身份没有访问权限。",
};

/** 该错误码是否代表服务端门禁拒绝（重试无意义）。 */
export function isGateRefusalCode(code: string | null | undefined): boolean {
  const value = typeof code === "string" ? code.trim() : "";
  return value.length > 0 && Object.prototype.hasOwnProperty.call(GATE_REASON_TEXT, value);
}

const STALE_DISPLAY: ListingV5SafetyDisplay = {
  tone: "stale",
  badge: "研究依据已更新，需重新生成",
  detail: "当前草稿对应旧版研究依据（研究/交接版本或上下文指纹已变化），不能作为本次交付使用，请重新生成后再审核。",
  safeToCallPassed: false,
  gateBlocked: false,
};

export function deriveListingV5SafetyDisplay(input: ListingV5SafetyInput): ListingV5SafetyDisplay {
  const errorCode = typeof input.errorCode === "string" ? input.errorCode.trim() : "";
  if (errorCode) {
    return {
      tone: "blocked",
      badge: "未通过服务端门禁，无法校验",
      detail: `${GATE_REASON_TEXT[errorCode] ?? "服务端未允许本次校验。"}（错误码：${errorCode}）`,
      safeToCallPassed: false,
      // 只有登记过的门禁拒绝才锁定按钮；未登记的码（如额度/网络类）应允许用户重试。
      gateBlocked: isGateRefusalCode(errorCode),
    };
  }

  if (input.stale === true) return STALE_DISPLAY;

  if (!input.hasListing) {
    return {
      tone: "unverified",
      badge: "尚未生成草稿",
      detail: "还没有草稿，因此没有任何校验结论。",
      safeToCallPassed: false,
      gateBlocked: false,
    };
  }

  const status = typeof input.validationStatus === "string" ? input.validationStatus.trim().toUpperCase() : "";

  if (status === "PASS") {
    return {
      tone: "pass",
      badge: "安全检查通过",
      detail: "Validator 判定 PASS；仍需人工复核后才能发布。",
      safeToCallPassed: true,
      gateBlocked: false,
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
      gateBlocked: false,
    };
  }

  if (!status) {
    return {
      tone: "unverified",
      badge: "缺少校验结论",
      detail: "草稿已存在，但没有读到 Validator 结论，不能视为通过校验。",
      safeToCallPassed: false,
      gateBlocked: false,
    };
  }

  return {
    tone: "blocked",
    badge: "安全检查未通过",
    detail: `Validator 未给出 PASS（当前状态：${status}），该草稿不能作为交付使用。`,
    safeToCallPassed: false,
    gateBlocked: false,
  };
}
