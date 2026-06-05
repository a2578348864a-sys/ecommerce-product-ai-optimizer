# 阿里国际站选品发布 AI 助手 Pro

这是一个部署到 Vercel 的 Next.js 外贸选品与发布辅助工具。用户输入产品信息后，系统通过服务端 API 调用 DeepSeek / OpenAI，进行选品初筛、发布优化和询盘转化辅助。

## 项目特点

- 使用 Next.js App Router、TypeScript、Tailwind CSS
- 使用 OpenAI 官方 JavaScript SDK
- API Key 只保存在服务端环境变量中，不会暴露给前端
- 无数据库、无登录系统，适合作为轻量 MVP 上线
- 访问密码保护生成接口，避免别人随意消耗你的 API 额度

## 核心功能

1. **选品初筛**：产品机会评分（0-100分）、8维度评分明细（市场需求/竞争强度/利润空间/物流难度/认证合规/B2B适配度/差异化/新手难度）、置信度判断、高风险标注
2. **发布优化**：阿里国际站英文标题、核心关键词、长尾关键词、产品详情页英文文案
3. **询盘转化**：8个询盘回复模板（首次询价/MOQ/样品费/OEM-ODM/价格异议/交期/运费/跟进）

## 数据安全原则

- AI 不做凭空判断，所有选品结论基于用户输入的数据
- 数据不足时输出缺失数据和置信度（low/medium/high）
- 不允许承诺销量、排名、爆单
- 必须提示"当前数据不足，只能做初步判断"

## 表单字段

表单采用**基础模式 + 专业模式**设计：
- 基础模式：8 个必填核心字段（产品中文名称、类别、材质、核心卖点、成本、售价、MOQ、目标国家/地区）
- 专业模式：展开后可补充 23 个可选字段（规格尺寸、重量、体积、认证信息、竞品信息等）

## 最简单启动流程

1. 打开 `.env.local`。
2. 填入你自己的 API Key。
3. 终端运行：
```bash
npm run dev
```
4. 打开 `http://localhost:3000`。
5. 输入访问密码（默认 `888888`）。
6. 点击"填入示例"，再点击"开始分析"。

## 本地运行步骤

1. 安装依赖：
```bash
npm install
```

2. 如果没有 `.env.local`，复制环境变量文件：
```powershell
Copy-Item .env.example .env.local
```

3. 打开 `.env.local`，填写你的环境变量：
```env
AI_PROVIDER=deepseek

OPENAI_API_KEY=你的 OpenAI API Key
OPENAI_MODEL=gpt-5.5

DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

ACCESS_PASSWORD=888888
```

4. 启动本地开发服务：
```bash
npm run dev
```

5. 打开浏览器访问：
```text
http://localhost:3000
```

## 健康检查

打开：
```text
http://localhost:3000/api/health
```

确认：
- `hasAccessPassword` 是 `true`
- 对应的 API Key 环境变量是 `true`

## Vercel 部署步骤

1. 将代码推送到 GitHub。
2. 打开 Vercel，点击 `Add New Project`。
3. 选择你的 GitHub 仓库。
4. 进入项目设置的环境变量，添加：
```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的 DeepSeek API Key
ACCESS_PASSWORD=888888
```
5. 点击 `Deploy`。

## 常见问题

### 访问密码错误
重新输入密码，注意不要有多余空格。

### 生成失败
常见原因：API Key 不正确、模型名称不可用、账号余额不足、网络异常。

### 数据不足提示
如果只填基础信息，AI 会给出 low 置信度和数据不足提示，属于正常行为。

## 安全注意事项

- 不要将 `.env.local` 上传到 GitHub
- 不要把真实 API Key 写进任何代码
- 不要使用 `NEXT_PUBLIC_` 前缀的 API Key 变量
- AI 生成内容仅供选品初筛参考，不构成销售承诺
