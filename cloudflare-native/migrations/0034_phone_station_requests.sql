-- A browser can reconcile a lost response without enqueueing the station twice.
-- These are short-lived request receipts, not saved station inventory.
CREATE TABLE IF NOT EXISTS phone_station_requests (
 session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 radio_id TEXT NOT NULL REFERENCES radios(id) ON DELETE CASCADE,
 station_code INTEGER NOT NULL,
 command_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires INTEGER NOT NULL,
 PRIMARY KEY(session_hash,request_id)
);
CREATE INDEX IF NOT EXISTS phone_station_request_expiry ON phone_station_requests(expires);
