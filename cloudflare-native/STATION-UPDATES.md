# Automatic station updates and problem reports

The radio keeps its own saved station list. It asks the Cloudflare application
for revisions of those saved codes every five minutes, then downloads metadata
only for changed entries. Selecting a station also schedules a prompt refresh.

`GET /api/device/station-revisions?codes=10,11` accepts at most 100 canonical
station codes and returns only published codes and revision strings. Individual
`/api/device/stations/:code` lookups include the revision alongside the current
name, stream URL and approved logo path. An owner's pending or rejected change
does not become an update. An unavailable station is not automatically removed
from the radio's saved list.

The firmware uses verified HTTPS, bounded background requests, the existing
worker exclusion guards, and persistent save rollback. A background result can
update an existing matching station code only. It cannot resurrect a deleted
local station or combine distinct codes that happen to share a stream URL.
Name, logo and revision changes do not restart audio; a changed stream URL
reconnects only if that station is selected. Failed requests keep the local copy.

Existing radios need firmware 2026.11.08.1 uploaded once by USB. Website updates
alone cannot replace firmware on a physical radio. Public sketch ZIPs exclude
the private provisioning header; the local sketch retains it. Hardware playback
and timing still need checking on the physical radio after upload.

The website's station problem action opens the existing support form. It sets a
separate station-code field and preserves all existing message/contact drafts.
It never sends a ticket automatically. The server resolves the published
station's name itself and stores the association with the encrypted ticket;
ordinary tickets remain supported. No station or message details are added to
email receipts. Existing bot checks, CSRF checks and ticket-access rules apply.
