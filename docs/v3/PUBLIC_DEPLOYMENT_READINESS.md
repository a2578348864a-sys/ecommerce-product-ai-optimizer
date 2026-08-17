# V3 公网部署 Preflight 报告（Public Deployment Readiness）

- 文档性质：**PRE-FLIGHT（只读规划）**。不是部署授权，不包含任何公网写入操作。
- 执行日期：2026-08-17（+0800）
- 基线：`main` HEAD（含 Final Freeze Audit、Release Hygiene、Release Tooling 修复）
- 状态：`PUBLIC_DEPLOY = FORBIDDEN`（等待用户明确说"可以了，部署公网"）

---

## 1. Current Release State

| 项 | 值 |
|----|----|
| V3_PRODUCT_DEVELOPMENT | CLOSED |
| V3_FINAL_FREEZE | APPROVED（P0=0，P1=0） |
| LOCAL_MAIN_HEAD | 见 `git log`（Final Freeze Audit 后含 hygiene/tooling/docs 提交） |
| LAST_CODE_HEAD | d9e7210（feat: evidence-to-creative context bridge，V3 最终产品代码） |
| 3005 runtime | production `next start`（127.0.0.1:3005），health OK，runtime 含 d9e7210 代码（字段级实证） |
| planned task | QingXuanAgent-Local-3005 = Ready |
| Prisma DB | prisma/dev.db（SQLite，11 tasks / 11 candidates，quick_check=ok，审计备份留存） |
| Release artifact | `node scripts/package-release.mjs` → `release/next-v2.2.16-<sha>-linux-x64.tar.gz`（本轮已实证打包成功） |

## 2. Release Hygiene

| 项 | 处理 | 状态 |
|----|------|------|
| V3F-03 `data/demo-product-batches/`（1.7MB Visitor sandbox 数据） | 确认由 `lib/server/demoProductBatchStore.ts` runtime store 读写、无需 Git tracked；加入 `.gitignore`（未删除数据） | PASS |
| V3F-04 `.env.local.bak-corrupt-*`（含真实 secret） | 确认未 tracked；移至 `.local-backups/env-corrupt/2026-08-17T23-48-55/`；`.gitignore` 增加 `.env.local.bak-*` / `.env.local.bak-corrupt-*` 防线 | PASS |
| V3F-05 0 字节文件 `-` | 确认无用途；已删除 | PASS |
| 工作树 | `git status` 干净（仅 tracked 修改可解释）；untracked surface 为 0 | PASS |
| release/ 输出目录 | `.gitignore` 已覆盖（`release/`） | PASS |

## 3. Secret Scan

| SECRET_TYPE | FOUND_LOCATION | TRACKED? | HISTORY_FOUND? | ACTION |
|-------------|----------------|----------|----------------|--------|
| ACCESS_PASSWORD | 仅 `lib/server/vocAnalysis.test.ts`（prompt-injection 测试注入样本 `"sendSecret":"admin123"`，非凭证用途） | 是（测试 fixture） | 是（同一 fixture，129 commits） | 判定为非泄漏（测试注入样本；.env.example 无该值；全仓库无凭证用途出现） |
| DEEPSEEK_API_KEY | 无 | 否 | **NO（HEAD=0，全历史 783 commits=0）** | 无需轮换 |
| OPENAI_API_KEY | 无 | 否 | **NO（HEAD=0，全历史=0）** | 无需轮换 |
| PROOF_SIGNING_SECRET | 无 | 否 | **NO（HEAD=0，全历史=0）** | 无需轮换 |
| 任意 `sk-` 前缀疑似 key | 无 | 否 | **NO（HEAD=0，全历史=0）** | 无需轮换 |

**结论：SECRET_HISTORY_SCAN = CLEAN；SECRET_ROTATION_REQUIRED = NO。** 扫描方式：真实值经临时文件传给 `git grep -F`（不落盘、不打印、不经命令行）；全 refs 历史（783 commits / 30+ 分支）覆盖。

## 4. Final Regression

