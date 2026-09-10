# FINAL_RELEASE_REPORT_V51 — Listing V5.1 Conversion Recovery（**未完成**）

> 状态声明：本报告是 V5.1 的**阶段性结项记录**，不是完成交付。V5.1 的代码改动已回滚，仓库行为与已发布的 `73d4a2d` 完全一致。**未输出 `PROJECT_COMPLETE = YES`**（原因见 §7）。

- **仓库**：`D:\Workspace\projects\project-001-listing-v5` · 分支 `feat/listing-v5-rebuild`
- **当前 HEAD / 远端**：`73d4a2d`（LOCAL == REMOTE）· worktree CLEAN
- **本机部署**：3005 运行 `73d4a2d` 构建（`BUILD_ID=iRMqwvgJwH-6NY7Y_wNho`，health ok，`/listing-studio` 200）

---

## 1. 目标（V5.1）

解决 V5 最大业务问题：**Validator 安全通过 ≠ 高转化 Listing**。当 AI 初稿被拒且 repair 无法救回时，不直接降级模板，而是在 fallback 之前插入一次"安全转化恢复生成"（Conversion Recovery）：

```
Writer → Validator → Repair → Validator → Recovery（最多一次）→ Validator → Fallback
```

---

## 2. 审计结论（Phase 1，四个只读子代理）

- **A 业务转化（`conversion-gap-v51.md` 已产出）**：fallback 只有一条闸门（非 PASS 即换模板），失败后不存在"重写说法"的阶段；repair 只改 ≤3 个被点名字段且首轮 BLOCK 时根本不跑（`MAX_REPAIRABLE_CLAIMS=4`，H3 有 5 条）。模板稿由拼装器生成：主语是"购物者/listing"，标题=产品名+事实拼接，缺"需求确认 / 方案对比 / 风险消除 / 行动"四段决策链。**Repair 删错，Recovery 换说法**（事实值一个不动）。
- **B 架构（最小插入点）**：插入点在 `route.ts` repair 复位校验之后、fallback 闸门之前；守卫 `useProvider && action !== "analyze_strategy" && (repairAttempted || status === "BLOCK")`；Recovery 复用 Writer 的 `normalize`（factIds 白名单 + banned 清洗）；`plannedCalls` 生成分支 3→4；trace 复用既有失败枚举、version 保持 v1；快照 `provider` 增加 `recoveryAttempted` 并且投影必须逐字段白名单化；**既有缺陷**：CAS 冲突分支未清理 `ACTIVE_V5_JOBS`（锁泄漏，Recovery 会放大窗口）。
- **C 安全（硬约束）**：Recovery 提示只能收 confirmedFacts + 已消毒 blueprint + failedDraft 文本 + 拒绝清单 + 消毒 strategy；**必须剥离 `competitorGaps[].competitorSignal` 原文**（否则模型可复述竞品措辞，而 competitorOverlap 只查 12 词连续重合）；词表必须复用 `HARD_OR_ESCALATION_TOKENS`（不得截断）；`PROMPT_CONTROL_TEXT` 三处漂移应抽共享常量；输出必须过 `banned` + factIds 白名单；Recovery 稿必须重走同一 Validator，非 PASS 必须 fallback。
- **D 测试与浏览器（真实 CDP）**：旅程真点击通过（研究记录 → Studio → 生成 → 重新分析 → 离开 → 返回 → 刷新），**console error 全 0**，移动端 390×844 `overflow_x = 0`，刷新后内容一致（2097 字符）。发现体验问题：**P1** `/tasks` 首次进入提示"请先输入访问密码"而首页无密码入口（死路，复现 1 次后自愈）；**P1** 首页无任何可操作入口；**P2** 研究记录"查看 Listing 与图片"只做页内锚点；**P2** "重新生成"无完成反馈且结果不变；**P2** 侧栏 Listing Studio 丢 `taskId` 必落空状态；**P3** Studio 页面标题与首页相同、移动端导航需横滑。

---

## 3. 已实现但**已回滚**的改动（代码不再存在）

