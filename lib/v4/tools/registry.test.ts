import { describe, expect, it } from "vitest";

import type { ToolCallEnvelope } from "@/lib/v4/tools/envelope";
import { buildToolEnvelope, executeMarketTool } from "@/lib/v4/tools/registry";

function call(toolName: string, overrides: Partial<Parameters<typeof buildToolEnvelope>[0]> = {}): ToolCallEnvelope {
  return buildToolEnvelope({
    runId: "registry-routing-test",
    questionId: `q-${toolName.replace(/[^a-z0-9]+/gi, "-")}`,
    toolName,
    targetEntity: "Kitchen Storage",
    marketplace: "amazon.com",
    inputHash: `registry-${toolName}`,
    idempotencyKey: `registry-${toolName}`,
    ...overrides,
  });
}

describe("V4 market tool registry routing", () => {
  it("routes keyword to the keyword adapter and never to the 1688 source", async () => {
    const result = await executeMarketTool(call("keyword"));

    expect(result.status).toBe("ok");
    expect(result.rawArtifactRefs[0]?.ref).toMatch(/^keyword\//);
    expect(result.rawArtifactRefs[0]?.ref).not.toMatch(/1688/);
    expect(JSON.stringify(result.data)).not.toMatch(/1688/);
  });

  it("routes voc to the VOC adapter and never to the 1688 source", async () => {
    const result = await executeMarketTool(call("voc", { targetEntity: "cand-suf-0001" }));

    expect(result.status).toBe("ok");
    expect(result.rawArtifactRefs[0]?.ref).toMatch(/^voc\//);
    expect(result.rawArtifactRefs[0]?.ref).not.toMatch(/1688/);
    expect(JSON.stringify(result.data)).not.toMatch(/1688/);
  });

  it("does not fabricate a recorded keyword/VOC source for a different target", async () => {
    const keyword = await executeMarketTool(call("keyword", { targetEntity: "yoga mat" }));
    const voc = await executeMarketTool(call("voc", { targetEntity: "yoga mat" }));

    expect(keyword.status).toBe("no_results");
    expect(voc.status).toBe("no_results");
    expect(keyword.rawArtifactRefs).toEqual([]);
    expect(voc.rawArtifactRefs).toEqual([]);
  });

  it("keeps supplier_1688 on the 1688 adapter", async () => {
    const result = await executeMarketTool(call("supplier_1688", {
      targetEntity: "保温杯",
      marketplace: "1688.com",
      inputHash: "search-ok-hash",
    }));

    expect(result.status).toBe("ok");
    expect(result.rawArtifactRefs[0]?.ref).toMatch(/v4\/1688\//);
    expect(JSON.stringify(result.data)).toContain("supplierCandidates");
  });

  it("routes both Amazon operations to the Amazon adapter", async () => {
    const search = await executeMarketTool(call("amazon/search", { targetEntity: "yoga mat", inputHash: "search-ok-hash" }));
    const detail = await executeMarketTool(call("amazon/detail", { targetEntity: "B0YOGA1234", inputHash: "detail-ok-hash" }));

    expect(search.status).toBe("ok");
    expect(search.rawArtifactRefs[0]?.ref).toMatch(/v4\/amazon\//);
    expect(detail.status).toBe("ok");
    expect(detail.rawArtifactRefs[0]?.ref).toMatch(/v4\/amazon\//);
  });

  it("keeps sellersprite on its intentional recorded profile fixture path", async () => {
    const result = await executeMarketTool(call("sellersprite"));

    expect(result.status).toBe("ok");
    expect(result.rawArtifactRefs[0]?.ref).toBe("candidateProfiles:evidence_sufficient");
    expect((result.data as { profile?: string }).profile).toBe("evidence_sufficient");
  });
});
