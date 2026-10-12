-- Backward-compatible metadata for private photo derivatives and upload retention.
ALTER TABLE media ADD COLUMN thumbnail_ready INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS media_missing_thumbnail ON media(baby_id,thumbnail_ready,id);
ALTER TABLE media_uploads ADD COLUMN updated_at TEXT;
CREATE INDEX IF NOT EXISTS media_upload_retention ON media_uploads(updated_at,created_at);
