# 配置说明

所有配置通过环境变量提供。复制 `.env.example` 为 `.env.local` 后填写。

## 访问控制

| 变量 | 说明 |
| --- | --- |
| `ACCESS_PASSWORD` | 登录访问密码（必填） |
| `PROOF_SIGNING_SECRET` | 用于签发会话令牌的独立随机密钥 |

## AI Provider

文本（研究 / Listing）与图片（创作）可独立配置，支持 Mock 模式。

### Mock 模式（默认）

```bash
AI_PROVIDER=deepseek
LISTING_PROVIDER_MODE=mock
IMAGE_PROVIDER_MODE=mock
```

Mock 模式返回本地确定性结果，不调用真实付费 API。

### 文本 Provider（DeepSeek 示例）

```bash
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

### 图片 Provider（OpenAI 兼容）

```bash
LISTING_PROVIDER_MODE=real
IMAGE_PROVIDER_MODE=real
OPENAI_API_KEY=your_key_here
OPENAI_IMAGE_BASE_URL=your_image_api_base
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_RESULT_HOSTS=image_api_host
```

`OPENAI_IMAGE_RESULT_HOSTS` 是图片下载结果域名白名单，用于安全校验。

## 数据库

```bash
DATABASE_URL="file:./dev.db"
```

默认使用 SQLite。通过 Prisma 驱动，可切换到 PostgreSQL（需调整 `prisma/schema.prisma` 的 provider）。

## 存储

| 变量 | 说明 |
| --- | --- |
| `AI_IMAGE_DRAFT_STORAGE_ROOT` | 图片草稿存储目录 |

## 安全相关

- 图片下载实施域名白名单、公网 IP 校验、格式与大小限制
- 访客体验数据使用文件沙箱隔离，不进入正式数据库
- 密钥值仅存在于 `.env.local`，不应提交到版本库
