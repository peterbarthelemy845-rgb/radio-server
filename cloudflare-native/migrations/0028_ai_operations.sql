-- These records are operational observations, never station approval proofs.
CREATE TABLE IF NOT EXISTS ai_operation_leases (
  job_key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  lease_until INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_stream_health (
  station_code INTEGER PRIMARY KEY REFERENCES stations(code),
  stream_hash TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('audio_response','not_confirmed')),
  reason TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  next_check_at INTEGER NOT NULL,
  last_change_at INTEGER NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  explanation TEXT NOT NULL DEFAULT '',
  explanation_state TEXT NOT NULL DEFAULT 'none'
);
CREATE INDEX IF NOT EXISTS ai_stream_health_due ON ai_stream_health(next_check_at,station_code);
CREATE TABLE IF NOT EXISTS ai_report_summaries (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  day TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('ready','unavailable')),
  generated_at INTEGER NOT NULL,
  metrics_json TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ai_report_recent ON ai_report_summaries(generated_at DESC);
