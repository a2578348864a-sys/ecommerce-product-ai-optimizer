# Phase 2-A — 单品一键自动工作流 MVP

> 日期：2026-06-21 | 阶段：Phase 2-A | 执行人：Claude

---

## 1. 为什么进入 Phase 2-A

Phase 1E 产品闭环复核结论：功能零件齐全，但缺自动流水线。

当前项目已具备 Sourcing、Risk、Summary、Listing、Tasks、Opportunities、Crawler 全部能力，但用户仍需手动在 8 个页面之间跳转。Phase 2-A 的核心不是新增功能，而是**把已有能力串成一条自动链路**。

---

## 2. V2 沙盒分支审查结论

- **分支**：`feature/v2-workflow-sandbox`（7 commits，1265 行）
- **内容**：`app/v2-lab/`（沙盒页面）、`lib/agents/v2WorkflowRecords.ts`（从 opportunities 任务提取候选品数组）、`V2WorkflowLabClient.tsx`（只读展示 UI）、356 行测试
- **判断**：V2 沙盒是从已有 tasks 中**只读读取** opportunities 记录并展示。Phase 2-A 需要**实时调用 AI** 分析链路，方向不同。
- **决定**：**不 merge V2 沙盒分支**。只参考了 safe extraction 模式（`safeString`/`safeArray`/`isRecord`）和 step 状态 UI 思路。
- **可复用**：safe extraction 工具模式、step 状态展示 UI 思路
- **不复用**：整分支（只读展示 vs 实时 AI 调用）

---

## 3. Phase 2-A 实现范围

### 3.1 新增文件

| 文件 | 说明 |
|------|------|
| `app/api/workflows/product-analysis/route.ts` | 单品工作流 API（POST） |
| `lib/workflows/productAnalysis.ts` | 4 个 step runner 函数（可测试、可复用） |
| `lib/workflows/productAnalysis.test.ts` | 12 个测试（mock AI，测试 fallback 路径） |
| `app/workflow/page.tsx` | /workflow 页面（11 行包装） |
| `components/cross-border/WorkflowClient.tsx` | 完整客户端组件（输入→进度→报告→导出） |
| `docs/phase-2a-one-click-product-workflow.md` | 本文档 |

### 3.2 修改文件

| 文件 | 改动 |
|------|------|
| `app/page.tsx` | 首页「分析产品」入口改为指向 `/workflow` |

### 3.3 工作流 API 设计

**端点**：`POST /api/workflows/product-analysis`

**请求体**：
```json
{
  "productName": "桌面手机支架",
  "source": "manual | opportunity | task",
  "accessPassword": "...",
  "options": {
    "runSourcing": true,
    "runRisk": true,
    "runSummary": true,
    "runListing": true
  }
}
```

**步骤顺序**：
1. normalize — 清洗输入
2. sourcing — 货源判断
3. risk — 风险排查
4. summary — 小白结论（含 summaryRiskGuard）
5. listing — 上架文案/关键词（含 alphaSafety 净化）
6. report — 最终报告

**安全约束**：
- 接入访问密码（无密码 401）
- 空输入 400
- 数组批量输入 400
- 单次只处理 1 个商品
- 每步独立 try/catch，失败用 fallback/warning，不导致全流程 500
- 保留 summaryRiskGuard（12 条规则）
- 保留 alphaSafety（中英文认证表达净化）
- 不调用 crawler
- 不做批量 AI

### 3.4 前端设计

**页面**：`/workflow`

**结构**：
1. 输入区（商品名 + 访问密码）
2. AI 调用说明卡片（4 步 AI，可 fallback，需人工确认）
3. 进度 stepper（6 步，每步状态：等待中/运行中/已完成/使用兜底/失败）
4. 最终报告（结论横幅 + 必须检查 + 下一步 + 人工确认清单 + 调用统计）
5. 复制/导出按钮
6. 底部单项分析入口链接（保留旧页面可访问）

### 3.5 首页更新

