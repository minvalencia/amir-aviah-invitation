# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Single-page 3D-animated birthday invitation site with an RSVP form and a hidden admin dashboard for tracking responses. Deployed to Render's free tier via Docker.

## Commands

```bash
npm install          # install deps (better-sqlite3 needs Python 3 + C++ toolchain locally)
npm start            # run server on $PORT (default 3000); also bound to `npm run dev`

docker build -t invitation .
docker run -p 3000:3000 -e ADMIN_USER=... -e ADMIN_PASS=... -e ADMIN_PATH=... \
  -v $(pwd)/data:/app/data invitation
```

There is no build step, no linter, no test suite. The frontend is plain ES modules served as static files; Three.js is pulled from `unpkg` at runtime via an importmap in `public/index.html` (no bundler).

If `better-sqlite3` fails to compile locally, build inside Docker — the Dockerfile installs `python3 make g++ libc-dev` in an Alpine builder stage and copies the compiled native module into the runtime image.

## Architecture

**One Express process, one SQLite file, two tables (`families` + `attendees`).** Everything routes through `server.js`:

- `GET /` — public landing in `gate-link` mode (no RSVP form; "this invitation requires a personal link").
- `GET /i/:token` — family invitation page. Server-side renders `public/index.html` with three landing modes (`gate-link` / `gate-invalid` / `gate-family`) by `String#replace`-ing three markers (`<!--LANDING_MODE-->`, `<!--FAMILY_NAME-->`, `<!--FAMILY_DATA_JSON-->`). `index.html` is read once at startup and cached in memory. **Important:** the dynamic routes are registered before `app.use(express.static(...))` so they win over the static handler for `/`. All HTML routes set `Cache-Control: no-store`.
- `GET /api/family/:token` — public read; returns the family record + attendees as JSON. `Cache-Control: no-store`. Token format guarded by a `^[A-Za-z0-9]{12}$` regex before any DB hit.
- `POST /api/family/:token/rsvp` — public write/update. Body shape is `{ attending, adults?: [{name}], kids?: [{name}], message? }`. Validation order is deliberate: `attending` ∈ {yes,no} → if `'no'` zero out attendees → if `'yes'` then `adults` and `kids` arrays each capped at `family.adult_slots` / `family.kid_slots` *before* walking (so a 10MB payload of names is rejected without inspection), then `adults.length + kids.length ≥ 1`, then per-row blank-name rejection. The DB write is wrapped in `db.transaction(() => …)` so concurrent submits never see torn state.
- `GET /healthz` — Render's healthcheck.
- `GET /${ADMIN_PATH}` and `/${ADMIN_PATH}/api/{families,families/:id,download}` — admin routes. **The admin path is registered at server boot from the `ADMIN_PATH` env var**, so changing it requires a restart. It's a "secret URL" plus HTTP Basic Auth (`ADMIN_USER` / `ADMIN_PASS`); the `adminAuth` middleware is applied **per route** (no shared sub-router), so adding a new admin route means remembering to wire `adminAuth` again.
- Static assets are served from `public/`.

**Token model:** Each family has an opaque 12-character base62 token generated server-side via rejection-sampling on `crypto.randomBytes()` (bytes ≥ 248 dropped to avoid modulo bias). Possessing the link IS the credential — there is no login. The token URL `/i/<token>` is unguessable (search space ≈ 3.2 × 10²¹).

**Slot model:** Each family has independent `adult_slots` and `kid_slots` caps (each 0–20, sum 1–20). The RSVP form renders two stacked sections (Adults / Kids) inside the YES branch, each with count pills `0..N` and that many name fields; a section whose slot count is `0` is hidden entirely. The `attendees` table tags each row with `kind ∈ {adult, kid}`.

**Edit semantics:** Re-submitting an RSVP overwrites prior state. Attendees are wiped and re-inserted on every submit — adults first (positions `0..n-1`) then kids (positions `n..n+m-1`), each with the matching `kind`. `claimed_at` is set on first submit (`COALESCE(claimed_at, CURRENT_TIMESTAMP)`); `updated_at` is set on every submit. The "EDITED" chip in the admin dashboard is derived from `updated_at - claimed_at > 1s`. The denormalised `attendee_count` column is rewritten as `adults.length + kids.length` on every submit (server is the single source of truth — clients never send it).

