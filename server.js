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
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Public endpoints ----------

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

// API: list all RSVPs
app.get(`/${ADMIN_PATH}/api/list`, adminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM rsvps ORDER BY created_at DESC').all();

  const stats = {
    total_responses: rows.length,
    yes_count:       rows.filter(r => r.attending === 'yes').length,
    no_count:        rows.filter(r => r.attending === 'no').length,
    total_attendees: rows.filter(r => r.attending === 'yes')
                         .reduce((s, r) => s + (r.guests || 0), 0),
    total_kids:      rows.filter(r => r.attending === 'yes')
                         .reduce((s, r) => s + (r.kids   || 0), 0)
  };

  res.json({ ok: true, stats, rows });
});

// API: download Excel
app.get(`/${ADMIN_PATH}/api/download`, adminAuth, async (req, res) => {
  const rows = db.prepare('SELECT * FROM rsvps ORDER BY created_at DESC').all();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mickey & Minnie Invitation';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('RSVPs', {
    properties: { tabColor: { argb: 'FFE91E63' } }
  });

  sheet.columns = [
    { header: '#',         key: 'id',         width: 6 },
    { header: 'Name',      key: 'name',       width: 28 },
    { header: 'Email',     key: 'email',      width: 30 },
    { header: 'Phone',     key: 'phone',      width: 18 },
    { header: 'Attending', key: 'attending',  width: 12 },
    { header: 'Guests',    key: 'guests',     width: 10 },
    { header: 'Kids',      key: 'kids',       width: 8  },
    { header: 'Message',   key: 'message',    width: 40 },
    { header: 'Submitted', key: 'created_at', width: 22 }
  ];

  // Header style
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
  sheet.getRow(1).fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE91E63' }
  };
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 22;

  rows.forEach(r => sheet.addRow(r));

  // Summary sheet
  const summary = workbook.addWorksheet('Summary');
  summary.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value',  key: 'value',  width: 15 }
  ];
  summary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summary.getRow(1).fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A1A' }
  };

  const yes = rows.filter(r => r.attending === 'yes');
  summary.addRows([
    { metric: 'Total Responses',          value: rows.length },
    { metric: 'Attending (Yes)',          value: yes.length },
    { metric: 'Not Attending (No)',       value: rows.length - yes.length },
    { metric: 'Total Attendees (heads)',  value: yes.reduce((s, r) => s + (r.guests || 0), 0) },
    { metric: 'Total Kids',               value: yes.reduce((s, r) => s + (r.kids   || 0), 0) }
  ]);

  const filename = `rsvp-list-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  await workbook.xlsx.write(res);
  res.end();
});

// API: delete a RSVP (in case of duplicates/mistakes)
app.delete(`/${ADMIN_PATH}/api/rsvp/:id`, adminAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM rsvps WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- Health check (Render uses this) ----------
app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`🎈 Invitation site running on port ${PORT}`);
  console.log(`🔒 Admin URL: /${ADMIN_PATH}  (user: ${ADMIN_USER})`);
});
