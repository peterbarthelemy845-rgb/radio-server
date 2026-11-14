-- AI suggestions are separate from support records and never authorize a send.
CREATE TABLE IF NOT EXISTS ai_ticket_assistance (
 ticket_id TEXT PRIMARY KEY REFERENCES legal_requests(id) ON DELETE CASCADE,
 epoch INTEGER NOT NULL DEFAULT 0,
 dirty INTEGER NOT NULL DEFAULT 1,
 lease_token TEXT NOT NULL DEFAULT '',
 lease_until INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL DEFAULT 0,
 source_revision TEXT NOT NULL DEFAULT '',
 encrypted_result TEXT NOT NULL DEFAULT '',
 generated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ai_ticket_work ON ai_ticket_assistance(dirty,next_at,lease_until);
INSERT OR IGNORE INTO ai_ticket_assistance(ticket_id) SELECT id FROM legal_requests WHERE kind='support' AND state!='closed';
CREATE TRIGGER IF NOT EXISTS ai_ticket_insert AFTER INSERT ON legal_requests WHEN NEW.kind='support' AND NEW.state!='closed'
 BEGIN INSERT OR IGNORE INTO ai_ticket_assistance(ticket_id) VALUES (NEW.id); END;
CREATE TRIGGER IF NOT EXISTS ai_ticket_change AFTER UPDATE OF encrypted_payload,state,kind ON legal_requests
 BEGIN
 INSERT INTO ai_ticket_assistance(ticket_id,dirty) SELECT NEW.id,CASE WHEN NEW.state='closed' OR NEW.kind!='support' THEN 0 ELSE 1 END
 WHERE NEW.kind='support' OR EXISTS(SELECT 1 FROM ai_ticket_assistance WHERE ticket_id=NEW.id)
 ON CONFLICT(ticket_id) DO UPDATE SET epoch=epoch+1,dirty=excluded.dirty,lease_token='',lease_until=0,attempts=0,next_at=0,source_revision='',encrypted_result='',generated_at=0;
 END;
CREATE TRIGGER IF NOT EXISTS ai_ticket_reply AFTER INSERT ON support_replies
 WHEN EXISTS(SELECT 1 FROM legal_requests WHERE id=NEW.ticket_id AND kind='support' AND state!='closed')
 BEGIN
 INSERT INTO ai_ticket_assistance(ticket_id) VALUES (NEW.ticket_id)
 ON CONFLICT(ticket_id) DO UPDATE SET epoch=epoch+1,dirty=1,lease_token='',lease_until=0,attempts=0,next_at=0,source_revision='',encrypted_result='',generated_at=0;
 END;
