-- Session-scoped retry keys prevent a lost signup response from creating a
-- second station or invalidating the original emailed verification code.
CREATE TABLE IF NOT EXISTS registration_requests (
  session_hash TEXT NOT NULL REFERENCES sessions(token_hash),
  request_id TEXT NOT NULL CHECK(length(request_id)=32),
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete')),
  lease_token TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  station_code INTEGER REFERENCES stations(code),
  verification_id TEXT REFERENCES email_verifications(id),
  created_at INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  PRIMARY KEY(session_hash,request_id)
);
CREATE INDEX IF NOT EXISTS registration_requests_expiry ON registration_requests(expires);
