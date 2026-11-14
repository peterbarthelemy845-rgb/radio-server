-- Private, transient AI assistance. Inputs and API credentials are never stored.
CREATE TABLE IF NOT EXISTS ai_usage (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 day TEXT NOT NULL,
 month TEXT NOT NULL,
 reserved_cents INTEGER NOT NULL CHECK(reserved_cents=1),
 created_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','complete','failed'))
);
CREATE INDEX IF NOT EXISTS ai_usage_day ON ai_usage(day);
CREATE INDEX IF NOT EXISTS ai_usage_month ON ai_usage(month);
CREATE TABLE IF NOT EXISTS ai_results (
 cache_key TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('working','ready','failed')),
 lease TEXT NOT NULL,
 lease_until INTEGER NOT NULL,
 encrypted_payload TEXT NOT NULL DEFAULT '',
 generated_at INTEGER NOT NULL,
 expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_results_expiry ON ai_results(expires);
