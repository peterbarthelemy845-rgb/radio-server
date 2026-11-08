# Cloudflare advertising, reports and recovery

These features use D1, private R2, Cloudflare Images and the existing moderation
credential. They do not use the Render database or its station codes. Apply
0007_local_ads.sql and 0008_reports_backups.sql before deploying this release.
The migrations are idempotent; the current production D1 console has applied them.

## Advertising

Published Library cards link to /advertise/{current-code}. A business supplies
its text, contact email, optional phone, dates and image. The server validates
and re-encodes the image, scans text and sanitized artwork, and prepares a
256 × 76 RGB565 image for the radio. No executable uploads, advertiser HTML,
external image URLs or scripts are delivered to the device.

Safe submissions still require station-owner approval. Flagged/unscanned ads
require MFA administrator safety clearance and then owner approval. Owners can
approve or soft-delete only their own ads. Deletion frees the live quota.
Pilot limits are 20 undeleted ads per station and 200 overall, with rate limits.
Admin safety decisions are audited. Default duration is 30 days; custom dates
are UTC and limited to 90 days.

Per-radio bearer credentials protect ad delivery. Image tokens expire after
60 seconds and also require the matching device credential. Display receipts
are deduplicated. Server delivery frequency is no more than one every 30 minutes;
the existing firmware additionally waits ten listening minutes and closes the
screen popup after eight seconds. The physical radio still needs its updated
Cloudflare firmware and a hardware test; the API/pixel/receipt flow is tested
with authenticated simulated radios.

## Reports

Owner editor: Listening & sharing reports. Admin: Station reports.
An authenticated poll's playing_station_code drives activity. The server requires
continuous reports for 60 seconds, resets after a gap over 90 seconds, rejects
duplicate timestamps, and counts distinct radio IDs per station per UTC calendar
month. Reported duration and reporting-now counts are not verified humans or
independent audio measurements. Only updated firmware supplies these reports.

Sharing counts mean button clicks, not confirmed delivery or a completed social
share. Click IDs deduplicate events; IP/session rate limits restrict abuse.
No raw IPs or visitor identifiers are stored in share_events. Share detail is
retained for 93 days. Billing is disabled; prices are informational proposals.

## Backup and recovery

Admin MFA is required for list/create/restore. The first snapshot starts on the
next scheduled run; daily snapshots run at 05:00 UTC and are retained 14 days.
Manual creation is also available. Data manifests use authenticated encryption
with DATA_ENCRYPTION_KEY; referenced R2 media are independently copied into a
private snapshot prefix. Preserve this encryption secret in the Cloudflare
account: it is intentionally not inside snapshots.

Restore is a transactional merge: saved records replace matching IDs and newer
records not in the snapshot remain. It is not a destructive point-in-time reset.
Media are checked before database changes. Owner grants and phone pairings are
revoked after restore. The administrator must type RESTORE. Live production
restore must not be used as a smoke test; restoration is covered by isolated tests.

This initial implementation caps a snapshot at 3,000 records, 1,000 per table,
100 media files, 50 MB media and 8 MB manifest. Oversized/incomplete snapshots
fail visibly. It backs up persistent app data, not active login challenges,
admin MFA secrets, Cloudflare account configuration or application source.
Snapshots remain in the same Cloudflare account; this is not an off-account
disaster-recovery copy. D1/R2 deployment access and GitHub source are separate.

## Remaining migration work

Finish and physically test the ESP32 firmware on radiolocals.com. Retire obsolete
Render endpoints/static files and verify any remaining AdSense/sponsor-demo paths
before disconnecting Render. No old station database import is planned: the owner
explicitly requested a fresh directory.


## Saved station reports and support receipts (2026-11-07)
Apply migrations through 0010_saved_inventory.sql before publishing the new Worker. Radios running the updated sketch send a complete saved_station_codes snapshot on authenticated polls. Missing reports stay unknown; an empty report means no saved directory stations. Phone inventory queries require an active grant. Legacy/manual stations without directory codes are not included. Older encrypted backups without this table remain restorable.

