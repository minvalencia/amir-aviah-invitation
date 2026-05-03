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

The schema-sync block runs on every boot. After `CREATE TABLE IF NOT EXISTS` (which is a no-op on a legacy DB), inspect `pragma_table_info('families')`:

**If `max_slots` exists and `adult_slots` does not** — perform a full table rebuild (the standard SQLite migration pattern, the only way to leave behind a clean schema with `NOT NULL` columns and the new sum-CHECK):

```sql
BEGIN;
CREATE TABLE families_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  adult_slots INTEGER NOT NULL CHECK (adult_slots BETWEEN 0 AND 20),
  kid_slots INTEGER NOT NULL CHECK (kid_slots BETWEEN 0 AND 20),
  attending TEXT CHECK (attending IN ('yes','no')),
  attendee_count INTEGER CHECK (attendee_count >= 0),
  message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  claimed_at DATETIME,
  updated_at DATETIME,
  CHECK (adult_slots + kid_slots BETWEEN 1 AND 20)
);
INSERT INTO families_new (id, token, name, adult_slots, kid_slots, attending, attendee_count, message, created_at, claimed_at, updated_at)
  SELECT id, token, name, max_slots, 0, attending, attendee_count, message, created_at, claimed_at, updated_at FROM families;
DROP TABLE families;
ALTER TABLE families_new RENAME TO families;
CREATE INDEX IF NOT EXISTS idx_families_token ON families(token);
COMMIT;
```

This eliminates the orphaned `max_slots` column entirely, so the admin `INSERT` only needs `(token, name, adult_slots, kid_slots)`.

**For `attendees`** — inspect `pragma_table_info('attendees')`. If `kind` does not exist:
- `ALTER TABLE attendees ADD COLUMN kind TEXT NOT NULL DEFAULT 'adult';`

This is safe: `ALTER TABLE ADD COLUMN` works for `attendees` because there's no incompatible existing constraint. The `idx_attendees_family` index survives.

The CHECK constraints in `CREATE TABLE families_new` are enforced on the `INSERT … SELECT` — acceptable since migration values are known-good (legacy `max_slots ∈ 1..20` ⇒ `adult_slots + kid_slots = max_slots ∈ 1..20`).

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

`max_slots` is dropped from the JSON. Convenience derived counts `adult_count` and `kid_count` are computed in `familyToJSON` (server-side, single source of truth) so admin and guest UIs don't reimplement the math.

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

The two new tiles count attendees by kind across `attending === 'yes'` families only. The existing `total_attendees` field is **removed** from the stats payload — the two new fields (`adult_count`, `kid_count`) replace it; admin no longer needs the sum tile, and any client that wants the total can add the two.

### Families table

| col | rendering |
|---|---|
| Slots | `1A+1K / 2A+2K` (used / max). Pending shows `—/2A+2K`. No → `0/2A+2K`. |
| Expand-row attendees | grouped: "Adults" sub-list, "Kids" sub-list (omit empty groups). |

## Guest RSVP Form (`public/index.html` + `public/js/main.js`)

Inside the **YES** branch, two stacked sections:

```
ADULTS  (Up to N)        ← hidden if adult_slots === 0
[ count pills 0..N ]     ← min pill is 0 (was 1 in legacy form), max is the section's slot count
[ name field ]
[ name field ]
…

KIDS    (Up to M)        ← hidden if kid_slots === 0
[ count pills 0..M ]     ← same: min 0, max = kid_slots
[ name field ]
…
```

The `0` pill is meaningful — it's how a guest expresses "we're bringing only adults" or "only the kids". Cross-section invariant: at least one of (`adults.length`, `kids.length`) must be ≥ 1.

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

"Used" cell rules (apply to both `Adults Used` and `Kids Used` identically):
- `attending === 'yes'` → integer (the kind's attendee count, may be 0).
- `attending === 'no'`  → `0`.
- Pending (`attending === null`) → blank cell.

### Attendees sheet — add `Kind` column

| # | Family | Family Status | Position | Kind | Name |

`Kind` is `Adult` or `Kid`.

## Files Touched

- `server.js` — schema (incl. table-rebuild migration), validation, JSON shape, admin create endpoint, Excel export.
- `public/admin.html` — add-family form, stats grid (5 → 6 tiles).
- `public/js/admin.js` — form submit, stats binding, table renderer (`slotsCell`, `renderDetail`).
- `public/index.html` — duplicate the "count + name list" markup into adults/kids sections.
- `public/js/main.js` — form rendering, validation, submit body, stamped pass (in-page DOM AND `buildPassSnapshot` PNG snapshot, both colocated in this file), slots-line copy.
- `CLAUDE.md` — update "Token model" / "Edit semantics" paragraphs that mention `max_slots` and `attendee_count`.

## Risks / Open Questions

- **Migration is a table rebuild,** not an `ALTER TABLE ADD COLUMN`. Reasoning: SQLite `DROP COLUMN` is unavailable < 3.35, so an additive migration would leave `max_slots NOT NULL` orphaned and break new admin INSERTs. The rebuild runs inside a `BEGIN…COMMIT`, copies all rows, and is idempotent on re-boot (gated by `pragma_table_info` check). On Render's ephemeral disk this almost never fires; on local dev it runs once per existing DB.
- **The existing `attendee_count` column is now derived state.** Kept because the JSON API and Excel export reference it. Stays as a denormalised cache, written on every RSVP submit.
- **Boarding-pass PNG layout** may overflow at the worst case (max 20 attendees in two sub-lists). Acceptable — same overflow risk exists today with one list of 20.
- **Indexes** (`idx_families_token`, `idx_attendees_family`) are recreated by the schema-sync block via `CREATE INDEX IF NOT EXISTS`, including after the table rebuild.

## Out of Scope

- Renaming the legacy `rsvps.db` file or `attendee_count` column.
- A "couple + N kids" preset shortcut on the admin form.
- Per-kid age tracking.
