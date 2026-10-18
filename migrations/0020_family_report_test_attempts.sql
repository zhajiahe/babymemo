-- Throttle explicit manual tests, without persisting report content or credentials.
CREATE TABLE family_report_test_attempts (
 connection_id TEXT PRIMARY KEY REFERENCES wechat_connections(id) ON DELETE CASCADE,
 attempted_at TEXT NOT NULL
);
