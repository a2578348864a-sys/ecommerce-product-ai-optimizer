# 本地开发与贡献指南 (Local Development Guide)

本文档旨在帮助开发者在本地机器快速搭建、运行、调试与验证轻选工作台源码。

---

## 1. 环境准备 (Prerequisites)

在开始之前，请确保本地开发机已安装以下环境：

- **Node.js**: `≥ 20.9.0` (推荐 LTS 20.x 或 22.x)
- **npm**: `≥ 10.0.0`
- **Git**: 最新稳定版
- **操作系统**: macOS, Linux, 或 Windows 10/11 (PowerShell / WSL2)

---

## 2. 克隆与依赖安装 (Setup)

```bash
# 1. 克隆仓库源码
git clone https://github.com/a2578348864a-sys/ecommerce-product-ai-optimizer.git
cd ecommerce-product-ai-optimizer

# 2. 安装项目依赖
npm install

# 3. 初始化本地 SQLite 数据库与生成 Prisma Client
npx prisma generate
npx prisma db push
```

---

## 3. 环境变量配置 (Environment Configuration)

复制基础环境变量配置文件：

```bash
cp .env.example .env.local
```

### 核心环境变量说明

| 变量名 | 默认值 / 示例 | 类型 | 说明 |
| :--- | :--- | :--- | :--- |
| `QX_RUNTIME_MODE` | `local_owner` | 必填 | 运行模式：`local_owner`（本地操盘免密完整模式）或 `public_showcase`（公网安全沙箱） |
| `DATABASE_URL` | `"file:./dev.db"` | 必填 | SQLite 数据库文件路径 |
| `LISTING_PROVIDER_MODE` | `mock` | 可选 | Listing 生成模式：`mock`（免 Key 体验确定性闭环）或 `real`（调用真实大模型） |
| `IMAGE_PROVIDER_MODE` | `mock` | 可选 | 视觉工坊模式：`mock` 或 `real` |
| `AI_PROVIDER` | `deepseek` | 可选 | 当使用真实大模型时指定提供商：`deepseek` 或 `openai` |
| `DEEPSEEK_API_KEY` | 留空或填写密钥 | 条件必填 | 仅在 `AI_PROVIDER=deepseek` 且 `PROVIDER_MODE=real` 时需要 |
| `OPENAI_API_KEY` | 留空或填写密钥 | 条件必填 | 仅在 `AI_PROVIDER=openai` 且 `PROVIDER_MODE=real` 时需要 |
| `ACCESS_PASSWORD` | 随机字符串 | 可选 | 仅在非 `local_owner` 模式或需启用密码访问门禁时生效 |
| `BROWSER_USE_CLI_PATH` | 留空或可执行文件路径 | 可选 | Browser Use 已加入系统 PATH 时可留空；否则填写 `browser-use` 可执行文件路径；未配置且 PATH 中不可用时，采集会明确返回不可用，不会伪造结果 |

> 💡 **提示**：系统默认以 `mock` 模式启动，无需任何外部大模型 API Key 即可完整体验选品研究、事实核准、Listing 生成与质检全流程。

Browser Use 是本机 SellerSprite 关键词/竞品采集的可选外部 CLI。系统优先使用 `BROWSER_USE_CLI_PATH`，未配置时从系统 PATH 查找 `browser-use`（Windows 会按 `.exe` 解析）。找不到 CLI 时保持 fail-closed，并提示配置环境变量或安装 PATH 命令。

---

## 4. 启动本地服务 (Running the Application)

系统提供带有环境与数据库门禁自检的启动脚本：

```bash
# 1. 预先健康检查 (验证端口与 SQLite 就绪状态，不启动服务)
npm run check:local

# 2. 启动本地开发服务器 (推荐：带环境门禁保护与热重载)
npm run dev:local

# 3. 启动本地生产环境服务器
npm run start:local
```

启动完成后，终端将输出本地监听地址。在浏览器中打开：
```text
http://localhost:<PORT>
```
（具体端口号以启动脚本或环境变量 `PORT` 指定为准）。

---

## 5. 质量校验与自动化测试 (Testing & Verification)

轻选工作台拥有超过 6,700 项自动化测试，提交修改前必须确保本地检查全绿：

### 5.1 运行单元与集成测试套件 (Vitest)
```bash
# 运行全量自动化测试
npm run test

# 运行特定模块测试 (例如 Listing 质量策略)
npx vitest run lib/listingHandoff/listingQualityPolicy.test.ts
```

### 5.2 TypeScript 源码类型检查
```bash
# 全库严格模式类型检查
npx tsc --noEmit
```

### 5.3 ESLint 静态代码分析
```bash
# 执行代码规范检查
npm run lint
```

### 5.4 生产打包验证 (Production Build)
```bash
# 验证 Next.js 生产环境打包能否正常通过
npm run build
```

---

## 6. 代码贡献与修改规范 (Code Conventions)

1. **事实与证据边界不可破坏**：严禁在未经过人工确认的情况下将外部字段标记为事实，严禁绕过 `ConfirmedFacts` 直接调用生成引擎；
2. **严守 Fail-Closed 机制**：对任何外部网络采集、解析错误、风控拦截必须显式返回错误状态，严禁吞咽异常或伪造虚假通过数据；
3. **保持测试覆盖**：新增业务逻辑或修复缺陷必须附带对应的 `.test.ts` 测试用例，确保无回归风险；
4. **安全脱敏原则**：任何涉及本地开发机绝对路径、私有端口、密钥 Token 的信息一律禁止提交到代码库或静态文档中。
