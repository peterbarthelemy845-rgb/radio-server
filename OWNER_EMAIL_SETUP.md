Station owner access-code emails

New owners receive a code when they submit their first station, including stations awaiting review. Existing owners keep their existing code when adding another station. Full admin can generate a replacement code; the replacement is emailed too. Email delivery is attempted after the account transaction commits. A sending failure does not cancel a station submission. Check Render logs; configure the mailbox and use Generate new access code to retry a failed delivery.

Render > radio-server > Environment:
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USERNAME=info@radiolavoixdivine.com
SMTP_PASSWORD=<mailbox credential entered privately in Render>
SMTP_FROM_EMAIL=info@radiolavoixdivine.com

Sender is fixed as info@radiolavoixdivine.com for access-code emails. The SMTP account must be permitted to send as that address. SMTP authentication must be permitted for the mailbox by GoDaddy/Microsoft 365; an MFA-protected mailbox may require provider-specific authentication. Do not put the mailbox password in GitHub or chat. Live sending has not been tested without mailbox configuration.
