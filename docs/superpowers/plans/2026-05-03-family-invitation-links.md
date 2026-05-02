# Family Invitation Links Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the open `POST /api/rsvp` flow with per-family invitation tokens. Admin creates a family + slot quota → gets a unique `/i/<token>` URL → family visits, confirms attending, supplies one name per attendee (capped at quota), can edit anytime.

**Architecture:** Two new SQLite tables (`families`, `attendees`); twelve-char base62 opaque tokens generated server-side. Server-side template rendering of `public/index.html` via `String#replace` of three markers — no template engine. Admin dashboard rewritten to manage families with auto-clipboard share-link copy. The 3D Three.js scene (`scene.js`) is unchanged.

**Tech Stack:** Node 20 / Express / better-sqlite3 / ExcelJS / vanilla JS frontend / Three.js via importmap. No bundler, no test framework.

**Spec:** [`docs/superpowers/specs/2026-05-03-family-invitation-links-design.md`](../specs/2026-05-03-family-invitation-links-design.md). All decisions, validation rules, and rendering model are anchored there. If implementation reveals a contradiction, **pause and update the spec — do not silently diverge**.

**Verification model:** This project has no unit-test framework and the spec does not require one. Each task ends with a concrete verification step using `curl`, `node -e` SQL queries, or browser manual checks. The discipline is identical to TDD — write the verification first, run it to confirm the failure mode, implement, run again to confirm the pass — but the "test" is a shell command, not a Jest file. Do not introduce Jest or similar; the project is small enough that ad-hoc verification is the right tool.

**Working directory:** `D:\Projects\invitation`. All paths in this plan are relative to that root unless absolute.

**Conventions used in this plan:**

- "Boot test server" means: run `PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js` in a backgrounded terminal. Stop with `taskkill //F //IM node.exe` (Windows) or `kill %1` (POSIX) when done.
- "DB path" is `./data/rsvps.db` (the existing default — unchanged).
- "Family token" placeholder in examples: `TESTTOKEN001`.
- `${ADMIN_PATH}` in URLs uses the literal string `adm` for test-server commands.

---

## Chunk 1: Foundation (git, schema, token utility)

After this chunk: server boots, the `families` and `attendees` tables exist with the right shape, the legacy `rsvps` table is dropped, and a `generateToken()` helper produces unique 12-char base62 strings.

### Task 1: Initialize git and commit baseline

**Files:**
- Create: `.git/` (via `git init`)
- Modify: none

- [ ] **Step 1: Verify project is not yet a git repo**

```bash
git -C D:/Projects/invitation status 2>&1 | head -1
```

Expected: `fatal: not a git repository ...`

- [ ] **Step 2: Initialize**

```bash
cd D:/Projects/invitation && git init && git checkout -b main 2>/dev/null || git branch -M main
```

Expected: `Initialized empty Git repository in ...`

- [ ] **Step 3: Confirm `.gitignore` already excludes secrets/builds**

Read `.gitignore`. Expected lines (already present): `node_modules/`, `.env`, `data/*.db`, `data/*.db-journal`, `.DS_Store`, `*.log`. **Do not modify.**

- [ ] **Step 4: Stage and commit baseline**

Stage explicitly to avoid pulling `.env` or `data/`:

```bash
cd D:/Projects/invitation && git add Dockerfile README.md package.json package-lock.json render.yaml server.js .env.example .gitignore .dockerignore CLAUDE.md docs public
git commit -m "chore: baseline before family-link feature"
```

Expected: a commit summary listing the staged files.

- [ ] **Step 5: Verify**

```bash
cd D:/Projects/invitation && git log --oneline | head -3
```

Expected: one commit titled `chore: baseline before family-link feature`.

---

### Task 2: Add schema sync (families + attendees, drop rsvps)

**Files:**
- Modify: `server.js` (DB setup block, currently around lines 25–41)

- [ ] **Step 1: Boot the existing server, confirm `families` table does NOT yet exist**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
node -e "const db=require('better-sqlite3')('./data/rsvps.db'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all())"
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

Expected: array contains `{name:'rsvps'}` and **does not** contain `families` or `attendees`.

- [ ] **Step 2: Replace the existing `db.exec(...)` block**

In `server.js`, locate the `db.exec(\`CREATE TABLE IF NOT EXISTS rsvps ...\`);` block (currently around line 29). **Replace it entirely** with:

```js
// Schema sync — runs on every boot, idempotent.
// New tables persist across restarts on a Render Starter plan with a mounted disk.
// `DROP TABLE IF EXISTS rsvps` is safe: once the legacy table is gone, it no-ops.
db.exec(`
  CREATE TABLE IF NOT EXISTS families (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    token           TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    max_slots       INTEGER NOT NULL CHECK (max_slots BETWEEN 1 AND 20),
    attending       TEXT CHECK (attending IN ('yes', 'no')),
    attendee_count  INTEGER CHECK (attendee_count >= 0),
    message         TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    claimed_at      DATETIME,
    updated_at      DATETIME
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
```

- [ ] **Step 3: Boot test server again**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
node -e "const db=require('better-sqlite3')('./data/rsvps.db'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all())"
node -e "const db=require('better-sqlite3')('./data/rsvps.db'); console.log(db.prepare(\"SELECT sql FROM sqlite_master WHERE type='table' AND name='families'\").get())"
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

Expected: tables list now contains `attendees` and `families`, **does not** contain `rsvps`. The families CREATE TABLE SQL contains all the columns from §3 of the spec.

- [ ] **Step 4: Verify foreign-key cascade is wired**

```bash
node -e "
const db=require('better-sqlite3')('./data/rsvps.db');
db.pragma('foreign_keys = ON');
db.prepare('INSERT INTO families (token, name, max_slots) VALUES (?, ?, ?)').run('FK_TEST_____', 'FK Test', 1);
const fid = db.prepare('SELECT id FROM families WHERE token = ?').get('FK_TEST_____').id;
db.prepare('INSERT INTO attendees (family_id, name, position) VALUES (?, ?, ?)').run(fid, 'Alice', 0);
db.prepare('DELETE FROM families WHERE id = ?').run(fid);
console.log('orphans:', db.prepare('SELECT COUNT(*) c FROM attendees WHERE family_id = ?').get(fid).c);
"
```

Expected: `orphans: 0`. (The cascade deleted the attendee.)

- [ ] **Step 5: Commit**

```bash
cd D:/Projects/invitation && git add server.js
git commit -m "feat(schema): add families+attendees tables, drop legacy rsvps"
```

---

### Task 3: Add `generateToken()` utility

**Files:**
- Modify: `server.js` (add a helper function, probably below the DB setup block)

- [ ] **Step 1: Verify the helper does not yet exist**

```bash
grep -n "generateToken" D:/Projects/invitation/server.js
```

Expected: no output.

- [ ] **Step 2: Add the helper to `server.js`**

Insert immediately after the `db.pragma('foreign_keys = ON');` line:

```js
// ---------- Token generation ----------
// 12-char base62 (A-Z a-z 0-9). Search space ≈ 3.2e21.
// Rejection-sample bytes from crypto.randomBytes() to avoid modulo bias:
// for byte b, accept if b < 248 (largest multiple of 62 that fits in a byte),
// else reject. Pull 16 bytes at a time; loop until 12 chars accumulated.
const crypto = require('crypto');
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_LEN = 12;

function generateToken() {
  let out = '';
  while (out.length < TOKEN_LEN) {
    const buf = crypto.randomBytes(16);
    for (let i = 0; i < buf.length && out.length < TOKEN_LEN; i++) {
      const b = buf[i];
      if (b < 248) out += TOKEN_ALPHABET[b % 62];
    }
  }
  return out;
}
```

- [ ] **Step 3: Smoke-test the helper inline**

```bash
node -e "
const crypto = require('crypto');
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function generateToken() {
  let out = '';
  while (out.length < 12) {
    const buf = crypto.randomBytes(16);
    for (let i = 0; i < buf.length && out.length < 12; i++) {
      const b = buf[i];
      if (b < 248) out += TOKEN_ALPHABET[b % 62];
    }
  }
  return out;
}
const seen = new Set();
for (let i = 0; i < 1000; i++) {
  const t = generateToken();
  if (t.length !== 12) throw new Error('bad length: ' + t);
  if (!/^[A-Za-z0-9]{12}$/.test(t)) throw new Error('bad alphabet: ' + t);
  seen.add(t);
}
console.log('1000 tokens, unique:', seen.size);
"
```

Expected: `1000 tokens, unique: 1000`. (No collisions over 1000 draws — confirms uniformity.)

- [ ] **Step 4: Commit**

```bash
cd D:/Projects/invitation && git add server.js
git commit -m "feat(server): add base62 token generator with rejection sampling"
```

---

## Chunk 2: Backend API endpoints

After this chunk: admin can create / list / delete families and read the family record by token via curl. The guest write endpoint validates and persists per the spec. The old `POST /api/rsvp` is gone.

Implementation note: every admin route must wrap its handler with the existing `adminAuth` middleware **explicitly**, matching the per-route pattern already used in `server.js`. There is no shared admin sub-router.

### Task 4: Remove the legacy `POST /api/rsvp` route

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Verify the route still exists**

```bash
grep -n "/api/rsvp" D:/Projects/invitation/server.js
```

Expected: matches at the existing `app.post('/api/rsvp', ...)` and inside the admin DELETE route.

- [ ] **Step 2: Delete the entire `app.post('/api/rsvp', (req, res) => { ... })` block** (currently around lines 49–81). Leave the admin DELETE route alone for now — it's removed in Task 7.

- [ ] **Step 3: Boot test server, verify the route is gone**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3344/api/rsvp -H "Content-Type: application/json" -d '{}'
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

Expected: `404`.

- [ ] **Step 4: Commit**

```bash
cd D:/Projects/invitation && git add server.js
git commit -m "feat(api): remove legacy POST /api/rsvp"
```

---

### Task 5: Add `POST /${ADMIN_PATH}/api/families` (create)

**Files:**
- Modify: `server.js` (insert near the existing admin routes)

- [ ] **Step 1: Verify the route is missing**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" -u u:p -X POST http://localhost:3344/adm/api/families -H "Content-Type: application/json" -d '{"name":"Valencia","max_slots":5}'
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

Expected: `404`.

- [ ] **Step 2: Add the route**

Insert in the admin section of `server.js` (after `adminAuth` is defined, before `app.listen`):

```js
// ---------- Helpers shared across family routes ----------
function familyToShareUrl(req, token) {
  // Render's https proxy and local http both work via req.protocol + req.get('host')
  return `${req.protocol}://${req.get('host')}/i/${token}`;
}

function familyToJSON(family, attendees) {
  // Convert SQLite TEXT timestamps to ISO-8601 with Z so client time math works.
  const isoOrNull = (s) => s ? s.replace(' ', 'T') + 'Z' : null;
  return {
    id: family.id,
    name: family.name,
    max_slots: family.max_slots,
    attending: family.attending,
    attendee_count: family.attendee_count,
    message: family.message,
    created_at: isoOrNull(family.created_at),
    claimed_at: isoOrNull(family.claimed_at),
    updated_at: isoOrNull(family.updated_at),
    attendees: (attendees || []).map(a => ({ name: a.name, position: a.position }))
  };
}

// ---------- Admin: create family ----------
app.post(`/${ADMIN_PATH}/api/families`, adminAuth, (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const maxSlots = parseInt(req.body?.max_slots, 10);
    if (!name) return res.status(400).json({ ok: false, error: 'Family name is required.' });
    if (!Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > 20) {
      return res.status(400).json({ ok: false, error: 'max_slots must be an integer 1..20.' });
    }

    const insert = db.prepare(`
      INSERT INTO families (token, name, max_slots) VALUES (?, ?, ?)
    `);

    // Retry loop on UNIQUE-constraint collision (vanishingly rare).
    let row = null;
    for (let attempt = 0; attempt < 5 && !row; attempt++) {
      const token = generateToken();
      try {
        const result = insert.run(token, name, maxSlots);
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

- [ ] **Step 3: Boot, verify success path**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
curl -s -u u:p -X POST http://localhost:3344/adm/api/families -H "Content-Type: application/json" -d '{"name":"Valencia Family","max_slots":5}'
echo
```

Expected JSON shape (token will vary):

```json
{"ok":true,"family":{"id":1,"name":"Valencia Family","max_slots":5,"attending":null,"attendee_count":null,"message":null,"created_at":"2026-...Z","claimed_at":null,"updated_at":null,"attendees":[]},"share_url":"http://localhost:3344/i/<token>"}
```

- [ ] **Step 4: Verify validation paths**

```bash
# missing name
curl -s -u u:p -X POST http://localhost:3344/adm/api/families -H "Content-Type: application/json" -d '{"max_slots":5}'
echo
# bad max_slots
curl -s -u u:p -X POST http://localhost:3344/adm/api/families -H "Content-Type: application/json" -d '{"name":"X","max_slots":99}'
echo
# no auth
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3344/adm/api/families -H "Content-Type: application/json" -d '{"name":"X","max_slots":1}'
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

Expected: first two return `{"ok":false,"error":"..."}` 400. Third returns `401`.

- [ ] **Step 5: Commit**

```bash
cd D:/Projects/invitation && git add server.js
git commit -m "feat(api): admin POST /:adminPath/api/families"
```

---

### Task 6: Add `GET /${ADMIN_PATH}/api/families` (list)

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Verify route is missing**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" -u u:p http://localhost:3344/adm/api/families
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

Expected: `404`.

- [ ] **Step 2: Add the route below the POST handler**

```js
// ---------- Admin: list families ----------
app.get(`/${ADMIN_PATH}/api/families`, adminAuth, (req, res) => {
  const families = db.prepare('SELECT * FROM families ORDER BY created_at DESC').all();
  const attStmt = db.prepare('SELECT name, position FROM attendees WHERE family_id = ? ORDER BY position');

  const result = families.map(f => {
    const att = attStmt.all(f.id);
    return {
      ...familyToJSON(f, att),
      share_url: familyToShareUrl(req, f.token),
      token: f.token
    };
  });

  // Stats — derive from the family rows
  const stats = {
    families_total:    result.length,
    yes_count:         result.filter(r => r.attending === 'yes').length,
    no_count:          result.filter(r => r.attending === 'no').length,
    pending_count:     result.filter(r => r.attending === null).length,
    total_attendees:   result.filter(r => r.attending === 'yes')
                             .reduce((s, r) => s + (r.attendee_count || 0), 0)
  };

  res.json({ ok: true, stats, families: result });
});
```

- [ ] **Step 3: Boot + create a family + list**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
curl -s -u u:p -X POST http://localhost:3344/adm/api/families -H "Content-Type: application/json" -d '{"name":"Smith","max_slots":3}' > /dev/null
curl -s -u u:p http://localhost:3344/adm/api/families
echo
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

Expected: JSON with `ok:true`, `stats.families_total >= 1` (or higher if Task 5 left rows behind), `families[0]` has `share_url` and `token` populated.

- [ ] **Step 4: Commit**

```bash
cd D:/Projects/invitation && git add server.js
git commit -m "feat(api): admin GET /:adminPath/api/families"
```

---

### Task 7: Add `DELETE /${ADMIN_PATH}/api/families/:id` and remove legacy admin routes

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Boot, verify legacy `/api/list` still exists (and will be removed)**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" -u u:p http://localhost:3344/adm/api/list
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

Expected: `200` or `500` (it queries the dropped `rsvps` table — this is exactly why we're removing it).

- [ ] **Step 2: Remove the legacy admin routes**

In `server.js`, delete these blocks entirely:
- `app.get(\`/${ADMIN_PATH}/api/list\`, adminAuth, ...)` — superseded by `/api/families`.
- `app.delete(\`/${ADMIN_PATH}/api/rsvp/:id\`, adminAuth, ...)` — superseded by `/api/families/:id`.

(Leave the Excel route in place for now — it's rewritten in Chunk 3.)

- [ ] **Step 3: Add the new DELETE route**

Insert below the GET list handler:

```js
// ---------- Admin: delete family ----------
app.delete(`/${ADMIN_PATH}/api/families/:id`, adminAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: 'Bad id.' });
  // ON DELETE CASCADE handles attendees.
  const result = db.prepare('DELETE FROM families WHERE id = ?').run(id);
  res.json({ ok: true, deleted: result.changes });
});
```

- [ ] **Step 4: Boot + create + delete + list to confirm cascade**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
ID=$(curl -s -u u:p -X POST http://localhost:3344/adm/api/families -H "Content-Type: application/json" -d '{"name":"DelTest","max_slots":2}' | node -e "let b='';process.stdin.on('data',d=>b+=d).on('end',()=>console.log(JSON.parse(b).family.id))")
echo "Created id=$ID"
curl -s -u u:p -X DELETE http://localhost:3344/adm/api/families/$ID
echo
curl -s -u u:p http://localhost:3344/adm/api/families | node -e "let b='';process.stdin.on('data',d=>b+=d).on('end',()=>{const j=JSON.parse(b);console.log('match:', j.families.find(f=>f.id===Number(process.argv[1]))===undefined)})" $ID
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

Expected: `Created id=N`, `{"ok":true,"deleted":1}`, `match: true`.

- [ ] **Step 5: Commit**

```bash
cd D:/Projects/invitation && git add server.js
git commit -m "feat(api): replace legacy admin routes with /api/families CRUD"
```

---

### Task 8: Add `GET /api/family/:token` (guest read)

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Verify route is missing**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3344/api/family/anything
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

Expected: `404`.

- [ ] **Step 2: Add the route**

Insert in the public-routes section of `server.js` (above the admin block):

```js
// ---------- Public: read family by token ----------
app.get('/api/family/:token', (req, res) => {
  const token = String(req.params.token || '');
  // Reject obviously bad tokens early — saves a DB hit.
  if (!/^[A-Za-z0-9]{12}$/.test(token)) {
    return res.status(404).json({ ok: false, error: 'Invitation not found.' });
  }
  const family = db.prepare('SELECT * FROM families WHERE token = ?').get(token);
  if (!family) {
    return res.status(404).json({ ok: false, error: 'Invitation not found.' });
  }
  const attendees = db.prepare(
    'SELECT name, position FROM attendees WHERE family_id = ? ORDER BY position'
  ).all(family.id);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, family: familyToJSON(family, attendees) });
});
```

- [ ] **Step 3: Boot + create + read**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
TOKEN=$(curl -s -u u:p -X POST http://localhost:3344/adm/api/families -H "Content-Type: application/json" -d '{"name":"ReadTest","max_slots":4}' | node -e "let b='';process.stdin.on('data',d=>b+=d).on('end',()=>console.log(JSON.parse(b).share_url.split('/i/')[1]))")
echo "Token=$TOKEN"
curl -s http://localhost:3344/api/family/$TOKEN
echo
echo "---"
# Bad token
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3344/api/family/THIS_NO_EXIST
# Wrong-format token
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3344/api/family/short
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

Expected:
- valid token → JSON `{"ok":true,"family":{name:"ReadTest",max_slots:4,attendees:[]…}}` plus `Cache-Control: no-store` (verify with `-i` flag if curious).
- unknown token → `404`.
- bad-format token → `404`.

- [ ] **Step 4: Commit**

```bash
cd D:/Projects/invitation && git add server.js
git commit -m "feat(api): public GET /api/family/:token"
```

---

### Task 9: Add `POST /api/family/:token/rsvp` (guest write w/ validation + transaction)

**Files:**
- Modify: `server.js`

This is the most validation-heavy task. Read §4 of the spec carefully before implementing.

- [ ] **Step 1: Verify route is missing**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3344/api/family/abc/rsvp -H "Content-Type: application/json" -d '{}'
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

Expected: `404`.

- [ ] **Step 2: Add the route**

Insert below the GET handler:

```js
// ---------- Public: submit / update RSVP ----------
app.post('/api/family/:token/rsvp', (req, res) => {
  try {
    const token = String(req.params.token || '');
    if (!/^[A-Za-z0-9]{12}$/.test(token)) {
      return res.status(404).json({ ok: false, error: 'Invitation not found.' });
    }
    const family = db.prepare('SELECT * FROM families WHERE token = ?').get(token);
    if (!family) return res.status(404).json({ ok: false, error: 'Invitation not found.' });

    const body = req.body || {};

    // 1. attending must be 'yes' or 'no'.
    const attending = body.attending;
    if (attending !== 'yes' && attending !== 'no') {
      return res.status(400).json({ ok: false, error: "attending must be 'yes' or 'no'." });
    }

    let attendeeCount, attendeeNames;
    if (attending === 'no') {
      // 2. Spec §4 rule 3: force-ignore attendee_count and attendees entirely.
      attendeeCount = 0;
      attendeeNames = [];
    } else {
      // 3. attending === 'yes'
      let attendees = body.attendees;
      // Body-shape gate (spec §4 rule 1) — cap length BEFORE walking the array
      // so a 10MB payload of names is rejected without inspection.
      if (!Array.isArray(attendees)) {
        return res.status(400).json({ ok: false, error: 'attendees must be an array.' });
      }
      if (attendees.length > family.max_slots) {
        return res.status(400).json({ ok: false, error: `Only ${family.max_slots} slots on this pass.` });
      }
      attendeeCount = parseInt(body.attendee_count, 10);
      if (!Number.isInteger(attendeeCount) || attendeeCount < 1 || attendeeCount > family.max_slots) {
        return res.status(400).json({ ok: false, error: `attendee_count must be 1..${family.max_slots}.` });
      }
      if (attendees.length !== attendeeCount) {
        return res.status(400).json({ ok: false, error: 'attendees length must equal attendee_count.' });
      }
      attendeeNames = attendees.map((a, i) => {
        const n = String(a?.name ?? '').trim();
        if (!n) throw new Error(`Attendee ${i + 1} name is required.`);
        return n.slice(0, 120);
      });
    }

    // 5. Optional message.
    const message = body.message != null
      ? String(body.message).trim().slice(0, 1000)
      : null;

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
      'INSERT INTO attendees (family_id, name, position) VALUES (?, ?, ?)'
    );

    const tx = db.transaction(() => {
      updateFamily.run(attending, attendeeCount, message, family.id);
      deleteAttendees.run(family.id);
      attendeeNames.forEach((name, i) => insertAttendee.run(family.id, name, i));
    });
    tx();

    const updated = db.prepare('SELECT * FROM families WHERE id = ?').get(family.id);
    const att = db.prepare('SELECT name, position FROM attendees WHERE family_id = ? ORDER BY position').all(family.id);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, family: familyToJSON(updated, att) });
  } catch (err) {
    if (err && /name is required/.test(err.message)) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    console.error(err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});
```

- [ ] **Step 3: Boot + walk the validation matrix**

Save the script to `/tmp/rsvp_test.sh` (or run inline). Each line is a curl one-liner; the comment explains expected outcome.

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1

T=$(curl -s -u u:p -X POST http://localhost:3344/adm/api/families -H "Content-Type: application/json" -d '{"name":"V","max_slots":3}' | node -e "let b='';process.stdin.on('data',d=>b+=d).on('end',()=>console.log(JSON.parse(b).share_url.split('/i/')[1]))")
echo "Token=$T"

# happy: attending=yes with 2 names
curl -s -X POST http://localhost:3344/api/family/$T/rsvp -H "Content-Type: application/json" -d '{"attending":"yes","attendee_count":2,"attendees":[{"name":"Mark"},{"name":"Mariel"}],"message":"Thanks!"}'
echo

# happy: attending=no
curl -s -X POST http://localhost:3344/api/family/$T/rsvp -H "Content-Type: application/json" -d '{"attending":"no"}'
echo

# error: count > slots
curl -s -X POST http://localhost:3344/api/family/$T/rsvp -H "Content-Type: application/json" -d '{"attending":"yes","attendee_count":10,"attendees":[{"name":"a"},{"name":"b"},{"name":"c"},{"name":"d"},{"name":"e"},{"name":"f"},{"name":"g"},{"name":"h"},{"name":"i"},{"name":"j"}]}'
echo

# error: array longer than max_slots (early reject)
curl -s -X POST http://localhost:3344/api/family/$T/rsvp -H "Content-Type: application/json" -d '{"attending":"yes","attendee_count":2,"attendees":[{"name":"a"},{"name":"b"},{"name":"c"},{"name":"d"}]}'
echo

# error: empty attendee name
curl -s -X POST http://localhost:3344/api/family/$T/rsvp -H "Content-Type: application/json" -d '{"attending":"yes","attendee_count":1,"attendees":[{"name":"   "}]}'
echo

# error: count vs array length mismatch
curl -s -X POST http://localhost:3344/api/family/$T/rsvp -H "Content-Type: application/json" -d '{"attending":"yes","attendee_count":2,"attendees":[{"name":"a"}]}'
echo

# error: bad attending
curl -s -X POST http://localhost:3344/api/family/$T/rsvp -H "Content-Type: application/json" -d '{"attending":"maybe"}'
echo

# error: attendees not an array (when yes)
curl -s -X POST http://localhost:3344/api/family/$T/rsvp -H "Content-Type: application/json" -d '{"attending":"yes","attendee_count":1,"attendees":"nope"}'
echo

# happy: oversized message gets trimmed to 1000 chars (no error)
LONG=$(node -e "process.stdout.write('x'.repeat(1500))")
curl -s -X POST http://localhost:3344/api/family/$T/rsvp -H "Content-Type: application/json" -d "{\"attending\":\"no\",\"message\":\"$LONG\"}" | node -e "let b='';process.stdin.on('data',d=>b+=d).on('end',()=>console.log('msg len:', JSON.parse(b).family.message.length))"

# error: unknown token
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3344/api/family/AAAAAAAAAAAA/rsvp -H "Content-Type: application/json" -d '{"attending":"yes","attendee_count":1,"attendees":[{"name":"X"}]}'

taskkill //F //IM node.exe 2>/dev/null || kill %1
```

Expected:
- Line 1 (happy yes): `ok:true`, family with `attending:"yes"`, 2 attendees.
- Line 2 (happy no): `ok:true`, `attending:"no"`, 0 attendees, but `claimed_at` is preserved (already set).
- Lines 3-7 each return `ok:false` with the matching error message.
- New "attendees not an array" line: `ok:false`, error mentions "attendees must be an array."
- "msg len:" line: `msg len: 1000` (the long message was clipped to 1000 chars, not rejected).
- Last line: `404`.

- [ ] **Step 4: Verify edit semantics — names actually wiped on re-submit**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
T=$(curl -s -u u:p -X POST http://localhost:3344/adm/api/families -H "Content-Type: application/json" -d '{"name":"E","max_slots":3}' | node -e "let b='';process.stdin.on('data',d=>b+=d).on('end',()=>console.log(JSON.parse(b).share_url.split('/i/')[1]))")
curl -s -X POST http://localhost:3344/api/family/$T/rsvp -H "Content-Type: application/json" -d '{"attending":"yes","attendee_count":3,"attendees":[{"name":"a"},{"name":"b"},{"name":"c"}]}' > /dev/null
curl -s -X POST http://localhost:3344/api/family/$T/rsvp -H "Content-Type: application/json" -d '{"attending":"yes","attendee_count":1,"attendees":[{"name":"only"}]}' > /dev/null
curl -s http://localhost:3344/api/family/$T | node -e "let b='';process.stdin.on('data',d=>b+=d).on('end',()=>console.log(JSON.parse(b).family.attendees))"
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

Expected: `[ { name: 'only', position: 0 } ]` — the previous 3 attendees were cleanly wiped.

- [ ] **Step 5: Commit**

```bash
cd D:/Projects/invitation && git add server.js
git commit -m "feat(api): public POST /api/family/:token/rsvp with validation+tx"
```

---

## Chunk 3: Excel export rewrite

After this chunk: `GET /${ADMIN_PATH}/api/download` produces a workbook with two sheets ("Families" and "Attendees") matching §7 of the spec.

### Task 10: Rewrite the Excel handler

**Files:**
- Modify: `server.js` (the existing `/${ADMIN_PATH}/api/download` route — keep the URL, replace the body)

- [ ] **Step 1: Verify the existing route still queries `rsvps` (and is therefore broken)**

```bash
grep -n "FROM rsvps" D:/Projects/invitation/server.js
```

Expected: matches the existing download handler.

- [ ] **Step 2: Replace the entire download handler**

Locate `app.get(\`/${ADMIN_PATH}/api/download\`, adminAuth, async (req, res) => { ... })` and **replace its body**:

```js
app.get(`/${ADMIN_PATH}/api/download`, adminAuth, async (req, res) => {
  const families = db.prepare('SELECT * FROM families ORDER BY created_at DESC').all();
  const attStmt = db.prepare(
    'SELECT name, position FROM attendees WHERE family_id = ? ORDER BY position'
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Valencia Kingdom Invitation';
  workbook.created = new Date();

  // ---------- Sheet 1: Families ----------
  const fam = workbook.addWorksheet('Families', {
    properties: { tabColor: { argb: 'FFE63946' } }
  });
  fam.columns = [
    { header: '#',          key: 'id',         width: 6  },
    { header: 'Family',     key: 'name',       width: 28 },
    { header: 'Status',     key: 'status',     width: 12 },
    { header: 'Slots Used', key: 'used',       width: 11 },
    { header: 'Slots Max',  key: 'max',        width: 11 },
    { header: 'Message',    key: 'message',    width: 36 },
    { header: 'Created',    key: 'created_at', width: 22 },
    { header: 'Claimed',    key: 'claimed_at', width: 22 },
    { header: 'Updated',    key: 'updated_at', width: 22 },
    { header: 'Share URL',  key: 'share_url',  width: 60 }
  ];
  fam.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
  fam.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE63946' } };
  fam.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  fam.getRow(1).height = 22;

  const statusFor = (f) => {
    if (f.attending === 'yes') return 'Yes';
    if (f.attending === 'no')  return 'No';
    return 'Pending';
  };
  const usedFor = (f) => {
    if (f.attending === 'yes') return f.attendee_count ?? 0;
    if (f.attending === 'no')  return 0;
    return ''; // Pending → empty cell
  };

  // Convert SQLite TEXT timestamps to ISO-Z to match the JSON API surface.
  const isoOrEmpty = (s) => s ? s.replace(' ', 'T') + 'Z' : '';

  families.forEach(f => {
    fam.addRow({
      id: f.id,
      name: f.name,
      status: statusFor(f),
      used: usedFor(f),
      max: f.max_slots,
      message: f.message || '',
      created_at: isoOrEmpty(f.created_at),
      claimed_at: isoOrEmpty(f.claimed_at),
      updated_at: isoOrEmpty(f.updated_at),
      share_url: `${req.protocol}://${req.get('host')}/i/${f.token}`
    });
  });

  // ---------- Sheet 2: Attendees (flat) ----------
  const att = workbook.addWorksheet('Attendees', {
    properties: { tabColor: { argb: 'FFFF4D97' } }
  });
  att.columns = [
    { header: '#',                  key: 'n',           width: 6  },
    { header: 'Family',             key: 'family',      width: 28 },
    { header: 'Family Status',      key: 'status',      width: 14 },
    { header: 'Attendee Position',  key: 'position',    width: 18 },
    { header: 'Attendee Name',      key: 'name',        width: 28 }
  ];
  att.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
  att.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF4D97' } };
  att.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

  let counter = 1;
  families.forEach(f => {
    const rows = attStmt.all(f.id);
    rows.forEach(r => {
      att.addRow({
        n: counter++,
        family: f.name,
        status: statusFor(f),
        position: r.position + 1, // 1-based for humans in the spreadsheet
        name: r.name
      });
    });
  });

  const filename = `rsvp-list-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
});
```

- [ ] **Step 3: Boot + create + RSVP + download**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
T=$(curl -s -u u:p -X POST http://localhost:3344/adm/api/families -H "Content-Type: application/json" -d '{"name":"XL","max_slots":3}' | node -e "let b='';process.stdin.on('data',d=>b+=d).on('end',()=>console.log(JSON.parse(b).share_url.split('/i/')[1]))")
curl -s -X POST http://localhost:3344/api/family/$T/rsvp -H "Content-Type: application/json" -d '{"attending":"yes","attendee_count":2,"attendees":[{"name":"Mark"},{"name":"Mariel"}]}' > /dev/null
curl -s -u u:p -o /tmp/rsvps.xlsx http://localhost:3344/adm/api/download
ls -la /tmp/rsvps.xlsx
node -e "
const ExcelJS = require('exceljs');
const wb = new ExcelJS.Workbook();
wb.xlsx.readFile('/tmp/rsvps.xlsx').then(() => {
  console.log('sheets:', wb.worksheets.map(s => s.name));
  const fam = wb.getWorksheet('Families');
  console.log('families header:', fam.getRow(1).values.slice(1));
  console.log('families row 2:', fam.getRow(2).values.slice(1));
  const att = wb.getWorksheet('Attendees');
  console.log('attendees header:', att.getRow(1).values.slice(1));
  console.log('attendees rows:', att.rowCount);
});
"
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

Expected:
- file size > 5KB.
- sheets: `[ 'Families', 'Attendees' ]`.
- families header includes `'Slots Used'`, `'Share URL'`.
- families row 2 has `'Yes'` status and `'2'` slots used.
- attendees header includes `'Attendee Name'`, `attendees rowCount === 3` (header + 2 attendees).

- [ ] **Step 4: Commit**

```bash
cd D:/Projects/invitation && git add server.js
git commit -m "feat(export): two-sheet Families+Attendees Excel export"
```

---

## Chunk 4: Server-side template rendering + landing routes

After this chunk: `GET /` serves a "needs a personal link" landing variant of `index.html`. `GET /i/:token` injects the family record into the page on first paint. Unknown tokens return a 404 page using the same template.

### Task 11: Read `index.html` once at startup, expose three landing modes via marker substitution

**Files:**
- Modify: `server.js` (template loader + new `/` handler + `/i/:token` handler + remove `express.static` for `index.html`)
- Modify: `public/index.html` (add the three markers; `<body data-landing-mode="…">`; the section variants)

This task is a single conceptual change but touches both files. Implement the server side and template marker first, then wire up the body class and the three section variants in `index.html`.

- [ ] **Step 1: Verify current behavior — `/` serves the static `index.html` directly**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
curl -s http://localhost:3344/ | grep -c "Will you join us" # should be 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3344/i/anything # should be 404 (no route)
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

- [ ] **Step 2: Add markers to `public/index.html`**

Three insertions:

a) Replace `<body>` with `<body data-landing-mode="<!--LANDING_MODE-->">`.

b) Immediately before `<script type="module" src="/js/scene.js"></script>` near the bottom, insert:

```html
  <!--FAMILY_DATA_JSON-->
```

c) The boarding-pass header line currently reads `<h3 class="bp-title">Will you join us?</h3>`. Replace with:

```html
<h3 class="bp-title" data-bp-title>Will you join us?</h3>
<p class="bp-family-name" data-bp-family-name><!--FAMILY_NAME--></p>
<p class="bp-slots-line" data-bp-slots-line></p>
```

(`bp-family-name` and `bp-slots-line` get styled in Chunk 5; the marker is empty in `gate-link` mode.)

- [ ] **Step 3: Add the template loader and routes to `server.js`**

Insert near the top of `server.js` (after the `app.use(express.static(...))` line — but **before** the existing public routes):

```js
// ---------- Template loader (read once at startup) ----------
const indexHtmlTemplate = fs.readFileSync(
  path.join(__dirname, 'public', 'index.html'),
  'utf8'
);

// HTML escape for marker substitution
function htmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// JSON-in-script-tag escape: only `</` matters (prevents tag breakout).
function jsonScriptEscape(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function renderInvitation({ landingMode, familyName, familyJSON }) {
  let out = indexHtmlTemplate;
  out = out.replace('<!--LANDING_MODE-->', htmlEscape(landingMode));
  out = out.replace('<!--FAMILY_NAME-->', htmlEscape(familyName || ''));
  if (familyJSON) {
    out = out.replace(
      '<!--FAMILY_DATA_JSON-->',
      `<script id="family-data" type="application/json">${jsonScriptEscape(familyJSON)}</script>`
    );
  } else {
    out = out.replace('<!--FAMILY_DATA_JSON-->', '');
  }
  return out;
}
```

(`fs` and `path` are already required at the top of the file.)

Then, **above** the existing `app.use(express.static(...))` (so our route wins for `/` and `/i/:token`), add:

```js
// ---------- Public landing ----------
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(renderInvitation({ landingMode: 'gate-link', familyName: '', familyJSON: null }));
});

// ---------- Public family invitation ----------
app.get('/i/:token', (req, res) => {
  const token = String(req.params.token || '');
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', 'text/html; charset=utf-8');

  if (!/^[A-Za-z0-9]{12}$/.test(token)) {
    return res.status(404).send(renderInvitation({
      landingMode: 'gate-invalid', familyName: '', familyJSON: null
    }));
  }
  const family = db.prepare('SELECT * FROM families WHERE token = ?').get(token);
  if (!family) {
    return res.status(404).send(renderInvitation({
      landingMode: 'gate-invalid', familyName: '', familyJSON: null
    }));
  }
  const attendees = db.prepare(
    'SELECT name, position FROM attendees WHERE family_id = ? ORDER BY position'
  ).all(family.id);
  const familyJSON = familyToJSON(family, attendees);
  res.send(renderInvitation({
    landingMode: 'gate-family',
    familyName: family.name,
    familyJSON
  }));
});
```

`express.static('public')` continues to handle CSS/JS/images. Because Express matches routes in registration order, `/` will hit our new handler first; `express.static` will not see it.

- [ ] **Step 4: Boot + verify the three modes**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
# Mode: gate-link
curl -s http://localhost:3344/ | grep -o 'data-landing-mode="[^"]*"'
# Mode: gate-invalid
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3344/i/AAAAAAAAAAAA
curl -s http://localhost:3344/i/AAAAAAAAAAAA | grep -o 'data-landing-mode="[^"]*"'
# Mode: gate-family
T=$(curl -s -u u:p -X POST http://localhost:3344/adm/api/families -H "Content-Type: application/json" -d '{"name":"V&V Family","max_slots":4}' | node -e "let b='';process.stdin.on('data',d=>b+=d).on('end',()=>console.log(JSON.parse(b).share_url.split('/i/')[1]))")
curl -s http://localhost:3344/i/$T | grep -E 'data-landing-mode|family-data|bp-family-name'
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

Expected:
- gate-link: `data-landing-mode="gate-link"`.
- gate-invalid: 404; `data-landing-mode="gate-invalid"`.
- gate-family: `data-landing-mode="gate-family"`; one line containing `<script id="family-data" ...>`; the family name `V&amp;V Family` (HTML-escaped) appears inside `bp-family-name`.

- [ ] **Step 5: Commit**

```bash
cd D:/Projects/invitation && git add server.js public/index.html
git commit -m "feat(server): /i/:token rendering with three landing modes"
```

---

## Chunk 5: Public guest UI

After this chunk: visiting `/i/<valid-token>` shows the family name in the boarding pass, slot-aware count pills, dynamic name fields, the message field, edit-on-revisit pre-fill, and successful POST. The `/` landing shows a "personal link required" card.

### Task 12: Style the three landing modes (CSS)

**Files:**
- Modify: `public/css/style.css` (additions only — no rewrites)

- [ ] **Step 1: Verify current page renders the boarding-pass form unconditionally**

(Manual: open browser to `http://localhost:3344/` and confirm the boarding pass with form is shown. We're about to gate it.)

- [ ] **Step 2: Append landing-mode rules at the end of `style.css`**

```css
/* ============================================================
   Landing modes — body[data-landing-mode] gates form vs gate
   ============================================================ */

/* Default: hide the gate-link / gate-invalid scrim. */
.gate-link-card, .gate-invalid-card { display: none; }

/* When a personal link is required, hide the form and show the card. */
body[data-landing-mode="gate-link"] .rsvp-form,
body[data-landing-mode="gate-link"] .bp-flight,
body[data-landing-mode="gate-link"] [data-bp-slots-line],
body[data-landing-mode="gate-link"] [data-bp-family-name] { display: none; }
body[data-landing-mode="gate-link"] .gate-link-card { display: block; }

body[data-landing-mode="gate-invalid"] .rsvp-form,
body[data-landing-mode="gate-invalid"] .bp-flight,
body[data-landing-mode="gate-invalid"] [data-bp-slots-line],
body[data-landing-mode="gate-invalid"] [data-bp-family-name] { display: none; }
body[data-landing-mode="gate-invalid"] .gate-invalid-card { display: block; }
body[data-landing-mode="gate-invalid"] [data-bp-title] { color: var(--mickey-red-deep); }

/* gate-family — show family name above the form. */
body[data-landing-mode="gate-family"] [data-bp-family-name] {
  display: block;
  font-family: 'Caveat', cursive;
  font-size: 1.6rem;
  color: var(--mickey-red-deep);
  margin-top: 4px;
}
body[data-landing-mode="gate-family"] [data-bp-slots-line] {
  display: block;
  font-family: 'Bungee', sans-serif;
  font-size: 10px;
  letter-spacing: .2em;
  color: var(--mickey-red-deep);
  margin: 8px 0 4px;
}

/* The two cards themselves. */
.gate-link-card, .gate-invalid-card {
  padding: 18px 4px;
  text-align: center;
  font-family: 'Fredoka', sans-serif;
}
.gate-link-card h4, .gate-invalid-card h4 {
  font-family: 'Lilita One', cursive;
  font-size: 1.4rem;
  color: var(--ink);
  margin-bottom: 8px;
}
.gate-link-card p, .gate-invalid-card p {
  color: var(--ink-soft);
  font-size: .95rem;
  line-height: 1.5;
}

/* Count pills row */
.count-pills {
  display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px;
}
.count-pill {
  padding: 8px 14px;
  border: 2px solid rgba(10,12,31,.25);
  border-radius: 99px;
  background: rgba(255,255,255,.5);
  font-family: 'Bungee', sans-serif;
  font-size: 14px;
  cursor: pointer;
  transition: transform .15s, border-color .15s, background .15s, color .15s;
  color: var(--ink);
}
.count-pill[aria-pressed="true"] {
  background: var(--mickey-red); color: var(--ivory); border-color: var(--mickey-red);
  transform: translateY(-1px);
}

/* Attendee name list */
.attendee-list { display: flex; flex-direction: column; gap: 10px; }
.attendee-row {
  display: flex; align-items: center; gap: 10px;
}
.attendee-row .attendee-num {
  font-family: 'Bungee', sans-serif;
  font-size: 10px;
  letter-spacing: .15em;
  color: var(--mickey-red-deep);
  min-width: 78px;
}
.attendee-row input { flex: 1; }

/* Last-updated line */
.bp-last-updated {
  font-family: 'Caveat', cursive;
  color: var(--mickey-red-deep);
  font-size: 1rem;
  margin-top: -4px;
  margin-bottom: 6px;
}

/* "Edit again" affordance shown after a successful submit */
.edit-again-link {
  margin-top: 14px;
  background: none;
  border: 0;
  color: var(--mickey-red-deep);
  font-family: 'Bungee', sans-serif;
  font-size: 11px;
  letter-spacing: .15em;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.edit-again-link:hover { color: var(--mickey-red); }
```

- [ ] **Step 3: Append the two scrim cards inside the boarding pass body**

In `public/index.html`, immediately above `<form id="rsvp-form" class="rsvp-form" novalidate>` add:

```html
<div class="gate-link-card">
  <h4>This invitation requires a personal link.</h4>
  <p>Please ask your host for the unique link they sent you on WhatsApp or SMS.</p>
</div>
<div class="gate-invalid-card">
  <h4>This pass isn't valid.</h4>
  <p>Double-check the link your host shared, or ask them to re-send it.</p>
</div>
```

- [ ] **Step 4: Manual visual check**

Boot the server, open in a browser:
- `http://localhost:3344/` → boarding pass shows "This invitation requires a personal link."
- `http://localhost:3344/i/AAAAAAAAAAAA` → "This pass isn't valid."
- `http://localhost:3344/i/<real-token>` → boarding pass with family name, no scrim card.

- [ ] **Step 5: Commit**

```bash
cd D:/Projects/invitation && git add public/css/style.css public/index.html
git commit -m "feat(ui): landing-mode gating for boarding pass section"
```

---

### Task 13: Add count pills + dynamic attendee-name fields to the boarding pass

**Files:**
- Modify: `public/index.html` (replace the `attending-only` block)

- [ ] **Step 1: Verify current markup**

The current "attending-only" row uses two number inputs (`guests` and `kids`). We're replacing it with a count-pills row + a dynamic `<div id="attendee-list">`.

- [ ] **Step 2: Replace the existing `<div class="bp-row attending-only">…</div>` block**

```html
<div class="bp-field attending-only">
  <label>How many attending? *</label>
  <div class="count-pills" id="count-pills" role="radiogroup" aria-label="Attendee count">
    <!-- buttons populated by main.js based on max_slots -->
  </div>
</div>

<div class="bp-field attending-only">
  <label>Attendee names *</label>
  <div class="attendee-list" id="attendee-list">
    <!-- rows populated by main.js to match the selected count -->
  </div>
</div>
```

(The `attending-only` toggle behavior — hide-when-no — is preserved since main.js already handles `.attending-only`.)

- [ ] **Step 3: Manual visual check**

Boot, open `http://localhost:3344/i/<token>`. The form should now show two empty boxes labelled "How many attending? *" and "Attendee names *" — empty until main.js populates them in the next task.

- [ ] **Step 4: Commit**

```bash
cd D:/Projects/invitation && git add public/index.html
git commit -m "feat(ui): swap guests/kids inputs for count pills + attendee list"
```

---

### Task 14: Rewrite `main.js` family logic

**Files:**
- Modify: `public/js/main.js`

This is the largest frontend change. Read §5 of the spec before starting.

- [ ] **Step 1: Identify what needs replacing**

In `main.js`, the RSVP section currently:
- Reads form via `FormData`.
- POSTs to `/api/rsvp`.
- Shows success.
- Sets pass-holder text from the typed `name` input.

All four behaviors change. The new flow:
- Reads `<script id="family-data">`. If absent, the page is in `gate-link`/`gate-invalid` mode and the form binding is skipped.
- Sets pass-holder, family-name marker, and slots line from family data.
- Renders count pills 1..max_slots.
- Renders attendee inputs based on selected count.
- On submit, POSTs to `/api/family/${token}/rsvp` with `{ attending, attendee_count, attendees, message }`.
- On revisit (family.attending !== null), pre-fills count + names, switches button label and heading copy.

- [ ] **Step 2: Replace the RSVP-form section of `main.js`**

Delete the existing block from `// ---------- RSVP form ----------` down through the form's `submit` handler, and replace with:

```js
// ---------- RSVP form ----------
const form = $('#rsvp-form');
const successBox = $('#rsvp-success');
const successMessage = $('#success-message');
const attendingOnly = $$('.attending-only');
const nameInput = $('#name'); // legacy single input — used as fallback when no family

const familyDataEl = document.getElementById('family-data');
const familyData = familyDataEl ? JSON.parse(familyDataEl.textContent) : null;
const token = familyData ? location.pathname.split('/i/')[1] : null;

const countPillsEl  = $('#count-pills');
const attendeeListEl = $('#attendee-list');
const slotsLineEl   = document.querySelector('[data-bp-slots-line]');
const bpTitleEl     = document.querySelector('[data-bp-title]');
const submitBtn     = form ? form.querySelector('.bp-submit') : null;

// Track current selection
let currentAttendeeCount = 1;

function setAttendingOnly(visible) {
  attendingOnly.forEach(el => el.classList.toggle('hidden', !visible));
}

function renderCountPills(maxSlots, selected) {
  countPillsEl.innerHTML = '';
  for (let i = 1; i <= maxSlots; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'count-pill';
    b.textContent = String(i);
    b.dataset.count = String(i);
    b.setAttribute('aria-pressed', String(i === selected));
    b.addEventListener('click', () => {
      currentAttendeeCount = i;
      countPillsEl.querySelectorAll('.count-pill').forEach(p =>
        p.setAttribute('aria-pressed', p.dataset.count === String(i) ? 'true' : 'false'));
      renderAttendeeRows(currentAttendeeCount);
    });
    countPillsEl.appendChild(b);
  }
}

function renderAttendeeRows(n, prefill = []) {
  attendeeListEl.innerHTML = '';
  const lastNameGuess = (familyData?.name || '').replace(/\s*Family\s*$/i, '').trim();
  for (let i = 0; i < n; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'attendee-row';
    const num = document.createElement('span');
    num.className = 'attendee-num';
    num.textContent = `Attendee ${i + 1}`;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.required = true;
    inp.maxLength = 120;
    inp.placeholder = lastNameGuess ? `e.g. First ${lastNameGuess}` : 'First Last';
    inp.dataset.attendee = String(i);
    if (prefill[i]?.name) inp.value = prefill[i].name;
    wrap.appendChild(num);
    wrap.appendChild(inp);
    attendeeListEl.appendChild(wrap);
  }
}

function setEditMode(isEdit, lastUpdatedISO) {
  if (!bpTitleEl) return;
  bpTitleEl.textContent = isEdit
    ? `Update your pass, ${familyData.name}.`
    : `Claim your pass, ${familyData.name}.`;
  if (submitBtn) {
    submitBtn.querySelector('span').textContent = isEdit ? 'UPDATE MY PASS' : 'STAMP MY PASS';
  }
  // Last-updated line (only on edit)
  let lu = document.querySelector('.bp-last-updated');
  if (isEdit) {
    if (!lu) {
      lu = document.createElement('p');
      lu.className = 'bp-last-updated';
      bpTitleEl.parentElement.appendChild(lu);
    }
    lu.textContent = `Last updated ${relativeTime(new Date(lastUpdatedISO))}.`;
  } else if (lu) {
    lu.remove();
  }
}

function relativeTime(d) {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)         return 'just now';
  if (diff < 3600)       return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400)      return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 7 * 86400)  return `${Math.floor(diff / 86400)} day${Math.floor(diff/86400)===1?'':'s'} ago`;
  return d.toLocaleDateString();
}

// ---------- Initialise based on page mode ----------
if (familyData && form) {
  // gate-family mode: bind form to this family.
  passHolderEl.textContent = familyData.name;
  if (slotsLineEl) {
    slotsLineEl.textContent = `Up to ${familyData.max_slots} attendees on this invitation.`;
  }

  const initialAttending = familyData.attending; // 'yes' | 'no' | null
  const isEdit = initialAttending !== null;
  setEditMode(isEdit, familyData.updated_at || familyData.claimed_at);

  if (initialAttending === 'no') {
    form.querySelector('input[name="attending"][value="no"]').checked = true;
    setAttendingOnly(false);
  } else {
    // Pre-select YES on edit-yes; otherwise leave both unchecked but render slots.
    if (initialAttending === 'yes') {
      form.querySelector('input[name="attending"][value="yes"]').checked = true;
    }
    setAttendingOnly(true);
    const initialCount = isEdit && initialAttending === 'yes'
      ? familyData.attendee_count
      : familyData.max_slots;
    currentAttendeeCount = initialCount;
    renderCountPills(familyData.max_slots, initialCount);
    renderAttendeeRows(initialCount, familyData.attendees || []);
  }

  // Pre-fill message
  if (familyData.message) {
    form.querySelector('textarea[name="message"]').value = familyData.message;
  }

  // attending toggle
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'attending') return;
    if (e.target.value === 'no') {
      setAttendingOnly(false);
    } else {
      setAttendingOnly(true);
      if (countPillsEl.children.length === 0) {
        renderCountPills(familyData.max_slots, familyData.max_slots);
        currentAttendeeCount = familyData.max_slots;
        renderAttendeeRows(currentAttendeeCount);
      }
    }
  });

  // submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    const originalLabel = submitBtn.querySelector('span').textContent;
    submitBtn.querySelector('span').textContent = 'STAMPING…';

    const attending = form.querySelector('input[name="attending"]:checked')?.value;
    if (!attending) {
      showToast('⚠  Please choose YES or NO.');
      submitBtn.disabled = false;
      submitBtn.querySelector('span').textContent = originalLabel;
      return;
    }

    let body = { attending };
    if (attending === 'yes') {
      const inputs = attendeeListEl.querySelectorAll('input');
      const attendees = Array.from(inputs).map(i => ({ name: i.value.trim() }));
      // Client-side guard
      const blanks = attendees.filter(a => !a.name);
      if (blanks.length) {
        showToast('⚠  Please fill in every attendee name.');
        submitBtn.disabled = false;
        submitBtn.querySelector('span').textContent = originalLabel;
        return;
      }
      body.attendee_count = currentAttendeeCount;
      body.attendees = attendees;
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

      form.classList.add('hidden');
      successBox.classList.remove('hidden');
      if (attending === 'yes') {
        successMessage.textContent = `Pass stamped, ${familyData.name}! See you at the parade.`;
        if (window.confettiBurst) window.confettiBurst();
        bumpSparkles(25);
        showToast('★  Magic Pass stamped — see you soon!');
      } else {
        successMessage.textContent = `Thanks for letting us know, ${familyData.name}. You'll be missed!`;
      }
      setProgress(100);

      // Add (or re-show) an "Edit my pass" link that swaps the form back in,
      // pre-filled with what the server now has, so plans can change without a refresh.
      let editLink = successBox.querySelector('.edit-again-link');
      if (!editLink) {
        editLink = document.createElement('button');
        editLink.type = 'button';
        editLink.className = 'edit-again-link';
        editLink.textContent = 'Need to change something? Edit my pass →';
        successBox.appendChild(editLink);
        editLink.addEventListener('click', () => {
          // Refresh the local familyData snapshot from json.family so re-edit pre-fills correctly
          Object.assign(familyData, json.family);
          setEditMode(true, familyData.updated_at);
          successBox.classList.add('hidden');
          form.classList.remove('hidden');
          submitBtn.disabled = false;
          submitBtn.querySelector('span').textContent = 'UPDATE MY PASS';
        });
      }

      successBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      showToast('⚠  ' + err.message);
      submitBtn.disabled = false;
      submitBtn.querySelector('span').textContent = originalLabel;
    }
  });
} else if (form) {
  // gate-link or gate-invalid: don't bind submit. Disable it visibly so it can't be tabbed to.
  if (submitBtn) submitBtn.disabled = true;
}

// nameInput was used in the old flow to mirror into the pass-holder; in family
// mode, pass-holder is set above. We keep nameInput's listener defensive in
// case the legacy field is still in the DOM and reachable.
if (nameInput && !familyData) {
  nameInput.addEventListener('input', () => {
    const v = nameInput.value.trim();
    passHolderEl.textContent = v ? v.split(/\s+/).slice(0, 2).join(' ') : '— guest —';
  });
}
```

- [ ] **Step 3: Delete the legacy Passenger Name field and email/phone row from `public/index.html`**

Two deletions inside `<form id="rsvp-form" class="rsvp-form" novalidate>`:

1. The `<div class="bp-field">` block containing `<label for="name">Passenger Name *</label>` and its `<input id="name" ...>`.
2. The `<div class="bp-row">` containing the two `<div class="bp-field">` blocks for `for="email"` and `for="phone"`.

After this deletion, the form starts directly with `<fieldset class="bp-field bp-attend">`. The defensive `nameInput` block in main.js (lines reading `if (nameInput && !familyData) ...`) becomes dead code — the `$('#name')` lookup returns null, the guard skips. **Leave the dead code in place for this task** so the deletion remains a simple HTML edit; a tidy-up commit can remove it later if desired.

- [ ] **Step 4: Boot + visual smoke**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
T=$(curl -s -u u:p -X POST http://localhost:3344/adm/api/families -H "Content-Type: application/json" -d '{"name":"Valencia Family","max_slots":5}' | node -e "let b='';process.stdin.on('data',d=>b+=d).on('end',()=>console.log(JSON.parse(b).share_url.split('/i/')[1]))")
echo "Visit: http://localhost:3344/i/$T"
```

Open the URL in a browser. Confirm:
- Boarding-pass title says "Claim your pass, Valencia Family."
- "Up to 5 attendees on this invitation." line is visible.
- 5 count pills appear, the `5` pill is pre-selected.
- 5 attendee inputs appear with placeholders "e.g. First Valencia".
- Choosing **NO** hides count pills + attendee list.
- Choosing **YES**, lowering count to **3**, filling 3 names, submitting → success toast + STAMPED stamp.
- An "Edit my pass" link appears under the success message. Clicking it brings the form back, pre-filled with the 3 names, button labelled "UPDATE MY PASS", under heading "Update your pass, Valencia Family." with "Last updated just now."
- Refreshing the page → same edit-mode boarding pass appears (the SSR delivers the updated state on first paint).
- Submit button label is "UPDATE MY PASS" on revisit.

Stop the server with `taskkill //F //IM node.exe`.

- [ ] **Step 5: Commit**

```bash
cd D:/Projects/invitation && git add public/js/main.js public/index.html public/css/style.css
git commit -m "feat(ui): family-aware RSVP form with count pills + dynamic attendees"
```

---

## Chunk 6: Admin dashboard rewrite

After this chunk: admin dashboard supports adding families with auto-clipboard-copy, listing them with status, copying share URLs, and deleting.

### Task 15: Rewrite `public/admin.html`

**Files:**
- Modify: `public/admin.html` (replaces existing markup; existing inline CSS stays as a starting point but needs additions)

- [ ] **Step 1: Verify the current page**

Boot, open `http://localhost:3344/adm` in browser, log in. Confirm the page renders the legacy "All Responses" table that's now broken (zero rows because `rsvps` is gone — but we will replace the page anyway).

- [ ] **Step 2: Replace `<body>` markup in `admin.html`**

Replace everything from `<body>` to `</body>` with:

```html
<body>
  <header>
    <h1>RSVP Dashboard</h1>
    <a id="download-link" class="download-btn">⬇️ Download Excel</a>
  </header>

  <section class="stats" id="stats">
    <div class="stat"><div class="stat-label">Families</div>      <div class="stat-value" id="stat-total">0</div></div>
    <div class="stat"><div class="stat-label">Yes</div>           <div class="stat-value" id="stat-yes">0</div></div>
    <div class="stat"><div class="stat-label">No</div>            <div class="stat-value" id="stat-no">0</div></div>
    <div class="stat"><div class="stat-label">Pending</div>       <div class="stat-value" id="stat-pending">0</div></div>
    <div class="stat"><div class="stat-label">Total Attendees</div><div class="stat-value" id="stat-attendees">0</div></div>
  </section>

  <section class="add-family">
    <h2>Add a Family</h2>
    <form id="add-family-form" autocomplete="off">
      <div class="add-family-row">
        <label>Family Name
          <input type="text" id="af-name" name="name" required maxlength="120" placeholder="e.g. Valencia Family" />
        </label>
        <label>Slots
          <input type="number" id="af-slots" name="max_slots" required min="1" max="20" value="4" />
        </label>
        <button type="submit" class="create-btn">Create Invitation</button>
      </div>
      <p class="add-hint">A unique link is generated and copied to your clipboard, ready to paste into WhatsApp.</p>
    </form>
  </section>

  <section class="table-wrap">
    <div class="table-header">
      <h2>Families</h2>
      <div class="filter">
        <button data-filter="all" class="active">All</button>
        <button data-filter="pending">Pending</button>
        <button data-filter="yes">Yes</button>
        <button data-filter="no">No</button>
      </div>
    </div>
    <div id="table-container"></div>
  </section>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>

  <script src="js/admin.js"></script>
</body>
```

- [ ] **Step 3: Add CSS for the new sections inside the `<style>` block**

Append before `</style>`:

```css
/* Stat tile color overrides — 5 tiles now */
.stat:nth-child(1) { border-color: var(--red); }
.stat:nth-child(2) { border-color: #06A77D; }
.stat:nth-child(3) { border-color: var(--red); }
.stat:nth-child(4) { border-color: #B0B0B0; }
.stat:nth-child(5) { border-color: var(--pink); }

.add-family {
  margin: 0 2rem 1.5rem;
  background: #fff;
  border-radius: 16px;
  padding: 1.4rem 1.6rem;
  box-shadow: 0 4px 20px rgba(0,0,0,.06);
}
.add-family h2 {
  font-family: 'Fredoka', sans-serif;
  font-size: 1.1rem;
  margin-bottom: .8rem;
}
.add-family-row { display: flex; flex-wrap: wrap; gap: .8rem; align-items: end; }
.add-family-row label { display: flex; flex-direction: column; font-size: .82rem; color: #555; gap: .3rem; flex: 1; min-width: 160px; }
.add-family-row input {
  font-family: 'Quicksand', sans-serif;
  font-size: 1rem;
  padding: .55rem .7rem;
  border: 2px solid #ddd;
  border-radius: 8px;
}
.add-family-row input:focus { outline: 0; border-color: var(--red); }
.add-family-row .create-btn {
  background: var(--black); color: var(--cream);
  border: 0; padding: .65rem 1.2rem;
  border-radius: 8px; cursor: pointer;
  font-family: 'Fredoka', sans-serif; font-weight: 600;
  white-space: nowrap;
  transition: background .15s;
}
.add-family-row .create-btn:hover { background: #333; }
.add-hint { margin-top: .5rem; font-size: .82rem; color: #777; }

.badge.pending { background: #EEE; color: #666; }
.badge.edited  { background: #FFF3CD; color: #8a6d00; margin-left: .4rem; font-size: .65rem; }

.copy-btn {
  background: var(--cream); border: 1px solid #ddd; border-radius: 6px;
  padding: .25rem .65rem; font-size: .8rem; cursor: pointer;
  font-family: 'Quicksand', sans-serif;
}
.copy-btn:hover { border-color: var(--red); color: var(--red); }
.copy-btn.copied { background: #D4F4DD; border-color: #06A77D; color: #06A77D; }

.attendees-sublist {
  margin: .4rem 0 .2rem 1rem;
  font-size: .85rem;
  color: #555;
}
.attendees-sublist li { padding: .15rem 0; }
.attendees-sublist .sub-message { font-style: italic; color: #777; margin-top: .3rem; }

.expand-toggle {
  background: transparent; border: 0; cursor: pointer; color: #999;
  font-size: 1rem; padding: 0 .3rem; margin-right: .3rem;
}

.toast {
  position: fixed; bottom: 24px; left: 50%; transform: translate(-50%, 30px);
  background: var(--black); color: var(--cream);
  font-family: 'Fredoka', sans-serif; font-size: .9rem;
  padding: .7rem 1.4rem; border-radius: 999px;
  box-shadow: 0 8px 22px rgba(0,0,0,.4);
  opacity: 0; transition: opacity .25s, transform .25s; z-index: 50;
}
.toast.show { opacity: 1; transform: translate(-50%, 0); }
```

- [ ] **Step 4: Visual sanity check**

Boot, open `http://localhost:3344/adm`, log in. The page should render the new "Add a Family" card and the empty "Families" table. The download link is non-functional until `admin.js` is updated next.

- [ ] **Step 5: Commit**

```bash
cd D:/Projects/invitation && git add public/admin.html
git commit -m "feat(admin): rewrite dashboard markup and styles"
```

---

### Task 16: Rewrite `public/js/admin.js`

**Files:**
- Modify: `public/js/admin.js` (full rewrite)

- [ ] **Step 1: Replace the entire file**

```js
// admin.js — Family invitation dashboard

const ADMIN_BASE = window.location.pathname.replace(/\/$/, '');

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let families = [];
let currentFilter = 'all';
const expanded = new Set();

const downloadLink = $('#download-link');
const tableContainer = $('#table-container');
const toastEl = $('#toast');
const addForm = $('#add-family-form');
const nameInput = $('#af-name');
const slotsInput = $('#af-slots');

downloadLink.href = `${ADMIN_BASE}/api/download`;

// ---------- Toast ----------
let toastTimer;
function showToast(msg, ms = 2000) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

// ---------- Clipboard ----------
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // Fallback: prompt for manual copy
    window.prompt('Copy this link manually:', text);
    return false;
  }
}

// ---------- Filter buttons ----------
$$('.filter button').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.filter button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderTable();
  });
});

// ---------- Add Family form ----------
addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const max_slots = parseInt(slotsInput.value, 10);
  if (!name || !Number.isInteger(max_slots) || max_slots < 1 || max_slots > 20) {
    showToast('⚠ Family name and slots (1–20) are required.');
    return;
  }
  try {
    const res = await fetch(`${ADMIN_BASE}/api/families`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, max_slots })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Could not create family.');

    const ok = await copyToClipboard(json.share_url);
    showToast(ok ? `Link copied for ${json.family.name} — paste it into WhatsApp.` : 'Created. Copy the link from the table.');
    addForm.reset();
    slotsInput.value = '4';
    nameInput.focus();
    await load();
  } catch (err) {
    showToast('⚠ ' + err.message);
  }
});

// ---------- Load + render ----------
async function load() {
  try {
    const res = await fetch(`${ADMIN_BASE}/api/families`, { credentials: 'include' });
    const json = await res.json();
    if (!json.ok) throw new Error('Failed to load.');

    $('#stat-total').textContent     = json.stats.families_total;
    $('#stat-yes').textContent       = json.stats.yes_count;
    $('#stat-no').textContent        = json.stats.no_count;
    $('#stat-pending').textContent   = json.stats.pending_count;
    $('#stat-attendees').textContent = json.stats.total_attendees;

    families = json.families;
    renderTable();
  } catch (err) {
    tableContainer.innerHTML = `<div class="empty"><div class="empty-emoji">⚠️</div>Failed to load: ${escapeHtml(err.message)}</div>`;
  }
}

function statusFor(f) {
  if (f.attending === 'yes') return 'yes';
  if (f.attending === 'no')  return 'no';
  return 'pending';
}
function statusLabel(f) {
  if (f.attending === 'yes') return '● Yes';
  if (f.attending === 'no')  return '● No';
  return '○ Pending';
}
function isEdited(f) {
  return f.claimed_at && f.updated_at && (new Date(f.updated_at) - new Date(f.claimed_at) > 1000);
}
function slotsCell(f) {
  if (f.attending === 'yes') return `${f.attendee_count}/${f.max_slots}`;
  if (f.attending === 'no')  return `0/${f.max_slots}`;
  return `—/${f.max_slots}`;
}
function relativeTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)        return 'just now';
  if (diff < 3600)      return `${Math.floor(diff/60)} min ago`;
  if (diff < 86400)     return `${Math.floor(diff/3600)} hr ago`;
  if (diff < 7*86400)   return `${Math.floor(diff/86400)} day${Math.floor(diff/86400)===1?'':'s'} ago`;
  return d.toLocaleDateString();
}
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderTable() {
  let rows = families;
  if (currentFilter !== 'all') {
    rows = rows.filter(f => {
      if (currentFilter === 'pending') return f.attending === null;
      return f.attending === currentFilter;
    });
  }
  if (rows.length === 0) {
    tableContainer.innerHTML = `<div class="empty"><div class="empty-emoji">📭</div><p>No families ${currentFilter === 'all' ? 'yet' : 'in this filter'}.</p></div>`;
    return;
  }

  tableContainer.innerHTML = `
    <table>
      <thead>
        <tr>
          <th></th>
          <th>Family</th>
          <th>Status</th>
          <th>Slots</th>
          <th>Link</th>
          <th>Last Updated</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
      ${rows.map(f => {
        const expandedNow = expanded.has(f.id);
        const hasDetail = (f.attendees && f.attendees.length) || f.message;
        return `
          <tr data-fid="${f.id}">
            <td>${hasDetail ? `<button class="expand-toggle" data-toggle="${f.id}">${expandedNow ? '▾' : '▸'}</button>` : ''}</td>
            <td>
              <strong>${escapeHtml(f.name)}</strong>
              ${expandedNow && hasDetail ? renderDetail(f) : ''}
            </td>
            <td>
              <span class="badge ${statusFor(f)}">${statusLabel(f)}</span>
              ${isEdited(f) ? `<span class="badge edited">EDITED</span>` : ''}
            </td>
            <td>${slotsCell(f)}</td>
            <td><button class="copy-btn" data-copy="${escapeHtml(f.share_url)}">🔗 Copy</button></td>
            <td>${relativeTime(f.updated_at || f.claimed_at || f.created_at)}</td>
            <td><button class="delete-btn" data-del="${f.id}" data-name="${escapeHtml(f.name)}">Delete</button></td>
          </tr>
        `;
      }).join('')}
      </tbody>
    </table>
  `;

  // wire actions
  tableContainer.querySelectorAll('.expand-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.toggle);
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      renderTable();
    });
  });
  tableContainer.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await copyToClipboard(btn.dataset.copy);
      if (ok) {
        btn.classList.add('copied');
        const orig = btn.textContent;
        btn.textContent = '✓ Copied';
        setTimeout(() => { btn.classList.remove('copied'); btn.textContent = orig; }, 1500);
      }
    });
  });
  tableContainer.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.del);
      const name = btn.dataset.name;
      if (!confirm(`Delete ${name}? This cannot be undone and will invalidate their link.`)) return;
      const res = await fetch(`${ADMIN_BASE}/api/families/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) await load(); else showToast('⚠ Delete failed.');
    });
  });
}

