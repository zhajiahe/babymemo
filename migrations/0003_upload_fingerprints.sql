-- Optional file fingerprints allow safe multipart resume after mobile reload.
-- Existing incomplete sessions remain cancellable but are not resumed blindly.
ALTER TABLE media_uploads ADD COLUMN fingerprint TEXT NOT NULL DEFAULT '';
