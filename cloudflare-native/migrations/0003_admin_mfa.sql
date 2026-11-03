CREATE TABLE IF NOT EXISTS admin_mfa_used (
 secret_hash TEXT NOT NULL, counter INTEGER NOT NULL, PRIMARY KEY(secret_hash,counter)
);
CREATE TABLE IF NOT EXISTS admin_mfa_sessions (
 session_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash), expires INTEGER NOT NULL
);
