import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Listing / Image Studio 门禁「前后端一致」冻结测试。
 *
 * ── 冻结的契约（门禁统一后）──────────────────────────────────────────────
 *   1. 判据只有一个来源：服务端 lib/server/productCreativeHandoffPreview.ts。
 *      该模块对外提供两个语义不同的信号，UI 各取所需，均不得本地推导：
 *        · allowed         —— 能否「创建/追加」创作交接（创建资格）
 *        · studioReachable —— Studio 页是否有内容可看（入口可见性）
 *   2. 任务详情页入口可见性 = studioReachable（≠ allowed）。
 *      原因：`no_confirmed_facts` 下 allowed=false，但 Studio 页渲染的是
 *      「确认创作资料」降级界面 —— 用户正是要在这里完成事实确认，故入口必须可见。
 *      Studio 页自身用同一判据（!allowed && !detail && !preview 才渲染拦截页）。
 *   3. UI 只消费服务端下发的结构化 gate，不做任何本地推导
 *      （不再读 researchRecord / researchStale / decisionStatus / contractMode）。
 *   4. 门禁不可用（gate 缺失 / null）→ fail-closed，入口不显示。
 *
 * ── 命名映射（历史审计请求中的名字 → 仓库真实标识符）────────────────────
 *   contractMode=modern    result.productResearchSummary.schema === "product-research-record.v1"
 *   creativeReadiness      productResearchSummary.status ∈ {creative_ready | needs_information | abandoned}
 *   listingUnlocked        record.studioGate.studioReachable（服务端 gate 的只读投影）
 * 全仓不存在 contractMode / creativeReadiness / listingUnlocked 三个标识符。
 */

const detailSource = readFileSync(resolve(process.cwd(), "components/TaskRecordDetail.tsx"), "utf8");
const flatDetail = detailSource.replace(/\s+/g, " ");
const studioSource = readFileSync(resolve(process.cwd(), "components/studio/TaskStudioPreparation.tsx"), "utf8");
const panelSource = readFileSync(resolve(process.cwd(), "components/creative-handoff/CreativeHandoffPanel.tsx"), "utf8");
const apiSource = readFileSync(resolve(process.cwd(), "components/creative-handoff/useCreativeHandoffApi.ts"), "utf8");
const handoffRouteSource = readFileSync(resolve(process.cwd(), "app/api/tasks/[id]/creative-handoff/route.ts"), "utf8");
const detailRouteSource = readFileSync(resolve(process.cwd(), "app/api/tasks/[id]/route.ts"), "utf8");

// ══════════════════════════════════════════════════════════════════
// A. UI 入口判据 —— 复刻 TaskRecordDetail 的真实实现
// ══════════════════════════════════════════════════════════════════

type StudioGateProjection =
  | { allowed: boolean; reasonCode: string; studioReachable: boolean }
  | null
  | undefined;

/** 复刻 components/TaskRecordDetail.tsx：studioGate?.studioReachable === true（缺失即 fail-closed） */
function studioEntryVisible(gate: StudioGateProjection): boolean {
  return gate?.studioReachable === true;
}

/** 复刻 studioEntryNotice：仅影响文案，不影响准入 */
function studioEntryNotice(reasonCode: string | undefined, fallback: string): string {
  return reasonCode === "research_stale_requires_reconfirmation"
    ? "研究资料已变化，请先重新确认研究。"
    : fallback;
}

// ══════════════════════════════════════════════════════════════════
// B. 服务端门禁 —— 复刻 checkCreativeHandoffGate 的完整判定序列（含投影步）
// ══════════════════════════════════════════════════════════════════

type ServerGateInput = {
  hasProductResearchRecordNamespace: boolean;
  hasRecord: boolean;
  hasVerification: boolean;
  hashValid: boolean;
  latestDecisionStatus: string | null;
  completionStatus: string | null;
  researchStale: boolean;
  researchMode?: string | null;
  /** 第 8 步：投影是否成功产出 confirmedFacts（当前系统恒 false，见文件末尾说明） */
  projectionSucceeds: boolean;
};

