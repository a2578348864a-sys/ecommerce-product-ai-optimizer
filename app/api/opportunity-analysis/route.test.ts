import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildMarketSignalSet, emptyMarketSignalSet } from "@/lib/marketSignal";

const mockCallAiJson = vi.fn();
const mockCollectMarketSignals = vi.fn();

vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: mockCallAiJson,
  getSafeAiClientErrorMessage: vi.fn((code: string) => `safe:${code}`),
}));

/**
 * V2：数据访问层必须被 mock —— 路由测试不能依赖本机 dev.db，
 * 否则 CI（无 dev.db）会失败。provider 的纯逻辑由 marketSignalProvider.test.ts 覆盖。
 */
vi.mock("@/lib/server/marketSignalProvider", () => ({
  collectMarketSignals: mockCollectMarketSignals,
  describeProviderOutcome: vi.fn((outcome: { reason: string }) => `provider:${outcome.reason}`),
}));

let POST: any;

function createRequest(body: unknown) {
  const json = JSON.stringify(body);
  return {
    headers: new Headers({ "content-type": "application/json", "content-length": String(json.length) }),
    text: async () => json,
  };
}

function candidate(index: number, overrides: Record<string, unknown> = {}) {
  return {
    title: `露营候选方向 ${index}`,
    reason: "值得研究，需要验证真实需求",
    painPoints: ["收纳体积偏大"],
    validationNeeded: ["同类供给强度未知"],
    ...overrides,
  };
}

function aiOk(candidates: unknown[]) {
  return { ok: true, data: { candidates }, providerCallStarted: true };
}

/** 构造一个「自动取到信号」的 provider 结果。 */
function providerOk(drafts: Array<{ kind: "review" | "competitor" | "keyword" | "pain_point"; text: string; rating?: number | null; source?: string }>) {
  const set = buildMarketSignalSet(drafts);
  return {
    set,
    sources: [{
      taskId: "task-owala",
      title: "Owala FreeSip Insulated Water Bottle",
      matchedTokens: ["water", "bottle"],
      matchedSurfaces: ["标题/商品名"],
      score: 6,
      signalCount: set.items.length,
      reviewCount: 13,
    }],
    reason: "ok" as const,
    scannedTaskCount: 5,
    totalTaskCount: 11,
    matchedTaskCount: 1,
    tokens: ["water", "bottle"],
  };
}

/** 构造一个「匹配不到已有证据」的 provider 结果。 */
function providerNoMatch() {
  return {
    set: emptyMarketSignalSet(),
    sources: [],
    reason: "no_match" as const,
    scannedTaskCount: 11,
    totalTaskCount: 11,
    matchedTaskCount: 0,
    tokens: ["露营桌"],
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  const mod = await import("./route");
  POST = mod.POST;
});

