-- Browser-reported share-sheet outcomes are not delivery/read confirmations.
-- Keep the initiating session scoped to its own event; never store recipients.
CREATE TABLE IF NOT EXISTS share_event_states (
 event_id TEXT PRIMARY KEY REFERENCES share_events(id) ON DELETE CASCADE,
 session_hash TEXT NOT NULL,
 outcome TEXT NOT NULL DEFAULT 'attempted' CHECK(outcome IN ('attempted','share_sheet_completed','cancelled','link_copied','manual_link_shown')),
 reported_at INTEGER NOT NULL
);
