-- Additive compatibility fields. Existing APIs and new writes retain their defaults.
ALTER TABLE babies ADD COLUMN birth_time TEXT;
ALTER TABLE babies ADD COLUMN birth_weight REAL;
ALTER TABLE babies ADD COLUMN birth_height REAL;
ALTER TABLE babies ADD COLUMN birth_head_circumference REAL;
ALTER TABLE babies ADD COLUMN blood_type TEXT;
ALTER TABLE babies ADD COLUMN avatar_object_key TEXT;
ALTER TABLE babies ADD COLUMN updated_at TEXT;
ALTER TABLE growth_records ADD COLUMN updated_at TEXT;
ALTER TABLE milestones ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE milestones ADD COLUMN updated_at TEXT;
ALTER TABLE media ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE media ADD COLUMN format TEXT;
ALTER TABLE media ADD COLUMN duration INTEGER;
ALTER TABLE media ADD COLUMN thumbnail_object_key TEXT;
ALTER TABLE media ADD COLUMN updated_at TEXT;
-- Preserve exact source fields, original timestamps/URLs, IDs, and baby ID mapping.
-- No credentials or authentication tables are imported.
CREATE TABLE legacy_import_rows (
  source_table TEXT NOT NULL CHECK(source_table IN ('babies','growth_records','milestones','media_items')),
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY(source_table,source_id)
);