| 项 | 结果 | 证据 |
|----|------|------|
| FULL_TEST_SUITE | **PASS（4932 passed / 90 skipped / 2 failed→已处理）** | 427 files passed；2 failed 文件为本轮已修复/环境项（见下） |
| TSC | PASS | `npx tsc --noEmit` exit 0 |
| LINT | PASS | `eslint .` 0 errors / 9 warnings（既有） |
| BUILD | PASS | `next build --webpack` exit 0（新 BUILD_ID 已生成） |
| release-package.test.ts | PASS（PR-1 通过；VR-1/VR-2 ENVIRONMENT_SKIP） | 修复中文路径打包后 PR-1 真实通过；VR 系列依赖 bash（Windows 无 bash，服务器侧脚本不受影响） |
| native1688Bridge.integration.test.ts | ENVIRONMENT_SKIP | "bridge did not start"：53318 端口被运行中 3005 的 bridge 占用；端口常量硬编码（无 env 覆盖），无法独立端口；已有真实 bridge runtime evidence（toolStatus loggedIn=true / extension 0.3.1 / versionCompatible=true） |

**本轮发现并修复的真实 release bug**：`scripts/package-release.mjs` 在中文路径 Windows 工作区无法产出 artifact（Node→Windows bsdtar 参数编码损坏：输出路径 `/d/…中文…` 无法打开）。修复：artifact 先在 ASCII 临时目录打包校验，再用 Node fs 复制到最终目录；tar 参数使用 Windows 原生路径；`rm` 命令改用 Node fs。修复后真实打包 PASS（manifest 含 BUILD_ID/SHA256），测试适配同步。Linux 服务器路径（`/www/alibaba-ai-assistant`）不受影响。

## 5. Remote Sync

| 项 | 状态 |
|----|------|
| LOCAL_MAIN | b0dc5c7（含 Final Freeze Audit + hygiene + tooling fix + 本文档） |
| REMOTE_MAIN（真实远端） | b0dc5c7（`git ls-remote` 实证） |
| AHEAD/BEHIND/DIVERGED | AHEAD=24 / BEHIND=0 / 纯领先（cd7a476 为本地祖先，fast-forward 验证通过） |
| 传输 | SSH 22 可达（`GIT_SSH_COMMAND="ssh -o ConnectTimeout=15 -o BatchMode=yes"`）；push 成功 `cd7a476..b0dc5c7 main -> main` |
| Push 后实证 | REMOTE_MAIN_HEAD == LOCAL_MAIN_HEAD（b0dc5c7）；`git status -sb` 无 ahead/behind |
| 结果 | **REMOTE_SYNC = PASS**（无 force / 无 rewrite / 仅 fast-forward） |

## 6. Public Capability Matrix（三层分类，不假绿）

