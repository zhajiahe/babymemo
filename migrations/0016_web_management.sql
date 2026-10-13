-- Additive web management, optimistic edits and irreversible purge claims.
ALTER TABLE babies ADD COLUMN avatar_key TEXT NOT NULL DEFAULT '';
ALTER TABLE babies ADD COLUMN archived_at TEXT;
ALTER TABLE babies ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE growth_records ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE milestones ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE media ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE media ADD COLUMN purge_token TEXT;
CREATE INDEX IF NOT EXISTS media_purge_claim ON media(purge_token);
CREATE TABLE web_mutation_receipts (
 request_id TEXT PRIMARY KEY,path TEXT NOT NULL,method TEXT NOT NULL,
 payload_hash TEXT NOT NULL,response_json TEXT NOT NULL,created_at TEXT NOT NULL
);

CREATE TRIGGER babies_edit_version AFTER UPDATE ON babies
WHEN NEW.updated_at = OLD.updated_at
BEGIN
 UPDATE babies SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')||':'||lower(hex(randomblob(4))) WHERE id=NEW.id;
END;

CREATE TRIGGER growth_records_edit_version AFTER UPDATE ON growth_records
WHEN NEW.updated_at = OLD.updated_at
BEGIN
 UPDATE growth_records SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')||':'||lower(hex(randomblob(4))) WHERE id=NEW.id;
END;

CREATE TRIGGER milestones_edit_version AFTER UPDATE ON milestones
WHEN NEW.updated_at = OLD.updated_at
BEGIN
 UPDATE milestones SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')||':'||lower(hex(randomblob(4))) WHERE id=NEW.id;
END;

CREATE TRIGGER media_edit_version AFTER UPDATE ON media
WHEN NEW.updated_at = OLD.updated_at
BEGIN
 UPDATE media SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')||':'||lower(hex(randomblob(4))) WHERE id=NEW.id;
END;
