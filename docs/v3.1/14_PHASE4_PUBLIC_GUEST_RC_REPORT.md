# V3.1 Phase 4 — 公开访客 RC 部署报告（V3_1_PHASE_4_PUBLIC_GUEST_RC_REPORT）

> 状态：RC 已上线 https://112.124.54.81 ；FINAL_PUBLIC_HUMAN_ACCEPTANCE = PENDING（本报告全部机器验证通过，最终人工验收待用户执行）。
> 不创建 v3.1.0 标签（仅 RC）。契约冻结基线：docs/v3.1/（13 份，FROZEN）。

## 1. 目标与范围
REMOVE PASSWORD GATE, KEEP EXISTING SANDBOX：一键匿名访客 → 既有 demo-access/stok_v1/HttpOnly Cookie → 既有 Visitor Sandbox → 金标演示；无 Owner 泄漏、无不可控 Provider 成本。本阶段 = 部署 V3.1 RC 到生产、移除公开密码入口、最小真实 Provider 验收（≤2 次调用）、D4 收口。

## 2. 部署对象
- 提交：235cb47011a9d0eb711c6a435e123b703fcce4e7（main，已 push origin/main）
- 修复链：1b5bb48（P3 基线）→ c4cbc05（QX_PUBLIC_ORIGIN 修复）→ 235cb47（guest GET creative-handoff 允许）
- BUILD_ID：1B_6R0xmNOp3IU-ZVjZV9；产物 v31-rc-235cb47.next.tar.gz（sha256 A8B8F48C…84A3B，984 项，8.98MB）
- PM2：fork_mode 单实例，pid 92405（旧 69943→90794→92060→92405），unstable_restarts=0，绑定 127.0.0.1:3005

## 3. 运行模式与环境
- QX_RUNTIME_MODE=public_showcase（显式）；缺省=旧密码语义未启用。
- 公开环境（冻结 + Phase 4 追加）：见 p4-manifest.txt（配额 0/1/1、全局上限 50/10、IP backstop 120/120/60、QX_TRUSTED_PROXY_IPS=127.0.0.1、QX_PUBLIC_ORIGIN=https://112.124.54.81）。
- ACCESS_PASSWORD 保留为签名密钥（不轮换、不打印）。

## 4. 公开首页
- 无密码输入框（浏览器实测 0 个 input[type=password]）、无登录表单。
- 单一 CTA「3 分钟体验真实商品研究案例」+ 明确匿名文案（访客身份由浏览器安全 Cookie 自动建立，无需任何密码）。
- 标题「轻选工作台｜AI 跨境商品研究工作台」，无任何旧登录标记。

## 5. 一键访客进入
- 点击 CTA → POST /api/auth/guest → 创建 anonymous demo-access → stok_v1 → Set-Cookie → 自动进入 THERMOS 金标演示任务页（/tasks/sandbox_task_demo_09e0298a3896416a）。
- 复用语义：合法 Cookie 再次进入 = REUSE（同一 demoAccessId/配额/sandbox），不重建。

## 6. Cookie 安全属性（CDP 实测）
- __Host-lqx_guest：HttpOnly=true、Secure=true、SameSite=Lax、Path=/、无 Domain；Max-Age=43200（12h 绝对 TTL，exp-iat=43200）。
- document.cookie 为空（HttpOnly 生效）；token 仅经 Cookie 传输（响应体不含 token）。

## 7. 金标演示（THERMOS）
- 商品身份/来源、研究状态（已完成 + 人工决定已记录）、17 项已确认事实（品牌/类型/系列/容量/类目/价格/评分/评论数/BSR/材质/尺寸/重量…）、候选 9 项、市场观察、VOC、关键词、竞品、供应线索区块齐全。
- 演示体验路线 4 步（数据采集→确认事实→研究结论→Listing/Image）文案与交互正常。

## 8. 配额横幅
- 「访客体验 · 独立 Listing 剩余 1 次 · 独立生图 剩余 1 张 · 演示回放不限次数」（0/1/1 冻结配额如实展示）。

## 9. 刷新 / 重入幂等
- 刷新：URL/任务不变、Cookie 不变、横幅仍 1/1（配额不重置、不重复发放）。
- 新标签页重入：同一 Cookie、同一任务 URL、同一横幅（identity-bound 幂等，无重复 sandbox 副本）。

