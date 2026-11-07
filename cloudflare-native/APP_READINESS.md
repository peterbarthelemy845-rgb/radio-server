# Radio Locals mobile integration

Listener web preview: https://radiolocals.com/?app=1#radio. Navigation: Radio and Support; compact station tiles are on Radio. Owner/admin tools remain on the regular website.

Native session bootstrap: POST /api/mobile/session with JSON turnstile_token verified for action mobile-session on radiolocals.com. The app must provide an approved web challenge flow; do not disable Turnstile. Returns a 30-day listener-only bearer token. Store in iOS Keychain/Android secure storage, never ordinary preferences, logs or URLs. No owner/admin cookie is exported. Token is hashed at rest. Phone endpoints accept Authorization: Bearer; browser requests retain Cookie + Origin + CSRF protections. POST /api/phone/logout revokes mobile session and phone grants. After expiry, establish a new session and re-link; automatic refresh is intentionally not enabled.

GET /api/phone/radios returns linked name/status/current_station. Current station is a recent device report, not proof of playback. POST /api/phone/unlink {radio_id} removes only this session grant. Linking: POST claim, poll claim/status, require physical Allow, then existing add and command/status APIs. Never report successful addition before state added. Existing timeout, rejection and duplicate protections apply.

Visible Radio refreshes every 10 seconds and pauses when hidden/backgrounded. Failed/offline loads have a retry control. Station sharing uses HTTPS /station/{code} routes. Native universal/app links require Apple team/bundle ID and Android package/signing fingerprint before association files can be configured. No app identifiers invented.

Pending validation: FlutterFlow project connection, native secure-storage/challenge wiring, universal/app-link registration, installed iPhone/Android tests (small screens, accessibility font sizes, keyboard, offline/resume, physical radio pairing, station acknowledgement). Browser layout tests do not replace physical-device tests. No audio playback belongs in the listener app.

Home-screen web app: /manifest.webmanifest uses /#radio, standalone display, blue branding and regular/maskable icons. /sw.js provides a public offline notice without caching authenticated data or offline commands. The Radio page offers installation instructions and the browser's native installation prompt where available. This is a browser-installed PWA, not a Google Play or Apple App Store submission.

## Listener app layout (2026-11-07)

Installed standalone launches and ?app=1 use the listener menu (Radio and Support). Direct station-owner/admin pages retain their existing authentication and navigation. Radio and Support share a compact header and one background surface. Station details use an accessible modal bottom panel with Back/Close handling. Radio/Support navigation keeps search, horizontal/document scroll and support drafts in memory; drafts and device codes are never written to URL history or browser storage. Leaving the document with an unsent support draft still warns.

Status shows the last completed check. A failed/background-stale check replaces old Online status with Status unavailable; unchanged successful refreshes restore existing nodes without flashing. Browser-offline events invalidate green status immediately. Checked timestamps refer to the website check, not direct confirmation of audio playback.

Larger text is a reversible, local display preference only. Listener controls target at least 48px, browser zoom remains enabled, safe-area padding and reduced-motion preferences are respected, and the visible keyboard viewport constrains bottom panels. The bottom menu hides while the keyboard needs space. Automated state/navigation tests and narrow desktop-browser layouts do not replace installed iPhone/Android keyboard and hardware Back testing.

## Listener features (2026-11-07)

English/Kreyòl UI and caption tracks are local; station names/bios/support messages are never machine-translated. Radio controls and software details are in a compact Radio controls bottom panel. Version 2026.11.07.1 adds saved-station selection, volume and mute, reported software/state and an explicit phone-control approval on the physical radio. Existing add-only grants remain unchanged. The website has no audio player for these actions. Legacy/offline radios show update instructions and disabled controls.

Private support-ticket status works through short browser grants or an emailed one-time code. App update notices wait for unfinished forms and active actions. Native secure-storage/app-link wiring and installed physical iPhone/Android/radio checks are still pending. The source ZIP is ready for a normal Arduino upload after compile validation; the website cannot update the ESP32 automatically.
