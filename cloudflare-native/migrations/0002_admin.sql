CREATE TABLE IF NOT EXISTS admin_verifications (
 id TEXT PRIMARY KEY, session_hash TEXT NOT NULL REFERENCES sessions(token_hash),
 code_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 expires INTEGER NOT NULL, consumed_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
 session_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash), expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_audit (
 id TEXT PRIMARY KEY, actor_hash TEXT NOT NULL, station_code INTEGER REFERENCES stations(code),
 action TEXT NOT NULL, created_at INTEGER NOT NULL
);