Support tickets atomically queue a plain-text receipt from info@radiolocals.com with the ticket reference, excluding the submitted message and device/security codes. The existing leased mail outbox sends immediately after accepted submissions and retries from the scheduled Worker. Queue acceptance is not delivery confirmation; inspect mail_outbox failures if a user reports no receipt. Per-recipient submissions are limited to three per hour. Retired support passcode routes return 404; Support remains public.

## App, support and moderation improvements (2026-11-07)

Apply migrations through 0011_support_replies.sql before this release. Support replies require the existing administrator email and authenticator proofs plus CSRF on writes. The recipient comes only from the original encrypted support ticket; a client cannot change it. Each bounded reply/status change has an idempotency key and commits with its encrypted thread entry, audit and email queue job. Provider-accepted is not proof that a message was read. Incoming mailbox replies are not synchronized into these threads. Legal complaints retain their separate review workflow.

The admin overview shows aggregate pending station/ad counts, open tickets, recently reporting radios and failed/queued emails. It does not reveal private recipient or message data. Station and ad decisions notify only the verified registered station owner. Reasons are short plain text without links or security details. A repeated unchanged decision or stale revision cannot produce another email. Outbox delivery still has bounded retries.

Backups now include encrypted support correspondence. Restore never requeues sent correspondence. Older snapshots that predate this table preserve existing reply rows, while malformed or incomplete new table data is rejected.

Support includes three original, silent illustrated MP4 guides with burned-in instructions, optional English captions and readable steps. They are explicitly labeled illustrated guides, not physical-radio recordings. Videos use preload=none. Additional admin-managed YouTube tutorials remain available.

Home-screen installation uses manifest.webmanifest and original logo-derived app icons. The service worker caches only a generic offline page and its allowlisted CSS/retry/icon assets. API responses, radio status, private artwork, admin/owner pages and commands are never cached or queued offline. A public offline notice is shown on failed navigation; no status is invented. Install through the browser menu; the Radio page intentionally has no installation button. Installed iPhone/Android and physical-radio checks remain separate from automated/browser QA.

## Remote controls, localization, release notices and ticket access (2026-11-07)

Apply 0012_radio_controls.sql and 0013_support_ticket_access.sql before deployment. Existing phone grants remain station-add only. A capable online radio must physically approve a separate controls claim with an explicit control scope; legacy firmware cannot grant it by sending an ordinary approval. Controls support only a published station in the latest reported saved list, an absolute volume from 0 to 100, or an absolute mute boolean. Commands are browser/grant scoped, serialized, deduplicated, leased and expire after 60 seconds. The optional control module waits for the authenticated radio acknowledgement and does not promise audible playback. The public website no longer loads this module or displays a Radio controls button; server and firmware control support remain available for future app integration. Every poll supplies control_valid_id independent of delivery lease; firmware discards deferred commands whose scope has been revoked or expired. Command records expire from storage after seven days.

Latest radio telemetry is private to linked phones. radio-release.json points to the source-only waveshare-radio.zip, never a compiled image containing local provisioning data. A normal upload preserves enrolled identity in NVS; an erased/unenrolled radio needs a new one-time enrollment. Compiling and host state checks do not replace physical-radio testing.

Support ticket status is limited to browser-bound 30-minute grants. New submissions receive a grant transactionally. Another browser must complete a single-use, 15-minute email challenge with five attempts, Turnstile and rate limits. Only support original/reply content is shown, not legal complaints, email/device data or internal notes. Temporary grants and challenges are excluded from snapshots and deleted on restore/expiry.

English/Haitian Creole interface strings and guide captions are bundled locally. No translation API receives user content. Station names, bios and private messages remain unchanged. The selected language is a nonsensitive local preference; legal source pages and existing email templates remain English.

