import { describe, expect, it } from "vitest";
import {
  localizeTargetAudience,
  localizePurchaseMotivation,
  localizePrimaryAngle,
  localizeTone,
  localizeUseCase,
  localizeAvoidClaim,
  localizeStrategyList,
  localizeListingQualityNote,
} from "./strategyDisplayLocalization";

describe("strategyDisplayLocalization", () => {
  it("localizes target audience correctly", () => {
    expect(localizeTargetAudience("Shoppers seeking a simpler everyday routine")).toBe("追求日常使用更省心便捷的实用型买家");
    expect(localizeTargetAudience("Shoppers comparing practical product options")).toBe("对比日常实用生活用品的精明买家");
    expect(localizeTargetAudience("Family shoppers seeking reliable essentials")).toBe("注重品质与可靠耐用的家庭买家");
    // Chinese passthrough
    expect(localizeTargetAudience("注重健康的年轻白领")).toBe("注重健康的年轻白领");
    // Fallback
    expect(localizeTargetAudience("something generic")).toBe("追求日常实用与可靠品质的消费者");
  });

  it("localizes purchase motivations correctly", () => {
    expect(localizePurchaseMotivation("clear everyday value")).toBe("看重明确的日常实用价值与性价比");
    expect(localizePurchaseMotivation("feel confident carrying the product")).toBe("出行随身携带更安心、密封防漏");
    expect(localizePurchaseMotivation("keep it easy to clean")).toBe("结构易拆好洗，清洁保养省力");
    expect(localizePurchaseMotivation("trust it to hold up in daily use")).toBe("日常使用坚固耐用、经久抗摔");
    expect(localizePurchaseMotivation("有良好保温性能")).toBe("有良好保温性能");
  });

  it("localizes primary angles correctly", () => {
    expect(
      localizePrimaryAngle("Make thermos funtainer kids food jar with spoon, 10oz, pink easier to understand and use")
    ).toBe("聚焦商品核心规格与随附配件，让买家一眼看清实用价值与适用场景");
    expect(
      localizePrimaryAngle("Highlight verified physical specifications and practical usage")
    ).toBe("突出已核验的物理规格与真实使用体验");
    expect(localizePrimaryAngle("以安全便携为核心")).toBe("以安全便携为核心");
  });

  it("localizes tone correctly", () => {
    expect(localizeTone("clear")).toBe("清晰明确");
    expect(localizeTone("practical")).toBe("实用务实");
    expect(localizeTone("shopper-focused")).toBe("聚焦买家关切");
    expect(localizeTone("温和、亲切")).toBe("温和、亲切");
  });

  it("localizes use cases correctly", () => {
    expect(localizeUseCase("everyday use")).toBe("日常高频使用");
    expect(localizeUseCase("confident carrying the product")).toBe("随身携带与外出通勤");
    expect(localizeUseCase("school lunch")).toBe("学校带餐与午餐");
    expect(localizeUseCase("日常带饭")).toBe("日常带饭");
  });

  it("localizes avoid claims correctly", () => {
    expect(localizeAvoidClaim("unsupported performance or certification")).toContain("未经核查的性能承诺或虚假认证");
    expect(localizeAvoidClaim("absolute guarantees")).toContain("绝对化极限词与保证性承诺");
    expect(localizeAvoidClaim("competitor wording")).toContain("提及竞品品牌名称");
    expect(localizeAvoidClaim("严禁夸大宣传")).toBe("严禁夸大宣传");
  });

  it("localizes lists properly with delimiter", () => {
    const tones = ["clear", "practical", "shopper-focused"];
    expect(localizeStrategyList(tones, localizeTone)).toBe("清晰明确、实用务实、聚焦买家关切");
  });

  it("去重：多个机器码映射成同一句中文时只显示一次（回归：曾经同一句重复 4 遍）", () => {
    // 真实数据形态：多路研究给出不同的受众原文，但都落到同一句兜底中文。
    const audiences = [
      "shoppers who value everyday practicality",
      "shoppers who value everyday practicality ",
      "unknown audience code a",
      "unknown audience code b",
    ];
    const shown = localizeStrategyList(audiences, localizeTargetAudience);
    expect(shown).toBe("追求日常实用与可靠品质的消费者");
    expect(shown.split("追求日常实用与可靠品质的消费者")).toHaveLength(2);
  });

  it("质量提示中文化：英文评估语与机器标记码不直接出现在界面上", () => {
    expect(
      localizeListingQualityNote("This listing shipped from the deterministic fallback path and is a quality regression signal, not a factual failure.")
    ).toContain("安全模板");
    expect(
      localizeListingQualityNote("Differentiation could not be measured: no comparable competitor attribute in the research references.")
    ).toContain("差异化");
    expect(localizeListingQualityNote("Copy polish needed: repeated_sentence_or_benefit")).toBe("文案可继续打磨：存在重复的句子或卖点");
    expect(localizeListingQualityNote("Copy polish needed: unknown_future_flag")).toContain("unknown_future_flag");
    // 未识别的纯英文提示不直接展示；中文提示照常展示。
    expect(localizeListingQualityNote("Some brand new english note.")).toBe("");
    expect(localizeListingQualityNote("这条提示已经是中文")).toBe("这条提示已经是中文");
  });
});
