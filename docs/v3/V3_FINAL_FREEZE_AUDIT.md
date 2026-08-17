# V3 Final Freeze 全项目审计报告

- 审计类型：AUDIT ONLY（READ-FIRST / ADVERSARIAL REVIEW / REAL USER JOURNEY）
- 审计日期：2026-08-17（本地时区 +0800）
- 审计基线：`main` HEAD = `f962c76`（docs：evidence-to-creative context closure）；最后一个代码提交 = `d9e7210`（feat：evidence-to-creative context bridge (P1)，2026-08-17 23:02:57 +0800）
- 运行实例：3005（`next start -H 127.0.0.1 -p 3005`，production 模式，PID 40508，health OK）
- 数据库：`prisma/dev.db`（SQLite，11 tasks / 11 candidates，`quick_check=ok`；审计前备份 `.local-backups/db-guard/2026-08-17T23-15-34`，SHA256 `FFB0054EF3C94E21F87FFB3FD8ADE94F5924E5CE04F00FD10129214BAA125557`）
- 纪律：只取证/定位/最小复现/记录；未修改任何业务代码、未执行 DB 迁移、未调用付费 Provider、未做公网部署；3005 保持运行。

---

## 0. 判定（机器可读）

```
V3_PRODUCT_DEVELOPMENT = CLOSED
V3_FINAL_FREEZE        = APPROVED        (P0=0, P1=0)
LOCAL_RELEASE_CANDIDATE= APPROVED
PUBLIC_DEPLOYMENT_READINESS = READY_FOR_PREFLIGHT
PUBLIC_DEPLOY          = FORBIDDEN       (审计非部署授权)
V3_6                   = NOT_AUTHORIZED
REMOTE_SYNC            = BEHIND          (本地 main 领先 origin/main=cd7a476 共 5 提交：fa4ea5a/d9e7210/f962c76 + 审计报告 2 提交，未授权 push)
REAL_PROVIDER_SMOKE    = NOT_EXECUTED    (付费 AI 调用未授权)
RESTART_SMOKE          = NOT_EXECUTED    (中断性操作未授权)
```

## 1. 十问回答

| # | 问题 | 结论 | 证据 |
|---|------|------|------|
| 1 | 有无 P0/P1 | **无**（P0=0，P1=0） | 全部对抗测试 fail-closed；见 §6 P2 清单 |
| 2 | 主链可走通 | **是** | 真实任务 Bentgo(4dauumii) 全链实证：browser evidence(confirmed) → review evidence → VOC → AI summary(gate=pass, evidenceRef 14) → researchRecord(creative_ready, revision 1) → researchCompletion(completed) → creative-handoff(revision 2, eligible) → listing-handoff(ready, claimSafe) / image-handoff(ready) |
| 3 | data authority 一致 | **是** | resultJson 单一权威；writer 分层 CAS（browser-evidence / keyword-evidence / legacy-decision / research-decision）；researchRecord revision===events.length 强绑定；storageVersion=resultJsonHash 双重校验 |
| 4 | Evidence→Decision→Research Record→Creative Context→Studio 闭环 | **是** | 4dauumii：decisionStatus=creative_ready → completion=completed → creativeContextSummary（confirmedFacts=3, vocInsights=12, aiReferences=9）→ listing/image handoff 输入含 confirmedFacts（品牌/系列 2 项进 image，3 项进 listing factSummary） |
| 5 | Fact Safety | **通过** | stableSourceFacts 三层规则（identity_only / routing_only / human_confirmation_required_for_claim）；confirmable 8 项全部 humanConfirmationRequired=true 且 usage scope 分层；AI 引用 9 条全部 allowedUse=non_factual_angle；prohibitedClaims=1（claim gate 拦截）；VOC 仅 insight（12 条 strength=weak/isolated）永不自动成事实 |
| 6 | Owner/Visitor 隔离 | **通过** | 双向对抗矩阵全部 fail-closed（见 §4 Security Matrix） |
| 7 | 本地采集真实不假绿 | **通过** | sourcing toolStatus 来自真实 bridge /health 探测（extensionSwVersion=0.3.1, versionCompatible=true）；版本不匹配 → PROTOCOL_MISMATCH 不假绿；preview 不保存；keyword 为 SellerSprite XLSX 真实解析；listing copyReady=false/keywordReady=false 明确显示缺口 |
| 8 | 公网能力边界 | **明确** | Bridge/1688 CLI/浏览器扩展全部本地 loopback（127.0.0.1:53318-53327），公网实例无法访问用户 Windows 资源；服务端 fetch 面仅 127.0.0.1（无任意 URL fetch，无 SSRF/open proxy 面） |
| 9 | 能否正式 CLOSED/APPROVED | **是（本地）** | P0=0 且 P1=0 → V3_PRODUCT_DEVELOPMENT=CLOSED、V3_FINAL_FREEZE=APPROVED |
| 10 | 遗留 | 见 §7 | REMOTE_SYNC=BEHIND；PUBLIC_PREFLIGHT 未授权；P2 ×8（只记录不修） |

