---
name: sellersprite-market-preview
description: Analyze an official SellerSprite US XLSX export as a local, non-authoritative market prescreen. Use when the user asks to analyze a SellerSprite export, generate a SellerSprite market report, review price, estimated sales, ratings, reviews, or concentration for a keyword, or prepare an opportunity-radar input report. Collect the keyword, category, and USD price band, then invoke the project's existing local CLI. Do not use for other spreadsheets, SellerSprite online services, browser automation, production Candidate writes, formal Stage 1 promotion, supply-chain, profit, logistics, compliance, or Amazon order analysis.
---

# SellerSprite 市场预筛

只编排项目已有 CLI。不要复制或重写 XLSX 解析、字段映射、USD 解析、Brief Hash、投影、统计、Evidence 或 Stage 1 逻辑。

## 必填参数硬门禁

`input`、`query`、`category`、`priceMin`、`priceMax` 任一缺失时，不运行任何命令。

- 多项缺失时，只回复：“请提供 SellerSprite XLSX 文件、分析关键词、类目和目标美元价格范围。”
- 仅缺一项时，只询问该项。
- `category` 始终必填；禁止回复“类目可不填”。
- 不要询问由 CLI 冻结的内部信号、评分或权重。

## 收集输入

取得以下参数后再执行：

- `input`：用户明确提供或选择的 SellerSprite 官方 US XLSX 普通文件。
- `query`：trim 后非空的分析关键词。
- `category`：trim 后非空的用户定义类目或产品方向。
- `priceMin`：有限、非负的 USD 最低价。
- `priceMax`：有限、非负的 USD 最高价，且 `priceMin <= priceMax`。
- `outputDir`：可选的本地输出目录。

只收集以上参数。不要向用户询问 `requiredSignals`、`optionalSignals`、评分权重或其他由 CLI 冻结的内部参数。

不要从文件名、工作簿内容、价格分布或用户目录猜测任何参数。不要扫描目录、自动找文件、复制输入文件或接受 URL。

当前固定为 `amazon.com / US / USD`。用户要求其他站点或币种时停止，并说明 v1 只支持美国站和美元。

## 检查运行条件

从包含本 Skill 的项目 Git 根执行以下检查：

1. 确认 `package.json`、`package-lock.json` 存在，且 `package.json` 包含 `sellersprite:preview` script。
2. 运行 `git merge-base --is-ancestor f079ac0a5a862521d3dadf0b34feee513cac946b HEAD`，确认 CLI Commit 是当前 HEAD 的祖先。
3. 运行 `npx --no-install tsx --version`，只接受项目本地运行器。
4. 运行 `npm run sellersprite:preview -- --help`。
5. 只检查用户给出的 `input` 是否存在、是否为普通 `.xlsx` 文件；不要枚举其父目录。

依赖不可用时，提示用户在项目根按 Lockfile 恢复依赖；不要自行安装、升级或修改依赖，不要使用全局或临时下载的 `tsx`。

不要读取 `.env`、凭据、浏览器数据、账号信息或完整环境变量。

## 安全调用 CLI

使用子进程参数数组传值；不要用 `eval`，不要拼接未经引用的 Shell 字符串，不要允许用户值变成额外参数或命令。

调用既有命令：

```text
npm run sellersprite:preview -- --input INPUT --query QUERY --category CATEGORY --price-min PRICE_MIN --price-max PRICE_MAX --format both
```

用户指定 `outputDir` 时追加：

```text
--output-dir OUTPUT_DIR
```

保留空格、中文和括号等原始参数内容。未指定输出目录时使用 CLI 默认的系统临时目录。不要直接调用底层 TypeScript 函数或测试函数。

每次失败只执行一次。不要用相同参数自动重试，不要绕过 CLI 校验，也不要修改代码来修复本次执行；发现 CLI Bug 时停止并建议另开修复任务。

## 解释退出码

- `0`：帮助或报告成功。
- `2`：参数缺失或非法。指出需修正的参数，不重复执行。
- `3`：输入不存在、不是普通文件或不可读。只显示文件名或必要的简化路径。
- `4`：XLSX 不安全、格式或工作簿结构不支持，或没有可用商品。不要自行解析或绕过门禁。
- `5`：Selection Brief 创建、验证或 Hash 失败。请用户检查关键词、类目和价格范围。
- `6`：输出目录非法、同名文件已存在或写入失败。不要覆盖文件，请用户选择新的空目录。
- `7`：未预期内部错误。只保留错误码和必要摘要，不输出敏感堆栈或环境内容。

## 验证并读取结果

成功后从 CLI 的 `OUTPUT_DIRECTORY` 定位输出。先读取：

- `sellersprite-preview-manifest.json`
- `sellersprite-preview.md`

需要生成结构化摘要时，再按需读取 `sellersprite-preview.json` 的相关字段；不要把完整 JSON 全部放入上下文或回复。

在摘要前确认：

- Manifest 中的 JSON、Markdown 文件名符合合同，并与实际文件一致。
- Manifest 声明 `authoritative=false`、`promotionEligible=false`、`manifestRegistered=false`、`productionEffect=false`、`productionDatabaseWritten=false`。
- JSON 声明 `currentStage1Invoked=false`，且以上安全标志仍为 false。
- Manifest 中的 JSON 和 Markdown SHA-256 与实际文件一致。
- `acceptedRows > 0`。

任一检查不符时停止摘要，报告 `report_contract_mismatch`；不要把结果呈现为成功预筛。

## 输出中文摘要

按以下结构简洁输出：

### 结论

- 说明报告已生成，或 partial 报告已生成。
- 明确这是非权威市场预筛，不是正式选品、采购或上架结论。

### 数据概况

- 原始行、接受行、隔离行。
- Appearance、Product、Family 数量。

### 主要市场信号

- product-weighted 的价格、估算月销量、估算月销售额、评分和评论数中位数。
- 品牌集中度与卖家集中度状态。
- 不要把 appearance-weighted 与 product-weighted 统计混用。

### 筛选结果

- Brief 价格带内商品数量。
- 缺失信号和冲突信号数量。
- `provisionalDisposition` 分布。
- 不要把 provisional 状态改写为正式晋级结论。

### 限制

- 月销量和销售额属于 SellerSprite 第三方估算，不代表 Amazon 后台真实订单。
- 未覆盖合规、侵权、危险品、供应链、采购成本、物流、广告真实转化和真实利润。
- 所有商品 `promotionEligible=false`，需要人工复核。

### 报告位置

- 显示 CLI 返回的实际输出目录。
- 列出 Markdown、JSON 和 Manifest 文件名。

`reportStatus=partial` 时，突出 `rejectedRows`、主要错误码及数量，并说明相关统计可能受影响。`acceptedRows=0` 时不得输出市场结论。

不要输出正式 `advance / watch / reject` 分布，不要推荐立即上架、自动晋级或承诺盈利。

## 保持安全边界

禁止：

- 调用 SellerSprite API、MCP 或其他在线服务。
- 网络抓取、浏览器自动化、自动登录、自动下载或监听文件目录。
- 禁止读取 Cookie、Token、账号、密钥或 `.env`。
- 调用真实 AI。
- 写数据库、Candidate、正式 Manifest 或生产批次。
- 调用正式 Stage 1、自动晋级商品或改变评分规则。
- 修改页面、API、CLI、R2 合同、依赖或 Git 配置。
- 部署、Push 或其他外部写入。

本 Skill 只产生仓库外的本地报告，并向用户返回受限摘要和报告位置。
