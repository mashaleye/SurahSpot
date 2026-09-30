# Deployment

## Before you deploy

```bash
node --env-file=.env.production scripts/verify-deployment.mjs
```

Every check it makes corresponds to a failure that is silent or that only appears
under production conditions — a hint allowance that resets because the store is
process-local, an Arabic font blocked by the app's own CSP, a fixture upstream
left switched on. None of these break `npm run dev`, which is exactly why they
need their own gate.

Then, once running:

```bash
curl -sS https://YOUR_HOST/api/health          # liveness
curl -sS https://YOUR_HOST/api/health?deep=1   # + catalog reachability
```

## Choosing a target

The decision that matters is **how many processes serve traffic**.

| Target | Configuration |
|---|---|
| Multiple replicas, serverless | `ATTEMPT_STORE_URL=rediss://…` |
| Single VM / container | `ALLOW_SINGLE_INSTANCE_STORE=1` |

Production will not start on the in-memory store without that acknowledgement.
The health endpoint returns 503 with the exact remedy, so the container fails its
check and never receives traffic.

This is fail-closed on purpose. Running multi-instance without shared storage is
not a performance problem, it is a correctness one — a player landing on a second
replica gets a fresh two-hint allowance, and the round-revision replay guard has
nothing to compare against. Nothing logs an error when that happens, which is
precisely why the configuration has to refuse rather than warn.

## Docker

```bash
docker build -t surahspot .
docker run -p 3000:3000 \
  -e QF_ENV=production \
  -e QF_CLIENT_ID=... \
  -e QF_CLIENT_SECRET=... \
  -e ROUND_TOKEN_SECRET=$(openssl rand -hex 32) \
  surahspot
```

The image is built from Next's standalone output: the runtime stage has no
package manager, no dev dependencies, and no source. It runs as the unprivileged
`node` user and its `HEALTHCHECK` uses liveness only — a deep check would mark
every replica unhealthy during a Quran Foundation blip and restart them all,
turning a degraded upstream into a total outage.

Pass `ALLOW_SINGLE_INSTANCE_STORE=1` for a single container, or
`ATTEMPT_STORE_URL` for anything scaled.

`.dockerignore` excludes every `.env*` except the template. Anything copied into
a layer stays recoverable from the image even if a later layer deletes it.

## With Redis

```bash
docker compose up --build
```

`docker-compose.yml` exists mainly so you can *exercise* the shared store. It is
the only way to verify that the two-hint limit and the replay guard survive more
than one process — `npm run dev` cannot show you that.

Use `rediss://` for any remote Redis so attempt ids don't cross the network in
the clear.

## Shared store

`ATTEMPT_STORE_URL` points at Redis or Valkey. It backs the attempt state, the
rate-limit counters and the push subscriptions.

