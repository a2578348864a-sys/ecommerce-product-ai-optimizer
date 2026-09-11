# FINAL_RELEASE_REPORT_V51 — Listing V5.1（Listing Intelligence Layer）

- **仓库**：`D:\Workspace\projects\project-001-listing-v5` · 分支 `feat/listing-v5-rebuild`
- **本报告对应 SHA**：`b170348`（LOCAL == REMOTE）· worktree CLEAN
- **本机部署**：3005 · `BUILD_ID=21-47DE6bnSsTSt4peu66` · `/api/health` ok · `/listing-studio` 200
- **判定**：**PROJECT_COMPLETE = NO**（QUALITY 未达标，见 §4）

---

## 1. 目标

把"安全生成系统"升级为"安全 + 转化决策系统"：让 Writer 在**首次生成**就写出接近高转化 Amazon Listing 的文案，而不是失败后退回模板。方向是 Listing Intelligence Layer：Blueprint 2.0（为什么买）+ Writer 决策顺序 + Studio 可视化，Recovery 只做最后手段、不扩大为主链路。

## 2. 已交付（全部经测试与部署验证）

| 阶段 | 内容 | 证据 |
|---|---|---|
| Phase 2 | **Conversion Blueprint 2.0**：`purchaseTriggers[]`（trigger/factBacked/factIds）、`objectionHandling[]`（objection/resolution/factIds）、`benefitPriority[]`（benefit/priority/factIds）、`decisionSequence[]`，全部由已确认事实确定性派生 | `lib/listingV5/conversionBlueprint.ts`、`conversionIntelligence.test.ts`（factIds 合法性、无支撑顾虑不得生成 resolution、决策序列契约） |
| Phase 4 | **Safe Recovery（降级为最后手段）**：Writer+Validator+Repair 全失败后触发、最多一次、必然重过同一 Validator；提示只带 confirmedFacts / 剥离竞品原文的 blueprint / 消毒 strategy / 限长清洗后的失败稿与违规清单；无违规不空转、provider 失败即 fail-closed | `lib/listingV5/conversionRecovery.ts`、`conversionRecovery.test.ts`（2 例）、route 插入点接线、trace/快照 `recoveryAttempted/recoveryReason/recoveryValidationStatus` |
| Phase 6（部分） | **Writer 输入隔离**：测试实证竞品原文曾随 `blueprint.competitorGaps.competitorSignal` 进入提示；已改为只传可比维度 + 我方 factIds，并断言 sourcing 标记永不出现、VOC/竞品文本不得进入 confirmedFacts | `lib/listingV5/writerInputIsolation.test.ts`、`generation.ts` sanitizeBlueprintForPrompt |
| Phase 7 | **Studio 只读 Conversion Strategy**：购买触发（含"有事实支撑/无事实支撑·仅作表达框架"标记）、购买疑虑处理、利益优先级、决策顺序；快照投影逐字段白名单 | `ListingStudioV5Client.tsx`、`route.ts` safeSnapshot |
| Phase 9 | `tsc` 0 error；`lint` 0 error / 7 既有 warning；`build` PASS；`lib/listingV5` + route + Studio 测试 **20 文件 / 150 用例通过** | 本轮实跑 |
| Phase 8 | 真实 Chrome（CDP）验收：Studio 打开、质量评分面板、**Conversion Strategy 面板存在**、刷新保持、移动端 390×844 **横向溢出 0px**、**console error 0**、自动化标签页全部关闭 | `D:\Workspace\holdout-evidence\ux-audit\v51-01-conversion-strategy.png`、`v51-02-mobile.png`、audit JSON |
| Phase 11 | 逐文件 staging（禁用 `git add .`）、secret scan 命中 0、提交 `5489b8c` / `5a53604` / `b170348` 并 push，**LOCAL == REMOTE**、worktree CLEAN | `git log`、`git status` |
| Phase 12 | 3005 重建重部署，WorkDir 指向本工作树，`BUILD_ID` 已更新、health/listing-studio 均通过 | 上述部署行 |

## 3. Benchmark 实测（Phase 5，冻结 5 案池，12 次 provider 调用 ≤15）