function renderDetail(f) {
  const att = (f.attendees || []).map(a => `<li>${escapeHtml(a.name)}</li>`).join('');
  const msg = f.message ? `<div class="sub-message">“${escapeHtml(f.message)}”</div>` : '';
  return `<ul class="attendees-sublist">${att}</ul>${msg}`;
}

load();
setInterval(load, 30000);
```

- [ ] **Step 2: Boot + walk through the dashboard**

```bash
cd D:/Projects/invitation && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
echo "Open http://localhost:3344/adm in a browser; user=u, pass=p"
```

Manual checks:
1. Add a family "Valencia Family" with 5 slots → toast says "Link copied …", clipboard now contains `http://localhost:3344/i/<token>`. (Confirm via Cmd/Ctrl-V into a text editor.)
2. The new row appears in the table with status "○ Pending", slots `—/5`.
3. Open the share URL in another tab. Submit a YES with 3 names. Refresh the dashboard.
4. The row now shows "● Yes", `3/5`, "just now". Expand the family row and confirm the 3 attendee names appear.
5. Visit the share URL again; change to 2 names; submit. Dashboard now shows "● Yes EDITED", `2/5`.
6. Click "🔗 Copy" — the URL is on the clipboard.
7. Click "Delete" → confirm → row disappears.
8. Click "Download Excel" → file downloads (verify by opening, two sheets present).
9. Filter pills (All/Pending/Yes/No) filter the visible rows.

