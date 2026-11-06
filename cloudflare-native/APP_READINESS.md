# Radio Locals mobile integration

Listener web preview: https://radiolocals.com/?app=1#radio. Navigation: Radio, Stations, Support. Owner/admin tools remain on the regular website.

Native session bootstrap: POST /api/mobile/session with JSON turnstile_token verified for action mobile-session on radiolocals.com. The app must provide an approved web challenge flow; do not disable Turnstile. Returns a 30-day listener-only bearer token. Store in iOS Keychain/Android secure storage, never ordinary preferences, logs or URLs. No owner/admin cookie is exported. Token is hashed at rest. Phone endpoints accept Authorization: Bearer; browser requests retain Cookie + Origin + CSRF protections. POST /api/phone/logout revokes mobile session and phone grants. After expiry, establish a new session and re-link; automatic refresh is intentionally not enabled.

GET /api/phone/radios returns linked name/status/current_station. Current station is a recent device report, not proof of playback. POST /api/phone/unlink {radio_id} removes only this session grant. Linking: POST claim, poll claim/status, require physical Allow, then existing add and command/status APIs. Never report successful addition before state added. Existing timeout, rejection and duplicate protections apply.

Visible My Radio refreshes every 15 seconds and pauses when hidden/backgrounded. Failed/offline loads have a retry control. Station sharing uses HTTPS /station/{code} routes. Native universal/app links require Apple team/bundle ID and Android package/signing fingerprint before association files can be configured. No app identifiers invented.

Pending validation: FlutterFlow project connection, native secure-storage/challenge wiring, universal/app-link registration, installed iPhone/Android tests (small screens, accessibility font sizes, keyboard, offline/resume, physical radio pairing, station acknowledgement). Browser layout tests do not replace physical-device tests. No audio playback belongs in the listener app.
