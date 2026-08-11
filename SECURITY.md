# Security Policy

## 报告安全漏洞

**不要**在公开 Issue 中报告安全漏洞。

请通过 GitHub Private Vulnerability Reporting（仓库 Settings → Security）或直接联系维护者提交。

## 安全原则

### Secret 永不入库

- 真实 API Key、访问密码、令牌、私钥**永不提交**到版本库
- 环境变量只通过 `.env.local` 提供；`.env.example` 中仅保留占位符
- `data/demo-access.json`、`data/demo-sandbox.json`、`prisma/*.db` 为运行数据，禁止提交

### AI 输出不是可信输入

- 来自 AI Provider 的输出可能包含虚构、误导或注入内容
- AI 输出在进入持久化或创作输入前必须经过校验与人工确认
- 未确认事实不得进入权威创作输入（Creative Handoff 契约）

### 文件上传安全边界

- XLSX 导入执行格式、结构与内容校验，未知格式拒绝
- 外部图片下载实施域名白名单、公网 IP 校验、格式与大小限制
- 上传与下载产物存放在隔离目录

### Prompt Injection 隔离

- 来自外部来源（XLSX 单元格、图片 URL、页面内容）的文本不视为指令
- 外部文本仅作为数据处理，不进入系统提示词或控制流

### 认证与数据隔离

- Owner / Visitor 身份由服务端校验，前端隐藏不构成鉴权
- Visitor 数据沙箱隔离，不得访问 Owner 数据或其他 Visitor 数据
- 无效、缺失、停用、过期或主体不匹配的访问一律 fail-closed

### 生产环境

- 生产数据库、服务器、PM2 配置只由授权部署流程管理
- 部署前备份数据库；变更可回滚
