import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 客户端防回归钉（2026-09 收口）。
 *
 * 行为映射由 `lib/client/listingV5SafetyDisplay.test.ts` 覆盖；这里只钉住接线：
 * 客户端不得再自己硬编码通过文案，必须读快照的真实 stale 标志。
 */

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("ListingStudioV5Client 安全检查状态接线", () => {
  const client = source("components/listing-v5/ListingStudioV5Client.tsx");

  it("通过/未通过的文案来自唯一映射函数，而不是组件内硬编码", () => {
    expect(client).toContain("deriveListingV5SafetyDisplay");
    expect(client).toContain('data-testid="listing-v5-safety-badge"');
    expect(client).toContain("data-safety-tone={safety.tone}");
    // 组件里不得再出现通过性结论的字面量（只能由 safety 提供）
    expect(client).not.toContain("安全检查通过");
    // 原来无条件渲染的「已校验」徽标必须消失
    expect(client).not.toContain("已校验");
  });

  it("读取后端 stale 标志，并给出门禁错误码对应的提示", () => {
    expect(client).toContain("snapshot?.stale");
    expect(client).toContain("errorCode");
    expect(client).toContain('data-testid="listing-v5-safety-notice"');
  });

  it("无草稿时不再渲染通过性的三条绿色断言", () => {
    // 三格断言被 listing 条件包住：没有草稿时改为"暂无校验结论"说明
    expect(client).toContain("还没有草稿，因此没有任何校验结论");
  });

  it("门禁拒绝时禁用生成类按钮，并提供返回商品研究入口", () => {
    // 服务端已明确拒绝时，两个生成类按钮都必须禁用（重试不可能成功）
    const disabledBindings = client.match(/disabled=\{busy \|\| safety\.gateBlocked\}/g) ?? [];
    expect(disabledBindings).toHaveLength(2); // 重新分析策略 + 生成/重新生成 Listing
    expect(client).toContain("safety.gateBlocked ?");
    expect(client).toContain("返回商品研究 / 任务详情");
    // 任务不存在时不能指向不存在的详情页（死链），退回研究记录列表
    expect(client).toContain('errorCode === "task_not_found" ? "/tasks"');
    expect(client).toContain("返回研究记录");
    expect(client).toContain("import Link from \"next/link\";");
  });

  it("creativeHandoff 缺失（creative_confirmation_required）时挂载创作资料确认步骤，确认后重新读取状态", () => {
    // 复现既有确认链（同一组件 / 同一 human_confirmed 写入路径），不新写业务逻辑
    expect(client).toContain("import { TaskStudioPreparation } from \"@/components/studio/TaskStudioPreparation\";");
    expect(client).toContain('const needsCreativeConfirmation = errorCode === "creative_confirmation_required";');
    expect(client).toContain('data-testid="listing-v5-creative-confirmation"');
    expect(client).toContain("研究事实已确认，还需完成一次创作资料确认");
    expect(client).toContain("关键词方案确认不等于创作资料确认");
    expect(client).toContain('<TaskStudioPreparation taskId={taskId} kind="listing" onCommitted={() => void load()}>');
    // 确认入口只在需要确认时出现，且不得自动创建/伪造事实
    expect(client).toContain("{needsCreativeConfirmation ? (");
  });

  it("真正没有商品事实时仍不挂载创作确认步骤", () => {
    expect(client).not.toContain('const needsCreativeConfirmation = errorCode === "no_confirmed_facts";');
  });

  it("草稿没有后端搜索词时不显示「0 个词」，并如实说明关键词方案仍在研究记录中", () => {
    // 研究侧「关键词方案已确认」与草稿「0 个词」并列会让用户以为系统故障（真实浏览器复现）。
    expect(client).toContain('searchTerms.length > 0 ? `${searchTerms.length} 个词` : "本次未写入"');
    expect(client).toContain("本次 Listing 草稿未包含后端搜索词");
    expect(client).toContain("已确认的关键词方案仍在研究记录中");
    // 没有搜索词时不能给出「已复制」的假成功
    expect(client).toContain("disabled={searchTerms.length === 0}");
  });

  it("开发者信息与质量明细默认折叠，且折叠标题不暴露模型/provider/token", () => {
    const openingTag = (testId: string) =>
      client.match(new RegExp(`<details[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";
    expect(openingTag("listing-v5-trace-details")).not.toBe("");
    expect(openingTag("listing-v5-trace-details")).not.toContain("open");
    expect(openingTag("listing-v5-quality-evaluation")).not.toContain("open");
    expect(client).toContain("开发者信息（可忽略）：AI 调用过程与校验明细");
    // 模型名不得出现在默认可见的折叠标题上（展开后的执行明细里仍有 模型 列）
    expect(client).not.toContain("模型：{aiModelLabel}");
  });
});
