# PhenoSage — Roadmap

---

## Milestone 1 — Usable (Core Loop)

**Goal:** A grower can sign up, create a grow, add plants, upload photos, get real AI analysis, and chat about their grow.

### Web (apps/web)
- [ ] Supabase Auth integration (sign up, sign in, sign out)
- [ ] Grow creation form
- [ ] Plant creation form
- [ ] Photo upload component (sign URL → browser upload → store path in DB)
- [ ] Plant timeline view with real data
- [ ] Real AI analysis triggered on photo upload (via analysis service)
- [ ] Findings display in plant detail page
- [ ] Chat input wired to `/api/chat` with streaming
- [ ] Basic responsive layout / mobile compatibility

### Analysis Service (apps/analysis)
- [ ] Fetch image from Supabase Storage using service role key
- [ ] GPT-4o Vision call with grow context
- [ ] Parse structured findings from GPT response
- [ ] Image comparison (current vs previous)
- [ ] Health score computation

### Database
- [ ] Apply Supabase migrations to production
- [ ] Verify RLS policies work end-to-end
- [ ] Set up `plant-images` storage bucket

### Infrastructure
- [ ] Vercel deployment live
- [ ] Railway deployment live
- [ ] CI green on main

---

## Milestone 2 — Professional

**Goal:** PhenoSage feels like a polished professional tool. Analysis is accurate and trusted. Tracking is effortless.

### Features
- [ ] Health score trend graph over time
- [ ] Finding resolution tracking (mark as resolved)
- [ ] Grow event log (water, feed, top, LST, etc.)
- [ ] Plant observation form (height, notes)
- [ ] Proactive daily summary (Vercel Cron → AI → in-app notification)
- [ ] Task generation from findings
- [ ] Grow stage progression tracking
- [ ] Multiple grows with easy switching
- [ ] Grow members / collaborator invites
- [ ] Settings page (profile, notifications)
- [ ] Export grow history (PDF or CSV)

### Analysis Service
- [ ] Refined prompts with few-shot examples
- [ ] Strain-aware analysis context
- [ ] Confidence scores per finding
- [ ] Image quality validation (reject blurry/dark images)

### Infrastructure
- [ ] Email notifications (Resend or SendGrid)
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
