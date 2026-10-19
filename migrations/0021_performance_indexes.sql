-- Backward-compatible active-list composite indexes; no data rewriting.
CREATE INDEX IF NOT EXISTS media_active_timeline ON media(baby_id,deleted_at,day DESC,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS milestones_active_timeline ON milestones(baby_id,deleted_at,day DESC,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS growth_active_timeline ON growth_records(baby_id,deleted_at,day DESC,created_at DESC,id DESC);
