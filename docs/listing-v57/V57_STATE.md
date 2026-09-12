# Listing V5.7 — 冻结状态

> **版本提示（2026-09-12）**：本文件是 **V5.7（提交 `235e11b`）当时的冻结记录**，其中的版本号与指纹属于那次冻结。
> 代码当前已到 **v6**：Validator `listing-v5.validation.v6`、Writer `listing-v5-writer.v6`、Strategy `listing-v5-strategy.v6`（Repair `listing-v5-repair.v3`）。
> 最新冻结审计见 `docs/listing-v5/FINAL_FREEZE_V6.md`。历史记录不回溯改写。

> 本文件是 Listing V5.7 的**交付冻结记录**：版本、可复现基线、已交付修复、已知限制与证据位置。
> 面向需要核对"当前到底是什么版本、能不能复现"的读者。实验过程见同目录 `RESEARCH_LOG.md`。

- 冻结日期：2026-09-11
- 仓库：`project-001-listing-v5`，分支 `feat/listing-v5-rebuild`
- **冻结提交：`235e11b`**（其上是 `6f8d6a5` 与 `e017018`）

---

## 1. 版本信息（可复现所需）

| 项 | 值 |
| --- | --- |
| Validator | `listing-v5.validation.v4`（`lib/listingV5/types.ts`） |
| Writer prompt | `listing-v5-writer.v4` |
| Strategy prompt | `listing-v5-strategy.v4` |
| Repair / Rewrite / Recovery prompt | `listing-v5-repair.v3` / `listing-v5-rewrite.v1` / `listing-v5-recovery.v1` |
| 生成链路 | `writer → validate →(REPAIRABLE) repair≤1 → validate →(未 PASS) rewrite≤1 → validate →(REPAIRABLE，仅当未用过 repair) repair≤1 → validate →(未 PASS) recovery≤1 → validate → 确定性 fallback` |
| Provider（基线测量） | `deepseek` / `deepseek-v4-flash`，`temperature=0.4`，每案 writer 1 次 |
| 预算记账 | 预占 provider 调用 `1 / 4 / 5`（analyze_strategy / 有缓存 strategy / 无缓存） |

## 2. V5.7 基线（当前有效）

Holdout：3 个全新真实商品案（SellerSprite 新导出，ASIN 与品牌在仓库历史中零命中）。

| 案 | ASIN | taskId | contextFingerprint（v4） | status | unsupported | hardClaim | Conversion Score |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V52-C4 | B0F831L31B | `cmtwkgfjk000eonodmcagugei` | `52e4df12b41f1ad26ba4dbffdb4fd15701d0ef21c20f335e9fa63491be9e1c3e` | REPAIRABLE | 1 | 0 | **94** |
| V52-C7 | B07CZBNV27 | `cmtwkkjem000nonod6g8at3zz` | `3d530a3cc3a676b824ee0bd1553ef9f4090f3974b34fec916bdcc0d30ce478cc` | REPAIRABLE | 2 | 1 | **86** |
| V52-C1 | B0F7K4N6Z3 | `cmtwkd1oo0005onodo37h5fuk` | `e2a7109053afec26e94fa647369bce012969fd69f79dad3332c17bf26a58034a` | REPAIRABLE | 2 | 0 | **87** |
| 合计 | — | — | handoffRevision 2 | PASS **0/3** | 5 | 1 | 平均 **89.0** |

运行契约：**不运行 repair / rewrite / recovery / fallback**；`writerCalls=3`（每案 1 次）；离线 runner，未经 route。

**同 draft 归因复验**（同一份 draft、同一指纹，仅换修复后的规则）：

| 案 | 修复前 | 修复后 |
| --- | --- | --- |
| C4 | REPAIRABLE / 1 / hard 0 | REPAIRABLE / 1 / hard 0（不变） |
| C7 | REPAIRABLE / 1 / hard 0 | REPAIRABLE / 1 / hard 0（不变） |
| **C1** | **BLOCK / 5 / hard 1** | **REPAIRABLE / 4 / hard 0** |

## 3. 已交付的两处 Validator 修复

