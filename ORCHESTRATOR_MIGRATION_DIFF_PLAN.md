# 研究采集编排器（Orchestrator）迁移方案与差异设计

本文档制定将 `ecommerce-clean-main` 的统一采集状态（`unifiedCollectionStatus`）与事件审计（`agentEventLogger`）能力平滑合入 `fix-sourcing` 主线 `lib/server/researchCollectionOrchestrator.ts` 的详细实施方案。

> **本阶段原则**：仅产出方案与精准 Diff 规划，**严禁直接修改代码**。

---

## 一、保留与吸收边界矩阵

| 模块 / 逻辑 | 处置策略 | 详细说明 |
| :--- | :---: | :--- |
| **`accessPassword` 与 `AccessContext`** | **严格保留** | 保留 `import type { AccessContext } from "@/lib/server/accessPassword"` 及所有鉴权上下文校验。 |
| **`demoAcquisitionSamples`** | **严格保留** | 保留 `DEMO_ACQUISITION_EVIDENCE_ID`、`buildDemoBrowserCollectPreview`、`buildDemoReviewCollectPageResults`、`buildDemoReviewCollectPreviewItems`、`DEMO_SOURCING_EVIDENCE_SAMPLE`。 |
| **Demo 离线回放逻辑** | **严格保留** | 保留各数据源中 `if (context.mode === "demo")` 的安全沙箱与演示数据回放逻辑，保证访客免密演示不退化。 |
| **五阶段商品决策链路** | **严格保留** | 保持与候选池、任务骨架、Listing 生成、合规门禁的既有契约完全一致。 |
| **`agentEventLogger`** | **吸收合入** | 引入 `logInfo`、`logError`，在编排开始、完成、失败时记录结构化审计事件（fail-open）。 |
| **`unifiedStatuses`** | **吸收合入** | 在 `ResearchOrchestratorResult` 中增加 `unifiedStatuses?: UnifiedStatusesMap` 字段，提供四大模块统一状态抽象。 |
| **`logUnifiedStatusEvents`** | **吸收合入** | 在只读探测（inspect）与正式采集（orchestrate）完成后，统一调用派生与异步入库（fail-open）。 |

---

## 二、拟定代码改动清单（精准 Diff 预览）

### 1. 导入区（Imports）变动
```diff
--- lib/server/researchCollectionOrchestrator.ts (fix-sourcing 现状)
+++ lib/server/researchCollectionOrchestrator.ts (规划吸收后)
@@ -23,6 +23,17 @@
 import type { AccessContext } from "@/lib/server/accessPassword";
 import { isSandboxTaskId, getSandboxTask } from "@/lib/server/demoSandbox";
 import { prisma } from "@/lib/server/db";
+import { logInfo, logError } from "@/lib/server/agentEventLogger";
+import {
+  deriveAllUnifiedStatuses,
+  logUnifiedStatusEvents,
+  type UnifiedStatusesMap,
+} from "@/lib/server/unifiedCollectionStatus";
+
+export type {
+  UnifiedStatusesMap,
+  UnifiedCollectionStatus,
+} from "@/lib/server/unifiedCollectionStatus";
 
 // 来源 1：Amazon Browser Evidence
```

### 2. 返回结果类型 `ResearchOrchestratorResult` 变动
```diff
 export type ResearchOrchestratorResult = {
   taskId: string;
   action: OrchestratorAction;
   overallStatus: SourceStatus | "mixed";
   sources: ResearchOrchestratorSources;
+  /** 四大上游模块（Amazon、VOC、1688、AI Listing）的统一标准化状态矩阵 */
+  unifiedStatuses?: UnifiedStatusesMap;
   /** 本轮真正被采集的来源；未列出即表示本轮只做了只读探测。 */
   attemptedSources: OrchestratorSourceKey[];
   updatedAt: string;
 };
```

### 3. 并发锁与执行中初态处理
```diff
   // 1. 并发保护（同步先查先锁，杜绝 await 间隙并发穿透）
   if (action === "orchestrate") {
     if (isOrchestrationRunning(taskId)) {
       return {
         taskId,
         action,
         overallStatus: "running",
         sources: {
           amazon: { status: "running", message: "采集正在执行中" },
           keywordCompetitor: { status: "running", message: "采集正在执行中" },
           voc: { status: "running", message: "采集正在执行中" },
           sourcing1688: { status: "running", message: "采集正在执行中" },
         },
+        unifiedStatuses: {
+          amazon: { module: "amazon", status: "running", succeeded: false, summary: "采集正在执行中" },
+          voc: { module: "voc", status: "running", summary: "采集正在执行中" },
+          "1688": { module: "1688", status: "running", summary: "采集正在执行中" },
+          ai: { module: "ai", status: "idle", generated: false, passedGate: false, savedStatus: "not_saved", summary: "待上游采集完成" },
+        },
         attemptedSources: [],
         updatedAt: new Date().toISOString(),
       };
     }
     RUNNING_ORCHESTRATIONS.set(taskId, Date.now());
+    logInfo("agent", "orchestration_started", `开始执行研究采集编排 (任务: ${taskId})`, {
+      taskId,
+      metadata: { attemptedSources, action },
+    }).catch(() => undefined);
   }
```

