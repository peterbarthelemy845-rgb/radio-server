Junior admin setup
==================
Deploy the updated app.py and templates/admin_login.html and templates/pending.html, then restart the Flask service. Keep your production station data, configuration, uploads and existing environment settings.

At /admin/login enter the junior code supplied for this update. The junior role can view pending submissions and approve or reject them. Reports, analytics, editing, deleting, suspending, restoring and the admin API are blocked server-side. The full admin password and phone verification flow continue to work.

JUNIOR_ADMIN_CODE can override the default junior code (845517); set it to an empty value to disable junior access. Use an ADMIN_SECRET_KEY that is private and unique in production.
