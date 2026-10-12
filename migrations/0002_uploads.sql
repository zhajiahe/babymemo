CREATE TABLE IF NOT EXISTS media_uploads (
 id TEXT PRIMARY KEY, baby_id TEXT NOT NULL REFERENCES babies(id) ON DELETE CASCADE,
 object_key TEXT NOT NULL, upload_id TEXT NOT NULL, day TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
 mime TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media_upload_parts (
 media_upload_id TEXT NOT NULL REFERENCES media_uploads(id) ON DELETE CASCADE,
 part_number INTEGER NOT NULL, etag TEXT NOT NULL,
 PRIMARY KEY(media_upload_id,part_number)
);