For every future UI release, bump APP_RELEASE in public/assets/app-update.js and the matching public/assets/app-release.json version together. Old open pages check periodically and on resume. A notice never forces a reload; unfinished forms, dialogs and active radio requests disable Refresh until the work is finished. Only public search/scroll can cross a deliberate safe refresh. This postpones an update rather than storing private form drafts.

## Station registration and optional stream checking

The compact registration card accepts a complete listening URL first and synchronizes its hostname, port, protocol and mount path into a collapsed Manual IP / Port setup. Manual changes compose the same editable stream_url field; a blank manual path means /, never an assumed /live mount. HTTP is preserved when supplied. Both raw and normalized URLs are limited to 1,024 characters to match the current radio. Private, loopback, reserved and credential-bearing addresses are rejected. The optional test explains that numeric IP and playlist links cannot be confirmed automatically, and never gates Save. PNG/JPG/WebP logo uploads remain limited to 3 MB and four megapixels, with the existing normalization, screening and email-verification flow.

POST /api/owner/stream-check requires browser CSRF, per-session/IP/global early limits and Turnstile action stream-check. It does not play audio or gate Save. Keep compatibility_flags global_fetch_strictly_public and STREAM_CHECK_PUBLIC_FETCH=true together; the latter is an explicit deployment attestation and the route fails closed without it. Only public global fetch is used, never a service/VPC binding. Requests send no user headers, revalidate at most two redirects, reject own-host and HTTPS downgrades, and cancel after six seconds or an 8 KiB sample. Audio framing plus response type can confirm an audio response; it cannot certify playback on a physical radio. Public numeric IP streams remain saveable, but optional automatic testing is not supported for them by Workers fetch. No upstream body or provider error is returned or stored.

Public-fetch routing requirement: https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public

## Signup reliability and validation (2026-11-08)

Apply 0014_registration_requests.sql before deploying this release. Signup retry keys are scoped to the browser session and a hash of the submitted details; matching retries reuse the existing verification challenge instead of creating another station, image or email. Explicit keys are random and remain in memory only. Older open forms receive a session-bound derived key. Processing leases prevent concurrent duplicate writes. The 24-hour request cache is ephemeral, excluded from backups, and cleared on restore/expiry. It contains hashes and record references, not raw artwork or plaintext codes.

Station creation, rights acceptance, verification challenge and queued email commit in one D1 transaction. Consuming the email code and granting the matching owner session also commit together. OTP attempt limits, Turnstile, CSRF and moderation remain enforced. Station names are limited to 96 UTF-8 bytes without control characters, matching the current radio.

Signup fields lock during submission. Verification and resend share one request lock and ignore stale responses. Accepted email verification shows a success dialog even if the station editor cannot load; the dialog offers a retry. Client logo checks reject unsupported, oversized, undecodable or over-four-megapixel images before bot checks; server sanitization and screening remain authoritative. Errors appear inside the signup card. Session initialization is shared with startup so a slow directory request cannot prevent signup or race a second session cookie.


## Revocation and failure recovery (2026-11-08)

Apply 0015_station_command_origin.sql and 0016_current_station_presence.sql before deploying release 2026.11.08.5. Station-add commands now retain the initiating browser session. Unlink and logout atomically cancel that phone's pending pairing requests and queued additions, while preserving other linked phones. Enqueue and delivery recheck the originating grant inside the SQL statement. Commands created before attribution was available are failed closed by migration 0015 and may be requested again. Already executing firmware actions cannot be recalled by this server update.

Migration 0016 distinguishes an omitted current-station telemetry field from an explicit report of no station. Older firmware retains the recent-listening fallback; explicit empty station reports clear it. Device code allocation starts at four digits and expands after repeated collisions without rotating existing stable codes.

Admin email proof creation and MFA grants commit with their one-time code consumption. A failed transaction leaves the proof usable within its existing expiry and attempt limit. Station deletion likewise commits the deletion, pending-command cancellation, owner-session revocation and code consumption together. Deletion email resends preserve deletion-only scope and clearly identify the requested action.

