# PhenoSage — Product Specification

**Version:** 0.1.0  
**Status:** Foundation (Milestone 1 in progress)

---

## Vision

PhenoSage is an **AI grow operating system** for cannabis cultivators. It is not a grow journal. It is a professional-grade platform that combines visual plant analysis, longitudinal health tracking, a grow-aware chatbot, and proactive alerting.

The goal: every grower should have access to the kind of insight that previously required an expert consultant on-site.

---

## Core Philosophy

- **Web-first.** Responsive design serves mobile users. No native app.
- **AI-native.** Every feature is designed around AI analysis, not bolted on.
- **Privacy-preserving.** Images and grow data are stored privately. The browser never calls private backend services directly.
- **Professional grade.** Findings are structured, categorized, and severity-ranked — not vague suggestions.

---

## The Four Pillars

### 1. Visual Grow Doctor

Users upload photos of their plants. The system:

1. Generates a signed upload URL server-side (browser uploads directly to Supabase Storage via the signed URL)
2. Next.js route handler calls the analysis service (Railway) with image metadata + grow context
3. Analysis service fetches the image privately, runs GPT-4o Vision analysis
4. Returns structured `AnalysisResponse` with findings, severity ratings, and recommendations
5. Results are stored in `plant_findings` and surfaced in the plant timeline

**Key constraint:** The browser never calls the Railway analysis service. All AI calls are proxied through Next.js API routes.

### 2. Longitudinal Plant Intelligence

- Every uploaded photo is timestamped and stored in the plant's timeline
- When a new photo is uploaded, the system automatically compares it to the most recent previous photo
- Health scores are tracked over time and surfaced as a trend graph
- Users can scroll back through their full plant history

### 3. Grow-aware Chat Copilot

- The assistant has access to the user's grow data: strains, stage, recent findings, events
- Context is assembled server-side and injected into the Gemini system prompt
- Chat threads are scoped per grow (optional) or general
- Streaming responses via `/api/chat`

### 4. Proactive Recommendations & Alerts

- Daily Vercel Cron job runs at 8:00 AM UTC (configurable)
- Summarizes recent grow activity, open findings, and upcoming milestones
- Generates proactive task suggestions (e.g., "Flush in 3 days", "Check for nitrogen deficiency recurrence")
- Delivers via in-app notifications (Milestone 2) and email (Milestone 3)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (Next.js React)                                        │
│  - Fetches data from /api/* routes only                        │
│  - Uploads images to Supabase Storage via signed URLs          │
│  - Streams chat responses from /api/chat                       │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼────────────────────────────────────────┐
│  Vercel — apps/web (Next.js App Router)                        │
│  The ONLY public origin                                        │
│                                                                │
│  /api/health              → status check                       │
│  /api/chat                → Gemini streaming proxy (OpenAI SDK)│
│  /api/uploads/sign        → Supabase Storage signed URL        │
│  /api/plants/*/timeline   → DB query via service role          │
│  /api/plants/*/analysis   → analysis service proxy             │
│  /api/internal/cron/*     → Vercel Cron handlers               │
└──────────┬──────────────────────────────┬───────────────────────┘
           │ service role key             │ internal API key
┌──────────▼─────────────┐   ┌───────────▼────────────────────────┐
│  Supabase              │   │  Railway — apps/analysis (FastAPI) │
│  - Auth                │   │  - POST /analyze                   │
│  - Postgres + RLS      │   │  - GET /health                     │
│  - Storage (private)   │   │  Never directly reachable          │
│                        │   │  from the browser                  │
└────────────────────────┘   └────────────────────────────────────┘
```

---

## Data Model (Summary)

| Table                | Purpose                                    |
| -------------------- | ------------------------------------------ |
| `profiles`           | User display names, avatars                |
| `grows`              | Grow rooms/tents — the top-level container |
| `grow_members`       | RBAC: owner / collaborator / viewer        |
| `grow_tasks`         | Generated/manual tasks per grow (M2)       |
| `plants`             | Individual plants within a grow            |
| `plant_images`       | Photo uploads with storage paths           |
| `plant_observations` | Manual height/notes logs                   |
| `plant_findings`     | AI-generated or user-reported findings     |
| `plant_analyses`     | Persisted AI analysis runs                 |
| `analysis_jobs`      | Async analysis job tracking                |
| `grow_events`        | Water, feed, topping, etc.                 |
| `chat_threads`       | Conversation threads                       |
| `chat_messages`      | Individual messages (user + assistant)     |
| `chat_attachments`   | Image attachments on chat messages         |
| `notifications`      | Per-user feed (daily summary, alerts)      |

---

## What Is In Scope (Now)

- Grow creation
- Plant creation and management
- Photo upload flow (signed URLs → private storage)
- Plant photo timeline
- Structured AI plant analysis (stub → real in M1)
- Compare current upload to previous uploads
- Chatbot scoped to grow context
- Proactive daily summary (cron)
- Task/reminder generation framework

## What Is Out of Scope

- Native mobile app (iOS/Android)
- Community / social features
- Marketplace / e-commerce
- SQLite
- Direct browser access to Railway or Supabase service role
- Public image URLs

---

## Security Constraints

1. `SUPABASE_SERVICE_ROLE_KEY` — server-side only (never in `NEXT_PUBLIC_*`)
2. `ANALYSIS_SERVICE_API_KEY` — server-side only
3. `GEMINI_API_KEY` — server-side only (chat). Analysis service has its own server-only `OPENAI_API_KEY`.
4. All Supabase Storage buckets are **private** — signed URLs only
5. Browser communicates only with Vercel (Next.js) — never directly with Railway
6. Vercel Cron endpoints protected by `CRON_SECRET`
7. All DB mutations from API routes use the service role client with explicit access checks
