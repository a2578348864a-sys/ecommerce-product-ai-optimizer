import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PRODUCT_RESEARCH_DECISION_OPTIONS } from "@/lib/productResearchDecisionContract";
import { submitProductResearchDecision } from "@/components/product-research/ProductResearchDecisionPanel";

const panelSource = readFileSync(
  resolve(process.cwd(), "components/product-research/ProductResearchDecisionPanel.tsx"),
  "utf8",
);
const detailSource = readFileSync(resolve(process.cwd(), "components/TaskRecordDetail.tsx"), "utf8");

describe("versioned product research decision panel", () => {
  it("uses the shared three-state contract without exposing the internal research fingerprint", () => {
    expect(PRODUCT_RESEARCH_DECISION_OPTIONS.map((option) => option.label)).toEqual([
      "进入创作准备",
      "待补信息",
      "放弃研究",
    ]);
    expect(panelSource).toContain("PRODUCT_RESEARCH_DECISION_OPTIONS");
    expect(panelSource).toContain("decisionEvents");
    expect(panelSource).toContain("researchHashFingerprint");
    expect(panelSource).not.toContain("研究指纹");
    expect(panelSource).not.toMatch(/researchHash\s*:/);
    expect(panelSource).toContain('event.actorMode === "owner" ? "管理员" : "访客"');
  });

  it("uses the dedicated GET/PATCH contract with stable decision IDs and conflict reload", () => {
    expect(panelSource).toContain("/research-decision`");
    expect(panelSource).toContain('method: "PATCH"');
    expect(panelSource).toContain("expectedRevision: state.record.revision");
    expect(panelSource).toContain("decisionIdRef.current = createBrowserUuid()");
    expect(panelSource).toContain('data.error.code === "research_record_conflict"');
    expect(panelSource).toContain("await fetchProductResearchDecisionState(input.taskId, fetcher)");
  });

  it("V3 Legacy Removal: 正式决定面板只服务 Current Research（无旧版研究记录分支）", () => {
    expect(panelSource).not.toContain('data-testid="legacy-research-decision"');
    expect(panelSource).not.toContain("旧版研究记录");
    expect(detailSource).toContain("ProductResearchDecisionPanel");
    expect(detailSource).toContain("hasVersionedProductResearchRecord");
    // 详情页早期候选任务显示只读当前决定（无旧版写入口）
    expect(detailSource).toContain('data-testid="legacy-decision-readonly"');
    expect(detailSource).not.toContain("保存旧版状态");
    expect(detailSource).not.toContain("旧版人工决定");
    expect(detailSource).not.toContain("studio-legacy-unsupported-note");
  });

  it("does not auto-trigger Listing or Image work", () => {
    expect(panelSource).toContain("Listing / Image");
    expect(panelSource).toContain("独立创作工具");
    expect(panelSource).not.toContain("PR-3");
    expect(panelSource).not.toContain("/api/tasks/${encodeURIComponent(taskId)}/listing-pack");
    expect(panelSource).not.toContain("/api/tasks/${encodeURIComponent(taskId)}/image-draft");
  });

  it("reloads the latest server revision after a PATCH conflict", async () => {
    const latest = {
      taskId: "task-1",
      legacy: false,
      readOnly: false,
      record: {
        schema: "product-research-record.v1" as const,
        revision: 4,
        researchHashFingerprint: "abc123abc123",
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T04:00:00.000Z",
        latestDecision: {
          revision: 4,
          status: "abandoned" as const,
          reason: "The latest server decision.",
          nextAction: null,
          researchHashFingerprint: "abc123abc123",
          decidedAt: "2026-08-03T04:00:00.000Z",
          actorMode: "owner" as const,
        },
        decisionEvents: [],
      },
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: false,
        error: { code: "research_record_conflict", message: "refresh", currentRevision: 4 },
      }), { status: 409, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: latest }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    const result = await submitProductResearchDecision({
      taskId: "task-1",
      expectedRevision: 3,
      decisionId: "44444444-4444-4444-8444-444444444444",
      status: "needs_information",
      reason: "Stale form.",
      nextAction: "Refresh.",
      fetcher,
    });
    expect(result).toEqual({ kind: "conflict", state: latest });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "PATCH" });
    expect(fetcher.mock.calls[1][1]).toMatchObject({ cache: "no-store" });
  });
});