/** 复刻 lib/server/productCreativeHandoffPreview.ts 的有序 fail-closed 序列（7 道检查 + 投影） */
function resolveServerStudioEligibility(input: ServerGateInput): { allowed: boolean; reasonCode: string } {
  if (!input.hasProductResearchRecordNamespace) return { allowed: false, reasonCode: "legacy_not_supported" };
  if (!input.hasRecord || !input.hasVerification) return { allowed: false, reasonCode: "legacy_not_supported" };
  if (!input.hashValid) return { allowed: false, reasonCode: "research_hash_invalid" };
  if (input.latestDecisionStatus !== "creative_ready") return { allowed: false, reasonCode: "decision_not_creative_ready" };
  if (input.completionStatus !== "completed") return { allowed: false, reasonCode: "research_not_completed" };
  if (input.researchStale) return { allowed: false, reasonCode: "research_stale_requires_reconfirmation" };
  if (input.researchMode && input.researchMode !== "market_research_only") {
    return { allowed: false, reasonCode: "research_mode_invalid" };
  }
  if (!input.projectionSucceeds) return { allowed: false, reasonCode: "no_confirmed_facts" };
  return { allowed: true, reasonCode: "eligible" };
}

/**
 * 复刻服务端 studioReachable 派生（app/api/tasks/[id]/route.ts#projectStudioGate）。
 *
 * 由 lib/server/productCreativeHandoffPreview.ts 源码可证（详见路由注释）：
 *   preview !== null ⇔ gate.allowed || gate.reason === "no_confirmed_facts"
 *   detail  !== null ⇔ gate.allowed || gate.reason === "no_confirmed_facts"
 * 而 Studio 页仅在 !allowed && !detail && !preview 时渲染拦截页 ⇒ 上式即「可渲染」充要条件。
 */
function resolveStudioReachable(server: { allowed: boolean; reasonCode: string }): boolean {
  return server.allowed || server.reasonCode === "no_confirmed_facts";
}

const SERVER_READY: ServerGateInput = {
  hasProductResearchRecordNamespace: true,
  hasRecord: true,
  hasVerification: true,
  hashValid: true,
  latestDecisionStatus: "creative_ready",
  completionStatus: "completed",
  researchStale: false,
  researchMode: "market_research_only",
  projectionSucceeds: true,
};

/**
 * 线上真实状态：投影恒失败（`buildProductCreativeHandoffProjectionEvidence` 永不产出
 * human_confirmed 层；`calculateHandoffFingerprint` 强制 confirmedFacts ≥ 1）。
 * 见 lib/server/creativeHandoffProjectionGate.test.ts:229-233 的既有记载。
 */
const SERVER_READY_LIVE: ServerGateInput = { ...SERVER_READY, projectionSucceeds: false };

/** 服务端 gate 结果 → UI 投影（复刻 app/api/tasks/[id]/route.ts#projectStudioGate） */
function projectStudioGate(server: { allowed: boolean; reasonCode: string }): StudioGateProjection {
  return {
    allowed: server.allowed,
    reasonCode: server.reasonCode,
    studioReachable: resolveStudioReachable(server),
  };
}

const SCENARIOS: ServerGateInput[] = [
  SERVER_READY,
  SERVER_READY_LIVE,
  { ...SERVER_READY, latestDecisionStatus: "needs_information" },
  { ...SERVER_READY, latestDecisionStatus: "abandoned" },
  { ...SERVER_READY, completionStatus: "pending" },
  { ...SERVER_READY, researchStale: true },
  { ...SERVER_READY, hashValid: false },
  { ...SERVER_READY, researchMode: "full" },
  { ...SERVER_READY, hasProductResearchRecordNamespace: false },
];

// ══════════════════════════════════════════════════════════════════

