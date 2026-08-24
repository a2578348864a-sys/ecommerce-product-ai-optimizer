import { describe, expect, it } from "vitest";
import { cleanReviewDisplayText, isEmptyReviewText, hasEnglishSentence, hasEnglishBusinessAnalysis } from "./vocReviewText";

describe("VOC 评论展示文本清洁（R6 收口）", () => {
  it("删除 <img src=...> 头像片段，仅显示评论文字", () => {
    const dirty = '<img src="https://example.com/avatar.png">This bottle keeps water cold all day.';
    const cleaned = cleanReviewDisplayText(dirty);
    expect(cleaned).not.toContain("<img");
    expect(cleaned).not.toContain("avatar.png");
    expect(cleaned).toContain("This bottle keeps water cold all day.");
  });
  it("删除任意 HTML 标签", () => {
    const dirty = "<p>Lid is sturdy</p><span> but leaks.</span>";
    expect(cleanReviewDisplayText(dirty)).toBe("Lid is sturdy but leaks.");
  });
  it("清理多余空格与异常前缀", () => {
    expect(cleanReviewDisplayText("   Too   many   spaces   ")).toBe("Too many spaces");
    expect(cleanReviewDisplayText("\n\t leading")).toBe("leading");
  });
  it("安全解码常见 HTML 实体", () => {
    expect(cleanReviewDisplayText("It&#39;s &amp; perfect")).toBe("It's & perfect");
  });
  it("清理后为空则 isEmptyReviewText 返回 true", () => {
    expect(isEmptyReviewText(cleanReviewDisplayText('<img src="x">'))).toBe(true);
    expect(isEmptyReviewText(cleanReviewDisplayText("   "))).toBe(true);
  });
});

describe("VOC 历史英文业务分析判定（R6 修复：纯函数）", () => {
  it("英文句子（无中文且>=2个英文单词）→ true", () => {
    expect(hasEnglishSentence("Users love the solid construction.")).toBe(true);
    expect(hasEnglishSentence("Good quality")).toBe(true);
    expect(hasEnglishSentence("School lunches")).toBe(true);
    expect(hasEnglishSentence("Only one review; may not be representative.")).toBe(true);
  });
  it("中文内容（含中文）→ false", () => {
    expect(hasEnglishSentence("做工扎实")).toBe(false);
    expect(hasEnglishSentence("用户认可做工。")).toBe(false);
  });
  it("中文业务句夹带品牌/ASIN/单位/日期 → false", () => {
    expect(hasEnglishSentence("THERMOS B08NCVT244 的 10 oz 保温效果好。")).toBe(false);
    expect(hasEnglishSentence("手感扎实（THERMOS）2026-08-19 采集。")).toBe(false);
  });
  it("单个品牌/型号/ASIN/单位 token → false（不单独触发）", () => {
    expect(hasEnglishSentence("THERMOS")).toBe(false);
    expect(hasEnglishSentence("FUNTAINER")).toBe(false);
    expect(hasEnglishSentence("B08NCVT244")).toBe(false);
    expect(hasEnglishSentence("10 oz")).toBe(false);
  });
  it("英文日期标签不单独触发", () => {
    expect(hasEnglishSentence("April 23 - September 01")).toBe(false);
    expect(hasEnglishSentence("2026-08-19")).toBe(false);
  });
  it("空值/非字符串 → false", () => {
    expect(hasEnglishSentence(null)).toBe(false);
    expect(hasEnglishSentence(undefined)).toBe(false);
    expect(hasEnglishSentence("")).toBe(false);
  });
});