The public directory refreshes on return to Radio and after station changes, ignores stale responses, and preserves its last good list with a visible retry on failure. Directory and session failures cannot suppress Radio/Support initialization. Support verification locks duplicate requests and ignores responses after cancellation or replacement of the challenge.


## Storage, enrollment and edit safeguards (2026-11-08, release 2026.11.08.6)

Apply 0017_session_retention_indexes.sql before deployment. Its indexes support bounded transient-credential maintenance; it does not delete station records. Sessions retain their existing 30-day lifetime. Expired session/proof records have a seven-day cleanup grace and drain in batches of at most 200 rows per table per run. Active child grants prevent parent removal. Old station-add history remains, with retired session references detached. Stations, rights acceptances, administrator audit and support records remain intact. A shared creation-only limit bounds new browser/native sessions without blocking existing sessions; per-IP and bot checks remain enforced.

Factory enrollment has a short global attempt window and existing per-IP limit. Only valid unused unexpired enrollment permissions consume the 200-per-day authorized allowance, so invalid-token requests cannot exhaust that allowance. Idempotent retries for the already-enrolled matching credential do not consume it again.

Owner edits compare the selected station revision in the database write and advance updated_at monotonically. An in-flight artwork conversion cannot reverse a concurrent suspension/deletion or overwrite a newer edit, including edits within the same second. Advertising forms snapshot/freeze fields and reject overlapping submissions. Ad review ignores stale responses after navigation or owner/admin view changes and prevents overlapping decisions.

Encrypted backup snapshots now preflight JSON-escaped byte counts and aggregate row counts atomically before loading records. Limits are 50,000 total records, 8 MiB plaintext manifest, 250 referenced media objects and 50 MiB media; oversized snapshots fail visibly without truncation. These remain explicit capacity limits, not unbounded archival storage. Ciphertext envelope limits match the plaintext allowance. Hex conversion no longer allocates an array entry for every encrypted byte. Failed daily attempts retry after 15 minutes; running attempts can be replaced after a one-hour lease, preserving attempt history and allowing only one new daily claim. Backup/restore merges retain their prior semantics.


Listening credit uses a half-open reported interval and splits positive fragments across the correct UTC dates/months. An arrival exactly at midnight cannot create a zero-second active-radio record in the new month. Replayed, stale and out-of-order reports retain the existing continuity/qualification guards. Physical firmware currently delays its first playing_station_code report before the server's own 60-second qualification; this separate device timing behavior is not changed by the website release.


## Pairing cancellation and independent decision writes (2026-11-08, release 2026.11.08.7)

Apply 0018_notification_operations.sql before deployment. A private operation marker now gates policy, audit and queued-command effects independently of email deduplication. The marker is inserted only after a successful optimistic mutation and deleted within the same atomic batch, so it is not persistent user data or part of snapshots. Repeating a legitimate decision after restoring old records cannot leave approval policy unset merely because an old pending/sent/failed notification exists. Existing notifications remain deduplicated; notification_queued reflects whether a new job was actually inserted.

The administrator Support and Legal lists filter by request kind before limiting rows. Stable created_at/id cursors expose older records in pages of 200. The UI provides Load more and ignores stale category responses.

Phone claim insertion and reuse recheck the exact current Device Code and the initiating session in SQL. An in-flight request using a reset code cannot create a new approval prompt after the reset. Optional controls pairing also rechecks the existing phone grant and live session. Radio pairing and shared-add forms reject overlapping submissions and ignore late results after navigation; owner/editor and direct station-link loads cannot redirect a user who has already left the view.

Advertisement submissions retain early per-IP limits and a shared 60-attempt/minute abuse bound. Their separate 60/day processing allowance is charged only after bot and field validation, so failed bot requests cannot consume the daily allowance. A radio's thirty-minute display window and ad receipt commit together, with approval/schedule rechecked in the window write. Receipt storage failures leave the radio eligible to retry.
