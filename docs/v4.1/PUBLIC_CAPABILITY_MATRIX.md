# 公网能力矩阵（Formal v2，轮 13 审计）

> 依据：当前代码（HEAD 2d41662 + 未提交 Formal v2 工作树，BUILD_ID H0VBXDbwc6k0P5WKCXK7m）逐项核对；只读审计，未做任何公网/外部调用。分类：公网已有 / 仅本地 / 缺实现 / 需配置 / 需领导授权。每项附当前代码或契约路径；历史文档目标不作为实现依据。

| # | 能力 | 分类 | 当前代码/契约证据 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | 首页 | 仅本地（页面已存在，公网身份面未开） | app/opportunity-candidates/page.tsx; components/HomeDashboardClient.tsx（轮 7-12 改动） | 页面用 runtime-mode 渲染分支；公网访客身份未开（见 #7） |
| 2 | 候选池 | 仅本地 | components/cross-border/CandidatePoolView.tsx; app/opportunity-candidates/page.tsx | startable/focus 逻辑已实现；数据面依赖 Owner/Visitor 隔离（#7） |
| 3 | 任务详情 | 仅本地（渲染全） | components/TaskRecordDetail.tsx（FormalV2RecordContent + MODULE_EVIDENCE_TARGETS） | 进入需认证；公网展示需 guest（#7） |
| 4 | Owner 操作 | 公网已有（认证面独立） | lib/server/accessPassword.ts resolveAccessContext（5 通道矩阵） | Owner 密码/Header/body 通道独立于 guest；契约 10 后续升级 ACCESS_PASSWORD→签名密钥 |
| 5 | Visitor/guest | 需配置 | app/api/auth/guest/route.ts; lib/server/guestCookie.ts; lib/server/demoAccess.ts | 仅 PUBLIC_SHOWCASE 提供；当前 env 未开（本地 local_owner） |
| 6 | 数据库持久化 | 需配置 | prisma/schema; docs/deployment/production-runbook.md §3（SQLite deploy plan） | 生产 DB 独立于本地 dev.db；artifact 不含 DB；需 DATABASE_URL + migrate deploy 决策 |
| 7 | Cookie/CSRF | 公网已有（基础实现） | lib/server/guestCookie.ts（__Host-lqx_guest）; resolveAccessContext（Origin 校验） | guest cookie HttpOnly/SameSite 见 contract 09；CSRF base 已实现；HTTPS 需 nginx TLS（需配置） |
| 8 | 配额与 Provider 成本 | 需配置 | lib/server/demoAccess.ts（ai_jobs_v1 台账）; lib/server/demoProductJourneyQuota.ts（5 商品名额）; realAiListingGate.ts/realAiImageGate.ts | Visitor 默认 maxAiCalls=0 fail-closed；真实生成需 OPENAI_*_VISITOR_ENABLED=true + 配额显式开 |
| 9 | 文件与图片 | 需配置 | app/api/opportunity-candidates/[id]/image/route.ts（只读主图，证据同源引用）; lib/server/productResearchImage.ts | 上传（XLSX/图片）需 public_showcase 下 scope 控制；本地文件存储路径需持久化卷 |
| 10 | 关键词 | 仅本地（展示已有） | app/api/tasks/[id]/keyword-evidence/route.ts; KeywordReportEvidenceSection.tsx | 本地采集（SellerSprite 插件/CLI 属本地助手）公网仅查看已保存 |
| 11 | 竞品 | 仅本地 | app/api/tasks/[id]/competitor-evidence/route.ts; lib/server/competitorEvidence.ts | 同上；真实 Amazon 采集需本地浏览器 |
| 12 | Amazon 页面（Browser Use） | 仅本地 | app/api/tasks/[id]/browser-evidence/route.ts; BrowserUseCollectButton.tsx | 已保存证据可查看；实时采集需本地 Chrome（采集能力 capability DTO 已 fail-closed） |
| 13 | 评论（VOC） | 仅本地（查看已有/导入服务端） | app/api/tasks/[id]/review-evidence/route.ts; VocEvidenceSection.tsx | 评论导入/分析是服务端能力；自动采集需本地浏览器 |
| 14 | 1688 供应 | 仅本地 | components/cross-border/SourcingEvidencePanel.tsx; lib/server/sourcingAcquisition.ts（实测工具状态） | 1688 登录/CLI/桥均本地；公网仅显示已确认供应线索 |
| 15 | AI 研究摘要 | 公网已有（服务端 provider） | lib/server/aiEvidenceSummary.ts（DeepSeek）; app/api/tasks/[id]/ai-evidence-summary/route.ts | 服务端 AI；Visitor 默认不触发（配额 gate） |
| 16 | Listing | 需配置 | lib/server/listingStudio*.ts; app/api/listing-studio/route.ts; realAiListingGate.ts | 真实生成需 LISTING_PROVIDER 开关 + OPENAI_LISTING_ENABLED/VISITOR；默认 mock/false |
| 17 | Image | 需配置 | lib/server/aiImageDraftService.ts; app/api/image-studio/route.ts; realAiImageGate.ts | 同上（OPENAI_IMAGE_*） |
| 18 | 日志监控 | 缺实现（需配置） | docs/deployment/production-runbook.md | PM2 日志有；结构化监控/告警未实现（记录为需配置） |
| 19 | 备份恢复 | 需配置 | docs/deployment/production-runbook.md; scripts/db/protect-sqlite-db.mjs | 备份脚本存在；服务器侧定时备份/回滚演练需配置 |
| 20 | 域名/HTTPS | 需配置 | docs/deployment/initial-deploy.md（nginx TLS）; production-runbook.md | nginx 1.18 在 80 端口；TLS 证书与域名需用户提供/授权 |
| 21 | 可视化 Graph（V4） | 需配置 | lib/v4/featureFlag.ts; app/api/v4/runs/...（55 文件） | v4GraphEnabled flag 由服务端权威下发；公网展示需 scope 决策 |

