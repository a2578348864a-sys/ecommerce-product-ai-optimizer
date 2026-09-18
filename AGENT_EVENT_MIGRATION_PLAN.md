# AgentEvent 数据表迁移方案

## 1. 目标与背景
为支持 `agentEventLogger` 与统一采集状态（`unifiedCollectionStatus`）的持久化与事件审计，在 Prisma 模式中引入 `AgentEvent` 模型，映射至 SQLite 底层表 `agent_events`。

## 2. Prisma Model 定义（已写入 prisma/schema.prisma）
```prisma
model AgentEvent {
  id           String   @id @default(cuid())
  createdAt    DateTime @default(now())
  taskId       String?
  runId        String?
  module       String
  event        String
  level        String
  message      String
  metadataJson String   @default("{}")

  @@index([taskId, createdAt])
  @@index([module, createdAt])
  @@index([level, createdAt])
  @@index([createdAt])
  @@map("agent_events")
}
```

## 3. SQL 迁移脚本（标准 DDL）
```sql
-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT,
    "runId" TEXT,
    "module" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL DEFAULT '{}'
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_events_taskId_createdAt_idx" ON "agent_events"("taskId", "createdAt");
CREATE INDEX IF NOT EXISTS "agent_events_module_createdAt_idx" ON "agent_events"("module", "createdAt");
CREATE INDEX IF NOT EXISTS "agent_events_level_createdAt_idx" ON "agent_events"("level", "createdAt");
CREATE INDEX IF NOT EXISTS "agent_events_createdAt_idx" ON "agent_events"("createdAt");
```

## 4. 数据库现状核查
- 目标环境：`prisma/dev.db`（SQLite）
- 核查结果：底层 `agent_events` 表结构已在物理数据库中存在且字段/索引与 Prisma 模型 100% 一致。
- 本阶段遵循“不直接修改真实数据库、等待用户明确授权”原则，未执行 `prisma migrate deploy` 或 `prisma db push` 写操作。

## 5. 待授权执行的 Migration 步骤
经用户授权后，执行以下命令使 Prisma 迁移历史正式对齐：
```bash
npx prisma migrate dev --name add_agent_events --create-only
```
或直接由生产迁移机制加载上述 DDL 脚本。