| 文件 | 内容 |
|---|---|
| `lib/listingV5/conversionRecovery.ts`（新增） | Recovery 模块：角色提示（Amazon conversion copy recovery specialist）、只读 confirmedFacts/blueprint/failedDraft/拒绝清单、剥离 `competitorSignal`、全量禁用词表、`PROMPT_CONTROL_TEXT` 清洗、复用 Writer 的 normalize、`useProvider` 关闭时不计费、无违规证据时拒绝空转 |
| `lib/listingV5/trace.ts` | 增 `recoveryAttempted/recoveryReason/recoveryValidationStatus` + `stages.recovery` |
| `app/api/tasks/[id]/listing-v5/route.ts` | 在 fallback 闸门之前插入一次 Recovery + 重新校验；`plannedCalls` 生成分支 +1 |
| `lib/listingV5/generation.ts` | 导出 `sanitizeStrategyForCopy` / `normalizeListingV5ProviderDraft` 供 Recovery 复用 |

**回滚原因**：这些改动当时仍处于半接线状态（trace/route 的声明与 builder 调用未同步，`tsc` 报错），而 V5.1 后半程（5 案冻结池、≤15 次 provider 基准、Recovery 安全回归、浏览器验收、部署）在本轮执行预算内**无法保质完成**。把一个半接线的生成链路提交进发布分支，风险高于收益。

回滚方式（已执行）：`git restore` 上述 3 个改动文件 + 删除 `conversionRecovery.ts`；复核 `tsc --noEmit` **0 error**、`lib/listingV5` + route 定向测试 **18 文件 / 144 用例通过**、worktree **CLEAN**、HEAD 与远端均为 `73d4a2d`。

---

## 4. Benchmark 状态

- **V5（已发布，`73d4a2d`）**：5 案中 3 案完成真实 provider 基准，**平均 Conversion Score 81.3/100**（门槛 75，PASS），AI 直交 2/3，fallback 1/3。
- **V5.1**：**未运行**。Recovery 层未合入，因此"AI 直交 ≥80% / fallback ≤20% / 平均 ≥85"三项无法测量，也无法凭猜测填写。任何在此前提下给出的数字都会是伪造结果。

---

## 5. 当前可交付状态（未回滚的部分）

| 维度 | 状态 |
|---|---|
| ENGINEERING | PASS（`tsc` 0 error、`lint` 0 error、`build` PASS、定向 144 用例通过） |
| PRODUCT_FLOW | PASS（真实浏览器旅程通过、console 0 error、状态保持、移动端无横向溢出） |
| SECURITY | PASS（V5 发布时的 F1/F2 修复与回归测试仍在；Recovery 的 6 项安全约束已形成书面契约） |
| QUALITY | 维持 V5 实测值（81.3 / 门槛 75，PASS）；V5.1 的 Recovery 提升**未验证** |
| GIT | PASS（`73d4a2d` == origin，clean） |
| DEPLOY | PASS（3005 运行 `73d4a2d`，health ok，`/listing-studio` 200） |

---

## 6. 下一步（按依赖顺序，均为最小改动）

1. 完成接线：`trace.ts` 三处同步（类型/输入/builder body）、`route.ts` 局部变量声明与 builder 调用、`types.ts` `provider.recoveryAttempted`、`safeSnapshot` 逐字段白名单（含 `safeStageTrace/safeTrace` 放行新字段）。
2. 顺手修既有缺陷：CAS 冲突分支补 `ACTIVE_V5_JOBS.delete(jobKey)`。
3. 安全回归（≥6 条，见 §2-C）：禁用词、无外部源、`competitorSignal` 剥离、注入清洗、"Recovery 失败必 fallback"、"PASS 必须真实"。
4. 重建 V5.1 测试池（≥5 真实商品，覆盖普通/高参数/强竞争/功能型/易违规），冻结后跑 ≤15 次 provider，记录初次 Writer / Repair / Recovery / 最终 Validator / fallback / Conversion Score。
5. 浏览器验收（复用本轮 CDP 脚本）+ 部署 3005 + 逐文件 stage 提交。
6. 处理 §2-D 的 P1 体验问题（`/tasks` 首屏死路、首页无可操作入口）。

---

## 7. 最终判定

```
ENGINEERING   = PASS
PRODUCT_FLOW  = PASS
SECURITY      = PASS
QUALITY       = PASS (V5 实测 81.3/100；V5.1 Recovery 未验证)
GIT           = PASS
DEPLOY        = PASS

PROJECT_COMPLETE = NO      # V5.1 目标（Conversion Recovery + ≥85 基准）未达成
```

**未完成的部分是明确的、可复现的、且已写成上表**；仓库当前停留在已验收的 `73d4a2d`，不存在半成品代码、临时脚本或未跟踪文件。
