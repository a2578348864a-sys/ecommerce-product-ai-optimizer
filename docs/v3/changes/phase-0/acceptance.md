# Phase 0 验收 — Gate 自检与终审

> 记录时间：Phase 0 执行完成时。基线：main `76e2c9624393fe3766c0b818df88e9cd986d0a52`（执行包读取后、本轮文档写入前）。

## 0. 基线

- Git 根：`D:\Workspace\projects\project-001-跨境电商AI工具\电商工具`
- 分支：`main`
- main HEAD：`76e2c9624393fe3766c0b818df88e9cd986d0a52`
- Phase 0 开始前 main clean：是（`git status --porcelain` 为空）
- 本地 3005 服务：计划任务 `QingXuanAgent-Local-3005` 状态 registered / Ready（listenerPid 35344，全程未触碰）
- 业务代码修改：无。本轮唯一写入：`docs/v3/changes/phase-0/`（5 个文档）
- 公网部署：无。force push：无。DB 操作：无。依赖变更：无。

## 1. Gate 六项自检（09_PHASE0_TASK.md）

| # | Gate | 结论 | 证据 |
|---|---|---|---|
| 1 | 资产表完整 | PASS | audit.md：21 页面 / 52 route.ts（约 68 handler）/ 6 Prisma 模型 / 状态套 / score / 链 / Skill / CLI 全部登记，04 必查对象逐项覆盖（/agent/run、/workflow、opportunities/Candidate、tasks、sourcing、summary、旧 listing step、Listing/Image Studio、product-research-record、listing-keyword-brief、handoff、SellerSprite import/preview/reportType、real AI gates） |
| 2 | 状态语义统一 | PASS | decisions.md §2：V3 四态唯一权威（lib/tasks/decisionStatus.ts）；研究决定三值显式映射；候选队列/生命周期/批次/预筛/图片复核状态显式区分；旧扩展值（watchlist/archived、R22）只读兼容 |
| 3 | score 裁定 | PASS | decisions.md §3：谁写/谁读/排序/推荐/UI/停止新写六问全答；默认裁定落地（V3 新决策链不以 score 为权威依据） |
| 4 | 旧链去留 | PASS | decisions.md §4：旧链全部停止新入口；占位页/重定向保留；API 退役候选；旧数据只读兼容；Phase 6 统一收口 |
| 5 | API/MCP 定位 | PASS | decisions.md §5：V3 Core 不引入 API/MCP；XLSX+人工辅助 CLI+人工录入为数据入口；浏览器既有资产只登记不扩展 |
| 6 | Phase 1/2 冲突范围明确 | PASS | decisions.md §6：Phase 1 = sellersprite 解析/CLI 层；Phase 2 = 读取模型+研究页/任务详情；重叠文件（save-task、sellerSpritePreview*）显式列出 |

## 2. 双重审查（03_MULTI_AGENT_GOVERNANCE.md）

### 第一关：规格符合度

- 漏做：无。04 必查 13 类对象全部有裁定；09 Gate 六项全部覆盖。
- 多做：无业务代码改动；文档仅限 docs/v3/changes/phase-0/；未创建 worktree/branch（Phase 0 为只读盘点 + 主 Agent 文档裁定，不属功能开发）。
- 做偏：无。裁定与执行包默认一致（score 兼容裁定、四态权威、旧链收口方向）。
- 可验证：每项裁定均带 `文件:行号` 证据；关键发现（任务级 AI gate 缺口、category_current 硬编码、四态权威、score 写入方）经主 Agent 一手源码复核。

### 第二关：工程质量

- 文档事实一致性：页面/API/状态/score 结论与源码一致（子 Agent 报告与主 Agent 独立核验无矛盾，冲突点已更正：/opportunities 调用方修正为 product-batches 链）。
- 路径正确性：所有引用的仓库路径已核对存在。
- 安全/数据：全程未读受保护运行数据内容（demo-access.json、demo-sandbox.json、dev.db），未触碰 3005、未运行写命令、未执行 git 写操作。

## 3. 规格对账（03/21）

- 冻结任务书：09_PHASE0_TASK.md（0A/0B/0C + 4 文档 + Gate）与 04_ASSET_MIGRATION_SPEC.md（必填列、必查对象、状态统一、score 六问）——已逐条对账，全部落实。
- 实际 diff：仅新增 `docs/v3/changes/phase-0/{proposal,audit,decisions,acceptance,learnings}.md`。
- 测试：Phase 0 无代码变更，不适用业务测试；「文档检查」按 AGENTS.md 通用验证矩阵（Markdown、相对路径、命令和事实一致性）执行。
- 页面/数据结果：不适用（只读盘点）。

