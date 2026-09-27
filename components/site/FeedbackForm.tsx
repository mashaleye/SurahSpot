"use client";

import { FormEvent, useState } from "react";

type SubmitState = "idle" | "sending" | "sent" | "error";

export function FeedbackForm() {
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending") return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      message: String(data.get("message") ?? "").trim(),
      company: String(data.get("company") ?? "").trim(), // honeypot
    };

    setState("sending");
    setMessage("");

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not send your message.");

      form.reset();
      setState("sent");
      setMessage("Thanks — your message was sent.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Could not send your message.");
    }
  }

  return (
    <form className="footer-feedback" onSubmit={submit} aria-label="Send SurahSpot feedback">
      <div className="footer-feedback-heading">
        <b>Feedback or contact</b>
        <span>Send a note without opening your email app.</span>
      </div>
      <div className="footer-feedback-fields">
        <label>
          <span>Name <small>optional</small></span>
          <input name="name" type="text" autoComplete="name" maxLength={80} placeholder="Your name" />
        </label>
        <label>
          <span>Email <small>optional</small></span>
          <input name="email" type="email" autoComplete="email" maxLength={160} placeholder="you@example.com" />
        </label>
      </div>
      <label>
        <span>Message</span>
        <textarea name="message" required minLength={4} maxLength={3000} rows={4} placeholder="What should we know?" />
      </label>

      {/* Humans never see this field. Bots that fill every input are accepted
          with a no-op response by the API so they do not learn the trap. */}
      <label className="feedback-honeypot" aria-hidden="true">
        Company
        <input name="company" tabIndex={-1} autoComplete="off" />
      </label>

      <div className="footer-feedback-action">
        <button className="footer-send" type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Send message"}
        </button>
        <span className={`feedback-form-status ${state}`} aria-live="polite">{message}</span>
      </div>

      {/* Said at the point of sending, which is the only place it is any use. */}
      <p className="feedback-consent">
        Sending this emails your message to the site owner. Nothing is stored here or added
        to a mailing list &mdash; see the <a href="/privacy">privacy page</a>.
      </p>
    </form>
  );
}