**Timestamp serialization:** SQLite returns timestamps as `'YYYY-MM-DD HH:MM:SS'` UTC without a `Z`, which browsers parse as local time. The server converts every timestamp it emits to ISO-8601 with a `Z` suffix (`isoOrNull` / `isoOrEmpty` helpers); both the JSON API and the Excel export use the same conversion.

The admin frontend (`public/js/admin.js`) reads `window.location.pathname` to derive `ADMIN_BASE` and uses it for fetch calls — so the admin page works regardless of what `ADMIN_PATH` is set to without any rebuild. The admin's "Add Family" form auto-copies the new share URL to clipboard via `navigator.clipboard.writeText` (with a `window.prompt` fallback when the API is unavailable, e.g. on non-HTTPS).

**Persistence:** SQLite file at `DB_PATH` (default `./data/rsvps.db` — name kept for backward compatibility despite the new schema). The schema-sync block in `server.js` runs on every boot, idempotently creates the new tables via `CREATE TABLE IF NOT EXISTS` and drops the legacy `rsvps` table if present. **Migration:** if the existing `families` table has the old `max_slots` column, the boot block performs a guarded full table rebuild inside a transaction (the only safe pattern given SQLite < 3.35 lacks `DROP COLUMN`); legacy rows migrate as `adult_slots = max_slots, kid_slots = 0`. `foreign_keys` is explicitly toggled OFF for the rebuild — `better-sqlite3` defaults FKs to ON (unlike vanilla SQLite), so otherwise the `DROP TABLE families` would cascade-delete every attendee row. After migration FKs are re-enabled so `ON DELETE CASCADE` from `families` to `attendees` works at runtime. On Render's free plan there is no persistent disk, so the DB is wiped on redeploy/restart. The `render.yaml` has a commented-out `disk:` block for the Starter plan; the Dockerfile already declares `/app/data` as a `VOLUME`.

**Frontend layout:**
- `public/index.html` — single-template page rendered in three landing modes via `body[data-landing-mode="…"]` + CSS gating. Look for `✏️ EDIT` comments for content (date, venue) that's intended to be customized inline.
- `public/js/main.js` — countdown, family-aware RSVP form (two stacked count-pill sections — Adults / Kids — with per-section name fields; edit-on-revisit pre-fills both sections from the prior submission), HUD progress, stamped boarding pass + downloadable PNG snapshot (`buildPassSnapshot`, attendees grouped as Adults / Kids in both surfaces), hidden-Mickey gamification, Web Audio jingle. Reads the server-injected `<script id="family-data">` JSON island; if absent (gate-link / gate-invalid mode), the submit handler is not bound. The event date is hard-coded as `EVENT_DATE` near the middle.
- `public/js/scene.js` — Three.js background scene (Mickey-ear silhouettes, balloons, stars, mouse parallax). Content-agnostic; do not edit when changing copy or family logic.
- `public/admin.html` + `public/js/admin.js` — dashboard with Add-Family card (separate Adults / Kids slot inputs, auto-copy share URL on save), 6 stat tiles (Families / Yes / No / Pending / Adults / Kids), families table with status pills (Yes / No / Pending / EDITED) and a `2A+1K / 3A+2K` slots column, expand-rows that group attendees as Adults / Kids sub-lists alongside the family message, copy-link button, delete button (native `confirm()` + family-name reminder), filter pills, two-sheet Excel download (Families sheet has separate `Adults Used` / `Adults Max` / `Kids Used` / `Kids Max` columns; Attendees sheet has a `Kind` column).

**Music:** there are no audio files. The "jingle" is synthesized on demand with the Web Audio API (`OscillatorNode`s playing a hard-coded melody in `main.js`). This is intentional — keeps the site small and copyright-clean.

## Environment variables

Required for any non-default deployment: `ADMIN_USER`, `ADMIN_PASS`, `ADMIN_PATH`. Optional: `DB_PATH` (where SQLite lives), `PORT`. See `.env.example`. Defaults in `server.js` are placeholders ("changeme123") — never ship them.
