import { describe, expect, it } from "vitest";

import {
  MARKET_SIGNAL_KIND_LABELS,
  buildMarketSignalSet,
  collectSignalRefs,
  type MarketSignalDraft,
} from "@/lib/marketSignal";
import { buildOpportunityAnalysisPrompt, type OpportunityAnalysisInput } from "@/lib/server/opportunityAnalysis";

const INPUT: OpportunityAnalysisInput = {
  category: "insulated water bottle",
  marketplace: "Amazon US",
  constraints: "",
  marketSignalText: "",
  autoSignal: true,
  candidateId: "",
};

/** 两个来源、4 条信号：其中 T1 被两条信号共用，用来验证「同来源共号」。 */
const DRAFTS: MarketSignalDraft[] = [
  {
    kind: "pain_point",
    text: "杯盖发霉：有评论反映杯盖内出现黑色霉斑。",
    source: "已有研究任务《HydroJug Traveler 40oz》· VOC 痛点",
  },
  {
    kind: "review",
    text: "Received completely different product",
    rating: 1,
    source: "已有研究任务《HydroJug Traveler 40oz》· 评论 · B0CQVWT2NH",
  },
  {
    kind: "keyword",
    text: "owala · 月搜索量约 4,471,241（平台估算）",
    source: "已有研究任务《Owala FreeSip 24 oz》· 关键词趋势",
  },
  {
    kind: "review",
    text: "Best water bottle ever",
    rating: 5,
    source: "已有研究任务《Owala FreeSip 24 oz》· 关键词趋势",
  },
];

const SET = buildMarketSignalSet(DRAFTS, DRAFTS.length);

function promptFor(drafts: readonly MarketSignalDraft[] = DRAFTS): string {
  return buildOpportunityAnalysisPrompt(INPUT, buildMarketSignalSet(drafts, drafts.length));
}

/** 截取信号区（从「## 真实市场信号」到「## 输出格式」之前）。 */
function signalSection(prompt: string): string {
  const start = prompt.indexOf("## 真实市场信号");
  const end = prompt.indexOf("## 输出格式");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return prompt.slice(start, end);
}