首页 3 主入口中，「分析产品」已改为：
- 标题：单品一键分析
- 描述：输入一个商品，一键跑完整判断流程
- 链接：`/workflow`
- 旧入口保留：侧边栏和底部链接仍可进入各单项分析页面

---

## 4. 明确不做项

- ❌ 不做批量自动 AI 分析
- ❌ 不做定时无人值守任务
- ❌ 不做自动发布、自动上架、自动投广告
- ❌ 不接入登录态平台操作
- ❌ 不使用 Cookie / 代理池 / 自动化浏览器
- ❌ 不绕验证码或反爬
- ❌ 不修改数据库 schema
- ❌ 不破坏现有 9 页面功能
- ❌ 不调用 crawler
- ❌ 不部署

---

## 5. 测试结果

- **测试框架**：Vitest
- **全量测试**：19 files，149 tests，全部通过
- **新增测试**：12 个（productAnalysis.test.ts）
  - runSourcingStep fallback (3 tests)
  - runRiskStep fallback (3 tests)
  - runSummaryStep fallback (3 tests)
  - runListingStep fallback (3 tests)
- **测试策略**：所有测试 mock `callAiJson` 返回失败，验证 fallback 路径
- **未调用真实 AI**：测试中 0 次真实 AI 调用

---

## 6. 成本与安全边界

| 边界 | 实现 |
|------|------|
| 单次只跑一个商品 | ✅ productName 仅接受 string |
| 不支持批量 | ✅ 数组输入返回 400 |
| AI 调用提示 | ✅ 前端卡片说明 4 个 AI 步骤 |
| 步骤级 fallback | ✅ 每步独立 try/catch |
| 不因单步失败全流程白屏 | ✅ fallback 数据继续下一步 |
| 不自动调用 crawler | ✅ 工作流不调 crawl API |
| 无密码 401 | ✅ checkAccessPassword |
| 空输入 400 | ✅ productName < 2 chars → 400 |
| summaryRiskGuard | ✅ applyHardGuard 完整保留 |
| alphaSafety | ✅ sanitizeUnsupportedCertificationClaims 完整保留 |
| 不修改 DB schema | ✅ 零 DB 变更 |
| 测试不调真实 AI | ✅ 12 tests mock AI |

---

## 6.1 Phase 2-A.1 真实 AI 单品验收记录

> 验收时间：2026-06-21 16:15 UTC+8 | 验收人：Claude | 商品：桌面手机支架

### 验收环境

- 分支：`main` @ `0143468`
- 服务：`next dev -p 3005`
- 工作区：干净（无未提交改动）

### 真实 AI 调用

- ✅ 是，调用了真实 AI（DeepSeek chat）
- 仅调用「桌面手机支架」1 次，4 个 AI 步骤全部完成
- 总耗时：17.3 秒
- workflowId：`wf-e8e6f1f3-31a3-4c3b-ac17-1e6e35b1bce5`

### 工作流步骤结果

| 步骤 | 状态 | 关键输出 |
|------|------|---------|
| normalize | ✅ completed | 商品名：桌面手机支架 |
| sourcing | ✅ completed | feasibility=high, beginnerFit=high, compliance=low, entry=beginner |
| risk | ✅ completed | overallLevel=green, beginnerFriendly=true, 0 blacklist |
| summary | ✅ completed | verdict=新手可小单测试, confidence=高, downgraded=false |
| listing | ✅ completed | "Adjustable Desktop Phone Stand..." 5 keywords, 3 compliance notes |
| report | ✅ completed | riskLevel=green, canTestSmallBatch=true |

### AI 调用统计

- AI 请求：4/4 成功
- Fallback：0（零降级）
- Warnings：0

### 安全边界复核

