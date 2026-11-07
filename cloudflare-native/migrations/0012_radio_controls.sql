CREATE TABLE IF NOT EXISTS radio_telemetry (
 radio_id TEXT PRIMARY KEY REFERENCES radios(id) ON DELETE CASCADE,
 firmware_version TEXT,
 remote_control_version INTEGER NOT NULL DEFAULT 0 CHECK(remote_control_version IN (0,1)),
 volume_percent INTEGER CHECK(volume_percent BETWEEN 0 AND 100),
 muted INTEGER CHECK(muted IN (0,1)),
 current_station_code INTEGER,
 reported_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS radio_control_claims (
 claim_id TEXT PRIMARY KEY REFERENCES pair_claims(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS radio_control_grants (
 session_hash TEXT NOT NULL,
 radio_id TEXT NOT NULL,
 approved_at INTEGER NOT NULL,
 expires INTEGER NOT NULL,
 PRIMARY KEY(session_hash,radio_id),
 FOREIGN KEY(session_hash,radio_id) REFERENCES phone_radios(session_hash,radio_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS radio_control_commands (
 id TEXT PRIMARY KEY,
 session_hash TEXT NOT NULL,
 radio_id TEXT NOT NULL,
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('select_station','set_volume','set_mute')),
 value_json TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','delivered','applied','failed','expired')),
 created_at INTEGER NOT NULL,
 expires INTEGER NOT NULL,
 lease INTEGER NOT NULL DEFAULT 0,
 UNIQUE(session_hash,radio_id,request_id),
 FOREIGN KEY(session_hash,radio_id) REFERENCES phone_radios(session_hash,radio_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_radio_control ON radio_control_commands(radio_id) WHERE state IN ('pending','delivered');
CREATE INDEX IF NOT EXISTS control_command_expiry ON radio_control_commands(expires);
