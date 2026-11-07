CREATE TABLE IF NOT EXISTS support_replies (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES legal_requests(id),
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  operation_token TEXT NOT NULL,
  actor_hash TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('new','review','closed')),
  outbox_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(ticket_id,request_id)
);
CREATE INDEX IF NOT EXISTS support_replies_ticket ON support_replies(ticket_id,created_at);
