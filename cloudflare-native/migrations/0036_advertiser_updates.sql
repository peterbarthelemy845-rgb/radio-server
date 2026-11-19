-- Email updates require proof of the ad's submitted contact address. Browser
-- grants/challenges are temporary; only the verified preference is backed up.
CREATE TABLE IF NOT EXISTS ad_update_preferences (
 ad_id TEXT PRIMARY KEY REFERENCES local_ads(id),
 email_hash TEXT NOT NULL,
 verified_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ad_status_grants (
 session_hash TEXT NOT NULL REFERENCES sessions(token_hash),
 ad_id TEXT NOT NULL REFERENCES local_ads(id),
 expires INTEGER NOT NULL,
 PRIMARY KEY(session_hash,ad_id)
);
CREATE INDEX IF NOT EXISTS ad_status_grants_expiry ON ad_status_grants(expires);
CREATE TABLE IF NOT EXISTS ad_status_verifications (
 id TEXT PRIMARY KEY,
 session_hash TEXT NOT NULL REFERENCES sessions(token_hash),
 ad_id TEXT REFERENCES local_ads(id),
 email_hash TEXT NOT NULL,
 code_hash TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 expires INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 consumed_at INTEGER,
 operation_token TEXT
);
CREATE INDEX IF NOT EXISTS ad_status_verifications_expiry ON ad_status_verifications(expires);