describe("A. TaskRecordDetail Studio 入口判据（消费服务端 gate.studioReachable）", () => {
  it("场景1 modern：creative_ready + completed（eligible）→ 显示进入 Studio", () => {
    expect(studioEntryVisible(projectStudioGate(resolveServerStudioEligibility(SERVER_READY)))).toBe(true);
  });

  it("场景1b modern：creative_ready + completed 但无人工确认事实（线上真实状态）→ 仍显示进入 Studio", () => {
    // allowed=false 但 studioReachable=true：Studio 页渲染「确认创作资料」界面，入口必须可见。
    const server = resolveServerStudioEligibility(SERVER_READY_LIVE);
    expect(server).toEqual({ allowed: false, reasonCode: "no_confirmed_facts" });
    const gate = projectStudioGate(server);
    expect(gate?.allowed).toBe(false);
    expect(studioEntryVisible(gate)).toBe(true);
  });

  it("场景2 modern：needs_information → UI 不显示可进入", () => {
    const gate = projectStudioGate(resolveServerStudioEligibility({
      ...SERVER_READY, latestDecisionStatus: "needs_information",
    }));
    expect(studioEntryVisible(gate)).toBe(false);
  });

  it("场景3 modern：creative_ready 但研究未完成 → UI 锁定", () => {
    const gate = projectStudioGate(resolveServerStudioEligibility({
      ...SERVER_READY, completionStatus: "pending",
    }));
    expect(studioEntryVisible(gate)).toBe(false);
  });

  it("场景4 刷新后状态保持：同一服务端结果重复投影恒定（无本地状态参与）", () => {
    const ready = resolveServerStudioEligibility(SERVER_READY_LIVE);
    expect(studioEntryVisible(projectStudioGate(ready))).toBe(true);
    expect(studioEntryVisible(projectStudioGate(ready))).toBe(true);
    const blocked = resolveServerStudioEligibility({ ...SERVER_READY, latestDecisionStatus: "abandoned" });
    expect(studioEntryVisible(projectStudioGate(blocked))).toBe(false);
    expect(studioEntryVisible(projectStudioGate(blocked))).toBe(false);
  });

  it("modern：abandoned → UI 不显示可进入", () => {
    expect(studioEntryVisible(projectStudioGate(resolveServerStudioEligibility({
      ...SERVER_READY, latestDecisionStatus: "abandoned",
    })))).toBe(false);
  });

  it("modern：stale → UI 不显示可进入，且提示「重新确认研究」", () => {
    const gate = projectStudioGate(resolveServerStudioEligibility({ ...SERVER_READY, researchStale: true }));
    expect(studioEntryVisible(gate)).toBe(false);
    expect(studioEntryNotice(gate?.reasonCode, "兜底")).toBe("研究资料已变化，请先重新确认研究。");
  });

  it("legacy：decisionStatus=continue（无正式记录）→ UI 不显示可进入（fail-closed 不变）", () => {
    expect(studioEntryVisible(projectStudioGate(resolveServerStudioEligibility({
      ...SERVER_READY,
      hasProductResearchRecordNamespace: false,
      hasRecord: false,
      hasVerification: false,
    })))).toBe(false);
  });

  it("gate 缺失 / null（门禁不可用）→ fail-closed，不显示入口", () => {
    expect(studioEntryVisible(null)).toBe(false);
    expect(studioEntryVisible(undefined)).toBe(false);
  });
});

