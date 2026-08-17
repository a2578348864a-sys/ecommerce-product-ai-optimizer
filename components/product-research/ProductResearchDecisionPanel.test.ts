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
    // V3 Current Research Normalization：无 researchRecord 任务首次保存时 revision 1（创建）
    expect(panelSource).toContain("expectedRevision: state.record?.revision ?? 1");
    expect(panelSource).toContain("decisionIdRef.current = createBrowserUuid()");
    expect(panelSource).toContain('data.error.code === "research_record_conflict"');
    expect(panelSource).toContain("await fetchProductResearchDecisionState(input.taskId, fetcher)");
  });

  it("V3 Current Research Normalization: 统一正式决定面板（无 legacy 分支/只读卡），支持创建与完成态", () => {
    expect(panelSource).not.toContain('data-testid="legacy-research-decision"');
    expect(panelSource).not.toContain("旧版研究记录");
    // 创建模式（无 researchRecord）与完成态（readOnly）均由同一面板处理
    expect(panelSource).toContain('data-testid="product-research-decision-create"');
    expect(panelSource).toContain('data-testid="product-research-decision-readonly-completed"');
    expect(panelSource).toContain("保存人工决定");
    expect(detailSource).toContain("ProductResearchDecisionPanel");
    expect(detailSource).toContain("hasVersionedProductResearchRecord");
    // 详情页：无旧版只读卡/无保存旧版状态；有完成控件
    expect(detailSource).not.toContain('data-testid="legacy-decision-readonly"');
    expect(detailSource).not.toContain("保存旧版状态");
    expect(detailSource).not.toContain("旧版人工决定");
    expect(detailSource).toContain("ResearchCompletionControl");
    expect(detailSource).toContain("完成研究并保存记录");
  });

  it("V3 Current Research Normalization: 完成控件门禁（无决定禁用/need_info 禁用/完成态展示）", () => {
    expect(detailSource).toContain('data-testid="research-completion-control"');
    expect(detailSource).toContain('data-testid="complete-research-button"');
    expect(detailSource).toContain('data-testid="research-completed"');
    // 无 researchRecord → 提示先保存人工决定
    expect(detailSource).toContain("请先保存人工决定，再完成研究。");
    // needs_information → 提示仍需补充资料（留在商品研究）
    expect(detailSource).toContain("当前仍需补充资料，补充后再完成研究。");
    // 完成确认文案：从商品研究移动到研究记录；现有研究资料不会删除
    expect(detailSource).toContain("从『商品研究』移动到『研究记录』");
    expect(detailSource).toContain("现有研究资料不会删除");
    // 完成态：研究已完成并保存到研究记录 + 查看研究记录
    expect(detailSource).toContain("研究已完成并保存到研究记录。");
    expect(detailSource).toContain('href="/tasks"');
    // 走 POST /complete（不复制 Task；同一 canonical Task lifecycle 收口）
    expect(detailSource).toContain('fetch(`/api/tasks/${encodeURIComponent(taskId)}/complete`');
    expect(detailSource).not.toContain("POST /api/tasks`");
    // 完成判定：creative_ready / abandoned 可完成
    expect(detailSource).toContain('latestStatus === "creative_ready" || latestStatus === "abandoned"');
    // 浏览器投影不暴露 researchRecord：完成控件必须读取 productResearchSummary（否则保存决定后按钮仍禁用）
    expect(detailSource).toContain("result.productResearchSummary");
    expect(detailSource).toContain('typeof summary?.status === "string"');
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
