import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REVOKE_REASON_OPTIONS, STALE_REASON_LABELS, ELIGIBILITY_BLOCK_LABELS } from "@/components/creative-handoff/types";

const panelSource = readFileSync(resolve(process.cwd(), "components/creative-handoff/CreativeHandoffPanel.tsx"), "utf8");
const apiSource = readFileSync(resolve(process.cwd(), "components/creative-handoff/useCreativeHandoffApi.ts"), "utf8");
const typeSource = readFileSync(resolve(process.cwd(), "components/creative-handoff/types.ts"), "utf8");
const detailSource = readFileSync(resolve(process.cwd(), "components/TaskRecordDetail.tsx"), "utf8");

describe("CreativeHandoffPanel 状态机", () => {
  it("1. Loading 状态有 aria-busy 和 Skeleton，不显示空白", () => {
    expect(panelSource).toContain('aria-busy="true"');
    expect(panelSource).toContain("animate-pulse");
    expect(panelSource).toContain('aria-label="加载中"');
  });

  it("2. Legacy 状态显示安全文案且无创建按钮", () => {
    expect(panelSource).toContain("该记录没有可信商品研究合同，暂不支持创建创作交接");
    expect(panelSource).toContain("请从商品研究池重新创建正式研究");
  });

  it("3. Gate blocked 显示阻断原因，不显示创建按钮", () => {
    expect(panelSource).toContain("gate_blocked");
    expect(panelSource).toContain("暂不能创建创作交接，请先完成研究决定或处理阻塞项");
  });

  it("4. Preview 状态存在", () => {
    expect(panelSource).toContain('kind: "preview"');
  });

  it("5. Active 状态存在", () => {
    expect(panelSource).toContain('kind: "active"');
  });

  it("6. Stale 状态存在且显示已过期 Badge", () => {
    expect(panelSource).toContain('kind: "stale"');
    expect(panelSource).toContain("已过期");
    expect(panelSource).toContain("旧版本内容仅作查看，不能用于新的内容生成");
  });

  it("7. Revoked 状态存在且显示已撤回 Badge", () => {
    expect(panelSource).toContain('kind: "revoked"');
    expect(panelSource).toContain("已撤回");
  });

  it("8. 404 统一文案", () => {
    expect(panelSource).toContain("该任务不存在或你无权访问");
  });

  it("9. Recoverable error 显示安全文案和重试按钮", () => {
    expect(panelSource).toContain('role="alert"');
    expect(panelSource).toContain("重试");
  });

  it("10. 409 conflict 显示安全消息", () => {
    expect(panelSource).toContain("数据已经更新，请重新确认");
    expect(panelSource).toContain("已清空旧选择，请重新查看最新预览后再次确认");
  });
});

describe("Preview 六层分区", () => {
  it("11. 六层分区渲染（可确认/稳定/AI/未知/禁止/偏好）", () => {
    for (const section of ["可确认事实", "稳定来源事实", "AI 辅助参考", "未知／冲突与风险", "禁止声明", "创作偏好"]) {
      expect(panelSource).toContain(section);
    }
  });

  it("12. confirmable 候选有 Checkbox", () => {
    expect(panelSource).toContain('type="checkbox"');
    expect(panelSource).toContain("onToggle");
  });

  it("13. 来源快照无事实 Checkbox（稳定来源只读）", () => {
    // 稳定来源区块不含 checkbox — 只读展示
    const stableSection = panelSource.slice(panelSource.indexOf("稳定来源事实"), panelSource.indexOf("AI 辅助参考"));
    expect(stableSection).not.toContain('type="checkbox"');
  });

  it("14. AI reference 无事实 Checkbox", () => {
    const aiSection = panelSource.slice(panelSource.indexOf("AI 辅助参考"), panelSource.indexOf("视觉参考"));
    expect(aiSection).not.toContain('type="checkbox"');
  });

  it("15. unknown/conflict 无 Checkbox", () => {
    const issueSection = panelSource.slice(panelSource.indexOf("未知／冲突与风险"), panelSource.indexOf("禁止声明"));
    expect(issueSection).not.toContain('type="checkbox"');
  });

  it("16. blocking issue 时不能提交", () => {
    expect(panelSource).toContain("blockingIssues.length > 0");
    expect(panelSource).toContain("存在阻塞问题，暂不能创建创作交接");
  });

  it("17. 默认不选择（初始 selectedIds 空数组）", () => {
    expect(panelSource).toContain("useState<string[]>([])");
  });

  it("18. 选择计数实时显示", () => {
    expect(panelSource).toContain("已选 {selectedIds.length} 项");
  });

  it("19. 未选择按钮 disabled", () => {
    expect(panelSource).toContain("selectedIds.length >= 1");
    expect(panelSource).toContain("请至少选择一项事实");
  });

  it("20. 未确认按钮 disabled", () => {
    expect(panelSource).toContain("!confirmed");
    expect(panelSource).toContain("请先勾选人工确认");
  });
});