## 4. 三视角终审

- 产品视角：V3 主链（发现→候选→研究→决定→交接→Studio）已存在且资产齐备；本 Phase 未偏离 Evidence Workbench 方向；裁定未引入新功能承诺。
- 工程视角：无重复体系建设；**正式风险 15 项（decisions.md §7，含 1 项真实 AI 门禁不一致）+ 8 项 audit observation**；未触碰共享文件与受控操作。
- 验收视角：所有裁定均可从当前 main 源码验证；关键缺口（Reverse ASIN/Keyword Mining、category_current 落库、keyword-brief 追溯）与 V3 路线图（Phase 3/4、30 增强）对齐。

## 5. 结论

`PHASE_0 = PASS`

- 六项 Gate 全部 PASS；
- 双重审查、规格对账、三视角终审完成；
- 产物：`docs/v3/changes/phase-0/`（proposal.md、audit.md、decisions.md、acceptance.md、learnings.md）。

## 6. 新增产品约束登记（用户 Phase 0 期间新增，仅登记不实施）

- **文件位置**：`轻选工作台_V3_唯一权威最终执行包_FINAL/change-package-seeds/phase2-phase5-novice-comprehension/README.md`（材料根，不在 Git 仓库内）。
- **内容**：Phase 2 / Phase 5 新手可理解性约束（Novice Comprehension Constraint）——Evidence→可理解解释层、首屏信息层级（简明结论→为什么→原始 Evidence）、AI Summary 新手解释层输出与禁止项、Novice Comprehension Gate 验收门禁。
- **权威层级**：等同 `30_GITHUB_DERIVED_PHASE_ENHANCEMENTS.md`（低于 v2.2 FINAL 权威合同）；Phase 2 / Phase 5 主 Agent 开工时必须读取并写入对应 Change Package。
- **术语对接**：recommendation 沿用 Phase 5 现有「下一步」词汇，不新增决策类型、不新增决策状态、不建评分系统。
- 本 Phase 0 未实施该约束；V3 总纲权威文件（00–29、README.md、manifest.json）未改动。

按执行包要求，本轮到此停止：不进入 Phase 1，不修改业务代码，不部署公网。最终资产去留与迁移裁定报告已提交（见最终汇报）。等待用户独立审查通过后，再授权 Phase 1–6。

---

## 7. Phase 0 Closeout 记录（用户独立审查通过后执行，2026 审查结论）

用户独立审查结论：**核心裁定通过，PHASE_0 = PASS 保留**。Closeout 仅修文档/Change Package/CURRENT_WORK，未改业务代码、未改 V3 总纲。

| Closeout 项 | 结论 | 落点 |
|---|---|---|
| 统一遗留风险清单 | decisions.md §7 为正式风险唯一来源：**15 项正式风险 + 8 项 observation**（audit 18 项观察去重映射，见 §7.1）；本文件「10 项」旧口径已修正 | decisions.md §7、§7.1；audit.md |
| 钉死 Decision 语义 | V3 四态=展示/兼容层唯一权威语义，**不是 research-decision 写枚举**；写入继续用三值合同+既有映射；pending=默认兼容态；**禁止重构写合同** | decisions.md §2.1a、§2.2 |
| Phase 1 修改边界 | **默认禁止修改 lib/server/****；唯一例外 lib/server/sellerSpritePreview*（需 Phase 1 Change Package allowlist+必要性证明）；风险 #4 顺延 | decisions.md §6 |
| 登记 Phase 2 score 风险 | 正式风险 #15：score 展示不得作为首屏权威决策信号，若保留须标注参考；Closeout 不删除不迁移 score | decisions.md §3.1、§7 |
| CURRENT_WORK 落地 | 全部正式风险（Phase/owner/处理阶段）已进入 CURRENT_WORK | docs/v3/CURRENT_WORK.md |

Closeout 完成。用户已授权：恢复 `auto_with_integration_gates`，开始 Phase 1，按门禁自动推进 V3 Core Phase 1–6；到 `V3_CORE = DONE` 按原合同强制暂停；继续禁止公网部署。