## 2. Journey Gate 表（真实用户顺序实证）

| 关卡 | 状态 | 实证 |
|------|------|------|
| 登录（Owner 密码 / Visitor 码） | PASS | POST /api/auth/login 双路径；Visitor 码 SHA-256+salt 哈希存储，无明文 |
| Candidate 列表/详情 | PASS | GET /api/opportunity-candidates（Owner 10 条 / Visitor sandbox 1 条隔离） |
| Candidate → Research（start-research） | PASS | 幂等实证：Bentgo 候选再次 POST → `mode=existing` 同 taskId（不 clone）；幽灵候选 → 404；CAS updateMany 防并发重复 |
| Research Workbench（证据采集） | PASS | browser/review/voc/aiSummary/keyword/competitor/sourcing 端点全部真实返回（空命名空间=真实缺口非假绿） |
| Amazon 页面证据 | PASS | entityBinding.bound=true（urlAsin=pageAsin=targetAsin，三项 proof 全 true）；fields asin/title/bsr/rating/reviewCount=correct；confirmedBy=owner |
| 买家评论 / VOC | PASS | reviewEvidence.dataset.reviews 完整（sourceRef 保留）；VOC 12 条 insight 仅 weak/isolated |
| AI 证据摘要 | PASS | ai-evidence-summary.v1：gateResult=pass，evidenceRefCoverage total=14，inputEvidenceHash 绑定 |
| 人工决定 | PASS | researchDecisionSummary：creative_ready / workflowStatus=completed / revision=1 / fingerprint 绑定；research-decision 读取路径实证：record revision=1 === decisionEvents=1（readOnly=true）；pending 任务 record=null（不误显示已保存） |
| 完成研究 | PASS | researchCompletion：completed / revision=1 / finalStatus=creative_ready（与 record 一致，正交不混淆） |
| 研究记录（/tasks history） | PASS | productResearchSummary（schema=product-research-record.v1, legacy=false） |
| Creative Context | PASS | eligible + 8 confirmable（全需人工确认）+ 3 confirmedFacts + 9 AI 引用（non_factual_angle）+ 7 missing/conflict |
| Fact 人工确认 | PASS | creative-handoff revision 2（bsr=8 确认后）；confirmedFacts=3（brand/series 等）；scope=internal/listing/image 分层 |
| Listing / Image Studio | PASS | listing-handoff：ready/claimSafe=true/copyReady=false（如实缺口）/prohibitedClaims=1；image-handoff：composition_concept，creativeDescriptionContext 仅含已确认事实 2 项 |
| 幂等与 CAS | PASS | storageVersion hash 校验；mutateTaskResultJson writer 分层；快照上限 20 拒绝 409 |

## 3. Authority Matrix（来源真相）

| Truth | 权威载体 | 一致性证据 |
|-------|---------|-----------|
| Candidate 身份 | opportunityCandidate（sourceMetaJson/analysisJson） | start-research 事务内快照进 resultJson（candidateToTask + candidateAnalysisContext） |
| Evidence（browser/review/voc/keyword/competitor/sourcing） | resultJson 各 namespace（writer 分层 CAS） | browser-evidence.v1 / review-evidence.v1 / ai-evidence-summary.v1 实测 schema 完整 |
| 人工决定 | researchRecord（revision===events.length） | productResearchSummary 只认 product-research-record.v1（无 schema → 不显示已保存） |
| 完成标记 | researchCompletion（research-completion.v1） | completed+revision 1+finalStatus=creative_ready（与决定正交） |
| Creative Facts | confirmedFacts（仅 handoff 人工确认写入） | counts：confirmed=3 / confirmable=5（其余全需确认） |
| Creative Context | creativeContextBuilder（纯函数 runtime 投影） | preview 分层不压平：stable/confirmable/aiRefs/missingConflicts 分离 |
| Listing/Image 输入 | listingGenerationInput/imageGenerationInput（handoff 投影） | 实测 input 含 confirmedFacts + NOT FACTS 参考层 |
| 双真相检查 | resultJsonHash（storageVersion） | 各端点返回一致 hash `3cd787bf…948b2`（4dauumii） |

