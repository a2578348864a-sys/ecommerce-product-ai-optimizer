import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  deriveAmazonUnifiedStatus,
  deriveVocUnifiedStatus,
  deriveSourcing1688UnifiedStatus,
  deriveAiListingUnifiedStatus,
  deriveAllUnifiedStatuses,
  logUnifiedStatusEvents,
  type AmazonUnifiedStatus,
  type VocUnifiedStatus,
  type Sourcing1688UnifiedStatus,
  type AiListingUnifiedStatus,
} from "./unifiedCollectionStatus";
import type { OrchestratorSourceDetail, ResearchOrchestratorSources } from "./researchCollectionOrchestrator";
import * as loggerModule from "./agentEventLogger";

describe("unifiedCollectionStatus", () => {
  describe("deriveAmazonUnifiedStatus", () => {
    it("should map ready status to succeeded with factsCount", () => {
      const detail: OrchestratorSourceDetail = {
        status: "ready",
        hasEvidence: true,
        itemCount: 8,
      };
      const res = deriveAmazonUnifiedStatus(detail, 1200);
      expect(res.status).toBe("succeeded");
      expect(res.succeeded).toBe(true);
      expect(res.factsCount).toBe(8);
      expect(res.summary).toContain("8 项商品事实");
      expect(res.durationMs).toBe(1200);
    });

    it("should map running status to running", () => {
      const detail: OrchestratorSourceDetail = {
        status: "running",
      };
      const res = deriveAmazonUnifiedStatus(detail);
      expect(res.status).toBe("running");
      expect(res.succeeded).toBe(false);
    });

    it("should map awaiting_confirmation to awaiting_action", () => {
      const detail: OrchestratorSourceDetail = {
        status: "awaiting_confirmation",
        itemCount: 1,
      };
      const res = deriveAmazonUnifiedStatus(detail);
      expect(res.status).toBe("awaiting_action");
      expect(res.actionRequired).toContain("事实确认区");
    });

    it("should map automation_blocked to awaiting_action with clear action guidance", () => {
      const detail: OrchestratorSourceDetail = {
        status: "needs_user",
        error: {
          code: "automation_blocked",
          message: "Amazon 触发了自动化访问校验",
        },
      };
      const res = deriveAmazonUnifiedStatus(detail);
      expect(res.status).toBe("awaiting_action");
      expect(res.failureReason).toContain("自动化访问校验");
      expect(res.actionRequired).toContain("Chrome");
    });

    it("should map failed status to failed", () => {
      const detail: OrchestratorSourceDetail = {
        status: "failed",
        error: {
          code: "network_timeout",
          message: "页面加载超时",
        },
      };
      const res = deriveAmazonUnifiedStatus(detail);
      expect(res.status).toBe("failed");
      expect(res.succeeded).toBe(false);
      expect(res.errorCode).toBe("network_timeout");
    });
  });

  describe("deriveVocUnifiedStatus", () => {
    it("should map ready status to succeeded with reviewsCount", () => {
      const detail: OrchestratorSourceDetail = {
        status: "ready",
        itemCount: 12,
      };
      const res = deriveVocUnifiedStatus(detail, 2500);
      expect(res.status).toBe("succeeded");
      expect(res.reviewsCount).toBe(12);
      expect(res.hasCaptcha).toBe(false);
      expect(res.summary).toContain("12 条真实买家评论");
      expect(res.durationMs).toBe(2500);
    });

    it("should map captcha_required to awaiting_action with hasCaptcha=true", () => {
      const detail: OrchestratorSourceDetail = {
        status: "needs_user",
        error: {
          code: "captcha_required",
          message: "触发验证码挑战，需要人工处理",
        },
      };
      const res = deriveVocUnifiedStatus(detail, 800, 3);
      expect(res.status).toBe("awaiting_action");
      expect(res.hasCaptcha).toBe(true);
      expect(res.needsHumanConfirmation).toBe(true);
      expect(res.retryCount).toBe(3);
      expect(res.summary).toContain("验证码挑战");
    });

    it("should map confirmed_no_reviews to partial status", () => {
      const detail: OrchestratorSourceDetail = {
        status: "needs_user",
        error: {
          code: "confirmed_no_reviews",
          message: "Amazon 页面明确显示暂无公开评论",
        },
      };
      const res = deriveVocUnifiedStatus(detail);
      expect(res.status).toBe("partial");
      expect(res.reviewsCount).toBe(0);
    });
  });

  describe("deriveSourcing1688UnifiedStatus", () => {
    it("should map ready status to succeeded with extensionConnected=true and candidatesCount", () => {
      const detail: OrchestratorSourceDetail = {
        status: "ready",
        itemCount: 3,
      };
      const res = deriveSourcing1688UnifiedStatus(detail, 5000);
      expect(res.status).toBe("succeeded");
      expect(res.extensionConnected).toBe(true);
      expect(res.candidatesCount).toBe(3);
      expect(res.summary).toContain("3 项 1688 货源线索");
    });

    it("should map extension_not_installed to awaiting_action with extensionConnected=false", () => {
      const detail: OrchestratorSourceDetail = {
        status: "failed",
        error: {
          code: "extension_not_installed",
          message: "未检测到 1688 扩展助手连接",
        },
      };
      const res = deriveSourcing1688UnifiedStatus(detail);
      expect(res.status).toBe("awaiting_action");
      expect(res.extensionConnected).toBe(false);
      expect(res.actionRequired).toContain("轻选 1688 助手");
    });

    it("should map extension_bridge_not_available to awaiting_action with bridge action guidance", () => {
      const detail: OrchestratorSourceDetail = {
        status: "failed",
        error: {
          code: "extension_bridge_not_available",
          message: "1688 助手桥接服务未就绪",
        },
      };
      const res = deriveSourcing1688UnifiedStatus(detail);
      expect(res.status).toBe("awaiting_action");
      expect(res.extensionConnected).toBe(false);
      expect(res.errorCode).toBe("extension_bridge_not_available");
      expect(res.actionRequired).toContain("桥接未就绪");
    });

    it("should map extension_bridge_rejected to awaiting_action with bridge action guidance", () => {
      const detail: OrchestratorSourceDetail = {
        status: "failed",
        error: {
          code: "extension_bridge_rejected",
          message: "1688 图片助手未能接收任务，请确认浏览器助手状态后重试。",
        },
      };
      const res = deriveSourcing1688UnifiedStatus(detail);
      expect(res.status).toBe("awaiting_action");
      expect(res.extensionConnected).toBe(false);
      expect(res.errorCode).toBe("extension_bridge_rejected");
      expect(res.failureReason).toContain("未能接收任务");
      expect(res.actionRequired).toContain("桥接未就绪或未连接");
    });

    it("should map needs_user to awaiting_action with missing material guidance", () => {
      const detail: OrchestratorSourceDetail = {
        status: "needs_user",
        message: "待补充商品主图后搜索 1688 货源",
      };
      const res = deriveSourcing1688UnifiedStatus(detail);
      expect(res.status).toBe("awaiting_action");
      expect(res.extensionConnected).toBe(false);
      expect(res.errorCode).toBe("missing_material");
      expect(res.actionRequired).toContain("补充商品主图素材");
    });
  });

  describe("deriveAiListingUnifiedStatus", () => {
    it("should return idle if no listingV5 exists in taskResult", () => {
      const res = deriveAiListingUnifiedStatus(null);
      expect(res.status).toBe("idle");
      expect(res.generated).toBe(false);
      expect(res.passedGate).toBe(false);
      expect(res.savedStatus).toBe("not_saved");
    });

    it("should return succeeded if draft exists and validation is PASS", () => {
      const taskResult = {
        listingV5: {
          listing: { title: "Title" },
          validation: { status: "PASS" },
        },
      };
      const res = deriveAiListingUnifiedStatus(taskResult, 3000);
      expect(res.status).toBe("succeeded");
      expect(res.generated).toBe(true);
      expect(res.passedGate).toBe(true);
      expect(res.savedStatus).toBe("saved");
      expect(res.summary).toContain("通过 100% 事实门禁");
      expect(res.durationMs).toBe(3000);
    });

    it("should return awaiting_action if validation is BLOCK with specific gate violation metrics and samples", () => {
      const taskResult = {
        listingV5: {
          listing: { title: "Title" },
          validation: {
            status: "BLOCK",
            claims: {
              allHaveEvidence: false,
              unsupportedClaims: ["keeps food hot for 24 hours", "fits all bags"],
              prohibitedClaims: ["#1 best seller"],
              competitorOverlap: ["Hydro Flask"],
            },
          },
        },
      };
      const res = deriveAiListingUnifiedStatus(taskResult);
      expect(res.status).toBe("awaiting_action");
      expect(res.generated).toBe(true);
      expect(res.passedGate).toBe(false);
      expect(res.errorCode).toBe("gate_blocked");
      expect(res.failureReason).toContain("事实门禁拦截");
      expect(res.failureReason).toContain("2 项未证实宣称");
      expect(res.failureReason).toContain("1 项违规词");
      expect(res.failureReason).toContain("1 项竞品侵权词");
      expect(res.failureReason).toContain("keeps food hot for 24 hours");
      expect(res.actionRequired).toContain("Listing Studio");
      expect(res.gateViolations?.unsupportedClaimsCount).toBe(2);
      expect(res.gateViolations?.prohibitedClaimsCount).toBe(1);
      expect(res.gateViolations?.competitorOverlapCount).toBe(1);
    });
  });

  describe("deriveAllUnifiedStatuses", () => {
    it("should aggregate all 4 modules into UnifiedStatusesMap", () => {
      const sources: ResearchOrchestratorSources = {
        amazon: { status: "ready", itemCount: 8 },
        keywordCompetitor: { status: "ready" },
        voc: { status: "ready", itemCount: 10 },
        sourcing1688: { status: "ready", itemCount: 2 },
      };
      const taskResult = {
        listingV5: {
          listing: { title: "Test" },
          validation: { status: "PASS" },
        },
      };

      const result = deriveAllUnifiedStatuses({
        sources,
        taskResult,
        durations: { amazon: 1200, voc: 2000, "1688": 3000, ai: 4000 },
      });

      expect(result.amazon.status).toBe("succeeded");
      expect(result.voc.status).toBe("succeeded");
      expect(result["1688"].status).toBe("succeeded");
      expect(result.ai.status).toBe("succeeded");
      expect(result.amazon.durationMs).toBe(1200);
      expect(result.voc.durationMs).toBe(2000);
      expect(result["1688"].durationMs).toBe(3000);
      expect(result.ai.durationMs).toBe(4000);
    });
  });

  describe("logUnifiedStatusEvents", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("should log events for each module with durationMs, retryCount, and errorCode in metadata", async () => {
      const logInfoSpy = vi.spyOn(loggerModule, "logInfo").mockResolvedValue(undefined as any);
      const logWarnSpy = vi.spyOn(loggerModule, "logWarn").mockResolvedValue(undefined as any);
      const logErrorSpy = vi.spyOn(loggerModule, "logError").mockResolvedValue(undefined as any);

      const statuses = {
        amazon: {
          module: "amazon" as const,
          status: "succeeded" as const,
          succeeded: true,
          factsCount: 8,
          summary: "获取 8 项商品事实",
          durationMs: 1500,
        },
        voc: {
          module: "voc" as const,
          status: "awaiting_action" as const,
          hasCaptcha: true,
          retryCount: 2,
          errorCode: "captcha_required",
          summary: "触发验证码挑战，需要人工处理",
          durationMs: 800,
        },
        "1688": {
          module: "1688" as const,
          status: "failed" as const,
          extensionConnected: false,
          errorCode: "sourcing_timeout",
          summary: "图搜超时",
          durationMs: 45000,
        },
        ai: {
          module: "ai" as const,
          status: "idle" as const,
          generated: false,
          passedGate: false,
          savedStatus: "not_saved" as const,
          summary: "待生成 Listing V5 文案",
        },
      };

      await logUnifiedStatusEvents({
        taskId: "test-task-1",
        statuses,
        contextAction: "orchestrate",
      });

      // Amazon (succeeded) -> info
      expect(logInfoSpy).toHaveBeenCalledWith(
        "amazon",
        "amazon_status_succeeded",
        expect.stringContaining("获取 8 项商品事实"),
        expect.objectContaining({
          taskId: "test-task-1",
          metadata: expect.objectContaining({
            durationMs: 1500,
            succeeded: true,
            factsCount: 8,
          }),
        }),
      );

      // VOC (awaiting_action) -> warn
      expect(logWarnSpy).toHaveBeenCalledWith(
        "voc",
        "voc_awaiting_action",
        expect.stringContaining("触发验证码挑战"),
        expect.objectContaining({
          taskId: "test-task-1",
          metadata: expect.objectContaining({
            hasCaptcha: true,
            retryCount: 2,
            errorCode: "captcha_required",
          }),
        }),
      );

      // 1688 (failed) -> error
      expect(logErrorSpy).toHaveBeenCalledWith(
        "1688",
        "1688_status_failed",
        expect.stringContaining("图搜超时"),
        expect.objectContaining({
          taskId: "test-task-1",
          metadata: expect.objectContaining({
            durationMs: 45000,
            errorCode: "sourcing_timeout",
          }),
        }),
      );

      // AI (idle) -> info
      expect(logInfoSpy).toHaveBeenCalledWith(
        "ai",
        "ai_status_idle",
        expect.stringContaining("待生成 Listing V5 文案"),
        expect.objectContaining({
          taskId: "test-task-1",
        }),
      );
    });

    it("should log ai_awaiting_action with gateViolations metadata when validation fails gate", async () => {
      const logInfoSpy = vi.spyOn(loggerModule, "logInfo").mockResolvedValue(undefined as any);
      const logWarnSpy = vi.spyOn(loggerModule, "logWarn").mockResolvedValue(undefined as any);
      const logErrorSpy = vi.spyOn(loggerModule, "logError").mockResolvedValue(undefined as any);

      const statuses = {
        amazon: { module: "amazon" as const, status: "idle" as const, summary: "Idle", succeeded: false },
        voc: { module: "voc" as const, status: "idle" as const, summary: "Idle" },
        "1688": { module: "1688" as const, status: "idle" as const, summary: "Idle" },
        ai: {
          module: "ai" as const,
          status: "awaiting_action" as const,
          generated: true,
          passedGate: false,
          savedStatus: "saved" as const,
          errorCode: "gate_blocked",
          failureReason: "事实门禁拦截：发现 2 项未证实宣称",
          summary: "文案未通过事实门禁（2 项未证实宣称），需人工审查",
          actionRequired: "前往 Listing Studio 审查标记的违规句并修改为已确认事实",
          durationMs: 3800,
          gateViolations: {
            unsupportedClaimsCount: 2,
            prohibitedClaimsCount: 0,
            competitorOverlapCount: 0,
            sampleViolations: ["keeps food hot for 24h", "100% unbreakable"],
          },
        },
      };

      await logUnifiedStatusEvents({
        taskId: "test-task-ai-blocked",
        statuses,
        contextAction: "inspect",
      });

      expect(logWarnSpy).toHaveBeenCalledWith(
        "ai",
        "ai_awaiting_action",
        expect.stringContaining("文案未通过事实门禁"),
        expect.objectContaining({
          taskId: "test-task-ai-blocked",
          metadata: expect.objectContaining({
            unifiedStatus: "awaiting_action",
            errorCode: "gate_blocked",
            failureReason: "事实门禁拦截：发现 2 项未证实宣称",
            actionRequired: "前往 Listing Studio 审查标记的违规句并修改为已确认事实",
            gateViolations: {
              unsupportedClaimsCount: 2,
              prohibitedClaimsCount: 0,
              competitorOverlapCount: 0,
              sampleViolations: ["keeps food hot for 24h", "100% unbreakable"],
            },
          }),
        }),
      );
    });

    it("should fail open and never throw even if logger throws", async () => {
      vi.spyOn(loggerModule, "logInfo").mockRejectedValue(new Error("Logger DB crashed"));

      const statuses = {
        amazon: {
          module: "amazon" as const,
          status: "succeeded" as const,
          succeeded: true,
          summary: "Success",
        },
        voc: {
          module: "voc" as const,
          status: "idle" as const,
          summary: "Idle",
        },
        "1688": {
          module: "1688" as const,
          status: "idle" as const,
          summary: "Idle",
        },
        ai: {
          module: "ai" as const,
          status: "idle" as const,
          generated: false,
          passedGate: false,
          savedStatus: "not_saved" as const,
          summary: "Idle",
        },
      };

      await expect(
        logUnifiedStatusEvents({
          taskId: "test-task-fail-open",
          statuses,
        }),
      ).resolves.not.toThrow();
    });
  });
});
