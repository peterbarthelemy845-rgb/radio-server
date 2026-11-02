# Radio Locals — Cloudflare migration, stage 1

This is a deployable Worker front door, NOT a completed backend migration.
Render still runs Flask and stores all station records, artwork, ads, security
limits, sessions and radio pairing databases. Do not delete Render or its disk.

## Connect the existing GitHub repository in Workers & Pages

- Repository: `peterbarthelemy845-rgb/radio-server`
- Production branch: `codex/cloudflare-migration` (leave Render on `main`)
- Root directory: `cloudflare`
- Build command: leave empty
- Deploy command: `npx wrangler deploy`
- Worker name: `radio-server`

The root directory is essential: it avoids trying to install/deploy the Python
application as a JavaScript Worker. Start with the generated workers.dev address.
After testing it, add `radiolocals.com` and optionally `www.radiolocals.com` under
the Worker's Settings → Domains & Routes → Add → Custom Domain. No custom domain
is claimed automatically by this configuration.

## Before switching visitors

1. Check home, Library, Support, station editing, registration, verification email,
   ad submission and device pairing through the preview. Use your own test station.
2. Add the new domain to the existing Turnstile widget's allowed hostnames AND the
   backend's Turnstile hostname allowlist before enabling forms on the new domain.
3. Make the Python backend's canonical public URL configurable, then set it to
   `https://radiolocals.com`. Email/share links still use the old domain today.
   Do not mechanically replace email sender addresses: the new sender needs verification.
4. Verify trusted client-IP handling before launch. The backend currently uses
   remote_addr for limits; visitors behind this Worker may share an upstream IP.
   Do not blindly trust visitor-supplied forwarding headers.
5. Keep old-domain links and firmware working until radios receive a tested update.

No secrets are required in this Worker. Backend secrets stay on Render. Responses
are not cached, upstream HTTPS is required, redirects are not followed inside the
Worker, and the upstream hostname is fixed to prevent open-proxy abuse.

## Stage 2: remove the Render dependency

Port persistent SQLite/JSON data to D1 or another durable database, private uploads
to R2, and adapt synchronous Python networking, image processing, email, threading
and subprocess dependencies to the chosen Cloudflare runtime. Export/import every
database and file with backups, validate pairing credentials and security controls,
test physical radios, then cut over. A Worker build succeeding alone does not prove
the application or storage has migrated. Containers also do not make local files durable.

Local proxy checks: `node --test worker.test.mjs`.
