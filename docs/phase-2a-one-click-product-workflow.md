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

## 7. 剩余风险

| # | 风险 | 建议 |
|---|------|------|
| 1 | **未做真实 AI 验收** | Phase 2-A 开发阶段未调用真实 AI。建议上线前用 1 个低风险商品（如"桌面手机支架"）跑 1 次真实链路 |
| 2 | **listing step 为轻量版** | 当前 listing 仅生成 title+keywords+合规提醒，不是完整 listing 文案。如需完整版，可对接现有 `/api/products/listing-copy` |
| 3 | **没有保存到任务中心** | 当前工作流结果不自动写入 tasks 表。可在后续版本增加 |
| 4 | **V2 沙盒分支未清理** | `feature/v2-workflow-sandbox` 仍存在，建议确认不需要后删除 |

---

## 8. 下一步建议

1. **真实 AI 验收**：用 1 个低风险商品跑 1 次真实链路
2. **Phase 2-B**：批量输入与任务队列
3. **任务中心集成**：工作流结果自动写入 tasks
4. **清理 V2 沙盒分支**（如确认不需要）
