CREATE TABLE IF NOT EXISTS device_enrollments(token_hash TEXT PRIMARY KEY,expires INTEGER NOT NULL,consumed_at INTEGER,radio_id TEXT);