Stop the server.

- [ ] **Step 3: Commit**

```bash
cd D:/Projects/invitation && git add public/js/admin.js
git commit -m "feat(admin): family-aware dashboard with create+copy+expand+filter"
```

---

## Chunk 7: End-to-end smoke and polish

### Task 17: Update Valencia Kingdom landing copy for the gate-link variant

**Files:**
- Modify: `public/index.html` (only the gate-link card, to make the empty `/` feel intentional)

- [ ] **Step 1: Polish the gate-link card copy**

The card text from Task 12 was generic. Update to match the Kingdom voice:

```html
<div class="gate-link-card">
  <h4>This invitation is by personal link.</h4>
  <p>If we forgot to send you yours, please reach out — we'd love to have you at the celebration.</p>
</div>
<div class="gate-invalid-card">
  <h4>This pass isn't valid.</h4>
  <p>Double-check the link, or ask the host to re-send it on WhatsApp.</p>
</div>
```

- [ ] **Step 2: Commit**

```bash
cd D:/Projects/invitation && git add public/index.html
git commit -m "polish: warmer copy on gate-link landing"
```

---

### Task 18: Smoke the full flow in a clean DB

**Files:** none modified.

- [ ] **Step 1: Start with a fresh DB**

```bash
cd D:/Projects/invitation && rm -f data/rsvps.db && PORT=3344 ADMIN_USER=u ADMIN_PASS=p ADMIN_PATH=adm node server.js &
sleep 1
```

