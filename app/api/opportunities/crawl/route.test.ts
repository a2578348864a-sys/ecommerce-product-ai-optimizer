import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  crawlUrls: vi.fn(),
  normalizeResults: vi.fn(),
  scoreCandidates: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => ({ ok: true, context: { mode: "owner" } }),
}));
vi.mock("@/lib/server/radarCrawler", () => ({ crawlUrls: mocks.crawlUrls }));
vi.mock("@/lib/server/radarNormalize", () => ({ normalizeResults: mocks.normalizeResults }));
vi.mock("@/lib/server/radarScore", () => ({ scoreCandidates: mocks.scoreCandidates }));

import { POST } from "./route";

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/opportunities/crawl", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.crawlUrls.mockResolvedValue({ results: [], warnings: [] });
  mocks.normalizeResults.mockReturnValue({ items: [], warnings: [] });
  mocks.scoreCandidates.mockReturnValue([]);
});

describe("opportunities crawl request bounds", () => {
  it("rejects oversized actual UTF-8 input before crawler invocation", async () => {
    const response = await POST(request({
      input: `https://example.com/item\n${"中".repeat(11_000)}`,
    }) as never);

    expect(response.status).toBe(413);
    expect(mocks.crawlUrls).not.toHaveBeenCalled();
  });

  it("passes a bounded authenticated public URL to the controlled crawler", async () => {
    const response = await POST(request({ input: "https://example.com/item" }) as never);

    expect(response.status).toBe(200);
    expect(mocks.crawlUrls).toHaveBeenCalledWith(["https://example.com/item"]);
  });
});
