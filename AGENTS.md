# AGENTS.md — 轻选 Agent 代码仓库

> 本文件适用于当前独立 Git 仓库。
> 本文件自包含，不依赖 `../AGENTS.md`、父目录设计文档或其他 Git 根外文件。
> 文中路径均相对于本 Git 根。

## 仓库范围

- 所有代码读取、修改、测试、构建和代码 Git 检查都在本 Git 根内执行。
- 修改前检查 `git status --short`，保留已有未提交和未跟踪内容。
- 不覆盖、移动、删除或格式化当前任务无关的 dirty 文件。
- 不为同步父目录记录而写出 Git 根；需要同步时在最终报告中提供证据。
- 用户从项目父目录明确授权的混合任务，可以由父层协调者分别修改两个仓库；代码部分仍按本文件执行和验证。

## 并行工作树治理

- 当前主检出目录作为集成树：只接收已完成任务、处理合并冲突、运行全量验证和执行经授权的发布准备，不承担普通功能开发。
- UI 常驻工作树只修改展示与交互：`components/**`、非 API 的 `app/**/page.tsx`、`hooks/**`、样式、展示投影及其测试。默认不得修改 `app/api/**`、`lib/server/**`、`prisma/**`、`scripts/**`、`lib/upstream/**` 或 `tools/upstream/**`。
- Pipeline 常驻工作树只修改证据、评分与离线管线：`lib/upstream/**`、`tools/upstream/**` 及其直接测试。默认不得修改页面、权限、数据库或本地运行脚本。
- Backend 工作树仅在存在明确后端任务时按需创建，范围为 `app/api/**`、`lib/server/**`、`scripts/**`；涉及 Prisma、真实数据、权限或配额时仍遵守本文件的受控操作规则。
- Release 工作树仅在阶段收口和部署授权后，从待发布 Commit 临时创建；默认 detached、只读，只做最终验证和发布证据，不在其中修复代码。
- `package.json`、`package-lock.json`、`AGENTS.md`、`tsconfig.json`、`next.config.ts`、`prisma/schema.prisma` 属于集成树共享文件。功能工作树发现必须修改时停止该路径并交给集成任务处理。
- 同一文件同一时间只能有一个写入工作树；工作树按任务使用 `codex/ui-*`、`codex/pipeline-*`、`codex/backend-*` 分支，不把长期角色名当作阶段完成证明。
- 功能工作树只向集成树交付 Commit、验证证据、未覆盖范围和遗留风险；不得互相直接合并，不得自行 Push、部署或更新父目录状态文档。
- 本机 3005、`prisma/dev.db` 和计划任务 `QingXuanAgent-Local-3005` 只由集成树管理。功能工作树不得复制 `.env*`、真实 SQLite 或运行数据，不得启动 `start:local` / `dev:local` 抢占 3005。
- UI 与 Pipeline 工作树必须是当前项目目录下代码仓的直接兄弟目录，使既有 `resolve(process.cwd(), "..")` 只读材料入口继续指向项目根；不得把常驻工作树放到无法访问项目材料的全局路径。
- 功能工作树可用本地 Junction 只读复用集成树的 `node_modules`，但不得在功能树执行依赖安装、升级或删除；依赖变化只允许在集成树按受控操作处理。
- 当前没有独立 UI 浏览器预览入口；UI 工作树可运行定向测试、lint 和 build。未来如需并行浏览器预览，必须单独设计只读 Fixture、独立端口和禁写门禁，不得复用真实 SQLite。

## 稳定产品边界

- 轻选 Agent 是面向跨境电商新手和小团队的受控运营 Agent。
- 核心业务语义是：来源证据和候选输入 → Agent 分析 → 人工复核 → Task 与后续复盘。
- 自动化必须保留人工确认、证据门禁、权限边界和失败路径。
- 不把产品描述为无人值守自动选品、自动采购、自动上架或已验证商业成功。
- 真实销量、成本、物流、费用、利润、合规和经营结果缺少证据时保留为未知，不由 AI 猜测补齐。
- Route、页面名称、Phase、当前状态和易变参数不写入本文件；以当前任务契约、代码和测试核验。

## 权限与数据不变量

内部代码使用 `owner / demo`；产品文案可使用 Owner / Visitor，其中 `demo` 是 Visitor 的兼容命名。

