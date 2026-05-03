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
  const msg = f.message ? `<div class="sub-message">"${escapeHtml(f.message)}"</div>` : '';
  return `<ul class="attendees-sublist">${att}</ul>${msg}`;
}

load();
setInterval(load, 30000);
