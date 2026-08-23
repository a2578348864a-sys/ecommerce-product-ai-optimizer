# Formal v2 发布冻结清单（轮 13 Release Freeze）

> 依据：开工前 `git status --short -uall` before 清单（%TEMP%\\r13-before.txt，**191 行**）逐项归类；本清单**不是 Commit 授权**。HEAD=`2d41662`，分支=feature/v4.1-ui-productization。

## 汇总（守恒校验：191 = A+B+C+D）

| 类别 | 数量 | 说明 | 进入公网候选 |
| --- | ---: | --- | --- |
| **A Formal v2 发布内容** | **133** | 轮 5-13 正式 v2 功能/测试/证据/文档 | 是（候选包主体） |
| B 用户既有无关修改 | 16 | 原型（app/prototype×3、PROTOTYPE_V2 文档×3、c-prototype-v2 截图×7）+ AGENTS.md | 否 |
| C 临时/生成物待审 | 42 | tmp/bu_*.py×24、tmp/e2e-steps/r8-*.txt×13、tmp/snap_*.py×4、start-local-r11.txt×1 | 否（建议 gitignore 或拆分提交） |
| D 受保护运行数据 | 0 | prisma/dev.db、data/* 均被 git 忽略，未出现在 status | 否 |

## A 类明细（133 项，按功能分组）

### 候选池/研究入口（轮 7-8）（10）

| 路径 | 直接测试 | 进入公网候选 |
| --- | --- | --- |
| `app/api/product-batches/candidates/route.test.ts` | （测试自身） | 是 |
| `app/opportunity-candidates/page.tsx` | 见对应 .test.ts | 是 |
| `components/cross-border/CandidatePoolView.test.ts` | （测试自身） | 是 |
| `components/cross-border/CandidatePoolView.tsx` | 见对应 .test.ts | 是 |
| `components/cross-border/ProductBatchManager.test.ts` | （测试自身） | 是 |
| `components/cross-border/ProductBatchManager.tsx` | 见对应 .test.ts | 是 |
| `lib/candidateResearchPool.test.ts` | （测试自身） | 是 |
| `lib/candidateResearchPool.ts` | 见对应 .test.ts | 是 |
| `lib/server/productBatchCandidateService.test.ts` | （测试自身） | 是 |
| `lib/server/productBatchCandidateService.ts` | 见对应 .test.ts | 是 |

### 竞品/关键词证据（轮 9-10）（14）

| 路径 | 直接测试 | 进入公网候选 |
| --- | --- | --- |
| `app/api/tasks/[id]/competitor-evidence/route.ts` | 见对应 .test.ts | 是 |
| `app/api/tasks/[id]/keyword-evidence/route.ts` | 见对应 .test.ts | 是 |
| `lib/server/competitorEvidence.test.ts` | （测试自身） | 是 |
| `lib/server/competitorEvidence.ts` | 见对应 .test.ts | 是 |
| `app/api/tasks/[id]/competitor-evidence/route.test.ts` | （测试自身） | 是 |
| `app/api/tasks/[id]/keyword-evidence/route.test.ts` | （测试自身） | 是 |
| `components/evidence/BrowserUseCollectButton.test.ts` | （测试自身） | 是 |
| `components/evidence/BrowserUseCollectButton.tsx` | 见对应 .test.ts | 是 |
| `lib/server/browserUseResearch.test.ts` | （测试自身） | 是 |
| `lib/server/browserUseResearch.ts` | 见对应 .test.ts | 是 |
| `tools/collectors/browser-use/amazonCompetitorCollector.test.ts` | （测试自身） | 是 |
| `tools/collectors/browser-use/amazonCompetitorCollector.ts` | 见对应 .test.ts | 是 |
| `tools/collectors/browser-use/sellerSpriteCollector.test.ts` | （测试自身） | 是 |
| `tools/collectors/browser-use/sellerSpriteCollector.ts` | 见对应 .test.ts | 是 |

### 评论证据路由（轮 12-13）（2）

| 路径 | 直接测试 | 进入公网候选 |
| --- | --- | --- |
| `app/api/tasks/[id]/review-evidence/route.test.ts` | （测试自身） | 是 |
| `app/api/tasks/[id]/review-evidence/route.ts` | 见对应 .test.ts | 是 |

### 任务 API（轮 5-12）（3）

| 路径 | 直接测试 | 进入公网候选 |
| --- | --- | --- |
| `app/api/tasks/route.dto-security.test.ts` | （测试自身） | 是 |
| `app/api/tasks/route.test.ts` | （测试自身） | 是 |
| `app/api/tasks/route.ts` | 见对应 .test.ts | 是 |

### 首页/研究入口（轮 7）（3）

| 路径 | 直接测试 | 进入公网候选 |
| --- | --- | --- |
| `components/HomeDashboardClient.c-workbench.test.ts` | （测试自身） | 是 |
| `components/HomeDashboardClient.demo-language.test.ts` | （测试自身） | 是 |
| `components/HomeDashboardClient.tsx` | 见对应 .test.ts | 是 |

### 任务详情/研究记录/导航（轮 5-9）（17）

| 路径 | 直接测试 | 进入公网候选 |
| --- | --- | --- |
| `components/TaskRecordDetail.tsx` | 见对应 .test.ts | 是 |
| `components/TaskRecordsList.tsx` | 见对应 .test.ts | 是 |
| `components/WorkspaceSidebar.tsx` | 见对应 .test.ts | 是 |
| `components/WorkspaceSidebar.v4nav.test.ts` | （测试自身） | 是 |
| `components/phase2StudioNavigation.test.ts` | （测试自身） | 是 |
| `components/phase3ResearchHistory.test.ts` | （测试自身） | 是 |
| `components/productUiPolish.test.ts` | （测试自身） | 是 |
| `lib/navigationAudit.test.ts` | （测试自身） | 是 |
| `lib/productResearchPublicDto.test.ts` | （测试自身） | 是 |
| `lib/productResearchPublicDto.ts` | 见对应 .test.ts | 是 |
| `lib/productResearchRecord.staleness-ux.test.ts` | （测试自身） | 是 |
| `lib/researchLifecycle.test.ts` | （测试自身） | 是 |
| `lib/researchLifecycle.ts` | 见对应 .test.ts | 是 |
| `components/TaskRecordDetail.formal-v2.dom.test.ts` | （测试自身） | 是 |
| `components/TaskRecordDetail.formal-v2.test.ts` | （测试自身） | 是 |
| `components/TaskRecordsList.research-groups.test.ts` | （测试自身） | 是 |
| `components/WorkspaceSidebar.test.ts` | （测试自身） | 是 |

### 商业输入/身份补全（轮 6）（11）

| 路径 | 直接测试 | 进入公网候选 |
| --- | --- | --- |
| `components/creative-handoff/CreativeHandoffPanel.test.ts` | （测试自身） | 是 |
| `lib/server/candidateEvidenceReview.ts` | 见对应 .test.ts | 是 |
| `lib/server/taskResultNamespacePolicy.ts` | 见对应 .test.ts | 是 |
| `lib/server/taskResultWriterServices.ts` | 见对应 .test.ts | 是 |
| `app/api/opportunity-candidates/[id]/image/route.test.ts` | （测试自身） | 是 |
| `app/api/opportunity-candidates/[id]/image/route.ts` | 见对应 .test.ts | 是 |
| `app/api/tasks/[id]/commercial-inputs/route.test.ts` | （测试自身） | 是 |
| `app/api/tasks/[id]/commercial-inputs/route.ts` | 见对应 .test.ts | 是 |
| `components/product-research/CommercialInputsCard.tsx` | 见对应 .test.ts | 是 |
| `lib/server/commercialInputs.test.ts` | （测试自身） | 是 |
| `lib/server/commercialInputs.ts` | 见对应 .test.ts | 是 |

### 可用性纠偏（轮 12-13）（12）

| 路径 | 直接测试 | 进入公网候选 |
| --- | --- | --- |
| `components/cross-border/SourcingEvidencePanel.test.ts` | （测试自身） | 是 |
| `components/cross-border/SourcingEvidencePanel.tsx` | 见对应 .test.ts | 是 |
| `components/evidence/BrowserEvidenceSection.test.ts` | （测试自身） | 是 |
| `components/evidence/BrowserEvidenceSection.tsx` | 见对应 .test.ts | 是 |
| `components/evidence/EvidenceWorkbench.test.ts` | （测试自身） | 是 |
| `components/evidence/EvidenceWorkbench.tsx` | 见对应 .test.ts | 是 |
| `components/evidence/VocEvidenceSection.test.ts` | （测试自身） | 是 |
| `components/evidence/VocEvidenceSection.tsx` | 见对应 .test.ts | 是 |
| `components/evidence/BrowserEvidenceSection.conflict.dom.test.ts` | （测试自身） | 是 |
| `components/evidence/VocEvidenceSection.conflict.dom.test.ts` | （测试自身） | 是 |
| `lib/client/evidenceConflictRecovery.test.ts` | （测试自身） | 是 |
| `lib/client/evidenceConflictRecovery.ts` | 见对应 .test.ts | 是 |

### 正式 v2 文档（3）

| 路径 | 直接测试 | 进入公网候选 |
| --- | --- | --- |
| `docs/v4.1/FORMAL_V2_BLOCKED.md` | —（文档/证据） | 是 |
| `docs/v4.1/FORMAL_V2_COMPARE.md` | —（文档/证据） | 是 |
| `docs/v4.1/FORMAL_V2_PROGRESS.md` | —（文档/证据） | 是 |

### 正式 v2 证据截图（60）

| 路径 | 直接测试 | 进入公网候选 |
| --- | --- | --- |
| `docs/v4.1/evidence/d-formal-v2/00-formal-old-home-1440x900.png` | —（文档/证据） | 是 |


| `docs/v4.1/evidence/d-formal-v2/03-formal-old-detail-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/10-formal-new-home-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/10-formal-new-home-2560x1380.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/10-formal-new-home-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/10-formal-new-home-768x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/15-formal-research-identity-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/20-formal-new-detail-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/20-formal-new-detail-2560x1380.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/20-formal-new-detail-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/20-formal-new-detail-768x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/24-formal-new-detail-listing-images-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/action-routing-buyers-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/action-routing-buyers-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/action-routing-cost-risk-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/action-routing-cost-risk-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/action-routing-market-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/action-routing-market-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/action-routing-sourcing-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/action-routing-sourcing-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/correction-home-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/correction-home-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/correction-home-768x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/correction-task-oxo-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/correction-task-oxo-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/correction-task-oxo-768x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/correction-task-oxo-listing-images-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/entry-chain-startable-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/entry-chain-startable-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/final-active-detail-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/final-active-detail-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/final-historical-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/final-home-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/final-home-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/final-home-768x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/formal-active-detail-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/formal-home-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/formal-home-active-detail-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/formal-research-record-historical-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/r3-active-detail-oxo-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/r3-active-detail-oxo-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/r3-historical-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/r3-home-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/r8-home-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/r8-home-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/r8-startable-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/r8-startable-390x844.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/round11-1440-refresh.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/round11-1440-saved.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/round11-390-refresh.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/usability-closure-candidate-pool-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/usability-closure-commercial-inputs-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/usability-closure-commercial-inputs-open-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/usability-closure-research-1440x900.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/usability-fix-r12-1440-detail.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/usability-fix-r12-1440-expanded.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/usability-fix-r12-390-detail.png` | —（文档/证据） | 是 |
| `docs/v4.1/evidence/d-formal-v2/usability-fix-r12-390-expanded.png` | —（文档/证据） | 是 |

## B 类明细（16 项）

| 路径 | 说明 |
| --- | --- |
| `AGENTS.md` | 用户既有/原型内容，未触碰 |
| `app/prototype/page.tsx` | 用户既有/原型内容，未触碰 |
| `app/prototype/product/page.tsx` | 用户既有/原型内容，未触碰 |
| `app/prototype/prototype.css` | 用户既有/原型内容，未触碰 |
| `docs/v4.1/PROTOTYPE_V2_BLOCKED.md` | 用户既有/原型内容，未触碰 |
| `docs/v4.1/PROTOTYPE_V2_COMPARE.md` | 用户既有/原型内容，未触碰 |
| `docs/v4.1/PROTOTYPE_V2_PROGRESS.md` | 用户既有/原型内容，未触碰 |
| `docs/v4.1/evidence/c-prototype-v2/product-1440x900.png` | 用户既有/原型内容，未触碰 |
| `docs/v4.1/evidence/c-prototype-v2/product-390x844.png` | 用户既有/原型内容，未触碰 |
| `docs/v4.1/evidence/c-prototype-v2/product-768x900.png` | 用户既有/原型内容，未触碰 |
| `docs/v4.1/evidence/c-prototype-v2/product-listing-390x844.png` | 用户既有/原型内容，未触碰 |
| `docs/v4.1/evidence/c-prototype-v2/workbench-1440x900.png` | 用户既有/原型内容，未触碰 |
| `docs/v4.1/evidence/c-prototype-v2/workbench-390x844.png` | 用户既有/原型内容，未触碰 |
| `docs/v4.1/evidence/c-prototype-v2/workbench-768x900.png` | 用户既有/原型内容，未触碰 |
| `docs/v4.1/evidence/d-formal-v2/01-frozen-prototype-home-1440x900.png` | 原型基线对比截图（formal 证据目录，内容属原型） |
| `docs/v4.1/evidence/d-formal-v2/02-frozen-prototype-product-1440x900.png` | 原型基线对比截图（formal 证据目录，内容属原型） |

## C 类明细（42 项）

| 路径 | 说明 |
| --- | --- |
| `start-local-r11.txt` | 验收/工程临时产物 |
| `tmp/bu_all.py` | 验收/工程临时产物 |
| `tmp/bu_both1440.py` | 验收/工程临时产物 |
| `tmp/bu_diag.py` | 验收/工程临时产物 |
| `tmp/bu_emo.py` | 验收/工程临时产物 |
| `tmp/bu_emo2.py` | 验收/工程临时产物 |
| `tmp/bu_emo3.py` | 验收/工程临时产物 |
| `tmp/bu_emo4.py` | 验收/工程临时产物 |
| `tmp/bu_emo5.py` | 验收/工程临时产物 |
| `tmp/bu_emo6.py` | 验收/工程临时产物 |
| `tmp/bu_emo7.py` | 验收/工程临时产物 |
| `tmp/bu_final.py` | 验收/工程临时产物 |
| `tmp/bu_final2.py` | 验收/工程临时产物 |
| `tmp/bu_finalA.py` | 验收/工程临时产物 |
| `tmp/bu_finalB.py` | 验收/工程临时产物 |
| `tmp/bu_help.py` | 验收/工程临时产物 |
| `tmp/bu_helpers.py` | 验收/工程临时产物 |
| `tmp/bu_home.py` | 验收/工程临时产物 |
| `tmp/bu_home2.py` | 验收/工程临时产物 |
| `tmp/bu_probe.py` | 验收/工程临时产物 |
| `tmp/bu_shot.py` | 验收/工程临时产物 |
| `tmp/bu_startable.py` | 验收/工程临时产物 |
| `tmp/bu_startable2.py` | 验收/工程临时产物 |
| `tmp/bu_test_shot.png` | 验收/工程临时产物 |
| `tmp/bu_win.py` | 验收/工程临时产物 |
| `tmp/e2e-steps/r8-after-status.txt` | 验收/工程临时产物 |
| `tmp/e2e-steps/r8-build.txt` | 验收/工程临时产物 |
| `tmp/e2e-steps/r8-direct-baseline.txt` | 验收/工程临时产物 |
| `tmp/e2e-steps/r8-eslint.txt` | 验收/工程临时产物 |
| `tmp/e2e-steps/r8-green-direct.txt` | 验收/工程临时产物 |
| `tmp/e2e-steps/r8-green-mainchain.txt` | 验收/工程临时产物 |
| `tmp/e2e-steps/r8-isolated-stage15.txt` | 验收/工程临时产物 |
| `tmp/e2e-steps/r8-mainchain-baseline.txt` | 验收/工程临时产物 |
| `tmp/e2e-steps/r8-red-contract.txt` | 验收/工程临时产物 |
| `tmp/e2e-steps/r8-rev1-red.txt` | 验收/工程临时产物 |
| `tmp/e2e-steps/r8-rev2-red.txt` | 验收/工程临时产物 |
| `tmp/e2e-steps/r8-task0.txt` | 验收/工程临时产物 |
| `tmp/e2e-steps/r8-tsc.txt` | 验收/工程临时产物 |
| `tmp/snap_h14.py` | 验收/工程临时产物 |
| `tmp/snap_h39.py` | 验收/工程临时产物 |
| `tmp/snap_s14.py` | 验收/工程临时产物 |
| `tmp/snap_s39.py` | 验收/工程临时产物 |

## 结论

**READY_FOR_COMMIT = NO_GO**（未获 Commit 授权；且 A 类中 `app/api/tasks/route.ts`（203+/17-）与 `components/TaskRecordDetail.tsx`（610+/304-）等大改需先经代码审查；B/C 类必须从提交范围剔除）。清单已交付，不作为 Commit 依据。

## Round 13 追加（本会话新增，未计入 191 before）

| 路径 | 类别 | 说明 |
| --- | --- | --- |
| `components/evidence/AiEvidenceSummarySection.tsx` | A | 用户语言收口（任务 1）——EvidenceRef→引用校验、Evidence→资料、AI 证据总结→AI 研究摘要 |
| `components/evidence/AiEvidenceSummarySection.test.ts` | A | 新增测试（2 项） |
| `components/evidence/KeywordReportEvidenceSection.tsx` | A | 用户语言收口（任务 1）——capturedAt→采集时间、unknown→尚未取得 |
| `components/evidence/KeywordReportEvidenceSection.test.ts` | A | 新增测试（2 项） |

# Formal v2 提交前冻结（轮 16 独立审计后更新，替代「轮 13 旧清单」作为当前范围）

> 本清单是**当前真实范围**。下方「轮 13 Release Freeze」191 项清单是历史记录，仅存档，不再冒充当前范围。

## 当前口径（审计独立复跑，机器守恒校验）

- git status --porcelain=v1 -uall：**255 项**（审计起点与收尾均一致）。
- 分类（唯一归类、无重复无遗漏）：**A=187 / B=16 / C=52 / D=0**，187+16+52+0=255。
- **114 与 255 的差异仅为统计口径**：114 是默认 porcelain（未跟踪目录折叠计数）；255 是 -uall（逐文件展开）。工作区内容前后一致（HEAD 未变）。
- **当前正式提交候选：A 类 187 项 + .gitignore（新增规则）= 188 项**。
- **B 类 16 项**（原型/个人/非正式：AGENTS.md、app/prototype×3、PROTOTYPE_V2 文档×3、c-prototype-v2 截图×7、d-formal-v2 原型基线截图×2）：保留本地，不提交。
- **C 类 52 项**（tmp/ 50 项含本地演示 token 文件 1 个、start-local-r11.txt）：保留本地，**由 .gitignore /tmp/ 与 /start-local-r11.txt 精确规则阻止误提交**；不删除磁盘文件。
- A 类含**正式验收截图 78 张**（约 10.3MB，全部为轮 3-16 各轮次报告引用的验收证据）与**正式文档 9 份**（FORMAL/PUBLIC 系列 md）。

## 验证快照（审计/冻结执行时刻）

- HEAD：2d416627491a058350beeb8ac3a2ad7333cb49c4（分支 feature/v4.1-ui-productization；全程未变）。
- 审计构建 BUILD_ID：4Kprr-4FJH1yPghQ8wZoX。
- 原始 prisma/dev.db SHA-256（原生只读句柄）：a17675798b3a75976758136a37cc4dbe91d6d02e845ba389b1ab9e2b24a463a9（往返一致，零写入）。
- 全量 npm run test（每次仅跑一次）：6041 passed / 0 failed / 89 skipped；唯一文件级失败 lib/server/native1688Bridge.integration.test.ts（bridge did not start；本机未启动 1688 原生桥，11 用例全 skip；隔离复跑 1 次复现）。判定：**环境问题**（HEAD 既有文件、不在本 255 变更集内），非业务回归。
- npx tsc --noEmit --pretty false：0 错误；npm run build：成功；git diff --check：0。

## 安全快照

- 凭据/密钥/私钥/会话 token 扫描（A 类）：0 命中；唯一 PASSWORD=ci-test-password 为测试 mock 常量（Prisma 全 mock）。
- prisma/dev.db、data/demo-access.json、.env*、.local-backups/、logs/：均由 .gitignore 保护且不在 255 变更集。
- tmp/mc-r16-token.txt（本地演示 stok_v1 token）：**存在并已排除**（C 类 + 新增 .gitignore 规则；值未在任何文档记录）。

## 待办（提交授权前）

1. 以本清单 + %TEMP%\formal-v2-commit-prep\commit-paths.txt（188 项）为提交范围；B/C 不得出现在暂存区。
2. 提交消息说明 A 类含 78 张验收截图（+10.3MB）属验收证据。
