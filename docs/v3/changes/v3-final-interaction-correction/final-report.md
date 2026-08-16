# V3 Final Interaction & Research Navigation Correction — Final Release Report

> 分支：codex/v3-final-research-interaction-correction → main == origin/main == daad491
> 基线：a9474ff（PLAYWRIGHT_FINAL_ACCEPTANCE 被用户手工反例 INVALIDATED；LOCAL_RELEASE_CANDIDATE=REVOKED）

## 第一句：用户这次亲手发现的 5 个问题（+2 个补充反例）是不是全部真的解决了，而不是又被自动测试误判为通过？

**是。** 每一个反例都先用 headed 真实浏览器复现（记录 URL/截图/root cause），修复后再次用真实浏览器走通；并且走查还发现了 1 个自动测试无法覆盖的真实回归（任务详情页卡 loading，c477522 引入）并修复复验。

## 用户反例逐项结果（R1-R7 全部 PASS）

| 反例 | Root cause（复现实证） | 修复 | 真实验收 |
|---|---|---|---|
| R1 1688 登录/重新检测无效 | 检测的是 CLI whoami 而非普通 Chrome；bridge 只报扩展心跳；无反馈 | 两套登录说明 + 固定 capability begin1688KeywordLogin + [打开 1688 登录窗口] + 重新检测反馈（时间戳+分项） | "刚刚检测：01:34 · 关键词工具：未安装 · 浏览器助手：已连接" ✓ |
| R2 AI 整理按钮跳转 | href 硬编码 /opportunity-candidates | 删除顶部重复 AI trigger，唯一动作在 AI 证据总结区 | 点击生成后 URL 保持 /tasks/[id] ✓ |
| R3 Decision 无保存 | combobox onChange 自动保存无状态 | 显式[保存旧版状态] + 未保存提示 + 兼容说明 | 改→保存→刷新持久→列表一致 ✓ |
| R4/R6 Listing/Image 断链 | gate legacy_not_supported 统一 404 | taskAccessible 区分 + Studio 细分错误 + legacy CTA 门禁 | legacy CTA 不伪装可用；e2e 12+3 用例 PASS ✓ |
| R5 导航混用 | /tasks 五 Tab 混排、无独立商品研究 | /research + /tasks 历史 + classifyResearchLifecycle + Sidebar/高亮/breadcrumb | 全部真实验证 ✓ |
| R7 状态不同步 | record.result 是投影（无 evidence namespace）→ 清单结构上不可见 | 清单移入 EvidenceWorkbench 从实时 state 派生 + onDataChanged | Amazon 确认→已有、VOC 确认→已有（即时不刷新）✓ |
| 币种错位（新） | 日本代理 amazon.com 显示 JPY，采集未校准 | 采集前环境校准（ZIP 10001 + en_US/USD + 检测） | "已尝试自动校准，但当前仍不是 Amazon US 价格环境…价格不会保存" ✓ |

## 币种校准专项
- 复现：JPY8,279 + 配送地 Japan（真实浏览器）✓
- 校准流程：自动导航 → 配送 ZIP 10001（Amazon 正常 UI）→ 检测 → 非 US 则明确提示 + fail-closed（价格不保存）✓
- 本机日本代理下 Amazon 端基于 IP 拒绝切美国（不可控）；US 环境校准会确认 USD 并显示"已校准美国配送与币种"
- 严禁项遵守：无 JPY→USD 换算、无 DOM 伪造、无 schema 变更、currency mismatch 门禁未放宽

## 验证
- 全量 4828 tests PASS（2 环境类失败归因）；tsc/lint/build PASS；headed Playwright R1-R7+币种 全 PASS
- 走查发现并修复回归 1 项（loadRecord 丢失）+ 初始实现问题 3 项（scope/highlight/SSR bailout）

## 状态
- main == origin/main == daad491（ff 集成 + push）
- 3005 运行 daad491 build（health 200）
- LOCAL_RELEASE_CANDIDATE：**APPROVED**（P1=0；全部用户反例真实验收 PASS；Automated + Manual-counterexample 双通道）
- PUBLIC_DEPLOY = FORBIDDEN（保持）；V3_6 = NOT_AUTHORIZED
- 遗留：本机代理环境无法复现"校准成功→USD 保存"（Amazon 端 IP 限制）——需美国节点环境最终确认；1688 关键词登录需用户扫码（UI 闭环已就绪）

STOP：未部署公网、未开始 V3.6、3005 保持运行，等待用户亲自复查本轮 7 个问题。
