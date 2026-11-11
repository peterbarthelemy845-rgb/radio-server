-- Keep the last approved station public until an exact proposed edit is approved.
CREATE TABLE station_edits (
 station_code INTEGER PRIMARY KEY REFERENCES stations(code),
 revision TEXT NOT NULL CHECK(length(revision)=32),
 base_updated_at INTEGER NOT NULL,
 stream_url TEXT NOT NULL,
 bio TEXT NOT NULL DEFAULT '',
 artwork_key TEXT,
 created_at INTEGER NOT NULL
);
CREATE TRIGGER station_edits_clear_blocked AFTER UPDATE OF status ON stations
 WHEN NEW.status IN ('suspended','deleted')
 BEGIN DELETE FROM station_edits WHERE station_code=NEW.code; END;