- [ ] **Step 2: Walk the host story end-to-end via curl**

```bash
# 1. Admin creates two families
T1=$(curl -s -u u:p -X POST http://localhost:3344/adm/api/families -H "Content-Type: application/json" -d '{"name":"Valencia Family","max_slots":5}' | node -e "let b='';process.stdin.on('data',d=>b+=d).on('end',()=>console.log(JSON.parse(b).share_url.split('/i/')[1]))")
T2=$(curl -s -u u:p -X POST http://localhost:3344/adm/api/families -H "Content-Type: application/json" -d '{"name":"Smith Family","max_slots":3}' | node -e "let b='';process.stdin.on('data',d=>b+=d).on('end',()=>console.log(JSON.parse(b).share_url.split('/i/')[1]))")
echo "Tokens: $T1 $T2"

# 2. Family 1 RSVPs yes, 4 attendees
curl -s -X POST http://localhost:3344/api/family/$T1/rsvp -H "Content-Type: application/json" -d '{"attending":"yes","attendee_count":4,"attendees":[{"name":"Mark"},{"name":"Mariel"},{"name":"Amir"},{"name":"Aviah"}],"message":"Thanks!"}' > /dev/null

# 3. Family 2 RSVPs no
curl -s -X POST http://localhost:3344/api/family/$T2/rsvp -H "Content-Type: application/json" -d '{"attending":"no","message":"Sorry, away that weekend."}' > /dev/null

# 4. Family 1 edits down to 2 attendees
sleep 1.5  # ensure updated_at > claimed_at by at least 1s
curl -s -X POST http://localhost:3344/api/family/$T1/rsvp -H "Content-Type: application/json" -d '{"attending":"yes","attendee_count":2,"attendees":[{"name":"Mark"},{"name":"Mariel"}]}' > /dev/null

# 5. Admin reads the list
curl -s -u u:p http://localhost:3344/adm/api/families | node -e "
let b='';process.stdin.on('data',d=>b+=d).on('end',()=>{
  const j=JSON.parse(b);
  console.log('stats:', j.stats);
  j.families.forEach(f=>console.log(f.name,'-',f.attending,'-',f.attendee_count,'/',f.max_slots,'-',f.attendees.map(a=>a.name).join(',')));
});
"

# 6. Admin downloads Excel
curl -s -u u:p -o /tmp/smoke.xlsx http://localhost:3344/adm/api/download
ls -la /tmp/smoke.xlsx
```

