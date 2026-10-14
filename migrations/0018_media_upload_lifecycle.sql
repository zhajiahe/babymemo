-- WeChat uploads reserve a private media row before the background CDN transfer.
-- Existing media are already complete; no original object or description is changed.
ALTER TABLE media ADD COLUMN upload_state TEXT NOT NULL DEFAULT 'ready'
 CHECK(upload_state IN ('processing','ready','failed'));
CREATE INDEX IF NOT EXISTS media_upload_state_by_baby ON media(baby_id,upload_state,day DESC);

-- A monotonic per-baby marker fixes the prior COUNT + MAX(updated_at) blind spot
-- when a description on an older photo changes.
CREATE TABLE IF NOT EXISTS media_revisions (
 baby_id TEXT PRIMARY KEY,
 version INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO media_revisions(baby_id,version)
 SELECT baby_id,COUNT(*) FROM media GROUP BY baby_id;
CREATE TRIGGER media_revision_on_insert AFTER INSERT ON media
BEGIN
 INSERT INTO media_revisions(baby_id,version) VALUES(NEW.baby_id,1)
 ON CONFLICT(baby_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER media_revision_on_update AFTER UPDATE ON media
BEGIN
 INSERT INTO media_revisions(baby_id,version) VALUES(NEW.baby_id,1)
 ON CONFLICT(baby_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER media_revision_on_delete AFTER DELETE ON media
BEGIN
 INSERT INTO media_revisions(baby_id,version) VALUES(OLD.baby_id,1)
 ON CONFLICT(baby_id) DO UPDATE SET version=version+1;
END;