| 功能 | LOCAL_OWNER | PUBLIC_SERVER | PUBLIC_VISITOR | REQUIRES_LOCAL_CHROME | REQUIRES_HELPER | REQUIRES_CLI | PUBLIC_BEHAVIOR |
|------|-------------|---------------|----------------|----------------------|-----------------|--------------|-----------------|
| SellerSprite XLSX 关键词 | ✔（本地上传解析） | ✔（服务端解析） | ✔（查看已保存） | 否 | 否 | 否 | 解析在服务端，纯 SERVER_CAPABILITY |
| Candidate Pool | ✔ | ✔ | ✔（sandbox 隔离） | 否 | 否 | 否 | SERVER_CAPABILITY；Visitor 仅见自己的 sandbox |
| Research Workbench | ✔ | ✔ | ✔（查看） | 否 | 否 | 否 | 决定/完成等写操作 Owner only |
| Amazon Evidence 查看 | ✔ | ✔（已保存数据） | ✔（已保存数据） | 否 | 否 | 否 | 历史证据从 DB/resultJson 读取，不依赖 Helper 在线 |
| Amazon Realtime Capture | ✔（本地浏览器+Amazon 页面） | ✖ | ✖ | **是** | 否 | 否 | **NOT_AVAILABLE_IN_PUBLIC_DEMO**（无 Local Agent 通道；不假 READY） |
| VOC / 评论证据 | ✔ | ✔（已保存） | ✔（已保存） | 采集需本地浏览器 | 否 | 否 | 历史数据可读；新采集本地 |
| AI Evidence Summary | ✔（服务端 provider） | ✔ | ✔（已保存；新调用受配额） | 否 | 否 | 否 | SERVER_CAPABILITY（DeepSeek）；Visitor 默认不可触发 |
| 1688 Keyword | ✔（CLI） | ✖ | ✖ | 否 | 否 | **是** | **PUBLIC_REALTIME_1688 = LOCAL_OWNER_ONLY**；公网 UI 显示不可用（fail-closed） |
| 1688 Image（图搜） | ✔（Bridge+Helper） | ✖ | ✖ | **是** | **是** | 否 | 同上 |
| 1688 Detail | ✔（CLI/Bridge） | ✖ | ✖ | **是** | **是** | **是** | 同上 |
| Human Decision | ✔ | ✔ | ✖（写） | 否 | 否 | 否 | Owner only 写；Visitor 只读记录 |
| Research Completion | ✔ | ✔ | ✖（写） | 否 | 否 | 否 | Owner only |
| Research History | ✔ | ✔ | ✔（sandbox 内） | 否 | 否 | 否 | SERVER_CAPABILITY |
| Creative Context | ✔ | ✔ | ✔（查看） | 否 | 否 | 否 | 已保存 handoff 数据可读 |
| Listing Studio | ✔（provider=real/mock） | ✔（需 env+quota） | ✖（默认） | 否 | 否 | 否 | 真实生成需 OPENAI_LISTING_ENABLED/VISITOR 开关；Visitor 触发需显式开启 + 配额 |
| Image Studio | ✔（provider=real/mock） | ✔（需 env+quota） | ✖（默认） | 否 | 否 | 否 | 同上（OPENAI_IMAGE_* + visitor gate + demoAccess 配额） |

## 7. Owner Local Capability

- 完整研究链路（采集→证据→AI→决定→完成→创作），依赖本地：浏览器（Amazon 页面采集）、1688 CLI 登录态、Qingxuan 1688 Helper 扩展（0.3.1）+ Authenticated Loopback Bridge（127.0.0.1:53318-53327）。
- 工具状态全部真实探测（bridge `/health`），版本不匹配显示 HELPER_OUTDATED，不假绿。

## 8. Visitor Capability

- 能：打开工作台、理解产品、查看真实 Demo 数据（Research/Evidence/AI Summary/Decision/Research Record/Creative Context/Listing/Image 成果）。
- 能（sandbox 内）：创建/查看自己的 sandbox 候选与研究任务。
- 不能：访问 Owner 正式数据（404/403 fail-closed 实证）、写 Owner 任务、触发真实 AI 生成（默认 gate 关闭）、使用本地采集工具。
- 角色复用现有 Owner/Visitor，不新增 Role。

## 9. Environment Matrix（不输出值）

