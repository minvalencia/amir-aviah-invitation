# Family Invitation Links — Design

**Status:** Approved by user (brainstorming) · awaiting spec review
**Date:** 2026-05-03
**Project:** `D:\Projects\invitation` — The Valencia Kingdom

## 1. Problem and goal

Today, anyone who knows the URL of the invitation site can submit an RSVP via the open `POST /api/rsvp` endpoint. The host has no control over who responds, can't enforce a per-family attendee cap, and can't pre-attribute responses to a specific family. For a christening + 3rd-birthday combo with venue capacity, this is the wrong shape.

**Goal:** Replace the open-RSVP model with **per-family invitation links**. Each family gets a unique, unguessable URL with a quota of attendee slots set by the host. When the family visits the link, they confirm attendance and supply one name per attendee, capped at their quota. The admin dashboard manages families and exports the resulting list.

**Non-goals** (deliberately out of scope — see §10):
- Email/SMS delivery of links.
- Login/identity beyond possession-of-link.
- Edit history / audit log.
- Per-attendee child-vs-adult split.
- A retained "open RSVP" path.

## 2. Decisions

The design was settled in five clarifying rounds. Each is anchored here so the spec is self-contained.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Replace** the open RSVP flow entirely. The public landing becomes a "this invitation requires a personal link" gate. | Slot quotas are meaningless if anyone can bypass them. |
| D2 | URLs use **opaque tokens** (`/i/<12-char-base62>`). Family names are not in the URL. | Unguessable, simple, the recipient never reads the URL anyway. |
| D3 | Attendee names: **one per attendee, all required when attending**. Single attendee count, no kids/adults split. | Tightest data, cleanest seating list. |
| D4 | Family can **edit anytime**; latest submission wins. No deadline lock. | Plans change. Forcing remedial messages to host adds friction. |
| D5 | Admin UX: **single-family create form**, with the share link **auto-copied to clipboard** on save. | Fast paste-into-WhatsApp loop; bulk paste is YAGNI. |

## 3. Data model

Two new SQLite tables. The existing `rsvps` table is dropped on first boot of the new code.

```sql
CREATE TABLE families (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  token           TEXT NOT NULL UNIQUE,        -- 12-char base62 generated server-side
  name            TEXT NOT NULL,               -- e.g. "Valencia Family"
  max_slots       INTEGER NOT NULL CHECK (max_slots BETWEEN 1 AND 20),
  attending       TEXT CHECK (attending IN ('yes', 'no')),  -- NULL means not yet claimed
  attendee_count  INTEGER CHECK (attendee_count >= 0),
  message         TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  claimed_at      DATETIME,                    -- when first RSVP submitted
  updated_at      DATETIME                     -- when last edited
);
CREATE INDEX idx_families_token ON families(token);

CREATE TABLE attendees (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id  INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL                  -- 0-based stable ordering
);
CREATE INDEX idx_attendees_family ON attendees(family_id);
```

### Derived state

- **Status:**
  - `attending IS NULL` → "Pending"
  - `attending = 'yes'` → "Yes" (or "Yes (edited)" if `updated_at > claimed_at`)
  - `attending = 'no'`  → "No"  (or "No (edited)" if `updated_at > claimed_at`)
- **Slots used:** `attendee_count` for `attending='yes'`, else `0`.

### Token generation

12 characters from base62 alphabet (`A–Z a–z 0–9`). Search space ≈ 3.2 × 10²¹.

Algorithm: rejection-sample bytes from `crypto.randomBytes()` into base62. Pull 16 bytes at a time; for each byte `b`, if `b < 248` (`248 = 4 × 62`, the largest multiple of 62 that fits in a byte) accept `alphabet[b % 62]`, else reject and continue. Repeat until 12 characters accumulated. This is uniform — no modulo bias — and a single 16-byte draw is almost always enough.

Wrap the `INSERT INTO families` in a try/catch on the `UNIQUE` constraint; on collision, regenerate the token and retry. Collisions are vanishingly rare but the loop is cheap insurance.

### Edit semantics

When a family POSTs an updated RSVP, the server runs a `better-sqlite3` `db.transaction(...)` so the three statements below execute atomically and a concurrent reader never sees an empty `attendees` mid-write:

1. `UPDATE families SET attending=?, attendee_count=?, message=?, claimed_at=COALESCE(claimed_at, CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP WHERE token=?`.
2. `DELETE FROM attendees WHERE family_id=?`.
3. `INSERT INTO attendees (family_id, name, position) VALUES (...)` for each name in the new submission. `position` is assigned in submit-order: `0, 1, 2, …` matching the order the names arrive in the request body.

Wiping and re-inserting is simpler than diffing and the row volume is tiny.

