-- WeChat operational state, atomic edit audit and milestone-media relations.
-- Additive only. Existing records and Cloudflare resources are not recreated.
CREATE TABLE IF NOT EXISTS wechat_operation_log (
 id TEXT PRIMARY KEY, source_message_id TEXT NOT NULL UNIQUE, baby_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('growth','milestones','media','baby')),
 record_id TEXT NOT NULL, action TEXT NOT NULL,
 before_json TEXT NOT NULL, after_json TEXT NOT NULL,
 created_at TEXT NOT NULL, undone_at TEXT
);
CREATE INDEX IF NOT EXISTS wechat_ops_by_baby ON wechat_operation_log(baby_id,created_at DESC);
CREATE TABLE IF NOT EXISTS wechat_tool_steps (
 source_message_id TEXT PRIMARY KEY, baby_id TEXT NOT NULL, action TEXT NOT NULL,
 reply TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS milestone_media (
 milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
 media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
 PRIMARY KEY(milestone_id,media_id)
);
CREATE INDEX IF NOT EXISTS milestone_media_by_media ON milestone_media(media_id);