| ENV_NAME | PURPOSE | PUBLIC_REQUIRED? | OWNER_LOCAL_ONLY? | SECRET? |
|----------|---------|------------------|-------------------|---------|
| ACCESS_PASSWORD | 登录密码（Owner/Worker 认证 + token 签名派生） | 是 | 否 | 是 |
| PROOF_SIGNING_SECRET | 签名密钥（production 下缺失即 fail-closed） | 是 | 否 | 是 |
| DEEPSEEK_API_KEY | AI Evidence Summary provider | 是（若启用 AI 摘要） | 否 | 是 |
| OPENAI_API_KEY | Listing/Image 真实生成 provider | 是（若启用 Studio 生成） | 否 | 是 |
| DATABASE_URL | Prisma SQLite 持久化路径（production 必须显式指向持久化目录） | 是 | 否 | 否 |
| DEEPSEEK_BASE_URL / DEEPSEEK_MODEL | provider 配置 | 按需 | 否 | 否 |
| OPENAI_IMAGE_BASE_URL / MODEL / TIMEOUT_MS / RESULT_HOSTS / BASE_HOSTS | image provider 配置与结果域白名单 | 按需 | 否 | 否 |
| LISTING_PROVIDER_MODE / IMAGE_PROVIDER_MODE | real/mock 开关 | 是（明确选择） | 否 | 否 |
| OPENAI_LISTING_ENABLED / OPENAI_LISTING_VISITOR_ENABLED | 真实生成 gate（默认关闭） | 按需（默认 false） | 否 | 否 |
| OPENAI_IMAGE_GENERATION_ENABLED / OPENAI_IMAGE_VISITOR_ENABLED | 同上 | 按需（默认 false） | 否 | 否 |
| AI_IMAGE_DRAFT_STORAGE_ROOT / DEMO_ACCESS_STORE_PATH / DEMO_SANDBOX_STORE_PATH / DEMO_PRODUCT_BATCH_STORE_ROOT / STUDIO_*_STORE_ROOT / AI_IMAGE_DRAFT_LEDGER_PATH | 运行时数据目录（默认 `data/` 下；公网应显式指向持久化卷） | 按需（建议显式） | 否 | 否 |
| NODE_ENV | production | 是 | 否 | 否 |
| ENABLE_AI_DIAGNOSTICS | 诊断 | 否 | 可 | 否 |
| SELLERSPRITE_XLSX_* | 测试样本路径 | 否 | 是 | 否 |
| 1688 CLI / bridge / Chrome profile / Helper 配置 | 本地采集工具 | **否** | **是** | 否 |

**Local-only env 不进入公网服务器 REQUIRED 清单**（1688 CLI path、bridge 端口/token、Chrome profile 等）。

## 10. SQLite Deployment Plan

- 现状：`prisma/dev.db`（SQLite，本地）。公网服务器已有独立运行数据（`/www/alibaba-ai-assistant` 部署历史）。
- 部署方式：本地 `npm run build` → `node scripts/package-release.mjs` → artifact **只含 `.next/`**（不含 dev.db/.env/node_modules）→ 服务器解压替换 `.next`。
- **Release 不会覆盖公网 DB**：artifact 不含数据库文件；runbook 明确禁止上传本地数据库；`prisma/dev.db` 在 `.gitignore`，永不进入 artifact/仓库。
- 生产 DB 位置：持久化目录（建议独立于 release 目录，如 `/www/alibaba-ai-assistant/data/` 或显式 DATABASE_URL 指向的卷），首次部署 `prisma migrate deploy`（无 schema 变化时跳过），后续 `db:backup`（`scripts/db/protect-sqlite-db.mjs`）定时备份。
- 备份/回滚：`npm run db:backup`（本地）；服务器侧备份脚本/快照；回滚时 **代码回滚与 DB 回滚分离**（见 §14）。
- 文件权限：服务器 DB 目录建议仅运行用户可读写（`chmod 600` 级），不暴露公网。

## 11. Nginx / Process Plan

- 现状（runbook）：公网 IP 112.124.54.81；Nginx 反代 → `127.0.0.1:3005`；PM2 服务名 `alibaba-ai-assistant`；3005 仅监听 loopback。
- 部署计划检查点（部署阶段执行，本轮不修改）：
  - domain/IP + port：沿用现有配置或按用户新域名调整
  - proxy target：127.0.0.1:3005
  - headers：Host/X-Forwarded-* 透传；body limits（图片上传 30MB 级，需大于 artifact/上传限制）；timeouts（AI 生成长请求需合理超时）
  - WebSocket：当前无强制需求（轮询/普通请求为主；确认 Studio 无 ws 依赖）
  - static files：Next.js 自托管（.next/static 由应用提供）
- 进程：PM2 管理，`pm2 restart alibaba-ai-assistant`；启动 `next start -H 127.0.0.1 -p 3005`。

## 12. Security

