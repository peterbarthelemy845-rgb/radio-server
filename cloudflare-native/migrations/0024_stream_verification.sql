-- A server-observed audio sample is evidence, never a client-supplied flag.
CREATE TABLE IF NOT EXISTS stream_check_results (
 session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 stream_url TEXT NOT NULL,
 check_id TEXT NOT NULL,
 checked_at INTEGER NOT NULL,
 expires INTEGER NOT NULL,
 PRIMARY KEY(session_hash,stream_url)
);
CREATE INDEX IF NOT EXISTS stream_check_results_expiry ON stream_check_results(expires);

CREATE TABLE IF NOT EXISTS station_stream_checks (
 station_code INTEGER NOT NULL REFERENCES stations(code) ON DELETE CASCADE,
 stream_url TEXT NOT NULL,
 revision TEXT NOT NULL,
 checked_at INTEGER NOT NULL,
 expires INTEGER NOT NULL,
 review_requested_at INTEGER,
 session_hash TEXT REFERENCES sessions(token_hash) ON DELETE SET NULL,
 PRIMARY KEY(station_code,stream_url)
);
CREATE INDEX IF NOT EXISTS station_stream_checks_expiry ON station_stream_checks(expires);
