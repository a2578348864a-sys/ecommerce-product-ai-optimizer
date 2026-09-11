# V5.2 Session Status — 链路已收口，Holdout 冻结进行中

> 本文件是执行交接记录。Phase 1–3 已完成并验证；Phase 4 部分完成；Phase 5–9 未执行。
> 结论一律以证据为准，未验证项明确标注为未验证。

## 1. 已完成（有证据）

### Phase 1–3：V5.2 Conversion Rewrite 链路接入 Route

最终链路（Validator / 事实权威 / repair 语义均未改动）：

```
writer → validate
  → (REPAIRABLE → Repair ≤1) → validate
  → (not PASS → Conversion Rewrite ≤1) → validate
  → (REPAIRABLE → Repair ≤1，仅当本次生成尚未用过) → validate
  → (not PASS → Safe Recovery ≤1，降级为最后手段) → validate
  → deterministic fallback
```

关键改动：
- `lib/listingV5/conversionRewrite.ts`（新增）：整篇重写。输入白名单 = 已确认事实 + 脱敏 blueprint + 脱敏 strategy + 被拒 listing + **issue 类别码/计数**；
  Validator 的原文、reason、offending spans、竞品原文、sourcing 一律不进 Prompt；输出走共享 writer normalizer；
  `backendSearchTerms` 过 `HARD_OR_ESCALATION_TOKENS` 过滤；所有失败路径 fail-closed。
- `app/api/tasks/[id]/listing-v5/route.ts`：有界预算（repair 全局 ≤1、rewrite ≤1、recovery ≤1）；
  预占 provider 调用数 `1 / 4 / 5`；`fallbackReason === "writer_stage_failed"` 时不做 rewrite（确定性路径保持确定性）。
- `lib/listingV5/trace.ts`：新增 `rewriteAttempted / rewriteReason / rewriteValidationStatus / stages.rewrite`，
  并**把 recovery 阶段真正传进 trace**（V5.1 的盲区：route 从未把 recovery 变量交给 `buildListingV5ExecutionTrace`）。
- `safeSnapshot`：provider 块改为逐字段白名单，不再整体透传。
- 新增测试：route 链路 4 例（BLOCK→Rewrite→PASS、Rewrite→REPAIRABLE→Repair→PASS、Rewrite+Recovery 双失败→fallback、writer 阶段失败不重写）、
  trace 遥测 2 例（rewrite 交付、recovery 交付）、spike 契约补充白名单断言（Validator 原文/span 不得进 Prompt）。

验证证据：

| 检查 | 结果 |
| --- | --- |
| `tsc --noEmit` | 0 error |
| `vitest run lib/listingV5 app/api/tasks/[id]/listing-v5` | **165 passed / 23 files** |
| `eslint .` | 0 error，7 warning（均为既有） |
| `npm run build` | PASS（`BUILD_ID=6E4Bv3R9S8SMrN7az4yh6`） |
| 3005 部署 | 计划任务重启后 `/api/health` 200、`/listing-studio` 200 |
| Git | `a655654`（链路）+ `fa3b063`（trace 测试），已 push，`HEAD == origin/feat/listing-v5-rebuild` |

## 2. Phase 4 进度：3 个全新 Holdout 已建，冻结尚未完成

来源：`BSR(雪球（当前的）)-10-US-20260911.xlsx`（13:45 新导出，`Home & Kitchen:Seasonal Décor:Snow Globes`）。
导入批次 `c2d05060-ecce-4b9e-a111-419a6917a51e`（10 items），17 个 ASIN 全部 `repo hits=0`（见 `V52_HOLDOUT_FRESH_SCAN.md`）。

| 案 | ASIN | taskId | candidateId | 首轮 fp | facts | kw | comp | voc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V52-H1 | B097ZBVGWG（Melunar 秋季雪球灯笼） | `cmtwk0j3b00059px29ivsvjyo` | `31d6b177-2b5f-4d73-9033-0854959f55ba` | `3c8fe313b8f6` | 8 | 10 | 5 | 首轮 0 → 已补 8 条评论 |
| V52-H2 | B0CFRH13NT（BOLTCORRSE 音乐雪球） | `cmtwk2b5i00089px2cove9eq0` | `b20c266d-0750-4907-87b1-9bcc312be38d` | `437e380ac694` | 2 | 10 | 5 | 首轮 0 → 已补 |
| V52-H3 | B0D875S7Z2 | `cmtwk36m2000b9px2t5x65acf` | `7579a1f6-e197-4bb1-bc57-61173e0e6c44` | `076ddc42c618` | 7 | 10 | 5 | 首轮 0 → 已补 |