describe("POST /api/opportunity-analysis", () => {
  it("成功返回固定候选结构", async () => {
    mockCallAiJson.mockResolvedValueOnce(aiOk([candidate(1), candidate(2), candidate(3), candidate(4)]));

    const response = await POST(createRequest({ category: "户外露营用品", marketplace: "Amazon US" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.marketplace).toBe("Amazon US");
    expect(body.category).toBe("户外露营用品");
    expect(body.candidates).toHaveLength(4);
    expect(Object.keys(body.candidates[0]).sort()).toEqual([
      "evidenceBasis",
      "marketOpportunity",
      "painPoints",
      "reason",
      "researchRecommendation",
      "risks",
      "title",
      "userPainPoints",
      "validationNeeded",
    ]);
    expect(body.marketSignal.provided).toBe(false);
    expect(body.marketSignal.stats.acceptedItems).toBe(0);
  });

  it("目标市场缺省为 Amazon US", async () => {
    mockCallAiJson.mockResolvedValueOnce(aiOk([candidate(1), candidate(2), candidate(3)]));

    const response = await POST(createRequest({ category: "户外露营用品" }));
    const body = await response.json();

    expect(body.marketplace).toBe("Amazon US");
  });

  it("净化 AI 返回的违禁结论表达", async () => {
    mockCallAiJson.mockResolvedValueOnce(aiOk([
      candidate(1, {
        title: "露营爆款挂灯",
        reason: "这是爆款，一定赚钱，市场巨大",
        painPoints: ["高销量品类"],
        validationNeeded: ["是否真的一定赚钱"],
      }),
      candidate(2),
      candidate(3),
    ]));

    const response = await POST(createRequest({ category: "户外露营用品" }));
    const body = await response.json();
    const serialized = JSON.stringify(body.candidates);

    expect(response.status).toBe(200);
    expect(serialized).not.toContain("爆款");
    expect(serialized).not.toContain("一定赚钱");
    expect(serialized).not.toContain("高销量");
    expect(serialized).not.toContain("市场巨大");
  });

  it("AI 失败返回可恢复错误", async () => {
    mockCallAiJson.mockResolvedValueOnce({
      ok: false,
      error: { code: "timeout", message: "AI request timed out." },
      providerCallStarted: true,
    });

    const response = await POST(createRequest({ category: "户外露营用品" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("ai_unavailable");
    expect(body.error.recoverable).toBe(true);
    expect(body.error.message).toBe("safe:timeout");
  });

  it("候选不足 3 个返回可恢复错误", async () => {
    mockCallAiJson.mockResolvedValueOnce(aiOk([candidate(1), candidate(2)]));

    const response = await POST(createRequest({ category: "户外露营用品" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("insufficient_candidates");
    expect(body.error.recoverable).toBe(true);
  });

  it("缺少商品方向返回 400", async () => {
    const response = await POST(createRequest({ category: "   " }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_category");
    expect(mockCallAiJson).not.toHaveBeenCalled();
  });

  it("不支持的市场返回 400", async () => {
    const response = await POST(createRequest({ category: "户外露营用品", marketplace: "eBay US" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_marketplace");
    expect(mockCallAiJson).not.toHaveBeenCalled();
  });

  it("非法 JSON 请求体返回 400", async () => {
    const response = await POST({
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => "{not-json",
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("V1：提供真实市场信号时返回 deterministic 统计，并把信号注入提示词", async () => {
    mockCallAiJson.mockResolvedValueOnce(aiOk([
      candidate(1, {
        userPainPoints: [{ text: "卡扣过紧难安装", signalRefs: ["S1"] }],
        evidenceBasis: ["依据 S1：多条评论提到安装费力"],
        risks: ["样本量偏小"],
        researchRecommendation: { recommended: true, reason: "痛点具体，值得验证" },
      }),
      candidate(2),
      candidate(3),
    ]));

    const response = await POST(createRequest({
      category: "户外露营用品",
      marketSignalText: [
        "[review 2] 卡扣太紧，装了三次才装上",
        "[review 2] 卡扣太紧，装了三次才装上",
        "[competitor] 说明书只有英文，退换货流程复杂",
      ].join("\n"),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.marketSignal.provided).toBe(true);
    expect(body.marketSignal.stats.acceptedItems).toBe(2);
    expect(body.marketSignal.stats.duplicateItems).toBe(1);
    expect(body.marketSignal.stats.byKind.competitor).toBe(1);
    expect(body.marketSignal.stats.averageRating).toBe(2);

    const prompt = mockCallAiJson.mock.calls[0][0].messages[1].content as string;
    expect(prompt).toContain("S1");
    expect(prompt).toContain("S2");
    expect(prompt).not.toContain("S3");
    expect(prompt).toContain("UNTRUSTED DATA");
  });

  it("V1 防编造门禁：AI 引用不存在的信号编号一律剔除", async () => {
    mockCallAiJson.mockResolvedValueOnce(aiOk([
      candidate(1, {
        userPainPoints: [
          { text: "有真实出处的痛点", signalRefs: ["S1", "S9", "s1"] },
          { text: "全是编造出处的痛点", signalRefs: ["S99"] },
        ],
      }),
      candidate(2),
      candidate(3),
    ]));

    const response = await POST(createRequest({
      category: "户外露营用品",
      marketSignalText: "[review 2] 卡扣太紧，装了三次才装上",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    const points = body.candidates[0].userPainPoints;
    expect(points[0].signalRefs).toEqual(["S1"]);
    expect(points[1].signalRefs).toEqual([]);
  });

  it("V1：未提供信号时痛点不带任何编号，且提示词明确要求不得编造", async () => {
    mockCallAiJson.mockResolvedValueOnce(aiOk([
      candidate(1, { userPainPoints: [{ text: "假设痛点", signalRefs: ["S1"] }] }),
      candidate(2),
      candidate(3),
    ]));

    const response = await POST(createRequest({ category: "户外露营用品" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.marketSignal.provided).toBe(false);
    expect(body.candidates[0].userPainPoints[0].signalRefs).toEqual([]);

    const prompt = mockCallAiJson.mock.calls[0][0].messages[1].content as string;
    expect(prompt).toContain("未提供真实市场信号");
  });

  it("V1：超长信号被截断且不报错", async () => {
    mockCallAiJson.mockResolvedValueOnce(aiOk([candidate(1), candidate(2), candidate(3)]));

    const longSignal = Array.from({ length: 200 }, (_, index) => `[review] 第 ${index + 1} 条真实评论内容`).join("\n");
    const response = await POST(createRequest({ category: "户外露营用品", marketSignalText: longSignal }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.marketSignal.provided).toBe(true);
    expect(body.marketSignal.stats.acceptedItems).toBeLessThanOrEqual(120);
  });

  it("V2：autoSignal 缺省时不访问已有证据（保持 V1 行为）", async () => {
    mockCallAiJson.mockResolvedValueOnce(aiOk([candidate(1), candidate(2), candidate(3)]));

    const response = await POST(createRequest({ category: "insulated water bottle" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockCollectMarketSignals).not.toHaveBeenCalled();
    expect(body.autoSignal.requested).toBe(false);
    expect(body.autoSignal.reason).toBe("not_requested");
    expect(body.marketSignal.provided).toBe(false);
  });

  it("V2：autoSignal=true 时按商品方向自动取到信号并注入提示词", async () => {
    mockCollectMarketSignals.mockResolvedValueOnce(providerOk([
      { kind: "pain_point", text: "杯盖发霉：有评论反映杯盖内出现黑色霉斑。（1 条评论个别提及）", source: "已有研究任务《HydroJug Traveler 40oz》· VOC 痛点" },
      { kind: "review", text: "Received completely different product", rating: 1, source: "已有研究任务《HydroJug Traveler 40oz》· 评论 · B0CQVWT2NH" },
    ]));
    mockCallAiJson.mockResolvedValueOnce(aiOk([
      candidate(1, {
        userPainPoints: [{ text: "杯盖卫生问题", signalRefs: ["S1"] }],
        evidenceBasis: ["依据 S1"],
      }),
      candidate(2),
      candidate(3),
    ]));

    const response = await POST(createRequest({ category: "insulated water bottle", autoSignal: true }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockCollectMarketSignals).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "insulated water bottle" }),
    );
    expect(body.marketSignal.provided).toBe(true);
    expect(body.marketSignal.stats.acceptedItems).toBe(2);
    expect(body.autoSignal.requested).toBe(true);
    expect(body.autoSignal.reason).toBe("ok");
    expect(body.autoSignal.signalCount).toBe(2);
    expect(body.autoSignal.sources).toHaveLength(1);
    expect(body.autoSignal.message).toBe("provider:ok");
    expect(body.candidates[0].userPainPoints[0].signalRefs).toEqual(["S1"]);

    const prompt = mockCallAiJson.mock.calls[0][0].messages[1].content as string;
    expect(prompt).toContain("杯盖发霉");
    expect(prompt).toContain("UNTRUSTED DATA");
    // V2 收尾：来源改为「短编号引用 + 顶部索引」，完整来源仍可追溯
    expect(prompt).not.toContain("〔来源：");
    expect(prompt).toContain("来源索引");
    expect(prompt).toContain("T1 -> 已有研究任务《HydroJug Traveler 40oz》· VOC 痛点");
    expect(prompt).toContain("T2 -> 已有研究任务《HydroJug Traveler 40oz》· 评论 · B0CQVWT2NH");
    expect(prompt).toContain("〔T1·痛点描述〕");
    expect(prompt).toContain("〔T2·评论〕");
    // S 编号机制不变
    expect(prompt).toContain("S1 [痛点描述]");
    expect(prompt).toContain("S2 [评论] 评分1/5");
  });

  it("V2：手动信号在前、自动信号在后，合并后统一重新编号", async () => {
    mockCollectMarketSignals.mockResolvedValueOnce(providerOk([
      { kind: "keyword", text: "owala · 月搜索量约 4,471,241（平台估算）", source: "已有研究任务《Owala》· 关键词趋势" },
    ]));
    mockCallAiJson.mockResolvedValueOnce(aiOk([candidate(1), candidate(2), candidate(3)]));

    const response = await POST(createRequest({
      category: "insulated water bottle",
      autoSignal: true,
      marketSignalText: "[review 2] 卡扣太紧，装了三次才装上",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.marketSignal.stats.acceptedItems).toBe(2);

    const prompt = mockCallAiJson.mock.calls[0][0].messages[1].content as string;
    const manualIndex = prompt.indexOf("卡扣太紧");
    const autoIndex = prompt.indexOf("月搜索量约 4,471,241");
    expect(manualIndex).toBeGreaterThan(-1);
    expect(autoIndex).toBeGreaterThan(manualIndex);
    // 编号按合并后的顺序重排：手动 S1、自动 S2
    expect(prompt).toContain("S1 [评论] 评分2/5 卡扣太紧");
    expect(prompt).toContain("S2 [关键词] owala");
  });

  it("V2：自动取不到证据时不报错、不编造，退化为无信号并说明原因", async () => {
    mockCollectMarketSignals.mockResolvedValueOnce(providerNoMatch());
    mockCallAiJson.mockResolvedValueOnce(aiOk([
      candidate(1, { userPainPoints: [{ text: "编造的痛点", signalRefs: ["S1"] }] }),
      candidate(2),
      candidate(3),
    ]));

    const response = await POST(createRequest({ category: "露营桌", autoSignal: true }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.marketSignal.provided).toBe(false);
    expect(body.candidates[0].userPainPoints[0].signalRefs).toEqual([]);
    expect(body.autoSignal.requested).toBe(true);
    expect(body.autoSignal.reason).toBe("no_match");
    expect(body.autoSignal.totalTaskCount).toBe(11);
    expect(body.autoSignal.signalCount).toBe(0);

    const prompt = mockCallAiJson.mock.calls[0][0].messages[1].content as string;
    expect(prompt).toContain("未提供真实市场信号");
  });

  it("V2：读取已有证据失败时不阻断机会分析（fail-soft）", async () => {
    mockCollectMarketSignals.mockRejectedValueOnce(new Error("db unavailable"));
    mockCallAiJson.mockResolvedValueOnce(aiOk([candidate(1), candidate(2), candidate(3)]));

    const response = await POST(createRequest({ category: "insulated water bottle", autoSignal: true }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.candidates).toHaveLength(3);
    expect(body.marketSignal.provided).toBe(false);
    expect(body.autoSignal.requested).toBe(true);
    expect(body.autoSignal.reason).toBe("read_failed");
    expect(body.autoSignal.message).toContain("自动加载已有证据失败");
  });

  it("V2：候选直达时把 candidateId 透传给数据访问层", async () => {
    mockCollectMarketSignals.mockResolvedValueOnce(providerNoMatch());
    mockCallAiJson.mockResolvedValueOnce(aiOk([candidate(1), candidate(2), candidate(3)]));

    await POST(createRequest({ category: "insulated water bottle", autoSignal: true, candidateId: "cand-123" }));

    expect(mockCollectMarketSignals).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "insulated water bottle", candidateId: "cand-123" }),
    );
  });
});
