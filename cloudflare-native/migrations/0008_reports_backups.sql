CREATE TABLE IF NOT EXISTS listening_sessions(radio_id TEXT PRIMARY KEY REFERENCES radios(id),station_code INTEGER NOT NULL REFERENCES stations(code),started INTEGER NOT NULL,last_seen INTEGER NOT NULL,qualified INTEGER NOT NULL DEFAULT 0,credit INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS listening_daily(day TEXT NOT NULL,station_code INTEGER NOT NULL REFERENCES stations(code),reported_seconds INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,station_code));
CREATE TABLE IF NOT EXISTS share_events(id TEXT PRIMARY KEY,station_code INTEGER NOT NULL REFERENCES stations(code),channel TEXT NOT NULL CHECK(channel IN ('facebook','whatsapp','more')),created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS shares_station_time ON share_events(station_code,created_at);
CREATE TABLE IF NOT EXISTS backup_runs(id TEXT PRIMARY KEY,day TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,completed_at INTEGER,record_count INTEGER,media_count INTEGER,error TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS daily_backup_once ON backup_runs(day) WHERE kind='daily';
