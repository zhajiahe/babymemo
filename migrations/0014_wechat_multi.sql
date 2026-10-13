-- Each family can authorize multiple independent iLink accounts.
-- Keep the original Durable Object name for the migrated connection so its
-- existing cursor and conversation remain valid after rollout.
CREATE TABLE IF NOT EXISTS wechat_connections (
 id TEXT PRIMARY KEY,
 label TEXT NOT NULL,
 bot_id TEXT NOT NULL UNIQUE,
 user_id TEXT NOT NULL UNIQUE,
 token_cipher TEXT NOT NULL,
 base_url TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS wechat_connections_enabled ON wechat_connections(enabled);
CREATE TABLE IF NOT EXISTS wechat_pairings (
 id TEXT PRIMARY KEY,
 label TEXT NOT NULL,
 qr_cipher TEXT NOT NULL,
 base_url TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wechat_pairings_expiry ON wechat_pairings(expires_at);
-- Migrate the old encrypted credential without decrypting it. Old settings
-- are retained solely to allow rollback to the previous Worker version.
INSERT OR IGNORE INTO wechat_connections
(id,label,bot_id,user_id,token_cipher,base_url,enabled,created_at,updated_at)
SELECT 'legacy','原有微信',b.value,u.value,t.value,
 COALESCE((SELECT value FROM app_settings WHERE name='wechat_base'),'https://ilinkai.weixin.qq.com'),
 CASE WHEN (SELECT value FROM app_settings WHERE name='wechat_enabled')='true' THEN 1 ELSE 0 END,
 datetime('now'),datetime('now')
FROM app_settings t
JOIN app_settings b ON b.name='wechat_bot_id'
JOIN app_settings u ON u.name='wechat_user_id'
WHERE t.name='wechat_token' AND t.value<>'' AND b.value<>'' AND u.value<>'';
