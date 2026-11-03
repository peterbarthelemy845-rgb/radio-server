PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS stations (
  code INTEGER PRIMARY KEY AUTOINCREMENT CHECK(code >= 10),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 96),
  stream_url TEXT NOT NULL CHECK(length(stream_url) <= 2048),
  bio TEXT NOT NULL DEFAULT '' CHECK(length(bio) <= 250),
  location TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL,
  artwork_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending_email'
    CHECK(status IN ('pending_email','pending_review','published','suspended','deleted')),
  email_verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO sqlite_sequence(name,seq) SELECT 'stations',9
  WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='stations');
CREATE INDEX IF NOT EXISTS stations_public ON stations(status,code);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  owner_station INTEGER REFERENCES stations(code),
  owner_expires INTEGER
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE TABLE IF NOT EXISTS email_verifications (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL REFERENCES sessions(token_hash),
  station_code INTEGER NOT NULL REFERENCES stations(code),
  purpose TEXT NOT NULL CHECK(purpose IN ('registration','edit')),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_session ON email_verifications(session_hash,purpose,expires);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS limits_expiry ON rate_limits(expires);
CREATE TABLE IF NOT EXISTS radios (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'My radio',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS radio_pairs (
  radio_id TEXT PRIMARY KEY REFERENCES radios(id),
  code_hash TEXT NOT NULL UNIQUE,
  expires INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pair_claims (
  id TEXT PRIMARY KEY,
  radio_id TEXT NOT NULL REFERENCES radios(id),
  session_hash TEXT NOT NULL REFERENCES sessions(token_hash),
  confirmation_code TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('waiting','approved','denied','expired','cancelled')),
  expires INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_waiting_claim ON pair_claims(radio_id) WHERE state='waiting';
CREATE TABLE IF NOT EXISTS phone_radios (
  session_hash TEXT NOT NULL REFERENCES sessions(token_hash),
  radio_id TEXT NOT NULL REFERENCES radios(id),
  expires INTEGER NOT NULL,
  PRIMARY KEY(session_hash,radio_id)
);
CREATE TABLE IF NOT EXISTS radio_commands (
  id TEXT PRIMARY KEY,
  radio_id TEXT NOT NULL REFERENCES radios(id),
  station_code INTEGER NOT NULL REFERENCES stations(code),
  state TEXT NOT NULL CHECK(state IN ('pending','delivered','added','failed','expired')),
  created_at INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  lease INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_station ON radio_commands(radio_id,station_code)
  WHERE state IN ('pending','delivered');
CREATE TABLE IF NOT EXISTS monthly_activity (
  month TEXT NOT NULL, station_code INTEGER NOT NULL REFERENCES stations(code),
  radio_id TEXT NOT NULL REFERENCES radios(id), first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  PRIMARY KEY(month,station_code,radio_id)
);
CREATE TABLE IF NOT EXISTS agreement_acceptances (
  id INTEGER PRIMARY KEY, station_code INTEGER NOT NULL REFERENCES stations(code),
  agreement_version TEXT NOT NULL, agreement_hash TEXT NOT NULL, accepted_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS local_ads (
  id TEXT PRIMARY KEY, station_code INTEGER NOT NULL REFERENCES stations(code),
  business TEXT NOT NULL, contact_email TEXT NOT NULL, message TEXT NOT NULL,
  artwork_key TEXT, status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK(status IN ('pending_review','approved','rejected','deleted')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_outbox (
  id TEXT PRIMARY KEY, recipient TEXT NOT NULL, subject TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','sending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL,
  expires INTEGER NOT NULL, lease INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outbox_due ON mail_outbox(state,due,lease);
