CREATE TABLE IF NOT EXISTS admin_email_proofs (
 id TEXT PRIMARY KEY, session_hash TEXT NOT NULL REFERENCES sessions(token_hash),
 attempts INTEGER NOT NULL DEFAULT 0, expires INTEGER NOT NULL, consumed_at INTEGER
);
