# Core-Smoke-Fix.1 — SellerSprite reportType 判别证据矩阵

> 复核结论：无搜索排名列的 CC（Category Current）与 PS（Product Search 新格式）
> 在结构上完全同构（真实样本：72 列表头、US/Brands/Sellers/Note 四工作表、无搜索排名列），
> **不存在任何 deterministic 结构差异**。行级 BSR 值域是有限样本规律（12 份 CC + 1 份 PS），
> 未经 SellerSprite 官方合同证明（官方存在 Top100/Top400/加载更多导出场景，CC BSR 可 >10），
> **不得作为单点判别**。因此无搜索排名一律 fail-closed → 人工选择；
> 多信号仅作 UI 辅助建议（非判定），用户可基于报表内容推翻。

## 信号分级

| # | Signal | 级别 | 判定方向 | 证据与理由 |
|---|---|---|---|---|
| 1 | 含「搜索排名」列 | **deterministic** | → search_results | 表头唯一签名（旧格式导出）；PS/CC 新格式均无此列，互斥。12/12 CC 无此列；PS 旧格式有。 |
| 2 | Reverse ASIN / Keyword Mining 表头签名 | **deterministic** | → 关键词管线 | 互斥表头（流量词/自然排名/流量占比；关键词/相关度/ABA月排名），与商品报表表头互斥（真实样本验证）。 |
| 3 | 大类 BSR 值域 ∈[1..10] | **supporting**（建议 CC） | 辅助 | 12/12 CC 样本命中；但 Top100/加载更多导出可 >10 → 非合同。单独使用会把「排名好的 PS」或「BSR 值域外的 CC」判错，故不作判定。 |
| 4 | 大类目唯一 | **supporting**（建议 CC） | 辅助 | CC 榜单来自单类目页；但 PS 搜索词可能命中单类目（真实 Products(10) 跨 3 类目；CC 厨房/健康样本出现 2 个类目名变体）。 |
| 5 | 月销量中位数 ≥ 10,000 | **supporting**（建议 CC） | 辅助 | CC 榜单热销（3,851–467,907）；PS 样本 1–3,107。但 PS 热销搜索词可命中；非合同。 |
| 6 | Best Seller 标识行占比 ≥ 50% | **supporting**（建议 CC） | 辅助 | CC 样本 7–10/11 行带标识；PS 样本 0/10。但 PS 排名靠前商品可带；非合同。 |
| 7 | 无搜索排名 + 四件套齐全 | **insufficient**（单独） | fail-closed | CC 与 PS 新格式表头完全相同（12+1 真实样本），无任何确定性结构信号 → unknown(ambiguous_ps_without_search_rank)。 |
| 8 | 无行数据 / 无 BSR 值 | **insufficient** | fail-closed | requires_row_signal（表头无法证明类型）。 |
| 9 | 缺必需身份列 / 歧义列 / 无签名 | **deterministic（负面）** | fail-closed | missing_required_identity / ambiguous_headers / missing_report_signature，结构非法永远拒绝。 |

## 分类优先级（实现）

```
deterministic unique structure（信号 1/2，或负面 9）
  → validated multi-signal（当前无任何信号组合达到 validated 级：样本不足 + 已知反例
     [热销搜索词 PS 可全中榜单特征；Top100 CC 可 BSR>10]，见下）
  → ambiguous/unknown（信号 7/8）→ 人工选择（UI 展示信号 3–6 的辅助建议，建议仅供参考）
```

## 为什么 multi-signal 不能升级为 validated

- **CC 反例（用户提出）**：Top100/Top400/加载更多导出 → BSR 可 >10（信号 3 失效）；但信号 4/5/6
  仍命中 → 多信号组合会建议 CC（正确）。若把「BSR>10 → PS」当判定，则误判（已修复）。
- **PS 反例**：搜索词命中热销 Top10 时，信号 3/4/5/6 全中 → 多信号会建议 CC（误建议）。
  这是真实存在但概率低的场景；因「建议」可被用户推翻且不作自动判定，风险可控；
  若作自动判定则违反 fail-closed。
- 结论：**没有任何信号或信号组合达到「官方合同/可证明」级别**；自动判定只保留
  deterministic 信号（1/2/9），其余全部 fail-closed + 辅助建议。

## 对抗样本（Golden Replay 新增）

- `cc-bsr-beyond-band`：脱敏 CC Top100（单类目、BSR 11..100 >10、月销高、Best Seller 多）
  → 自动判定 unknown（**不因 BSR>10 判 PS**）；显式 category_current 放行（matched=true）。
- `ps-no-search-rank` / `cc-current` / `cc-with-ties`：无搜索排名一律 unknown（人工兜底）。

## 真实样本验证（材料根只读）

| 文件 | 自动判定 | 辅助建议 |
|---|---|---|
| Products(10)-US-20260814.xlsx（PS） | unknown（fail-closed） | suggestion=search_results（0 榜单信号） |
| BSR(厨房和餐厅（当前的）)（CC） | unknown（fail-closed） | suggestion=category_current（3 信号） |
| BSR(Beauty-&-Personal-Care(Current))（CC） | unknown（fail-closed） | suggestion=category_current（4 信号） |
| BSR(Electronics(Current))（CC） | unknown（fail-closed） | suggestion=category_current（4 信号） |

## UI 表达（detected / ambiguous / manually_confirmed 三态）

- detected（信号 1/2）：自动填入 + 「已自动识别报表类型：…」（无需操作）
- ambiguous（信号 7/8）：**不预选**，「无法可靠识别报表类型，请手动选择」+ 多信号建议
  （「检测建议：更像…（信号理由）」+「建议仅供参考，请以报表实际内容为准」）
- manually_confirmed：用户选择后提交（显式选择结构合法即放行，不产生 report_type_mismatch）
