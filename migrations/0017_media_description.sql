-- Independent captions for completed media and resumable uploads.
-- Historical records keep an empty description; original R2 objects are unchanged.
ALTER TABLE media ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE media_uploads ADD COLUMN description TEXT NOT NULL DEFAULT '';
