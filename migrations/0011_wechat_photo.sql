-- Imported WeChat images are idempotent and tracked without exposing CDN URLs.
ALTER TABLE media ADD COLUMN source_message_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS media_source_message ON media(source_message_id);
