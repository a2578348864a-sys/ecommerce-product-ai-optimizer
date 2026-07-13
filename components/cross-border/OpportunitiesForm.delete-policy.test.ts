import { describe, expect, it } from "vitest";
import { getCandidateDeletePresentation } from "@/components/cross-border/OpportunitiesForm";

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
