# Microsoft 365 automatic email setup

The Codex Outlook connection is independent of the website. The website sends from info@radiolavoixdivine.com.

If SMTP continues to reject login with status 535, use Microsoft Graph application authentication:

1. Register a single-tenant application in Microsoft Entra for this website.
2. Have your Microsoft 365 administrator authorize Mail.Send application access and restrict the application to only info@radiolavoixdivine.com with Exchange application scoping/RBAC. Do not grant broad access to unrelated mailboxes.
3. Add MS_TENANT_ID, MS_CLIENT_ID, and MS_CLIENT_SECRET privately to Render environment settings, then deploy. Never upload the client secret to GitHub or chat.
4. The website automatically uses Graph when all three are configured; otherwise it uses the existing SMTP settings.
5. Request a code and check Admin > Email delivery status. Microsoft Graph 202/SMTP success confirms acceptance, not inbox delivery.

Messages and recovery codes are queued on the persistent disk, encrypted with a key derived from the website signing secret. Keep ADMIN_SECRET_KEY stable; rotating it requires regenerating queued owner codes. Failed messages retry up to eight times with backoff; queue records expire after seven days. Recovery codes expire after 24 hours, and do not replace the existing code until used successfully.

Microsoft references:
https://learn.microsoft.com/en-us/graph/api/user-sendmail
https://learn.microsoft.com/en-us/graph/auth-v2-service
https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac
