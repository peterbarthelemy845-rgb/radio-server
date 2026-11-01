# Device help

The website navigation includes Device at /device. The requested shared passcode is checked server-side against a scrypt hash, never sent in page source. Unlock sessions last eight hours and can be closed with Lock page. CSRF and persistent per-IP/global attempt limits apply. Help pages are private/no-store, noindex and excluded from the public analytics beacon. This gate grants no station-owner or admin permissions.

Full administrators can open /admin/device-videos from the admin dashboard. Add a title, topic, optional description and HTTPS YouTube watch/share link. Only validated video IDs are embedded, using youtube-nocookie.com, without autoplay. Topics without real videos explicitly show Video coming soon. No videos were fabricated or uploaded automatically. Video links stored in the existing owners database are included in its existing backups. A person who knows a video’s original link can still watch it on its host; use videos intended to be shared with customers.

Optional DEVICE_HELP_PASSCODE_HASH can replace the default server-side hash; supply a Werkzeug-compatible password hash, not the plain passcode. No extra API key, hosting service or payment is needed.
