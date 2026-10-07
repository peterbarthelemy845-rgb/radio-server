Based on GitHub commit 6533d5ad2e4c94883c33820a097b570746d4f9cd.

Deploy only these changed files onto that version:
- app.py
- station_owners.py
- templates/admin_login.html
- templates/junior_pending.html (new)

Restart the Render service. Preserve production station data, owner_data, uploaded images, configuration, and environment variables. Do not replace production data with the sample data in this full source archive.

At /admin/login enter 845517 in the password field, then enter the current Google Authenticator code. Junior login uses the same ADMIN_TOTP_SECRET as full admin and is blocked if that secret is not configured. Successful MFA retains the junior role; it never grants full admin access. Junior admin can search pending submissions and approve or reject them. All other admin routes, including advertisements, exports, owner assignments, backups, analytics, approved-station deletion/editing, and the admin API, are denied. Junior rejection requires a POST with the existing CSRF token and does not require the main administrator's authenticator. Full administrator login, authenticator, and deletion safeguards are preserved.

JUNIOR_ADMIN_CODE overrides the supplied code; an empty value disables junior access. Keep the existing private ADMIN_SECRET_KEY configured in Render.