It must be a **Redis-protocol** URL — `redis://` or `rediss://`. The client in
`lib/store/redis-store.ts` speaks RESP over a socket directly rather than
through ioredis, so an HTTP REST endpoint (Upstash's REST URL, for instance)
will not work even though it is also "Redis".

On Fly:

```powershell
fly redis create                     # provisions one through Upstash
fly redis status <name>              # prints the connection URL
fly secrets set ATTEMPT_STORE_URL="redis://PASSWORD@fly-….upstash.io"
```

Quote the value. In PowerShell an unquoted URL containing `:` or `@` can be
reinterpreted, and `fly secrets set` takes `NAME=value` as a single argument.

Setting a secret triggers a rolling restart, so the machines come back with the
new value; no separate deploy is needed.

### The single-credential URL

`fly redis status` prints a URL of the form `redis://PASSWORD@host` — one
credential, no colon. That is the password-only form, and it is valid, but it
parses in a way that has bitten this codebase:

| URL | `url.username` | `url.password` |
| --- | --- | --- |
| `redis://default:PW@host` | `default` | `PW` |
| `redis://PW@host` | `PW` | *(empty)* |

`lib/store/redis-store.ts` used to read `url.password` alone, so the second form
authenticated with **nothing**: AUTH was never sent, the socket opened normally,
and every command then failed with `NOAUTH Authentication required`. Nothing was
wrong at startup, and the shared store had already been chosen over the
in-memory fallback, so the symptom was a store that appeared configured and
worked for nothing.

`credentialsFrom` now treats a lone credential as the password, which is what
Redis does with `redis://:PW@host`. Both forms work, and
`tests/integration/redis-auth.test.ts` asserts on the actual wire traffic that
AUTH is sent, sent first, and sent with one argument for the password-only form —
two-argument AUTH needs a real Redis 6 ACL user.

### Verifying it took

```powershell
fly secrets list                     # ATTEMPT_STORE_URL present (digest only)
fly logs                             # no NOAUTH, no store warnings on boot
curl.exe -s https://surahspot.com/api/health
```

`curl.exe`, not `curl`: in PowerShell `curl` is an alias for
`Invoke-WebRequest`, which takes different flags.

The real check is behavioural, because the in-memory fallback is silent about
being in use: turn on reminders in the browser, run `fly deploy`, and confirm
the toggle is still on afterwards. Subscriptions surviving a deploy is the whole
point of setting this.

Once it is set, `ALLOW_SINGLE_INSTANCE_STORE` is no longer needed — that flag
exists only to acknowledge running without a shared store.

This matters beyond notifications. The hint allowance, the round-replay guard
and the seven-round ceiling are only enforceable when every request for an
attempt sees the same state. On a second replica without a shared store they
stop holding, and they stop holding silently.

## Secrets

`ROUND_TOKEN_SECRET` encrypts the round token, which carries the answer. Generate
it with `openssl rand -hex 32`; anything under 32 characters is refused at
startup.

Rotating it invalidates every in-flight round token, so players mid-attempt see
"start a new round". Rotate at a quiet hour.

**The repository you sent contained a live `.env.local`.** Those credentials
should be treated as disclosed and regenerated in the Quran Foundation Developer
Console. `.gitignore` and `.dockerignore` now both exclude it.

## The font

The Quranic face is self-hosted. `npm run fetch:font` vendors it into
`public/fonts/`, the CSP is `font-src 'self' data:` with no exception, and
`prebuild` refuses to build without it.

Verification checks size *and* TrueType magic bytes, because the realistic
failure is a 404 HTML page saved to a `.ttf` path — which a size check alone
would pass and which renders as nothing.

The Docker build runs `fetch:font`, so it needs network at build time. For an
air-gapped build, drop the `.ttf` into `public/fonts/` beforehand and the step
becomes a no-op.

On licensing: the KFGQPC Uthmanic Hafs face is published by the King Fahd
Glorious Quran Printing Complex for Quranic use. It is fetched at setup rather
than committed, so the terms travel with the source you obtain it from. Review
them before redistributing this repository with the binary included.

## Rate limiting

On by default in production. One round request fans out to several upstream
calls, so this protects the Quran Foundation quota as much as the server — an
unthrottled loop takes the game down for everyone.

Requests are counted against **both** the caller's IP and their attempt cookie.
Either alone is a bypass: cookie-only resets when cookies are cleared, IP-only
punishes everyone behind one carrier NAT.

## The public origin

`SITE_URL` sets the origin the app presents itself as. It feeds two things:

- `metadataBase`, which is how Next turns the generated Open Graph images into
  absolute URLs.
- The sitemap's `<loc>` entries.

It defaults to `https://surahspot.com`, so a production build needs nothing.

**It is read at build time, not runtime.** Most pages here are statically
prerendered, so both callers are evaluated during `next build`. Setting it on
a running machine — `fly secrets set SITE_URL=…` — looks like it works and
changes nothing. Pass it to the build instead:

```bash
fly deploy --build-arg SITE_URL=https://staging.example.com
```

This is worth getting right because it fails silently. Nothing errors, no page
breaks; the link just previews with a blank card everywhere it is posted,
because `og:image` points somewhere the recipient cannot reach.

## The feedback form

The footer form posts to `/api/feedback`, which validates, checks a honeypot,
rate-limits, and hands the message to whichever transport is configured.

**Resend** (preferred):

| Variable | What it is |
| --- | --- |
| `RESEND_API_KEY` | A *sending* key, scoped to the domain — not a full-access one. |
| `FEEDBACK_TO_EMAIL` | Where messages arrive. `CONTACT_TO_EMAIL` also works. |
| `FEEDBACK_FROM_EMAIL` | Optional. Defaults to `SurahSpot Feedback <feedback@mail.surahspot.com>`. |

Verify a **subdomain** in Resend — `mail.surahspot.com` — rather than the root.
The root carries real mailboxes; keeping transactional mail on a subdomain
means a deliverability problem with one cannot damage the other.

The visitor's address goes in `Reply-To`, never in `From`. They do not own the
sending domain, so sending as them fails SPF and DKIM and teaches receivers to
distrust this domain. Reply in the inbox still answers the visitor.

**Webhook** (fallback, for routing somewhere other than email): set
`FEEDBACK_WEBHOOK_URL` — https only — and optionally `FEEDBACK_WEBHOOK_SECRET`,
sent as a bearer token.

With neither configured, the form reports that feedback is unavailable and the
server log names the missing variables. That split is deliberate: an
`AppError`'s message is returned in the response body, so a misconfiguration
notice listing environment variables would be handed to whoever filled in the
form. Failure detail from the provider is logged, never returned.

### Abuse protection

Four layers, in the order they run:

1. **Request budget** — 20/hour per client, checked before the body is parsed,
   so hammering the endpoint costs nothing to refuse.
2. **Body size** — anything over 16KB is refused unparsed.
3. **Honeypot** — a `company` field, off-screen and `aria-hidden`. A filled one
   gets the same `{ ok: true }` a real submission gets and sends nothing, so a
   bot cannot discover the trap.
4. **Send budget** — 5/hour per client, spent only on a message that passed
   validation. Someone mistyping their address three times can still reach a
   human.

Turnstile is the next layer if the honeypot stops being enough. It needs a CSP
change — `script-src` and `frame-src` for `challenges.cloudflare.com` — which
is why it is not wired in ahead of need.

## Custom domains

Fly issues the certificate once it can verify you control the domain, which
means DNS has to be in place first. At the registrar, for the apex:

| Type | Name | Value |
| --- | --- | --- |
| `A` | `@` | the IPv4 shown in the app's Certificates page |
| `AAAA` | `@` | the IPv6 shown there |

Both. Fly's check reports "No AAAA records were found for your domain" and
holds the certificate at *Pending validation* on the IPv6 record alone — it is
how ownership is proven, not an optional extra. If AAAA genuinely cannot be
added, the `_fly-ownership` TXT record Fly offers proves ownership instead,
but the A record is still needed for traffic to arrive.

Two things that commonly hold this up:

- **A proxying CDN in front.** With Cloudflare's orange cloud on, the
  nameservers answer with Cloudflare's addresses rather than Fly's, so the
  check never sees the records. Set those entries to DNS-only until the
  certificate issues.
- **`www`.** It is a separate hostname and needs its own certificate
  (`fly certs add www.surahspot.com`) plus a `CNAME` to the app.

Then "Check again". Propagation is bounded by the old record's TTL.

### www and other hostnames

`next.config.ts` issues a 308 from `www.surahspot.com` and `surahspot.fly.dev`
to the apex, preserving path and query. 308 rather than 301 because it is
guaranteed to preserve the method, so a `POST /api/feedback` on the wrong host
still arrives as a POST.

The list is explicit rather than "any host that is not canonical". A catch-all
would also match the Host header Fly's internal health check arrives with,
turning every check into a redirect and the machine into an unhealthy one.
`/.well-known` is excluded so an ACME challenge is never redirected.

The redirects are derived from `SITE_URL`, so a staging build emits none.


## The sitemap

Two of them, on purpose.

`/sitemap.xml` is what crawlers read, and robots.txt points there. It is a
route handler rather than Next's `app/sitemap.ts` convention, because that
convention reserves the `/sitemap` path itself.

`/sitemap` is the readable one, for people. Deliberately **not** an XSL
stylesheet over the XML — the usual `xml-stylesheet` trick stops working in
Chrome 158 on 17 November 2026, when XSLT is removed. It is an ordinary page
and will not expire.

Both read `lib/site/pages.ts`, so a page added to the site cannot appear in
one and not the other.

## Offline and the service worker

`public/sw.js` is registered by `ServiceWorkerBridge` in the root layout, in
production builds only. In development it stays unregistered — the dev server
serves every chunk from a URL that changes on each edit, and a worker caching
those makes hot reload behave erratically. To exercise offline behaviour
against a dev server anyway, set `surahspot:sw-dev` to `"1"` in localStorage
and reload.

What it caches, and what it deliberately does not:

| Kind | Strategy |
| --- | --- |
| Build output, fonts, icons | Cache first — these URLs are immutable |
| Qur'an reading endpoints | Stale while revalidate, revalidated with the response's ETag |
| Page navigations | Network first, falling back to the cached page, then `/offline.html` |
| `/api/quran/round`, `/api/quran/audio`, search, translate, game, notifications, RSC payloads | Never cached |

The first exclusion is the one to be careful with: `/api/quran/round` carries
the answer to the round, so a cached copy would hand out answers. The rules
live in one classifier at the top of the file, and
`tests/unit/service-worker-policy.test.ts` loads the shipped file and asserts
against that classifier directly rather than a copy of it.

Changing the caching rules means bumping `CACHE_VERSION`, which retires every
old cache on the next activation. The worker never applies an update under a
reader mid-Ayah: it waits, and the bridge offers a Refresh button.

`/sw.js` is served `no-cache, must-revalidate`. That matters — a cached worker
pins every reader to the old rules with no way to push a fix past it.

## Notifications

Five kinds, on the reader's own clock in their own time zone. The day runs in
four-hour slots, and the two small-hours slots (midnight and 04:00) are quiet:
nothing is sent, and nothing queues up for later.

| Kind | When | What it says, and where a tap goes |
| --- | --- | --- |
| Remembrance | Every active slot: 08, 12, 16, 20 | In turn, a Qur'anic dua (opens the reader at that Ayah), a dhikr fitted to the time of day (opens the matching routine on the Dhikr page), and one of the 99 Names (opens the Names page at that Name). |
| Verse of the day | 08:00 slot | An Ayah with its translation; opens the reader at it. |
| Game modes | 12:00 slot | One mode or variant a day, in turn; opens the game with those rules preselected. |
| Reconnect | 16:00 slot | "Reconnect with · Surah X for a few minutes", naming the Surah the reader last left off in; opens the reader there, at their saved place. A device that has not read yet gets a suggested Surah instead. |
| Streak | 20:00 slot | Only if they have not read today and have a streak to keep. |

Readers turn them on, and switch individual kinds off, inside the streak
panel. Nothing is ever sent without that opt-in, and permission is requested
on that tap rather than on page load, because a denial cannot be undone from
script.

The dispatcher sends **at most one notification per subscriber per run**.
Apple's push service keeps only one pending notification per app, so two sent
together — the morning dua and the verse of the day at 08:17, say — arrived as
one. Whatever is not sent stays due and goes out on the next hourly run,
within the same four-hour slot. The once-a-day kinds go first; the
remembrance, which comes round every slot, waits.

For the afternoon nudge to name a Surah, the device reports the Surah number
of the reader's last position whenever it changes — the number only, never
the position within it, which stays on the device.

Generate the keys:

```bash
npm run gen:vapid
```

That prints a VAPID keypair and a dispatch secret. Set four variables:

| Variable | What it is |
| --- | --- |
| `VAPID_PUBLIC_KEY` | Served to browsers by `/api/notifications/subscribe`. Public by design. |
| `VAPID_PRIVATE_KEY` | Signs push messages. Secret. |
| `VAPID_SUBJECT` | A `mailto:` or `https:` URL a push service can use to reach you. |
| `NOTIFICATIONS_DISPATCH_SECRET` | Bearer token for the dispatch endpoint. Secret. |

With any of them missing, notifications switch themselves off: the subscribe
endpoint reports `enabled: false` and the UI does not offer a dead button.
Dispatch additionally **refuses to run** without the secret rather than
allowing anyone to push to every subscriber.

Then point a scheduler at dispatch, roughly hourly:

```bash
curl -fsS -X POST https://your-host/api/notifications/dispatch \
  -H "Authorization: Bearer $NOTIFICATIONS_DISPATCH_SECRET"
```

`.github/workflows/dispatch-reminders.yml` does this hourly. **Nothing else
does** — until that workflow is running, the endpoint is never called and no
reminder is ever delivered, however many readers have subscribed. It needs one
repository secret, `NOTIFICATIONS_DISPATCH_SECRET`, matching the Fly secret of
the same name, under *Settings → Secrets and variables → Actions*. Optionally
set a `SITE_ORIGIN` repository variable to point it somewhere other than
production.

It also accepts `workflow_dispatch`, which is how to fire a run by hand instead
of waiting for the next tick — the practical way to do the end-to-end test.

Two things about relying on GitHub's scheduler:

- Runs are best-effort and can be delayed. Harmless here: delivery is keyed by
  slot, so a late run still lands in the right slot.
- **GitHub disables scheduled workflows on a repository with no commit activity
  for 60 days.** On a finished project that is the realistic way reminders stop
  — silently, two months after the last push. GitHub emails the repo owner, and
  it can be re-enabled from the Actions tab. If reminders become something
  readers depend on, move to a scheduler with a delivery guarantee; Upstash
  QStash is already adjacent to the Redis instance.

The workflow reports `{considered, sent, skipped, pruned, failed}` in its job
summary, and distinguishes the failure modes rather than just going red:

| Result | Meaning |
| --- | --- |
| 401 | the repository secret and the Fly secret have diverged |
| 503 | VAPID keys or the dispatch secret are missing on the server |
| other non-2xx | retried only if transient (no response, 429, 500, 502, 504) |
| 2xx with `sent: 0` and failures | delivery is broken — usually a rotated VAPID keypair |

That last row is worth understanding: a 2xx means dispatch *ran*, not that
anything arrived. `failed` counts individual send attempts, and a subscriber
whose first due kind fails is tried on the next kind in the same run, so it
can exceed `considered` — a single subscription can report `considered: 1,
failed: 2`. Comparing the two is meaningless; `sent` is the number that says
whether reminders reached anyone, and it is never more than `considered`,
because a run sends each subscriber at most one notification.

Hourly rather than four-hourly on purpose, and now for two reasons. Delivery
is keyed by slot, not by time, so extra runs cost nothing and only pick up
readers whose local slot has just opened in another time zone — and a missed
run is recovered by the next one instead of being lost. And because a run
sends one notification per subscriber, the hourly rhythm is what spaces a
slot's two kinds an hour apart instead of dropping one. Each run reports what
it did: `{considered, sent, skipped, pruned, failed}`.

Changing the rhythm is one table, `CATEGORY_SLOTS` in
`lib/notifications/schedule.ts`. Setting any category to `"every"` fires it in
all six four-hour slots; a number pins it to that hour.

Subscriptions live in the same `KeyValueStore` as everything else, so a
single-instance deployment keeps them in memory and loses them on every
restart and every deploy — readers are silently unsubscribed and have to opt
in again. Before real people subscribe, set `ATTEMPT_STORE_URL` (see
**Shared store** below).

The variable is `ATTEMPT_STORE_URL`, not `REDIS_URL`. An unrecognised name is
simply ignored, so setting the wrong one leaves the memory store in place with
no error anywhere.

Note on iOS: Safari exposes push only to a PWA that has been added to the home
screen. The UI detects that case and says so rather than reporting the browser
as unsupported.

## Mobile data

The reading endpoints return a strong `ETag` and the reader revalidates rather
than refetching, so a Surah already held costs a 304 instead of its full
payload — for Al-Baqarah with a translation, 83KB down to a couple of hundred
bytes. The service worker revalidates with the same validator, so its
background refresh is a 304 too.

Responses are gzipped by Next in production. In development they are not,
which is worth remembering before drawing conclusions from a dev-server
measurement.

---

# Testing on a phone

Three options, in order of what to reach for first.

## 1. Same Wi-Fi (fastest)

```bash
npm run dev:phone     # next dev -H 0.0.0.0 -p 3000
```

Then open `http://YOUR_LOCAL_IP:3000` on the phone — not `localhost`, which on
the phone means the phone.

Find the IP with `ipconfig getifaddr en0` (macOS) or `ipconfig` (Windows).

If it won't connect, the usual cause is the computer's firewall blocking inbound
connections to `node` on port 3000. Guest, hotel, and many apartment networks
also use client isolation, which prevents devices on the same Wi-Fi from talking
to each other at all — use a tunnel in that case.

The attempt cookie works over plain-HTTP LAN because `secure` is tied to
`NODE_ENV === "production"`. Hard-coding `secure: true` would silently break
hints on every LAN test.

## 2. Cloudflare Tunnel (realistic HTTPS)

```bash
npm run dev
cloudflared tunnel --url http://localhost:3000
```

Gives a real HTTPS URL, which is what you want for testing cookies, mobile
Safari media behaviour, and anything security-related. `ngrok http 3000` is
equivalent.

## 3. Tailscale (private, across networks)

Best when the phone isn't on the same Wi-Fi and you don't want a public URL.
With `npm run dev:phone` running, open `http://100.x.x.x:3000` on the phone, or
use MagicDNS.

One thing to know: Tailscale's `100.64.0.0/10` range is blocked by the audio
proxy's SSRF guard. That is intentional and does not affect testing over
Tailscale — the guard applies to *outbound* upstream audio URLs, not to inbound
requests.

**Do not port-forward the dev server from your router.** The Next dev server
exposes source maps, error detail, and debug routes.

## What to check on-device

The media path is where phones differ most:

```
play → pause → seek forward → seek backward
     → lock phone → unlock → switch apps → return
```

Watch that the highlight re-syncs rather than drifting. Mobile Safari
specifically: confirm playback stays inline (no fullscreen takeover), that the
first play starts at the Ayah and not the top of the chapter file, and that
tapping the answer field doesn't zoom the page.