Two browsers from the same family submitting at the same instant will serialize through `better-sqlite3`'s synchronous engine — last write wins, no torn state.

## 4. URL and API surface

All public endpoints respond with JSON `{ ok: boolean, … }`. All admin endpoints sit behind the existing `${ADMIN_PATH}` slug + HTTP basic auth.

### Public

| Method | Path | Purpose |
|---|---|---|
| GET    | `/`                          | Landing page. Same Kingdom hero, but no RSVP form — instead a "This invitation requires a personal link. Please ask your host." card. |
| GET    | `/i/:token`                  | Invitation page. Returns 404 page with castle silhouette if token unknown. Otherwise renders the Kingdom hero with the family name pre-bound. |
| GET    | `/api/family/:token`         | JSON read. Returns `{ ok, family: { name, max_slots, attending, attendee_count, attendees: [{name, position}], message, claimed_at, updated_at } }`. 404 if unknown. |
| POST   | `/api/family/:token/rsvp`    | Submit/update. Body validated (see §5). Idempotent. Returns updated family record. |

### Admin

Every admin route below is mounted with the existing `adminAuth` middleware (HTTP basic auth) **explicitly per route** — there is no shared sub-router today and the implementer must apply the middleware to each `app.get/post/delete(...)` call individually, matching the existing pattern in `server.js`.

| Method | Path | Purpose |
|---|---|---|
| GET    | `/${ADMIN_PATH}`                              | Dashboard HTML. (adminAuth) |
| GET    | `/${ADMIN_PATH}/api/families`                  | List of all families with attendee details. Returns `{ ok, stats, families: [...] }` where each family has its `attendees[]` and a derived `share_url`. (adminAuth) |
| POST   | `/${ADMIN_PATH}/api/families`                  | Create. Body: `{ name, max_slots }`. Generates token. Returns `{ ok, family, share_url }` so the front-end can copy `share_url` to clipboard. (adminAuth) |
| DELETE | `/${ADMIN_PATH}/api/families/:id`              | Delete. Cascades to attendees. (adminAuth) |
| GET    | `/${ADMIN_PATH}/api/download`                  | Excel export — two sheets (see §7). (adminAuth) |

### Endpoints removed

- `POST /api/rsvp` — gone.
- `GET /${ADMIN_PATH}/api/list` — replaced by `/api/families`.
- `DELETE /${ADMIN_PATH}/api/rsvp/:id` — replaced by `/api/families/:id`.

`GET /healthz` is unchanged.

### Validation rules (server-side, on `POST /api/family/:token/rsvp`)

Order of checks (fail fast):

1. **Body shape:** if `attendees` is provided, it must be an array. Cap length at `family.max_slots` *before* any further inspection — reject with 400 if longer, so a 10MB payload of names is dropped before walking it.
2. **`attending`** ∈ `{'yes', 'no'}`. Reject otherwise with 400.
3. **If `attending === 'no'`:** ignore `attendee_count` and `attendees` entirely (server forces `attendee_count = 0`, attendees `[]`).
4. **If `attending === 'yes'`:**
   - `attendee_count` is integer in `[1, family.max_slots]`. Reject with 400 if out of range or non-integer.
   - `attendees.length === attendee_count`. Reject with 400 otherwise.
   - Each `attendees[i].name` is a non-empty trimmed string. Length is measured in **UTF-16 code units** (JavaScript `String.prototype.length`), capped at 120 — matches the existing project convention; surrogate pairs may be split if a guest pastes a 60-emoji name, which is acceptable.
   - Server `String#trim`s and `slice(0, 120)`s before insert.
5. **`message`** (optional): trimmed string ≤ 1000 UTF-16 code units. `slice(0, 1000)` on insert.
6. **Body size:** rely on Express's default `express.json()` limit of 100kb — adequate.

Error envelope: `{ ok: false, error: '<human-readable>' }` with the appropriate HTTP status.

## 5. Guest-side flow

The hero page (3D Kingdom scene) is unchanged. Modifications are scoped to the **VIP Boarding Pass** (RSVP) section.

### Rendering model (resolves the SSR vs static-file question)

There is no template engine. The server reads `public/index.html` from disk **once at startup** into a string and on every `GET /i/:token` request it produces the response by `String#replace`-ing two markers:

- `<!--FAMILY_DATA_JSON-->` → `<script id="family-data" type="application/json">{…}</script>` (the full family JSON, server-rendered) when the token is valid; an empty string otherwise.
- `<!--FAMILY_NAME-->` → the family's name (HTML-escaped) when valid; an empty string otherwise.
- `<!--LANDING_MODE-->` → one of `gate-link` (no token, public landing), `gate-invalid` (unknown token), or `gate-family` (valid token). The page's CSS uses `body[data-landing-mode]` selectors to switch the boarding-pass section between the three variants without an additional round-trip.