| 测试项 | 预期 | 实际 |
|--------|------|------|
| 无密码请求 | 401 | ✅ 401 `unauthorized` |
| 空 productName | 400 `missing_product_name` | ✅ |
| productName 过短 (<2) | 400 `product_name_too_short` | ✅ |
| 批量数组输入 | 400 `batch_not_supported` | ✅ |
| summaryRiskGuard | 保留 | ✅ applyHardGuard 生效（第二轮乱码测试中实际触发了降级） |
| alphaSafety | 保留 | ✅ listing title 无认证承诺 |

### 发现

1. **桌面手机支架真实 AI 验收全部通过**：4 步 AI 均正常返回，0 fallback，结论合理（低风险、新手可小单测试）
2. **乱码边缘情况**：第一轮 curl 命令行传中文出现乱码，但 workflow 仍有 fallback 保护（sourcing 返回 feasibility=low → summary guard 降级到"暂不建议做"）。这说明即使输入损坏，系统也不会崩溃或给出危险建议
3. **summaryRiskGuard 在乱码场景下正确触发**：因 sourcing 返回 feasibility=low + entryLevel=experienced，guard 自动降级了 verdict，证明安全规则在非理想输入下仍然生效

### 结论

✅ **Phase 2-A.1 真实 AI 验收通过**。单品工作流在真实 AI 环境下稳定运行，安全规则完整保留。

---

## 6.2 Phase 2-A.2 工作流任务沉淀

> 日期：2026-06-21 | 阶段：Phase 2-A.2 | 执行人：Claude

### 实现方式

- **方案 B**：新增 `POST /api/workflows/product-analysis/save-task`，前端已有 workflow 结果通过该 API 写入 tasks
- **不重复 AI 调用**：save-task API 只接收已有 workflowResult，不调用任何 AI
- **task type**：`workflow`
- **复用现有模型**：`ViralAnalysisRecord`，零 schema 变更
- **字段映射**：type=workflow, title=商品名+一键分析, oneLineSummary=finalVerdict, level=riskLevel, resultJson=完整 workflow 结果
- **task detail 渲染**：新增 `WorkflowResultSection` 组件，展示 finalReport + 步骤列表 + 检查清单

### 改动文件

| 文件 | 改动 |
|------|------|
| `app/api/workflows/product-analysis/route.ts` | batch_not_supported 错误信息更明确 |
| `app/api/workflows/product-analysis/save-task/route.ts` | **新增** save-task API |
| `app/api/tasks/route.ts` | allowedTypes 新增 "workflow" |
| `components/TaskRecordDetail.tsx` | 新增 workflow 标签 + WorkflowResultSection 渲染 |
| `components/TaskRecordsList.tsx` | 筛选列表新增 "一键分析" |
| `components/cross-border/WorkflowClient.tsx` | 新增保存到任务中心按钮 + Save 图标 |

### 安全边界

- 无密码 → 401 ✅
- 无 workflowResult → 400 `missing_workflow_result` ✅
- workflow 未成功（ok=false） → 400 `workflow_not_ok` ✅
- 无 finalReport → 400 `missing_final_report` ✅
- 保存不触发 AI 调用 ✅
- batch_not_supported 信息已修正 ✅

### 测试结果

- lint ✅ 0 warnings
- build ✅ 35/35 pages
- test ✅ 19 files, 149 passed
- save-task API smoke test ✅ (401/400/200 全部正确)

### 剩余风险

| # | 风险 | 级别 |
|---|------|------|
| 1 | save-task 写入本地 dev 数据库，已产生 1 条测试记录 | P2（可删除） |
| 2 | 页面认证需浏览器验证（`/workflow`→保存→`/tasks/[id]`） | P2（建议浏览器验收） |

---

## 7. 技术决策

### 7.1 为什么不改 schema

Phase 2-A 全程复用 `ViralAnalysisRecord`，零 schema 变更：

- 当前 Alpha 阶段优先验证闭环，schema 变更会引入 migration 风险
- `type` 字段天然支持多态，`resultJson` 存任意 JSON
- 后续进入 Phase 2-B / Phase 3 前再评估独立模型（Task / WorkflowRun / AgentStep）

### 7.2 为什么做 taskTypeRegistry

