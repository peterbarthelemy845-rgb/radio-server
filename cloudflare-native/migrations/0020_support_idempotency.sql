-- A browser's stable per-draft ID makes uncertain-response retries safe. The
-- operation token gates the ticket, access grant and receipt in one D1 batch.
-- ticket_id is an opaque reference rather than a foreign key so the guard can
-- be inserted before its ticket inside the same atomic batch.
CREATE TABLE IF NOT EXISTS support_ticket_requests (
 session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 ticket_id TEXT NOT NULL UNIQUE,
 operation_token TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires INTEGER NOT NULL,
 PRIMARY KEY(session_hash,request_id)
);
CREATE INDEX IF NOT EXISTS support_ticket_request_expiry ON support_ticket_requests(expires);
