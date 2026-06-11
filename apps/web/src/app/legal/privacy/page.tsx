import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — PhenoSage",
  description: "How PhenoSage collects, uses, and protects your data.",
};

const LAST_UPDATED = "June 11, 2026";

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>Last updated: {LAST_UPDATED}</p>

      <h2>1. What we collect</h2>
      <ul>
        <li>
          <strong>Account data</strong> — your email address, password hash, and
          optional display name, managed by Supabase Auth.
        </li>
        <li>
          <strong>Grow data</strong> — the grows, plants, photos, observations,
          tasks, and chat messages you create. Plant photos are stored in a
          private storage bucket and served only through short-lived signed
          URLs.
        </li>
        <li>
          <strong>Operational data</strong> — server logs with request IDs and
          timestamps for debugging and abuse prevention. Logs do not include
          your photos or message bodies.
        </li>
      </ul>

      <h2>2. How your data is used</h2>
      <ul>
        <li>
          To run the product: store your grow journal, render your dashboard,
          and send the notifications you opt into.
        </li>
        <li>
          <strong>AI processing</strong> — when an image is analyzed, it is sent
          to a third-party AI provider (currently OpenAI for vision analysis;
          Google Gemini powers chat and summaries). Only what is needed for the
          request is sent; these providers process it under their API terms,
          which exclude API data from model training by default.
        </li>
        <li>
          <strong>Email</strong> — daily summaries and finding alerts are
          delivered via Resend only if you enable them in Settings.
        </li>
      </ul>

      <h2>3. What we do not do</h2>
      <ul>
        <li>We do not sell your data or share it with advertisers.</li>
        <li>We do not use your photos to train models.</li>
        <li>
          We do not expose your content to other users — every database row is
          protected by per-user row-level security.
        </li>
      </ul>

      <h2>4. Where data lives</h2>
      <p>
        Data is stored in Supabase (Postgres + object storage). The web app runs
        on Vercel; the analysis service runs on Railway. Each processes data
        only as needed to serve your requests.
      </p>

      <h2>5. Retention and deletion</h2>
      <p>
        Your data is kept while your account is active. To delete your account
        and all associated data, contact the operator via the address published
        on the project repository; deletion requests are honored within 30 days.
        An in-app self-service deletion and export flow is planned and will
        replace this manual process.
      </p>

      <h2>6. Sensitivity of cultivation data</h2>
      <p>
        We treat grow data as sensitive: cannabis cultivation records can carry
        legal risk in some jurisdictions. Access is restricted to your
        authenticated account, secrets are server-side only, and images are
        never publicly addressable. Consider what you upload and the laws that
        apply to you.
      </p>

      <h2>7. Cookies</h2>
      <p>
        Only authentication session cookies (Supabase) are used. There are no
        third-party advertising or analytics cookies.
      </p>

      <h2>8. Changes and contact</h2>
      <p>
        Material changes to this policy will appear on this page with a new
        “last updated” date. Questions or requests: open an issue on the project
        repository or contact the operator at the address published there.
      </p>

      <p>
        <em>
          Note: this document is a general template provided in good faith and
          has not been reviewed by counsel. Before a public commercial launch,
          have it reviewed by a lawyer familiar with your jurisdiction (GDPR /
          CCPA applicability depends on where your users are).
        </em>
      </p>
    </>
  );
}