## 4. Security Matrix（对抗实证）

| 场景 | 期望 | 实测 | 结论 |
|------|------|------|------|
| 匿名访问 Owner task detail | 401 | 401 | PASS |
| 伪造 token | 401 | 401 | PASS |
| 有效签名 + 幽灵 demo 主体 | 401 | 401（demo record 不存在 fail-closed） | PASS |
| 过期 token（exp 过去） | 401 | 401 | PASS |
| 篡改 demoAccessId（签名失效） | 401 | 401 | PASS |
| Visitor→Owner task detail/decision/complete | deny 不泄漏 | 404（不泄漏标题/内容） | PASS |
| Visitor→Owner evidence/handoff | deny | 403 demo_action_forbidden（通用文案） | PASS |
| Owner→sandbox task/candidate | deny | 404 | PASS |
| Visitor→自己的 sandbox | allow | 200（列表/详情/写） | PASS |
| Visitor 列表隔离 | 仅见自己的数据 | /tasks 空、/candidates 仅 sandbox 1 条 | PASS |
| 签名密钥 | 不落客户端 | HMAC(ACCESS_PASSWORD) 派生，token 不含密码 | PASS |
| Bridge 绑定 | loopback only | 127.0.0.1:53318-53327，256bit token 内存持有，job 绑定 taskId/candidateId/imageHash | PASS |
| 版本协议 | 不假绿 | Helper SW 0.3.1 不匹配 → PROTOCOL_MISMATCH | PASS |
| SSRF/open proxy | 无 | 服务端 fetch 仅 127.0.0.1（bridge）；外部采集走浏览器扩展 | PASS |
| Prompt injection | 不升级权限 | candidateAnalysisContext 输出带 UNTRUSTED_SOURCE_DATA 围栏 + 禁止执行指令 + productBatch 禁声明规则 | PASS |
| Secret 卫生 | 不泄漏 | .env.local/demo-access.json/demo-sandbox.json/dev.db 均不被 tracked；token 无密码；client DTO 不返回完整 resultJson（投影白名单） | PASS（详见 §7 P2-3/P2-4 工作区卫生建议） |

## 5. Capability Matrix（本地 runtime 实测）

| 能力 | 实现位置 | 实测状态 |
|------|---------|---------|
| SellerSprite XLSX 关键词 | 服务端（parseXlsxWorkbook 真实解析） | 管线完整（preview 不保存 / save 带 CAS） |
| Amazon Browser Evidence | 浏览器扩展采集（collect 端固定 amazon.com） | 实测快照字段 correct；price=selector_not_found（页面结构变化，观察价缺失） |
| VOC / 评论证据 | 浏览器采集 + 服务端分析 | reviewEvidence 完整；VOC 12 条 |
| AI 证据摘要 | 服务端（deepseek-v4-flash，真实调用，付费） | 已有记录 gateResult=pass；本轮未新调用 |
| 1688 图搜/详情 | Bridge + 浏览器扩展（本地 loopback） | toolStatus 真实探测 loggedIn=true / extension 0.3.1 / versionCompatible=true；1688.com 网络可达 200 |
| 人工决定/完成 | 服务端 writer CAS | research_decision_required 409 / need_info 409 / 幂等 idempotent |
| Listing / Image 生成 | 服务端（LISTING_PROVIDER_MODE=real / IMAGE_PROVIDER_MODE=real，付费） | 本轮未调用（NOT_EXECUTED）；输入上下文已实证 |
| 公网能力 | SERVER_CAPABILITY / CLIENT_BROWSER_CAPABILITY / OWNER_LOCAL_CAPABILITY 分层 | 公网实例无法访问用户 Windows Chrome/Bridge/Helper/1688 CLI；本地 Bridge 不会因公网配置 bind 到公网（P0 审查项通过） |

## 6. 发现清单（P2 仅记录，不修复；等待用户单独授权 Final Freeze Correction）

