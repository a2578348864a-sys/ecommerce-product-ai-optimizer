import { describe, expect, it } from "vitest";

import AgentRunPage from "./page";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

  it("guides a no-Candidate visit back to the authoritative research pool", () => {
    const source = readFileSync(resolve(process.cwd(), "components/agent/AgentRunClient.tsx"), "utf8");
    expect(source).toContain('href="/opportunity-candidates"');
    expect(source).toContain("先从商品研究池选择商品");
    expect(source).toContain("旧版手工输入兼容");
  });
});