Expected output of step 5 (order may vary by created_at desc):

```
stats: { families_total: 2, yes_count: 1, no_count: 1, pending_count: 0, total_attendees: 2 }
Smith Family - no - 0 / 3 - 
Valencia Family - yes - 2 / 5 - Mark,Mariel
```

- [ ] **Step 3: Spot-check the EDITED chip and "no" message**

```bash
curl -s -u u:p http://localhost:3344/adm/api/families | node -e "
let b='';process.stdin.on('data',d=>b+=d).on('end',()=>{
  const j=JSON.parse(b);
  const v=j.families.find(f=>f.name==='Valencia Family');
  const s=j.families.find(f=>f.name==='Smith Family');
  console.log('Valencia edited?', new Date(v.updated_at) > new Date(v.claimed_at));
  console.log('Smith message:', s.message);
});
"
```

Expected: `Valencia edited? true`, `Smith message: Sorry, away that weekend.`.

- [ ] **Step 4: Stop server**

```bash
taskkill //F //IM node.exe 2>/dev/null || kill %1
```

- [ ] **Step 5: Commit (only if anything changed; if nothing, skip)**

```bash
cd D:/Projects/invitation && git status
```

If `git status` reports clean: skip. Otherwise commit any final tweaks.

---

## Plan summary

- **Chunks:** 7 (Foundation / Backend API / Excel / Templating / Public UI / Admin UI / Smoke)
- **Tasks:** 18
- **Files touched:**
  - `server.js` (heavy rewrite)
  - `public/index.html` (boarding-pass section + landing markers)
  - `public/css/style.css` (additions for landing modes + count pills + attendee list)
  - `public/js/main.js` (RSVP-form logic rewrite)
  - `public/admin.html` (markup + style additions)
  - `public/js/admin.js` (full rewrite)
  - `.git/` (initialised in Task 1)
- **Out of scope (deferred per spec §10):** email/SMS, edit history, deadline lock, bulk family create, in-place `max_slots` edit, login/identity, child/adult flag.

When all 18 tasks are committed, the feature matches the spec end-to-end and is ready to deploy to Render.
