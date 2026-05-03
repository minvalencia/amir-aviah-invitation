// server.js - Mickey & Minnie 3D Invitation Server
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ExcelJS = require('exceljs');
const basicAuth = require('express-basic-auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Configuration ----------
// IMPORTANT: change these in your .env file or in Render's environment variables
const ADMIN_USER = process.env.ADMIN_USER || 'parent';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme123';
// The admin path acts as a "secret URL". Change it to anything you like.
const ADMIN_PATH = process.env.ADMIN_PATH || 'admin-secret-rsvp-2026';

// ---------- Database setup ----------
// We use SQLite. By default the file lives in ./data/rsvps.db
// On Render's free tier the filesystem is EPHEMERAL, meaning data is wiped on
// redeploy/restart. Mount Render's persistent disk at /data and set DB_PATH=/data/rsvps.db
// in your environment variables, or download the Excel file regularly before redeploying.
const DB_DIR = path.dirname(process.env.DB_PATH || './data/rsvps.db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(process.env.DB_PATH || './data/rsvps.db');

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
    kind       TEXT NOT NULL DEFAULT 'adult' CHECK (kind IN ('adult','kid')),
    position   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attendees_family ON attendees(family_id);

  DROP TABLE IF EXISTS rsvps;
`);

// --- Migration: legacy families.max_slots → families.{adult_slots,kid_slots} ---
// IMPORTANT: foreign_keys MUST be off during the rebuild. better-sqlite3
// enables FKs by default (unlike vanilla SQLite), so without this guard
// the `DROP TABLE families` cascade-deletes every attendee row.
const familyCols = db.prepare("PRAGMA table_info('families')").all().map(r => r.name);
if (familyCols.includes('max_slots') && !familyCols.includes('adult_slots')) {
  db.pragma('foreign_keys = OFF');
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

// Foreign keys are off by default in SQLite; turn them on so ON DELETE CASCADE works.
db.pragma('foreign_keys = ON');

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

// ---------- Middleware ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    'SELECT name, position, kind FROM attendees WHERE family_id = ? ORDER BY position'
  ).all(family.id);
  const familyJSON = familyToJSON(family, attendees);
  res.send(renderInvitation({
    landingMode: 'gate-family',
    familyName: family.name,
    familyJSON
  }));
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Public endpoints ----------

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
    'SELECT name, position, kind FROM attendees WHERE family_id = ? ORDER BY position'
  ).all(family.id);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, family: familyToJSON(family, attendees) });
});

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

    const updated = db.prepare('SELECT * FROM families WHERE id = ?').get(family.id);
    const att = db.prepare('SELECT name, position, kind FROM attendees WHERE family_id = ? ORDER BY position').all(family.id);
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

// ---------- Admin (protected) ----------
const adminAuth = basicAuth({
  users: { [ADMIN_USER]: ADMIN_PASS },
  challenge: true,
  realm: 'Invitation Admin',
  unauthorizedResponse: 'Authentication required.'
});

// Hidden admin page (only you know this URL)
app.get(`/${ADMIN_PATH}`, adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ---------- Helpers shared across family routes ----------
function familyToShareUrl(req, token) {
  // Render's https proxy and local http both work via req.protocol + req.get('host')
  return `${req.protocol}://${req.get('host')}/i/${token}`;
}

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

// ---------- Admin: create family ----------
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

// ---------- Admin: list families ----------
app.get(`/${ADMIN_PATH}/api/families`, adminAuth, (req, res) => {
  const families = db.prepare('SELECT * FROM families ORDER BY created_at DESC').all();
  const attStmt = db.prepare('SELECT name, position, kind FROM attendees WHERE family_id = ? ORDER BY position');

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
    families_total: result.length,
    yes_count:      result.filter(r => r.attending === 'yes').length,
    no_count:       result.filter(r => r.attending === 'no').length,
    pending_count:  result.filter(r => r.attending === null).length,
    adult_count:    result.filter(r => r.attending === 'yes').reduce((s, r) => s + (r.adult_count || 0), 0),
    kid_count:      result.filter(r => r.attending === 'yes').reduce((s, r) => s + (r.kid_count   || 0), 0)
  };

  res.json({ ok: true, stats, families: result });
});

// API: download Excel
app.get(`/${ADMIN_PATH}/api/download`, adminAuth, async (req, res) => {
  const families = db.prepare('SELECT * FROM families ORDER BY created_at DESC').all();
  const attStmt = db.prepare(
    'SELECT name, position, kind FROM attendees WHERE family_id = ? ORDER BY position'
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

// ---------- Admin: delete family ----------
app.delete(`/${ADMIN_PATH}/api/families/:id`, adminAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: 'Bad id.' });
  // ON DELETE CASCADE handles attendees.
  const result = db.prepare('DELETE FROM families WHERE id = ?').run(id);
  res.json({ ok: true, deleted: result.changes });
});

// ---------- Health check (Render uses this) ----------
app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`🎈 Invitation site running on port ${PORT}`);
  console.log(`🔒 Admin URL: /${ADMIN_PATH}  (user: ${ADMIN_USER})`);
});