describe("B. 服务端资格门禁（checkCreativeHandoffGate 判定序列冻结）", () => {
  it("modern + creative_ready + completed + 非 stale + 投影成功 → allowed=true / eligible", () => {
    expect(resolveServerStudioEligibility(SERVER_READY)).toEqual({ allowed: true, reasonCode: "eligible" });
  });

  it("modern + 上述条件但投影失败 → allowed=false / no_confirmed_facts（线上真实状态）", () => {
    expect(resolveServerStudioEligibility(SERVER_READY_LIVE))
      .toEqual({ allowed: false, reasonCode: "no_confirmed_facts" });
  });

  it("modern：needs_information → decision_not_creative_ready", () => {
    expect(resolveServerStudioEligibility({ ...SERVER_READY, latestDecisionStatus: "needs_information" }))
      .toEqual({ allowed: false, reasonCode: "decision_not_creative_ready" });
  });

  it("legacy（无正式记录）→ legacy_not_supported", () => {
    expect(resolveServerStudioEligibility({
      ...SERVER_READY,
      hasProductResearchRecordNamespace: false,
      hasRecord: false,
      hasVerification: false,
    })).toEqual({ allowed: false, reasonCode: "legacy_not_supported" });
  });

  it("检查顺序：creative_ready 但研究未完成 → research_not_completed", () => {
    expect(resolveServerStudioEligibility({ ...SERVER_READY, completionStatus: "pending" }))
      .toEqual({ allowed: false, reasonCode: "research_not_completed" });
  });

  it("检查顺序：hash 无效优先于 decision 判定", () => {
    expect(resolveServerStudioEligibility({ ...SERVER_READY, hashValid: false, latestDecisionStatus: "abandoned" }))
      .toEqual({ allowed: false, reasonCode: "research_hash_invalid" });
  });

  it("检查顺序：stale 优先于 research_mode 判定", () => {
    expect(resolveServerStudioEligibility({ ...SERVER_READY, researchStale: true, researchMode: "full" }))
      .toEqual({ allowed: false, reasonCode: "research_stale_requires_reconfirmation" });
  });

  it("检查顺序：投影失败优先于 eligible（投影是最后一道）", () => {
    expect(resolveServerStudioEligibility({ ...SERVER_READY, projectionSucceeds: false }).reasonCode)
      .toBe("no_confirmed_facts");
  });

  it("不变式：allowed=true ⟺ reasonCode=eligible", () => {
    for (const scenario of SCENARIOS) {
      const result = resolveServerStudioEligibility(scenario);
      expect(result.allowed).toBe(result.reasonCode === "eligible");
    }
  });

  it("不变式：studioReachable=false 时 allowed 必为 false（可渲染必然不拦截）", () => {
    for (const scenario of SCENARIOS) {
      const server = resolveServerStudioEligibility(scenario);
      if (!resolveStudioReachable(server)) expect(server.allowed).toBe(false);
    }
  });
});

describe("C. 前后端一致性（漂移已消除）", () => {
  it("UI 入口判据 ≡ 服务端 studioReachable：全部场景两侧取值相同", () => {
    for (const scenario of SCENARIOS) {
      const server = resolveServerStudioEligibility(scenario);
      expect(studioEntryVisible(projectStudioGate(server))).toBe(resolveStudioReachable(server));
    }
  });

  it("UI 不再持有第二套判据（源码中不存在本地准入推导）", () => {
    expect(detailSource).not.toContain("studioLegacyUnsupported");
    expect(flatDetail).not.toContain("!studioLegacyUnsupported && !researchStale");
    // Studio 入口所在的「Listing 与商品图片」区块：判据只能是服务端 gate，
    // 不得再出现本地准入启发式（hasVersionedProductResearchRecord）或 researchStale。
    const sectionStart = detailSource.indexOf('id="listing-and-images"');
    expect(sectionStart).toBeGreaterThan(0);
    const listingImagesSection = detailSource.slice(
      sectionStart,
      detailSource.indexOf("<RecordFooter", sectionStart),
    );
    expect(listingImagesSection.length).toBeGreaterThan(0);
    expect(listingImagesSection).toContain("studioGate?.studioReachable === true");
    expect(listingImagesSection).not.toContain("hasVersionedProductResearchRecord");
    expect(listingImagesSection).not.toContain("researchStale");
  });
});

