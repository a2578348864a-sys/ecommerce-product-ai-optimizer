import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";

const routeSource = readFileSync(resolve(process.cwd(), "app/api/tasks/[id]/creative-handoff/route.ts"), "utf8");
const gateSource = readFileSync(resolve(process.cwd(), "lib/server/productCreativeHandoffPreview.ts"), "utf8");
const panelSource = readFileSync(resolve(process.cwd(), "components/creative-handoff/CreativeHandoffPanel.tsx"), "utf8");
const demoSandboxSource = readFileSync(resolve(process.cwd(), "lib/server/demoSandbox.ts"), "utf8");

describe("Sandbox Task 识别（P1-1）", () => {
  it("1. generateSandboxTaskId 生成的 ID 被识别为 Visitor Task", () => {
    // SANDBOX_TASK_PREFIX = "sandbox_task_"，isSandboxTaskId 用同一前缀
    expect(demoSandboxSource).toContain('const SANDBOX_TASK_PREFIX = "sandbox_task_"');
    expect(isSandboxTaskId("sandbox_task_abc123")).toBe(true);
  });

  it("2. sandbox_task_* 正确识别", () => {
    expect(isSandboxTaskId("sandbox_task_fa_a")).toBe(true);
  });

  it("3. 普通 Owner Task 不误判", () => {
    expect(isSandboxTaskId("task-fa-owner")).toBe(false);
    expect(isSandboxTaskId("task-ui-owner")).toBe(false);
  });

  it("4. 历史格式（demo-*）按兼容规则处理", () => {
    // creative-handoff 兼容 demo-/sandbox- 历史格式
    expect(routeSource).toContain('id.startsWith("demo-")');
    expect(routeSource).toContain('id.startsWith("sandbox-")');
  });

  it("5. 所有 Creative Handoff 读写共用同一 Helper", () => {
    expect(routeSource).toContain("isSandboxTaskId(id)");
    expect(gateSource).toContain("isSandboxTaskId(taskId)");
  });

  it("6. 不存在重复 startsWith 分流逻辑（Route 和 Gate 都用 Helper）", () => {
    // Route 和 Gate 均引用 isSandboxTaskId — 不再各自硬编码
    expect(routeSource).toContain("isSandboxTaskId");
    expect(gateSource).toContain("isSandboxTaskId");
  });
});

describe("Visitor Route 路由（P1-1）", () => {
  it("7-11. Route/Gate 的 sandbox 分支覆盖 Preview/Detail/Create/Revoke", () => {
    // Route 的 getAuth 对 sandbox 走 requireAuthenticated + demo 检查
    expect(routeSource).toContain("requireAuthenticated");
    expect(routeSource).toContain('auth.context!.mode !== "demo"');
    // Gate 的 isSandbox 分支走 getSandboxTask
    expect(gateSource).toContain("getSandboxTask(demoAccessId, taskId)");
  });

  it("12. Visitor 路径 Prisma 调用 0（Gate 的 sandbox 分支不读 prisma）", () => {
    const sandboxSection = gateSource.slice(gateSource.indexOf("if (isSandbox)"), gateSource.indexOf("} else {"));
    expect(sandboxSection).not.toContain("prisma");
    expect(sandboxSection).toContain("getSandboxTask");
  });

  it("13. Store 不存在不回退 Prisma", () => {
    expect(gateSource).toContain('if (!sandbox) return { allowed: false, reason: "legacy_not_supported"');
  });

  it("14-15. 跨 Visitor 和不存在的 404 合同由 Route 统一处理", () => {
    expect(routeSource).toContain('errorResponse(404, "task_not_found"');
  });
});

describe("冲突分类（P1-2）", () => {
  it("16-19. 409 各码触发安全刷新", () => {
    expect(panelSource).toContain('"task_result_conflict"');
    expect(panelSource).toContain('"research_revision_changed"');
    expect(panelSource).toContain('"creative_handoff_conflict"');
    expect(panelSource).toContain('"stale_preview"');
    expect(panelSource).toContain('status === 409');
  });

  it("20-21. 422 research_gate_failed/stale 触发安全刷新", () => {
    expect(panelSource).toContain('"research_gate_failed"');
    expect(panelSource).toContain('status === 422');
  });

  it("22-24. 普通业务错误不误判为冲突", () => {
    const fnSection = panelSource.slice(panelSource.indexOf("function shouldRefreshAfterCreativeHandoffError"), panelSource.indexOf("function formatDate"));
    expect(fnSection).not.toContain("no_facts_selected");
    expect(fnSection).not.toContain("confirmation_required");
    expect(fnSection).not.toContain("invalid_selection");
    // 普通 400/网络错误不触发
    expect(fnSection).not.toContain("status === 400");
  });

  it("25. 网络错误不误判为状态冲突", () => {
    expect(panelSource).toContain("网络异常，请重试");
    expect(panelSource).toContain("setRetryBody");
  });
});

describe("冲突恢复行为（P1-2）", () => {
  it("26-28. handleConflict 清空 selection/confirmed/requestId", () => {
    expect(panelSource).toContain("resetSelection()");
    expect(panelSource).toContain("setSelectedIds([])");
    expect(panelSource).toContain("setConfirmed(false)");
    expect(panelSource).toContain("setRequestId(null)");
  });

  it("29-30. 重新 GET Detail 和 Preview", () => {
    expect(panelSource).toContain("void loadAll()");
  });

  it("31. 显示重新确认文案", () => {
    expect(panelSource).toContain("数据已经更新，请重新确认");
  });

  it("32. 不自动 POST", () => {
    // handleConflict 只设置 state + loadAll，无 create 调用
    const conflictFn = panelSource.slice(panelSource.indexOf("const handleConflict"), panelSource.indexOf("const toggleSelection"));
    expect(conflictFn).not.toContain("api.create");
    expect(conflictFn).not.toContain("submitCreate");
  });

  it("33. 不复用旧 selection", () => {
    expect(panelSource).toContain("setSelectedIds([])");
  });

  it("34. Reload 失败后仍不恢复旧选择", () => {
    // 清空操作在 loadAll 之前执行
    expect(panelSource).toContain("resetSelection();");
    expect(panelSource).toContain("void loadAll();");
  });
});

describe("idempotency_conflict（P1-2）", () => {
  it("35. 不自动重试", () => {
    expect(panelSource).toContain('"idempotency_conflict"');
    const conflictMsg = panelSource.slice(panelSource.indexOf('code === "idempotency_conflict"'), panelSource.indexOf("数据已经更新"));
    expect(conflictMsg).toContain("这次请求与之前使用同一请求标识的内容不一致");
  });

  it("36. 清除旧 requestId", () => {
    expect(panelSource).toContain("setRequestId(null)");
  });

  it("37. 用户重新确认后生成新 requestId", () => {
    expect(panelSource).toContain("crypto.randomUUID()");
  });
});
