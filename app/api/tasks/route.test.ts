import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { SYSTEM_MANAGED_TASK_RESULT_KEYS } from "@/lib/server/taskResultNamespacePolicy";
import { buildMarketScreeningCandidateIdentity } from "@/lib/server/opportunityCandidateService";

/**
 * /api/tasks route 测试
 *
 * 测试 GET / POST 的访问密码保护。
 * Prisma 和数据库操作被 mock，只测试密码校验逻辑。
 */

const CORRECT_PASSWORD = "ci-test-password";

// Mock Prisma（vi.hoisted：route.ts 通过机会候选服务模块间接引用 db mock，不能在工厂里引用未初始化的顶层变量）
const mockPrisma = vi.hoisted(() => ({
  viralAnalysisRecord: {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({
      id: "test-001",
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
      type: "viral",
      decisionStatus: "pending",
      title: "测试商品",
      platform: "tiktok",
      productUrl: null,
      materialText: "测试素材",
      source: "ai",
      score: 80,
      level: "高潜力",
      oneLineSummary: "测试摘要",
      resultJson: '{"score":80,"level":"高潜力"}',
    }),
  },
  opportunityCandidate: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  v4ResearchRun: {
    findMany: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/lib/server/db", () => ({
  prisma: mockPrisma,
}));

// Mock normalizeTaskRecord to pass through
vi.mock("@/lib/tasks/normalizeTaskRecord", () => ({
  normalizeTaskRecord: vi.fn((record: Record<string, unknown>) => ({
    id: record.id ?? "test-001",
    createdAt: (record.createdAt instanceof Date ? record.createdAt.toISOString() : "2025-01-01T00:00:00.000Z"),
    updatedAt: (record.updatedAt instanceof Date ? record.updatedAt.toISOString() : "2025-01-01T00:00:00.000Z"),
    type: record.type ?? "viral",
    decisionStatus: record.decisionStatus ?? "pending",
    title: record.title ?? "测试",
    platform: record.platform ?? "manual",
    productUrl: record.productUrl ?? null,
    materialText: record.materialText ?? "",
    source: record.source ?? "ai",
    score: record.score ?? 0,
    level: record.level ?? "",
    oneLineSummary: record.oneLineSummary ?? "",
    result: typeof record.resultJson === "string" ? JSON.parse(record.resultJson) : {},
    agentType: record.type ?? "viral",
    status: "completed",
  })),
}));

let GET: any;
let POST: any;

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("ACCESS_PASSWORD", CORRECT_PASSWORD);
  vi.stubEnv("NODE_ENV", "test");
  // Clear mock call history
  vi.clearAllMocks();
  const mod = await import("./route");
  GET = mod.GET;
  POST = mod.POST;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function createRequest(params: {
  url?: string;
  headers?: Record<string, string>;
  method?: string;
  body?: unknown;
}): NextRequest {
  const urlStr = params.url ?? "http://localhost:3000/api/tasks";
  const url = new URL(urlStr);
  const headers = new Headers(params.headers);

  if (typeof params.body === "object" && params.body !== null) {
    headers.set("content-type", "application/json");
  }

  return {
    method: params.method ?? "GET",
    url: urlStr,
    nextUrl: url,
    headers,
    json: async () => params.body ?? {},
  } as unknown as NextRequest;
}

async function getJsonStatus(response: Response) {
  const cloned = response.clone();
  const body = await cloned.json();
  return { status: cloned.status, body };
}

describe("GET /api/tasks", () => {
  it("同一经过验证的 productKey、不同 Candidate 可以合并（完整身份解析器验证）", async () => {
    const record = (id: string, candidateId: string, updatedAt: string) => ({
      id,
      createdAt: new Date(updatedAt),
      updatedAt: new Date(updatedAt),
      type: "workflow",
      decisionStatus: "pending",
      title: "Same Product Title 商品研究",
      platform: "manual",
      productUrl: null,
      materialText: "Same Product Title",
      source: "agent_run",
      score: 1,
      level: "low",
      oneLineSummary: "",
      resultJson: JSON.stringify({
        productName: "Same Product Title",
        sourceMeta: { source: "opportunity", candidateId },
        candidateToTask: { version: 1, candidateId },
      }),
    });
    const identity = (suffix: string) => buildMarketScreeningCandidateIdentity({
      productionRegistrationId: `pr-${suffix}`,
      batchManifestHash: "a".repeat(64),
      manifestId: `batch-${suffix}`,
      marketplace: "US",
      productKey: "amazon:US:B0SAMPLE12",
      asin: "B0SAMPLE12",
      evidenceHash: "b".repeat(64),
    });
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([
      record("task-a-old", "candidate-a-old", "2026-08-20T00:00:00.000Z"),
      record("task-a-new", "candidate-a-new", "2026-08-21T00:00:00.000Z"),
    ]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(2);
    mockPrisma.opportunityCandidate.findMany.mockResolvedValueOnce([
      { id: "candidate-a-old", name: "Same Product Title", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: identity("old") }) },
      { id: "candidate-a-new", name: "Same Product Title", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: identity("new") }) },
    ]);

    const response = await GET(createRequest({ headers: { "x-access-password": CORRECT_PASSWORD } }));
    const body = await response.json();
    const [oldA, newA] = body.data.items;

    expect(oldA.productProjectKey).toMatch(/^ppk_[A-Za-z0-9_-]{43}$/);
    expect(oldA.productProjectKey).not.toContain("candidate");
    expect(newA.productProjectKey).toBe(oldA.productProjectKey);
    expect(JSON.stringify(body)).not.toContain("candidate-a-old");
    expect(JSON.stringify(body)).not.toContain("candidate-a-new");
    expect(JSON.stringify(body)).not.toContain("B0SAMPLE12");
    expect(JSON.stringify(body)).not.toContain("productionRegistrationId");
    expect(JSON.stringify(body)).not.toContain("identityHash");
  });

  it("同名但不同经过验证的 productKey 不得合并", async () => {
    const record = (id: string, candidateId: string, updatedAt: string) => ({
      id,
      createdAt: new Date(updatedAt),
      updatedAt: new Date(updatedAt),
      type: "workflow",
      decisionStatus: "pending",
      title: "Same Product Title 商品研究",
      platform: "manual",
      productUrl: null,
      materialText: "Same Product Title",
      source: "agent_run",
      score: 1,
      level: "low",
      oneLineSummary: "",
      resultJson: JSON.stringify({
        productName: "Same Product Title",
        sourceMeta: { source: "opportunity", candidateId },
        candidateToTask: { version: 1, candidateId },
      }),
    });
    const identity = (asin: string, suffix: string) => buildMarketScreeningCandidateIdentity({
      productionRegistrationId: `pr-${suffix}`,
      batchManifestHash: "a".repeat(64),
      manifestId: `batch-${suffix}`,
      marketplace: "US",
      productKey: `amazon:US:${asin}`,
      asin,
      evidenceHash: "b".repeat(64),
    });
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([
      record("task-a", "candidate-a", "2026-08-20T00:00:00.000Z"),
      record("task-b", "candidate-b", "2026-08-21T00:00:00.000Z"),
    ]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(2);
    mockPrisma.opportunityCandidate.findMany.mockResolvedValueOnce([
      { id: "candidate-a", name: "Same Product Title", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: identity("B0SAMPLE12", "a") }) },
      { id: "candidate-b", name: "Same Product Title", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: identity("B0OTHERT4T", "b") }) },
    ]);

    const response = await GET(createRequest({ headers: { "x-access-password": CORRECT_PASSWORD } }));
    const body = await response.json();
    const [a, b] = body.data.items;
    expect(a.productProjectKey).not.toBe(b.productProjectKey);
  });

  it("残缺 marketScreeningIdentity 不得合并（只含 productKey）", async () => {
    const record = (id: string, candidateId: string, updatedAt: string) => ({
      id,
      createdAt: new Date(updatedAt),
      updatedAt: new Date(updatedAt),
      type: "workflow",
      decisionStatus: "pending",
      title: "Same Product Title 商品研究",
      platform: "manual",
      productUrl: null,
      materialText: "Same Product Title",
      source: "agent_run",
      score: 1,
      level: "low",
      oneLineSummary: "",
      resultJson: JSON.stringify({
        productName: "Same Product Title",
        sourceMeta: { source: "opportunity", candidateId },
        candidateToTask: { version: 1, candidateId },
      }),
    });
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([
      record("task-a", "candidate-a", "2026-08-20T00:00:00.000Z"),
      record("task-b", "candidate-b", "2026-08-21T00:00:00.000Z"),
    ]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(2);
    mockPrisma.opportunityCandidate.findMany.mockResolvedValueOnce([
      { id: "candidate-a", name: "Same Product Title", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: { productKey: "amazon:US:B0SAMPLE12" } }) },
      { id: "candidate-b", name: "Same Product Title", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: { productKey: "amazon:US:B0SAMPLE12" } }) },
    ]);

    const response = await GET(createRequest({ headers: { "x-access-password": CORRECT_PASSWORD } }));
    const body = await response.json();
    const [a, b] = body.data.items;
    expect(a.productProjectKey).not.toBe(b.productProjectKey);
    expect(JSON.stringify(body)).not.toContain("B0SAMPLE12");
  });

  it("错误 identityHash 不得合并", async () => {
    const record = (id: string, candidateId: string, updatedAt: string) => ({
      id,
      createdAt: new Date(updatedAt),
      updatedAt: new Date(updatedAt),
      type: "workflow",
      decisionStatus: "pending",
      title: "Same Product Title 商品研究",
      platform: "manual",
      productUrl: null,
      materialText: "Same Product Title",
      source: "agent_run",
      score: 1,
      level: "low",
      oneLineSummary: "",
      resultJson: JSON.stringify({
        productName: "Same Product Title",
        sourceMeta: { source: "opportunity", candidateId },
        candidateToTask: { version: 1, candidateId },
      }),
    });
    const valid = buildMarketScreeningCandidateIdentity({
      productionRegistrationId: "pr-a",
      batchManifestHash: "a".repeat(64),
      manifestId: "batch-a",
      marketplace: "US",
      productKey: "amazon:US:B0SAMPLE12",
      asin: "B0SAMPLE12",
      evidenceHash: "b".repeat(64),
    });
    const tampered = { ...valid, identityHash: "f".repeat(64) };
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([
      record("task-a", "candidate-a", "2026-08-20T00:00:00.000Z"),
      record("task-b", "candidate-b", "2026-08-21T00:00:00.000Z"),
    ]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(2);
    mockPrisma.opportunityCandidate.findMany.mockResolvedValueOnce([
      { id: "candidate-a", name: "Same Product Title", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: tampered }) },
      { id: "candidate-b", name: "Same Product Title", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: tampered }) },
    ]);

    const response = await GET(createRequest({ headers: { "x-access-password": CORRECT_PASSWORD } }));
    const body = await response.json();
    const [a, b] = body.data.items;
    expect(a.productProjectKey).not.toBe(b.productProjectKey);
  });

  it("非法 productKey 不得合并（schema 完整但 productKey 与 marketplace/ASIN 不一致）", async () => {
    const record = (id: string, candidateId: string, updatedAt: string) => ({
      id,
      createdAt: new Date(updatedAt),
      updatedAt: new Date(updatedAt),
      type: "workflow",
      decisionStatus: "pending",
      title: "Same Product Title 商品研究",
      platform: "manual",
      productUrl: null,
      materialText: "Same Product Title",
      source: "agent_run",
      score: 1,
      level: "low",
      oneLineSummary: "",
      resultJson: JSON.stringify({
        productName: "Same Product Title",
        sourceMeta: { source: "opportunity", candidateId },
        candidateToTask: { version: 1, candidateId },
      }),
    });
    const corruptIdentity = {
      schemaVersion: "market-screening-candidate-identity.v1",
      productionRegistrationId: "pr-a",
      batchManifestHash: "a".repeat(64),
      manifestId: "batch-a",
      marketplace: "US",
      productKey: "amazon:us:B0SAMPLE12",
      asin: "B0SAMPLE12",
      identityHash: "a".repeat(64),
      evidenceHash: "b".repeat(64),
    };
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([
      record("task-a", "candidate-a", "2026-08-20T00:00:00.000Z"),
      record("task-b", "candidate-b", "2026-08-21T00:00:00.000Z"),
    ]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(2);
    mockPrisma.opportunityCandidate.findMany.mockResolvedValueOnce([
      { id: "candidate-a", name: "Same Product Title", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: corruptIdentity }) },
      { id: "candidate-b", name: "Same Product Title", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: corruptIdentity }) },
    ]);

    const response = await GET(createRequest({ headers: { "x-access-password": CORRECT_PASSWORD } }));
    const body = await response.json();
    const [a, b] = body.data.items;
    expect(a.productProjectKey).not.toBe(b.productProjectKey);
  });

  it("identity 与图片 productKey 冲突不得合并（fail-closed 而非信任其一）", async () => {
    const record = (id: string, candidateId: string, updatedAt: string) => ({
      id,
      createdAt: new Date(updatedAt),
      updatedAt: new Date(updatedAt),
      type: "workflow",
      decisionStatus: "pending",
      title: "Same Product Title 商品研究",
      platform: "manual",
      productUrl: null,
      materialText: "Same Product Title",
      source: "agent_run",
      score: 1,
      level: "low",
      oneLineSummary: "",
      resultJson: JSON.stringify({
        productName: "Same Product Title",
        sourceMeta: { source: "opportunity", candidateId },
        candidateToTask: { version: 1, candidateId },
      }),
    });
    const identity = (suffix: string) => buildMarketScreeningCandidateIdentity({
      productionRegistrationId: `pr-${suffix}`,
      batchManifestHash: "a".repeat(64),
      manifestId: `batch-${suffix}`,
      marketplace: "US",
      productKey: "amazon:US:B0SAMPLE12",
      asin: "B0SAMPLE12",
      evidenceHash: "b".repeat(64),
    });
    // 图片快照声明另一个商品键（candidateIdentityHash 匹配，productKey 冲突）
    const imageSnapshot = (suffix: string) => ({
      version: "market-screening-product-image.v1",
      source: "stage15_screening_preview_cache",
      status: "available",
      productKey: "amazon:US:B0OTHERT4T",
      candidateIdentityHash: identity(suffix).identityHash,
      mimeType: "image/png",
      bytes: 8,
      contentHash: "4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      capturedAt: "2026-08-20T00:00:00.000Z",
    });
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([
      record("task-a", "candidate-a", "2026-08-20T00:00:00.000Z"),
      record("task-b", "candidate-b", "2026-08-21T00:00:00.000Z"),
    ]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(2);
    mockPrisma.opportunityCandidate.findMany.mockResolvedValueOnce([
      { id: "candidate-a", name: "Same Product Title", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: identity("a"), productImageSnapshot: imageSnapshot("a") }) },
      { id: "candidate-b", name: "Same Product Title", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: identity("b"), productImageSnapshot: imageSnapshot("b") }) },
    ]);

    const response = await GET(createRequest({ headers: { "x-access-password": CORRECT_PASSWORD } }));
    const body = await response.json();
    const [a, b] = body.data.items;
    expect(a.productProjectKey).not.toBe(b.productProjectKey);
  });


  it("同一 candidateId 返回两条 Candidate：即使两条身份都合法且 productKey 相同，也不得合并两个任务", async () => {
    const record = (id: string, candidateId: string, updatedAt: string) => ({
      id,
      createdAt: new Date(updatedAt),
      updatedAt: new Date(updatedAt),
      type: "workflow",
      decisionStatus: "pending",
      title: "Same Product Title 商品研究",
      platform: "manual",
      productUrl: null,
      materialText: "Same Product Title",
      source: "agent_run",
      score: 1,
      level: "low",
      oneLineSummary: "",
      resultJson: JSON.stringify({
        productName: "Same Product Title",
        sourceMeta: { source: "opportunity", candidateId },
        candidateToTask: { version: 1, candidateId },
      }),
    });
    const identity = (suffix: string) => buildMarketScreeningCandidateIdentity({
      productionRegistrationId: `pr-${suffix}`,
      batchManifestHash: "a".repeat(64),
      manifestId: `batch-${suffix}`,
      marketplace: "US",
      productKey: "amazon:US:B0SAMPLE12",
      asin: "B0SAMPLE12",
      evidenceHash: "b".repeat(64),
    });
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([
      record("task-a", "candidate-dupe", "2026-08-20T00:00:00.000Z"),
      record("task-b", "candidate-dupe", "2026-08-21T00:00:00.000Z"),
    ]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(2);
    // 同一 candidateId 命中两条（数据异常：重复候选）——都带合法身份与相同 productKey
    mockPrisma.opportunityCandidate.findMany.mockResolvedValueOnce([
      { id: "candidate-dupe", name: "Same Product Title", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: identity("x") }) },
      { id: "candidate-dupe", name: "Same Product Title", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: identity("y") }) },
    ]);

    const response = await GET(createRequest({ headers: { "x-access-password": CORRECT_PASSWORD } }));
    const body = await response.json();
    const [a, b] = body.data.items;
    expect(a.productProjectKey).not.toBe(b.productProjectKey);
    const serialized = JSON.stringify(body);
    for (const key of ["candidateId", "productKey", "identityHash", "manifestId", "batchManifestHash", "evidenceHash", "productionRegistrationId"]) {
      expect(serialized).not.toContain('"' + key + '"');
    }
  });

  it("Candidate 缺失不得按 candidateId 合并", async () => {
    const record = (id: string, candidateId: string, updatedAt: string) => ({
      id,
      createdAt: new Date(updatedAt),
      updatedAt: new Date(updatedAt),
      type: "workflow",
      decisionStatus: "pending",
      title: "Same Product Title 商品研究",
      platform: "manual",
      productUrl: null,
      materialText: "Same Product Title",
      source: "agent_run",
      score: 1,
      level: "low",
      oneLineSummary: "",
      resultJson: JSON.stringify({
        productName: "Same Product Title",
        sourceMeta: { source: "opportunity", candidateId },
        candidateToTask: { version: 1, candidateId },
      }),
    });
    // 两个任务指向同一 candidateId，但候选不存在（DB 无记录）
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([
      record("task-a", "candidate-missing", "2026-08-20T00:00:00.000Z"),
      record("task-b", "candidate-missing", "2026-08-21T00:00:00.000Z"),
    ]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(2);
    mockPrisma.opportunityCandidate.findMany.mockResolvedValueOnce([]);

    const response = await GET(createRequest({ headers: { "x-access-password": CORRECT_PASSWORD } }));
    const body = await response.json();
    const [a, b] = body.data.items;
    expect(a.productProjectKey).not.toBe(b.productProjectKey);
    expect(JSON.stringify(body)).not.toContain("candidate-missing");
  });

  it("returns an allowlisted Owner result while resolving product image from the raw server binding", async () => {
    const fullHash = "a".repeat(64);
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([{
      id: "task-canary",
      createdAt: new Date("2026-08-03T00:00:00.000Z"),
      updatedAt: new Date("2026-08-03T00:00:00.000Z"),
      type: "workflow",
      decisionStatus: "continue",
      title: "Synthetic",
      platform: "manual",
      productUrl: null,
      materialText: "Synthetic",
      source: "agent_run",
      score: 1,
      level: "low",
      oneLineSummary: "Synthetic",
      resultJson: JSON.stringify({
        productName: "Synthetic",
        sourceMeta: { source: "opportunity", sourceTitle: "Synthetic source", candidateId: "candidate-exact", contextHash: fullHash },
        researchVerification: { inputHash: fullHash, resultHash: fullHash },
        futureSecretField: "hidden",
      }),
    }]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(1);
    mockPrisma.opportunityCandidate.findMany.mockResolvedValueOnce([]);
    const response = await GET(createRequest({ headers: { "x-access-password": CORRECT_PASSWORD } }));
    const body = await response.json();
    expect(body.data.items[0].result).toMatchObject({
      productName: "Synthetic",
      legacyListSummary: {
        hasCandidateSource: true,
        workflow: { productName: "Synthetic" },
      },
    });
    expect(body.data.items[0].result).not.toHaveProperty("sourceMeta");
    const serialized = JSON.stringify(body);
    for (const key of ["candidateId", "contextHash", "researchVerification", "inputHash", "resultHash", "futureSecretField"]) {
      expect(serialized).not.toContain(`\"${key}\"`);
    }
    expect(mockPrisma.opportunityCandidate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["candidate-exact"] } },
    }));
  });

  it("resolves an old Task image only from its exact authoritative Candidate id", async () => {
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([{
      id: "task-with-candidate",
      createdAt: new Date("2026-07-28T01:00:00.000Z"),
      updatedAt: new Date("2026-07-28T01:00:00.000Z"),
      type: "workflow",
      decisionStatus: "pending",
      title: "Same Product Title",
      platform: "manual",
      productUrl: null,
      materialText: "Same Product Title",
      source: "agent_run",
      score: 80,
      level: "yellow",
      oneLineSummary: "summary",
      resultJson: JSON.stringify({
        productName: "Same Product Title",
        sourceMeta: { source: "opportunity", candidateId: "candidate-exact" },
      }),
    }]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(1);
    mockPrisma.opportunityCandidate.findMany.mockResolvedValueOnce([{
      id: "candidate-exact",
      name: "Same Product Title",
      sourceMetaJson: JSON.stringify({
        marketScreeningIdentity: {
          productKey: "amazon:US:B012345678",
          identityHash: "1".repeat(64),
        },
        productImageSnapshot: {
          version: "market-screening-product-image.v1",
          source: "stage15_screening_preview_cache",
          status: "available",
          productKey: "amazon:US:B012345678",
          candidateIdentityHash: "1".repeat(64),
          mimeType: "image/png",
          bytes: 8,
          contentHash: "4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6",
          dataUrl: "data:image/png;base64,iVBORw0KGgo=",
          capturedAt: "2026-07-28T01:00:00.000Z",
        },
      }),
    }]);

    const response = await GET(createRequest({
      headers: { "x-access-password": CORRECT_PASSWORD },
    }));
    const { body } = await getJsonStatus(response);

    expect(body.data.items[0].productImage).toMatchObject({
      provenance: "candidate_fallback",
      contentHash: "4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6",
    });
    expect(mockPrisma.opportunityCandidate.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["candidate-exact"] } },
      select: { id: true, name: true, sourceMetaJson: true },
    });
  });

  it("无密码 → 返回 401", async () => {
    const request = createRequest({ url: "http://localhost:3000/api/tasks?type=viral" });
    const response = await GET(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(401);
    expect(body.error).toContain("访问密码错误");
  });

  it("错误密码 → 返回 401", async () => {
    const request = createRequest({
      url: "http://localhost:3000/api/tasks?type=viral",
      headers: { "x-access-password": "wrong-password" },
    });
    const response = await GET(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(401);
    expect(body.error).toContain("访问密码错误");
  });

  it("正确密码 → 返回 200 并正常查询", async () => {
    const request = createRequest({
      url: "http://localhost:3000/api/tasks?type=viral&limit=5",
      headers: { "x-access-password": CORRECT_PASSWORD },
    });
    const response = await GET(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
    expect(mockPrisma.viralAnalysisRecord.findMany).toHaveBeenCalled();
  });

  it("人工状态筛选 → 带入 decisionStatus where 条件", async () => {
    const request = createRequest({
      url: "http://localhost:3000/api/tasks?decisionStatus=need_info",
      headers: { "x-access-password": CORRECT_PASSWORD },
    });
    const response = await GET(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockPrisma.viralAnalysisRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ decisionStatus: "need_info" }),
    }));
  });

  it("V3 Current Research Normalization: scope=historical 包含已完成的当前研究（researchCompletion，decisionStatus 仍为 continue）", async () => {
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([{
      id: "task-completed",
      createdAt: new Date("2026-08-10T00:00:00.000Z"),
      updatedAt: new Date("2026-08-17T01:00:00.000Z"),
      type: "candidate_research",
      decisionStatus: "continue",
      title: "Completed Research",
      platform: "manual",
      productUrl: null,
      materialText: "Completed Research",
      source: "candidate_research",
      score: 1,
      level: "low",
      oneLineSummary: "Completed Research",
      resultJson: JSON.stringify({
        productName: "Completed Research",
        researchRecord: {
          schema: "product-research-record.v1",
          revision: 1,
          researchHash: "a".repeat(64),
          candidateId: "candidate-1",
          runId: "task-completed",
          contextHash: "b".repeat(64),
          createdAt: "2026-08-10T00:00:00.000Z",
          updatedAt: "2026-08-17T00:00:00.000Z",
          latestDecision: {
            decisionId: "11111111-1111-4111-8111-111111111111",
            revision: 1,
            status: "creative_ready",
            reason: "ok",
            nextAction: null,
            researchHash: "a".repeat(64),
            decidedAt: "2026-08-17T00:00:00.000Z",
            actor: { mode: "owner", actorRef: "owner:v1" },
          },
          decisionEvents: [],
        },
        researchCompletion: {
          schema: "research-completion.v1",
          status: "completed",
          completedAt: "2026-08-17T01:00:00.000Z",
          decisionId: "11111111-1111-4111-8111-111111111111",
          revision: 1,
          finalStatus: "creative_ready",
        },
      }),
    }]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(1);
    mockPrisma.opportunityCandidate.findMany.mockResolvedValueOnce([]);

    const response = await GET(createRequest({
      url: "http://localhost:3000/api/tasks?scope=historical",
      headers: { "x-access-password": CORRECT_PASSWORD },
    }));
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(200);
    expect(body.page.total).toBe(1);
    expect(body.data.items[0].id).toBe("task-completed");
        // P1-1：两阶段精确分页——SQL 不再做 lifecycle 启发式预过滤；全量窗口 + 稳定排序 + 精确分类后切片。
    // 行为断言（researchCompletion 出现在 historical）由上方 total/items 保留。
    expect(mockPrisma.viralAnalysisRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: expect.arrayContaining([
        expect.objectContaining({ createdAt: "desc" }),
        expect.objectContaining({ id: "desc" }),
      ]),
    }));
    expect(mockPrisma.viralAnalysisRecord.findMany).not.toHaveBeenCalledWith(expect.objectContaining({ take: expect.anything() }));
  });

  it("V3 Current Research Normalization: scope=research 不含已完成的当前研究（researchCompletion → historical）", async () => {
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([{
      id: "task-completed",
      createdAt: new Date("2026-08-10T00:00:00.000Z"),
      updatedAt: new Date("2026-08-17T01:00:00.000Z"),
      type: "candidate_research",
      decisionStatus: "continue",
      title: "Completed Research",
      platform: "manual",
      productUrl: null,
      materialText: "Completed Research",
      source: "candidate_research",
      score: 1,
      level: "low",
      oneLineSummary: "Completed Research",
      resultJson: JSON.stringify({
        productName: "Completed Research",
        researchRecord: {
          schema: "product-research-record.v1",
          revision: 1,
          researchHash: "a".repeat(64),
          candidateId: "candidate-1",
          runId: "task-completed",
          contextHash: "b".repeat(64),
          createdAt: "2026-08-10T00:00:00.000Z",
          updatedAt: "2026-08-17T00:00:00.000Z",
          latestDecision: {
            decisionId: "11111111-1111-4111-8111-111111111111",
            revision: 1,
            status: "creative_ready",
            reason: "ok",
            nextAction: null,
            researchHash: "a".repeat(64),
            decidedAt: "2026-08-17T00:00:00.000Z",
            actor: { mode: "owner", actorRef: "owner:v1" },
          },
          decisionEvents: [],
        },
        researchCompletion: {
          schema: "research-completion.v1",
          status: "completed",
          completedAt: "2026-08-17T01:00:00.000Z",
          decisionId: "11111111-1111-4111-8111-111111111111",
          revision: 1,
          finalStatus: "creative_ready",
        },
      }),
    }]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(1);
    mockPrisma.opportunityCandidate.findMany.mockResolvedValueOnce([]);

    const response = await GET(createRequest({
      url: "http://localhost:3000/api/tasks?scope=research",
      headers: { "x-access-password": CORRECT_PASSWORD },
    }));
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(200);
    // JS 侧 classifyResearchLifecycle：researchCompletion → historical_completed → 从商品研究移出
    expect(body.page.total).toBe(0);
    expect(body.data.items).toEqual([]);
  });

  it("P1-1：scope=research 精确分页——total 为精确匹配总数，hasMore 正确，翻页无重无漏（红灯契约）", async () => {
    const mk = (id: string, decisionStatus: string, verdict: string | null, completion: boolean) => ({
      id,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      type: "candidate_research",
      decisionStatus,
      title: id,
      platform: "manual",
      productUrl: null,
      materialText: id,
      source: "candidate_research",
      score: 1,
      level: "low",
      oneLineSummary: id,
      resultJson: JSON.stringify({
        productName: id,
        ...(verdict !== null ? {
          researchRecord: {
            schema: "product-research-record.v1", revision: 1, researchHash: "a".repeat(64),
            candidateId: "cand-" + id, runId: id, contextHash: "b".repeat(64),
            createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
            latestDecision: {
              decisionId: "11111111-1111-4111-8111-111111111111", revision: 1, status: verdict,
              reason: "r", nextAction: null, researchHash: "a".repeat(64),
              decidedAt: "2026-08-01T00:00:00.000Z", actor: { mode: "owner", actorRef: "owner:v1" },
            },
            decisionEvents: [],
          },
        } : {}),
        ...(completion ? {
          researchCompletion: {
            schema: "research-completion.v1", status: "completed", completedAt: "2026-08-01T01:00:00.000Z",
            decisionId: "11111111-1111-4111-8111-111111111111", revision: 1, finalStatus: "creative_ready",
          },
        } : {}),
      }),
    });
    // window：5 条 → 精确 active 4 条 + 1 条 historical（completion）
    const window = [
      mk("act-1", "continue", "creative_ready", false),
      mk("act-2", "continue", "creative_ready", false),
      mk("act-3", "pending", null, false),
      mk("act-4", "continue", "needs_information", false),
      mk("his-1", "continue", "creative_ready", true),
    ];
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValue(window);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValue(window.length);
    mockPrisma.opportunityCandidate.findMany.mockResolvedValue([]);

    const page1 = await GET(createRequest({
      url: "http://localhost:3000/api/tasks?scope=research&limit=2&offset=0",
      headers: { "x-access-password": CORRECT_PASSWORD },
    }));
    const raw1 = await getJsonStatus(page1);
        const b1 = raw1.body as { page: { total: number; hasMore: boolean; nextOffset: number | null }; data: { items: Array<{ id: string }> } };
    expect(b1.page.total).toBe(4);
    expect(b1.page.hasMore).toBe(true);
    // mock 不执行 orderBy：跨页无重无漏由下方两页并集断言验证（顺序由真实 DB orderBy 保证）
    expect(b1.data.items.map((i) => i.id)).toHaveLength(2);
    const ids1 = new Set(b1.data.items.map((i) => i.id));

    const page2 = await GET(createRequest({
      url: "http://localhost:3000/api/tasks?scope=research&limit=2&offset=2",
      headers: { "x-access-password": CORRECT_PASSWORD },
    }));
    const b2 = (await getJsonStatus(page2)).body as { page: { total: number; hasMore: boolean }; data: { items: Array<{ id: string }> } };
    expect(b2.page.total).toBe(4);
    const allIds = new Set([...ids1, ...b2.data.items.map((i) => i.id)]);
    expect(allIds.size).toBe(4);
    expect([...ids1].filter((x) => b2.data.items.some((y) => y.id === x))).toEqual([]);
    expect(allIds.has("act-1")).toBe(true);
    expect(allIds.has("act-2")).toBe(true);
    expect(allIds.has("act-3")).toBe(true);
    expect(allIds.has("act-4")).toBe(true);

    const page3 = await GET(createRequest({
      url: "http://localhost:3000/api/tasks?scope=research&limit=2&offset=4",
      headers: { "x-access-password": CORRECT_PASSWORD },
    }));
    const b3 = (await getJsonStatus(page3)).body as { page: { total: number; hasMore: boolean }; data: { items: Array<{ id: string }> } };
    expect(b3.page.total).toBe(4);
    expect(b3.data.items).toEqual([]);
  });

  it("P1-1：scope=historical 纳入 abandoned（旧字段 continue、无 completion），精确分页无重无漏（红灯契约）", async () => {
    const mk = (id: string, decisionStatus: string, verdict: string | null, rejected: boolean, completion: boolean) => ({
      id,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      type: "candidate_research",
      decisionStatus,
      title: id,
      platform: "manual",
      productUrl: null,
      materialText: id,
      source: "candidate_research",
      score: 1,
      level: "low",
      oneLineSummary: id,
      resultJson: JSON.stringify({
        productName: id,
        ...(verdict !== null ? {
          researchRecord: {
            schema: "product-research-record.v1", revision: 1, researchHash: "a".repeat(64),
            candidateId: "cand-" + id, runId: id, contextHash: "b".repeat(64),
            createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
            latestDecision: {
              decisionId: "11111111-1111-4111-8111-111111111111", revision: 1, status: verdict,
              reason: "r", nextAction: null, researchHash: "a".repeat(64),
              decidedAt: "2026-08-01T00:00:00.000Z", actor: { mode: "owner", actorRef: "owner:v1" },
            },
            decisionEvents: [],
          },
        } : {}),
        ...(completion ? {
          researchCompletion: {
            schema: "research-completion.v1", status: "completed", completedAt: "2026-08-01T01:00:00.000Z",
            decisionId: "11111111-1111-4111-8111-111111111111", revision: 1, finalStatus: "creative_ready",
          },
        } : {}),
      }),
    });
    // window：5 条 → 精确 historical 3 条（rejected + completion + abandoned special）+ 2 条 active
    const window = [
      mk("his-1", "rejected", null, true, false),
      mk("his-2", "continue", "creative_ready", false, true),
      mk("abn-1", "continue", "abandoned", false, false),
      mk("act-1", "continue", "creative_ready", false, false),
      mk("act-2", "pending", null, false, false),
    ];
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValue(window);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValue(window.length);
    mockPrisma.opportunityCandidate.findMany.mockResolvedValue([]);

    const page1 = await GET(createRequest({
      url: "http://localhost:3000/api/tasks?scope=historical&limit=2&offset=0",
      headers: { "x-access-password": CORRECT_PASSWORD },
    }));
    const raw1 = await getJsonStatus(page1);
        const b1 = raw1.body as { page: { total: number; hasMore: boolean }; data: { items: Array<{ id: string }> } };
    expect(b1.page.hasMore).toBe(true);
    const ids1 = new Set(b1.data.items.map((i) => i.id));
    const page2 = await GET(createRequest({
      url: "http://localhost:3000/api/tasks?scope=historical&limit=2&offset=2",
      headers: { "x-access-password": CORRECT_PASSWORD },
    }));
    const b2 = (await getJsonStatus(page2)).body as { page: { total: number; hasMore: boolean }; data: { items: Array<{ id: string }> } };
    const ids2 = new Set(b2.data.items.map((i) => i.id));
    const all = new Set([...ids1, ...ids2]);
    expect([...ids1].filter((x) => ids2.has(x))).toEqual([]);
    expect(all.has("abn-1")).toBe(true);
    expect(all.has("his-1")).toBe(true);
    expect(all.has("his-2")).toBe(true);
    expect(b1.page.total).toBe(3);
    expect(b2.page.total).toBe(3);
  });

  it("服务端未配置密码 → GET 返回 500", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("APP_ACCESS_PASSWORD", "");
    const mod = await import("./route");
    const request = createRequest({ url: "http://localhost:3000/api/tasks" });
    const response = await mod.GET(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(500);
    expect(body.error).toContain("ACCESS_PASSWORD");
  });
});

