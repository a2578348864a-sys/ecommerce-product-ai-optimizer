# 阿里国际站选品发布 AI 助手 Pro

这是一个可部署到国内云服务器或 Vercel 的 Next.js 外贸选品与发布辅助工具。用户输入产品信息后，系统通过服务端 API 调用 DeepSeek / OpenAI，进行选品初筛、发布优化和询盘转化辅助。

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
npm run dev -- -p 3005
```
4. 打开 `http://localhost:3005`。
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
APP_ACCESS_PASSWORD=888888
```

4. 启动本地开发服务。本项目为了和服务器测试一致，统一使用 `3005` 端口：
```bash
npm run dev -- -p 3005
```

5. 打开浏览器访问：
```text
http://localhost:3005
```

## 健康检查

打开：
```text
http://localhost:3005/api/health
```

确认：
- `hasAccessPassword` 是 `true`
- 对应的 API Key 环境变量是 `true`

## Vercel 部署步骤

Vercel 适合快速测试、预览和海外访问。如果网站主要面向国内用户，正式访问建议部署到阿里云或腾讯云轻量应用服务器，并按需配置备案、域名和 HTTPS。

1. 将代码推送到 GitHub。
2. 打开 Vercel，点击 `Add New Project`。
3. 选择你的 GitHub 仓库。
4. 进入项目设置的环境变量，添加：
```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
ACCESS_PASSWORD=888888
APP_ACCESS_PASSWORD=888888
```
5. 点击 `Deploy`。

## 国内服务器部署建议

适用目标：阿里云轻量应用服务器、腾讯云轻量应用服务器，系统建议选择 Ubuntu LTS 或 Debian。

### 服务器准备

1. 购买轻量应用服务器，建议最低配置：
   - 1 核 2G 起步，测试可用
   - 正式使用建议 2 核 2G 或更高
   - 地域选择离主要用户更近的中国大陆地域
2. 安装 Node.js 20 LTS 或 22 LTS。
3. 开放安全组端口：
   - `22`：SSH 登录
   - `3005`：临时用公网 IP 直接测试时开放
   - `80`：以后使用域名 + Nginx 时开放
   - `443`：以后使用域名 + HTTPS 时开放
4. 推荐把项目放到 `/www/alibaba-ai-assistant`。如果你使用其他目录，后面的 Nginx、systemd、PM2 示例都要改成真实项目目录。
5. 上传项目代码到服务器，可以用 Git 拉取，也可以用压缩包上传。

### 环境变量

在服务器项目目录创建 `.env.local`，不要提交到 Git：

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
ACCESS_PASSWORD=你的访问密码
APP_ACCESS_PASSWORD=你的访问密码
```

说明：
- `DEEPSEEK_API_KEY`：DeepSeek 密钥，只放服务器环境变量里
- `DEEPSEEK_MODEL`：固定建议使用 `deepseek-chat`
- `ACCESS_PASSWORD`：访问密码，前端输入后才允许生成
- `APP_ACCESS_PASSWORD`：兼容旧变量名，建议和 `ACCESS_PASSWORD` 填同一个值
- `AI_PROVIDER`：设置为 `deepseek`
- `DEEPSEEK_BASE_URL`：默认 `https://api.deepseek.com`

### 构建与启动

在服务器项目目录执行：

```bash
npm install
npm run lint
npm run build
npm run start -- -p 3005
```

临时测试可以先不用域名，直接访问：

```text
http://服务器公网IP:3005
```

健康检查地址：

```text
http://服务器公网IP:3005/api/health
```

确认返回：
- `provider` 是 `deepseek`
- `model` 是 `deepseek-chat`
- `hasDeepSeekKey` 是 `true`
- `hasAccessPassword` 是 `true`

### 正式运行建议

正式域名访问才需要 Nginx + HTTPS。临时用公网 IP:3005 测试时，只需要开放服务器安全组 `3005`。

正式上线建议增加：

1. 用 Nginx 把域名的 `80/443` 转发到本机 `3005`。
2. 有域名后再配置 HTTPS 证书；没有域名时先不要配置 HTTPS。
3. 用进程管理工具保持服务常驻，例如 `pm2` 或 `systemd`。
4. 不要把 `.env.local`、API Key、访问密码提交到 Git。
5. 先访问 `/api/health` 确认配置正常，再测试真实生成。
6. PM2 启动示例：
```bash
pm2 start npm --name alibaba-ai-assistant -- run start -- -p 3005
```

### 备案说明

如果使用中国大陆的阿里云或腾讯云服务器，并绑定自己的域名对外访问，通常需要完成 ICP 备案。备案主体可以是个人或企业，具体以云厂商和当地通信管理局要求为准。

简单判断：
- 只用本地电脑测试：不需要备案
- 只用服务器 IP 临时测试：通常不需要域名备案，但不适合正式使用
- 中国大陆服务器 + 自己域名正式访问：通常需要 ICP 备案
- 香港或海外服务器：通常不需要中国大陆 ICP 备案，但国内访问速度和稳定性可能不如大陆节点

完成 ICP 备案后，如网站长期对公众开放，可能还需要按要求做公安联网备案。

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
