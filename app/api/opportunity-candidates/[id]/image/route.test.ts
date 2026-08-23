import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  candidate: null as null | { id: string; sourceMetaJson: string },
}));

vi.mock("@/lib/server/accessPassword", () => ({
  checkAccessPassword: () => null,
  getAccessContext: () => ({ mode: "owner", token: "" }),
}));
vi.mock("@/lib/server/candidateAuthority", () => ({
  getAuthoritativeCandidate: (_ctx: unknown) => Promise.resolve(state.candidate),
}));

const { GET } = await import("./route");

function validIdentity() {
  return {
    schemaVersion: "market-screening-candidate-identity.v1",
    productionRegistrationId: "pr-1",
    batchManifestHash: "a".repeat(64),
    manifestId: "batch-1",
    marketplace: "US",
    productKey: "amazon:US:B0SAMPLE12",
    asin: "B0SAMPLE12",
    evidenceHash: "b".repeat(64),
  };
}
const PNG_BYTES = "iVBORw0KGgo=";

function validSnapshot(productKey: string, hash: string) {
  return {
    version: "market-screening-product-image.v1",
    source: "stage15_screening_preview_cache",
    status: "available",
    productKey,
    candidateIdentityHash: hash,
    mimeType: "image/png",
    bytes: 8,
    contentHash: "4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6",
    dataUrl: "data:image/png;base64," + PNG_BYTES,
    capturedAt: "2026-08-22T00:00:00.000Z",
  };
}

async function call(id: string) {
  return GET(new NextRequest("http://localhost/api/opportunity-candidates/" + id + "/image"), {
    params: Promise.resolve({ id }),
  } as never);
}

describe("候选图片路由（身份绑定 + 访问域）", () => {
  beforeEach(() => { state.candidate = null; });

  it("有效快照 → 200 图片字节（PNG）", async () => {
    const identity = validIdentity();
    const snapshot = validSnapshot("amazon:US:B0SAMPLE12", "1".repeat(64));
    state.candidate = { id: "cand-1", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: { ...identity, identityHash: "1".repeat(64) }, productImageSnapshot: snapshot }) };
    const response = await call("cand-1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.toString("base64").slice(0, 12)).toBe(PNG_BYTES);
  });

  it("损坏/身份冲突（identity 与图片 productKey 不一致）→ 404", async () => {
    const identity = validIdentity();
    const snapshot = validSnapshot("amazon:US:B0OTHERT4T", "1".repeat(64));
    state.candidate = { id: "cand-1", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: { ...identity, identityHash: "1".repeat(64) }, productImageSnapshot: snapshot }) };
    const response = await call("cand-1");
    expect(response.status).toBe(404);
  });


  it("swap 绑定：把另一候选（B0OTHERT4T）的合法图片塞给当前候选（B0SAMPLE12）→ 404（身份/绑定不符）", async () => {
    const identity = validIdentity();
    const snapshot = validSnapshot("amazon:US:B0OTHERT4T", "1".repeat(64));
    state.candidate = { id: "cand-1", sourceMetaJson: JSON.stringify({ marketScreeningIdentity: { ...identity, identityHash: "1".repeat(64) }, productImageSnapshot: snapshot }) };
    const response = await call("cand-1");
    expect(response.status).toBe(404);
  });

  it("候选不存在 / 越权（沙箱外）→ 404", async () => {
    state.candidate = null;
    expect((await call("cand-no")).status).toBe(404);
  });
});
