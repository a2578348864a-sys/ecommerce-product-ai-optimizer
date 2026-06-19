import { describe, expect, it } from "vitest";
import { safeParseJsonFromAiText } from "@/lib/server/aiClient";

describe("safeParseJsonFromAiText", () => {
  it("AI 返回 fenced JSON 时能解析", () => {
    const result = safeParseJsonFromAiText<{ verdict: string }>("```json\n{\"verdict\":\"可做但需控制成本\"}\n```");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.verdict).toBe("可做但需控制成本");
    }
  });

  it("AI 返回 JSON 前后有说明文字时能提取第一个 JSON 对象", () => {
    const result = safeParseJsonFromAiText<{ verdict: string }>("下面是结果：\n{\"verdict\":\"新手不建议做\"}\n请参考。");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.verdict).toBe("新手不建议做");
    }
  });

  it("AI 返回不可解析文本时返回 json_parse_error，不泄露完整长文本", () => {
    const result = safeParseJsonFromAiText("不是 JSON ".repeat(200));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("json_parse_error");
      expect(result.error.detail?.length).toBeLessThanOrEqual(240);
    }
  });
});
