# PhenoSage — Roadmap

---

## Milestone 1 — Usable (Core Loop)

**Goal:** A grower can sign up, create a grow, add plants, upload photos, get real AI analysis, and chat about their grow.

### Web (apps/web)

- [x] Supabase Auth integration (sign up, sign in, sign out)
- [x] Grow creation form
- [x] Plant creation form
- [x] Photo upload component (sign URL → browser upload → store path in DB)
- [x] Plant timeline view with real data
- [x] Real AI analysis triggered on photo upload (via analysis service)
- [x] Findings display in plant detail page
- [x] Chat input wired to `/api/chat` with streaming
- [x] Basic responsive layout / mobile compatibility

### Analysis Service (apps/analysis)

- [x] Fetch image from Supabase Storage using service role key
- [x] GPT-4o Vision call with grow context
- [x] Parse structured findings from GPT response
- [x] Image comparison (current vs previous)
- [x] Health score computation

### Database

- [x] Apply Supabase migrations to production (now one-click via the `Database migrations` GitHub Action — see `docs/deployment.md`)
- [x] Verify RLS policies work end-to-end
- [x] Set up `plant-images` storage bucket

### Infrastructure

- [x] Vercel deployment live
- [x] Railway deployment live
- [x] CI green on main

---

## Milestone 2 — Professional

**Goal:** PhenoSage feels like a polished professional tool. Analysis is accurate and trusted. Tracking is effortless.

### Features

- [ ] Health score trend graph over time
- [x] Finding resolution tracking (mark as resolved)
- [x] Grow event log (water, feed, top, LST, etc.)
- [x] Plant observation form (height, notes)
- [x] Proactive daily summary (Vercel Cron → AI → in-app notification) — server-side pipeline, inbox UI, per-user timezone for `occurred_on`, and email delivery are shipped.
- [x] Task generation from findings
- [x] Grow stage progression tracking
- [x] Multiple grows with easy switching
- [ ] Grow members / collaborator invites
- [x] Settings page (profile, notifications)
- [ ] Export grow history (PDF or CSV)

### Analysis Service

- [ ] Refined prompts with few-shot examples
- [x] Strain-aware analysis context
- [x] Confidence scores per finding
- [x] Image quality validation (reject blurry/dark images)

### Infrastructure

- [x] Email notifications (Resend or SendGrid)
- [ ] Supabase Realtime for live findings updates
- [ ] Error monitoring (Sentry)
- [ ] Performance monitoring

---

## Milestone 3 — Ultimate Assistant

**Goal:** PhenoSage is the definitive AI platform for serious cannabis cultivators.

### Features

- [ ] pgvector semantic search over grow history
- [ ] "Ask about any past grow" AI memory
- [ ] Automated grow advisor: suggests feed schedule adjustments
- [ ] Phenotype tracking (multi-run comparisons)
- [ ] Harvest prediction (AI-estimated based on photo analysis)
- [ ] Environmental data integration (pH, EC, VPD logging)
- [ ] Grow report generation (detailed PDF per harvest)
- [ ] API access for advanced users

### Infrastructure

- [ ] pgvector enabled for semantic search
- [ ] Background job queue (Railway worker) for heavy analysis
- [ ] CDN-optimized image serving
- [ ] Audit log for all AI calls

---

## Non-Goals (Permanently Out of Scope)

- Native iOS or Android app
- Community / social features (forum, follows, sharing)
- Marketplace or e-commerce
- SQLite
- Direct browser access to Railway or Supabase service role keys
- Multi-tenant SaaS billing (may reconsider post-M3)
