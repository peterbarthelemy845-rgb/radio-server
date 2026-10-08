Automatic station approval update

Based on commit 6533d5a plus the junior admin MFA update.
Upload app.py to the repository root and templates/pending.html inside templates. These are the only two changed application files. Keep existing production data and environment settings.

The full admin dashboard now has an Automatic station approval ON/OFF control. Default is OFF. The setting is stored with station data in stations.json and survives app restarts when that data is persisted. It must be covered by the same persistent storage as your station library.

ON approves new valid submissions immediately, including station owner provisioning. Required fields, contact email, terms consent, duplicate detection, and CSRF checks still apply. Existing pending submissions remain awaiting review. OFF restores manual review for future submissions. Junior admins cannot change this setting, and their password plus authenticator login is preserved.
