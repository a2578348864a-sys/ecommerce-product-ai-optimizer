import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Phase 2 Studio entry points", () => {
  it("renders Listing Studio in Manual and Task modes instead of redirecting", () => {
    const page = source("app/listing-studio/page.tsx");
    expect(page).not.toContain("redirect(");
    expect(page).toContain("ListingStudioClient");
    expect(page).toContain("taskId");
    expect(page).toContain("独立创作");
    expect(page).toContain("来自研究记录");
  });

  it("renders Image Studio in Manual and Task modes instead of redirecting", () => {
    const page = source("app/image-studio/page.tsx");
    expect(page).not.toContain("redirect(");
    expect(page).toContain("ImageStudioClient");
    expect(page).toContain("taskId");
    expect(page).toContain("独立创作");
    expect(page).toContain("来自研究记录");
  });

  it("groups research and creative tools in desktop and mobile navigation", () => {
    const sidebar = source("components/WorkspaceSidebar.tsx");
    expect(sidebar).toContain("商品研究");
    expect(sidebar).toContain("待研究商品");
    expect(sidebar).toContain("创作工具");
    expect(sidebar).toContain("创作工具");
    expect(sidebar).toContain("/listing-studio");
    expect(sidebar).toContain("/image-studio");
    expect(sidebar).toContain("WorkspaceMobileNav");
    expect(sidebar).toContain("buildV4NavGroups");
  });

  it("connects Task detail to both independent Studio pages after retiring the legacy five-step workspace", () => {
    const detail = source("components/TaskRecordDetail.tsx");
    expect(detail).toContain("`/listing-studio?taskId=${encodeURIComponent(record.id)}`");
    expect(detail).toContain("`/image-studio?taskId=${encodeURIComponent(record.id)}`");
    expect(detail).not.toContain("CreativeHandoffPanel");
    expect(detail).not.toContain("ListingHandoffSection");
    expect(detail).not.toContain("ImageHandoffSection");
    expect(detail).toContain("创作工具");
    expect(detail).toContain("StudioNavigationLink");
    expect(detail).toContain("正在打开 Image Studio…");
    expect(detail).toContain("正在打开 Listing Studio…");
  });

  it("delays the session-restored notice until after hydration", () => {
    const listing = source("components/listing-studio/ListingStudioClient.tsx");
    expect(listing).toContain("studioMounted && sessionDraft.restored");
    expect(listing).toContain("studioMounted && sessionDraft.invalidated");
  });
});