- type 已增长到 9 种（workflow / opportunities / viral / radar / product / risk / sourcing / material / summary）
- 之前 allowedTypes / label / agentLabel / filter 分散在 4 处维护
- 新增一个 type 需改 4 个文件 → 集中后只需改 1 处（`TASK_TYPE_REGISTRY`）

---

## 8. 剩余风险（Phase 2-A 收口后）

| # | 风险 | 级别 | 说明 |
|---|------|:--:|------|
| 1 | 仍缺真人 Alpha 反馈 | 🔴 | 所有测试均为 AI 拟人或内部回归，无真实用户验证 |
| 2 | AI 结论仍需人工复核 | 🟡 | summaryRiskGuard 降级机制有效，但不能替代人工判断 |
| 3 | listing step 为轻量版 | 🟡 | 仅生成 title+keywords+合规提醒，非完整 listing 文案 |
| 4 | 批量队列未实现 | 🟡 | Phase 2-A 仅支持单品，多商品需手动逐个分析 |
| 5 | 失败重试/成本控制/并发限制未进入 | 🟡 | 当前无可配置的成本上限或自动重试策略 |
| 6 | ViralAnalysisRecord 命名债 | 🟢 | 表名暗示仅存 viral，实际承载 9 种 type。建议 Phase 3 前重命名 |
| 7 | V2 沙盒分支未清理 | 🟢 | `feature/v2-workflow-sandbox` 仍存在 |

---

## 9. 下一阶段建议

**不直接进入 Phase 2-B 批量队列。** 建议先做：

### Phase 2-A UX Polish / Alpha Readiness

1. 浏览器完整链路验收（/workflow → 分析 → 保存 → /tasks/[id] → 复制报告）
2. 新手引导对齐（首页指引指向 `/workflow` 而非旧的多页面流程）
3. 找 2-3 个熟人做真人 Alpha 测试
4. 根据反馈修补：术语解释、首次使用路径、结论可读性

**只有 Alpha 用户体验稳定后，再进入 Phase 2-B 批量队列。**

---

## 10. Phase 2-A Final Closure

> 收口日期：2026-06-21 | 最终 commit：`d4c6c57` | origin/main：`d4c6c5795ebb880d770eabbb1437ce321181ba55`

### 阶段结论

Phase 2-A **已完成**。定位为**"单品一键自动分析闭环"**——不是商业化产品，不支持批量队列，不支持自动采购/上架/发布。

### 完成范围

| 交付 | 说明 |
|------|------|
| `/workflow` | 单品一键分析页面（输入→进度→报告→导出） |
| `POST /api/workflows/product-analysis` | 6 步串行流水线（normalize→sourcing→risk→summary→listing→report） |
| 4 个 AI step | runSourcingStep / runRiskStep / runSummaryStep / runListingStep（每步独立 try/catch+fallback） |
| finalReport | verdict + riskLevel + beginnerFit + canTestSmallBatch + mustCheck + nextSteps + checklist |
| `POST …/save-task` | workflow 结果保存到 tasks（零 AI 调用，零 schema 变更） |
| `/tasks` workflow 筛选 | type=workflow 筛选 + 搜索 + "一键分析"标签 |
| `/tasks/[id]` workflow 详情 | WorkflowResultSection 结构化卡片（非 JSON 堆） |
| taskTypeRegistry | TASK_TYPE_REGISTRY 集中注册 9 种 type |
| finalReport copy | "复制报告"按钮 → Markdown 文本 |
| batch_not_supported fix | 数组输入在字符串校验前被正确拒绝 |

### 真实 AI Final 验收

| 项目 | 结果 |
|------|------|
| 商品 | 桌面手机支架 |
| AI 调用次数 | 1 次 workflow = 4 个 AI step |
| HTTP | 200（17.1s） |
| ok / status | true / completed |
| sourcing | feasibility=high |
| risk | overallLevel=green |
| summary | verdict=新手可小单测试 |
| listing | 英文 title + 5 keywords + 3 compliance notes |
| finalReport | riskLevel=green, canTestSmallBatch=true |
| AI 完成率 | 4/4 done, 0 fallback |

