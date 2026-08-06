import { describe, expect, it, vi, afterEach } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// R1: /agent/run 不再渲染独立页面，改为安全重定向到商品研究池候选详情页。
// Next.js redirect() 以抛 NEXT_REDIRECT 终止执行——mock 需模拟该语义。
const redirectMock = vi.fn((target: string) => {
  throw Object.assign(new Error(`NEXT_REDIRECT:${target}`), { digest: `NEXT_REDIRECT;replace;${target};307;` });
});
vi.mock("next/navigation", () => ({
  redirect: (target: string) => redirectMock(target),
}));

const { default: AgentRunPage } = await import("./page");

afterEach(() => {
  redirectMock.mockClear();
});

describe("/agent/run migration redirect", () => {
  it("redirects candidate visits to the candidate research page", async () => {
    await expect(AgentRunPage({
      searchParams: Promise.resolve({
        source: "opportunity",
        candidateId: "candidate-product-batch-a",
        productName: "Forged product name",
      }),
    })).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/opportunity-candidates/candidate-product-batch-a");
  });

  it("redirects no-Candidate visits back to the research pool", async () => {
    await expect(AgentRunPage({
      searchParams: Promise.resolve({}),
    })).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/opportunity-candidates");
  });

  it("guides research from the candidate research pool page", () => {
    const source = readFileSync(resolve(process.cwd(), "components/agent/AgentRunClient.tsx"), "utf8");
    expect(source).toContain('href="/opportunity-candidates"');
    expect(source).toContain("先从商品研究池选择商品");
  });
});
