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
