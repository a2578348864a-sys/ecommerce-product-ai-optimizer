# 技术架构说明

> 面向公开仓库读者的架构总览。核验基线：`main` @ `cb916688`。

## 1. 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | Next.js 16（App Router，`next build --webpack`） |
| UI | React 19 + TypeScript（strict）+ Tailwind CSS |
| 数据 | Prisma 5 + SQLite（本地单文件库） |
| 测试 | Vitest 4（单元 / 契约 / e2e 分层）+ ESLint 9 + `tsc --noEmit` |
| AI | 服务端 Provider 适配层（真实 Provider 与 Mock Provider 同接口，按模式切换） |
| 本地运行 | 带门禁的本地运行时（`scripts/local-next-runtime.mjs`）+ Windows 计划任务守护 3005 |

## 2. 分层结构

```
app/                    路由层（页面 + API Route Handlers）
  ├─ api/…              服务端契约：鉴权、门禁、配额、错误码
  └─ …/page.tsx         页面（服务端组件为主）
components/             视图层：研究、Listing、Image Studio、证据与复核卡片
lib/
  ├─ server/            服务端能力：AI 门禁、存储、配额、采集编排
  ├─ imageHandoff/      图片链路：输入构建 → 提示词 → Provider → 原子落库
  ├─ listingHandoff/    Listing 链路：事实 → 策略 → 写作 → 校验 → 回退
  └─ client/            客户端状态与草稿恢复
prisma/                 Schema 与迁移（SQLite）
scripts/                本地运行时、门禁、验收脚本
extensions/             浏览器扩展（1688 采集辅助）
tools/ collectors/      离线采集与证据工具
```

## 3. 两条核心 AI 工作流

### 3.1 商品研究主链

```
采集证据 → 结构化 → 事实候选 → 人工确认（Confirmed Facts）→ 研究记录
```

- **门禁优先**：任何进入下游的内容都必须先通过证据与确认门禁。
- **提示词分层**：确认事实 > 商品身份锁定 > 参考门禁 > 业务配方 > 风格预设 > 用户描述 > 负向约束；参考数据以 `NOT FACTS` 显式隔离，避免被模型当作事实。

### 3.2 Image Studio（双链路）

| 链路 | 入口 | 事实来源 | 说明 |
| --- | --- | --- | --- |
| 研究驱动 | `/image-studio?taskId=<任务ID>` | 服务端核验的研究记录 + 已批准参考图 | 浏览器不能自行提交商品事实 |
| 独立工具 | `/image-studio`（无 taskId） | 仅用户创作描述 | 不读取研究事实，纯创作 |

生成链路：**输入构建 → 阶段 A 门禁（事实/参考/用途）→ 阶段 B Provider 调用 → 阶段 C 原子写入候选**，任一步失败都返回分类错误码且不产生半成品记录。

## 4. 关键设计不变量

| 不变量 | 含义 |
| --- | --- |
| 事实唯一权威 | 只有人工确认的事实能进入产物；参考数据永不升级为事实 |
| 人工在环 | 每个写操作与对外产出都保留人工确认边界 |
| 权限服务端校验 | 前端隐藏按钮不构成权限控制；无效/过期/主体不匹配一律 fail-closed |
| 失败可见 | 失败返回分类错误码与可复核的追踪字段，不静默降级 |
| 数据单一来源 | 运行时强制 `DATABASE_URL` 指向仓库内 `prisma/dev.db`；数据存储文件通过硬链接在工作树间共享，避免多副本漂移 |
| 可复现构建 | 构建产物带 BUILD_ID，可用静态资产指纹反查当前服务来源 |

## 5. 本地运行与验证

```bash
npm run check:local     # 运行门禁：SQLite 存在性 + 3005 端口占用检查
npm run start:local     # 生产模式启动（唯一正式入口）
npm run lint            # ESLint
npm test                # Vitest 全量
npm run build           # 生产构建
npm run check           # lint + test + build
```

> 不要使用 `npm run dev` / `next dev` / `next start` 直接占用 3005，以免绕过本地门禁。

## 6. 相关文档

- 当前状态：[PROJECT_STATUS.md](PROJECT_STATUS.md)
- 历史归档：[HISTORY.md](HISTORY.md)
- 认证与配额契约：`docs/architecture/auth-and-quota-contract.md`
- 部署流程：`docs/deployment/production-runbook.md`
