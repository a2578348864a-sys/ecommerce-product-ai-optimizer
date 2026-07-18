import { describe, expect, it } from "vitest";
import { buildStage15ShadowBlindEvaluationReadme } from "./stage15-shadow-blind-evaluation";

describe("stage15 shadow blind evaluation form", () => {
  it("explains evidence limits and the three-state answer without leaking identities", () => {
    const readme = buildStage15ShadowBlindEvaluationReadme();
    expect(readme).toContain("值得继续调查");
    expect(readme).toContain("证据不足");
    expect(readme).toContain("展示辅助，不是来源事实");
    expect(readme).not.toMatch(/ASIN|productKey|Stage 1|advance|watch/iu);
  });
});