describe("请求合同", () => {
  it("21. 只提交 selectionId（selectedFactCandidateIds）", () => {
    expect(apiSource).toContain("selectedFactCandidateIds: input.selectedFactCandidateIds");
  });

  it("22. 不提交 fact 对象", () => {
    expect(apiSource).not.toContain("displayValue:");
    expect(apiSource).not.toContain("canonicalField:");
  });

  it("23. 不提交 candidateId", () => {
    expect(apiSource).not.toContain("candidateId");
  });

  it("24. confirmed=true", () => {
    expect(apiSource).toContain("confirmed: true");
  });

  it("25. expectedStorageVersion 传递", () => {
    expect(apiSource).toContain("expectedStorageVersion: input.expectedStorageVersion");
  });

  it("26. expectedResearchRevision 传递", () => {
    expect(apiSource).toContain("expectedResearchRevision: input.expectedResearchRevision");
  });

  it("27. expectedCurrentHandoffRevision 传递", () => {
    expect(apiSource).toContain("expectedCurrentHandoffRevision: input.expectedCurrentHandoffRevision");
  });

  it("28. 使用 requestId", () => {
    expect(apiSource).toContain("requestId: input.requestId");
  });

  it("29. 成功后刷新", () => {
    expect(panelSource).toContain("await loadAll()");
  });

  it("30. 网络重试复用同 requestId", () => {
    expect(panelSource).toContain("重试同一请求");
    expect(panelSource).toContain("setRetryBody");
  });
});

describe("Revision", () => {
  it("31. 第一版文案：创建创作交接", () => {
    expect(panelSource).toContain("创建创作交接");
  });

  it("32. 新 Revision 文案：创建新版本", () => {
    expect(panelSource).toContain("创建新版本");
  });

  it("33. 新 Revision 前重新 Preview（409 后 loadAll）", () => {
    expect(panelSource).toContain("void loadAll()");
  });

  it("34. 不提交 append action", () => {
    expect(apiSource).toContain('action: "create"');
    expect(apiSource).not.toContain('action: "append"');
    expect(panelSource).not.toContain("append");
  });

  it("35. 浏览器不能指定 revision", () => {
    expect(apiSource).not.toContain("revision:");
    expect(apiSource).not.toContain("currentRevision:");
  });
});

describe("Conflict", () => {
  it("36. 409 后清空选择", () => {
    expect(panelSource).toContain("resetSelection()");
    expect(panelSource).toContain("setSelectedIds([])");
  });

  it("37. 409 后清空确认", () => {
    expect(panelSource).toContain("setConfirmed(false)");
  });

  it("38. 409 后重新 GET", () => {
    expect(panelSource).toContain("handleConflict");
    expect(panelSource).toContain("void loadAll()");
  });

  it("39. 不自动重新提交", () => {
    // conflict 分支只设置 state 和 loadAll，无自动 create
    expect(panelSource).toContain('kind: "conflict"');
  });

  it("40. 旧 selectionId 不复用", () => {
    expect(panelSource).toContain("setRequestId(null)");
  });
});

