import { describe, expect, it, vi } from "vitest";
import { requestMarketScreeningCandidateResearch } from "@/lib/client/marketScreeningCandidateResearch";

describe("requestMarketScreeningCandidateResearch", () => {
  it("submits only the trusted product key and returns the authoritative Candidate handoff", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      ok: true,
      href: "/agent/run?source=opportunity&candidateId=candidate-123&productName=Desk+Stand",
      item: { id: "candidate-123", name: "Desk Stand" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const href = await requestMarketScreeningCandidateResearch(
      "amazon:US:B012345678",
      { "x-access-token": "test-token" },
      fetcher,
    );

    expect(href).toBe("/agent/run?source=opportunity&candidateId=candidate-123&productName=Desk+Stand");
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/opportunity-candidates/from-market-screening");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      "x-access-token": "test-token",
    });
    expect(JSON.parse(String(init?.body))).toEqual({ productKey: "amazon:US:B012345678" });
  });

  it("fails closed when the server does not return an /agent/run Candidate handoff", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      ok: true,
      href: "/agent/run?source=manual&productName=Desk+Stand",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(requestMarketScreeningCandidateResearch(
      "amazon:US:B012345678",
      {},
      fetcher,
    )).rejects.toThrow("商品研究入口无效");
  });

  it.each([
    {
      href: "/agent/run?source=opportunity&candidateId=candidate-999&productName=Desk+Stand",
      item: { id: "candidate-123", name: "Desk Stand" },
    },
    {
      href: "/agent/run?source=opportunity&candidateId=candidate-123&productName=Wrong+Product",
      item: { id: "candidate-123", name: "Desk Stand" },
    },
  ])("fails closed when the returned Candidate and handoff disagree", async ({ href, item }) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      href,
      item,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(requestMarketScreeningCandidateResearch(
      "amazon:US:B012345678",
      {},
      fetcher,
    )).rejects.toThrow("商品研究入口无效");
  });

  it("surfaces the server fail-closed reason", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      ok: false,
      error: { code: "candidate_not_ready", message: "该 Candidate 当前不可研究。" },
    }), { status: 409, headers: { "Content-Type": "application/json" } }));

    await expect(requestMarketScreeningCandidateResearch(
      "amazon:US:B012345678",
      {},
      fetcher,
    )).rejects.toThrow("该 Candidate 当前不可研究。");
  });
});
