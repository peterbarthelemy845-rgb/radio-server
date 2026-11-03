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

Registration/login migration now also implements:

- Secure host-only cookies, origin and CSRF checks, D1-backed owner sessions.
- Separate expiring single-use email codes, five guesses maximum, resend limits,
  and an encrypted durable mail outbox with leased retries via native EMAIL binding.
- Private image decode/re-encode via IMAGES into PNG, four-megapixel/3-MB input
  limits, nonpublic R2 storage. New stations and edits wait for safety review.
- Compact registration, login, verification dialog and owner editing test pages.
- Owner-scoped updates and logout; ordinary visits never reopen verification.

Shared-station migration now includes `/station/{station_code}` and phone claim,
claim status, station enqueue and command status routes. Pairing requires a
Turnstile check, strict attempt limits, and physical approval by the authenticated
radio. The one-page browser flow waits for radio acknowledgment before showing
success. Device enrollment/code generation and physical staging-radio validation
are still outstanding; do not switch production or firmware to this backend yet.

The native Worker requires DATA_ENCRYPTION_KEY (64 lowercase hex characters) and
TURNSTILE_SECRET_KEY stored as secrets, plus TURNSTILE_SITE_KEY as a public variable.
Never reuse the session/encryption key in client code or log it. Add the exact
staging Worker hostname to the Turnstile widget before testing. API checks are
strict: token hostname must equal the request hostname and action must match.
Image transformations may require activation of the account's Images feature.
No real mail is sent by the automated tests.

Test command: `node --test worker.test.mjs` (Node with node:sqlite support).

## Required before production cutover

Staging admin: `/admin`, with ADMIN_EMAIL restricted to the configured owner.
Email-code sign-in grants 15-minute admin sessions; this is not MFA. Turnstile,
CSRF/origin protection, five OTP attempts, single-use codes, reviewed-content
revision checks and an action audit apply. Admins can approve verified pending
stations, suspend them, or soft-delete them. Station owners can soft-delete only
their own station after explicit confirmation. Records and private artwork are
retained; deletion removes directory/artwork access and cancels pending commands.
Migration 0002_admin.sql was applied to staging through the D1 console.
Production admin MFA/Access protection remains a cutover requirement.

- Complete the Radio/Library/shared station pages and legal/Support content.
- Device registration, code allocation, browser claim and command enqueue routes.
- Connect automatic moderation, media grants and ad artwork delivery.
  Unscanned uploads must stay unpublished; current native uploads wait for review.
- Admin MFA/session management and moderation, legal removal/complaints, station
  rights acceptance, Support page, reports, local ads, usage measurement.
- Backups and restoration, privacy/retention review, verified sender test delivery.
- Full integration tests and physical-radio validation on a staging hostname.
- Explicit traffic cutover, old-URL compatibility where still needed, rollback.

The EMAIL binding restricts the sender to info@radiolocals.com. There is deliberately
no public mail-sending endpoint. The live SMTP credential is not needed in this
Worker and has not been copied into this repository or Render.