### 4. 采集耗时统计与统一状态派生（核心吸收点）
```diff
   try {
     // 2. 读取任务快照，校验任务存在性
     const task = await getTaskSnapshot(options.context, taskId);
 
+    const durations: Partial<Record<"amazon" | "voc" | "1688" | "ai", number>> = {};
+    const runTimed = async <T>(key: "amazon" | "voc" | "1688", fn: () => Promise<T>): Promise<T> => {
+      const start = Date.now();
+      try {
+        return await fn();
+      } finally {
+        durations[key] = Date.now() - start;
+      }
+    };
+
     // 3. 并行执行 4 大来源的状态检测（+ 被本轮授权的采集）；各源内部自包含 failure isolation
     const [rawAmazon, rawKeywordCompetitor, rawVoc, rawSourcing1688] = await Promise.all([
-      handleAmazonSource(options.context, taskId, modeFor("amazon")),
+      runTimed("amazon", () => handleAmazonSource(options.context, taskId, modeFor("amazon"))),
       handleKeywordCompetitorSource(options.context, taskId, task.resultJson, modeFor("keywordCompetitor")),
-      handleVocSource(options.context, taskId, modeFor("voc")),
-      handleSourcingSource(options.context, taskId, task.resultJson, modeFor("sourcing1688")),
+      runTimed("voc", () => handleVocSource(options.context, taskId, modeFor("voc"))),
+      runTimed("1688", () => handleSourcingSource(options.context, taskId, task.resultJson, modeFor("sourcing1688"))),
     ]);
 
     const probeSources: ResearchOrchestratorSources = {
       amazon: rawAmazon,
       keywordCompetitor: rawKeywordCompetitor,
       voc: rawVoc,
       sourcing1688: rawSourcing1688,
     };
 
     const cached = RECENT_ORCHESTRATION_CACHE.get(taskId);
     const cacheAlive = cached !== undefined && Date.now() - cached.timestamp <= ORCHESTRATION_CACHE_TTL_MS;
     const cachedSources = cacheAlive ? cached!.sources : undefined;
 
     const sources: ResearchOrchestratorSources = {
       amazon: preserveStickyConclusion(probeSources.amazon, cachedSources?.amazon) ?? probeSources.amazon,
       keywordCompetitor: preserveStickyConclusion(probeSources.keywordCompetitor, cachedSources?.keywordCompetitor) ?? probeSources.keywordCompetitor,
       voc: preserveStickyConclusion(probeSources.voc, cachedSources?.voc) ?? probeSources.voc,
       sourcing1688: preserveStickyConclusion(probeSources.sourcing1688, cachedSources?.sourcing1688) ?? probeSources.sourcing1688,
     };
 
+    const taskResult = parseJsonSafe(task.resultJson);
+    const unifiedStatuses = deriveAllUnifiedStatuses({
+      sources,
+      taskResult,
+      durations,
+    });
+
+    // 无论只读探测还是执行采集，记录统一状态日志（fail-open）
+    void logUnifiedStatusEvents({
+      taskId,
+      statuses: unifiedStatuses,
+      contextAction: action,
+    });
```

### 5. 编排完成与异常处理日志
```diff
     // 账本只记录真实发生过的采集（orchestrate），只读 inspect 绝不写入。
     if (action === "orchestrate") {
       const nextSources: ResearchOrchestratorSources = cachedSources
         ? {
             amazon: attemptedSources.includes("amazon") ? sources.amazon : (cachedSources.amazon ?? sources.amazon),
             keywordCompetitor: attemptedSources.includes("keywordCompetitor") ? sources.keywordCompetitor : (cachedSources.keywordCompetitor ?? sources.keywordCompetitor),
             voc: attemptedSources.includes("voc") ? sources.voc : (cachedSources.voc ?? sources.voc),
             sourcing1688: attemptedSources.includes("sourcing1688") ? sources.sourcing1688 : (cachedSources.sourcing1688 ?? sources.sourcing1688),
           }
         : sources;
       RECENT_ORCHESTRATION_CACHE.set(taskId, { sources: nextSources, timestamp: Date.now() });
+
+      const overall = computeOverallStatus(sources);
+      logInfo("agent", "orchestration_completed", `研究采集编排完成，状态: ${overall}`, {
+        taskId,
+        metadata: {
+          overallStatus: overall,
+          sources: {
+            amazon: sources.amazon.status,
+            keywordCompetitor: sources.keywordCompetitor.status,
+            voc: sources.voc.status,
+            sourcing1688: sources.sourcing1688.status,
+          },
+          unifiedStatuses,
+        },
+      }).catch(() => undefined);
     }
 
     return {
       taskId,
       action,
       overallStatus: computeOverallStatus(sources),
       sources,
+      unifiedStatuses,
       attemptedSources,
       updatedAt: new Date().toISOString(),
     };
+  } catch (error) {
+    if (action === "orchestrate") {
+      logError("agent", "orchestration_failed", `研究采集编排失败: ${error instanceof Error ? error.message : String(error)}`, {
+        taskId,
+        metadata: { error: String(error) },
+      }).catch(() => undefined);
+    }
+    throw error;
   } finally {
```

---

## 三、实施前置依赖与验收路径

1. **前置依赖完成度**：
   - [x] `lib/server/agentEventLogger.ts` 与单元测试已迁移就绪。
   - [x] `prisma/schema.prisma` 已补充 `AgentEvent` 实体映射。
   - [x] `lib/server/unifiedCollectionStatus.ts` 与单元测试已迁移就绪。
   - [x] `npm run typecheck` 0 报错。
2. **本阶段后续执行步骤（需单独授权）**：
   - 步骤 1：按照上述 Diff 实施 `lib/server/researchCollectionOrchestrator.ts` 修改。
   - 步骤 2：运行既有 `researchCollectionOrchestrator.test.ts`，验证所有 27+ 既有用例无回归。
   - 步骤 3：补充关于 `unifiedStatuses` 与 `logUnifiedStatusEvents` 被正确调用的断言测试。
