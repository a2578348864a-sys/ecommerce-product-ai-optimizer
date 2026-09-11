# FINAL RELEASE REPORT — Listing V5.2

- 报告日期：2026-09-11
- 结论：**质量门槛未通过，发布不成立**
- 冻结基线：`CODE_SHA=65c3de3`（代码）＋ 文档提交 `c6ae728`（`HEAD`）；分支 `feat/listing-v5-rebuild`
- Holdout：`V52-C4 / V52-C7 / V52-C1`
- 本阶段未修改任何规则（Validator / Writer Prompt / Rewrite / Repair / Recovery / Conversion Score / Holdout 全部冻结）

---

## 1. 工程状态 —— PASS

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| V5.2 Conversion Rewrite 链路接入 | ✅ | `route.ts` L15 import、L435 调用、`repairUsed` 全局 ≤1、`plannedCalls 1/4/5` |
| trace 收口 | ✅ | `rewriteAttempted/rewriteReason/rewriteValidationStatus/stages.rewrite` 已入 trace；V5.1 的 recovery 盲区已修 |
| snapshot 收口 | ✅ | `safeSnapshot` provider 块逐字段白名单 |
| 单元/集成测试 | ✅ | `vitest run lib/listingV5 app/api/tasks/[id]/listing-v5` → **165 passed / 23 files** |
| 类型检查 | ✅ | `tsc --noEmit` → 0 error |
| Lint | ✅ | 0 error，7 warning（均为既有） |
| 构建 | ✅ | `npm run build` PASS，`BUILD_ID=d35CDvsoyqiafTI3OPKbF` |
| 冻结后代码零改动 | ✅ | `git diff --stat 65c3de3 HEAD -- lib app components prisma scripts tools` → 空输出 |
| 工作树 | ✅ | `git status --short` → 空 |
| 临时文件/截图/provider 日志 | ✅ | 本阶段未在仓库产生任何临时文件、截图或 provider 日志（secret 扫描命中项全部为既有已跟踪文件） |

工程侧**已具备发布条件**；阻断点在质量与安全指标（第 2、3 节）。

## 2. 质量指标 —— FAIL（三项全部未达标）

真实 provider：DeepSeek（`.env.local` 注入 3016 隔离实例，`OPENAI_LISTING_TRACE=1`）。每案**只执行一次**，无重跑、无换案。

| 指标 | 目标 | 实测 | 判定 |
| --- | --- | --- | --- |
| AI_DELIVERED_RATE | ≥ 80% | **1/3 = 33.3%** | ❌ FAIL |
| FALLBACK_RATE | ≤ 20% | **2/3 = 66.7%** | ❌ FAIL |
| SAFETY_PASS_RATE | = 100% | **2/3 = 66.7%** | ❌ FAIL |
| Conversion Score（`conversionScore.ts` 离线） | ≥ 85 | **未测量**（原因见下） | ❌ 不能判定通过 |

### 逐案结果（全部来自 `stages.*.attempted` 与 `provider.*Attempted` 双向记账）

| 案 | ASIN | first | 链路实际执行 | final | fallbackUsed | 最终来源 | provider 次数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V52-C4 | B0F831L31B | REPAIRABLE | strategy→writer→repair→**rewrite(仍 REPAIRABLE)**→**recovery(仍 REPAIRABLE)** | PASS | **true** | **FALLBACK** | 5 |
| V52-C7 | B07CZBNV27 | BLOCK | strategy→writer→**rewrite(仍 BLOCK)**→**recovery(仍 BLOCK)** | **BLOCK** | **true** | **FALLBACK** | 4 |
| V52-C1 | B0F7K4N6Z3 | REPAIRABLE | strategy→writer→repair→PASS | PASS | false | **REPAIR（AI 交付）** | 3 |
| 合计 | | | | | | AI 交付 1/3 | **12**（预算 9，超支 3） |

**预算超支如实披露**：预算 9 次，实际 12 次（+3）。超支**不是**因为重跑或换案，而是链路在 C4 上完整走了 repair→rewrite→recovery、在 C7 上走了 rewrite→recovery 且均未达到 PASS。按协议未做任何补救性重跑。

**Conversion Score 未测量的确切原因**：`POST /api/tasks/{id}/listing-v5` 只返回 `safeSnapshot` 投影（不含 `factIds`、`validation.claims` 与 `context`），忠实离线计分需要按 route 的 `buildContext` 重建全量上下文（DB 读取 + handoff gate + `buildListingV5Input`），该 harness 本轮未执行。
同时给出**有界推断**（非实测）：`conversionScore.ts` 对 `deterministicFallback` 的 Naturalness 维度**硬上限 6/20**，故 2 个 fallback 交付案的得分上限为 86；实测其正文为确定性模板句（"With Sticker, shoppers can compare a clear product detail…"、"A clear BF140 detail helps shoppers decide…"），且该模板句命中计分器的 `MECHANICAL_TEMPLATE_FRAGMENTS` 扣分项。因此 **3 案平均 ≥85 在结构上不可达**。

## 3. Safety 结果 —— FAIL

