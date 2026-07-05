# Realtime Spanish Teacher (Web)

Live voice Spanish lessons in the browser. An AI teacher (`gpt-realtime-2` over WebRTC) speaks the same scripted lessons as the [Android app](https://github.com/eiliyaabedini/LanguageLearningApp), listens to your answers, coaches you in soft simple English, and remembers how you learn — while the app keeps deterministic control of the script, attempts, and saved progress.

## How it works

```
Browser ── WebRTC audio + "oai-events" data channel ──► OpenAI Realtime API
   │                                                        ▲
   │  orchestrator (lib/realtime/orchestrator.ts)           │ ephemeral client secret
   │  owns the lesson state machine; the model only         │
   ▼  speaks, listens, grades (report_attempt tool)         │
Next.js route handlers ── Drizzle ──► Supabase Postgres + Auth
```

- **The app owns the script.** Each turn, the model receives one instruction: speak this line verbatim, listen, then call `report_attempt(transcript, accepted, feedback)`. The app decides retry/advance (3 attempts, then teach-then-advance), saves every attempt, and issues the next turn. See `lib/lesson-machine/` (pure, fully unit-tested) and `lib/realtime/`.
- **Learner memory.** The model may call `update_learner_memory` with durable observations; they're stored per user, injected into the next session's persona, and fully visible/deletable on `/memory`.
- **Progress parity with Android:** `user_progress(lesson_id, line_index, user_response, is_correct)` with identical resume semantics.

## Setup

1. **Create the Vercel project** — import this repo at vercel.com/new.
2. **Create Supabase via the Vercel Marketplace** — Vercel project → Storage → Supabase → Create (this injects the Supabase env vars). Locally: `vercel link && vercel env pull .env.local`.
3. **Fill in the rest of `.env.local`** (see `.env.example`): `DATABASE_URL` (transaction pooler, port 6543), `APP_SECRET` (`openssl rand -base64 32`), optionally a shared `OPENAI_API_KEY` — without it, each user adds their own key in Settings.
4. **Run migrations:** `npx drizzle-kit migrate` (creates tables, FKs to `auth.users`, RLS).
5. **Enable auth providers** in Supabase dashboard → Authentication:
   - Google: create an OAuth client in Google Cloud Console with redirect `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`, paste client id/secret into the Google provider.
   - Magic link (email) works out of the box.
   - Add your site URL(s) under Authentication → URL Configuration.
6. **Add the same env vars to Vercel** (Settings → Environment Variables) and deploy. The weekly cron in `vercel.json` pings `/api/keepalive` so the free Supabase project never pauses.

Local dev: `npm install && npm run dev` → http://localhost:3000 (use the localhost URL in Supabase's redirect allowlist too).

## Adding lessons

Lessons live in `lib/lessons/content/` and are plain text:

```
Teacher: How do we greet a group? Hola a todos.
Student: Hola a todos.
```

1. Add `lessonXpY.txt` with alternating `Teacher:` / `Student:` lines (consecutive `Teacher:` lines merge into one turn; other prefixes are ignored).
2. Register it in `lib/lessons/content/index.json` with `id`, `title`, `description` (order in this file = order in the catalog).
3. Done — the catalog, session, progress, and resume all pick it up automatically. `npm test` validates every registered lesson parses.

The Android repo remains the source of truth for shared lessons; re-sync with `./scripts/sync-lessons.sh`.

## Development

- `npm test` — parser, state machine, and orchestrator turn-loop suites (45 tests).
- `npm run dev` with `?debug=1` on a lesson page — live overlay with per-session cost, token counts, p50 turn latency, and verbatim-drift score for every scripted line.
- All OpenAI Realtime API shapes are isolated in `lib/realtime/events.ts` — if the API changes, fix it there.

## Cost

A 10-minute lesson costs roughly **$0.50–0.65** (audio out dominates at $64/1M tokens). The orchestrator keeps cost flat by deleting old conversation items after each line — the app re-supplies all needed context in each turn's instructions. Sessions hard-cap at 20 minutes; 3 minutes of silence ends a session gracefully. Check real numbers in the `?debug=1` overlay.
