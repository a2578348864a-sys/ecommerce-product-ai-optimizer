import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = { id: string; resultJson: string; updatedAt: string };
const state = vi.hoisted(() => ({
  row: null as (Row & { type: string; decisionStatus: string }) | null,
  updateCas: null as null | ((updated: Row, expectedUpdatedAt: string, expectedResultJson: string) => boolean),
}));

vi.mock("@/lib/server/accessPassword", () => ({
  checkAccessPassword: () => null,
  getAccessContext: () => ({ mode: "owner", token: "" }),
}));
vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: {
      findUnique: vi.fn(async () => state.row as never),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: { resultJson: string; updatedAt: Date | string } }) => {
        const row = state.row;
        if (!row) return { count: 0 };
        if (where.updatedAt && String(where.updatedAt) !== row.updatedAt) return { count: 0 };
        if (where.resultJson && where.resultJson !== row.resultJson) return { count: 0 };
        state.row = {
          ...row,
          resultJson: data.resultJson,
          updatedAt: data.updatedAt instanceof Date ? data.updatedAt.toISOString() : String(data.updatedAt),
        };
        return { count: 1 };
      }),
    },
  },
}));

const { GET, PUT } = await import("./route");

function makeRow(resultJson: Record<string, unknown>, updatedAt = "2026-08-22T10:00:00.000Z"): Row & { type: string; decisionStatus: string } {
  return { id: "task-x", type: "workflow", decisionStatus: "pending", resultJson: JSON.stringify(resultJson), updatedAt };
}

async function get() {
  return GET(new NextRequest("http://localhost/api/tasks/task-x/commercial-inputs"), { params: Promise.resolve({ id: "task-x" }) } as never);
}
async function put(body: unknown) {
  return PUT(new NextRequest("http://localhost/api/tasks/task-x/commercial-inputs", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "task-x" }) } as never);
}

describe("商业输入保存闭环（轮 6）", () => {
  beforeEach(() => { state.row = makeRow({}); state.updateCas = null; });

  it("GET 空 → {}；PUT 部分保存（仅 MOQ）→ 200；重新 GET 字段还在，其它未保存", async () => {
    const before = await (await get()).json();
    expect(before.ok).toBe(true);
    expect(before.inputs).toEqual({});
    const write = await (await put({ moq: 50, storageVersion: before.storageVersion })).json();
    expect(write.ok).toBe(true);
    const after = await (await get()).json();
    expect(after.inputs).toEqual({ moq: 50 });
  });

  it("部分保存字段合并语义：两次保存不互相覆盖", async () => {
    const v1 = (await (await get()).json()).storageVersion;
    await put({ purchasePrice: { value: 12.5, currency: "CNY" }, storageVersion: v1 });
    const v2 = (await (await get()).json()).storageVersion;
    await put({ moq: 100, storageVersion: v2 });
    const after = await (await get()).json();
    expect(after.inputs).toEqual({ purchasePrice: { value: 12.5, currency: "CNY" }, moq: 100 });
  });

  it("校验失败 → 400；未知字段拒绝", async () => {
    const bad = await (await put({ moq: 0 })).json();
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe("moq_positive_integer_required");
    const badField = await (await put({ hacker: true })).json();
    expect(badField.error.code).toBe("unknown_field:hacker");
  });

  it("并发冲突（storageVersion 不匹配）→ 409 且不覆盖", async () => {
    const v = (await (await get()).json()).storageVersion;
    // 另一保存先改
    await put({ moq: 1, storageVersion: v });
    // 旧版本再保存 → 409
    const conflicted = await (await put({ moq: 999, storageVersion: v }));
    expect(conflicted.status).toBe(409);
    const after = await (await get()).json();
    expect(after.inputs).toEqual({ moq: 1 }); // 未被 999 覆盖
  });

  it("已完成研究：写入商业输入后沿用既有 stale（candidateAnalysisContext 证据指纹变化）且不伪造 AI/人工决定", async () => {
    state.row = makeRow({
      productName: "完成品",
      candidateAnalysisContext: { sourceLabel: "src" },
      researchCompletion: {
        schema: "research-completion.v1",
        status: "completed",
        completedAt: "2026-08-20T01:00:00.000Z",
        decisionId: "11111111-1111-4111-8111-111111111111",
        revision: 1,
        finalStatus: "creative_ready",
        evidenceHash: "f".repeat(64),
      },
    });
    const v = (await (await get()).json()).storageVersion;
    const write = await (await put({ logisticsCost: { value: 8, currency: "USD" }, storageVersion: v }));
    expect(write.status).toBe(200);
    const body = await write.json();
    expect(body.stale).toBe(true);
    const raw = JSON.parse(state.row!.resultJson);
    expect(raw.researchRecord).toBeUndefined(); // 未伪造人工决定
    expect(raw.agentOutputSnapshot).toBeUndefined(); // 未自动重跑 AI
    expect(raw.candidateAnalysisContext.commercialInputs).toEqual({ logisticsCost: { value: 8, currency: "USD" } });
  });
});