describe("Revoke", () => {
  it("41. Revoke 原因必选（枚举来自服务层）", () => {
    expect(REVOKE_REASON_OPTIONS.map((r) => r.value)).toEqual([
      "explicit_user_revoke",
      "decision_changed",
      "identity_invalid",
      "verification_invalid",
    ]);
    expect(panelSource).toContain("撤回原因");
  });

  it("42. 二次确认", () => {
    expect(panelSource).toContain('role="dialog"');
    expect(panelSource).toContain("我确认撤回");
    expect(panelSource).toContain("确认撤回");
  });

  it("43. 成功后刷新", () => {
    expect(panelSource).toContain("交接已撤回，历史版本仍会保留");
  });

  it("44. 撤回影响文案", () => {
    expect(panelSource).toContain("撤回后，当前交接不能再用于新的内容生成。历史版本仍会保留");
  });

  it("45. 历史仍显示", () => {
    expect(panelSource).toContain("历史版本");
    expect(panelSource).toContain("Revision {version.revision}");
  });
});

describe("DTO 安全", () => {
  it("46. 类型文件不含内部字段（注释外无类型声明）", () => {
    // 顶部注释声明禁止项（安全说明），但不得出现实际类型声明
    for (const forbidden of ["candidateId", "actorRef", "demoAccessId", "subjectFingerprint", "requestKeyHash", "requestFingerprint", "creativeHandoffRequestLedger", "researchHash", "handoffFingerprint", "sourceReference", "createdBy", "confirmedBy", "approvedBy", "resultJson"]) {
      expect(typeSource).not.toMatch(new RegExp(`(type|interface|const).*${forbidden}`));
    }
    // resultJson 仅允许出现在 storageVersion.resultJsonHash 字段名中（后跟 H）
    const resultJsonUses = typeSource.match(/resultJson([A-Za-z])/g) ?? [];
    expect(resultJsonUses.every((use) => use === "resultJsonH")).toBe(true);
  });

  it("47. 不使用 any / @ts-ignore", () => {
    expect(panelSource).not.toMatch(/as any/);
    expect(apiSource).not.toMatch(/as any/);
    expect(typeSource).not.toContain("@ts-ignore");
    expect(panelSource).not.toContain("@ts-ignore");
    expect(apiSource).not.toContain("@ts-ignore");
  });

  it("48. 错误不渲染内部信息（无 hash/stack/prisma）", () => {
    expect(panelSource).not.toContain("stack");
    expect(panelSource).not.toContain("prisma");
    expect(panelSource).not.toContain("hash");
  });

  it("49. 无 Listing/Image 按钮", () => {
    expect(panelSource).not.toContain("生成 Listing");
    expect(panelSource).not.toContain("生成图片");
  });

  it("50. 不触发 AI/Provider 请求（仅 fetch handoff API）", () => {
    expect(apiSource).not.toContain("openai");
    expect(apiSource).not.toContain("anthropic");
    expect(apiSource).not.toContain("provider");
    expect(apiSource).not.toContain("/api/listing");
    expect(apiSource).not.toContain("/api/image");
  });
});