| ISSUE_ID | SEVERITY | SYMPTOM | ROOT_CAUSE | AFFECTED_FLOW | REPRODUCTION | EVIDENCE | FIX_DIRECTION | REGRESSION_RISK |
|----------|----------|---------|------------|---------------|--------------|----------|---------------|-----------------|
| V3F-01 | P2 | task detail API 的 `result.candidateAnalysisContext` 恒为 `{}` | `productResearchPublicDto.ts` DETAIL_FIELDS 投影 spec 用旧字段名（sourceLabel/asin/productUrl），实际 V1 结构为 version/facts/assessment；测试 fixture 用旧结构未覆盖真实结构 | 任务详情页商品身份显示（TaskRecordDetail getProductIdentity）；evidenceCompletion 靠 productName 兜底不受影响 | GET /api/tasks/{id} → result.candidateAnalysisContext={} | 4dauumii/jweu9i74/0bujcawy 等全部为空；publicDto.test.ts:399 用顶层 sourceLabel fixture | 投影 spec 对齐 V1 facts（asin/productUrl/title）或删除该 spec | 低（纯展示投影） |
| V3F-02 | P2 | 任务 nmi837j6（Owala FreeSip VVD）为孤儿任务：resultJson 中 candidateId=59feacbd… 已不在 opportunityCandidate 表 | 候选被删除后任务保留（历史数据状态） | 研究记录/历史详情（数据卫生） | 对比 /api/tasks 与 /api/opportunity-candidates | 11 tasks vs 10 candidates；browser-evidence 返回 candidateId=59feacbd 无对应候选 | 可选：清理或保留并标注 | 低 |
| V3F-03 | P2 | `data/demo-product-batches/demo_67dff45735aee684.json`（1.7MB sandbox 数据）不被 .gitignore 覆盖 | gitignore 仅覆盖 demo-access.json / demo-sandbox.json | git add -A 有误提交风险 | `git check-ignore -v` 无输出 | 未跟踪，但 git status 显示 `??` | 将 data/demo-product-batches/ 加入 .gitignore | 极低 |
| V3F-04 | P2 | `.env.local.bak-corrupt-20260815035552` 含真实密钥且不被 .gitignore 覆盖 | 历史备份文件命名不匹配 `.env*.local` 模式 | 误提交风险（含 DEEPSEEK/OPENAI/PROOF 密钥） | `git check-ignore -v` 无输出 | 未跟踪；17 个键与 .env.local 相同 | 移入 .local-backups/ 或删除 | 极低 |
| V3F-05 | P2 | 工作区存在 0 字节文件 `-` | 疑似历史命令重定向产物 | 仓库卫生 | git status 显示 `?? -` | 2026-08-17 23:15:34 创建 | 删除 | 极低 |
| V3F-06 | P2 | demo 访问 Owner 资源状态码不一致：detail/decision/complete=404，evidence/handoff=403 | 各 route 权限检查顺序不同（先 sandbox 分支再 owner-only vs 直接 owner-only） | 端点枚举轻微差异（无内容泄漏） | demo token 请求不同端点 | 实测 404 vs 403 | 可选：统一为 404 | 低 |
| V3F-07 | P2 | Amazon 观察价提取失败：Bentgo/nmi837j6 的 `fields.price=unknown (selector_not_found)` | Amazon 页面结构变化导致价格 selector 失效 | Observed Price 能力缺口（不影响其他字段与事实链） | browser-evidence 快照 | 实测 price=null；failureReasons=[selector_not_found] | 下次采集时更新 selector | 低（无货币伪装风险：无价格字段） |
| V3F-08 | P2 | 部分 candidate_research 任务 `productUrl` 列为空（Bentgo/THERMOS/John Boos/Owala VVD） | 候选创建时 link 为空且 sourceMeta 无 productUrl（browser evidence 回退到 candidateAnalysisContext.facts.asin 成功，未断链） | 列表/详情 URL 展示 | GET /api/tasks/{id} | productUrl=""；browser-evidence taskAsin 仍正确 | 可选：身份继承从 ASIN 重建 URL | 低 |

## 7. Pending / 未执行项

