-- Safe provider metadata only: never provider messages, prompts, or credentials.
CREATE TABLE IF NOT EXISTS ai_service_health (
 name TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 code TEXT NOT NULL,
 http_status INTEGER NOT NULL,
 parameter TEXT NOT NULL DEFAULT '',
 updated_at INTEGER NOT NULL
);
