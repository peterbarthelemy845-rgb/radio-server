-- Attempt references are scoped to one browser session. A cancelled reference
-- is retained briefly even when cancellation arrives before the claim POST.
CREATE TABLE IF NOT EXISTS phone_pair_requests (
 session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 claim_id TEXT,
 code_hash TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL CHECK(state IN ('active','cancelled')),
 created_at INTEGER NOT NULL,
 expires INTEGER NOT NULL,
 PRIMARY KEY(session_hash,request_id),
 UNIQUE(claim_id)
);
CREATE INDEX IF NOT EXISTS phone_pair_request_expiry ON phone_pair_requests(expires);

-- Independent physical approvals must survive cancellation of another attempt.
-- A baseline preserves grants made before this ledger was introduced. Claim
-- IDs are references, not foreign keys: approval prompts expire before grants.
CREATE TABLE IF NOT EXISTS phone_pair_grant_sources (
 session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 radio_id TEXT NOT NULL REFERENCES radios(id) ON DELETE CASCADE,
 claim_id TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(scope IN ('base','control','baseline')),
 decision_token TEXT NOT NULL,
 expires INTEGER NOT NULL,
 PRIMARY KEY(session_hash,radio_id,claim_id)
);
CREATE INDEX IF NOT EXISTS phone_pair_source_expiry ON phone_pair_grant_sources(expires);