证据目录：`D:\Workspace\holdout-evidence\benchmark-v52\`（`*-pre.json`、`v52-frozen-pool.json`）。
执行脚本：`%TEMP%\holdout\v52-runtime.ps1`、`v52-freeze.ps1`、`v52-voc.ps1`、`v52-refreeze.ps1`。

### 未完成与确切原因

1. **VOC 首轮全部 502 `ai_provider_error`**：3016 启动时进程环境里没有 provider 密钥。
   本工作树**没有 `.env.local`**（只有 `.env.example`），密钥此前由启动 shell 注入。
   已用集成树的 `.env.local` 载入环境后重启 3016 → VOC 分析成功（`model=deepseek-flash`，`gateResult=pass`），
   即 **provider 链路本身正常**，此前失败纯属环境注入缺失。
2. **加入 VOC 后研究资料失效**：`research_stale_requires_reconfirmation`（fail-closed 设计正确）。
   需要按新研究修订重新确认：`research-decision` → `complete` → `creative-handoff create`。
   直接重建 handoff 会得到 `invalid_storage_version`（决策仍绑定旧修订），**必须先重做 decision/complete**。
3. **V52-H2 页面证据失败** `asin_mismatch`（URL ASIN / 实体绑定不一致），facts 仅 2 条。
   该案偏薄，建议重采一次页面证据；若仍失败则用批次内其他 item 替补（批次还有 7 个未用 item）。

## 3. 下一轮执行顺序（精确到调用）

```powershell
# 0. 启动隔离实例（必须带 QX_RUNTIME_MODE=local_owner 且注入 provider 环境）
& "$env:TEMP\holdout\v52-runtime.ps1"     # 该脚本从集成树 .env.local 载入键值后启动 3016
# 1. 重做决策与交接，让 VOC 进入冻结上下文
PATCH /api/tasks/{task}/research-decision   # expectedRevision = 当前研究修订
POST  /api/tasks/{task}/complete
GET   /api/tasks/{task}/creative-handoff?mode=preview
POST  /api/tasks/{task}/creative-handoff    # action=create，用 preview 返回的 expected* 值
# 2. 复核冻结字段（fingerprint 会因 VOC 变化，必须重记）
GET   /api/tasks/{task}/listing-v5          # 记 fingerprint / facts / voc / kw / comp
# 3. 逐案生成（≤9 次 provider 调用预算，逐案记录 writer/rewrite/repair/recovery 与来源）
POST  /api/tasks/{task}/listing-v5 { action="generate", confirmRealAi=true }
```

- 生成前先冻结 `codeSha`（`git rev-parse HEAD`）；**冻结后不得再改代码/提示词**，否则该轮证据作废。
- 3 案预算是 `strategy+writer+rewrite`（典型路径）≈9 次；若触发 repair/recovery 会超支，需事前备案、不得改 rubric 凑指标。
- V52-H2 的 facts=2 会让 Conversion Score 结构性偏低，替换或补采需在生成前决定并记录。

## 4. 环境事实（本轮实测，供复用）

- 3016 启动参数：`QX_RUNTIME_MODE=local_owner`（无此值 → 所有写操作 401 `invalid_access`）、
  `OPENAI_LISTING_ENABLED=true`、`LOCAL_ACQUISITION_ENABLED=true`、`LISTING_V5_TRACE=1`。
- `scripts/local-next-runtime.mjs start` 是**前台阻塞**进程 → 必须用后台作业托管；`stop --port 3016` 可验证归属后停止。
- 3005 由计划任务 `QingXuanAgent-Local-3005-V5` 管理；`npm run build` 会替换 `.next`，须重启任务并复验页面。