- **V52-C7` 交付的确定性 fallback 稿自身被 Validator 判 BLOCK**（`unsupportedClaimCount=6`，`blockReasons=claims:unsupported:4`），链路仍将该稿作为最终交付物返回（HTTP 200）。即：**最后一道确定性兜底不保证产出通过校验的 Listing**，本轮真实验证首次暴露该缺口。
- V52-C4、V52-C1 的最终稿为 PASS，其中 C4 是确定性 fallback 稿通过校验。
- 未发生任何"为了 PASS 而改写营销句"的行为：Validator 规则、阈值与判定路径本阶段零改动，失败案与失败原因全部保留（`D:\Workspace\holdout-evidence\benchmark-v52\V52-C*-generate.json`）。
- Rewrite 隔离仍然成立：C4/C7 的 rewrite 与 recovery 均未产出可交付稿，未把不可用内容放进最终 Listing。

## 4. Holdout 说明

- 3 案来源：`BSR(季节性装饰（当前的）)-10-US-20260911.xlsx`（今日 13:45 新导出），工作树与全部历史 commit **零命中**（ASIN 与品牌双查），非 fixture、非 synthetic。
- 生成前逐案复核 fingerprint，**与冻结文件完全一致**（无漂移）：
  - C4 `39c352a2f4a877ed4a52e592fc13df9083cbed079bee6a3bcbc82e5cfdaa1eda`（facts 8 / voc 8 / kw 10 / comp 5）
  - C7 `1dd4484a83ffedaafd7919036dfe03e96414b0f5f3ef821523304fff1c16c354`（facts 7 / voc 8 / kw 10 / comp 5）
  - C1 `fefa0b882b9eca0250e5b81eb2846595b5f2721dd93450351158ad11ba7b2dad`（facts 7 / voc 9 / kw 10 / comp 5）
- 每案仅生成一次；未删除任何失败案；未使用 H1–H5 或 A/B/C/D 作为本轮成绩。
- 候选口径与淘汰理由见 `docs/listing-v52/HOLDOUT_CANDIDATE_REPORT.md`，冻结字段见 `docs/listing-v52/V52_HOLDOUT_FREEZE.md`。

## 5. 浏览器证据 —— 未执行

Phase 4 的前置条件是"只在质量通过后执行"。第 2 节三项指标失败，因此**未执行**真实浏览器验收（未打开任何浏览器窗口/标签页，无需关闭；未产生截图）。
本轮因此**没有** UI 旅程证据（进入 Listing Studio → 生成 → 查看策略 → 查看 Listing → 重新分析 → 离开/返回/刷新、console error=0、mobile 390×844、数据保持）。
按仓库规则，这不构成"Web 功能已完成"的证据。

## 6. Git SHA

| 项 | 值 |
| --- | --- |
| 分支 | `feat/listing-v5-rebuild` |
| 冻结代码 SHA | `65c3de34d694743208b52e17f3ab640d351a4596`（V5.2 链路 `a655654` + trace 测试 `fa3b063`） |
| 本阶段起点 HEAD | `c6ae728ae75ae1693be785a11d53d91e185803ec` |
| 代码改动 | **无**（`lib/app/components/prisma/scripts/tools` 相对冻结 SHA 零 diff） |

未创建用户指定的 `feat(listing-v52): finalize conversion rewrite quality pipeline` 提交：**没有对应的代码变更可提交**，且该消息会宣称一个未通过质量门槛的发布已完成，与"禁止提前宣布完成"冲突。本阶段只提交文档（逐文件 stage，未使用 `git add .`）。

## 7. 部署状态

| 项 | 结果 |
| --- | --- |
| 3005 重建 | ✅ `npm run build` PASS，`BUILD_ID=d35CDvsoyqiafTI3OPKbF` |
| 3005 health | ✅ 200 |
| `/listing-studio` | ✅ 200 |
| `/listing-studio-legacy` | ✅ 200（保留） |
| 3016 隔离实例 | ✅ 已停止（`ownershipVerified=true`），端口已释放 |
| 临时浏览器 / 临时任务 | 无（本轮未开浏览器；未创建临时任务，3 个 Holdout 任务是冻结资产） |
| `main` 分支 | 未触碰 |

## 8. 已知限制

1. **确定性 fallback 可能自身 BLOCK**（C7 实测），且当前实现仍会交付该稿 —— 这是本轮新发现的真实缺口，未在本阶段修复（禁止修改规则/规则类代码）。
2. **Rewrite/Recovery 对硬 BLOCK 的有效性有限**：C7 的 6 条 unsupported claims 经 rewrite 与 recovery 两轮仍未降到可交付区间。
3. **Conversion Score 未实测**，仅给出"≥85 结构上不可达"的有界推断（Naturalness 对 fallback 稿硬上限 6/20）。
4. provider 预算 12/9 超支；后续同类验证应把预算按"最坏链路"（strategy+writer+repair+rewrite+recovery = 5/案）预留。
5. 本轮 3 案同属 seasonal 装饰类目，类目单一；跨类目结论未验证。
6. `scoreListingV5Conversion` 未接入 route，测量需离线 harness 且需重建全量 context（本轮未搭建）。
7. 浏览器验收、移动端（390×844）、console error、刷新/返回保持等 UI 维度**本轮全部未验证**。
8. 环境事实：本工作树无 `.env.local`；3016 必须以 `QX_RUNTIME_MODE=local_owner` 且注入 provider 环境启动，否则所有 AI 调用 502（本轮已实测确认）。

---

## PROJECT_COMPLETE: NO

理由：质量门槛三项（AI_DELIVERED_RATE / FALLBACK_RATE / SAFETY_PASS_RATE）全部未达标，Conversion Score 未能实测且结构上不可达；叠加 C7 交付了被 Validator 阻断的 fallback 稿。按协议"失败即停止、不得修改规则"，本阶段在第 3 节后停止，未进入浏览器验收与发布收口。