| 域 | 结论 | 证据 |
|----|------|------|
| Auth | Owner 密码 / Visitor 码双路径；signed token（HMAC(ACCESS_PASSWORD)）12h TTL；token 存 sessionStorage（非 cookie、非 localStorage） | accessPassword.ts / signedToken.ts / accessToken.ts |
| Cookie | 无认证 cookie → 无 Secure/HttpOnly/SameSite 配置面；HTTPS 由 Nginx TLS 提供 | 全仓库无 document.cookie 认证 |
| Secret | 服务端 env 持有；不进 client bundle/Visitor DTO/日志/报告；secret history CLEAN | 本轮 Secret Scan |
| Bridge | 常量 127.0.0.1（无 env 覆盖，部署无法改 bind）；256bit token 内存持有；job 绑定 taskId/candidateId/imageHash；版本不匹配 HELPER_OUTDATED | native1688BridgeClient.ts |
| SSRF | 服务端 fetch 面仅 127.0.0.1（bridge）；无任意 URL fetch / image proxy / open proxy；external 采集走浏览器扩展 | 全库 fetch 扫描 + ssrfGuard |
| Visitor Quota | 真实生成默认关闭（OPENAI_*_VISITOR_ENABLED ≠ true）；demoAccess quota ledger（预留/结算/恢复）与 standalone Studio 配额；公开 Visitor code 无法无限消耗付费 API | realAiListingGate / realAiImageGate / demoAccess.ts |
| Prompt Injection | 外部文本 UNTRUSTED_SOURCE_DATA 围栏；禁止执行指令/升级权限/读 secret/跨 task；Fact Authority 不受外部文本影响 | candidateAnalysisContext.ts / Final Audit |
| Wrong Entity | entityBinding 校验（urlAsin=pageAsin=targetAsin）；非目标实体零投影 | browserEvidence.ts / projection tests |
| DB | artifact 不含 DB；DB 独立持久化；备份/回滚分离 | §10 / runbook |

## 13. Demo Data Plan（只规划，不清理）

- 建议公网 Demo 数据：**THERMOS（0bujcawy）与 Bentgo（4dauumii）** 等资料完整的真实研究记录（含 browser evidence / VOC / AI summary / decision / completion / creative context / listing/image 成果）。
- 排除：合成验收商品（台灯/车载手机支架）、乱码或测试垃圾任务、孤儿任务（nmi837j6 关联候选已删）不出现在公网推荐列表。
- 隐私：已确认 Demo 记录不含个人信息/私有账号/Cookie/本地路径/内部 token/API key/真实登录信息（evidence 仅公开 Amazon 数据 + 分析结果）。
- 部署阶段创建 Visitor 演示码（`npm run demo:create`，受控操作），maxAiCalls 按预算设定。

## 14. Rollback Plan

| 层 | 回滚方式 |
|----|---------|
| CODE_ROLLBACK | 服务器保留 `.next.bak-<ts>`（runbook 流程自带）；回滚=恢复旧 `.next` + `pm2 restart`；或重传上一个 artifact |
| DB_ROLLBACK | 与代码回滚**分离**：`scripts/db/protect-sqlite-db.mjs`（backup/predeploy/postdeploy）+ 服务器 DB 文件备份；回滚 DB 不触碰代码目录 |
| NGINX_ROLLBACK | 修改前备份配置；回滚=恢复配置 + reload |
| PROCESS_ROLLBACK | `pm2 restart` / `pm2 reload` 到已知良好版本；PM2 日志可查 |

铁律：代码 rollback 顺带覆盖数据库 = 禁止。

## 15. Public Smoke Plan（部署后执行，本轮不执行）

- HTTPS 可达、证书有效
- Visitor 登录 → 首页 → Candidate/Research → 打开完成研究 → Evidence → AI Summary → Decision → Creative Context → Listing → Image
- 历史数据查看不依赖 Helper（预检通过）
- 实时采集入口显示"本地研究环境使用"（不假绿）
- console 无 Runtime Error；network 无意外 4xx/5xx
- 移动端基础适配
- Visitor quota 生效（无法无限生成）
- Owner 登录不受影响（正式数据隔离）

## 16. Blockers