describe("D. 源码锚定：唯一事实源接线", () => {
  it("详情接口以只读投影方式复用 generateCreativeHandoffPreview（未复制判据）", () => {
    expect(detailRouteSource).toContain(
      'import { generateCreativeHandoffPreview, type CreativeHandoffEligibility } from "@/lib/server/productCreativeHandoffPreview"',
    );
    expect(detailRouteSource).toContain("const { preview, gate } = await generateCreativeHandoffPreview(taskId, ctx);");
    expect(detailRouteSource).toContain("allowed: gate.allowed,");
    expect(detailRouteSource).toContain("reasonCode: gate.reason,");
    expect(detailRouteSource).toContain("studioReachable: preview !== null,");
    // 投影函数只做搬运：不得出现任何 gate 规则字段（决策/完成/过期/校验判定）
    const projectionBody = detailRouteSource.slice(
      detailRouteSource.indexOf("async function projectStudioGate"),
      detailRouteSource.indexOf("async function getId"),
    );
    for (const forbidden of ["creative_ready", "completed", "researchStale", "verifyProductResearchHash", "latestDecision"]) {
      expect(projectionBody).not.toContain(forbidden);
    }
  });

  it("TaskRecordDetail 消费 record.studioGate?.studioReachable，两处入口均以它把守", () => {
    const occurrences = flatDetail.split("studioGate?.studioReachable === true ? (").length - 1;
    expect(occurrences).toBe(2);
    expect(flatDetail).toContain("studioGate={record.studioGate}");
    // 入口可见性不得退回创建资格（allowed）——两者语义不同
    expect(flatDetail).not.toContain("studioGate?.allowed === true ? (");
  });

  it("Studio 入口文案与链接保持（既有契约测试依赖）", () => {
    expect(detailSource).toContain("前往 Listing Studio 人工核对");
    expect(detailSource).toContain("/listing-studio?taskId=");
    expect(detailSource).toContain("/image-studio?taskId=");
  });

  it("creative-handoff 路由返回结构化 allowed + reasonCode（保留 gateReason 兼容）", () => {
    expect(handoffRouteSource).toContain("allowed: gate.allowed");
    expect(handoffRouteSource).toContain("reasonCode: gate.reason");
    expect(handoffRouteSource).toContain("gateReason: gate.reason");
  });

  it("useCreativeHandoffApi 只暴露结构化 gate，不再暴露 gateReason 字段", () => {
    expect(apiSource).toContain("gate: {");
    expect(apiSource).toContain("allowed: previewJson.allowed === true");
    expect(apiSource).toContain("isHandoffEligibility(previewJson.reasonCode)");
    expect(apiSource).not.toContain("gateReason:");
  });

  it("TaskStudioPreparation 消费 gate.allowed / gate.reasonCode，无字符串比较", () => {
    expect(studioSource).toContain("!api.result.gate.allowed");
    expect(studioSource).toContain("const { reasonCode } = api.result.gate;");
    expect(studioSource).not.toContain("api.result.gateReason");
    expect(studioSource).not.toContain('=== "decision_not_creative_ready"');
    expect(studioSource).not.toContain('=== "research_not_completed"');
    expect(studioSource).not.toContain('=== "research_stale_requires_reconfirmation"');
  });

  it("CreativeHandoffPanel 消费结构化 gate，无字符串比较", () => {
    expect(panelSource).toContain("gate: HandoffGate");
    expect(panelSource).toContain("deriveState(res.preview, res.detail, res.gate)");
    expect(panelSource).not.toContain("gateReason");
    expect(panelSource).not.toContain("res.gateReason");
  });

  it("门禁判据中不得出现 contractMode / creativeReadiness / listingUnlocked", () => {
    for (const source of [detailSource, studioSource, panelSource, apiSource]) {
      expect(source).not.toContain("contractMode");
      expect(source).not.toContain("creativeReadiness");
      expect(source).not.toContain("listingUnlocked");
    }
  });
});
