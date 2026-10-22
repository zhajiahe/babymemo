-- Read-only television pairing and revocable device authorization.
CREATE TABLE IF NOT EXISTS tv_pair_attempts (
  ip_hash TEXT PRIMARY KEY,
  tries INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tv_pair_requests (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  verifier_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tv_pair_expiry ON tv_pair_requests(expires_at);
CREATE TABLE IF NOT EXISTS tv_devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  session_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tv_devices_token ON tv_devices(token_hash);
