-- Family-wide AI reports are opt-in. Outbound iLink context is encrypted.
ALTER TABLE wechat_connections ADD COLUMN context_cipher TEXT;
ALTER TABLE wechat_connections ADD COLUMN context_updated_at TEXT;
ALTER TABLE wechat_connections ADD COLUMN report_subscribed INTEGER NOT NULL DEFAULT 1 CHECK(report_subscribed IN (0,1));

CREATE TABLE family_reports (
 kind TEXT NOT NULL CHECK(kind IN ('week','month')),
 period_start TEXT NOT NULL,
 period_end TEXT NOT NULL,
 body TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(kind,period_start)
);
CREATE TABLE family_report_deliveries (
 kind TEXT NOT NULL,
 period_start TEXT NOT NULL,
 connection_id TEXT NOT NULL REFERENCES wechat_connections(id) ON DELETE CASCADE,
 client_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','waiting_context','retry','sent','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 error_code TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(kind,period_start,connection_id),
 FOREIGN KEY(kind,period_start) REFERENCES family_reports(kind,period_start) ON DELETE CASCADE
);
CREATE INDEX family_report_delivery_pending ON family_report_deliveries(state,updated_at);
