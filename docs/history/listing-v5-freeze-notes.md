# Listing V5.1 / V5.7 冻结记录（历史归档）

> **来源**：本节内容原位于根目录 `README.md` 底部（2026-09-15 从首页移出）。
> **性质**：阶段性实验与冻结记录，**内容未改写**，保留当时的事实与数据。
> **当前状态**：请看 [../PROJECT_STATUS.md](../PROJECT_STATUS.md)；版本演进见 [../HISTORY.md](../HISTORY.md)。

---

## Listing V5.1 — Listing Intelligence Layer（2026-09-11，历史记录）

**产品定位**：面向跨境电商新手/小团队的受控研究 + Listing 准备助手；AI 只做表达与组织，事实只能来自人工确认的 Confirmed Facts。

**AI Workflow（V5.1）**
`Research（人工确认）→ Confirmed Facts → Conversion Blueprint 2.0 → Strategy → Writer → Validator →（REPAIRABLE 时）Repair →（仍失败时）诚实 fallback → Studio 展示`

**Fact Authority**
`confirmedFacts`（handoff 中 usageScopes 含 listing）是唯一事实权威；VOC / 关键词 / 竞品 / sourcing 一律为 `UNTRUSTED_REFERENCE_DATA`，只影响表达框架，永不成事实；`references.sourcing` 在 Listing V5 上下文恒为空；Writer 提示不再携带竞品原文（只带可比维度 + 我方 factIds）。

**Conversion Intelligence（V5.1 新增，确定性、零 provider）**
- `Conversion Blueprint 2.0`：`purchaseTriggers[]` / `objectionHandling[]` / `benefitPriority[]` / `decisionSequence[]`，全部绑定 confirmedFacts；
- `Quality Evaluation`（Studio 展示）与 `Conversion Score`（基准测量器）分离，二者都不参与通过/阻断判定；
- Studio 只读展示 Conversion Strategy（购买触发含"有事实支撑"标记、疑虑处理、利益优先级、决策顺序）。

**Benchmark（实测记录，不修饰）**
- V5（writer v4）：3 案真实 provider，平均 Conversion Score **81.3/100**（阈值 75）；
- V5.1（writer v5 决策序列提示）：5 案冻结池实测 **AI 直交 0/5、fallback 5/5**（unsupported claims 3/6/8 条）⇒ 提示**已回滚至 v4**，失败证据留档于 `holdout-evidence/benchmark-v51/`；
- 结论：Blueprint 2.0 保留为附加上下文，Writer 提示仍以 v4 的"事实锚定优先"为基线，后续迭代必须做单变量对照。

**安全不变量**：Validator 是唯一安全门；任何报告层（Quality Evaluation / Conversion Score / 未来 Recovery）不得改写 `validation.status`；确定性代码只做校验/归一/持久化/回退，不重写营销句以求通过。

**回滚**：每个增量独立提交；`/listing-studio-legacy` 回退路由保留；把 `LISTING_V5_WRITER_PROMPT_VERSION` 保持 `v4` 即维持已验证质量。

---

## Listing V5.7 — 冻结里程碑（2026-09-11，历史记录）

> **当前版本已前进到 v6（2026-09-12）**：Validator `listing-v5.validation.v6`、Writer prompt `listing-v5-writer.v6`、Strategy prompt `listing-v5-strategy.v6`（Repair 仍为 `listing-v5-repair.v3`）。
> 最新冻结记录见 `docs/listing-v5/FINAL_FREEZE_V6.md`；本节保留 V5.7 当时的冻结事实，不改写。

**冻结提交**：`235e11b`（其上为 `6f8d6a5`、`e017018`）；分支 `feat/listing-v5-rebuild`。
**版本（V5.7 当时）**：Validator `listing-v5.validation.v4`、Writer `listing-v5-writer.v4`、Strategy `listing-v5-strategy.v4`。

**生成链路（有界，不无限重试）**：
`writer → validate →（REPAIRABLE）repair ≤1 → validate →（未 PASS）rewrite ≤1 → validate →（REPAIRABLE 且 repair 未用过）repair ≤1 → validate →（未 PASS）recovery ≤1 → validate → 确定性 fallback`

**V5.7 三案基线（离线 runner，每案 writer 1 次，无 repair/rewrite/recovery/fallback）**：

| 案 | ASIN | status | unsupported | hardClaim | Conversion Score |
| --- | --- | --- | --- | --- | --- |
| C4 | B0F831L31B | REPAIRABLE | 1 | 0 | 94 |
| C7 | B07CZBNV27 | REPAIRABLE | 2 | 1 | 86 |
| C1 | B0F7K4N6Z3 | REPAIRABLE | 2 | 0 | 87 |
| 合计 | — | PASS 0/3 | 5 | 1 | 平均 89.0 |

**本轮交付的两处 Validator 修复**：
- `6f8d6a5` — model 证据只认 `canonicalField === "series_or_model"`，并新增**伪造型号检测**（`unsupported_model_code`）；
- `235e11b` — hard 词表的**数量枚举语境**不再误报（`in total` / `a total of` / `Total: 4 Pcs` / `total pack size`），绝对语境（`total coverage`、`complete coverage`）继续拦截。同 draft 归因复验：**C1 由 BLOCK → REPAIRABLE**。

**已验证**：`vitest run lib/listingV5` 145/145、两处修复专项测试 15/15、`tsc --noEmit` 0 error。
**已知限制与证据位置**：见 `docs/listing-v57/V57_STATE.md`；实验过程与结论索引见 `docs/listing-v57/RESEARCH_LOG.md`。
**注意**：`contextFingerprint` 计入提示词与校验版本，任何版本变更都会使既有冻结指纹失效，需重新执行 `decision → complete → handoff` 冻结。