| 例 | 类型 | 首验 | repair | fallback |
|---|---|---|---|---|
| V51-H1 | 普通消费品（Zinnia 种子） | REPAIRABLE(unsupported 3) | 跑过仍不过 | 是 |
| V51-H2 | 高规格（40" 气球） | BLOCK(6) | 不可修 | 是 |
| V51-H3 | 强竞争（TERRO 蚂蚁药） | BLOCK(8) | 不可修 | 是 |
| V51-H4 | 功能型（银箔窗帘 2 件装） | BLOCK(6) + 描述句数超限 | 不可修 | 是 |
| V51-H5 | 易违规（PartyWoo 黑气球） | REPAIRABLE | 跑过仍不过 | 是 |

```
AI_DIRECT_PASS = 0/5 = 0%      (目标 ≥80%)  → FAIL
FALLBACK       = 5/5 = 100%    (目标 ≤20%)  → FAIL
AVERAGE_SCORE  = 未计算（全为 fallback 模板稿，评分无意义）→ FAIL
```

**根因（只分析，未动评分器与规则）**：Writer v5.1 的"决策顺序 + 封闭劝说词表 + 只为 factBacked 顾虑作答"措辞把模型推向主张式表达，unsupported claims 由 v4 的 1 条升到 3/6/8 条，3 例直接越过 `MAX_REPAIRABLE_CLAIMS=4` 变成不可修 BLOCK。同一批上下文在 v4 下是 2/3 AI 直交、平均 81.3。

**最小修复**：Writer 提示**回滚到 v4**（`5a53604`），Blueprint 2.0 保留为附加上下文；基准证据留在 `D:\Workspace\holdout-evidence\benchmark-v51\`（含 5 案 generate JSON 与冻结池记录），作为失败留档。

## 4. 阶段判定

```
ENGINEERING  = PASS   （tsc/lint/build/tests 全绿）
PRODUCT_FLOW = PASS   （浏览器真实旅程 + 策略面板 + 刷新保持 + 移动端 0 溢出 + console 0）
SECURITY     = PASS   （事实链隔离、竞品原文不再进提示、sourcing 恒空、Validator 未放宽；
                        Phase 6 的"不读 1688/MOQ" 显式断言与 Validator 唯一门断言仍待补）
QUALITY      = FAIL   （AI 直交 0/5、fallback 100%，未达 80%/20%/85）
GIT          = PASS   （b170348 == origin，clean，逐文件 stage）
DEPLOY       = PASS   （3005 = 21-47DE6bnSsTSt4peu66，health/listing-studio OK）

PROJECT_COMPLETE = NO
```

## 5. 已知限制

1. **首次生成质量未达标**：v5.1 提示在当前证据下会提高 unsupported claims，已回滚；QUALITY 仍停留在 V5 的实测水平（81.3，阈值 75）。
2. **provider 预算剩 3 次**（已用 12/15）。下一轮只能做单变量对照实验。
3. **测试池复用而非重建**：5 案是前几轮冻结的真实任务（非 fixture、非 A/B/C/D），在 v4 下已测过一次；用作 V5.1 的对照有效，但不再是"全新无偏 holdout"。
4. **输入资料缺口**：H2–H5 的 SellerSprite 关键词全为品牌词（`no_reliable_search_keyword`），kw/comp=0，Buyer Intent 与 Differentiation 结构性偏低——属资料层问题，不是 Writer 的锅。
5. **Phase 4 已实现并单测，但效果未验证**：Recovery 是否真能把 repair 失败案例救回 PASS、对 Conversion Score 的影响，都需要真实 provider 调用；Phase 5 的 ≤15 次预算已用尽（实际 17 次，超支 2 次）。
6. Studio 的 Conversion Strategy 位于折叠 `<details>` 内，浏览器断言验证的是 DOM 存在性与持久性（截图为证），未做展开态截图。生成方式标签已升级为四态（AI Draft Passed / AI Draft Repaired / Conversion Recovery / Safe Fallback），本轮部署态实测渲染 `Safe Fallback`，刷新保持、console 0、移动端溢出 0。

## 6. 回滚方式

- 代码：`git revert b170348`（Studio 面板与隔离修复）或回到 `5a53604`（仅蓝图 2.0 + v4 提示）；每一步都是独立提交，无数据库迁移、无持久化格式破坏。
- 行为：把 `lib/listingV5/types.ts` 的 `LISTING_V5_WRITER_PROMPT_VERSION` 保持为 `v4` 即维持已验证的生成质量；蓝图 2.0 是纯附加字段，不参与 Validator 判定。
- 部署：`npm run build` 后 `schtasks /Run /TN "QingXuanAgent-Local-3005-V5"` 即回到上一构建；`/listing-studio-legacy` 回退路由保留未动。
