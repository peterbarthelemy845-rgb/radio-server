# Local sponsor ads — free business submissions

Library cards link to /advertise/<station code>. Businesses submit contact name/email, business name, message, public phone, artwork, requested dates and permission. No account or payment is required. Contact addresses are unverified and private to the station and full administrators; not sent to radios or the scanner.

Public forms use CSRF, configured Turnstile, per-IP/station/global throttles, bounded normalized image uploads and existing automatic screening. New ads are disabled. Station owners use their existing mailbox-verified session at /station/ads and can only Approve or Delete. Flagged/unscanned ads require full-admin safety clearance first; clearing them does not enable delivery. Dates/artwork cannot be changed by owners. The built-in station uses /admin/local-ads/main for the same owner decision.

Old owner-upload routes now reject POST. Existing ads retain status and schedules. No Stripe or payment calls. /local-ads-demo is a read-only owner review example. Device API and firmware protocol are unchanged: ten-minute listening delay, thirty-minute spacing, eight-second closable popup with audio continuing. Existing updated sponsor firmware needs no new upload for this workflow.

Private ads/contact records remain in the existing persistent owners database and backup; media stays private. Restore pauses delivery. Display counts are authenticated device reports, not human views or sales. Admin master pause and suspensions prevent new delivery; already delivered popups may finish briefly.

## Abuse and image hardening (November 1)
Bot-verification submissions consume persistent 20-per-IP/15-minute and 120-global/minute budgets before CSRF/form parsing and external verification. Each worker permits at most two simultaneous verifier calls; unavailable/busy checks fail closed. Existing downstream station/email limits still apply. These are application controls, not a substitute for edge DDoS protection.

The irreversible 100-ad lifetime ceiling is removed. The twenty-undeleted-ad limit, station/IP/global submission rates, global active cap and storage cap remain. Deletion marks the ad disabled/deleted and removes its private normalized image only after a successful transaction response; backup copies and audit metadata may remain. Existing previously deleted media is not bulk-purged by this release.

Ad files require matching JPG/JPEG/PNG/WebP extensions and decoded formats, bounded bytes/pixels, integrity verification and full decoding. Animated images, SVG, executables, archives and malformed/disguised files are rejected. Accepted pixels are pasted into a fresh RGB canvas before saving PNG, dropping original metadata and appended data. Only that normalized PNG is screened and served privately; radios receive bounded RGB565 pixels. This is file-type validation and safe reconstruction, not a signature-based antivirus service or guarantee of malware detection. Existing OpenAI artwork moderation checks pornography and other flagged content; unavailable/flagged checks remain quarantined for full-admin review and subsequent station-owner approval.
