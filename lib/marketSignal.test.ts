import { describe, expect, it } from "vitest";

import {
  MARKET_SIGNAL_MAX_ITEMS,
  MARKET_SIGNAL_TEXT_MAX_CHARS,
  buildSignalRef,
  collectSignalRefs,
  emptyMarketSignalSet,
  normalizeSignalText,
  parseMarketSignalText,
} from "@/lib/marketSignal";

describe("marketSignal 契约", () => {
  it("空输入 / 非字符串输入 → 未提供信号", () => {
    for (const input of ["", "   ", "\n\n", null, undefined, 42, {}]) {
      const set = parseMarketSignalText(input);
      expect(set.provided).toBe(false);
      expect(set.items).toEqual([]);
      expect(set.stats.acceptedItems).toBe(0);
    }
    expect(emptyMarketSignalSet().provided).toBe(false);
  });

  it("每行一条信号，默认类型为 review", () => {
    const set = parseMarketSignalText("卡扣太紧装了三次\n收纳后很省空间");

    expect(set.provided).toBe(true);
    expect(set.items).toHaveLength(2);
    expect(set.items[0]).toEqual({ ref: "S1", kind: "review", text: "卡扣太紧装了三次", rating: null });
    expect(set.items[1].ref).toBe("S2");
    expect(set.stats.rawLines).toBe(2);
    expect(set.stats.byKind.review).toBe(2);
  });

  it("支持 [类型] 与 [类型 评分] 前缀", () => {
    const set = parseMarketSignalText([
      "[competitor] 说明书只有英文",
      "[keyword] 折叠 收纳 便携",
      "[pain_point] 装车时容易散架",
      "[review 2] 卡扣太紧",
      "[review 5] 很省空间",
    ].join("\n"));

    expect(set.items.map((item) => item.kind)).toEqual([
      "competitor", "keyword", "pain_point", "review", "review",
    ]);
    expect(set.stats.byKind.competitor).toBe(1);
    expect(set.stats.byKind.keyword).toBe(1);
    expect(set.stats.byKind.pain_point).toBe(1);
    expect(set.stats.withRating).toBe(2);
    expect(set.stats.averageRating).toBe(3.5);
    const rated = set.items.filter((item) => item.rating !== null);
    expect(rated.map((item) => item.rating)).toEqual([2, 5]);
  });

  it("归一化后重复的信号只保留首条", () => {
    const set = parseMarketSignalText([
      "[review 2] 卡扣太紧，装了三次才装上",
      "[review 2]  卡扣太紧，装了三次才装上  ",
      "[review 2] 卡扣太紧, 装了三次才装上",
    ].join("\n"));

    // 前两条归一化后相同 → 去重；第三条标点不同 → 视为不同信号
    expect(set.stats.duplicateItems).toBe(1);
    expect(set.stats.acceptedItems).toBe(2);
  });

  it("过短的行被丢弃并计入 rejectedItems", () => {
    const set = parseMarketSignalText("ok\n这是一条足够长的真实评论内容");

    expect(set.stats.rejectedItems).toBe(1);
    expect(set.stats.acceptedItems).toBe(1);
    expect(set.items[0].ref).toBe("S1");
  });

  it("编号按接受顺序稳定生成，且单条文本被截断", () => {
    const longText = "很".repeat(MARKET_SIGNAL_TEXT_MAX_CHARS + 200);
    const set = parseMarketSignalText(`第一条有效信号\n${longText}`);

    expect(set.items[0].ref).toBe("S1");
    expect(set.items[1].ref).toBe("S2");
    expect(set.items[1].text.length).toBe(MARKET_SIGNAL_TEXT_MAX_CHARS);
    expect(buildSignalRef(0)).toBe("S1");
    expect(buildSignalRef(9)).toBe("S10");
  });

  it("信号条数有上限，超出部分不再接受", () => {
    const lines = Array.from({ length: MARKET_SIGNAL_MAX_ITEMS + 30 }, (_, index) => `第 ${index + 1} 条真实评论内容`);
    const set = parseMarketSignalText(lines.join("\n"));

    expect(set.items).toHaveLength(MARKET_SIGNAL_MAX_ITEMS);
    expect(set.stats.acceptedItems).toBe(MARKET_SIGNAL_MAX_ITEMS);
  });

  it("collectSignalRefs 只包含真实存在的编号", () => {
    const set = parseMarketSignalText("第一条有效信号\n第二条有效信号");
    const refs = collectSignalRefs(set);

    expect(refs.has("S1")).toBe(true);
    expect(refs.has("S2")).toBe(true);
    expect(refs.has("S3")).toBe(false);
  });

  it("normalizeSignalText 与 reviewEvidence 的归一化语义一致（去控制字符 + 压缩空白 + 小写）", () => {
    expect(normalizeSignalText("  A\t B\n\nC  ")).toBe("a b c");
    expect(normalizeSignalText("Ａ")).toBe("ａ");
  });
});
