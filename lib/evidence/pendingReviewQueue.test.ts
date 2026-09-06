import { describe, expect, it } from "vitest";
import {
  derivePendingReviewQueue,
  deriveNeedsUserQueue,
  type PendingQueueItem,
  type NeedsUserQueueItem,
} from "./pendingReviewQueue";
import type { ResearchOrchestratorSources } from "@/lib/server/researchCollectionOrchestrator";

describe("pendingReviewQueue", () => {
  describe("derivePendingReviewQueue", () => {
    it("当 sources 为 undefined 或 null 或空对象时返回空数组", () => {
      expect(derivePendingReviewQueue(undefined)).toEqual([]);
      expect(derivePendingReviewQueue(null)).toEqual([]);
      expect(derivePendingReviewQueue({} as any)).toEqual([]);
    });

    it("正确生成待确认队列（awaiting_confirmation），验证文案与 anchorId 规范且无前导 #", () => {
      const sources: ResearchOrchestratorSources = {
        amazon: {
          status: "awaiting_confirmation",
          previewId: "preview_amazon_01",
          itemCount: 1,
          message: "Amazon 详情采集完成，等待人工确认",
        },
        keywordCompetitor: {
          status: "awaiting_confirmation",
          previewId: "preview_kw_comp_01",
          itemCount: 8,
          message: "关键词与竞品预览已生成，等待人工确认",
        },
        voc: {
          status: "awaiting_confirmation",
          previewId: "preview_voc_01",
          itemCount: 12,
          message: "买家评论预览已生成，等待人工确认",
        },
        sourcing1688: {
          status: "awaiting_confirmation",
          previewId: "preview_1688_01",
          itemCount: 4,
          message: "1688 货源已有待确认预览",
        },
      };

      const result = derivePendingReviewQueue(sources);

      expect(result).toHaveLength(4);

      // 1. Amazon
      expect(result[0]).toEqual<PendingQueueItem>({
        sourceKey: "amazon",
        backendKey: "amazon",
        title: "Amazon 商品资料",
        countText: "1 项页面证据待确认",
        previewId: "preview_amazon_01",
        actionLabel: "查看并确认",
        tabKey: "market",
        anchorId: "workbench-browser-evidence",
      });

      // 2. Keyword + Competitor
      expect(result[1]).toEqual<PendingQueueItem>({
        sourceKey: "keywords_competitors",
        backendKey: "keywordCompetitor",
        title: "关键词与竞品",
        countText: "8 项采集结果等待确认",
        previewId: "preview_kw_comp_01",
        actionLabel: "查看并确认",
        tabKey: "market",
        anchorId: "formal-v2-market-evidence",
      });

      // 3. VOC
      expect(result[2]).toEqual<PendingQueueItem>({
        sourceKey: "voc",
        backendKey: "voc",
        title: "买家评论 / VOC",
        countText: "12 条评论等待确认",
        previewId: "preview_voc_01",
        actionLabel: "查看并确认",
        tabKey: "buyers",
        anchorId: "formal-v2-buyer-evidence",
      });

      // 4. 1688 Sourcing
      expect(result[3]).toEqual<PendingQueueItem>({
        sourceKey: "sourcing_1688",
        backendKey: "sourcing1688",
        title: "1688 货源",
        countText: "4 项候选货源等待确认",
        previewId: "preview_1688_01",
        actionLabel: "查看并确认",
        tabKey: "sourcing",
        anchorId: "formal-v2-sourcing-evidence",
      });

      // 验证所有 anchorId 均无前导 #
      for (const item of result) {
        expect(item.anchorId.startsWith("#")).toBe(false);
      }
    });

    it("缺省 itemCount 时正确回退至规范默认数字（keywordCompetitor=5, voc=1, sourcing1688=1）", () => {
      const sources: Partial<ResearchOrchestratorSources> = {
        keywordCompetitor: {
          status: "awaiting_confirmation",
          itemCount: 0,
        },
        voc: {
          status: "awaiting_confirmation",
          itemCount: undefined,
        },
        sourcing1688: {
          status: "awaiting_confirmation",
          itemCount: 0,
        },
      };

      const result = derivePendingReviewQueue(sources as ResearchOrchestratorSources);
      expect(result).toHaveLength(3);

      expect(result[0].countText).toBe("5 项采集结果等待确认");
      expect(result[1].countText).toBe("1 条评论等待确认");
      expect(result[2].countText).toBe("1 项候选货源等待确认");
    });

    it("ready, failed, running, needs_user 绝对不进入待确认队列", () => {
      const sources: ResearchOrchestratorSources = {
        amazon: {
          status: "ready",
          hasEvidence: true,
          itemCount: 1,
        },
        keywordCompetitor: {
          status: "running",
          message: "采集正在执行中",
        },
        voc: {
          status: "needs_user",
          message: "待采集买家评论",
        },
        sourcing1688: {
          status: "failed",
          message: "网络连接失败",
        },
      };

      const result = derivePendingReviewQueue(sources);
      expect(result).toEqual([]);
    });

    it("混合状态下仅过滤提取 awaiting_confirmation 项", () => {
      const sources: ResearchOrchestratorSources = {
        amazon: {
          status: "ready",
          hasEvidence: true,
        },
        keywordCompetitor: {
          status: "awaiting_confirmation",
          previewId: "preview_kw_only",
          itemCount: 3,
        },
        voc: {
          status: "failed",
          message: "采集失败",
        },
        sourcing1688: {
          status: "needs_user",
          message: "需要登录",
        },
      };

      const result = derivePendingReviewQueue(sources);
      expect(result).toHaveLength(1);
      expect(result[0].sourceKey).toBe("keywords_competitors");
      expect(result[0].backendKey).toBe("keywordCompetitor");
      expect(result[0].previewId).toBe("preview_kw_only");
      expect(result[0].countText).toBe("3 项采集结果等待确认");
    });
  });

  describe("deriveNeedsUserQueue", () => {
    it("当 sources 为 undefined 或 null 时返回空数组", () => {
      expect(deriveNeedsUserQueue(undefined)).toEqual([]);
      expect(deriveNeedsUserQueue(null)).toEqual([]);
    });

    it("正确生成需要处理队列（needs_user），验证文案与 anchorId 规范", () => {
      const sources: ResearchOrchestratorSources = {
        amazon: {
          status: "needs_user",
          message: "缺少商品 ASIN，无法采集 Amazon 资料",
        },
        keywordCompetitor: {
          status: "needs_user",
          message: "SellerSprite 插件未登录，请在浏览器中登录后重试",
        },
        voc: {
          status: "needs_user",
          message: "本地未检测到可用的系统浏览器，请手动补充或检查浏览器环境",
        },
        sourcing1688: {
          status: "needs_user",
          message: "需要登录或选择采集方式",
        },
      };

      const result = deriveNeedsUserQueue(sources);
      expect(result).toHaveLength(4);

      // 1. Amazon
      expect(result[0]).toEqual<NeedsUserQueueItem>({
        sourceKey: "amazon",
        backendKey: "amazon",
        title: "Amazon 商品资料",
        reasonText: "缺少商品 ASIN，无法采集 Amazon 资料",
        actionLabel: "前往处理",
        tabKey: "market",
        anchorId: "workbench-browser-evidence",
      });

      // 2. Keyword + Competitor (未登录场景映射为 前往登录)
      expect(result[1]).toEqual<NeedsUserQueueItem>({
        sourceKey: "keywords_competitors",
        backendKey: "keywordCompetitor",
        title: "关键词与竞品",
        reasonText: "SellerSprite 插件未登录，请在浏览器中登录后重试",
        actionLabel: "前往登录",
        tabKey: "market",
        anchorId: "formal-v2-market-evidence",
      });

      // 3. VOC
      expect(result[2]).toEqual<NeedsUserQueueItem>({
        sourceKey: "voc",
        backendKey: "voc",
        title: "买家评论 / VOC",
        reasonText: "本地未检测到可用的系统浏览器，请手动补充或检查浏览器环境",
        actionLabel: "前往处理",
        tabKey: "buyers",
        anchorId: "formal-v2-buyer-evidence",
      });

      // 4. 1688 Sourcing
      expect(result[3]).toEqual<NeedsUserQueueItem>({
        sourceKey: "sourcing_1688",
        backendKey: "sourcing1688",
        title: "1688 货源",
        reasonText: "需要登录或选择采集方式",
        actionLabel: "前往处理",
        tabKey: "sourcing",
        anchorId: "formal-v2-sourcing-evidence",
      });

      // 验证所有 anchorId 均无前导 #
      for (const item of result) {
        expect(item.anchorId.startsWith("#")).toBe(false);
      }
    });

    it("sourcing1688 缺省 message 时回退到默认规范文案", () => {
      const sources: Partial<ResearchOrchestratorSources> = {
        sourcing1688: {
          status: "needs_user",
        },
      };

      const result = deriveNeedsUserQueue(sources as ResearchOrchestratorSources);
      expect(result).toHaveLength(1);
      expect(result[0].reasonText).toBe("需要登录或选择采集方式");
      expect(result[0].actionLabel).toBe("前往处理");
    });

    it("ready, running, awaiting_confirmation, failed 绝对不进入 needs_user 队列", () => {
      const sources: ResearchOrchestratorSources = {
        amazon: {
          status: "ready",
          hasEvidence: true,
        },
        keywordCompetitor: {
          status: "running",
        },
        voc: {
          status: "awaiting_confirmation",
          previewId: "prev_voc",
        },
        sourcing1688: {
          status: "failed",
          message: "发生错误",
        },
      };

      const result = deriveNeedsUserQueue(sources);
      expect(result).toEqual([]);
    });
  });
});
