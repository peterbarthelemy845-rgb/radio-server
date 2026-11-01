# Local sponsor ads — free business submissions

Library cards link to /advertise/<station code>. Businesses submit contact name/email, business name, message, public phone, artwork, requested dates and permission. No account or payment is required. Contact addresses are unverified and private to the station and full administrators; not sent to radios or the scanner.

Public forms use CSRF, configured Turnstile, per-IP/station/global throttles, bounded normalized image uploads and existing automatic screening. New ads are disabled. Station owners use their existing mailbox-verified session at /station/ads and can only Approve or Delete. Flagged/unscanned ads require full-admin safety clearance first; clearing them does not enable delivery. Dates/artwork cannot be changed by owners. The built-in station uses /admin/local-ads/main for the same owner decision.

Old owner-upload routes now reject POST. Existing ads retain status and schedules. No Stripe or payment calls. /local-ads-demo is a read-only owner review example. Device API and firmware protocol are unchanged: ten-minute listening delay, thirty-minute spacing, eight-second closable popup with audio continuing. Existing updated sponsor firmware needs no new upload for this workflow.

Private ads/contact records remain in the existing persistent owners database and backup; media stays private. Restore pauses delivery. Display counts are authenticated device reports, not human views or sales. Admin master pause and suspensions prevent new delivery; already delivered popups may finish briefly.
