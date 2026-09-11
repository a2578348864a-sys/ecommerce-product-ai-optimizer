# Listing V5.1 — 接续执行手册（Session Handoff）

> 用途：本会话执行预算耗尽，V5.1 未完成（`PROJECT_COMPLETE = NO`）。本文件记录**已冻结的输入、实测基线、剩余预算与逐步命令**，下一轮无需任何推导即可继续。
> 基线：`b835f12`（== origin）· worktree CLEAN · 3005 `BUILD_ID=21-47DE6bnSsTSt4peu66` · 3016 stopped。

## 1. 已完成（勿重做）

| 阶段 | 状态 | 交付物 |
|---|---|---|
| Phase 0/1 | ✅ | 基线冻结 + 四路只读审计（转化/架构/安全/Prompt），结论已并入 `FINAL_RELEASE_REPORT_V51.md` 与本文件 §3 |
| Phase 2 | ✅ | Conversion Blueprint 2.0：`purchaseTriggers` / `objectionHandling` / `benefitPriority` / `decisionSequence`（全绑定 confirmedFacts） |
| Phase 6 | ✅ | `safetyGates.test.ts`（Validator 唯一门 + sourcing 隔离）、`writerInputIsolation.test.ts`（竞品原文不进提示）、蓝图 factIds 断言 |
| Phase 7 | ✅ | Studio 只读 Conversion Strategy 面板 + 快照逐字段投影 |
| Phase 8 | ✅ | 真实 CDP 验收：面板存在、刷新保持、移动端 390×840 溢出 0、console error 0、标签页已清理 |
| Phase 9/11/12 | ✅ | tsc 0 / lint 0 error / build PASS / 152 用例通过；逐文件 stage + push（LOCAL==REMOTE）；3005 已部署 |
| Phase 10 | ✅（README + 报告已更新） | `README.md` V5.1 章节、`FINAL_RELEASE_REPORT_V51.md` |

## 2. 未完成（下一步就是它）

- **Phase 3 重做 + Phase 5 复测**：QUALITY 目前 **FAIL**。
- **Phase 4**：Safe Recovery 降级实现（最后手段、最多一次、必然再校验）。

## 3. 实测基线与失败根因（已证）

冻结 5 案池（真实商品、非 fixture、非 A/B/C/D）：

| 例 | 类型 | taskId | 冻结指纹（v4 时） |
|---|---|---|---|
| V51-H1 | 普通消费品 | `cmtw3hisl0005omor5h13yem9` | `fa544a7a0be30c13…` |
| V51-H2 | 高规格 | `cmtw3lcrs000aomorohy1yr0d` | `39b686767f61b709…` |
| V51-H3 | 强竞争 | `cmtw3muis000comora77t4mbe` | `48c7e2beecc4f2b2…` |
| V51-H4 | 功能型 | `cmtw3dopo0001omor1aiazo0l` | `2be9b1871cd38dba…` |
| V51-H5 | 易违规 | `cmtw3epie0003omorr5pdu23c` | `015075f766fc4a43…` |

- **v4（当前基线，已验证）**：同批上下文 2/3 AI 直交，平均 Conversion Score **81.3**（阈值 75）。
- **v5（决策序列 + 封闭词表）**：**AI 直交 0/5、fallback 5/5**，unsupported claims 由 1 条升到 **3/6/8** 条（3 例越过 `MAX_REPAIRABLE_CLAIMS=4` → 不可修 BLOCK）。证据：`D:\Workspace\holdout-evidence\benchmark-v51\`（5 份 generate JSON + `frozen-pool.json`）。
- **根因**：v5 的"决策顺序 + 封闭劝说词表 + 只为 factBacked 顾虑作答"措辞把模型推向**主张式表达**（审计 C 预警的 confidently / peace of mind / removes 一类词正是新提示引入的）。

## 4. Provider 预算

**已用 12/15，剩 3 次**。预算口径：Listing 链路的 strategy / writer / repair 调用（VOC 采集属研究阶段，单独计）。

## 5. 下一轮执行步骤（按序，勿跳步）

1. **单变量实验（Phase 3 重做）**
   - 在 `lib/listingV5/generation.ts` 的 `WRITER_SYSTEM_PROMPT` 中**只新增一行**封闭连接词规则（`so / helps / makes / easier / keeps / lets / avoids / without`），**其余措辞保持 v4 不变**；`LISTING_V5_WRITER_PROMPT_VERSION` 保持 `v4`（避免改指纹）。
   - 启一个 provider 实例：`node scripts/local-next-runtime.mjs start --port 3016`，env 同 `C:\Users\a2578\AppData\Local\Temp\holdout\v51-run.ps1`（`OPENAI_LISTING_ENABLED=true`）。
   - 只跑 **H1 + H3**（`action:"generate"`，`confirmRealAi:true`），接受 2–3 次调用。
2. **判定规则（事先定死，不许事后修改）**
   - 保留条件：两案都不出现 fallback，且至少一案 `first validation = PASS`；
   - 否则：**立即 `git restore lib/listingV5/generation.ts`**，并在报告中记录"连接词规则未通过对照"。
3. **复测与判定（Phase 5）**
   - 若第 2 步保留：用同一池做最终复测（受剩余预算限制，允许只覆盖有代表性的 3 案），如实给出 `AI_DIRECT_PASS / FALLBACK / AVERAGE_SCORE` 三项并对照 80%/20%/85。
   - 评分器与 benchmark 规则**禁止改动**；失败只写分析。
4. **Phase 4（Recovery 降级）**——仅在预算与步骤 1–3 完成后进行；实现要点已由审计固化：
   - 插入点：`route.ts` repair 复位校验之后、`validation.status !== "PASS"` 闸门之前；守卫 `useProvider && action !== "analyze_strategy"`；
   - `plannedCalls` 生成分支 3→4；`onProviderCallStart` 与 settlement 语义保持幂等；
   - trace 增 `recoveryAttempted/recoveryReason/recoveryValidationStatus` + `stages.recovery`（version 保持 v1，复用既有失败枚举）；
   - 快照 `provider.recoveryAttempted` + `safeSnapshot` 逐字段白名单；
   - 顺手修既有缺陷：CAS 冲突分支补 `ACTIVE_V5_JOBS.delete(jobKey)`；
   - Recovery 提示输入**必须剥离** `competitorSignal` 原文（`generation.ts` 的 `sanitizeBlueprintForPrompt` 已提供该处理，直接复用）。
5. **收口**：`tsc` / `lint` / `build` / `vitest lib/listingV5 app/api/tasks/[id]/listing-v5 components/listing-v5` / 真实浏览器复验 / 逐文件 stage / secret scan / commit+push / 重建重部署 3005（health + `/listing-studio` + BUILD_ID）。

## 6. 不要做的事

- 不要为了达标改评分器、benchmark 规则或 Validator；
- 不要把 Recovery 扩成主链路；
- 不要提交未验证的提示改动（上一轮已因此回滚一次）；
- 不要动 `main`、legacy、历史 benchmark 文档。