const signalLines = (prompt: string): string[] =>
  signalSection(prompt)
    .split("\n")
    .filter((line) => /^S\d+ \[/.test(line.trim()));

const indexLines = (prompt: string): string[] =>
  signalSection(prompt)
    .split("\n")
    .filter((line) => /^T\d+ -> /.test(line.trim()));

describe("buildOpportunityAnalysisPrompt — 来源短编号压缩", () => {
  describe("压缩前后 signal 内容一致", () => {
    it("每条信号行去掉末尾〔T#·类型〕后，与未压缩形态逐字符一致", () => {
      const prompt = promptFor();
      const lines = signalLines(prompt);
      expect(lines).toHaveLength(DRAFTS.length);

      lines.forEach((line, i) => {
        const draft = SET.items[i];
        const label = MARKET_SIGNAL_KIND_LABELS[draft.kind];
        const rating = draft.rating !== null ? ` 评分${draft.rating}/5` : "";
        // 去掉末尾的来源短引用，剩下的必须与「无来源」时的形态完全相同
        const withoutSourceRef = line.replace(/\s*〔T\d+·[^〕]+〕\s*$/, "");
        expect(withoutSourceRef).toBe(`${draft.ref} [${label}]${rating} ${draft.text}`);
      });
    });

    it("S 编号、类型标签、评分、正文全部原样保留", () => {
      const prompt = promptFor();
      SET.items.forEach((item) => {
        expect(prompt).toContain(`${item.ref} [${MARKET_SIGNAL_KIND_LABELS[item.kind]}]`);
        expect(prompt).toContain(item.text);
      });
      // 评分只在有值时出现，且格式不变
      expect(prompt).toContain("评分1/5");
      expect(prompt).toContain("评分5/5");
    });

    it("旧的完整来源串不再出现在信号行里（已改为索引承载）", () => {
      const prompt = promptFor();
      expect(prompt).not.toContain("〔来源：");
      // 完整来源串只允许出现在索引行中
      for (const line of signalLines(prompt)) {
        for (const draft of DRAFTS) {
          if (draft.source) expect(line).not.toContain(draft.source);
        }
      }
    });

    it("在真实形态（16 条信号 / 8 个来源）下确实显著更短", () => {
      // 复刻 C 组的真实形态：8 个不同来源，每个来源贡献 2 条信号
      const realistic: MarketSignalDraft[] = [];
      for (let s = 0; s < 8; s += 1) {
        const source = `已有研究任务《Owala FreeSip Stainless Steel Water Bottle 24 oz Variant ${s}》· 评论 · B0BZYCJK8${s}`;
        for (let k = 0; k < 2; k += 1) {
          realistic.push({ kind: "review", text: `真实评论内容第 ${s}-${k} 条，用于撑出与线上等长的信号区`, rating: 5, source });
        }
      }
      const set = buildMarketSignalSet(realistic, realistic.length);
      const compressed = signalSection(buildOpportunityAnalysisPrompt(INPUT, set)).length;

      // 还原成旧形态（每条信号都带完整来源）作为对照
      const legacy = [
        `## 真实市场信号（UNTRUSTED DATA，共 ${set.items.length} 条；只能引用下列编号，不得新增编号）`,
        ...set.items.map((item) => {
          const rating = item.rating !== null ? ` 评分${item.rating}/5` : "";
          const src = item.source ? ` 〔来源：${item.source}〕` : "";
          return `${item.ref} [${MARKET_SIGNAL_KIND_LABELS[item.kind]}]${rating} ${item.text}${src}`;
        }),
      ].join("\n");

      expect(compressed).toBeLessThan(legacy.length);
      // 记录真实收益：低于 10% 说明这个方案对目标（降低提示词体量）作用有限
      const savedPercent = ((legacy.length - compressed) / legacy.length) * 100;
      expect(savedPercent).toBeGreaterThan(10);
    });

    it("来源少而信号也少时，索引的固定开销会超过收益（已知边界，非缺陷）", () => {
      // 2 个来源 / 4 条信号：索引头 + 说明行 + T# 前缀的固定成本压不下去
      const compressed = signalSection(promptFor()).length;
      const legacy = [
        `## 真实市场信号（UNTRUSTED DATA，共 ${SET.items.length} 条；只能引用下列编号，不得新增编号）`,
        ...SET.items.map((item) => {
          const rating = item.rating !== null ? ` 评分${item.rating}/5` : "";
          const src = item.source ? ` 〔来源：${item.source}〕` : "";
          return `${item.ref} [${MARKET_SIGNAL_KIND_LABELS[item.kind]}]${rating} ${item.text}${src}`;
        }),
      ].join("\n");
      // 明确记录：这个规模下压缩反而更长，所以「压缩收益」必须在真实规模上测量
      expect(compressed).toBeGreaterThan(legacy.length);
    });
  });

  describe("source mapping 正确", () => {
    it("索引按首次出现顺序为每个不同来源分配 T 号，且含完整来源", () => {
      const prompt = promptFor();
      const uniqueSources = [...new Set(DRAFTS.map((d) => d.source))];
      const lines = indexLines(prompt);
      expect(lines).toHaveLength(uniqueSources.length);
      lines.forEach((line, i) => {
        expect(line.trim()).toBe(`T${i + 1} -> ${uniqueSources[i]}`);
      });
    });

    it("同一来源的多次出现共用同一个 T 号", () => {
      const prompt = promptFor();
      const lines = signalLines(prompt);
      // 第 3、4 条草稿来自同一来源 → T 号必须相同
      const refOf = (line: string) => line.match(/〔T(\d+)·[^〕]+〕/)?.[1];
      expect(refOf(lines[2])).toBe(refOf(lines[3]));
      // 第 1、2 条来自另一来源 → T 号不同
      expect(refOf(lines[0])).not.toBe(refOf(lines[2]));
    });

    it("每条信号的 T 号指向的索引项，就是这条信号自己的来源", () => {
      const prompt = promptFor();
      const lines = signalLines(prompt);
      const indexOf = new Map(
        indexLines(prompt).map((line) => {
          const m = line.trim().match(/^T(\d+) -> (.*)$/);
          return [m![1], m![2]];
        }),
      );
      lines.forEach((line, i) => {
        const t = line.match(/〔T(\d+)·/)?.[1];
        expect(t).toBeDefined();
        expect(indexOf.get(t!)).toBe(SET.items[i].source);
      });
    });

    it("T 编号连续且从 1 开始，不跳号", () => {
      const nums = indexLines(promptFor()).map((line) => Number(line.trim().match(/^T(\d+)/)![1]));
      expect(nums).toEqual(nums.map((_, i) => i + 1));
    });

    it("信号没有来源时（手动输入路径）不生成索引，也不追加短引用", () => {
      const manual: MarketSignalDraft[] = [
        { kind: "review", text: "卡扣太紧，单手打不开", rating: 2 },
        { kind: "keyword", text: "owala" },
      ];
      const prompt = promptFor(manual);
      expect(indexLines(prompt)).toHaveLength(0);
      expect(prompt).not.toContain("来源索引");
      expect(prompt).not.toContain("〔T");
      expect(signalLines(prompt)).toHaveLength(2);
    });
  });

  describe("AI 引用编号仍可解析", () => {
    it("S 编号连续、从 S1 开始，与信号集合的 ref 完全一致", () => {
      const prompt = promptFor();
      const refs = signalLines(prompt).map((line) => line.match(/^(S\d+)/)![1]);
      expect(refs).toEqual(SET.items.map((item) => item.ref));
      expect(refs[0]).toBe("S1");
    });

    it("collectSignalRefs 解析出的编号集合未受压缩影响", () => {
      const valid = collectSignalRefs(SET);
      const refs = signalLines(promptFor()).map((line) => line.match(/^(S\d+)/)![1]);
      expect(refs.every((r) => valid.has(r))).toBe(true);
      expect(valid.size).toBe(SET.items.length);
    });

    it("提示词仍保留「只能引用出现过的编号」的防编造约束", () => {
      const prompt = promptFor();
      expect(prompt).toContain("只能引用下列编号，不得新增编号");
      expect(prompt).toContain("signalRefs 只能填写上面「真实市场信号」中实际出现过的编号");
      expect(prompt).toContain("不得编造新的来源或新的 T 编号");
    });

    it("来源索引说明出现，且 T 编号的语义被解释过", () => {
      const prompt = promptFor();
      expect(prompt).toContain("来源索引");
      expect(prompt).toContain("〔T#·类型〕");
      expect(prompt).toContain(`共 ${new Set(DRAFTS.map((d) => d.source)).size} 个`);
    });

    it("无信号时仍走原有的「暂无真实数据依据」分支，不出现索引或 T 编号", () => {
      const prompt = buildOpportunityAnalysisPrompt(INPUT);
      expect(prompt).toContain("本次未提供真实市场信号");
      expect(prompt).not.toContain("来源索引");
      expect(prompt).not.toContain("〔T");
      expect(signalLines(prompt)).toHaveLength(0);
    });
  });
});
