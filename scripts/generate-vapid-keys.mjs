#!/usr/bin/env node

/**
 * Generate the VAPID keypair that signs push messages.
 *
 * Run once per deployment:
 *
 *   npm run gen:vapid
 *
 * The pair identifies this server to every push service. Rotating it
 * invalidates every existing subscription — browsers will have to subscribe
 * again — so generate it once and keep the private key out of the repo.
 */

import { randomBytes } from "node:crypto";

import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

// A dispatch secret is needed alongside the pair, and generating it here
// means one fewer step someone can skip and leave the endpoint open.
const dispatchSecret = randomBytes(32).toString("base64url");

process.stdout.write(`
Add these to .env.local (development) or your host's environment (production):

VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:you@example.com
NOTIFICATIONS_DISPATCH_SECRET=${dispatchSecret}

Notes
  · VAPID_SUBJECT must be a mailto: or https: URL a push service can use to
    reach you about your traffic. Replace the placeholder above.
  · VAPID_PRIVATE_KEY and NOTIFICATIONS_DISPATCH_SECRET are secrets. The
    public key is served to browsers by /api/notifications/subscribe and is
    meant to be public.
  · Changing the keypair unsubscribes every device. Changing only the
    dispatch secret is safe and affects nothing but the scheduler.

Then point a scheduler at the dispatch endpoint, roughly hourly:

  curl -fsS -X POST https://your-host/api/notifications/dispatch \\
    -H "Authorization: Bearer $NOTIFICATIONS_DISPATCH_SECRET"

Running more often than the four-hour slots is safe: delivery is keyed by
slot, so extra runs only pick up readers whose local slot has just opened.
`);
