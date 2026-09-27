# Site shell, PWA launch, and resource pages

## What is wired

- The root game uses the shared `SiteHeader` and `SiteFooter`.
- The `ModesMenu` remains owned by the game and is injected into the header;
  selecting a mode still starts a server-backed fresh attempt.
- Primary navigation is route-aware and horizontally scrollable below 980px.
- The Modes dropdown portals to `document.body`, so the nav scroller cannot clip it.
- `/how-it-works`, `/names-of-allah`, `/dhikr-duas`, and `/surahs` use the same site shell.
- The feedback form posts to `/api/feedback`; there is no `mailto:` path.

## Feedback delivery

Choose one server-side delivery path in `.env.local` or your deployment secrets.

### Resend

```env
RESEND_API_KEY=...
FEEDBACK_TO_EMAIL=you@example.com
FEEDBACK_FROM_EMAIL=SurahSpot <feedback@your-verified-domain.example>
```

### HTTPS webhook

```env
FEEDBACK_WEBHOOK_URL=https://example.com/hooks/surahspot-feedback
FEEDBACK_WEBHOOK_SECRET=optional-bearer-token
```

The endpoint validates input, includes a honeypot, and rate-limits submissions.
Provider credentials are never sent to the browser.

## 99 Names translations

English loads without an app-specific key through the public English provider.
For the translated language options supported by the provider, set:

```env
ISLAMIC_API_KEY=...
```

The UI uses the same project language ids as the Quran translation selector.
Languages not offered by the Names provider remain visible but disabled, rather
than silently presenting a different language.

## Installed-app splash

- Android: `manifest.webmanifest` contains raster `any` and `maskable` icons,
  standalone display, theme color, and launch background.
- iOS/iPadOS: `apple-touch-icon.png` plus portrait startup images for common
  device classes are linked from `app/layout.tsx`.
- Both hand off to the existing animated, server-rendered `AppSplash`, which is
  shown only in installed display modes (or `?splash=1` for testing).

For iOS launch-screen changes, delete the old home-screen install and add it
again; iOS caches web-app icons/startup images aggressively.

### Known false positive in the detection

`APP_BOOTSTRAP` treats `innerHeight === screen.height` as "installed", as an iOS
fallback for versions where `navigator.standalone` is unreliable. Two things also
satisfy it:

- **Headless Chromium**, which reports them as equal. Any screenshot or
  Lighthouse run against a page therefore captures the splash unless it waits
  for `document.documentElement.dataset.splash` to leave `"active"`. This is the
  reason a capture can come back as a blank page with a centred logo.
- **A desktop browser in fullscreen (F11)**, which would show the installed-app
  splash in an ordinary tab.

Not fixed: narrowing it risks losing the iOS case it exists for, which is the
one that matters. Recorded so it is not rediscovered as a rendering bug.

## Service worker and the first visit

`sw.js` calls `clients.claim()` on activate, so a first-time reader gains offline
support immediately rather than on their next navigation. A consequence: the
controller goes from `null` to the new worker while the page is already loaded
and working, which fires `controllerchange`.

`ServiceWorkerBridge` listens for that event in order to finish an update the
reader asked for — and it must distinguish the two causes, because it once did
not. Treating the first-visit claim as an update meant **every first-time visitor
loaded the whole site twice**: 48 network requests instead of 24, 2.1s of wasted
time on a throttled mobile connection, every script evaluated again, and a mobile
Lighthouse performance score of 72 instead of 94.

Two things keep it correct, and `tests/unit/service-worker-reload.test.ts`
asserts both plus the conditions they depend on:

- The reload is gated on `updateRequestedRef`, set only by the reader tapping
  **Refresh**. That is sound only while `skipWaiting()` is reachable *solely*
  from the `SKIP_WAITING` message — a worker that called it in `install`, or
  unconditionally in `activate`, would strand readers on a stale page with no
  reload.
- The flag is raised *before* `postMessage`, because the worker can take over and
  fire `controllerchange` before that call returns.

The update prompt is guarded the same way, on `navigator.serviceWorker.controller`
being non-null: `installed` means "works offline now" on a first visit and "a
newer version exists" only when something was already controlling the page.

**This class of bug cannot reproduce after the first visit**, since every later
visit already has a controller. Verify it by measuring request count on a fresh
profile with no service worker registered, not by reloading.

## Surah pages

- One page per Surah at `/surah/<slug>`, all 114 prerendered as static HTML via
  `generateStaticParams`. `dynamicParams = false`, so a slug that is not one of
  them 404s without rendering and the route cannot be used to spray arbitrary
  URLs into the index.
- Slugs are derived from the transliterated name, not typed by hand
  (`surahSlug`), so they cannot drift from the name they represent. Apostrophes
  are dropped rather than replaced: `al-a'raf` becomes `al-araf`, not
  `al-a-raf`. Uniqueness across all 114 is asserted by a test.
- Facts come from `lib/quran/surah-facts.ts`, which joins the canonical chapter
  table in `lib/quran/chapters.ts` with the English rendering of each name and
  the Makki/Madani classification, and derives the Juz span and length rank.
  **No network call**, deliberately: these pages are built where no Quran
  Foundation credentials exist, so a fetch would either fail the build or
  produce 114 empty pages.
- The pages carry no Qur'an text, no translation, and no generated thematic
  commentary. The ten reviewed descriptions in `SUMMARIES` are shared with
  `/surahs`; the other 104 pages carry facts and tools instead. Writing per-Surah
  summaries from a model's memory is how errors enter religious material, and
  `/terms` commits this site to treating accuracy in Qur'anic matters as the
  highest priority.
- Six Surahs are named for a person or for the letters they open with (Hud,
  Luqman, Sad, Muhammad, Qaf, Quraysh), so their English rendering is the name
  again. `hasDistinctMeaning` suppresses the redundant "Hud (Hud)" in the title,
  heading and lede, and drops the "What does it mean?" question entirely. A test
  pins that set, so a forgotten `MEANINGS` row shows up as a new id rather than
  as a page that repeats itself.

### Ayah-count integrity

`lib/quran/chapters.ts` is the single canonical chapter table, read both by the
catalog (to pad an incomplete upstream response) and by the Surah pages. Its
Ayah counts sum to **6,236**, and a test asserts that total — it is a checksum
over all 114 rows, so one mistyped count fails the build rather than publishing a
wrong answer to someone studying. Juz spans are cross-checked against
`juzForVerseKey`, the same function the in-game Juz hint uses, so a static page
cannot contradict the hint.

### Adding the Surah pages to the sitemap

`INCLUDE_SURAH_PAGES_IN_SITEMAP` in `lib/site/pages.ts` is **`false`**. The
pages are live, indexable, and linked from the full index on `/surahs`, so a
crawler following links finds them at its normal pace. The flag only controls
whether they are *pushed* in `sitemap.xml`.

**It should be `true`, and the reasoning that originally set it to `false` was
wrong.** Recorded rather than quietly deleted, because the wrong version is
plausible and widely repeated.

The claim was that submitting 122 URLs instead of 8 on a new domain would hold
the site back. That is not a documented Google mechanism. Google's crawl-budget
guidance applies to "large sites (1 million+ unique pages)" or "medium or larger
sites (10,000+ unique pages) with very rapidly changing content"; below that its
advice is explicitly to skip the guide and simply keep the sitemap up to date.
Its sitemap guidance is the opposite of the original reasoning: *"be sure to
include all the content that you want Google to crawl."* Google also directly
debunks the adjacent belief that small or new sites get less crawl attention.
The "sandbox" is SEO folklore, not policy.

What is real is the **scaled content abuse** policy — but that is a judgment
about content, not about submission volume, and it is why these pages carry
verifiable facts and working tools instead of reproduced scripture. The mistake
was carrying a content risk over into a claim about sitemap timing.

Withholding them is also actively counterproductive: Google judges the pages on
their merits whether it finds them via the sitemap or via the links on
`/surahs`, so holding them back only delays discovery **and forfeits the
diagnostic**. Sitemap URLs appear in Search Console's Page Indexing report, and
the ratio of indexed to "Crawled – currently not indexed" among the Surah pages
is the direct signal for whether 350 words of facts is enough differentiation.
If most land in "crawled, not indexed", the fix is depth on the pages, not
patience.

Sources: [crawl budget](https://developers.google.com/crawling/docs/crawl-budget),
[crawling myths](https://developers.google.com/crawling/docs/myths-about-crawling).

It is a constant rather than an environment variable on purpose: `lib/site/pages.ts`
is read during a static build, so an env var would only appear to be settable at
runtime. The same trap already caught `SITE_URL`, which is why that one is a
Docker build arg.
