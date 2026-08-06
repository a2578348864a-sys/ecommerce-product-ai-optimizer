import { describe, expect, it, vi, afterEach } from "vitest";

// R1: /agent/run 不再渲染独立页面，改为安全重定向。
// 安全契约：候选模式只透传 opaque candidateId；非候选模式回到研究池，不落到手工输入。
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

describe("/agent/run Candidate URL contract (redirect)", () => {
  it("redirects to the candidate research page with only the opaque candidateId", async () => {
    await expect(AgentRunPage({
      searchParams: Promise.resolve({
        source: "opportunity",
        candidateId: "sandbox_candidate_a",
        productName: "Visitor A secret product",
        sourceMeta: JSON.stringify({
          productName: "Visitor A secret product",
          asin: "A-SECRET-ASIN",
          productBatchId: "visitor-a-batch",
        }),
      }),
    })).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/opportunity-candidates/sandbox_candidate_a");
  });

  it("redirects manual product-name visits back to the research pool", async () => {
    await expect(AgentRunPage({
      searchParams: Promise.resolve({}),
    })).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/opportunity-candidates");
  });

  it("redirects malformed opportunity URLs to the research pool instead of falling back to manual", async () => {
    await expect(AgentRunPage({
      searchParams: Promise.resolve({ source: "opportunity" }),
    })).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/opportunity-candidates");
  });
});