describe("GET /api/tasks 正式工作台数据域（scope=product-research）", () => {
  const workflowRecord = (id: string, candidateId: string, extra = {}) => ({
    id,
    createdAt: new Date("2026-08-20T00:00:00.000Z"),
    updatedAt: new Date("2026-08-21T00:00:00.000Z"),
    type: "workflow",
    decisionStatus: "pending",
    title: "商品研究记录",
    platform: "manual",
    productUrl: null,
    materialText: "商品研究记录",
    source: "agent_run",
    score: 1,
    level: "low",
    oneLineSummary: "",
    resultJson: JSON.stringify({
      productName: "商品研究记录",
      sourceMeta: { source: "opportunity", candidateId },
      candidateToTask: { version: 1, candidateId },
      ...extra,
    }),
  });

  it("只查询正式商品研究任务（type=workflow 且排除 source=mock）", async () => {
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(0);
    const response = await GET(createRequest({
      url: "http://localhost:3000/api/tasks?scope=product-research",
      headers: { "x-access-password": CORRECT_PASSWORD },
    }));
    expect(response.status).toBe(200);
    expect(mockPrisma.viralAnalysisRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: "workflow", source: { not: "mock" } }),
    }));
  });

  it("下发服务端 aiRunStatus（running），原始 result.status 不进入浏览器", async () => {
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([
      workflowRecord("task-run", "candidate-run", { status: "fake_raw_running" }),
    ]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(1);
    mockPrisma.v4ResearchRun.findMany.mockResolvedValueOnce([{
      candidateId: "candidate-run",
      status: "running",
      updatedAt: new Date("2026-08-21T00:00:00.000Z"),
    }]);
    const response = await GET(createRequest({
      url: "http://localhost:3000/api/tasks?scope=product-research",
      headers: { "x-access-password": CORRECT_PASSWORD },
    }));
    const body = await response.json();
    expect(body.data.items[0].aiRunStatus).toBe("running");
    expect(body.data.items[0].result).not.toHaveProperty("status");
    expect(JSON.stringify(body)).not.toContain("fake_raw_running");
  });

  it("failed_recoverable / failed_terminal / cancelled / completed 按最新 run 状态投影", async () => {
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([
      workflowRecord("task-r1", "cand-r1"),
      workflowRecord("task-r2", "cand-r2"),
      workflowRecord("task-r3", "cand-r3"),
      workflowRecord("task-r4", "cand-r4"),
    ]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(4);
    mockPrisma.v4ResearchRun.findMany.mockResolvedValueOnce([
      { candidateId: "cand-r1", status: "failed_recoverable", updatedAt: new Date("2026-08-21T00:00:00.000Z") },
      { candidateId: "cand-r2", status: "failed_terminal", updatedAt: new Date("2026-08-21T00:00:00.000Z") },
      { candidateId: "cand-r3", status: "cancelled", updatedAt: new Date("2026-08-21T00:00:00.000Z") },
      { candidateId: "cand-r4", status: "completed", updatedAt: new Date("2026-08-21T00:00:00.000Z") },
    ]);
    const response = await GET(createRequest({
      url: "http://localhost:3000/api/tasks?scope=product-research",
      headers: { "x-access-password": CORRECT_PASSWORD },
    }));
    const body = await response.json();
    const byId = new Map(body.data.items.map((item: { id: string; aiRunStatus: string }) => [item.id, item.aiRunStatus]));
    expect(byId.get("task-r1")).toBe("failed_recoverable");
    expect(byId.get("task-r2")).toBe("failed_terminal");
    expect(byId.get("task-r3")).toBe("cancelled");
    expect(byId.get("task-r4")).toBe("completed");
  });

  it("多个 run 取最新（updatedAt 最大），且无 run → not_started", async () => {
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([
      workflowRecord("task-latest", "cand-latest"),
      workflowRecord("task-none", "cand-none"),
    ]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(2);
    mockPrisma.v4ResearchRun.findMany.mockResolvedValueOnce([
      { candidateId: "cand-latest", status: "completed", updatedAt: new Date("2026-08-20T00:00:00.000Z") },
      { candidateId: "cand-latest", status: "failed_recoverable", updatedAt: new Date("2026-08-21T00:00:00.000Z") },
    ]);
    const response = await GET(createRequest({
      url: "http://localhost:3000/api/tasks?scope=product-research",
      headers: { "x-access-password": CORRECT_PASSWORD },
    }));
    const body = await response.json();
    const byId = new Map(body.data.items.map((item: { id: string; aiRunStatus: string }) => [item.id, item.aiRunStatus]));
    expect(byId.get("task-latest")).toBe("failed_recoverable");
    expect(byId.get("task-none")).toBe("not_started");
    // §6 runUpdatedAt = 最新 run 的 updatedAt（驱动项目代表规则）
    const byItem = new Map(body.data.items.map((item: { id: string; runUpdatedAt?: string }) => [item.id, item.runUpdatedAt ?? null]));
    expect(byItem.get("task-latest")).toBe("2026-08-21T00:00:00.000Z");
    expect(byItem.get("task-none")).toBeNull();
  });

  it("stale 优先于 run 状态（research_stale）", async () => {
    const staleResult = {
      productName: "已过期商品",
      browserEvidence: { schema: "browser-evidence.v1", snapshots: [{ fields: { asin: { value: "B0STALE12" } } }] },
      sourceMeta: { source: "opportunity", candidateId: "cand-stale" },
      candidateToTask: { version: 1, candidateId: "cand-stale" },
      researchCompletion: {
        schema: "research-completion.v1",
        status: "completed",
        completedAt: "2026-08-20T01:00:00.000Z",
        decisionId: "11111111-1111-4111-8111-111111111111",
        revision: 1,
        finalStatus: "creative_ready",
        evidenceHash: "a".repeat(64),
      },
    };
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce([{
      id: "task-stale",
      createdAt: new Date("2026-08-20T00:00:00.000Z"),
      updatedAt: new Date("2026-08-21T00:00:00.000Z"),
      type: "workflow",
      decisionStatus: "continue",
      title: "已过期商品",
      platform: "manual",
      productUrl: null,
      materialText: "已过期商品",
      source: "agent_run",
      score: 1,
      level: "low",
      oneLineSummary: "",
      resultJson: JSON.stringify(staleResult),
    }]);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(1);
    mockPrisma.v4ResearchRun.findMany.mockResolvedValueOnce([
      { candidateId: "cand-stale", status: "completed", updatedAt: new Date("2026-08-21T00:00:00.000Z") },
    ]);
    const response = await GET(createRequest({
      url: "http://localhost:3000/api/tasks?scope=product-research",
      headers: { "x-access-password": CORRECT_PASSWORD },
    }));
    const body = await response.json();
    expect(body.data.items[0].aiRunStatus).toBe("research_stale");
    // §3 统一状态出口：result 不得再出现 status（stale 只经 aiRunStatus / 命名 researchStale 字段）
    expect(body.data.items[0].result).not.toHaveProperty("status");
    expect(body.data.items[0].result.researchStale).toBe(true);
    // §3 Owner 绑定：ownerScope=owner 且 sandboxId=null
    expect(mockPrisma.v4ResearchRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerScope: "owner", sandboxId: null, candidateId: { in: ["cand-stale"] } }),
    }));
  });
});

