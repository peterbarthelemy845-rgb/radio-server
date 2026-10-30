# Website security and sharing

The public station code identifies a station. It never authorizes an edit. Editing requires a separate, expiring private email verification code.

## Controls

- Admin sessions are held in SQLite, expire after 30 minutes without activity, and have an eight-hour absolute lifetime. Logout revokes the server record. Existing admin sessions must sign in again after this release.
- Admin login requires the configured password and authenticator. Password verification challenges expire after five minutes. Attempt limits persist server-side, and each valid authenticator time step can be consumed only once. The junior administrator has no default password.
- Script elements use a fresh nonce per response. Fixed UI handlers live in `static/page-actions.js`; inline event attributes and evaluated JavaScript are blocked. HTML responses are not cached.
- Public URL fetches reject private/reserved addresses and credentials, revalidate redirects, and connect to a validated IP while retaining the original TLS hostname and certificate verification. Reads, redirects, and timeouts are bounded.
- Exact runtime dependency versions are recorded in `requirements.txt`. The GitHub workflow audits dependencies and runs the isolated security/sharing test on pushes and pull requests.

## Sharing and checks

- `/station/<code>` is the public sharing page with social preview metadata, WhatsApp link, native phone sharing and a copy-link fallback.
- `/station/<code>/qr.png` is generated locally. Add `?download=1` for an attachment. Suspended, missing and unverified stations are not available through these pages.
- A leased background worker briefly probes approved stream URLs approximately every 15 minutes, without downloading complete audio. Results are keyed to the exact URL and become stale after an hour. A failed or inconclusive check never automatically removes a station.
- A check establishes only whether the stream responded at that time. It does not verify station ownership, content rights, audio quality or uninterrupted availability.

## Validation

Run `python -m unittest discover -s tests` with the locked requirements installed. The test uses isolated temporary storage and mocks outbound stream requests. It sends no owner email. On restricted Windows environments, `RADIO_TEST_TMP` can select an existing writable directory for temporary test data.

Run `python -m pip_audit -r requirements.txt --no-deps --disable-pip` with pip-audit installed. The local audit on 2026-10-30 reported no known vulnerabilities for the pinned dependency set. This is a point-in-time result and not a guarantee that all vulnerabilities are known.

Keep deployment secrets outside Git, require MFA on GitHub/Render/email accounts, and independently retain and restore-test encrypted backups. Those account settings and off-host backup operations are outside this code change.
