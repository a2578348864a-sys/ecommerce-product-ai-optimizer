# V5.2 Holdout Candidate Report（Phase 2 输出）

- 扫描时间：2026-09-11
- 导出源：`D:\Workspace\holdout-xlsx\`
  - `BSR(雪球（当前的）)-10-US-20260911.xlsx`（616 KB，`Home & Kitchen:Seasonal Décor:Snow Globes`）→ 简称 **snowglobe**
  - `BSR(季节性装饰（当前的）)-10-US-20260911.xlsx`（396 KB，`Home & Kitchen:Seasonal Décor`，含 3 行 `Patio, Lawn & Garden`）→ 简称 **seasonal**
- 行级解析（表头 + 单元格共享字符串），每个导出提取 10 行 → **共 20 个 ASIN**
- 原始数据：`D:\Workspace\holdout-evidence\benchmark-v52\v52-export-rows.json`、`v52-freshness.json`

## 1. Freshness gate（20/20 全量扫描）

判定口径：**工作树命中**（`*.ts/*.tsx/*.md/*.json/*.prisma/*.py/*.ps1`，排除 `node_modules`、`.next`、`.git`，共 1927 个文件）
+ **全部历史 commit 命中**（`git log --all -S<ASIN>`）
+ **品牌污染**（同法对 brand 名做工作树与历史扫描）。

| ASIN | 源 | brand | title（截断） | 大类 | 评论 | repo | hist | brandRepo | brandHist | fresh | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B07WG18RLT | seasonal | Brightown | Brightown 12 Pack 7ft Battery Operated LED Fairy Lig… | Home & Kitchen | 50604 | 0 | 0 | 0 | 0 | **YES** | 未研究 |
| B0F831L31B | seasonal | Piteno | Piteno® 140Pcs Bats Halloween Decorations Party Supp… | Home & Kitchen | – | 0 | 0 | 0 | 0 | **YES** | 已研究 → V52-C4 |
| B07CZBNV27 | seasonal | Luditek | 2-Pack Lighted Fall Garland, Total 16.4ft 40 LED Aut… | Home & Kitchen | 4843 | 0 | 0 | 0 | 0 | **YES** | 已研究 → V52-C7 |
| B07HMRZSWT | seasonal | ZPISF | 1000 sqft Spider Webs Halloween Decorations with 30 … | Patio, Lawn & Garden | 5269 | 0 | 0 | 0 | 0 | **YES** | 未研究（非 Home & Kitchen） |
| B07H4HHNQK | seasonal | Sattiyrch | Sattiyrch 15" Wreath Hanger for Front Door, Over the… | Home & Kitchen | 30428 | 0 | 0 | 0 | 0 | **YES** | 未研究（批次条目列表未返回该 item） |
| B0D3T94XJN | seasonal | AYGXU | 2Packs Halloween Decorations Outdoor,Halloweens Part… | Patio, Lawn & Garden | – | 0 | 0 | 0 | 0 | **YES** | 已研究 → V52-C6 |
| B0F7K4N6Z3 | seasonal | Lineshading | Lineshading 4 Pcs Halloween Coffee Table Decor Woode… | Home & Kitchen | – | 0 | 0 | 0 | 0 | **YES** | 已研究 → V52-C1 |
| B0FJXYV6DM | seasonal | OUTXE | OUTXE Suction Cup Wreath Hanger, Upgraded Reef Hook… | Home & Kitchen | – | 0 | 0 | 0 | 0 | **YES** | 已研究 → V52-C2 |
| B09C5Q8S89 | seasonal | Cyantor | 5Pcs Halloween Creepy Cloth Black 30×72inch - Hallow… | Patio, Lawn & Garden | – | 0 | 0 | 0 | 0 | **YES** | 已研究 → V52-C5 |
| B0DCNWXM2F | seasonal | Fairdeer | 6 Pack Fairy Lights Battery Operated - 7ft 20 Led Tw… | Home & Kitchen | – | 0 | 0 | 0 | 0 | **YES** | 已研究 → V52-C3 |
| B097ZBVGWG | snowglobe | Melunar | Fall Snow Globe Lantern, Thanksgiving Lighted Lanter… | Home & Kitchen | 257 | 2 | 2 | 1 | 2 | NO | 已研究 → V52-H1（见下方口径说明） |
| B0CFRH13NT | snowglobe | BOLTCORRSE | Pooh Bear Musical Snow Globe, Honey Scene, Resin and… | Home & Kitchen | – | 2 | 2 | 1 | 2 | NO | 已研究 → V52-H2（已淘汰） |
| B0D875S7Z2 | snowglobe | VISFLAIR | Fall Snow Globe Lantern - Scarecrow and Turkey Light… | Home & Kitchen | – | 2 | 2 | 0 | 0 | NO | 已研究 → V52-H3 |
| B0H49JLJKZ | snowglobe | MXwcy | Fall Harvest Snow Globe Lantern, Lighted Autumn Pump… | Home & Kitchen | – | 1 | 1 | 0 | 0 | NO | 未研究 |
| B0H6W79QXS | snowglobe | Patelai | Patelai 3 Pcs Christmas Mercury Glass Decor for Tabl… | Home & Kitchen | – | 1 | 1 | 0 | 0 | NO | 未研究 |
| B0DZNYQZP9 | snowglobe | Priddop | Priddop Fall Snow Globe Train Gnome Turkey Pumpkin C… | Home & Kitchen | – | 1 | 1 | 0 | 0 | NO | 未研究 |
| B0FFB6SFKV | snowglobe | Qualdout | Fall Snow Globe Lantern - Thanksgiving Glittering Li… | Home & Kitchen | – | 1 | 1 | 0 | 0 | NO | 未研究 |
| B0H4G5G3NH | snowglobe | MXwcy | Halloween Snow Globe Lighted Witch Hat Decor Purple … | Home & Kitchen | – | 1 | 1 | 0 | 0 | NO | 未研究 |
| B0B8YPMZ5T | snowglobe | Kukuzon | Vintage Christmas Carriage Snow Globe with Santa Sce… | Home & Kitchen | – | 1 | 1 | 0 | 0 | NO | 未研究 |
| B0FGD3MNDH | snowglobe | ZQQLITE | Halloween Christmas Fall Snow Globes Thanksgiving Wa… | Home & Kitchen | – | 1 | 1 | 0 | 0 | NO | 未研究 |

**`fresh=YES` 10/20**：全部 10 个 seasonal ASIN 在工作树与历史中零命中（品牌亦零命中）。

### 口径说明（重要，避免误判）

snowglobe 的 10 个 ASIN `repo/hist` 命中 **不是** 因为被用于 benchmark/调参/夹具，而是因为上一轮会话把该导出的 ASIN 清单写进了
`docs/listing-v52/V52_HOLDOUT_FRESH_SCAN.md`（候选扫描记录），其中 3 个（H1/H2/H3）还建了研究案。
即：命中来源 = **候选文档 + 上一轮新建的研究案**，**从未** 出现在任何 benchmark 结果、writer 调试、validator 调试、fixture、synthetic 数据中。

因此本报告对 snowglobe 组单独给出结论：
- 已建案且从未测量（H1/H3）→ **可用但非 pristine**，作为预备队；
- 未建案的 7 个 → 实质未被使用，但同样带候选文档命中记录。

**最终冻结因此只选 `fresh=YES`（零命中）的 seasonal 组候选**，freshness 无任何争议。

## 2. 已研究候选的质量字段（10 个）

链路：`candidate → start-research → 页面证据 → 关键词+竞品证据 → VOC 采集/确认/分析 → 事实确认 → 研究决定 → complete → creative handoff → 读取 Listing V5 冻结上下文`。

| tag | ASIN | brand | factCount | vocCount | keywordCount | competitorCount | 研究链 | 是否合格 | reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V52-C4 | B0F831L31B | Piteno | **8** | **8** | **10** | **5** | 完整 | ✅ 合格 | **入选最终 3** |
| V52-C7 | B07CZBNV27 | Luditek | **7** | **8** | **10** | **5** | 完整 | ✅ 合格 | **入选最终 3** |
| V52-C1 | B0F7K4N6Z3 | Lineshading | **7** | **9** | **10** | **5** | 完整 | ✅ 合格 | **入选最终 3** |
| V52-H1 | B097ZBVGWG | Melunar | 8 | 10 | 10 | 5 | 完整 | ✅ 合格 | 预备队（fresh 记录非零） |
| V52-H3 | B0D875S7Z2 | VISFLAIR | 7 | 12 | 10 | 5 | 完整 | ✅ 合格 | 预备队（fresh 记录非零；与 H1 商品类型重复） |
| V52-C6 | B0D3T94XJN | AYGXU | 8 | 0 | 10 | 5 | 完整 | ⚠️ 未达标 | 该 ASIN 无评论可采集，VOC=0 |
| V52-C5 | B09C5Q8S89 | Cyantor | 5 | 0 | 10 | 5 | 完整 | ⚠️ 未达标 | VOC=0，且 facts=5 < 6 |
| V52-C3 | B0DCNWXM2F | Fairdeer | 4 | 11 | 10 | 5 | 完整但页面证据失败 | ❌ 淘汰 | 页面证据 `asin_mismatch`；facts=4 < 5 |
| V52-C2 | B0FJXYV6DM | OUTXE | 10 | 10 | **0** | **0** | 关键词/竞品缺失 | ❌ 淘汰 | `no_reliable_search_keyword`（SellerSprite 无非品牌查询词），kw=0 且 comp=0 |
| V52-H2 | B0CFRH13NT | BOLTCORRSE | 2 | 0 | 10 | 5 | 页面证据失败 | ❌ 淘汰 | 页面证据 `asin_mismatch`；facts=2 事实不足 |

淘汰/未达标均**保留原始记录**，未删除任何失败案。

## 3. 事实不足与身份异常的判定证据

- **identity / ASIN mismatch**：`HTTP 422 asin_mismatch`（页面证据与任务绑定商品不一致，URL ASIN、实体绑定、绑定证明三者校验失败）→ V52-C3、V52-H2。两案均未把失败证据写入上下文（fail-closed）。
- **facts < 5**：V52-H2（2）、V52-C3（4）。
- **facts 5**：V52-C5（5）—— 未触发硬淘汰线，但低于 `>=6` 的优先线。
- **关键词不可用**：V52-C2 —— `HTTP 409 no_reliable_search_keyword`（SellerSprite 关键词全为品牌词，系统明确拒绝从标题猜词）。
- **无评论**：V52-C5、V52-C6 —— VOC 采集返回 0 条，无法分析（非代码缺陷，是商品本身评论为空）。

## 4. 未研究但可用的备选（如需扩大池）

- seasonal 剩余：`B07WG18RLT`（Brightown）、`B07HMRZSWT`（ZPISF，Patio）、`B07H4HHNQK`（Sattiyrch）
- snowglobe 剩余 7 个：`B0H49JLJKZ`、`B0H6W79QXS`、`B0DZNYQZP9`、`B0FFB6SFKV`、`B0H4G5G3NH`、`B0B8YPMZ5T`、`B0FGD3MNDH`

以上均已完成 freshness 扫描（见第 1 节表），可直接进入研究链。
