import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCandidateDeletePresentation } from "@/components/cross-border/OpportunitiesForm";

const opportunitiesSource = readFileSync(
  resolve(process.cwd(), "components/cross-border/OpportunitiesForm.tsx"),
  "utf8",
);
const globalsSource = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

describe("Candidate delete presentation", () => {
  it("protects canonical or legacy linked authoritative Candidates", () => {
    expect(getCandidateDeletePresentation({
      isOfficialReadonly: false,
      isLocalDraft: false,
      hasLinkedTask: true,
    })).toEqual({
      canDelete: false,
      label: "已转任务，候选来源证据需保留",
      title: "已转任务的候选承载来源证据，不能硬删除。",
    });
  });

  it("keeps unlinked authoritative Candidates deletable", () => {
    expect(getCandidateDeletePresentation({
      isOfficialReadonly: false,
      isLocalDraft: false,
      hasLinkedTask: false,
    }).canDelete).toBe(true);
  });

  it("keeps local draft deletion unchanged even when a legacy task snapshot matches", () => {
    expect(getCandidateDeletePresentation({
      isOfficialReadonly: false,
      isLocalDraft: true,
      hasLinkedTask: true,
    })).toMatchObject({ canDelete: true, label: "删除候选" });
  });

  it("keeps official readonly Candidates non-deletable", () => {
    expect(getCandidateDeletePresentation({
      isOfficialReadonly: true,
      isLocalDraft: false,
      hasLinkedTask: false,
    })).toMatchObject({ canDelete: false, label: "正式候选不可删除" });
  });
});

describe("Opportunity decision desk structure", () => {
  it("renders the candidate pool as a selectable decision desk with a live detail region", () => {
    expect(opportunitiesSource).toContain('data-testid="opportunity-decision-desk"');
    expect(opportunitiesSource).toContain('data-testid={`decision-row-${item.id}`}');
    expect(opportunitiesSource).toContain("aria-pressed={active}");
    expect(opportunitiesSource).toContain('aria-live="polite"');
  });

  it("separates market status from Candidate processing status", () => {
    expect(opportunitiesSource).toContain("市场状态");
    expect(opportunitiesSource).toContain("处理状态");
    expect(opportunitiesSource).toContain("getDecisionDeskMarketPresentation(item)");
    expect(opportunitiesSource).toContain("getDecisionDeskScorePresentation(item)");
  });

  it("keeps long URLs out of the compact candidate list", () => {
    const listStart = opportunitiesSource.indexOf('data-testid="opportunity-decision-desk"');
    const detailStart = opportunitiesSource.indexOf('aria-live="polite"', listStart);
    expect(listStart).toBeGreaterThan(-1);
    expect(detailStart).toBeGreaterThan(listStart);
    const compactListSource = opportunitiesSource.slice(listStart, detailStart);
    expect(compactListSource).not.toContain("sanitizeUrlForDisplay");
    expect(compactListSource).not.toContain("item.link");
  });

  it("renders the visual fixture before access-password and local-draft hooks run", () => {
    expect(opportunitiesSource).toContain("if (visualFixture) {");
    expect(opportunitiesSource).toContain("return <OpportunitiesFormContent");
    const publicWrapper = opportunitiesSource.slice(
      opportunitiesSource.indexOf("export function OpportunitiesForm"),
      opportunitiesSource.indexOf("function OpportunitiesFormWithLocalAccess"),
    );
    expect(publicWrapper).not.toContain("useAccessPassword(");
    expect(publicWrapper).not.toContain("useLocalDraft<");
  });

  it("uses a 1280px split breakpoint and keeps 1180–1279px single-column", () => {
    expect(globalsSource).toMatch(/@media \(min-width: 1280px\)[\s\S]*?\.opportunity-decision-grid/);
    expect(globalsSource).not.toContain("@media (min-width: 1180px)");
  });

  it("keeps the narrow desktop detail pane from forcing vertical text or horizontal scrolling", () => {
    expect(opportunitiesSource).toContain('data-testid={`decision-detail-${item.id}`}');
    expect(opportunitiesSource).toContain('className="h-full min-w-0 overflow-hidden bg-white p-4 sm:p-5"');
    expect(opportunitiesSource).toContain('className="flex flex-col gap-3"');
    expect(globalsSource).toMatch(/\.opportunity-decision-grid > :last-child \{[\s\S]*?overflow-x: hidden/);
  });

  it("uses one collapsed candidate intake entry instead of the duplicate quick crawl form", () => {
    expect(opportunitiesSource).toContain('data-testid="candidate-intake-toggle"');
    expect(opportunitiesSource).toContain("showCandidateIntake");
    expect(opportunitiesSource).not.toContain("抓取公开线索（可选）");
  });
});
