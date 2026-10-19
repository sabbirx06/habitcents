-- Production session storage; no user record or credential changes.
BEGIN;
CREATE TABLE app_sessions(sid TEXT PRIMARY KEY,data JSONB NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
CREATE INDEX app_sessions_expiry_idx ON app_sessions(expires_at);
ALTER TABLE app_sessions ENABLE ROW LEVEL SECURITY;
COMMIT;
