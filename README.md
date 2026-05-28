# 电商商品页 AI 优化器

这是一个可以部署到 Vercel 的 Next.js 电商运营 AI 工具。用户输入商品名称、类目、卖点、人群、平台和风格后，系统会通过服务端 API 调用 OpenAI，生成商品标题、主图文案、详情页文案、短视频脚本、客服话术、差评回复和转化建议。

项目特点：

- 使用 Next.js App Router、TypeScript、Tailwind CSS。
- 使用 OpenAI 官方 JavaScript SDK。
- API Key 只保存在服务端环境变量中，不会暴露给前端。
- 不使用数据库，不做登录系统，适合作为轻量 MVP 上线。
- 使用访问密码保护生成接口，避免别人随便消耗你的 API 额度。

## 最简单启动流程

1. 打开 `.env.local`。
2. 把这一行：

```env
OPENAI_API_KEY=请在这里填写你的真实OpenAI_API_Key
```

改成你自己的真实 OpenAI API Key。

3. 终端运行：

```bash
npm run dev
```

如果 Windows PowerShell 提示 `npm.ps1` 被执行策略拦截，可以使用：

```powershell
npm.cmd run dev
```

4. 打开 `http://localhost:3000`。
5. 输入访问密码 `888888`。
6. 点击“填入示例”。
7. 点击“开始生成”。
8. 打开 `http://localhost:3000/api/health`。
9. 确认 `hasOpenAIKey` 和 `hasAccessPassword` 都是 `true`。

## 本地运行步骤

1. 安装依赖：

```bash
npm install
```

2. 如果没有 `.env.local`，复制环境变量文件：

```bash
cp .env.example .env.local
```

Windows PowerShell 可以使用：

```powershell
Copy-Item .env.example .env.local
```

3. 打开 `.env.local`，填写你的环境变量：

```env
OPENAI_API_KEY=你的 OpenAI API Key
OPENAI_MODEL=gpt-5.5
APP_ACCESS_PASSWORD=888888
```

4. 启动本地开发服务：

```bash
npm run dev
```

5. 打开浏览器访问：

```text
http://localhost:3000
```

## 本地测试方法

1. 打开 `http://localhost:3000`。
2. 在访问密码输入框中输入 `.env.local` 里的 `APP_ACCESS_PASSWORD`，默认是 `888888`。
3. 点击“填入示例”。
4. 点击“开始生成”。
5. 检查页面右侧是否生成以下模块：
   - 商品标题
   - 商品主图文案
   - 商品核心卖点
   - 详情页完整文案
   - 小红书种草文案
   - 抖音/短视频脚本
   - 客服常见问题回复
   - 差评回复模板
   - 竞品差异化建议
   - 提高转化率的优化建议
   - 适合投放的人群标签
   - 适合测试的营销钩子

## 健康检查方法

本地运行后，打开：

```text
http://localhost:3000/api/health
```

你会看到类似结果：

```json
{
  "ok": true,
  "hasOpenAIKey": true,
  "hasAccessPassword": true,
  "model": "gpt-5.5"
}
```

请确认：

- `hasOpenAIKey` 是 `true`
- `hasAccessPassword` 是 `true`
- `model` 是你想使用的模型名称

健康检查接口不会返回真实 API Key，也不会返回真实访问密码。

## Vercel 部署步骤

1. 将代码推送到 GitHub。
2. 打开 Vercel。
3. 点击 `Add New Project` 或 `Import GitHub Project`。
4. 选择你的 GitHub 仓库。
5. 进入项目的环境变量设置，添加：

```env
OPENAI_API_KEY=你的 OpenAI API Key
OPENAI_MODEL=gpt-5.5
APP_ACCESS_PASSWORD=888888
```

也可以把 `APP_ACCESS_PASSWORD` 改成你自己的密码。

6. 点击 `Deploy`。

## Vercel 部署后检查

部署完成后，先打开：

```text
https://你的域名/api/health
```

确认：

- `hasOpenAIKey` 是 `true`
- `hasAccessPassword` 是 `true`
- `model` 是你在 Vercel 配置的模型

然后回到首页：

```text
https://你的域名
```

输入访问密码，点击“填入示例”，再点击“开始生成”，检查是否能正常生成结果。

## 常见错误排查

### 服务器未配置 OPENAI_API_KEY

说明服务端没有读到 `OPENAI_API_KEY`。

处理方法：

- 本地检查 `.env.local` 是否存在。
- 确认 `.env.local` 中有 `OPENAI_API_KEY=...`，并且不是占位文字。
- Vercel 上检查 Project Settings 里的 Environment Variables。
- 修改环境变量后需要重新部署。

### 服务器未配置 APP_ACCESS_PASSWORD

说明服务端没有读到访问密码。

处理方法：

- 本地检查 `.env.local` 是否包含 `APP_ACCESS_PASSWORD`。
- Vercel 上检查是否添加了 `APP_ACCESS_PASSWORD`。
- 修改环境变量后重新启动本地服务或重新部署 Vercel。

### 访问密码错误

说明页面里输入的密码和服务端 `APP_ACCESS_PASSWORD` 不一致。

处理方法：

- 重新输入密码。
- 检查是否有多余空格。
- 如果刚修改过 Vercel 环境变量，请重新部署。

### 生成失败

常见原因：

- OpenAI API Key 不正确。
- 模型名称不可用。
- 账号余额不足或额度受限。
- 网络或 OpenAI 服务暂时异常。

可以先打开 `/api/health` 检查环境变量是否配置成功，再确认 OpenAI 账号状态。

### npm run build 失败

处理方法：

- 先运行 `npm install`。
- 再运行 `npm run lint` 查看代码问题。
- 最后运行 `npm run build`。
- 如果 Windows PowerShell 拦截 `npm`，使用 `npm.cmd run build`。

### Vercel 部署后环境变量没生效

处理方法：

- 检查变量是否添加到了正确的 Vercel Project。
- 检查变量名是否完全一致：
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`
  - `APP_ACCESS_PASSWORD`
- 添加或修改环境变量后，必须重新部署。

## 安全注意事项

- 不要把 `.env.local` 上传到 GitHub。
- 不要把真实 API Key 写进任何代码。
- 不要使用 `NEXT_PUBLIC_OPENAI_API_KEY`。
- AI 生成内容仅供运营参考，请根据平台规则、商品真实情况和广告法要求修改后使用。