The `GET /` route serves the same template with `LANDING_MODE=gate-link`.

A 404 unknown-token request returns the *same HTML* with `LANDING_MODE=gate-invalid` (and HTTP status 404). Both `FAMILY_DATA_JSON` and `FAMILY_NAME` are empty in that case so no leakage of valid-token shape.

Responses for `/i/:token` and `/` should set `Cache-Control: no-store` so a shared device or browser back/forward does not show a stale family record after edit.

### First visit to `/i/:token`

1. The server reads `family` and `attendees[]` for the token, embeds the JSON in `<script id="family-data">`, and substitutes `FAMILY_NAME`. The page is therefore interactive on first paint with no extra round-trip.
2. The Magic Pass HUD's "Pass Holder" line shows the family name (was `— guest —`).
3. Boarding-pass section heading: **"Claim your pass, Valencia Family."** Sub-line: **"Up to 5 attendees on this invitation."**
4. Existing **YES / NO** attending pills.
5. If YES is chosen:
   - **Attendee count selector** — a row of count pills `[1] [2] [3] [4] [5]`, capped at `max_slots`. Default selection is `max_slots` (we assume the family wants to claim all slots; they can lower it).
   - **Name fields** — exactly `attendee_count` inputs labelled "Attendee 1", "Attendee 2", … Each placeholder shows the family's last name token (e.g. "Valencia") so guests can type just the first name.
6. Optional **message** textarea, kept from current design.
7. Submit button label: **"STAMP MY PASS"**.

### Re-visit (already claimed)

- The family record's `attendees[]` pre-fills the form fields.
- Heading: **"Update your pass, Valencia Family."**
- A small line under the heading: **"Last updated 12 minutes ago."** (relative time, computed client-side).
- Submit button label: **"UPDATE MY PASS."**

**Timestamp serialization:** SQLite's `CURRENT_TIMESTAMP` returns `'YYYY-MM-DD HH:MM:SS'` in UTC without a trailing `Z`, which browsers parse as local time. To avoid this trap, every `created_at` / `claimed_at` / `updated_at` value the server emits to the client is converted to ISO-8601 with a `Z` suffix (e.g., `'2026-05-03T14:08:22Z'`) before serialization. Clients can `new Date(value)` directly.

### After submit

- Confetti burst (existing `window.confettiBurst()`), the rotated **STAMPED** badge appears, success message tailored to attending vs declined.
- The HUD progress meter locks at 100%.
- Subsequent edits replay the same animation but with the "UPDATE" label.

### Error states

- **Token not found** → server returns the 404 page (Kingdom hero + castle silhouette + "This pass isn't valid. Ask your host for your personal link.").
- **Server validation failure** on submit → toast displays `error` from response body. Submit button re-enables. Form is not cleared.
- **Network failure** → toast: "Couldn't reach the kingdom. Try again?" Submit button re-enables.
- **Client-side guard** prevents submit if YES is selected with any blank name field (visual highlight + native `required`).

## 6. Admin dashboard

Replaces the current `public/admin.html`.

### Header

Sticky bar:

- Title: **"RSVP Dashboard"**
- Stat tiles in a row: **Families** total, **Yes**, **No**, **Pending**, **Total Attendees** (sum of `attendee_count` across `attending='yes'` families).
- **Download Excel** button.

### Add Family card

Permanent at the top of the page:

- Inputs: `Family Name` (text, required, 1–120 chars), `Slots` (number, 1–20, default 4).
- Button: **"Create Invitation"**.
- On submit: server creates the family + token, returns `share_url`. Front-end:
  1. Calls `navigator.clipboard.writeText(share_url)`.
  2. Shows a toast: **"Link copied: paste it into WhatsApp."**
  3. Inserts the new row at the top of the table.
  4. Clears the form fields and re-focuses `Family Name`.
- If the clipboard API isn't available (older mobile), fall back to selecting the URL in a temporarily-visible read-only input and showing "Copy this link manually:".

### Families table

Columns:

| Column | Content |
|---|---|
| Family | Family name; an expandable caret reveals attendee names + the family's message in a sub-row. |
| Status | Colored dot + label. `● Yes`, `● No`, `○ Pending`. Adds an `Edited` chip when `updated_at > claimed_at`. |
| Slots | `attendee_count / max_slots` (e.g. `4 / 5`). Shows `— / 5` for Pending and `0 / 5` for No. |
| Link  | Button "🔗 Copy". Copies the share URL on click; tooltip flashes "Copied!". |
| Last Updated | Relative time (`just now`, `2 min ago`, `yesterday`). Falls back to absolute when older than a week. |
| Actions | Delete button (with `confirm()` dialog). |

