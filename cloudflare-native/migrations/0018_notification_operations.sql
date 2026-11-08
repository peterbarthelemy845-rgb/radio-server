-- A notification's deduplication key is not an authorization for side effects.
-- These private operation markers exist only within an atomic decision batch.
CREATE TABLE IF NOT EXISTS notification_operations (id TEXT PRIMARY KEY);
CREATE INDEX IF NOT EXISTS legal_requests_page ON legal_requests(created_at DESC,id DESC);
