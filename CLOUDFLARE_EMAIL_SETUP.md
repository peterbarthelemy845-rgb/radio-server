# Cloudflare transactional email

The sending domain radiolocals.com has been onboarded in the Cloudflare dashboard.
The existing durable mail queue can use authenticated Cloudflare SMTP while the
backend is still on Render. No mailbox or incoming MX replacement is required.

Set these server-side variables only after creating an account-scoped API token
with Email Sending: Edit permission. Never put the token in GitHub or browser code.

```
OWNER_MAIL_TRANSPORT=smtp
OWNER_FROM_EMAIL=info@radiolocals.com
OWNER_FROM_NAME=Radio Locals
SMTP_HOST=smtp.mx.cloudflare.net
SMTP_PORT=465
SMTP_USERNAME=api_token
SMTP_PASSWORD=<private Cloudflare sending token>
```

Use Render's secret environment-variable field for SMTP_PASSWORD until the
backend moves. Preserve the existing mail configuration privately for rollback.
Run a single requested test email, inspect delivery status and receipt, then test
station-owner login. Keep TLS verification enabled. Do not expose an unauthenticated
send-email HTTP endpoint. Incoming email remains a separate configuration.

Reference: https://developers.cloudflare.com/email-service/get-started/send-emails/
