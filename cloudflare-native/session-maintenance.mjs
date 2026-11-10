// Transient credentials are not audit records. Retain expired proofs for seven
// days, then drain small batches so an old backlog cannot monopolize a cron run.
// Stations, rights acceptances, support correspondence and reports are untouched.
export function sessionCleanupStatements(env,now){
 const cutoff=now-7*86400,db=env.DB;
 return [
  db.prepare('DELETE FROM registration_requests WHERE rowid IN (SELECT rowid FROM registration_requests WHERE expires<=? ORDER BY expires LIMIT 200)').bind(now),
  db.prepare('DELETE FROM support_ticket_grants WHERE rowid IN (SELECT rowid FROM support_ticket_grants WHERE expires<=? ORDER BY expires LIMIT 200)').bind(now),
  db.prepare('DELETE FROM phone_pair_requests WHERE rowid IN (SELECT rowid FROM phone_pair_requests WHERE expires<=? ORDER BY expires LIMIT 200)').bind(now),
  db.prepare(`DELETE FROM phone_pair_grant_sources WHERE rowid IN (SELECT s.rowid FROM phone_pair_grant_sources s WHERE s.expires<=?
   OR NOT EXISTS(SELECT 1 FROM phone_radios p WHERE p.session_hash=s.session_hash AND p.radio_id=s.radio_id AND p.expires>?) ORDER BY s.expires LIMIT 200)`).bind(now,now),
  db.prepare('DELETE FROM support_status_verifications WHERE id IN (SELECT id FROM support_status_verifications WHERE expires<=? ORDER BY expires LIMIT 200)').bind(cutoff),
  db.prepare("UPDATE email_verifications SET code_hash='' WHERE id IN (SELECT id FROM email_verifications WHERE code_hash!='' AND (expires<=? OR consumed_at IS NOT NULL) LIMIT 200)").bind(now),
  db.prepare('DELETE FROM email_verifications WHERE id IN (SELECT e.id FROM email_verifications e WHERE e.expires<=? AND NOT EXISTS(SELECT 1 FROM registration_requests r WHERE r.verification_id=e.id) ORDER BY e.expires LIMIT 200)').bind(cutoff),
  db.prepare('DELETE FROM admin_verifications WHERE id IN (SELECT id FROM admin_verifications WHERE expires<=? ORDER BY expires LIMIT 200)').bind(cutoff),
  db.prepare('DELETE FROM admin_email_proofs WHERE id IN (SELECT id FROM admin_email_proofs WHERE expires<=? ORDER BY expires LIMIT 200)').bind(cutoff),
  db.prepare('DELETE FROM admin_sessions WHERE session_hash IN (SELECT session_hash FROM admin_sessions WHERE expires<=? ORDER BY expires LIMIT 200)').bind(now),
  db.prepare('DELETE FROM admin_mfa_sessions WHERE session_hash IN (SELECT session_hash FROM admin_mfa_sessions WHERE expires<=? ORDER BY expires LIMIT 200)').bind(now),
  db.prepare('DELETE FROM support_grants WHERE session_hash IN (SELECT session_hash FROM support_grants WHERE expires<=? ORDER BY expires LIMIT 200)').bind(now),
  db.prepare('DELETE FROM pair_claims WHERE id IN (SELECT id FROM pair_claims WHERE expires<=? ORDER BY expires LIMIT 200)').bind(cutoff),
  db.prepare('DELETE FROM radio_control_commands WHERE id IN (SELECT id FROM radio_control_commands WHERE expires<=? ORDER BY expires LIMIT 200)').bind(cutoff),
  db.prepare('DELETE FROM radio_control_grants WHERE rowid IN (SELECT rowid FROM radio_control_grants WHERE expires<=? ORDER BY expires LIMIT 200)').bind(now),
  // Do not trigger an unbounded command-history cascade for a busy old phone.
  db.prepare('DELETE FROM phone_radios WHERE rowid IN (SELECT p.rowid FROM phone_radios p WHERE p.expires<=? AND NOT EXISTS(SELECT 1 FROM radio_control_commands c WHERE c.session_hash=p.session_hash AND c.radio_id=p.radio_id) ORDER BY p.expires LIMIT 200)').bind(now),
  // Keep confirmed station-add history, but let its retired credential disappear.
  db.prepare("UPDATE radio_commands SET session_hash=NULL WHERE id IN (SELECT c.id FROM radio_commands c JOIN sessions s ON s.token_hash=c.session_hash WHERE s.expires<=? AND c.expires<=? AND c.state IN ('added','failed','expired') AND NOT EXISTS(SELECT 1 FROM phone_radios p WHERE p.session_hash=s.token_hash AND p.expires>?) LIMIT 200)").bind(cutoff,now,now),
  db.prepare(`DELETE FROM sessions WHERE token_hash IN (SELECT s.token_hash FROM sessions s WHERE s.expires<=?
   AND NOT EXISTS(SELECT 1 FROM registration_requests r WHERE r.session_hash=s.token_hash)
   AND NOT EXISTS(SELECT 1 FROM email_verifications e WHERE e.session_hash=s.token_hash)
   AND NOT EXISTS(SELECT 1 FROM admin_verifications a WHERE a.session_hash=s.token_hash)
   AND NOT EXISTS(SELECT 1 FROM admin_email_proofs a WHERE a.session_hash=s.token_hash)
   AND NOT EXISTS(SELECT 1 FROM admin_sessions a WHERE a.session_hash=s.token_hash)
   AND NOT EXISTS(SELECT 1 FROM admin_mfa_sessions a WHERE a.session_hash=s.token_hash)
   AND NOT EXISTS(SELECT 1 FROM support_grants g WHERE g.session_hash=s.token_hash)
   AND NOT EXISTS(SELECT 1 FROM support_ticket_grants g WHERE g.session_hash=s.token_hash)
   AND NOT EXISTS(SELECT 1 FROM support_status_verifications v WHERE v.session_hash=s.token_hash)
   AND NOT EXISTS(SELECT 1 FROM pair_claims c WHERE c.session_hash=s.token_hash)
   AND NOT EXISTS(SELECT 1 FROM phone_pair_requests r WHERE r.session_hash=s.token_hash)
   AND NOT EXISTS(SELECT 1 FROM phone_pair_grant_sources g WHERE g.session_hash=s.token_hash)
   AND NOT EXISTS(SELECT 1 FROM phone_radios p WHERE p.session_hash=s.token_hash)
   AND NOT EXISTS(SELECT 1 FROM radio_commands c WHERE c.session_hash=s.token_hash)
   ORDER BY s.expires LIMIT 200)`).bind(cutoff),
  db.prepare('DELETE FROM admin_mfa_used WHERE rowid IN (SELECT rowid FROM admin_mfa_used WHERE counter<=? ORDER BY counter LIMIT 200)').bind(Math.floor(cutoff/30))
 ];
}
