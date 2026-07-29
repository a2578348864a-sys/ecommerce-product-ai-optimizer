import { describe, expect, it } from "vitest";
import AgentRunPage from "./page";

describe("/agent/run Candidate URL contract", () => {
  it("passes only the opaque candidateId in opportunity mode and ignores forged context", async () => {
    const element = await AgentRunPage({
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
    });

    expect(element.props).toMatchObject({
      candidateMode: true,
      candidateId: "sandbox_candidate_a",
    });
    expect(element.props.initialProductName).toBeUndefined();
    expect(element.props.initialSourceMeta).toBeUndefined();
  });

  it("keeps manual product-name hydration without entering Candidate mode", async () => {
    const element = await AgentRunPage({
      searchParams: Promise.resolve({ productName: "Manual Product" }),
    });

    expect(element.props).toMatchObject({
      candidateMode: false,
      initialProductName: "Manual Product",
    });
  });

  it("keeps malformed opportunity URLs in invalid Candidate mode instead of falling back to manual", async () => {
    const element = await AgentRunPage({
      searchParams: Promise.resolve({
        source: "opportunity",
        productName: "Forged fallback",
      }),
    });

    expect(element.props).toMatchObject({ candidateMode: true });
    expect(element.props.candidateId).toBeUndefined();
    expect(element.props.initialProductName).toBeUndefined();
  });
});