describe("POST /api/tasks", () => {
  const validBody = {
    type: "viral",
    title: "测试",
    platform: "tiktok",
    source: "ai",
    materialText: "测试素材",
    result: { score: 80, level: "高潜力", oneLineSummary: "ok" },
  };

  it("无密码 → 返回 401", async () => {
    const request = createRequest({
      method: "POST",
      body: validBody,
    });
    const response = await POST(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(401);
    expect(body.error?.code || body.error).toBeTruthy();
  });

  it("body 中错误密码 → 返回 401", async () => {
    const request = createRequest({
      method: "POST",
      body: { ...validBody, accessPassword: "wrong-password" },
    });
    const response = await POST(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(401);
    expect(body.error?.code || body.error).toBeTruthy();
  });

  it("header 中正确密码 → 返回 200 并正常保存", async () => {
    const request = createRequest({
      method: "POST",
      headers: { "x-access-password": CORRECT_PASSWORD },
      body: validBody,
    });
    const response = await POST(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
    expect(mockPrisma.viralAnalysisRecord.create).toHaveBeenCalled();
  });

  it("body 中正确密码 → 返回 200 并正常保存", async () => {
    const request = createRequest({
      method: "POST",
      body: { ...validBody, accessPassword: CORRECT_PASSWORD },
    });
    const response = await POST(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
    expect(mockPrisma.viralAnalysisRecord.create).toHaveBeenCalled();
  });

  it("accessPassword 不会被写入数据库", async () => {
    const bodyWithPassword = { ...validBody, accessPassword: CORRECT_PASSWORD };
    const request = createRequest({
      method: "POST",
      body: bodyWithPassword,
    });
    await POST(request);

    // 获取 prisma create 被调用时传入的 data
    const createCall = mockPrisma.viralAnalysisRecord.create.mock.calls[0][0];
    const createData = createCall.data;

    // resultJson 是 JSON.stringify(body.result)，不应包含 accessPassword
    expect(createData.resultJson).not.toContain("accessPassword");
    expect(createData.resultJson).not.toContain(CORRECT_PASSWORD);

    // 任何字段都不应该包含密码
    const allValues = JSON.stringify(createData);
    expect(allValues).not.toContain(CORRECT_PASSWORD);

    // 返回的响应 data 也不应包含 accessPassword
    const response = await POST(request);
    // clone and read response body
    const { body: responseBody } = await (async () => {
      const cloned = response.clone();
      return { body: await cloned.json() };
    })();
    const responseStr = JSON.stringify(responseBody);
    expect(responseStr).not.toContain("accessPassword");
    expect(responseStr).not.toContain(CORRECT_PASSWORD);
  });

  it("服务端未配置密码 → POST 因 Demo guard 返回 401", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("APP_ACCESS_PASSWORD", "");
    const mod = await import("./route");
    const request = createRequest({
      method: "POST",
      body: validBody,
    });
    const response = await mod.POST(request);
    const { status, body } = await getJsonStatus(response);
    // requireAuthenticated returns 401 when no auth is configured (couldn't verify owner)
    expect(status).toBe(401);
    expect(body.error?.code || body.error).toBeTruthy();
  });
});

describe("POST /api/tasks reserved research namespace", () => {
  it.each(SYSTEM_MANAGED_TASK_RESULT_KEYS)("rejects the %s namespace before Owner storage", async (reservedKey) => {
    const request = createRequest({
      method: "POST",
      headers: { "x-access-password": CORRECT_PASSWORD },
      body: {
        type: "viral",
        title: "Synthetic",
        platform: "tiktok",
        source: "ai",
        materialText: "Synthetic",
        result: {
          score: 80,
          level: "low",
          oneLineSummary: "Synthetic",
          [reservedKey]: { injected: true },
        },
      },
    });
    const response = await POST(request);
    const { status, body } = await getJsonStatus(response);
    expect(status).toBe(400);
    expect(body.error.code).toBe("reserved_system_namespace");
    expect(mockPrisma.viralAnalysisRecord.create).not.toHaveBeenCalled();
  });
});