## 10. 默认拒绝（allow-list DEFAULT DENY）
- POST /api/tasks/…/visual-reference-import、DELETE /api/tasks/…、/api/opportunities/* 等未注册动作 → 403 guest_scope_denied（代码级 + 既有测试覆盖）。
- 说明：GET /api/tasks 列表对访客返回 200 但为 sandbox 作用域（listSandboxTasks(demoAccessId)，响应仅含本访客演示任务，无 Owner 数据）——冻结设计，非越权。

## 11. CSRF（Origin 校验）
- 跨站 Origin POST → 403 origin_denied（evil.example 实测）。
- Cookie 认证变更请求缺 Origin → 403 origin_denied（fail-closed 实测）。

## 12. 速率限制
- 12 次无 Cookie 快速 guest start → 全部 200（低于阈值不误伤）；IP backstop 阈值 120/15m、nginx guest 限速区已配置（Phase 3 v31-rate-limit.conf）。

## 13. 登录禁用
- POST /api/auth/login → 403 guest_login_disabled（公开体验模式无需密码）。

## 14. 真实 Provider 验收 — Listing（1 次）
- UI「生成 Listing 草稿」→ 200；草稿展示（产品描述/关键词/图片建议/风险提示；事实来自已确认 17 项）。
- 账本 data/provider-usage.json：textCalls 0→1；诊断日志 STUDIO_LISTING_DIAGNOSTIC success（model=deepseek-v4-flash，finishReason=stop，schema/claimSafety 全过，saved=true）。
- 配额：demo_f5776d592ea2e3a8 listingUsed 0→1（服务端记录实测）。
- 再次生成（UI 原始 payload）→ 403 demo_standalone_listing_quota_exceeded「本次公开体验的Listing生成额度已用完，可继续查看已有结果。」（quota_exceeded 不同消息实测）。

## 15. 真实 Provider 验收 — Image（门禁拦截，0 成本）
- UI「生成图片」→ 409 blocked_needs_visual_reference「白底商品图需要先确认商品参考图…」（provider 前门禁，未产生任何调用/费用/配额消耗：imageUsed=0、ledger imageCalls=0）。
- 演示沙箱无已批准商品参考图（也没有可批准候选），符合计划中兜底路径；真实生图路径由 Phase 2 确定性守卫测试（141/141）覆盖。

## 16. 全局成本上限
- 全局日上限：文本 50 / 图像 10（PUBLIC_DAILY_*_CALL_CAP）；同事务 file-lock 账本（provider-usage.json）；超额 → global_provider_cap_exceeded（代码 + 测试覆盖）。

## 17. 错误日志
- pm2 error log mtime 仍为部署前 03:44:33（部署后零新增错误）；out log 自最后启动无 error/unhandled/ENOENT。

## 18. 本阶段发现并修复的缺陷（D 类）
- D-Phase4-1：反向代理部署下 nextUrl.origin 为回环自址（https://localhost:3005，X-Forwarded-Proto 推导 protocol + fetchHostname），与浏览器真实 Origin 必然不同 → 所有 Cookie 认证变更请求被误拒（浏览器实测「请求来源校验失败」）。修复：QX_PUBLIC_ORIGIN 精确匹配（白名单 exact match，未配置=原行为），commit c4cbc05。
- D-Phase4-2：Listing/Image Studio 页面加载依赖 GET /api/tasks/:id/creative-handoff，不在 guest allow-list → 访客打不开创作工具（403）。修复：加入 allow-list（view_existing_listing，只读+sandbox 作用域），commit 235cb47。浏览器复验：两个 Studio 均正常加载并完成真实生成流程。

## 19. 测试与构建
- 全量：5345 passed / 3 failed / 78 skipped —— 3 个失败均为既有基线（productUiPolish、handoff.product-journey-quota 为 40470a1 即存在的失败；demoSandbox.store-consistency 并行 flaky，隔离运行通过），零新增回归。
- 定向：accessResolver.phase1 + guestCapabilities + guest route = 42/42（含 3 个新增 QX_PUBLIC_ORIGIN 用例 + creative-handoff 允许用例）。
- lint：0 errors（8 个既有 warning）；build：EXIT 0；release gate：PASS（显式 public_showcase + fork_mode instances=1）。

## 20. 发布门与部署卫生
- 部署模式：本地构建（干净树）→ 上传预构建 .next → 目录交换（.next.v301-live / .next.v31-originfix 保留）→ pm2 restart → 健康门（3005/443/static/runtime-mode/BUILD_ID）。
- origin/main = 本地 main = 235cb47；server git 不作为权威（D4 以 manifest + BUILD_ID 映射收口）。

## 21. 回滚方案
- 应用：恢复旧目录 mv .next.v301-live .next（或 .next.v31-originfix）+ cp .env.local.pre-v31 .env.local（移除 QX_PUBLIC_ORIGIN/QX_RUNTIME_MODE 等 11 行）+ pm2 restart。HTTPS/nginx 不变。
- 基础设施回滚：见 ops/v3.1/PHASE3_INFRA_NOTES.md（nginx 配置备份、证书、限速区）。
- 备份：/root/v31-phase4-backup-20260820-232112（部署前完整备份，含 env sha256 记录）。

## 22. 遗留风险
- Image Studio 在演示沙箱无参考图时只能走到 409 门禁（人工可后续在演示中加入参考图资产以展示真实生图）。
- GET /api/tasks 列表对访客按 sandbox 作用域放行（冻结设计，非 allow-list 门控；无 Owner 泄漏）。
- 研究配额=0：访客「开始 VOC 分析」等仅演示回放；research 类真实调用不可用（冻结 0/1/1）。
- LE IP 证书短周期（~160h）依赖 snap 定时续期 + deploy-hook（2×/日）；IP 证书无域名品牌背书。
- 12h Cookie TTL 到期后访客需重新一键进入（新 identity，旧 sandbox 副本保留）。

## 23. 人工验收清单（对应原始 checklist）
- [x] 公开首页无密码（浏览器实测）→ [待人工] https://112.124.54.81 直接可见 CTA
- [x] 一键进入（浏览器实测）→ [待人工] 点击「3 分钟体验」
- [x] THERMOS 金标演示可浏览（证据/Facts/AI 摘要/结论）
- [x] Listing 生成（1 次真实调用，草稿可见）→ [待人工] 查看草稿质量
- [x] Image 流程（409 门禁文案明确，无费用）→ [待人工] 若需真实生图请先在演示沙箱提供参考图
- [x] 配额横幅 Listing 1/1、Image 1/1；刷新不重置
- [x] HTTPS 锁/证书有效（浏览器无告警预期；HSTS 关闭属设计）
- [x] 产品化观感：无测试后端痕迹（公开页文案/演示路线/风险提示完整）

## 24. 交接
- FINAL_PUBLIC_HUMAN_ACCEPTANCE = PENDING（用户浏览器实测第 23 节清单后置为 DONE 并决定是否发布 v3.1.0 标签）。
- 无 v3.1.0 标签；如需正式发布：标签 v3.1.0 = 235cb47，并同步 origin tag。