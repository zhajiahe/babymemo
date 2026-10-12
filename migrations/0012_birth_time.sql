-- Non-destructive; old migrated babies have unknown birth time until edited.
ALTER TABLE babies ADD COLUMN birth_time TEXT NOT NULL DEFAULT '';