## 关键问题裁决（对领导拍板 3 的回答）

- **公网第一版能提供**：完整 Server Capability 集——首页/候选池/任务详情展示、服务端 AI 摘要（配额内）、评论导入与分析、Listing/Image（显式开关+配额+全局 cap）、全部已保存证据的查看、Owner 认证与访客隔离。**不能提供**：任何依赖本机 Chrome/SellerSprite/1688 登录的实时采集（关键词/竞品/Amazon/评论/1688 图搜详情），除非部署「本地助手」通道（当前代码：本地助手通道=Browser Use 本地 spawn，公网代理未实现 → **缺实现**）。
- **必须隐藏/禁用/引导本地助手的按钮**：BrowserUseCollectButton（采集页面证据）、关键词采集、竞品采集、评论采集、1688 全部找货入口——本地 capability fail-closed 已把状态渲染为不可用提示（CapabilityNotice 组件），但需 public_showcase 下复核 UI 分支确实关闭（NEXT 端按钮由 capability.state 决定，服务端 capability 已 fail-closed）。
- **上线前 P0 阻塞**：① QX_RUNTIME_MODE=public_showcase 的全 fail-closed 路径需真实环境验证（当前只 local_owner 验证）；② visitor 默认配额=0 下演示内容的可读性决策（GOLDEN_DEMO 副本）；③ 上传文件存储目录/体积/杀毒；④ HTTPS+域名；⑤ 备份与回滚演练；⑥ 服务器 SQLite 迁移决策（migrate deploy 或 schema 无变化）。
- **最小部署顺序**：本地构建（本轮 BUILD_ID）→ package-release artifact → 服务器解压 .next（备份旧版）→ pm2 restart → health 200 → 公网 smoke（首页/登录/guest）→ 观察日志。回滚点=服务器 .next.bak-<ts> 恢复 + DB 不触碰。授权项：域名/TLS、QX_RUNTIME_MODE 切换、Visitor 配额、provider 开关、备份策略。
