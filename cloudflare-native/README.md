# Independent Cloudflare backend — migration work in progress

This directory has **no Render dependency**. It is an isolated test backend, not
yet a replacement for the live website. Do not point radiolocals.com at it yet.

Created D1 database: `radio-locals-native`
ID: `c23a0beb-c018-4586-83f4-bf6e75117a70`.
Initial schema was applied to the fresh database through the Cloudflare console.
No existing user data was deleted, exported, or imported.

Private R2 bucket: `radio-locals-private-media`. No public bucket URL, CORS rules,
or external API keys are enabled. MEDIA is bound only to the native test Worker.
Artwork GET requires a published station reference and a sanitized PNG object
with trusted sanitizer metadata. There is no raw-upload serving route. The
sanitizing upload and moderation pipeline is still required before uploads open.

Create a **separate** Worker with the existing repository:

- Name: `radio-locals-native`
- Branch: `codex/cloudflare-migration`
- Root directory: `cloudflare-native`
- Build command: empty
- Deploy command: `npx wrangler deploy`

Do not change the `radio-server` Worker's root directory. It serves the current site.
Subsequent schema versions: `npx wrangler d1 migrations apply radio-locals-native --remote`.
The initial console-applied migration is idempotent; apply it through migrations
before subsequent versions to record Wrangler's migration ledger.

Implemented and tested against real SQLite using a D1-shaped adapter:

- Public published-station listing and numeric code lookup (no private emails).
- Database-backed rate limits shared across Worker invocations.
- Authenticated device polling, physical phone approval decisions, command leases,
  device-scoped acknowledgments, and unlink/revocation.
- Hourly expiry cleanup using a scheduled Worker handler.
- Fail-closed responses for every unimplemented route; no fallback proxy.

Test command: `node --test worker.test.mjs` (Node with node:sqlite support).

## Required before production cutover

- Native website pages preserving the existing appearance and navigation.
- Session/CSRF lifecycle and strict Origin validation for browser writes.
- Device registration, code allocation, browser claim and command enqueue routes.
- Owner registration/editing, expiring email codes, attempt limits, mail delivery
  retries with encrypted outbox payloads, and Cloudflare Turnstile validation.
- R2 private artwork upload storage, safe image decoding/re-encoding, moderation,
  media grants and ad artwork delivery. Unscanned uploads must stay unpublished.
- Admin MFA/session management and moderation, legal removal/complaints, station
  rights acceptance, Support page, reports, local ads, usage measurement.
- Backups and restoration, privacy/retention review, verified sender test delivery.
- Full integration tests and physical-radio validation on a staging hostname.
- Explicit traffic cutover, old-URL compatibility where still needed, rollback.

The EMAIL binding restricts the sender to info@radiolocals.com. There is deliberately
no public mail-sending endpoint. The live SMTP credential is not needed in this
Worker and has not been copied into this repository or Render.
