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

**One Express process, one SQLite file, one `rsvps` table.** Everything routes through `server.js`:

- `POST /api/rsvp` — public; validates and inserts into the `rsvps` table.
- `GET /healthz` — Render's healthcheck.
- `GET /${ADMIN_PATH}` and `/${ADMIN_PATH}/api/{list,download,rsvp/:id}` — admin routes. **The admin path is registered at server boot from the `ADMIN_PATH` env var**, so changing it requires a restart. It's a "secret URL" plus HTTP Basic Auth (`ADMIN_USER` / `ADMIN_PASS`) — both are required.
- Static assets are served from `public/`.

The admin frontend (`public/js/admin.js`) reads `window.location.pathname` to derive `ADMIN_BASE` and uses it for fetch calls — so the admin page works regardless of what `ADMIN_PATH` is set to without any rebuild.

**Persistence:** SQLite file at `DB_PATH` (default `./data/rsvps.db`). On Render's free plan there is no persistent disk, so the DB is wiped on redeploy/restart. The `render.yaml` has a commented-out `disk:` block for the Starter plan; the Dockerfile already declares `/app/data` as a `VOLUME`.

**Frontend layout:**
- `public/index.html` — invitation page. Look for `✏️ EDIT` comments to find the content (kids' names, ages, date, venue) that's intended to be customized inline.
- `public/js/main.js` — countdown, RSVP submit, cover→card reveal, Web Audio jingle. The event date is hard-coded as `EVENT_DATE` near the top.
- `public/js/scene.js` — Three.js background scene (Mickey-ear silhouettes, balloons, stars, mouse parallax).
- `public/js/admin.js` — dashboard table, stats, filters, delete, Excel download link.

**Music:** there are no audio files. The "jingle" is synthesized on demand with the Web Audio API (`OscillatorNode`s playing a hard-coded melody in `main.js`). This is intentional — keeps the site small and copyright-clean.

## Environment variables

Required for any non-default deployment: `ADMIN_USER`, `ADMIN_PASS`, `ADMIN_PATH`. Optional: `DB_PATH` (where SQLite lives), `PORT`. See `.env.example`. Defaults in `server.js` are placeholders ("changeme123") — never ship them.
