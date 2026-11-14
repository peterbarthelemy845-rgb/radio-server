# Radio Locals AI assistance

Release 2026.11.14.1 adds bounded assistance inside the existing Cloudflare Worker.
The existing `OPENAI_API_KEY` remains a Worker secret. No API key is sent to a
browser, stored in the repository, or copied to local files.

## Visitor support

On `/support`, open **Ask the help assistant**. English and Haitian Creole use
eight approved guides in `ai-guides.mjs`. The model selects a guide and step;
the server returns the actual approved instruction, not model-written hardware
advice. An unknown question or provider failure offers ordinary support.

The chat interface uses the site's compact styles and the Responses API directly
in the Worker. It does not require an Agent Builder workflow, separate Python
ChatKit server, new frontend framework, or access to private account tools.

Each message requires the existing browser session, matching Origin/CSRF, and
fresh Turnstile verification. Early limits precede bot/provider work:

- 6 attempts per browser session per 15 minutes;
- 12 attempts per IP per 15 minutes;
- 60 attempts globally per hour.

Questions are limited to 1,000 characters and the last four short messages.
History stays in tab memory and is never automatically copied into a ticket.
Obvious credentials/contact details are filtered; filtering is not a guarantee
that arbitrary free text contains no personal information. The UI and Privacy
Notice explain OpenAI processing and warn against submitting private details.

## Administrator tools

- **Support tickets:** new/changed tickets are organized automatically, at most
  two per cron run. Cached categories label the queue; unanswered high-priority
  tickets sort first within that loaded page. Open a ticket and choose
  **Organize ticket & draft reply**, then **Use this draft**, edit, and explicitly
  **Send reply**. AI cannot mail a recipient or change ticket status.
- **Station/ad reviews:** **Explain review checks** describes recorded evidence
  and limitations. It does not rescan the image, invent scanner categories,
  approve content, certify rights, or override existing moderation.
- **AI operations:** daily aggregate summaries, listening/share totals, open
  tickets, pending reviews, failed mail counts, and stream health are admin-only.
  **Prepare report** can refresh a selected month. Statistics remain device
  reports/share-button clicks, not verified people or completed shares.
- **Stream checks:** up to three published streams per cron run, aiming for an
  hourly recheck, reusing existing public-target/redirect/socket guards. Larger
  directories take longer. At most two changed incidents receive an explanation
  per run. Repeated unchanged failures do not repeatedly call AI. A failed sample
  never unpublishes a station, changes its URL, or proves it is offline.

Legal/privacy complaints are excluded from ticket AI. Submitted contact fields,
known identity values, common private codes, credentials and URLs are removed
from support prompts. Drafts are encrypted, versioned, and invalidated when the
ticket/replies change or it closes. Late outputs cannot act on stale content.

## Shared application allowance

All five assistants share `ai-runtime.mjs`:

- fixed `gpt-6-luna`, `reasoning.effort=none`, `store=false`, no tools;
- 24 KiB request cap and at most 1,000 output tokens;
- independent 14-second deadline covering headers and response body;
- strict JSON schemas validated again by the application;
- atomic D1 reservation before any provider request;
- at most **100 requests/day and 500/month (UTC)**, including failed attempts;
- one conservative one-cent allowance per request (at most $1/day and $5/month
  of this application's reserved allowance at the documented model rates);
- encrypted, exact-input/revision caches, expiring within 24 hours, and leases
  that prevent concurrent duplicate provider requests.

The admin panel shows the request counters. This allowance is not an OpenAI
invoice, account spending control, or a limit on other applications. Existing
moderation uses its separate free endpoint and preserves its current behavior.
Set `AI_ASSISTANTS_ENABLED=false` to stop new AI assistance without disabling
manual support, reports, or moderation. Review model pricing before changing
the fixed model or increasing input/output limits.

## Deployment and retention

Apply `0027_ai_assistants.sql`, `0028_ai_operations.sql`, and `0029_ai_review.sql`
before deployment. They add private assistance tables/indexes/triggers without
altering station publication or existing support payloads. Production schema is
managed through the Cloudflare D1 console; earlier migrations were also applied
there, so there is no Wrangler migration ledger to assume.

The existing minute cron runs mail and backups first. AI task failures are
isolated. Response caches are transient; draft queue and health/report caches
are reconstructible and excluded from portable backups. Usage reservations
survive ordinary data restore and are kept for 100 days to protect allowances.
No cron task emails a report or automatically sends a support reply.

Validation uses `node --test --test-concurrency=4` with the explicit list of
root `*.test.mjs` files. Do not let Node auto-discover the browser script named
`public/assets/editor-stream-test.js` as a standalone Node test.