- 受保护操作由服务端 Route 和 Guard 校验；前端隐藏按钮不是权限控制。
- Owner 使用 Prisma 正式业务数据。
- Visitor 只能访问和修改其 `demoAccessId` 对应的 sandbox，不得访问 Owner 正式数据或其他 Visitor 数据。
- Owner 正式路径不得误写入 Visitor sandbox。
- 无效、缺失、停用、过期或主体不匹配的访问必须 fail-closed。
- 保存、修改、删除、导入和 Candidate → Task 等写操作必须保持当前主体与人工确认边界。
- 真实 AI、真实外部来源和付费 Provider 必须经过服务端开关、当前授权和相关安全门禁。
- Visitor AI 调用必须继续经过服务端配额控制；预留、结算、并发、恢复和专项状态码规则按需读取 `docs/AUTH_AND_QUOTA_CONTRACT.md`。
- Route 的 HTTP 状态、业务错误码和响应体属于各 Route 的既有外部契约；不得为了“统一风格”批量改写，变更前按需读取 `docs/AUTH_AND_QUOTA_CONTRACT.md` 并核对对应 Route 和测试。
- `data/demo-access.json`、`data/demo-sandbox.json` 和 `prisma/dev.db` 是受保护运行数据，不得手工编辑、打印、提交或复制到测试夹具。
- 允许读取不含真实秘密的 `data/*.example.json` 以核对字段契约。
- 不为了寻找密钥而批量扫描 `.env*`、凭据目录或配置内容。

## 权威代码入口

- 脚本和依赖：`package.json`
- 数据模型：`prisma/schema.prisma`
- 身份、Session 和签名 Token：
  - `lib/server/accessPassword.ts`
  - `lib/server/accessSession.ts`
  - `lib/server/signedToken.ts`
- Visitor 访问、权限、sandbox 和配额：
  - `lib/server/demoAccess.ts`
  - `lib/server/demoGuard.ts`
  - `lib/server/demoSandbox.ts`
- 真实 AI 门禁：
  - `lib/server/realAiListingGate.ts`
  - `lib/server/realAiImageGate.ts`
- 认证与配额专项契约：`docs/AUTH_AND_QUOTA_CONTRACT.md`
- 部署流程：`docs/PRODUCTION_RUNBOOK.md`

实现现状以当前 Route、Guard、Schema、存储代码和相关测试为准。目标变化以用户当前明确要求或仓库内已批准专项契约为准；实现与目标不一致时报告缺口，不静默改变业务语义。

## 本机启动与验证

本机 3005 使用带 SQLite 门禁的入口：

```bash
npm run check:local
npm run start:local
npm run dev:local
npm run autostart:local
npm run autostart:local:status
```

- 不使用 `npm run start`、`npm run dev`、`next start` 或 `next dev` 代替本机 3005 入口。
- 不修改生产启动命令来解决本地问题。
- 不为运行验证自动安装、删除或升级依赖。
- 本机长期预览由当前用户计划任务 `QingXuanAgent-Local-3005` 管理；登录后立即检查，此后每分钟检查一次，端口为空时后台执行带 SQLite 门禁的 `start:local`。
- 构建或开发模式验收需要临时停止 3005 时，只停止本项目进程；任务结束前必须重新启动该计划任务并验证页面恢复，除非用户明确要求保持关闭。
- `npm run autostart:local:remove` 只用于用户明确要求取消自动启动时。

常规验证命令：

```bash
npm run lint
npm test
npm run build
npm run check
```

## 通用验证矩阵

- 纯文档或注释：检查 Markdown、相对路径、命令和事实一致性。
- 纯函数或局部逻辑：运行直接相关测试；受类型、lint 或共享类型影响时执行对应检查。
- API、权限、数据或外部契约：覆盖目标 Route、Guard、异常路径和受影响消费者；专项矩阵按需读取对应契约。
- UI、路由或状态恢复：运行目标组件或 Route 测试，验证关键错误态和刷新恢复。
- Schema、存储格式或数据语义：未经授权不迁移、不写真实数据；使用隔离 store、临时目录或明确测试数据库。
- 构建、共享模块、运行配置或跨模块修改：运行构建或 `npm run check`，并说明未覆盖范围。
- 无自动测试时，明确说明并提供人工验收步骤。
- 只报告实际运行的命令和结果，不用旧记录代替当前验证。

## 受控操作

以下操作必须获得用户本次明确授权：

- `npm run demo:create`
- `npm run db:backup`
- `npm run db:migrate`
- `npm run db:push`
- 修改 `prisma/schema.prisma`
- 新增、删除或升级依赖
- 真实 AI、付费 Provider、真实外部抓取或第三方写入
- 生产部署或生产配置修改
- Git add、Commit、Push、分支切换或合并

部署任务还必须按需读取 `docs/PRODUCTION_RUNBOOK.md`。
