import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function readComponentSource(filename: string): string {
  return readFileSync(resolve(__dirname, "..", filename), "utf-8");
}

/**
 * Release Closeout：进度即时同步回归。
 *
 * 三个 Handoff 操作（创建创作交接 / 生成 Listing 草稿 / 生成图片草稿）成功后，
 * 必须通过 onCommitted 成功回调触发父级（TaskRecordDetail）重读服务端真实任务状态，
 * 顶部进度摘要随之刷新——不允许维护第二套前端进度、不允许手工 patch 已完成/还缺。
 */

describe("进度即时同步（Release Closeout）", () => {
  it("CreativeHandoffPanel 创建成功回调 onCommitted（含重试成功）", () => {
    const source = readComponentSource("components/creative-handoff/CreativeHandoffPanel.tsx");
    expect(source).toContain("onCommitted?: () => void");
    // 创建成功分支：清草稿 → 重置选择 → loadAll → 通知父级
    expect(source).toContain("clearDraftAfterCommit();");
    expect(source).toContain("await loadAll();");
    expect(source).toContain("onCommitted?.();");
    // 重试成功分支
    expect(source).toContain("重试成功，未重复创建。");
    expect(source).toContain("onCommitted?.();");
  });

  it("ListingHandoffSection 生成成功回调 onCommitted（含重试成功）", () => {
    const source = readComponentSource("components/listing-handoff/ListingHandoffSection.tsx");
    expect(source).toContain("onCommitted?: () => void");
    expect(source).toContain("onCommitted?.();");
    expect(source).toContain("重试成功，未重复生成。");
  });

  it("ImageHandoffSection 生成成功回调 onCommitted", () => {
    const source = readComponentSource("components/image-handoff/ImageHandoffSection.tsx");
    expect(source).toContain("onCommitted?: () => void");
    expect(source).toContain("void loadState();");
    expect(source).toContain("onCommitted?.();");
  });

  it("失败操作不触发 onCommitted（不得错误推进进度）", () => {
    // CreativeHandoff：handleConflict 回调体（清空选择 → 重新加载）内不得调用 onCommitted
    const creative = readComponentSource("components/creative-handoff/CreativeHandoffPanel.tsx");
    const conflictStart = creative.indexOf("const handleConflict = useCallback");
    const conflictEnd = creative.indexOf("},", conflictStart);
    const conflictBody = creative.slice(conflictStart, conflictEnd);
    expect(conflictBody).toContain("void loadAll();");
    expect(conflictBody).not.toContain("onCommitted");
    // Listing：handleConflict（交接已更新，请重新生成）内不得调用 onCommitted
    const listing = readComponentSource("components/listing-handoff/ListingHandoffSection.tsx");
    const listingConflictStart = listing.indexOf("const handleConflict = useCallback");
    const listingConflictEnd = listing.indexOf("},", listingConflictStart);
    const listingConflictBody = listing.slice(listingConflictStart, listingConflictEnd);
    expect(listingConflictBody).toContain("void load();");
    expect(listingConflictBody).not.toContain("onCommitted");
    // Image：onCommitted 只出现在成功写入后（紧跟 loadState()），错误分支不含
    const image = readComponentSource("components/image-handoff/ImageHandoffSection.tsx");
    const onCommittedMatches = [...image.matchAll(/onCommitted\?\.\(\);/g)];
    expect(onCommittedMatches.length).toBeGreaterThanOrEqual(1);
    for (const match of onCommittedMatches) {
      const before = image.slice(0, match.index);
      // 成功分支：onCommitted 前必有 loadState（重读服务端）且不在 catch 错误块内
      const lastLoadState = Math.max(
        before.lastIndexOf("void loadState();"),
        before.lastIndexOf("await loadState();"),
      );
      const lastCatch = before.lastIndexOf("catch {");
      expect(lastLoadState).toBeGreaterThan(0);
      expect(lastLoadState).toBeGreaterThan(lastCatch);
    }
  });

  it("TaskRecordDetail 成功回调重读服务端（以持久化结果为唯一事实源，不手工 patch）", () => {
    const source = readComponentSource("components/TaskRecordDetail.tsx");
    // refreshRecord 重新 GET 任务详情；不手工改写 progressSummary / completed / missing
    expect(source).toMatch(/refreshRecord = useCallback/);
    expect(source).toContain("setRecord(data.data)");
    // 创作状态由服务端 result 派生，不维护第二套前端进度
    expect(source).toContain("deriveCreativeMaterialStatus(record.result)");
    // 禁止手工 patch 进度文案
    expect(source).not.toMatch(/setProgressSummary|setCompleted\(|setMissing\(/);
  });

  it("DTO 投影 creativeHandoff 最小信号（存在性 → 进度派生）", () => {
    const dto = readFileSync(resolve(__dirname, "..", "lib/productResearchPublicDto.ts"), "utf8");
    expect(dto).toMatch(/creativeHandoffSpec\s*=\s*objectOf\(\{/);
    // 白名单仅存在性信号；绝不投影版本/事实/引用
    expect(dto).toMatch(/creativeHandoff: creativeHandoffSpec/);
    // 组件层从服务端 result 派生创作状态，不做手工状态
    const detail = readComponentSource("components/TaskRecordDetail.tsx");
    expect(detail).toContain("deriveCreativeMaterialStatus");
  });
});
