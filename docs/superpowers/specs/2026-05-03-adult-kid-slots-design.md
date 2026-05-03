# Adult / Kid Slot Split — Design

**Date:** 2026-05-03
**Status:** Approved (pending spec review)
**Author:** brainstorming session with Mark Valencia

## Problem

The invitation site currently allocates a single `max_slots` cap per family (1–20). Reality is more nuanced — Mark and Min want to control adult and kid counts independently when creating an invitation, both for the venue (seat / meal counts) and so guests can't accidentally bring six adults on a "two-adults plus four-kids" pass.

## Goal

- Admin creates an invitation with two separate slot caps: `adult_slots` and `kid_slots`.
- Guest RSVP form distinguishes adults from kids.
- Admin dashboard, stamped boarding pass, and Excel export all reflect the split.
- Existing data (legacy `max_slots`) migrates in place — no manual SQL required.

## Non-Goals

- Per-attendee details beyond name + kind (no ages, dietary, etc.).
- A separate "infant" tier (kept binary on purpose).
- Backwards-compatible API surface — this is a self-hosted single-tenant app, the existing `/api/family/:token/rsvp` payload changes shape.

## Validation Rules

- `0 ≤ adult_slots ≤ 20`
- `0 ≤ kid_slots ≤ 20`
- `1 ≤ adult_slots + kid_slots ≤ 20`  (an invitation must include at least one slot)
- `attendees.adults.length ≤ adult_slots`
- `attendees.kids.length ≤ kid_slots`
- `attendees.adults.length + attendees.kids.length ≥ 1` when `attending === 'yes'`
- Empty / whitespace-only names rejected.

## Schema (`server.js` schema-sync block)

```sql
CREATE TABLE IF NOT EXISTS families (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  token           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  adult_slots     INTEGER NOT NULL CHECK (adult_slots BETWEEN 0 AND 20),
  kid_slots       INTEGER NOT NULL CHECK (kid_slots   BETWEEN 0 AND 20),
  attending       TEXT CHECK (attending IN ('yes', 'no')),
  attendee_count  INTEGER CHECK (attendee_count >= 0),
  message         TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  claimed_at      DATETIME,
  updated_at      DATETIME,
  CHECK (adult_slots + kid_slots BETWEEN 1 AND 20)
);

CREATE TABLE IF NOT EXISTS attendees (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id  INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('adult','kid')),
  position   INTEGER NOT NULL
);
```

### Migration of legacy rows

The schema-sync block runs on every boot. After `CREATE TABLE IF NOT EXISTS`:

1. Inspect `pragma_table_info('families')` — if `max_slots` exists and `adult_slots` does not, run:
   - `ALTER TABLE families ADD COLUMN adult_slots INTEGER NOT NULL DEFAULT 0;`
   - `ALTER TABLE families ADD COLUMN kid_slots INTEGER NOT NULL DEFAULT 0;`
   - `UPDATE families SET adult_slots = max_slots, kid_slots = 0;`
   - Leave `max_slots` in place (SQLite `DROP COLUMN` requires 3.35+; the unused column is harmless and the next clean redeploy on Render's ephemeral disk will re-create the table without it).
2. Inspect `pragma_table_info('attendees')` — if `kind` does not exist:
   - `ALTER TABLE attendees ADD COLUMN kind TEXT NOT NULL DEFAULT 'adult';`

The CHECK constraints in `CREATE TABLE` are not enforced retroactively on `ALTER` — acceptable since migration values are known-good (`max_slots ≤ 20`, `kid_slots = 0`).

## API Changes

### `POST /api/family/:token/rsvp`

**Old body** (yes case):
```json
{ "attending": "yes", "attendee_count": 3, "attendees": [{"name":"…"}], "message": "…" }
```

**New body** (yes case):
```json
{ "attending": "yes", "adults": [{"name":"…"}], "kids": [{"name":"…"}], "message": "…" }
```

`attendee_count` is no longer accepted from the client — server derives it as `adults.length + kids.length`.

**Validation order** (preserves §4 cap-before-walk discipline):

1. `attending` ∈ `{yes, no}` → 400 if not.
2. `attending === 'no'` → wipe attendees, set `attendee_count = 0`, return.
3. `attending === 'yes'`:
   1. `adults` and `kids` must each be arrays (default to `[]` if missing).
   2. `adults.length > family.adult_slots` → 400 `"Only N adult slots on this pass."`
   3. `kids.length > family.kid_slots` → 400 `"Only N kid slots on this pass."`
   4. `adults.length + kids.length < 1` → 400 `"Please add at least one attendee."`
   5. Per-row name trim, blank-rejection, slice to 120 chars.
4. `message` trim + slice to 1000 (unchanged).
5. Single transaction: update family, delete old attendees, insert adults (kind='adult', position 0..n-1) then kids (kind='kid', position n..n+m-1).

### `GET /api/family/:token` and admin list

`familyToJSON` returns:
```json
{
  "adult_slots": 3,
  "kid_slots": 2,
  "attendee_count": 4,
  "attendees": [
    { "name": "…", "kind": "adult", "position": 0 },
    { "name": "…", "kind": "kid",   "position": 3 }
  ]
}
```

`max_slots` is dropped from the JSON. Convenience derived counts (`adult_count`, `kid_count`) are computed from `attendees` either client-side or in `familyToJSON`; spec leaves this to implementer's discretion.

### `POST /<admin>/api/families`

Body: `{ name, adult_slots, kid_slots }`. Server validates per the rules above.

## Admin UI (`public/admin.html` + `public/js/admin.js`)

### Add-Family card

```
[ Family Name        ] [ Adults ] [ Kids ] [ Create Invitation ]
                       (0-20)    (0-20)
```

Defaults: `adult_slots = 2, kid_slots = 2`. Client-side: alert if `adults + kids < 1` or `> 20`.

### Stats tiles — 6 instead of 5

`Families · Yes · No · Pending · Adults · Kids`

The two new tiles count attendees by kind across `attending === 'yes'` families only.

### Families table

| col | rendering |
|---|---|
| Slots | `1A+1K / 2A+2K` (used / max). Pending shows `—/2A+2K`. No → `0/2A+2K`. |
| Expand-row attendees | grouped: "Adults" sub-list, "Kids" sub-list (omit empty groups). |

## Guest RSVP Form (`public/index.html` + `public/js/main.js`)

Inside the **YES** branch, two stacked sections:

```
ADULTS  (Up to N)        ← hidden if adult_slots === 0
[ count pills 0..N ]
[ name field ]
[ name field ]
…

KIDS    (Up to M)        ← hidden if kid_slots === 0
[ count pills 0..M ]
[ name field ]
…
```

- "Slots line" copy:
  - both > 0: `"Up to N adults and M kids on this invitation."`
  - adults only: `"Up to N adults on this invitation."`
  - kids only: `"Up to M kids on this invitation."`
- The submit button is disabled while `adults.length + kids.length === 0` in YES mode.
- On revisit (edit), pre-fill each section's count + names from the attendee rows split by `kind`.
- Submit body: `{ attending, adults: [...], kids: [...], message? }`.

### Stamped boarding pass

- "ATTENDEE(S)" header is replaced by two stacked groups inside the dashed-divider section:
  ```
  ★ ADULTS (n)
    ✦ Name
    ✦ Name
  ★ KIDS (m)
    ✦ Name
  ```
- A group with count 0 is omitted entirely.
- Boarding-pass PNG snapshot (`buildPassSnapshot`) mirrors the same grouped layout.

## Excel Export

### Families sheet — column changes

| old | new |
|---|---|
| `Slots Used` | `Adults Used`, `Kids Used` (two columns) |
| `Slots Max`  | `Adults Max`, `Kids Max` (two columns) |

For pending rows, "Used" cells are blank (matches current behavior).

### Attendees sheet — add `Kind` column

| # | Family | Family Status | Position | Kind | Name |

`Kind` is `Adult` or `Kid`.

## Files Touched

- `server.js` — schema, validation, JSON shape, admin create endpoint, Excel export.
- `public/admin.html` — add-family form, stats grid (5 → 6 tiles).
- `public/js/admin.js` — form submit, stats binding, table renderer (`slotsCell`, `renderDetail`).
- `public/index.html` — duplicate the "count + name list" markup into adults/kids sections.
- `public/js/main.js` — form rendering, validation, submit body, stamped pass, snapshot builder, slots-line copy.
- `CLAUDE.md` — update "Token model" / "Edit semantics" paragraphs that mention `max_slots` and `attendee_count`.

## Risks / Open Questions

- **SQLite `DROP COLUMN`:** unavailable < 3.35. We deliberately leave `max_slots` orphaned rather than rebuild the table. On Render redeploys the DB is wiped anyway; only local dev sees this.
- **The existing `attendee_count` column is now derived state.** Kept because the JSON API and Excel export reference it. Stays as a denormalised cache, written on every RSVP submit.
- **Boarding-pass PNG layout** may overflow at the worst case (max 20 attendees in two sub-lists). Acceptable — same overflow risk exists today with one list of 20.

## Out of Scope

- Renaming the legacy `rsvps.db` file or `attendee_count` column.
- A "couple + N kids" preset shortcut on the admin form.
- Per-kid age tracking.
