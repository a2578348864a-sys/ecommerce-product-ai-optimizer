import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("SellerSprite Preview V2 runtime boundary", () => {
  it("does not read real SellerSprite sample paths or reintroduce legacy ranking runtime inputs", async () => {
    const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
    expect(source).not.toContain("SELLERSPRITE_XLSX_");
    expect(source).not.toMatch(/ranking|snapshot|shadow|requireOwnerOnly/i);
  });
});
