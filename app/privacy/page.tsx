import type { Metadata } from "next";
import Link from "next/link";

import { SitePage } from "@/components/site/SitePage";

export const metadata: Metadata = {
  alternates: { canonical: "/privacy" },
  title: "Privacy — SurahSpot",
  description:
    "What SurahSpot stores, what it sends elsewhere, and what stays on your device.",
};

/**
 * Written from what the code actually does, not from a template.
 *
 * Every claim here is checkable in the repository: the cookie is set in
 * lib/game/attempt-service.ts, the feedback transport in
 * lib/feedback/delivery.ts, the push records in lib/notifications/store.ts,
 * and the rate-limit keys in lib/http/rate-limit.ts. If any of those change,
 * this page is wrong and needs changing with them.
 */
export default function PrivacyPage() {
  return (
    <SitePage>
      <section className="content-section legal-page" aria-labelledby="privacy-title">
        <header className="legal-head">
          <p className="eyebrow">PRIVACY</p>
          <h1 id="privacy-title">
            What SurahSpot knows
            <br />
            <em>about you.</em>
          </h1>
          <p className="legal-lede">
            Short version: there is no analytics, no advertising, and no tracking of any
            kind. Almost everything SurahSpot remembers stays on your own device.
          </p>
        </header>

        <div className="legal-body">
          <h2>What stays on your device</h2>
          <p>
            Your reading position, streak, daily goal, My List, hidden Ayahs, memorization
            progress, reader preferences and theme are all kept in your browser&rsquo;s local
            storage. They are never sent anywhere. Clearing your browser data removes them,
            and they do not follow you to another device.
          </p>

          <h2>Cookies</h2>
          <p>
            One cookie, named <code>surahspot_attempt</code>. It identifies your current
            seven-round attempt so the server can tell that a guess belongs to the round it
            was issued for. It carries no name, no email and no identifier that is useful
            anywhere else.
          </p>
          <p>
            There are no analytics cookies, no advertising cookies and no third-party
            cookies, because there is no analytics, advertising or third-party script on
            this site at all. This is why you are not being asked to accept anything.
          </p>

          <h2>What the server records</h2>
          <ul>
            <li>
              <strong>Your IP address, briefly.</strong> Used to count requests per minute so
              the site cannot be hammered into unavailability. These counters expire within
              the hour and are not used for anything else.
            </li>
            <li>
              <strong>Ordinary server logs.</strong> Errors and request failures, kept to find
              and fix faults.
            </li>
          </ul>

          <h2>If you send feedback</h2>
          <p>
            The form in the footer sends whatever you type &mdash; your message, and your name
            and email if you choose to give them &mdash; to the site owner by email, through
            the delivery provider Resend. Name and email are optional; a message alone works,
            though then there is no way to reply. Nothing from the form is stored on this
            site, and nothing is added to a mailing list.
          </p>

          <h2>If you turn on reminders</h2>
          <p>
            Only if you ask for them. Turning reminders on stores a push subscription for that
            browser: an endpoint URL supplied by your browser vendor&rsquo;s push service, the
            keys needed to encrypt messages to it, your time zone, and three facts about your
            reading &mdash; the day you last read and your current streak length, which keep
            the streak reminder honest, and the number of the Surah you last left off in,
            which the afternoon reminder names.
          </p>
          <p>
            Where you are within that Surah is not sent, and neither is anything else you
            read: the streak reminder needs to know <em>whether</em> you read today, and the
            afternoon one which Surah to open. Turning reminders off deletes the record, and
            a subscription the push service reports as dead is deleted automatically.
          </p>

          <h2>Who else is involved</h2>
          <ul>
            <li>
              <strong>Quran Foundation</strong> supplies the Qur&rsquo;an text, translations and
              recitations. Your browser never contacts them directly; this server fetches the
              content and passes it on, so they do not see you.
            </li>
            <li>
              <strong>Fly.io</strong> hosts the site and necessarily handles the traffic.
            </li>
            <li>
              <strong>Resend</strong> delivers feedback messages, and only if you send one.
            </li>
            <li>
              <strong>Your browser vendor&rsquo;s push service</strong> &mdash; Apple, Google or
              Mozilla &mdash; delivers reminders, and only if you turn them on.
            </li>
          </ul>

          <h2>Children</h2>
          <p>
            SurahSpot is suitable for all ages and asks for no personal information to use it.
            Nothing here is directed at collecting data from children, because nothing here
            collects data from anyone unless they type it into the feedback form.
          </p>

          <h2>Removing what there is</h2>
          <p>
            Clear your browser data to remove everything stored on your device, including the
            cookie. Turn reminders off to delete the push subscription. For anything sent
            through the feedback form, ask via that same form and it will be deleted.
          </p>

          <h2>Changes</h2>
          <p>
            If what the site collects changes, this page changes with it. It describes the
            code as it stands, not an intention.
          </p>

          <p className="legal-contact">
            Questions go to the feedback form at the bottom of any page, or see the{" "}
            <Link href="/terms">terms</Link>.
          </p>
        </div>
      </section>
    </SitePage>
  );
}