describe("VOC 历史英文识别全字段扫描（R6 修复：纯函数）", () => {
  type TestTheme = { label: string; summary: string; limitations: string | null };
  type TestConflict = { label: string; summary: string; note: string | null };
  type TestScan = {
    themes: {
      positiveThemes: TestTheme[];
      painPointThemes: TestTheme[];
      usageScenarios: TestTheme[];
      recurringRequests: TestTheme[];
      weakSignals: TestTheme[];
      conflicts: TestConflict[];
    };
    unknowns: string[];
    nextResearchSteps: string[];
  };
  const cnTheme = (over: Partial<TestTheme> = {}): TestTheme => ({ label: "做工扎实", summary: "用户认可做工。", limitations: null, ...over });
  const base = (): TestScan => ({
    themes: {
      positiveThemes: [cnTheme()],
      painPointThemes: [cnTheme({ label: "材质显廉价", summary: "竞品提到材质问题。" })],
      usageScenarios: [],
      recurringRequests: [],
      conflicts: [{ label: "重量感知相反", summary: "有人认为扎实，有人认为笨重。", note: "不判断哪边更真实。" }],
      weakSignals: [],
    },
    unknowns: ["样本仅 2 条，无法证明普遍性。"],
    nextResearchSteps: ["补充更多评论后重跑。"],
  });
  it("全中文 → false（不误触发）", () => {
    expect(hasEnglishBusinessAnalysis(base())).toBe(false);
  });
  it("中文 label + 英文 summary → true", () => {
    const a = base();
    a.themes.positiveThemes[0].summary = "Users love the solid construction.";
    expect(hasEnglishBusinessAnalysis(a)).toBe(true);
  });
  it("英文 limitations → true", () => {
    const a = base();
    a.themes.positiveThemes[0].limitations = "Only one review; may not be representative.";
    expect(hasEnglishBusinessAnalysis(a)).toBe(true);
  });
  it("英文 conflict summary → true", () => {
    const a = base();
    a.themes.conflicts[0].summary = "Some say it is solid; others say it is heavy.";
    expect(hasEnglishBusinessAnalysis(a)).toBe(true);
  });
  it("英文 conflict note → true", () => {
    const a = base();
    a.themes.conflicts[0].note = "The negative review is a single instance.";
    expect(hasEnglishBusinessAnalysis(a)).toBe(true);
  });
  it("英文 unknowns → true", () => {
    const a = base();
    a.unknowns = ["Sample cannot prove durability."];
    expect(hasEnglishBusinessAnalysis(a)).toBe(true);
  });
  it("英文 nextResearchSteps → true", () => {
    const a = base();
    a.nextResearchSteps = ["Need more reviews to confirm."];
    expect(hasEnglishBusinessAnalysis(a)).toBe(true);
  });
  it("usageScenarios / recurringRequests / weakSignals 英文 label → true", () => {
    const a = base();
    a.themes.usageScenarios = [cnTheme({ label: "School lunches", summary: "用于学校午餐。" })];
    expect(hasEnglishBusinessAnalysis(a)).toBe(true);
    const b = base();
    b.themes.recurringRequests = [cnTheme({ label: "Preheat with hot water", summary: "建议预热。" })];
    expect(hasEnglishBusinessAnalysis(b)).toBe(true);
    const c = base();
    c.themes.weakSignals = [cnTheme({ label: "Leak proof", summary: "个别提到。" })];
    expect(hasEnglishBusinessAnalysis(c)).toBe(true);
  });
  it("theme.label 英文（其余中文）→ true", () => {
    const a = base();
    a.themes.positiveThemes[0].label = "Good quality";
    expect(hasEnglishBusinessAnalysis(a)).toBe(true);
  });
  it("中文业务句中夹带品牌/ASIN/单位 → false（不降级）", () => {
    const a = base();
    a.themes.positiveThemes[0].summary = "THERMOS（B08NCVT244，10 oz）的保温效果好。";
    expect(hasEnglishBusinessAnalysis(a)).toBe(false);
  });
});

describe("VOC 评论展示文本清洁边界（R6 修复）", () => {
  it("实体编码 img 解码后不残留（先解码后去标签）", () => {
    expect(cleanReviewDisplayText("&lt;img src=&quot;https://x/a.png&quot;&gt; Nice.")).toBe("Nice.");
    expect(cleanReviewDisplayText("Nice &lt;img src=x&gt;")).toBe("Nice");
  });
  it("双层实体（&amp;lt;img）两轮有界规范化后移除", () => {
    expect(cleanReviewDisplayText("&amp;lt;img src=&amp;quot;x&amp;quot;&amp;gt; Hot.")).toBe("Hot.");
  });
  it("截断的未闭合 <img 尾部不残留（2000 字符截断场景）", () => {
    expect(cleanReviewDisplayText("Great <img src=https://x/a.png")).toBe("Great");
    expect(cleanReviewDisplayText("Great <img src=\"https://x/a")).toBe("Great");
  });
  it("跨行属性 / 大小写 / 自闭合标签移除", () => {
    expect(cleanReviewDisplayText("<img\n src=\"x\"\n alt=\"a\"/> Warm.")).toBe("Warm.");
    expect(cleanReviewDisplayText("<IMG SRC=\"x\"/> Nice.")).toBe("Nice.");
  });
  it("正常英文/中文文本保留", () => {
    expect(cleanReviewDisplayText("This bottle keeps water cold all day.")).toBe("This bottle keeps water cold all day.");
    expect(cleanReviewDisplayText("保温效果好。")).toBe("保温效果好。");
  });
  it("仅图片（含实体编码）→ 空", () => {
    expect(cleanReviewDisplayText("<img src=\"x\"/>")).toBe("");
    expect(cleanReviewDisplayText("&lt;img src=&quot;x&quot;&gt;")).toBe("");
  });
});