### Filter

Pills above the table: **All / Pending / Yes / No**. Front-end filter only — does not refetch.

By construction, "Yes" implies `attendee_count ≥ 1` (the validation in §4 forbids `attending='yes'` with `attendee_count=0`). The dashboard does not need to handle the impossible case.

### Auto-refresh

Same as today: fetch `/${ADMIN_PATH}/api/families` every 30 seconds.

## 7. Excel export

Two sheets:

**Sheet 1 — "Families"**

| # | Family | Status | Slots Used | Slots Max | Message | Created | Claimed | Updated | Share URL |

`Slots Used` cell rules: `attendee_count` for `attending='yes'`; `0` for `attending='no'`; **empty string** for Pending (so the column makes obvious that the row is awaiting response).

**Sheet 2 — "Attendees"** (flat, one row per attendee — useful for seating lists / name tags)

| # | Family | Family Status | Attendee Position | Attendee Name |

Header styling identical to existing export. Filename pattern unchanged: `rsvp-list-YYYY-MM-DD.xlsx`.

## 8. Migration / cutover

The existing site uses an `rsvps` table. We follow strategy **A — drop and replace** (decided in brainstorming).

### Boot-time schema sync

On every server start, run the following — in this order, idempotently:

```sql
CREATE TABLE IF NOT EXISTS families   (...);   -- §3
CREATE INDEX  IF NOT EXISTS idx_families_token ON families(token);
CREATE TABLE IF NOT EXISTS attendees  (...);   -- §3
CREATE INDEX  IF NOT EXISTS idx_attendees_family ON attendees(family_id);
DROP TABLE    IF EXISTS rsvps;
```

The `IF NOT EXISTS` clauses make repeated boots safe — the new tables persist across restarts on a Render Starter plan with a mounted disk. The `DROP TABLE IF EXISTS rsvps` is also idempotent: once the legacy table is gone, subsequent boots no-op. It does **not** affect the new tables.

The DROP is run unconditionally rather than gated on a "first boot" flag because the `rsvps` table only exists in the legacy schema; it cannot be re-created accidentally by the new code path. There is no risk of a future `families` rename collision because we never name a future table `rsvps`.

### Cutover steps when deploying the new code

1. Push to GitHub.
2. Render redeploys the Docker image.
3. On boot, the schema sync above runs — the DB ends in the new shape regardless of what was there before.
4. Open the admin dashboard, add families one by one, paste each freshly-copied link into WhatsApp.
5. Anyone who had bookmarked `/` from an earlier round sees the "ask your host for your link" landing.

No data migration is performed and none is needed.

## 9. Implementation surface

Files affected:

| File | Change |
|---|---|
| `server.js` | Schema + token generator + new routes + remove old ones. Largest single change. |
| `public/index.html` | Boarding-pass section refactored: count pills, dynamic name fields, edit-mode heading, "no link" landing variant. |
| `public/css/style.css` | New styles for count pills, attendee-name list, "ask your host" landing card, admin Add-Family card, families table. |
| `public/js/main.js` | Reads `<script id="family-data">` if present, drives count pills, renders attendee-name inputs, handles edit vs first-visit, calls new POST endpoint. |
| `public/admin.html` + `public/js/admin.js` | Replaced — Add Family card, families table, copy-link, status pills, expandable attendee rows. |
| `public/images/placeholder-*.svg` | Unchanged. |
| `docs/superpowers/specs/<this file>` | This spec. |

`scene.js` is unchanged — the 3D background is content-agnostic.

## 10. Out of scope (deliberately)

- **Email / SMS sending.** Admin copies links and shares them out-of-band.
- **Per-attendee child / adult flag.** Family names + count are enough for the venue size.
- **RSVP deadline lock-out.** Families can edit anytime. Could be added later as `RSVP_DEADLINE` env var.
- **Edit history.** Latest submission overwrites; admin sees an "Edited" chip but not a diff.
- **Bulk family create.** A textarea CSV-paste is YAGNI; if needed it's a 10-minute follow-up.
- **Login / accounts.** Possessing the link is the credential.
- **Plus-ones beyond max_slots.** If a family asks, the host's only path in this slice is to delete and re-create the family — which **generates a new token**, breaking any link they've already shared. The host must re-send the new link via WhatsApp. An "Edit Family" form that mutates `max_slots` in place is a logical follow-up but is deliberately out of scope here to keep the cutover minimal.

## 11. Open questions

None at this stage. The host (Mark) has approved each section.

If the implementation turns up a constraint that contradicts a decision here, the implementer should pause, surface it, and update this doc — not silently diverge.
