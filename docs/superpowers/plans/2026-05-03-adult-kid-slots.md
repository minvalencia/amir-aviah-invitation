# Adult / Kid Slot Split Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `max_slots` per family with two independent caps (`adult_slots`, `kid_slots`) that flow through schema, admin form, RSVP form, stamped pass, stats tiles, and Excel export.

**Architecture:** One Express + SQLite process. The schema changes via a guarded full-table rebuild (the only migration that's safe given a legacy `max_slots NOT NULL` column and SQLite < 3.35). API surface changes shape — the RSVP POST body now sends `adults: [...]`, `kids: [...]` instead of `attendee_count` + `attendees`. Server is the single source of truth for all derived counts (`adult_count`, `kid_count`).

**Tech Stack:** Node.js, Express, better-sqlite3, ExcelJS, plain ES-module frontend (no bundler).

**Spec:** [docs/superpowers/specs/2026-05-03-adult-kid-slots-design.md](../specs/2026-05-03-adult-kid-slots-design.md) — read it before starting.

**Verification model:** This codebase has no test suite, no linter, no build step (per `CLAUDE.md`). Verification is manual: PowerShell `Invoke-RestMethod` for API calls and a browser session against `http://localhost:3000/`. Each task ends with explicit verification commands and expected output. Commit after every task.

**Working directory:** `D:\Projects\invitation`. Start each task with `npm start` running in a separate terminal so manual checks are immediate.

---

## File Map

| File | Change |
|---|---|
| `server.js` | Schema rebuild + migration; admin create body; `familyToJSON`; RSVP POST validation; stats payload; Excel columns |
| `public/admin.html` | Add-family form (two slots inputs); stats grid (5 → 6 tiles) |
| `public/js/admin.js` | Form submit body; stats bindings; `slotsCell`; `renderDetail` |
| `public/index.html` | RSVP form: split count-pills + attendee-list into Adults and Kids sections |
| `public/js/main.js` | Two-section render/validate/submit; slots-line copy; stamped pass grouping; `buildPassSnapshot` grouping |
| `CLAUDE.md` | Update "Edit semantics" / "Token model" paragraphs that reference `max_slots` and `attendee_count` |

---

## Chunk 1: Server (schema + API)

### Task 1: Schema migration — table rebuild + attendees `kind` column

**Files:**
- Modify: `server.js:33-60` (the `db.exec(...)` schema-sync block)

**Why:** The legacy `families` table has `max_slots INTEGER NOT NULL`. Adding `adult_slots NOT NULL` columns via `ALTER TABLE` without a default would fail; with a `DEFAULT 0` it would leave `max_slots` orphaned and any new admin INSERT would break (legacy column still requires a value). A full rebuild is the only clean option.

- [ ] **Step 1: Replace the schema-sync block**

Replace lines 33-60 in `server.js` with:

```js
// Schema sync — runs on every boot, idempotent.
//
// Two paths:
//   (a) Fresh DB: CREATE TABLE IF NOT EXISTS does the work.
//   (b) Legacy DB with `max_slots`: rebuild the families table inside a
//       transaction (the only safe pattern given SQLite < 3.35 has no
//       DROP COLUMN). The legacy `max_slots` value migrates to
//       `adult_slots`; `kid_slots` defaults to 0. Attendees gain a
//       `kind` column via ALTER (safe — no constraint conflict).
db.exec(`
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
  CREATE INDEX IF NOT EXISTS idx_families_token ON families(token);

  CREATE TABLE IF NOT EXISTS attendees (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id  INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attendees_family ON attendees(family_id);

  DROP TABLE IF EXISTS rsvps;
`);

// Foreign keys are off by default in SQLite; turn them on so ON DELETE CASCADE works.
db.pragma('foreign_keys = ON');

// --- Migration: legacy families.max_slots → families.{adult_slots,kid_slots} ---
const familyCols = db.prepare("PRAGMA table_info('families')").all().map(r => r.name);
if (familyCols.includes('max_slots') && !familyCols.includes('adult_slots')) {
  db.exec(`
    BEGIN;
    CREATE TABLE families_new (
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
    INSERT INTO families_new
      (id, token, name, adult_slots, kid_slots, attending, attendee_count, message, created_at, claimed_at, updated_at)
      SELECT id, token, name, max_slots, 0, attending, attendee_count, message, created_at, claimed_at, updated_at
      FROM families;
    DROP TABLE families;
    ALTER TABLE families_new RENAME TO families;
    CREATE INDEX IF NOT EXISTS idx_families_token ON families(token);
    COMMIT;
  `);
  console.log('🛠  Migrated families table: max_slots → adult_slots/kid_slots.');
}

// --- Migration: attendees.kind ---
const attCols = db.prepare("PRAGMA table_info('attendees')").all().map(r => r.name);
if (!attCols.includes('kind')) {
  db.exec(`ALTER TABLE attendees ADD COLUMN kind TEXT NOT NULL DEFAULT 'adult';`);
  console.log('🛠  Migrated attendees table: added kind column.');
}
```

- [ ] **Step 2: Verify on a fresh DB**

```powershell
Remove-Item -Force data\rsvps.db -ErrorAction SilentlyContinue
npm start
```
Expected: server starts, no migration log lines (fresh DB takes the `CREATE TABLE IF NOT EXISTS` path). `Ctrl+C` to stop.

- [ ] **Step 3: Verify on a simulated legacy DB**

Stop the server. Recreate a legacy-shaped DB:

```powershell
Remove-Item -Force data\rsvps.db -ErrorAction SilentlyContinue
node -e "const Database=require('better-sqlite3');const db=new Database('./data/rsvps.db');db.exec(\`CREATE TABLE families(id INTEGER PRIMARY KEY,token TEXT NOT NULL UNIQUE,name TEXT NOT NULL,max_slots INTEGER NOT NULL,attending TEXT,attendee_count INTEGER,message TEXT,created_at DATETIME DEFAULT CURRENT_TIMESTAMP,claimed_at DATETIME,updated_at DATETIME);CREATE TABLE attendees(id INTEGER PRIMARY KEY,family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,name TEXT NOT NULL,position INTEGER NOT NULL);INSERT INTO families(token,name,max_slots,attending,attendee_count) VALUES('TESTTESTTEST','Legacy Family',4,'yes',2);INSERT INTO attendees(family_id,name,position) VALUES(1,'Alice',0),(1,'Bob',1);\`);console.log('seeded legacy DB')"
npm start
```
Expected: server prints `🛠  Migrated families table…` and `🛠  Migrated attendees table…`. `Ctrl+C` to stop.

- [ ] **Step 4: Verify the migrated rows are intact**

```powershell
node -e "const db=require('better-sqlite3')('./data/rsvps.db');console.log(db.prepare('SELECT id,name,adult_slots,kid_slots,attending,attendee_count FROM families').all());console.log(db.prepare('SELECT id,family_id,name,position,kind FROM attendees').all())"
```
Expected output:
```
[ { id: 1, name: 'Legacy Family', adult_slots: 4, kid_slots: 0, attending: 'yes', attendee_count: 2 } ]
[ { id: 1, family_id: 1, name: 'Alice', position: 0, kind: 'adult' },
  { id: 2, family_id: 1, name: 'Bob',   position: 1, kind: 'adult' } ]
```

- [ ] **Step 5: Verify migration is idempotent on second boot**

```powershell
npm start
```
Expected: NO migration log lines on this second boot (the `pragma_table_info` checks short-circuit). `Ctrl+C`.

- [ ] **Step 6: Commit**

```powershell
git add server.js
git commit -m "feat(db): adult_slots/kid_slots schema + table-rebuild migration

Replaces single max_slots cap with independent adult_slots and kid_slots
caps (sum 1..20). Adds a guarded full-table rebuild for legacy DBs since
SQLite lacks DROP COLUMN before 3.35. Attendees gain a kind column."
```

---

### Task 2: Admin create endpoint accepts `adult_slots` + `kid_slots`

**Files:**
- Modify: `server.js:300-332` (`POST /<ADMIN_PATH>/api/families`)

- [ ] **Step 1: Replace the route body**

Replace the existing `POST /<ADMIN_PATH>/api/families` handler with:

```js
app.post(`/${ADMIN_PATH}/api/families`, adminAuth, (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const adultSlots = parseInt(req.body?.adult_slots, 10);
    const kidSlots   = parseInt(req.body?.kid_slots, 10);

    if (!name) return res.status(400).json({ ok: false, error: 'Family name is required.' });
    if (!Number.isInteger(adultSlots) || adultSlots < 0 || adultSlots > 20) {
      return res.status(400).json({ ok: false, error: 'adult_slots must be an integer 0..20.' });
    }
    if (!Number.isInteger(kidSlots) || kidSlots < 0 || kidSlots > 20) {
      return res.status(400).json({ ok: false, error: 'kid_slots must be an integer 0..20.' });
    }
    const total = adultSlots + kidSlots;
    if (total < 1 || total > 20) {
      return res.status(400).json({ ok: false, error: 'Total slots (adults + kids) must be 1..20.' });
    }

    const insert = db.prepare(`
      INSERT INTO families (token, name, adult_slots, kid_slots) VALUES (?, ?, ?, ?)
    `);

    let row = null;
    for (let attempt = 0; attempt < 5 && !row; attempt++) {
      const token = generateToken();
      try {
        const result = insert.run(token, name, adultSlots, kidSlots);
        row = db.prepare('SELECT * FROM families WHERE id = ?').get(result.lastInsertRowid);
      } catch (e) {
        if (!/UNIQUE constraint failed/i.test(e.message)) throw e;
      }
    }
    if (!row) return res.status(500).json({ ok: false, error: 'Could not allocate token.' });

    const family = familyToJSON(row, []);
    res.json({ ok: true, family, share_url: familyToShareUrl(req, row.token) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});
```

- [ ] **Step 2: Restart and try a valid create via curl/PowerShell**

```powershell
npm start  # in another terminal
$cred = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("parent:changeme123"))
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/admin-secret-rsvp-2026/api/families" `
  -Headers @{ Authorization = "Basic $cred"; "Content-Type" = "application/json" } `
  -Body '{"name":"Smoke Test","adult_slots":2,"kid_slots":1}'
```
Expected: `{ ok: True, family: @{ id=…; adult_slots=2; kid_slots=1; …}, share_url=… }`. (Note: `familyToJSON` still returns the old shape — we'll fix that in Task 3.)

- [ ] **Step 3: Try invalid payloads**

```powershell
# sum = 0 → 400
Invoke-WebRequest -Method POST -Uri "http://localhost:3000/admin-secret-rsvp-2026/api/families" `
  -Headers @{ Authorization = "Basic $cred"; "Content-Type" = "application/json" } `
  -Body '{"name":"X","adult_slots":0,"kid_slots":0}' -SkipHttpErrorCheck | Select-Object StatusCode, Content
# sum = 21 → 400
Invoke-WebRequest -Method POST -Uri "http://localhost:3000/admin-secret-rsvp-2026/api/families" `
  -Headers @{ Authorization = "Basic $cred"; "Content-Type" = "application/json" } `
  -Body '{"name":"X","adult_slots":15,"kid_slots":6}' -SkipHttpErrorCheck | Select-Object StatusCode, Content
```
Expected: both return `StatusCode 400` with the right error message.

- [ ] **Step 4: Commit**

```powershell
git add server.js
git commit -m "feat(server): admin create accepts adult_slots + kid_slots"
```

---

### Task 3: `familyToJSON` returns new shape with derived counts

**Files:**
- Modify: `server.js:282-297` (`familyToJSON`)

- [ ] **Step 1: Replace the function**

```js
function familyToJSON(family, attendees) {
  // Convert SQLite TEXT timestamps to ISO-8601 with Z so client time math works.
  const isoOrNull = (s) => s ? s.replace(' ', 'T') + 'Z' : null;
  const list = (attendees || []).map(a => ({
    name: a.name,
    kind: a.kind || 'adult',
    position: a.position
  }));
  const adultCount = list.filter(a => a.kind === 'adult').length;
  const kidCount   = list.filter(a => a.kind === 'kid').length;
  return {
    id: family.id,
    name: family.name,
    adult_slots: family.adult_slots,
    kid_slots:   family.kid_slots,
    attending: family.attending,
    attendee_count: family.attendee_count,
    adult_count: adultCount,
    kid_count:   kidCount,
    message: family.message,
    created_at: isoOrNull(family.created_at),
    claimed_at: isoOrNull(family.claimed_at),
    updated_at: isoOrNull(family.updated_at),
    attendees: list
  };
}
```

- [ ] **Step 2: Update the attendees SELECT to include `kind`**

In `server.js` find every `SELECT name, position FROM attendees` and replace with `SELECT name, position, kind FROM attendees`. There are three of them:
- inside `GET /i/:token` (line ~144)
- inside `GET /api/family/:token` (line ~170)
- inside `POST /api/family/:token/rsvp` (line ~251)
- inside `GET /<admin>/api/families` (line ~337)

Use a single Grep + Edit `replace_all` to do this safely.

- [ ] **Step 3: Verify the JSON shape via the public read endpoint**

```powershell
# Use the share URL printed by Task 2's create call. Replace TOKEN below.
Invoke-RestMethod "http://localhost:3000/api/family/TOKEN" | ConvertTo-Json -Depth 4
```
Expected: response includes `adult_slots`, `kid_slots`, `adult_count: 0`, `kid_count: 0`, `attendees: []`. `max_slots` is absent.

- [ ] **Step 4: Commit**

```powershell
git add server.js
git commit -m "feat(server): familyToJSON returns adult_slots/kid_slots + derived counts"
```

---

### Task 4: RSVP POST validates and writes adults + kids

**Files:**
- Modify: `server.js:178-261` (`POST /api/family/:token/rsvp`)

- [ ] **Step 1: Replace the validation + transaction blocks**

Replace lines 187-248 (the body of the try-block from `const body = req.body || {};` up to and including the `tx();` call) with:

```js
    const body = req.body || {};

    // 1. attending must be 'yes' or 'no'.
    const attending = body.attending;
    if (attending !== 'yes' && attending !== 'no') {
      return res.status(400).json({ ok: false, error: "attending must be 'yes' or 'no'." });
    }

    let adultsClean = [];
    let kidsClean   = [];

    if (attending === 'yes') {
      // 2. Body shape — both arrays (default to []), then cap BEFORE walking,
      //    so a 10MB payload of names is rejected without inspection.
      const adults = Array.isArray(body.adults) ? body.adults : [];
      const kids   = Array.isArray(body.kids)   ? body.kids   : [];

      if (adults.length > family.adult_slots) {
        return res.status(400).json({ ok: false, error: `Only ${family.adult_slots} adult slot${family.adult_slots === 1 ? '' : 's'} on this pass.` });
      }
      if (kids.length > family.kid_slots) {
        return res.status(400).json({ ok: false, error: `Only ${family.kid_slots} kid slot${family.kid_slots === 1 ? '' : 's'} on this pass.` });
      }
      if (adults.length + kids.length < 1) {
        return res.status(400).json({ ok: false, error: 'Please add at least one attendee.' });
      }

      const cleanRow = (a, label) => {
        const n = String(a?.name ?? '').trim();
        if (!n) throw new Error(`${label} name is required.`);
        return n.slice(0, 120);
      };
      adultsClean = adults.map((a, i) => cleanRow(a, `Adult ${i + 1}`));
      kidsClean   = kids.map((a, i)   => cleanRow(a, `Kid ${i + 1}`));
    }
    // attending === 'no' → both arrays stay empty; attendee_count = 0.

    // 3. Optional message.
    const message = body.message != null
      ? String(body.message).trim().slice(0, 1000)
      : null;

    const totalCount = adultsClean.length + kidsClean.length;

    // Transaction: update + delete + insert atomically.
    const updateFamily = db.prepare(`
      UPDATE families
      SET attending = ?, attendee_count = ?, message = ?,
          claimed_at = COALESCE(claimed_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    const deleteAttendees = db.prepare('DELETE FROM attendees WHERE family_id = ?');
    const insertAttendee = db.prepare(
      'INSERT INTO attendees (family_id, name, position, kind) VALUES (?, ?, ?, ?)'
    );

    const tx = db.transaction(() => {
      updateFamily.run(attending, totalCount, message, family.id);
      deleteAttendees.run(family.id);
      let pos = 0;
      adultsClean.forEach(name => insertAttendee.run(family.id, name, pos++, 'adult'));
      kidsClean.forEach(name   => insertAttendee.run(family.id, name, pos++, 'kid'));
    });
    tx();
```

Also update the catch block at the end of the try (line ~256) — the old check was `/name is required/`. The new error messages still match that regex (`"Adult 1 name is required."` etc.), so no change needed. Verify by reading the catch.

- [ ] **Step 2: Restart and submit a valid RSVP**

Use the test family token from earlier (or create a fresh one).

```powershell
$body = '{"attending":"yes","adults":[{"name":"Mark Valencia"},{"name":"Min Valencia"}],"kids":[{"name":"Aviah"}],"message":"See you there!"}'
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/family/TOKEN/rsvp" `
  -Headers @{ "Content-Type" = "application/json" } -Body $body | ConvertTo-Json -Depth 4
```
Expected: `ok: True`. `family.attendee_count` = 3, `adult_count` = 2, `kid_count` = 1, `attendees` has three entries with `kind` set correctly and `position` 0/1/2.

- [ ] **Step 3: Try every validation edge**

```powershell
# adults exceeds cap (assumes adult_slots=2)
$over = '{"attending":"yes","adults":[{"name":"a"},{"name":"b"},{"name":"c"}],"kids":[]}'
Invoke-WebRequest -Method POST -Uri "http://localhost:3000/api/family/TOKEN/rsvp" `
  -Headers @{ "Content-Type" = "application/json" } -Body $over -SkipHttpErrorCheck | Select-Object StatusCode, Content
# total = 0 (yes with no attendees)
$empty = '{"attending":"yes","adults":[],"kids":[]}'
Invoke-WebRequest -Method POST -Uri "http://localhost:3000/api/family/TOKEN/rsvp" `
  -Headers @{ "Content-Type" = "application/json" } -Body $empty -SkipHttpErrorCheck | Select-Object StatusCode, Content
# blank name
$blank = '{"attending":"yes","adults":[{"name":"   "}],"kids":[]}'
Invoke-WebRequest -Method POST -Uri "http://localhost:3000/api/family/TOKEN/rsvp" `
  -Headers @{ "Content-Type" = "application/json" } -Body $blank -SkipHttpErrorCheck | Select-Object StatusCode, Content
# attending=no wipes attendees
$no = '{"attending":"no"}'
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/family/TOKEN/rsvp" `
  -Headers @{ "Content-Type" = "application/json" } -Body $no | ConvertTo-Json -Depth 4
```
Expected: 400 / 400 / 400 / `attending: 'no', attendee_count: 0, attendees: []`.

- [ ] **Step 4: Commit**

```powershell
git add server.js
git commit -m "feat(server): RSVP POST validates adults+kids, persists per-row kind"
```

---

### Task 5: Stats payload — replace `total_attendees` with `adult_count` + `kid_count`

**Files:**
- Modify: `server.js:335-359` (`GET /<ADMIN_PATH>/api/families`)

- [ ] **Step 1: Update the stats object**

Find the `stats` object inside the admin list endpoint (around line 349) and replace with:

```js
  const stats = {
    families_total: result.length,
    yes_count:      result.filter(r => r.attending === 'yes').length,
    no_count:       result.filter(r => r.attending === 'no').length,
    pending_count:  result.filter(r => r.attending === null).length,
    adult_count:    result.filter(r => r.attending === 'yes').reduce((s, r) => s + (r.adult_count || 0), 0),
    kid_count:      result.filter(r => r.attending === 'yes').reduce((s, r) => s + (r.kid_count   || 0), 0)
  };
```

- [ ] **Step 2: Verify the payload**

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/admin-secret-rsvp-2026/api/families" `
  -Headers @{ Authorization = "Basic $cred" } | Select-Object -ExpandProperty stats
```
Expected: stats object has `families_total`, `yes_count`, `no_count`, `pending_count`, `adult_count`, `kid_count`. No `total_attendees`.

- [ ] **Step 3: Commit**

```powershell
git add server.js
git commit -m "feat(server): stats payload returns adult_count + kid_count instead of total"
```

---

### Task 6: Excel export — split slot columns + add Kind column

**Files:**
- Modify: `server.js:362-456` (`GET /<ADMIN_PATH>/api/download`)

- [ ] **Step 1: Update Families sheet columns**

Replace the `fam.columns = [...]` block with:

```js
  fam.columns = [
    { header: '#',           key: 'id',          width: 6  },
    { header: 'Family',      key: 'name',        width: 28 },
    { header: 'Status',      key: 'status',      width: 12 },
    { header: 'Adults Used', key: 'adults_used', width: 12 },
    { header: 'Adults Max',  key: 'adults_max',  width: 12 },
    { header: 'Kids Used',   key: 'kids_used',   width: 11 },
    { header: 'Kids Max',    key: 'kids_max',    width: 11 },
    { header: 'Message',     key: 'message',     width: 36 },
    { header: 'Created',     key: 'created_at',  width: 22 },
    { header: 'Claimed',     key: 'claimed_at',  width: 22 },
    { header: 'Updated',     key: 'updated_at',  width: 22 },
    { header: 'Share URL',   key: 'share_url',   width: 60 }
  ];
```

- [ ] **Step 2: Replace `usedFor` and the per-family `addRow` call**

Delete the `usedFor(f)` helper. Replace the `families.forEach(f => fam.addRow({...}))` block with:

```js
  // "Used" cells: yes → integer (may be 0); no → 0; pending → blank.
  const usedCellsFor = (f, attendees) => {
    if (f.attending === null) return { adults_used: '', kids_used: '' };
    if (f.attending === 'no') return { adults_used: 0,  kids_used: 0 };
    const adults = attendees.filter(a => a.kind === 'adult').length;
    const kids   = attendees.filter(a => a.kind === 'kid').length;
    return { adults_used: adults, kids_used: kids };
  };

  families.forEach(f => {
    const attendees = attStmt.all(f.id);
    const used = usedCellsFor(f, attendees);
    fam.addRow({
      id: f.id,
      name: f.name,
      status: statusFor(f),
      adults_used: used.adults_used,
      adults_max:  f.adult_slots,
      kids_used:   used.kids_used,
      kids_max:    f.kid_slots,
      message: f.message || '',
      created_at: isoOrEmpty(f.created_at),
      claimed_at: isoOrEmpty(f.claimed_at),
      updated_at: isoOrEmpty(f.updated_at),
      share_url: `${req.protocol}://${req.get('host')}/i/${f.token}`
    });
  });
```

(The `attendees` collection here uses the same `attStmt` defined at the top of the route — no new prepare needed.)

- [ ] **Step 3: Add Kind column to Attendees sheet**

Replace the `att.columns = [...]` block with:

```js
  att.columns = [
    { header: '#',                  key: 'n',           width: 6  },
    { header: 'Family',             key: 'family',      width: 28 },
    { header: 'Family Status',      key: 'status',      width: 14 },
    { header: 'Attendee Position',  key: 'position',    width: 18 },
    { header: 'Kind',               key: 'kind',        width: 8  },
    { header: 'Attendee Name',      key: 'name',        width: 28 }
  ];
```

And in the per-attendee `att.addRow({...})` call, add `kind: r.kind === 'kid' ? 'Kid' : 'Adult'`.

- [ ] **Step 4: Download and inspect**

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/admin-secret-rsvp-2026/api/download" `
  -Headers @{ Authorization = "Basic $cred" } -OutFile rsvp-test.xlsx
Start-Process rsvp-test.xlsx
```
Expected (Excel): Families sheet has the four split columns and the values look right (yes-row shows actual counts, no-row shows 0/0, pending-row shows blank/blank). Attendees sheet has a `Kind` column with `Adult` or `Kid`.

Delete `rsvp-test.xlsx` after inspection.

- [ ] **Step 5: Commit**

```powershell
git add server.js
git commit -m "feat(server): Excel export splits slot columns + adds Kind column"
```

---

## Chunk 2: Admin frontend

### Task 7: Admin form + stats grid HTML

**Files:**
- Modify: `public/admin.html:271-277` (stats grid), `public/admin.html:279-293` (add-family form)

- [ ] **Step 1: Update the stats grid**

Replace the `<section class="stats">` block with:

```html
  <section class="stats" id="stats">
    <div class="stat"><div class="stat-label">Families</div><div class="stat-value" id="stat-total">0</div></div>
    <div class="stat"><div class="stat-label">Yes</div>     <div class="stat-value" id="stat-yes">0</div></div>
    <div class="stat"><div class="stat-label">No</div>      <div class="stat-value" id="stat-no">0</div></div>
    <div class="stat"><div class="stat-label">Pending</div> <div class="stat-value" id="stat-pending">0</div></div>
    <div class="stat"><div class="stat-label">Adults</div>  <div class="stat-value" id="stat-adults">0</div></div>
    <div class="stat"><div class="stat-label">Kids</div>    <div class="stat-value" id="stat-kids">0</div></div>
  </section>
```

- [ ] **Step 2: Update the add-family form**

Replace the `<form id="add-family-form">` block with:

```html
    <form id="add-family-form" autocomplete="off">
      <div class="add-family-row">
        <label>Family Name
          <input type="text" id="af-name" name="name" required maxlength="120" placeholder="e.g. Valencia Family" />
        </label>
        <label>Adults
          <input type="number" id="af-adults" name="adult_slots" required min="0" max="20" value="2" />
        </label>
        <label>Kids
          <input type="number" id="af-kids" name="kid_slots" required min="0" max="20" value="2" />
        </label>
        <button type="submit" class="create-btn">Create Invitation</button>
      </div>
      <p class="add-hint">A unique link is generated and copied to your clipboard, ready to paste into WhatsApp. Adults + kids must total 1–20.</p>
    </form>
```

- [ ] **Step 3: Tweak the stat tile color overrides**

In the `<style>` block, find the `/* Stat tile color overrides — 5 tiles now */` section (around line 190) and update to 6 tiles:

```css
.stat:nth-child(1) { border-color: var(--red); }
.stat:nth-child(2) { border-color: #06A77D; }
.stat:nth-child(3) { border-color: var(--red); }
.stat:nth-child(4) { border-color: #B0B0B0; }
.stat:nth-child(5) { border-color: var(--pink); }
.stat:nth-child(6) { border-color: #F4C430; }
```

- [ ] **Step 4: Open the admin page in a browser**

Visit `http://localhost:3000/admin-secret-rsvp-2026` (basic-auth: parent / changeme123). Confirm 6 tiles render and the form has Adults + Kids inputs side by side.

The tiles will all read 0 except `Adults` and `Kids` — those will populate after Task 8 wires the JS bindings. The form won't actually create families yet either (Task 8).

- [ ] **Step 5: Commit**

```powershell
git add public/admin.html
git commit -m "feat(admin): 6-tile stats grid + dual slot inputs in add-family form"
```

---

### Task 8: Admin JS — form submit, stats bindings, slots cell, attendees sub-lists

**Files:**
- Modify: `public/js/admin.js` (multiple sites)

- [ ] **Step 1: Update DOM refs and form submit**

At the top of the file, replace the `slotsInput` ref:

```js
const adultsInput = $('#af-adults');
const kidsInput   = $('#af-kids');
```

Replace the `addForm.addEventListener('submit', …)` handler with:

```js
addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const adult_slots = parseInt(adultsInput.value, 10);
  const kid_slots   = parseInt(kidsInput.value, 10);
  if (!name) {
    showToast('⚠ Family name is required.');
    return;
  }
  if (!Number.isInteger(adult_slots) || adult_slots < 0 || adult_slots > 20 ||
      !Number.isInteger(kid_slots)   || kid_slots   < 0 || kid_slots   > 20) {
    showToast('⚠ Adult and kid slots must each be 0–20.');
    return;
  }
  const total = adult_slots + kid_slots;
  if (total < 1 || total > 20) {
    showToast('⚠ Total slots (adults + kids) must be 1–20.');
    return;
  }
  try {
    const res = await fetch(`${ADMIN_BASE}/api/families`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, adult_slots, kid_slots })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Could not create family.');

    const ok = await copyToClipboard(json.share_url);
    showToast(ok ? `Link copied for ${json.family.name} — paste it into WhatsApp.` : 'Created. Copy the link from the table.');
    addForm.reset();
    adultsInput.value = '2';
    kidsInput.value   = '2';
    nameInput.focus();
    await load();
  } catch (err) {
    showToast('⚠ ' + err.message);
  }
});
```

- [ ] **Step 2: Update stats bindings**

Replace the four lines that set `#stat-total`/`#stat-yes`/`#stat-no`/`#stat-pending`/`#stat-attendees` inside `load()` with:

```js
    $('#stat-total').textContent   = json.stats.families_total;
    $('#stat-yes').textContent     = json.stats.yes_count;
    $('#stat-no').textContent      = json.stats.no_count;
    $('#stat-pending').textContent = json.stats.pending_count;
    $('#stat-adults').textContent  = json.stats.adult_count;
    $('#stat-kids').textContent    = json.stats.kid_count;
```

- [ ] **Step 3: Replace `slotsCell`**

Replace the `slotsCell(f)` function with:

```js
function slotsCell(f) {
  const max = `${f.adult_slots}A+${f.kid_slots}K`;
  if (f.attending === 'yes') return `${f.adult_count}A+${f.kid_count}K / ${max}`;
  if (f.attending === 'no')  return `0 / ${max}`;
  return `— / ${max}`;
}
```

- [ ] **Step 4: Replace `renderDetail`**

Replace the existing `renderDetail(f)` function with:

```js
function renderDetail(f) {
  const adults = (f.attendees || []).filter(a => a.kind === 'adult');
  const kids   = (f.attendees || []).filter(a => a.kind === 'kid');
  const block = (label, list) => list.length
    ? `<div class="attendees-group"><strong>${label} (${list.length})</strong>
        <ul class="attendees-sublist">${list.map(a => `<li>${escapeHtml(a.name)}</li>`).join('')}</ul></div>`
    : '';
  const msg = f.message ? `<div class="sub-message">"${escapeHtml(f.message)}"</div>` : '';
  return `${block('Adults', adults)}${block('Kids', kids)}${msg}`;
}
```

- [ ] **Step 5: Add a tiny CSS rule for the new group label**

In `public/admin.html` `<style>`, append:

```css
.attendees-group { margin: .35rem 0 .25rem 1rem; font-size: .85rem; color: #555; }
.attendees-group strong { display: block; font-family: 'Fredoka', sans-serif; font-size: .78rem; color: #333; margin-top: .35rem; }
.attendees-group .attendees-sublist { margin-left: .5rem; }
```

- [ ] **Step 6: Manual smoke test in browser**

1. Visit `http://localhost:3000/admin-secret-rsvp-2026`. Confirm the 6 tiles are populated.
2. Create a new family `"Brown Test"` with adults=2, kids=1. Toast shows the link was copied.
3. Open the share URL in another tab (or an incognito window). Confirm the RSVP page still loads (the form will look broken until Tasks 9–10 — that's expected).
4. Back in admin, confirm the new row in the Families table shows `— / 2A+1K` in the Slots column. Click Delete and confirm.

- [ ] **Step 7: Commit**

```powershell
git add public/js/admin.js public/admin.html
git commit -m "feat(admin): wire form to adult_slots+kid_slots, split stats + table cells"
```

---

## Chunk 3: Guest RSVP frontend

### Task 9: Split the RSVP form into Adults + Kids sections (HTML only)

**Files:**
- Modify: `public/index.html:358-370` (the two `attending-only` blocks)

- [ ] **Step 1: Replace the count-pills + attendee-list markup**

Replace the existing two `<div class="bp-field attending-only">` blocks with:

```html
          <div class="bp-field attending-only kind-section" data-kind="adult" id="adult-section">
            <label>How many adults? *</label>
            <div class="count-pills" id="adult-pills" role="radiogroup" aria-label="Adult count"></div>
            <label class="kind-names-label">Adult names *</label>
            <div class="attendee-list" id="adult-list"></div>
          </div>

          <div class="bp-field attending-only kind-section" data-kind="kid" id="kid-section">
            <label>How many kids? *</label>
            <div class="count-pills" id="kid-pills" role="radiogroup" aria-label="Kid count"></div>
            <label class="kind-names-label">Kid names *</label>
            <div class="attendee-list" id="kid-list"></div>
          </div>
```

- [ ] **Step 2: Add a small CSS rule for the section divider**

Open `public/css/style.css`. (If you haven't seen it yet — quick scan for `.attending-only` to find the right region.) Append at the bottom of the file:

```css
.kind-section + .kind-section { margin-top: 1.1rem; padding-top: 1rem; border-top: 1px dashed rgba(0,0,0,.18); }
.kind-section.hidden { display: none; }
.kind-names-label { display: block; margin-top: .6rem; font-size: .85rem; color: #555; }
```

The form will render but be totally non-functional after this step — JS rewiring is Task 10.

- [ ] **Step 3: Commit**

```powershell
git add public/index.html public/css/style.css
git commit -m "feat(rsvp): split count-pills+attendees markup into Adults and Kids sections"
```

---

### Task 10: RSVP JS — render, validate, submit, prefill, slots-line copy

**Files:**
- Modify: `public/js/main.js` — DOM refs (~194-198), `renderCountPills`, `renderAttendeeRows`, `setAttendingOnly`, `showFormView` (~349-380), the slots-line + change handler (~561-578), the submit handler (~581-638)

This is the biggest single edit. Work through it sequentially.

- [ ] **Step 1: Replace the RSVP DOM refs and state**

Replace lines 194-201 (`countPillsEl` through `currentAttendeeCount = 1;`) with:

```js
const adultSection = $('#adult-section');
const kidSection   = $('#kid-section');
const adultPillsEl = $('#adult-pills');
const kidPillsEl   = $('#kid-pills');
const adultListEl  = $('#adult-list');
const kidListEl    = $('#kid-list');
const slotsLineEl  = document.querySelector('[data-bp-slots-line]');
const bpTitleEl    = document.querySelector('[data-bp-title]');
const submitBtn    = form ? form.querySelector('.bp-submit') : null;

// Per-section count state
let adultCount = 0;
let kidCount   = 0;
```

- [ ] **Step 2: Replace `renderCountPills` with a kind-aware version**

```js
// Render count pills 0..max into a container. Min is 0 because a section
// with slots > 0 may still legitimately get 0 entrants (the OTHER section
// supplies attendees). The cross-section "≥ 1 total" invariant is enforced
// at submit.
function renderCountPills(container, max, selected, onChange) {
  container.innerHTML = '';
  for (let i = 0; i <= max; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'count-pill';
    b.textContent = String(i);
    b.dataset.count = String(i);
    b.setAttribute('aria-pressed', String(i === selected));
    b.addEventListener('click', () => {
      container.querySelectorAll('.count-pill').forEach(p =>
        p.setAttribute('aria-pressed', p.dataset.count === String(i) ? 'true' : 'false'));
      onChange(i);
    });
    container.appendChild(b);
  }
}
```

- [ ] **Step 3: Replace `renderAttendeeRows` with a kind-aware version**

```js
function renderAttendeeRows(listEl, n, prefill, kind) {
  listEl.innerHTML = '';
  const lastNameGuess = (familyData?.name || '').replace(/\s*Family\s*$/i, '').trim();
  const placeholder = kind === 'kid'
    ? (lastNameGuess ? `e.g. Kid ${lastNameGuess}` : 'Kid first + last name')
    : (lastNameGuess ? `e.g. First ${lastNameGuess}` : 'First Last');
  const labelWord = kind === 'kid' ? 'Kid' : 'Adult';
  for (let i = 0; i < n; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'attendee-row';
    const num = document.createElement('span');
    num.className = 'attendee-num';
    num.textContent = `${labelWord} ${i + 1}`;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.required = true;
    inp.maxLength = 120;
    inp.placeholder = placeholder;
    inp.dataset.attendee = String(i);
    if (prefill[i]?.name) inp.value = prefill[i].name;
    wrap.appendChild(num);
    wrap.appendChild(inp);
    listEl.appendChild(wrap);
  }
}
```

- [ ] **Step 4: Add helpers to (re)render each section + show/hide it**

```js
function renderAdults(selected, prefill) {
  adultCount = selected;
  renderCountPills(adultPillsEl, familyData.adult_slots, selected, (n) => {
    adultCount = n;
    renderAttendeeRows(adultListEl, n, [], 'adult');
  });
  renderAttendeeRows(adultListEl, selected, prefill || [], 'adult');
}
function renderKids(selected, prefill) {
  kidCount = selected;
  renderCountPills(kidPillsEl, familyData.kid_slots, selected, (n) => {
    kidCount = n;
    renderAttendeeRows(kidListEl, n, [], 'kid');
  });
  renderAttendeeRows(kidListEl, selected, prefill || [], 'kid');
}
function applySectionVisibility() {
  adultSection.classList.toggle('hidden', familyData.adult_slots === 0);
  kidSection.classList.toggle('hidden',   familyData.kid_slots === 0);
}
```

- [ ] **Step 5: Replace `showFormView`**

```js
function showFormView() {
  const isEdit = familyData.attending !== null;
  setEditMode(isEdit, familyData.updated_at || familyData.claimed_at);

  const yesRadio = form.querySelector('input[name="attending"][value="yes"]');
  const noRadio  = form.querySelector('input[name="attending"][value="no"]');
  yesRadio.checked = familyData.attending === 'yes';
  noRadio.checked  = familyData.attending === 'no';

  if (familyData.attending === 'no') {
    setAttendingOnly(false);
  } else {
    setAttendingOnly(true);
    applySectionVisibility();

    const priorAdults = (familyData.attendees || []).filter(a => a.kind === 'adult');
    const priorKids   = (familyData.attendees || []).filter(a => a.kind === 'kid');

    // First-claim default: pre-fill each section to its full slot count so
    // the most common case (everyone coming) is one click away. On edit,
    // restore the prior selection instead.
    const initialAdults = isEdit ? priorAdults.length : familyData.adult_slots;
    const initialKids   = isEdit ? priorKids.length   : familyData.kid_slots;

    renderAdults(initialAdults, priorAdults);
    renderKids(initialKids,     priorKids);
  }

  const msgEl = form.querySelector('textarea[name="message"]');
  msgEl.value = familyData.message || '';

  successBox.classList.add('hidden');
  form.classList.remove('hidden');
  submitBtn.disabled = false;
  submitBtn.querySelector('span').textContent = isEdit ? 'UPDATE MY PASS' : 'STAMP MY PASS';
}
```

- [ ] **Step 6: Update the slots-line copy and the YES toggle handler**

Replace the block that runs when `familyData && form` is truthy (around lines 558-578):

```js
if (familyData && form) {
  passHolderEl.textContent = familyData.name;
  if (slotsLineEl) {
    const a = familyData.adult_slots, k = familyData.kid_slots;
    if (a > 0 && k > 0) {
      slotsLineEl.textContent = `Up to ${a} adult${a === 1 ? '' : 's'} and ${k} kid${k === 1 ? '' : 's'} on this invitation.`;
    } else if (a > 0) {
      slotsLineEl.textContent = `Up to ${a} adult${a === 1 ? '' : 's'} on this invitation.`;
    } else {
      slotsLineEl.textContent = `Up to ${k} kid${k === 1 ? '' : 's'} on this invitation.`;
    }
  }

  // Attending toggle (form mode only)
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'attending') return;
    if (e.target.value === 'no') {
      setAttendingOnly(false);
    } else {
      setAttendingOnly(true);
      applySectionVisibility();
      // First time the YES section becomes visible after the user picked NO
      // (or never picked anything), pre-fill to the slot maxes if both
      // pill containers are still empty.
      if (adultPillsEl.children.length === 0 && kidPillsEl.children.length === 0) {
        renderAdults(familyData.adult_slots, []);
        renderKids(familyData.kid_slots,     []);
      }
    }
  });
```

- [ ] **Step 7: Replace the submit handler**

Replace the `form.addEventListener('submit', …)` block:

```js
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    const originalLabel = submitBtn.querySelector('span').textContent;
    submitBtn.querySelector('span').textContent = 'STAMPING…';

    const restore = () => {
      submitBtn.disabled = false;
      submitBtn.querySelector('span').textContent = originalLabel;
    };

    const attending = form.querySelector('input[name="attending"]:checked')?.value;
    if (!attending) {
      showToast('⚠  Please choose YES or NO.');
      return restore();
    }

    let body = { attending };
    if (attending === 'yes') {
      const collect = (listEl) =>
        Array.from(listEl.querySelectorAll('input')).map(i => ({ name: i.value.trim() }));
      const adults = collect(adultListEl);
      const kids   = collect(kidListEl);

      if (adults.length + kids.length < 1) {
        showToast('⚠  Please add at least one attendee.');
        return restore();
      }
      if (adults.some(a => !a.name) || kids.some(a => !a.name)) {
        showToast('⚠  Please fill in every attendee name.');
        return restore();
      }
      body.adults = adults;
      body.kids   = kids;
    }
    const messageVal = form.querySelector('textarea[name="message"]').value.trim();
    if (messageVal) body.message = messageVal;

    try {
      const res = await fetch(`/api/family/${encodeURIComponent(token)}/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Server error.');

      Object.assign(familyData, json.family);
      showStampedView();

      if (attending === 'yes') {
        if (window.confettiBurst) window.confettiBurst();
        bumpSparkles(25);
        showToast('★  Magic Pass stamped — see you soon!');
      } else {
        showToast('✦  RSVP saved.');
      }
      successBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      showToast('⚠  ' + err.message);
      restore();
    }
  });
```

- [ ] **Step 8: Manual browser smoke test**

1. In admin, create a family `"Test Family"` with adults=2, kids=1.
2. Open the share URL in an incognito window. Slots line should read `Up to 2 adults and 1 kid on this invitation.`
3. Pick YES. Confirm two stacked sections render: "How many adults?" with pills 0..2, "How many kids?" with pills 0..1. Default selection is 2 adults / 1 kid (slot maxes).
4. Try selecting `0` adults / `0` kids and submit — toast should show "Please add at least one attendee."
5. Fill in the names, submit. Should land on the stamped pass (Task 11 will polish it).
6. Click EDIT MY PASS — the form should reopen with your prior names already filled in, in the correct section.
7. Try a kid-only family: create `"All Kids"` with adults=0, kids=3. Open the link. The Adults section should be hidden entirely; slots line should say `Up to 3 kids on this invitation.`

- [ ] **Step 9: Commit**

```powershell
git add public/js/main.js
git commit -m "feat(rsvp): split form into adults+kids sections, validate, prefill on edit"
```

---

### Task 11: Stamped pass — group attendees by kind (in-page DOM)

**Files:**
- Modify: `public/js/main.js:282-326` (`renderStampedPass`)

- [ ] **Step 1: Replace the attendees rendering inside `renderStampedPass`**

Find the block beginning `if (attending === 'yes' && familyData.attendees?.length) {` and ending at its matching `}` (around lines 304-313). Replace with:

```js
  if (attending === 'yes' && familyData.attendees?.length) {
    const adults = familyData.attendees.filter(a => a.kind === 'adult');
    const kids   = familyData.attendees.filter(a => a.kind === 'kid');

    const renderGroup = (label, group) => {
      if (!group.length) return;
      const heading = document.createElement('p');
      heading.className = 'stamped-group';
      heading.textContent = `★ ${label.toUpperCase()} (${group.length})`;
      successBox.appendChild(heading);

      const list = document.createElement('ul');
      list.className = 'stamped-attendees';
      group.forEach(a => {
        const li = document.createElement('li');
        li.textContent = a.name;
        list.appendChild(li);
      });
      successBox.appendChild(list);
    };
    renderGroup('Adults', adults);
    renderGroup('Kids',   kids);
  }
```

- [ ] **Step 2: Add a small CSS rule for the group heading**

Append to `public/css/style.css`:

```css
.stamped-group { font-family: 'Bungee', sans-serif; font-size: .72rem; letter-spacing: .25em; color: #b51c2a; margin-top: .9rem; text-align: center; }
.stamped-group + .stamped-attendees { margin-top: .25rem; }
```

- [ ] **Step 3: Browser smoke test**

Submit the test family from Task 10 (2 adults + 1 kid). The stamped pass should now show `★ ADULTS (2)` followed by the two names, then `★ KIDS (1)` followed by the kid's name. Then a kid-only family — the ADULTS group should not appear at all.

- [ ] **Step 4: Commit**

```powershell
git add public/js/main.js public/css/style.css
git commit -m "feat(rsvp): stamped pass groups attendees as Adults / Kids sub-lists"
```

---

### Task 12: Boarding-pass PNG snapshot — group by kind

**Files:**
- Modify: `public/js/main.js:408-515` (`buildPassSnapshot`)

- [ ] **Step 1: Replace the attendees block inside `buildPassSnapshot`**

Find the section building `const attendees = (family.attendees || []).map(...)` (around line 412) and the `${isYes && attendees ? \`...\` : ''}` block (around lines 472-481). Replace both with:

```js
  const renderKindBlock = (label, list) => {
    if (!list.length) return '';
    const items = list.map(a =>
      `<li style="font-family:'Caveat',cursive;font-size:22px;color:#0a0c1f;line-height:1.25;margin:2px 0;">✦ ${escapeHTML(fit(a.name, 40))}</li>`
    ).join('');
    return `
      <div style="font-family:'Bungee',sans-serif; font-size:10px; letter-spacing:.25em; color:#b51c2a; text-align:center; margin-top:8px;">
        ★ ${label.toUpperCase()} (${list.length})
      </div>
      <ul style="list-style:none; padding:0; margin:6px 0 0; text-align:center;">
        ${items}
      </ul>`;
  };
  const adultList = (family.attendees || []).filter(a => a.kind === 'adult');
  const kidList   = (family.attendees || []).filter(a => a.kind === 'kid');
  const attendeesBlock = (isYes && (adultList.length || kidList.length)) ? `
    <div style="border-top:2px dashed rgba(0,0,0,.25); padding:14px 0 4px;">
      ${renderKindBlock('Adults', adultList)}
      ${renderKindBlock('Kids',   kidList)}
    </div>` : '';
```

In the template literal further down, replace:

```js
      ${isYes && attendees ? `
      <!-- Attendees list -->
      <div style="border-top:2px dashed rgba(0,0,0,.25); padding:14px 0 4px;">
        <div style="font-family:'Bungee',sans-serif; font-size:10px; letter-spacing:.25em; color:#b51c2a; text-align:center;">
          ${family.attendee_count} ATTENDEE${family.attendee_count === 1 ? '' : 'S'}
        </div>
        <ul style="list-style:none; padding:0; margin:8px 0 0; text-align:center;">
          ${attendees}
        </ul>
      </div>` : ''}
```

with:

```js
      ${attendeesBlock}
```

Also delete the now-unused `attendees` const (the one built from `(family.attendees || []).map(...)` near line 412).

- [ ] **Step 2: Browser smoke test**

Open a stamped pass in the browser. Click DOWNLOAD PASS. Open the resulting PNG and confirm the boarding pass shows the two grouped sub-lists matching the in-page stamped view, with empty groups omitted.

- [ ] **Step 3: Commit**

```powershell
git add public/js/main.js
git commit -m "feat(rsvp): PNG boarding-pass snapshot groups attendees by kind"
```

---

### Task 13: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (the architecture section)

- [ ] **Step 1: Update outdated references**

Find and replace these passages:

1. The `POST /api/family/:token/rsvp` paragraph (mentions the old validation order). Update to describe the new ordering:
   > `POST /api/family/:token/rsvp` — public write/update. Validation order is deliberate: `attending` → if `'no'` zero out attendees → if `'yes'` then `adults` and `kids` arrays each capped at `family.adult_slots` / `family.kid_slots` before walking, total ≥ 1 enforced, blank-name rejection. The DB write is wrapped in `db.transaction(() => …)` so concurrent submits never see torn state.

2. The "Token model" → "Edit semantics" paragraph that says attendees `position` is submit order. Update to:
   > Attendees are wiped and re-inserted on every submit. Adults are inserted first (positions 0..n-1) then kids (positions n..n+m-1), each tagged with a `kind` column.

3. The bullet list under "Frontend layout" describing `main.js` — adjust the count-pills mention to "two stacked count-pill sections (adults / kids), with per-section name fields."

4. The `Persistence` paragraph: drop the line about "name kept for backward compatibility despite the new schema" if you like, or leave it — both are fine. Optional.

5. Add a one-liner under the schema-sync paragraph: "On a legacy DB (presence of `families.max_slots`) the schema-sync block performs a one-time table rebuild inside a transaction to introduce `adult_slots` / `kid_slots`; existing families migrate as `adult_slots = max_slots, kid_slots = 0`."

- [ ] **Step 2: Commit**

```powershell
git add CLAUDE.md
git commit -m "docs(claude): update CLAUDE.md for adult/kid slot split"
```

---

## Final acceptance checklist

Before marking the work complete, walk through this in a browser:

- [ ] Admin: create a family with 2 adults + 2 kids → link is copied; row shows `— / 2A+2K`.
- [ ] Admin: stats tiles show 6 cards; Adults and Kids increment as RSVPs come in.
- [ ] Admin: Excel download has `Adults Used / Adults Max / Kids Used / Kids Max` and the Attendees sheet has a `Kind` column.
- [ ] Guest (mixed): sees "Up to 2 adults and 2 kids…" line; can pick 0..2 adults and 0..2 kids; total 0 is rejected; submitted RSVP appears stamped with two sub-lists.
- [ ] Guest (adults only): family with `kid_slots = 0` — Kids section is hidden entirely.
- [ ] Guest (kids only): family with `adult_slots = 0` — Adults section is hidden; works.
- [ ] Guest: edit-on-revisit pre-fills both sections with the correct prior names in the correct sections.
- [ ] Boarding-pass PNG download mirrors the in-page stamped view's grouping.
- [ ] Restart the server twice — second boot logs no migration messages.
- [ ] `git log --oneline` shows one commit per task (12-13 commits since the spec).
