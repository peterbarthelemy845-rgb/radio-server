-- Station removal is separately advertised by radio software. Legacy software
-- remains add-only even if it supports volume and station selection controls.
ALTER TABLE radio_telemetry ADD COLUMN station_removal_version INTEGER NOT NULL DEFAULT 0 CHECK(station_removal_version IN (0,1));
-- Keep the original published-only list for directory display. The authenticated
-- complete list also permits cleaning obsolete/unpublished saved station codes.
ALTER TABLE radio_station_inventory ADD COLUMN all_station_codes_json TEXT;

-- SQLite cannot extend a CHECK constraint in place. Preserve all existing
-- commands and their request receipts while adding one bounded saved-code action.
CREATE TABLE radio_control_commands_v2 (
 id TEXT PRIMARY KEY,
 session_hash TEXT NOT NULL,
 radio_id TEXT NOT NULL,
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('select_station','set_volume','set_mute','remove_station')),
 value_json TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','delivered','applied','failed','expired')),
 created_at INTEGER NOT NULL,
 expires INTEGER NOT NULL,
 lease INTEGER NOT NULL DEFAULT 0,
 UNIQUE(session_hash,radio_id,request_id),
 FOREIGN KEY(session_hash,radio_id) REFERENCES phone_radios(session_hash,radio_id) ON DELETE CASCADE
);
INSERT INTO radio_control_commands_v2 SELECT * FROM radio_control_commands;
DROP TABLE radio_control_commands;
ALTER TABLE radio_control_commands_v2 RENAME TO radio_control_commands;
CREATE UNIQUE INDEX one_pending_radio_control ON radio_control_commands(radio_id) WHERE state IN ('pending','delivered');
CREATE INDEX control_command_expiry ON radio_control_commands(expires);

-- Client references allow cancel-before-response and retry without a second
-- physical approval prompt. These are transient receipts, not permissions.
CREATE TABLE radio_control_requests (
 session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 radio_id TEXT NOT NULL REFERENCES radios(id) ON DELETE CASCADE,
 claim_id TEXT REFERENCES pair_claims(id) ON DELETE SET NULL,
 state TEXT NOT NULL CHECK(state IN ('active','cancelled')),
 created_at INTEGER NOT NULL,
 expires INTEGER NOT NULL,
 PRIMARY KEY(session_hash,request_id)
);
CREATE INDEX radio_control_request_expiry ON radio_control_requests(expires);
