import { describe, expect, it } from "vitest";

import AgentRunPage from "./page";

describe("/agent/run ProductBatch handoff", () => {
  it("accepts only an opaque candidateId and ignores forged display context", async () => {
    const element = await AgentRunPage({
      searchParams: Promise.resolve({
        source: "opportunity",
        candidateId: "candidate-product-batch-a",
        productName: "Forged product name",
      }),
    });

    expect(element.props.candidateMode).toBe(true);
    expect(element.props.candidateId).toBe("candidate-product-batch-a");
    expect(element.props.initialProductName).toBeUndefined();
    expect(element.props.initialSourceMeta).toBeUndefined();
  });

  it("does not hydrate any ProductBatch context without candidateId", async () => {
    const element = await AgentRunPage({
      searchParams: Promise.resolve({
        source: "opportunity",
        productName: "Forged product name",
      }),
    });

    expect(element.props.candidateMode).toBe(true);
    expect(element.props.candidateId).toBeUndefined();
    expect(element.props.initialProductName).toBeUndefined();
    expect(element.props.initialSourceMeta).toBeUndefined();
  });
});
