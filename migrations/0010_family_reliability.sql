-- Intentionally numbered 0010 to avoid colliding with the in-flight MyBaby 0005 migration.
-- Both migrations are additive and can be applied independently.
ALTER TABLE growth_records ADD COLUMN deleted_at TEXT;
ALTER TABLE milestones ADD COLUMN deleted_at TEXT;
ALTER TABLE media ADD COLUMN deleted_at TEXT;
ALTER TABLE media ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS growth_deleted_at ON growth_records(deleted_at);
CREATE INDEX IF NOT EXISTS milestones_deleted_at ON milestones(deleted_at);
CREATE INDEX IF NOT EXISTS media_deleted_at ON media(deleted_at);
-- Durable message deduplication across Worker retries / third-party acknowledgement loss.
ALTER TABLE growth_records ADD COLUMN source_message_id TEXT;
ALTER TABLE milestones ADD COLUMN source_message_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS growth_source_message ON growth_records(source_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS milestones_source_message ON milestones(source_message_id);
ALTER TABLE wechat_messages ADD COLUMN reply_text TEXT;
ALTER TABLE wechat_messages ADD COLUMN client_id TEXT;
