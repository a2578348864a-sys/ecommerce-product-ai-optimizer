import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "components/studio/TaskStudioPreparation.tsx"), "utf8");

describe("轮 15 扩展：创作资料确认冲突友好提示", () => {
  it("friendlyError 处理 confirmed_fact_conflict（不裸透服务端文案）", () => {
    expect(source).toContain("confirmed_fact_conflict");
    expect(source).toContain("保留研究确认值");
    expect(source).toMatch(/confirmed_fact_conflict[\s\S]*?保留研究确认值/);
  });
});
