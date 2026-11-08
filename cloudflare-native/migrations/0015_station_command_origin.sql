-- Attribution lets unlink/logout revoke only the initiating phone's queued additions.
ALTER TABLE radio_commands ADD COLUMN session_hash TEXT REFERENCES sessions(token_hash);
CREATE INDEX station_command_origin ON radio_commands(session_hash,radio_id,state);
-- Older queued commands cannot be safely attributed to a still-authorized phone.
-- Users may add those stations again from a linked phone after the upgrade.
UPDATE radio_commands SET state='failed' WHERE session_hash IS NULL AND state IN ('pending','delivered');
