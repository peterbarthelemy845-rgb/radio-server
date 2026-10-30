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
- Station QR pages have been removed. Sharing pages offer a phone-to-radio confirmation flow; suspended, missing and unverified stations are not available.
- A leased background worker briefly probes approved stream URLs approximately every 15 minutes, without downloading complete audio. Results are keyed to the exact URL and become stale after an hour. A failed or inconclusive check never automatically removes a station.
- A check establishes only whether the stream responded at that time. It does not verify station ownership, content rights, audio quality or uninterrupted availability.

## Validation

Run `python -m unittest discover -s tests` with the locked requirements installed. The test uses isolated temporary storage and mocks outbound stream requests. It sends no owner email. On restricted Windows environments, `RADIO_TEST_TMP` can select an existing writable directory for temporary test data.

Run `python -m pip_audit -r requirements.txt --no-deps --disable-pip` with pip-audit installed. The local audit on 2026-10-30 reported no known vulnerabilities for the pinned dependency set. This is a point-in-time result and not a guarantee that all vulnerabilities are known.

Keep deployment secrets outside Git, require MFA on GitHub/Render/email accounts, and independently retain and restore-test encrypted backups. Those account settings and off-host backup operations are outside this code change.

## Phone-to-radio pairing

The radio initiates a five-minute, single-use eight-character code with 40 bits of randomness. Claim attempts are limited to five per IP per 15 minutes and 2,000 globally per day. A successful code entry only creates a two-minute pending request. The phone and radio display the same four-digit check number, and the radio must physically approve it before a phone grant exists. Denial, expiry, reset or a new linking session cancels pending access.

Each radio generates its own random 256-bit credential while Wi-Fi entropy is active, stores it in Preferences and authenticates to the fixed HTTPS API with certificate verification. The server stores only the credential hash. Browser grants expire after 30 days and use Secure/HttpOnly session cookies in production. Physical device extraction resistance (secure boot/flash encryption) requires a separate hardware provisioning decision; it is not claimed by this prototype.

The only browser command is add-station with an approved public station code. It cannot change Wi-Fi, volume, firmware, administrator settings or arbitrary URLs. Commands expire after five minutes, use per-radio delivery leases and are acknowledged only after the existing bounded station lookup and persistent save succeed. Retry processing deduplicates station codes and remembers the last command across restarts.

Unlink phones on the radio requires two taps and revokes all browser grants and queued requests. Backups include the radio credential-hash registry; restores clear phone grants, pending pairings and commands, requiring fresh physical pairing instead of restoring revoked access.

Both phone and radio must have internet access. The flow works on the same Wi-Fi but does not treat a common IP address as authentication or require a router port to be opened. Browser app cookie isolation may require pairing separately in WhatsApp's browser and the phone's normal browser. No messages are sent to social networks until the user chooses to share them.