- Release blockers：无（hygiene PASS / regression PASS / secret CLEAN / tooling 修复完成 / remote sync PASS）。
- Remote Sync：PASS（§5 实证）。
- Public blockers：**0**。逐项核查（§58 清单）：secret/history CLEAN；remote 已同步；build PASS；auth 为 sessionStorage token + HTTPS 计划（无 cookie 面）；visitor 生成默认 gate 关闭 + quota ledger（无法无限烧付费 API）；DB 持久化/备份/回滚分离（artifact 不含 DB）；Bridge 常量 loopback（部署无法暴露）；Public UI 工具状态 fail-closed（代码级证据：`sourcingCapabilities(null)` → 全部 false、版本不匹配 HELPER_OUTDATED；部署后 smoke 复验 §15）；必需 env 清单已给出（部署执行项）；已保存 Evidence 从 DB 读取不依赖 Helper；四层回滚方案可执行。
- 明确**不计入** blocker：Amazon price selector unknown（fail-closed）、P2 文案项、孤儿历史任务。

## 17. Final Readiness

- `PUBLIC_PREFLIGHT_BLOCKERS = 0`
- `PUBLIC_DEPLOYMENT_READINESS = READY_FOR_DEPLOY_AUTHORIZATION`
- `PUBLIC_DEPLOY = FORBIDDEN`（等待用户明确授权："可以了，部署公网"）
- `V3_6 = NOT_AUTHORIZED`
- 下一步：用户授权后按 runbook（docs/deployment/production-runbook.md）执行：build → package-release → artifact 上传 → 解压替换 .next（备份旧版）→ pm2 restart → 本机+公网验收 → 按 §15 Public Smoke Plan 验收。

---

## 18. Deployment Execution Record（2026-08-18 00:12 +0800，用户已授权"可以了，部署公网"）

| 项 | 值 |
|----|----|
| 部署对象 | 112.124.54.81（iZbp1cvdvghmferp57a3tzZ）/ `/www/alibaba-ai-assistant` / pm2 `alibaba-ai-assistant` |
| Artifact | `release/next-v2.2.16-85d5454-linux-x64.tar.gz`（1,779,831 bytes） |
| Artifact SHA256 | `e0caa95a3d9bc2c682288a75945e1daff6214e1ee2061a8390fc42e58069cf12` |
| BUILD_ID | `qXZraBGJPqPX4aRP_rsGG`（与本地 main 85d5454 构建一致） |
| 部署前服务器状态 | 旧版运行中（BUILD_ID 7ndpOyntWBlB1NLbNr4tR，uptime 5D）；服务器 git 存在 5 个 listing 模块未提交修改——已比对确认其内容与本地 main 一致（3 文件仅 BOM 差异；2 文件为本地 main 的 V3 creativeContext 超集），替换不丢失任何服务器独有逻辑 |
| .next 备份 | `.next.bak-20260818-001207`（服务器保留） |
| Env 变更 | 服务器 .env 补充 `PROOF_SIGNING_SECRET`（此前缺失，V3 新增；值经 SSH 通道 scp 临时文件追加，未打印、临时文件已删除）——现 17 键与本地一致 |
| PM2 | restart 成功（PID 49076，status online，restart count 81） |
| 健康检查 | 服务器本地 `127.0.0.1:3005/api/health` = `{"ok":true}`；公网 `/api/health` = 200 |
| 公网页面验收 | `/`=200、`/tasks`=200、`/opportunities`=200、`/research`=200、`/workflow`=200 |
| 公网 Auth 验证 | 匿名访问 `/api/tasks`、`/api/opportunity-candidates`、`/api/tasks/abc123` 均 401（auth 生效） |
| DB | 无 schema/migration 变化，未迁移；服务器 DB 独立（prisma/），release 未触碰 |
| 本地 3005 | 不受影响，health OK 持续运行 |
| 后续事项 | §15 Public Smoke（HTTPS/Visitor 登录/Demo 数据/Studio 等）待用户安排执行；PROOF_SIGNING_SECRET 与本地一致，如需独立密钥可在后续轮换 |
