import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "components/listing-handoff/ListingHandoffSection.tsx"), "utf8");

describe("v2.2.16 Listing Studio creation brief UI", () => {
  it("keeps the five optional marketing fields visibly separate from confirmed facts", () => {
    for (const label of [
      "商品创作补充（可选）",
      "用于帮助AI理解营销方向，不代表已验证商品事实。",
      "不会写入已确认事实，也不会放宽 Claim Safety。",
      "核心卖点",
      "目标用户",
      "使用场景",
      "差异化优势",
      "内容强调方向",
    ]) {
      expect(source).toContain(label);
    }
    expect(source).toContain("setRequestId(null)");
    expect(source).toContain("setRetryBody(null)");
    expect(source).toContain("...(hasListingBrief ? { listingBrief } : {})");
  });
});


describe("轮 21 Listing 生成依据（服务端安全结果展示）", () => {
  it("展示生成依据块：实际使用事实/待确认表达/关键词来源/研究结论定位说明", () => {
    const source = readFileSync(resolve(process.cwd(), "components/listing-handoff/ListingHandoffSection.tsx"), "utf8");
    expect(source).toContain("listing-generation-basis");
    expect(source).toContain("usedFactTrace");
    expect(source).toContain("研究资料只用于定位和表达参考；Listing 硬属性只允许来自已确认商品事实。");
    expect(source).toContain("最终文案实际命中的已确认商品事实");
    expect(source).toContain("最终文案实际采用的关键词");
    expect(source).toContain("生成时提供给 AI 的研究参考");
    expect(source).toContain("待人工确认的表达");
  });
  it("前端不重判事实等级：依据块无自行分类/门禁逻辑", () => {
    const source = readFileSync(resolve(process.cwd(), "components/listing-handoff/ListingHandoffSection.tsx"), "utf8");
    expect(source).not.toContain("evidenceTier");
  });
  it("公开摘要封闭契约由真实行为测试承担（mainChain DTO 契约）；本文件仅保留前端展示断言", () => {
    // 前端展示文案断言（剩余测试保留）；服务端公开安全由真实生成路径的 DTO 契约验证
    expect(source).toContain("本次未调用 AI，当前内容为基于已确认事实生成的安全草稿。");
    expect(source).toContain("这份历史草稿没有保存生成依据，重新生成后可查看。");
  });
});


describe("V2 capability 展示（最小闭环）", () => {
  it("展示四态能力文案 + 补资料问题（最多 3 项），且不暗示必须采集竞品", () => {
    const source = readFileSync(resolve(process.cwd(), "components/listing-handoff/ListingHandoffSection.tsx"), "utf8");
    expect(source).toContain("listing-capability-badges");
    expect(source).toContain("listing-capability-copy");
    expect(source).toContain("listing-capability-questions");
    expect(source).toContain("仅能整理事实，暂不能生成正式 Listing");
    expect(source).toContain("可生成 2 条部分草稿（还缺至少 1 个独立卖点组）");
    expect(source).toContain("可生成 ${capability.targetBulletCount} 条正式卖点");
    expect(source).toContain("可生成 5 条完整卖点");
    expect(source).toContain("补资料（最多 3 项）");
  });

  it("保留旧响应兼容：capability 缺失（undefined）页面不崩溃（仅当存在才渲染）", () => {
    const source = readFileSync(resolve(process.cwd(), "components/listing-handoff/ListingHandoffSection.tsx"), "utf8");
    // 渲染条件为 capability 存在 → 旧响应无 capability 时跳过该块
    expect(source).toContain("{capability ? (");
  });
});
