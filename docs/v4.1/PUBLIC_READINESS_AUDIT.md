# 公网发布前独立审计（Formal v2，轮 13）

> 审计人：本会话 Agent（只读）；日期 2026-08-23。范围：当前工作树（HEAD 2d41662 + Formal v2 未提交改动，BUILD_ID H0VBXDbwc6k0P5WKCXK7m）。**本轮不部署公网**。依据按实际代码/契约/实测，不引用历史文档目标当实现。

## 0. 结论

**READY_FOR_PUBLIC_IMPLEMENTATION = NO_GO**

- 公网第一版**架构方案可行**（服务端能力 + 本地助手的职责划分清晰，契约 01/03/04/05/09/10 已冻结、runtimeMode/guestCookie/ipBackstop 已实现、CSRF/Origin 已收紧、guest 默认配额 fail-closed、provider 门禁默认关）。
- **但是**：① 完整公网安全面（public_showcase 全路径）从未在真实环境端到端验证（本机只验证 local_owner）；② 访客演示内容策略（GOLDEN_DEMO 副本）与 Visitor 配额细节需领导授权；③ 域名/HTTPS/部署脚本/备份演练需配置；④ 本地助手通道的公网代实现缺实（无远程 Browser Use 代理）；⑤ 本地 191 dirty 未提交（发布基线不成立）。故 NO_GO，先完成上述授权项与验证再升 READY。

## 1. 17+ 能力覆盖清单（与 PUBLIC_CAPABILITY_MATRIX.md 一致）

- 已核对 21 项（矩阵 #1-21），每项附代码路径与该轮实测（针对关键项：runtime-mode API、guest 铸造、CSRF origin、quota fail-closed、provider 门禁变量、capability DTO、四模块跳转目标）。

## 2. 明确裁决

1. **公网第一版能提供**：首页/候选池/任务详情展示；服务端 AI 研究摘要（配额外）；评论导入与服务端分析（配额外）；Listing/Image（开关+配额+全局 cap）；全部已保存证据（关键词/竞品/Amazon/评论/供应线索）的查看；Owner 认证、访客隔离、配额与成本护栏。
2. **必须隐藏/禁用/引导本地助手的按钮**（本地采集区）：采集页面证据、关键词采集、竞品采集、评论采集、1688 关键词/图搜/详情。当前组件已由服务端 capability.state fail-closed 渲染（CapabilityNotice），**但 public_showcase 下分支未实测**——需在授权切换后复验；保守方案：public_showcase 下这些区域仅展示已保存数据，采集按钮隐藏。
3. **上线前 P0 阻塞**：① public_showcase 端到端安全回归（guest 铸造/CSRF/配额/provider 门禁/访客隔离 403 实证）；② 访客内容策略与配额授权；③ 域名+HTTPS+TLS 证书；④ 服务器数据库迁移/持久化决策；⑤ 备份与回滚演练；⑥ 访客上传安全（存储路径/大小/类型）。
4. **最小部署顺序与回滚点**：本地 build（已产出 BUILD_ID H0VBXDbwc6k0P5WKCXK7m）→ package-release.mjs → scp artifact → 服务器备份 .next → 解压 → pm2 restart → health 200 → 公网 smoke（/、/api/health、guest 铸造、首页渲染）→ 日志观察 24h。回滚：恢复 .next.bak-<ts> + pm2 restart（DB 不触碰）。
5. **需要的授权**：域名/TLS、QX_RUNTIME_MODE=public_showcase 切换窗口、访客演示内容与配额、provider（DeepSeek/OpenAI）预算与开关、上传目录与大小、备份策略、本地助手通道是否部署（若部署则需远程代理设计——本轮不做）。

## 3. 审计必答项证据

- **公网已有**：服务端 AI 摘要（lib/server/aiEvidenceSummary.ts）、comment 导入/分析（review-evidence route）、CSRF/Origin（resolveAccessContext）、guest cookie（guestCookie.ts）、ipBackstop、runtimeMode 契约实现（runtimeMode.ts + route）、provider 门禁（realAiListingGate/realAiImageGate）、配额台账（demoAccess.ts、quota service）。
- **仅本地**：全部实时采集（keyword/competitor/browser-evidence/reviewevid collect/sourcing）+ 1688 + V4 runs（本地运行环境语义）。
- **缺实现**：公网远程本地助手代理通道；结构化监控/告警。
- **需配置**：QX_RUNTIME_MODE、DATABASE_URL、TLS、上传目录、备份、访客配额、provider 开关。
- **需领导授权**：以上全部「需配置」项的决策 + 公网部署本身。

## 4. 审计期间不做、未做

- 未调用任何外部/公网/真实 AI/外部采集；未修改任何 DB/权限/配额/prisma/schema/依赖/配置/.env*；未 Git 写操作；未部署。公网矩阵与审计全部基于本机工作树只读核对 + 本机 3005 local_owner 实例的只读实测（health/runtime-mode/tasks/detail 200；GET 前后 dev.db 哈希不变）。
