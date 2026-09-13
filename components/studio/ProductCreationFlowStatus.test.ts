import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("商品创作流程状态展示契约", () => {
  const source = readFileSync(
    resolve(process.cwd(), "components/studio/ProductCreationFlowStatus.tsx"),
    "utf8",
  );

  it("固定五个用户可理解的阶段，且区分关键词确认与创作资料确认", () => {
    expect(source).toContain("商品事实确认 → 关键词方案确认 → 创作资料确认 → Listing 生成 → 图片生成");
    expect(source).toContain("确认关键词方案，不等于创作资料确认");
    expect(source).toContain("data-testid=\"product-creation-flow-status\"");
  });

  it("状态组件只有展示职责，不包含任何写入 API", () => {
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("creative-handoff");
    expect(source).not.toContain("POST");
    expect(source).not.toContain("PATCH");
  });
});
