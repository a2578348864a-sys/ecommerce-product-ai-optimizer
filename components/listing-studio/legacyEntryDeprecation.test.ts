import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * V4 旧链入口定位（2026-09 收口）。
 *
 * 审计发现 `/listing-studio-legacy` 与任务详情里的旧 `listing-pack` 卡片仍是可用的
 * V4 链路，但页面上没有任何"这是旧版"的说明，直连 URL 的用户会误以为它是正式产品。
 * 裁定是**保留回滚能力 + 加弃用标识**，不允许删除。本测试同时钉住这两件事。
 */

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("V4 legacy 入口：保留可用 + 明确弃用", () => {
  it("legacy 页面保留 V4 编辑器本身（回滚能力不得被删除）", () => {
    const page = source("app/listing-studio-legacy/page.tsx");
    expect(page).toContain("ListingStudioClient");
    expect(page).toContain("<ListingStudioClient taskId={taskId} />");
    expect(page).toContain("ListingStudioPolish.module.css");
  });

  it("legacy 页面带有弃用标识，并引导到新版 Listing Studio", () => {
    const page = source("app/listing-studio-legacy/page.tsx");
    expect(page).toContain('data-testid="listing-studio-legacy-deprecated"');
    expect(page).toContain("已弃用");
    expect(page).toMatch(/不经过 V5 的 Validator/);
    // 有 taskId 时必须带着任务跳转，否则用户会掉进独立模式
    expect(page).toContain("/listing-studio?taskId=");
  });

  it("任务详情的旧 listing-pack 卡片标注旧链且不经过 V5 校验", () => {
    const card = source("components/ListingPackCard.tsx");
    expect(card).toContain('data-testid="listing-pack-deprecated-notice"');
    expect(card).toContain("旧版（V4）Listing 包");
    expect(card).toContain("/listing-studio?taskId=");
    // 旧卡片自身能力保留
    expect(card).toContain('data-testid="listing-pack-generate"');
  });
});
