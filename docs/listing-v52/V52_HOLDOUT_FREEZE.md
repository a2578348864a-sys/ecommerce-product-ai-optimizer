# V5.2 Final Holdout Freeze（Phase 4 输出）

**HOLDOUT_FREEZE_READY = true**

- 冻结时间：2026-09-11
- 冻结代码：`codeSha = 65c3de34d694743208b52e17f3ab640d351a4596`（分支 `feat/listing-v5-rebuild`；V5.2 Conversion Rewrite 链路在这一版，见 `docs/listing-v52/V52_SESSION_STATUS.md`）
- 冻结主体：**3 个全新真实商品案**（10 个候选池中按既定优先级选出，规则见第 3 节）
- 生成状态：**未生成任何 Listing**；`listing-v5` 只做了 `GET`（读冻结上下文），**未调用 `action=generate`**
- 原始证据：`D:\Workspace\holdout-evidence\benchmark-v52\`（`v52-candidates-summary*.json`、`v52-freshness.json`、`v52-export-rows.json`、`V52-C*-frozen-context.json`）

## 1. 冻结的最终 3 案

| # | tag | ASIN | brand | taskId | contextFingerprint |
| --- | --- | --- | --- | --- | --- |
| 1 | V52-C4 | B0F831L31B | Piteno | `cmtwkgfjk000eonodmcagugei` | `39c352a2f4a877ed4a52e592fc13df9083cbed079bee6a3bcbc82e5cfdaa1eda` |
| 2 | V52-C7 | B07CZBNV27 | Luditek | `cmtwkkjem000nonod6g8at3zz` | `1dd4484a83ffedaafd7919036dfe03e96414b0f5f3ef821523304fff1c16c354` |
| 3 | V52-C1 | B0F7K4N6Z3 | Lineshading | `cmtwkd1oo0005onodo37h5fuk` | `fefa0b882b9eca0250e5b81eb2846595b5f2721dd93450351158ad11ba7b2dad` |

### 冻结字段明细

| 字段 | V52-C4 | V52-C7 | V52-C1 |
| --- | --- | --- | --- |
| ASIN | B0F831L31B | B07CZBNV27 | B0F7K4N6Z3 |
| brand | Piteno | Luditek | Lineshading |
| title | Piteno® 140Pcs Bats Halloween Decorations Party Supplies, Realistic PVC 3D Black Scary Bat Stickers for Creepy Home Decor Halloween Party Decorations DIY Wall Window Decal Bathroom Indoor | 2-Pack Lighted Fall Garland, Total 16.4ft 40 LED Autumn String Lights | Lineshading 4 Pcs Halloween Coffee Table Decor Wooden Ghost Coffee Bar Sign |
| 类目路径 | Home & Kitchen:Seasonal Décor | Home & Kitchen:Seasonal Décor:Wreaths, Garlands & Swags:Garlands | Home & Kitchen:Seasonal Décor:Nativity:Tabletop Scenes |
| candidateId | `115e4928-0396-4985-8da5-55255b5a6372` | `f153d921-2355-4031-a0f9-6ac63c0a05eb` | `e54bd8e6-27ff-4d2a-bf81-4f40ed7195ee` |
| **contextFingerprint** | `39c352a2f4a877ed4a52e592fc13df9083cbed079bee6a3bcbc82e5cfdaa1eda` | `1dd4484a83ffedaafd7919036dfe03e96414b0f5f3ef821523304fff1c16c354` | `fefa0b882b9eca0250e5b81eb2846595b5f2721dd93450351158ad11ba7b2dad` |
| **confirmedFactCount** | **8** | **7** | **7** |
| **vocCount** | **8** | **8** | **9** |
| **keywordCount** | **10** | **10** | **10** |
| **competitorCount** | **5** | **5** | **5** |
| sourcingCount | 0 | 0 | 0 |
| researchRevision | 1 | 1 | 1 |
| handoffRevision | 1 | 1 | 1 |
| realAiEnabled | true | true | true |
| 页面证据 | ok | ok | ok |
| 研究链 | 完整 | 完整 | 完整 |
| freshness | repo=0 / hist=0 / brand=0 | repo=0 / hist=0 / brand=0 | repo=0 / hist=0 / brand=0 |

## 2. 候选池与筛选依据（Phase 3 输出）

- 扫描：2 个 SellerSprite 导出共 **20 个 ASIN**，全部完成 freshness gate（`HOLDOUT_CANDIDATE_REPORT.md`）
- 研究：**10 个**候选走完研究链（3 个上轮已建 + 7 个本轮新建），全部字段实测、失败案保留
- **合格（facts≥6 且 voc>0 且 kw>0 且 comp>0）共 5 个**：C4、C7、C1、H1、H3
- 淘汰 3 个：H2（`asin_mismatch` + facts=2）、C3（`asin_mismatch` + facts=4）、C2（`no_reliable_search_keyword`，kw=0/comp=0）
- 未达标 2 个：C5（facts=5、VOC=0）、C6（facts=8、VOC=0，该 ASIN 无评论可采）

## 3. 最终 3 案的选取规则（事前固定，按序执行）

1. 必须满足 **facts≥6、voc>0、kw>0、comp>0** 且研究链完整 → 5 个候选通过；
2. **freshness 记录为零命中者优先** → C4/C7/C1（repo=0、hist=0、品牌=0）优于 H1/H3（有候选文档与上轮建案记录）；
3. **商品类型不重复** → H1 与 H3 同为 "Fall Snow Globe Lantern"，C4/C7/C1 分属蝙蝠装饰贴、秋季节日灯串、木质桌面摆件；
4. 事实量高者优先 → C4（8）> C7（7）= C1（7）。

结论：冻结 **C4、C7、C1**。
**预备队（合格但未入选）**：H1（`B097ZBVGWG`，facts 8 / voc 10 / kw 10 / comp 5，fp `2145be1e35ede675144c3f7e777dfd7f70d78326a9ba7e1d348737ec9c973ee9`，task `cmtwk0j3b00059px29ivsvjyo`）、
H3（`B0D875S7Z2`，facts 7 / voc 12 / kw 10 / comp 5，fp `049a1efe329d33a325e03a0063d5a1f50da74d7a9f076509c5b82157b8a74868`，task `cmtwk36m2000b9px2t5x65acf`）。
两案研究链同样完整，可在一案失效时按同一规则顶替。

## 4. 冻结后的不可变更约束

自本文件写入起，以下内容**冻结**（任一变更将使本轮 3 案证据作废，需换指纹整体重跑）：

- Validator 规则与阈值；
- Writer Prompt 与 `LISTING_V5_*_PROMPT_VERSION`；
- Conversion Score 规则（`conversionScore.ts`、`CONVERSION_BENCHMARK_PASS_AVERAGE`）；
- Benchmark 规则与历史案例（H1–H5、A/B/C/D、benchmark-v2 / benchmark-v51 证据）；
- 本文件第 1 节全部冻结字段。

`codeSha` 之后的提交**仅允许文档**。核验命令：
`git diff --stat 65c3de34d694743208b52e17f3ab640d351a4596 HEAD -- lib app components prisma scripts tools`
—— 必须为空输出。

## 5. 本阶段 provider 消耗（如实披露）

- **Listing 生成调用：0 次**（未执行 `action=generate`，writer/rewrite/repair/recovery 全部 0 次，9 次预算未动）
- 证据链 AI 调用：**7 次**，全部为 `POST /api/tasks/{id}/review-evidence { action: "analyze" }`（VOC 分析，`model=deepseek-flash`），对应 C1–C7
- 其余证据步骤为浏览器/HTTP 采集，不产生 AI 调用：`browser-evidence collect`（Amazon 页面）、`competitor-evidence collect_browser_use`（SellerSprite 关键词+竞品）、`review-evidence collect/collect-confirm`（评论）、`fact-candidates`（确定性事实抽取）
- 复核方式：3016 实例以 `LISTING_V5_TRACE=1` 运行；生成链 trace 一旦运行即可逐阶段核对调用数

## 6. 已知限制（不隐藏）

1. 本轮 3 案全部来自 `seasonal` 导出；`snowglobe` 组的 7 个未建案 ASIN 虽实质未被使用，但因候选文档命中记录未入选（预备队 H1/H3 来自该组）。
2. H2 因 `asin_mismatch` + 事实不足被淘汰，**未**进入任何最终统计。
3. C5/C6 因商品无评论导致 VOC=0，仅作池内记录。
4. `sourcingCount` 三案均为 0（本轮未做 1688/sourcing 采集；按既定架构，sourcing 本就不得进入 Listing 生成上下文）。
5. 冻结字段中的 fingerprint 与上一轮会话记录**不同**（H1 由 `3c8fe313b8f6…` 变为 `2145be1e35ed…`），原因是 VOC 在 handoff 之后补采，触发 fail-closed 的研究失效；已按 `decision → complete → handoff` 重建，当前 fingerprint 为重建后的有效值。
6. 预期测量风险（未变，未做任何规避性修改）：`competitorGaps` 为空时 Differentiation 维度最高 18/20，`Conversion Score ≥85` 存在结构性触顶风险；`scoreListingV5Conversion` 仍未接入 route，测量需离线 harness。

## 7. 下一阶段（未执行，等待授权）

```powershell
# 0. 启动隔离实例（务必带 QX_RUNTIME_MODE=local_owner，并注入 provider 环境）
& "$env:TEMP\holdout\v52-runtime.ps1"
# 1. 逐案生成（预算 ≤9 次；冻结后不得改代码）
POST /api/tasks/{taskId}/listing-v5  { "action": "generate", "confirmRealAi": true }
#    taskId: C4=cmtwkgfjk000eonodmcagugei  C7=cmtwkkjem000nonod6g8at3zz  C1=cmtwkd1oo0005onodo37h5fuk
```

逐案需记录：`provider calls（stages.*.attempted 与 provider.*Attempted 双记）`、首验状态与 block 原因、repair（attempted/success/appliedPaths）、
rewrite（attempted/复验状态）、recovery（是否降级触发）、`fallbackUsed/fallbackReason`、交付来源四态、Conversion Score。
