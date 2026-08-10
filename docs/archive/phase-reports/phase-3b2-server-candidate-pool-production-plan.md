# Phase 3-B.2：服务端候选池生产部署预案

> 状态：预案 · 未执行 · 2026-06-24
> 前置：Phase 3-B.1.5 本地浏览器验收 15/15 通过

## 1. 生产部署前置条件

| # | 条件 | 验证方式 |
|---|------|---------|
| 1 | origin/main = `2f53c28` 或更新的已验证 commit | `git log -1 --oneline` |
| 2 | 本地验证全部通过：lint / test / build / pages 200 / browser 15/15 | 见 Phase 3-B.1.5 记录 |
| 3 | 生产服务器 GitHub 可达 | `git ls-remote origin main` |
| 4 | 生产工作区 clean | `git status -sb` → `## main...origin/main` |
| 5 | 生产 PM2 当前 online | `pm2 status` |
| 6 | 生产数据库文件存在 | `ls -la prisma/dev.db`（路径以实际为准） |

## 2. 生产数据库备份

```bash
# 1. 进入生产目录
cd /www/alibaba-ai-assistant

# 2. 确定当前日期
DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/www/server-backups/before-phase3b2-deploy-$DATE"

# 3. 创建备份目录
mkdir -p "$BACKUP_DIR"

# 4. 复制数据库文件（不打印路径内容）
cp prisma/dev.db "$BACKUP_DIR/dev.db"
# 如果数据库路径不在 prisma/，以 .env 中 DATABASE_URL 指定的实际路径为准

# 5. SQLite 完整性快速检查
sqlite3 "$BACKUP_DIR/dev.db" "PRAGMA quick_check;"
# 预期输出: ok

# 6. 备份 .env.local（仅备份，不读取内容）
cp .env.local "$BACKUP_DIR/.env.local"

# 7. 记录备份路径
echo "Backup: $BACKUP_DIR"
```

**停止条件**：quick_check 返回非 `ok`，或备份文件大小为 0。

## 3. 生产 migration

```bash
cd /www/alibaba-ai-assistant

# 拉取最新代码
git pull origin main

# 确认 HEAD = origin/main
git log -1 --oneline

# 执行 migration（不是 db push）
DATABASE_URL="file:./dev.db" npx prisma migrate deploy

# 预期输出：
#   Migration 20260624000000_add_opportunity_candidate applied successfully
#   All migrations have been successfully applied

# 验证新表存在
sqlite3 prisma/dev.db ".tables" | grep OpportunityCandidate
# 预期输出: OpportunityCandidate
```

**停止条件**：`prisma migrate deploy` 报错、新表不存在。

## 4. 生产构建与重启

```bash
cd /www/alibaba-ai-assistant

# 安装依赖（锁定版本）
npm ci

# 生产构建
npm run build
# 预期：42/42 pages 成功

# 重启 PM2
pm2 restart alibaba-ai-assistant

# 确认 online
pm2 status
# 预期：status = online
```

**停止条件**：build 失败、PM2 非 online。

## 5. 回滚策略

如果部署后出现严重问题：

### 5.1 代码回滚

```bash
cd /www/alibaba-ai-assistant

# 回滚到部署前 HEAD（例如 c3c881d 或上一个已知稳定 commit）
git checkout <pre-deploy-commit>

# 或者从备份分支恢复
git checkout backup/before-phase3b2-deploy-YYYYMMDD-HHMMSS

# 重新构建
npm run build
pm2 restart alibaba-ai-assistant
```

### 5.2 数据库回滚

```bash
cd /www/alibaba-ai-assistant

# 用备份文件恢复数据库
cp /www/server-backups/before-phase3b2-deploy-YYYYMMDD-HHMMSS/dev.db prisma/dev.db

# 重启
pm2 restart alibaba-ai-assistant
```

### 5.3 紧急降级（不回滚 DB，只禁用候选池 API）

如果 candidate API 有问题但不影响其他功能：
```bash
# 手动删除或重命名 API route 目录
mv app/api/opportunity-candidates app/api/opportunity-candidates.disabled
npm run build
pm2 restart alibaba-ai-assistant
# 前端自动降级到 localStorage 模式
```

## 6. 生产只读验收

```bash
# 1. 页面 200 检查
for path in / /opportunities /workflow /tasks /api/health /agent /agent/run /viral; do
  curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3005$path"
done
# 预期：全部 200

# 2. 候选池 API 无密码应 401
curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3005/api/opportunity-candidates"
# 预期：401

# 3. 候选池 API 有密码应 200
curl -s -o /dev/null -w "%{http_code}" -H "x-access-password: <your-password>" "http://127.0.0.1:3005/api/opportunity-candidates"
# 预期：200，返回 {"ok":true,"items":[],...}

# 4. 不调用真实 AI
# 5. 不写生产 DB（仅只读查询验证）
```

## 7. 生产小流量写入验收（用户手动）

1. 打开生产 `/opportunities`
2. 输入访问密码
3. 确认显示"已连接服务端候选池"
4. 手动输入 1 个测试候选品（不调用 AI）
5. 标记状态（pending → worth_analyzing → paused）
6. 刷新页面，确认状态保留
7. 点击"导入本浏览器候选池"（如果本地有数据）
8. 确认导入成功
9. **不跑真实 AI 分析**（除非用户明确授权）

## 8. 停止条件（任一触发则中止）

| # | 条件 | 处理 |
|---|------|------|
| 1 | 数据库备份失败 | 停止部署，排查磁盘空间 |
| 2 | quick_check 失败 | 数据库可能损坏，停止部署 |
| 3 | migrate deploy 失败 | 检查 schema 兼容性，停止部署 |
| 4 | build 失败 | 检查编译错误，停止部署 |
| 5 | PM2 非 online | 检查端口、日志，可能需回滚 |
| 6 | 候选池 API 500 | 检查数据库连接，可能需回滚 |
| 7 | 首页 500 | 立即回滚 |

## 9. 不做事项

- ❌ 不做爬虫增强
- ❌ 不做自动执行/自动采购
- ❌ 不清空用户 localStorage 候选池
- ❌ 不删除旧任务记录
- ❌ 不修改 `ViralAnalysisRecord` 表
- ❌ 不执行 `prisma db push`
- ❌ 不在 build 失败时强行 PM2 restart

## 10. 部署后观察

部署成功后，至少观察：

- 首页 `/` 候选池统计是否正常（读候选池 API）
- `/opportunities` 服务端模式是否正常
- 无密码访问候选池 API 是否仍 401
- 任务中心 `/tasks` 是否不受影响
- PM2 日志无异常错误
- 候选池 API 响应时间（预期 < 100ms for empty list）
