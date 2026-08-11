import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("home dashboard demo language", () => {
  it("derives a user-facing connection state from the loaded workspace data", async () => {
    const source = await readFile(new URL("./HomeDashboardClient.tsx", import.meta.url), "utf8");

    expect(source).toContain("数据已同步");
    expect(source).toContain("待研究商品");
    expect(source).not.toContain("服务端 Candidate");
    expect(source).not.toContain("API 鉴权未确认");
  });
});
