-- A stable browser draft owns one processing lease and one advertisement. No
-- contact details, image bytes or bot tokens are stored in this retry ledger.
CREATE TABLE IF NOT EXISTS ad_requests (
 session_hash TEXT NOT NULL REFERENCES sessions(token_hash),
 request_id TEXT NOT NULL CHECK(length(request_id)=32),
 payload_hash TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete')),
 lease_token TEXT NOT NULL,
 lease_until INTEGER NOT NULL,
 ad_id TEXT NOT NULL UNIQUE,
 allowance_reserved INTEGER NOT NULL DEFAULT 0,
 scanner_passed INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 expires INTEGER NOT NULL,
 PRIMARY KEY(session_hash,request_id)
);
CREATE INDEX IF NOT EXISTS ad_requests_expiry ON ad_requests(expires);
