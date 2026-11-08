-- Expiry scans and FK checks used by the bounded transient-credential cleanup.
CREATE INDEX IF NOT EXISTS email_verifications_expiry ON email_verifications(expires);
CREATE INDEX IF NOT EXISTS registration_requests_verification ON registration_requests(verification_id);
CREATE INDEX IF NOT EXISTS admin_verifications_expiry ON admin_verifications(expires);
CREATE INDEX IF NOT EXISTS admin_verifications_session ON admin_verifications(session_hash);
CREATE INDEX IF NOT EXISTS admin_email_proofs_expiry ON admin_email_proofs(expires);
CREATE INDEX IF NOT EXISTS admin_email_proofs_session ON admin_email_proofs(session_hash);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires);
CREATE INDEX IF NOT EXISTS admin_mfa_sessions_expiry ON admin_mfa_sessions(expires);
CREATE INDEX IF NOT EXISTS admin_mfa_used_counter ON admin_mfa_used(counter);
CREATE INDEX IF NOT EXISTS support_grants_expiry ON support_grants(expires);
CREATE INDEX IF NOT EXISTS support_status_verifications_expiry ON support_status_verifications(expires);
CREATE INDEX IF NOT EXISTS pair_claims_expiry ON pair_claims(expires);
CREATE INDEX IF NOT EXISTS pair_claims_session ON pair_claims(session_hash);
CREATE INDEX IF NOT EXISTS phone_radios_expiry ON phone_radios(expires);
CREATE INDEX IF NOT EXISTS radio_control_grants_expiry ON radio_control_grants(expires);