### tasks 保存闭环

| 项目 | 结果 |
|------|------|
| save-task | ok=true |
| task id | cmqnjvovc00007an708air36d |
| 是否触发新 AI | ❌ 否 |
| type | workflow |
| /tasks type=workflow | total=2 |
| 筛选下拉 | 包含"一键分析"，旧类型仍存在 |
| /tasks/[id] 详情 | 200，结构化卡片，非 JSON 堆 |

### 安全边界

| 边界 | 结果 |
|------|:--:|
| 无密码 → 401 | ✅ |
| 无 workflowResult → 400 | ✅ |
| workflow ok=false → 400 | ✅ |
| 无 finalReport → 400 | ✅ |
| 数组批量输入 → batch_not_supported | ✅ |
| 未改 schema | ✅ |
| 未改生产 DB | ✅ |
| 无外部平台动作 | ✅ |
| 不支持批量 AI | ✅ |

### 验证

| 命令 | 结果 |
|------|------|
| `npx next lint` | 0 warnings |
| `npx next build` | 37/37 pages |
| `npx vitest run` | 19 files, 149 passed |

### Git 状态

```
main / origin/main
HEAD:  d4c6c57
Remote: d4c6c5795ebb880d770eabbb1437ce321181ba55
```

---

## 11. Phase 2-B.1 Production Deployment

> 部署日期：2026-06-21 | 部署 commit：`1dedc41` | 部署人：Claude

### 部署概述

Phase 2-B.1 是纯前端展示增强——`/workflow` 页面新增 Workflow Review 人工复核区（StepReviewCard × 4 + 确认门控）。零 API/DB 变更。

部署前生产运行的是 Phase 1E（`0ba2860`），本次 Fast-forward 到 `1dedc41`，累计包含 Phase 2-A ∼ Phase 2-B.1 全部变更。

### 部署记录

| 项目 | 值 |
|------|-----|
| 部署前 HEAD | `0ba2860`（Phase 1E） |
| 部署后 HEAD | `1dedc41` |
| pull 方式 | `git pull --ff-only origin main` |
| pull 范围 | `0ba2860..1dedc41`（14 files, +2833/-52） |
| npm ci | ✅ |
| build | ✅ 37/37 pages |
| PM2 | ✅ `alibaba-ai-assistant` online, restart 14→15 |
| 127.0.0.1:3005 | ✅ 200 |
| /api/health | ✅ `{"ok":true}` |

### 页面验收

| 页面 | 状态 |
|------|:--:|
| 公网 `/` | ✅ 200 |
| 公网 `/workflow` | ✅ 200 |
| `/tasks` | ✅ 200 |
| `/sourcing` | ✅ 200 |
| `/risk` | ✅ 200 |
| `/summary` | ✅ 200 |
| `/products/new` | ✅ 200 |
| `/viral` | ✅ 200 |
| `/materials` | ✅ 200 |

### 变更说明

Phase 2-B.1 单独代码改动仅 `components/cross-border/WorkflowClient.tsx`（+188 行）。本次部署因生产从 Phase 1E 直接 Fast-forward，同时部署了 Phase 2-A.0 ∼ 2-B.1 的累计 14 个文件。

### 安全确认

| 项目 | 状态 |
|------|:--:|
| 调用真实 AI | ❌ 未调用 |
| 改 API | ❌ 未改 |
| 改 DB schema | ❌ 未改 |
| 改 PM2 配置 | ❌ 未改 |
| 改 Nginx | ❌ 未改 |
| 进入 Phase 2-B.2 | ❌ 未进入 |
| 需要回滚 | ❌ 不需要 |

### 下一步

Phase 2-B.2：review 确认状态持久化 + 决策动作（继续/需补资料/淘汰）写入 task decisionStatus。
