-- Multiple browser draft IDs can safely point to one duplicate problem ticket.
ALTER TABLE support_ticket_requests RENAME TO support_ticket_requests_legacy;
CREATE TABLE support_ticket_requests (
 session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,ticket_id TEXT NOT NULL,
 operation_token TEXT NOT NULL,created_at INTEGER NOT NULL,expires INTEGER NOT NULL,
 PRIMARY KEY(session_hash,request_id)
);
INSERT INTO support_ticket_requests SELECT * FROM support_ticket_requests_legacy;
DROP TABLE support_ticket_requests_legacy;
CREATE INDEX support_ticket_request_expiry ON support_ticket_requests(expires);
CREATE TABLE support_sender_grants (
 session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 email_hash TEXT NOT NULL,verified_at INTEGER NOT NULL,expires INTEGER NOT NULL,
 PRIMARY KEY(session_hash,email_hash)
);
CREATE TABLE support_pending_tickets (
 id TEXT PRIMARY KEY,session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 request_id TEXT NOT NULL,email_hash TEXT NOT NULL,payload_hash TEXT NOT NULL,
 encrypted_payload TEXT NOT NULL,code_hash TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
 expires INTEGER NOT NULL,consumed_at INTEGER,operation_token TEXT,
 created_at INTEGER NOT NULL,sent_at INTEGER NOT NULL,
 UNIQUE(session_hash,request_id)
);
CREATE INDEX support_pending_expiry ON support_pending_tickets(expires);
-- Problem keys are opaque guards inserted before their ticket in one batch.
CREATE TABLE support_problem_keys(problem_hash TEXT PRIMARY KEY,ticket_id TEXT NOT NULL,created_at INTEGER NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE support_sender_activity(email_hash TEXT PRIMARY KEY,last_ticket_at INTEGER NOT NULL,operation_token TEXT);
-- Failed proofs block only this browser + recipient combination, not everyone
-- sharing its IP or the unrelated owner of a forged recipient address.
CREATE TABLE support_abuse_blocks(session_hash TEXT NOT NULL,email_hash TEXT NOT NULL,expires INTEGER NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(session_hash,email_hash));
CREATE TABLE support_ticket_flags(ticket_id TEXT PRIMARY KEY REFERENCES legal_requests(id),folder TEXT NOT NULL DEFAULT 'inbox' CHECK(folder IN ('inbox','spam')),reason TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL,actor_hash TEXT);
CREATE INDEX support_ticket_folder ON support_ticket_flags(folder,updated_at);
CREATE TABLE support_folder_actions(id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES legal_requests(id),request_id TEXT NOT NULL,request_hash TEXT NOT NULL,operation_token TEXT NOT NULL,actor_hash TEXT NOT NULL,folder TEXT NOT NULL CHECK(folder IN ('inbox','spam')),created_at INTEGER NOT NULL,UNIQUE(ticket_id,request_id));
CREATE TRIGGER support_flag_ai_insert AFTER INSERT ON support_ticket_flags BEGIN
 UPDATE ai_ticket_assistance SET epoch=epoch+1,dirty=CASE WHEN NEW.folder='spam' THEN 0 ELSE 1 END,lease_token='',lease_until=0,attempts=0,next_at=0,source_revision='',encrypted_result='',generated_at=0 WHERE ticket_id=NEW.ticket_id;
END;
CREATE TRIGGER support_flag_ai_change AFTER UPDATE OF folder ON support_ticket_flags BEGIN
 UPDATE ai_ticket_assistance SET epoch=epoch+1,dirty=CASE WHEN NEW.folder='spam' THEN 0 ELSE 1 END,lease_token='',lease_until=0,attempts=0,next_at=0,source_revision='',encrypted_result='',generated_at=0 WHERE ticket_id=NEW.ticket_id;
END;
