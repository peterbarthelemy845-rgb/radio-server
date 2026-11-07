-- Browser-bound support access is temporary and is intentionally not backed up.
CREATE TABLE IF NOT EXISTS support_ticket_grants (
 session_hash TEXT NOT NULL,
 ticket_id TEXT NOT NULL REFERENCES legal_requests(id),
 expires INTEGER NOT NULL,
 PRIMARY KEY(session_hash,ticket_id)
);
CREATE INDEX IF NOT EXISTS support_ticket_grants_expiry ON support_ticket_grants(expires);
CREATE TABLE IF NOT EXISTS support_status_verifications (
 id TEXT PRIMARY KEY,
 session_hash TEXT NOT NULL,
 ticket_id TEXT REFERENCES legal_requests(id),
 code_hash TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 expires INTEGER NOT NULL,
 consumed_at INTEGER,
 operation_token TEXT,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS support_status_checks_browser ON support_status_verifications(session_hash,created_at);