| 提交 | 修复 | 测试 | 效果 |
| --- | --- | --- | --- |
| `6f8d6a5` | model 证据：**仅** `canonicalField === "series_or_model"` 可作为型号证据（删除"看起来像型号的任意事实"兜底）；span 级放行；伪造型号反向检测报 `unsupported_model_code`；code 形态收窄（排除 SKU123/ABC123/PRO5/A100/Black2/Plastic5/ASIN/尺寸） | `lib/listingV5/validationModelCode.test.ts` 9 条 | 已确认型号不再被误判；伪造型号不再漏检 |
| `235e11b` | hard 词表**枚举语境**不再误报：`in total` / `a total of` / `Total: 4 Pcs` / `total pack size|pieces|count|quantity` 不计 hard；绝对语境（`total coverage`、`complete coverage`）继续计 hard；性能词 + 量词名词（`heavy weight`、`maximum capacity`）仍计 hard | `lib/listingV5/validationHardTokenContext.test.ts` 6 条 | C1 由 BLOCK → REPAIRABLE（同 draft 归因确证） |

回归现状：`vitest run lib/listingV5` **145/145**；两处修复的专项测试 **15/15**；`tsc --noEmit` 0 error。

## 4. 已知限制（如实）

1. **PASS 0/3**：三案均停在 REPAIRABLE；按生产链路会各执行一次 repair。**尚未验证 repair 后的最终交付率**。
2. **残余问题来源**：5 条 unsupported 中 4 条是 writer 追加的"目的/框架从句"（`so you can…`、`which helps you…`、`which is what…`），1 条是 Validator 对 `warm`（颜色形容词）的语境误伤 —— 同 `total` 一类，属已知家族。
3. **Writer 表述约束实验已回滚**：禁用从句清单在 C1 上首次拿到 PASS，但 C7 退化到 BLOCK（平均分 −2.3），收益不一致 ⇒ 按验收规则回滚，规则未扩大（见 `RESEARCH_LOG.md`）。
4. **部署滞后**：本机 3005 仍运行 `BUILD_ID=d35CDvsoyqiafTI3OPKbF`（早于 v4 与两次修复）。走 route/UI 的测量必须先 `npm run build` 重建并重启，否则服务端仍是旧 Validator。
5. **冻结指纹与版本绑定**：`contextFingerprint` 计入 Validator/Writer/Strategy 版本，因此**任何提示词或校验版本变更都会使既有指纹失效**，需重新冻结（decision → complete → handoff）。
6. **环境既有失败（与本次无关）**：`lib/v4/**` 17 条（本机缺 `better-sqlite3` 原生绑定）、`lib/listingHandoff/listingOperatorCopy.test.ts` 1 条（真实任务 handoff 前置条件缺失）；`scripts/release-package`、`lib/server/native1688Bridge` 在并行全量运行下偶发，单独运行通过。

## 5. 证据位置

仓库内（可追溯、随代码提交）：

- `docs/archive/releases/`（含 `FINAL_RELEASE_REPORT.md`、`FINAL_RELEASE_REPORT_V51.md`、`FINAL_RELEASE_REPORT_V52.md`、`FINAL_FREEZE.md` 发布判定与冻结基线）
- `docs/listing-v5/`、`docs/listing-v51/`、`docs/listing-v52/`（V5.1/V5.2 冻结与缺口记录）
- `docs/listing-v57/V57_STATE.md`（本文件）、`docs/listing-v57/RESEARCH_LOG.md`

仓库外（研究证据，不进入交付面）：

- `D:\Workspace\holdout-evidence\benchmark-v57\`：三案基线 JSON（含 `confirmedFacts` + `canonicalField`、完整 writer 输入、全量 validator、五维分数、claim trace）、`v57-attribution-same-draft.json`、hard token 审计改前/改后、`pre-hard-token-fix/` 改前基线
- `D:\Workspace\holdout-evidence\benchmark-v57-writer-v2\`：已回滚的 Writer 约束实验
- `D:\Workspace\holdout-evidence\v53-v57-experiments\`：V5.3–V5.7 全部实验报告与实验脚本（含 `MANIFEST.md` 索引）

## 6. 复现方式（最简）

```bash
npm install
npm run check:local && npm run start:local     # 本机 3005（SQLite 门禁入口）
vitest run lib/listingV5                        # 145/145
tsc --noEmit                                    # 0 error
```

基线复现需要该三案的任务数据（本地 SQLite 与 handoff 快照）与 provider 凭据；无凭据时可用仓库内 mock 链路跑通流程，但基线数字不可复现（属数据依赖，不是代码差异）。