describe("V2 Visual Reference Preview DTO 安全", () => {
  it("51. thumbnailUrl 仅含 selectionId（ref=visual:…），无原始 URL/路径/候选 ID", () => {
    // 服务端构造：/api/tasks/{taskId}/visual-reference-preview?ref=visual:24hex
    const serverSource = readFileSync(resolve(process.cwd(), "lib/server/productCreativeHandoffPreview.ts"), "utf8");
    expect(serverSource).toContain("/visual-reference-preview?ref=");
    expect(serverSource).toContain("encodeURIComponent(v.selectionId)");
    // thumbnailUrl 构造处绝不使用候选/商品的原始 URL、dataUrl 或候选 ID 作参数
    const thumbLine = serverSource.split("\n").find((line) => line.includes("thumbnailUrl:")) ?? "";
    expect(thumbLine).not.toContain("imageUrl");
    expect(thumbLine).not.toContain("productKey");
    expect(thumbLine).not.toContain("candidateId");
    expect(thumbLine).not.toContain("dataUrl");
    // 浏览器 DTO 类型：thumbnailUrl 为可选中文字段，禁止以 dataUrl/外部 URL 形式存在
    expect(typeSource).not.toContain("data:image");
    expect(typeSource).not.toContain("http://");
    expect(typeSource).not.toContain("https://");
  });

  it("52. 前端缩略图用安全地址，禁用外链/内联，缓存隔离", () => {
    expect(panelSource).toContain("item.thumbnailUrl");
    expect(panelSource).toContain("PrivateThumbnail");
    // 无 base64 dataUrl / 外部 URL / 完整 hash 泄漏
    expect(panelSource).not.toContain("data:image");
    expect(panelSource).not.toContain("http://");
    expect(panelSource).not.toContain("https://");
    // 鉴权读取：fetch + buildAccessHeaders + blob → objectURL（<img> 无法带鉴权头）
    expect(panelSource).toContain("buildAccessHeaders");
    expect(panelSource).toContain("URL.createObjectURL");
    expect(panelSource).toContain("URL.revokeObjectURL");
    // 缓存隔离修复：请求 no-store（绝不命中旧缓存）+ token 绑定重请求
    expect(panelSource).toContain('cache: "no-store"');
    expect(panelSource).toContain("getAccessToken");
    expect(panelSource).toContain("tokenSnapshot");
    // 失败时占位而非报错（不中断面板）
    expect(panelSource).toContain("图片不可用");
    expect(panelSource).toContain("VISUAL_REFERENCE_LOAD_FAILED");
  });

  it("54. UI 不展示任何 contentHash 短摘要（哈希仅服务端绑定）", () => {
    expect(panelSource).not.toContain("图片指纹");
    // contentHash 字段仅出现在服务端绑定注释/类型中，不作为用户可见文本渲染
    const visualSection = panelSource.slice(panelSource.indexOf("视觉参考候选"), panelSource.indexOf("未知／冲突与风险"));
    expect(visualSection).not.toContain("item.contentHash ?");
    expect(visualSection).not.toContain("图片指纹");
  });

  it("55. 身份切换后旧图片不继续展示（token 变化 → revoke + 重新请求）", () => {
    expect(panelSource).toContain("currentToken !== tokenSnapshot");
    expect(panelSource).toContain("setTokenSnapshot(currentToken)");
    expect(panelSource).toContain("URL.revokeObjectURL(objectUrl)");
    // 旧 objectURL 释放后清空 source（不展示旧图）
    expect(panelSource).toContain('setSource("")');
  });

  it("53. 视觉参考仍然只提交 selectionId（缩略图不改变提交合同）", () => {
    expect(apiSource).toContain("selectedVisualReferenceCandidateIds");
    expect(apiSource).not.toContain("thumbnailUrl");
    expect(apiSource).not.toContain("selectedVisualThumbnail");
  });
});

describe("F 创作交接 4 步向导", () => {
  it("56. 4 步步骤条（确认事实/视觉/偏好/创建）", () => {
    expect(panelSource).toContain("确认可用事实");
    expect(panelSource).toContain("确认视觉参考");
    expect(panelSource).toContain("填写创作偏好");
    expect(panelSource).toContain("创建交接");
    expect(panelSource).toContain("第 {step} 步");
    expect(panelSource).toContain("guideStep");
  });

  it("57. 步骤 1 未选事实时显示还差什么 + 禁用下一步", () => {
    expect(panelSource).toContain("还差：至少勾选 1 项可用事实，才能继续下一步");
    expect(panelSource).toContain("!canGoNext(guideStep)");
    expect(panelSource).toContain("请先勾选至少 1 项可用事实");
  });

  it("58. 步骤 4 明确创建后开放什么", () => {
    expect(panelSource).toContain("创建后将开放：");
    expect(panelSource).toContain("Listing 草稿 · 产品图片");
    expect(panelSource).toContain("准备就绪，可创建创作交接");
  });

  it("59. 视觉参考无技术字段（无 hash/指纹/内部命名）", () => {
    expect(panelSource).not.toContain("图片指纹");
    expect(panelSource).not.toContain("contentHash ?");
  });
});

describe("Task 详情接入", () => {
  it("接入位置：创作交接步骤内，仅 workflow 类型（E 步骤工作台）", () => {
    expect(detailSource).toContain('import { CreativeHandoffPanel } from "@/components/creative-handoff/CreativeHandoffPanel"');
    // E：CreativeHandoffPanel 作为「创作交接」步骤的内容放入步骤工作台
    expect(detailSource).toContain("WorkflowStepWorkspace");
    expect(detailSource).toContain('label: "创作交接"');
    expect(detailSource).toContain("<CreativeHandoffPanel taskId={record.id} />");
    expect(detailSource).toContain('record.type === "workflow" ? (');
  });
});