| 项 | 状态 | 原因 |
|----|------|------|
| REAL_PROVIDER_SMOKE（Listing/Image 真实 AI 生成） | NOT_EXECUTED | LISTING/IMAGE_PROVIDER_MODE=real 为付费调用，审计未获授权 |
| RESTART_SMOKE（3005 重启冒烟） | NOT_EXECUTED | 中断性操作未授权；当前进程健康（health OK）且 runtime=main 已实证 |
| Full test suite / tsc / lint / build | 未全量重跑 | 核心 6 文件 209/209 PASS（本次会话重跑）；known failures 本次会话重新确认（见下） |
| Known failures 重新确认 | 完成 | `native1688Bridge.integration.test.ts`：fail "bridge did not start"（53318 端口被运行中 3005 的 bridge 占用），11 tests skipped —— 环境性失败，与代码无关；`scripts/release-package.test.ts`：fail execFileSync（Windows tar 基线差异），3 tests skipped —— 环境性失败，与代码无关 |
| Planned task | Ready | `schtasks /Query \QingXuanAgent-Local-3005` = Ready；127.0.0.1:3005 由 PID 40508 监听 |
| Decision 读取路径 | PASS | 4dauumii：research-decision 返回 record（revision=1 === decisionEvents=1，readOnly=true，schema=product-research-record.v1，legacy=false）；pending 任务 0eeqmqqj：record=null，readOnly=false（无正式决定不显示已保存） |
| REMOTE_SYNC（push 本地 main） | BEHIND | origin/main=cd7a476（HTTPS ls-remote 实证可达）；本地领先 5 提交（fa4ea5a/d9e7210/f962c76 + 审计报告 f0936d2/0378b2a）；SSH 22 不可达；push 未授权，未改 remote 配置 |
| Public Preflight | NOT_AUTHORIZED | PUBLIC_DEPLOY=FORBIDDEN（审计非部署授权）；V3_6=NOT_AUTHORIZED |
| F5/重登/重开浏览器持久化实证 | 依赖既有交付验证 | Evidence Save/Decision Save/Completion/Fact Confirm/Listing/Image history 的 F5 保留由上一轮 P1 修复交付及 209 项测试覆盖；本轮未重复全量 UI 复测 |

## 8. 结论

- **P0=0、P1=0** → 判定 `V3_FINAL_FREEZE=APPROVED`、`V3_PRODUCT_DEVELOPMENT=CLOSED`（本地）、`LOCAL_RELEASE_CANDIDATE=APPROVED`。
- 主链（Candidate → Research → Evidence → Decision → Record → Creative Context → Studio）以真实任务 4dauumii 全链实证闭环；Fact Safety、Owner/Visitor 隔离、本地采集真实性、公网能力边界四项安全支柱全部对抗通过。
- 8 项 P2 仅记录不修；等待用户单独授权 Final Freeze Correction（如需）。
- 本报告为唯一审计产物；未修改任何业务代码/数据；3005 保持运行。

---

## 9. Release Engineering 追加状态（2026-08-17 发布前收口；不改写上述审计证据）

| 项 | 状态 | 证据 |
|----|------|------|
| RELEASE_HYGIENE | PASS | V3F-03（demo-product-batches 加入 .gitignore，数据保留）、V3F-04（.env.local.bak-corrupt 移至 .local-backups/env-corrupt/2026-08-17T23-48-55/ + gitignore 防线）、V3F-05（删除 0 字节文件）；gitignore 19/19 覆盖验证；untracked surface=0 |
| SECRET_HISTORY_SCAN | CLEAN | DEEPSEEK_API_KEY/OPENAI_API_KEY/PROOF_SIGNING_SECRET：HEAD=0、全历史（783 commits/全 refs）=0；sk- 前缀扫描=0；ACCESS_PASSWORD 唯一命中为 vocAnalysis.test.ts 注入样本（非泄漏，.env.example 无该值） |
| SECRET_ROTATION_REQUIRED | NO | 真实高熵密钥从未进入 Git 历史 |
| FINAL_FULL_REGRESSION | PASS | vitest 4932 passed / 90 skipped；TSC exit 0；LINT 0 errors；BUILD exit 0；release-package.test PR-1 PASS（VR 系列 ENVIRONMENT_SKIP：Windows 无 bash）；native1688Bridge.integration ENVIRONMENT_SKIP（53318 端口被 3005 bridge 占用，端口硬编码无 env 覆盖，已有真实 bridge evidence） |
| RELEASE_TOOLING_FIX | 完成（71d91d9） | package-release.mjs 中文路径 Windows 工作区打包失败（Node→bsdtar 输出路径编码损坏）为真实 release bug；修复：ASCII 临时目录打包+校验+Node fs 复制；修复后真实打包 PASS（release/next-v2.2.16-1fb8af0-linux-x64.tar.gz 1,779,011 bytes，manifest SHA256 记录） |
| RESTART_SMOKE | NOT_EXECUTED | 无业务代码变化（仅 .gitignore/docs/release-tooling），无需重建 3005；中断性操作未授权；3005 持续 health OK |
| REMOTE_SYNC | 见下（push 后回填） | |
| PUBLIC_PREFLIGHT | 见 docs/v3/PUBLIC_DEPLOYMENT_READINESS.md | 17 节只读规划；PUBLIC_DEPLOY=FORBIDDEN |
