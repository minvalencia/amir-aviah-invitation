// admin.js — RSVP dashboard logic
// The admin path is the current URL path (e.g. /admin-secret-rsvp-2026)

const ADMIN_BASE = window.location.pathname.replace(/\/$/, '');

let allRsvps = [];
let currentFilter = 'all';

// Wire up the Excel download link
document.getElementById('download-link').href = `${ADMIN_BASE}/api/download`;

// Filter buttons
document.querySelectorAll('.filter button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderTable();
  });
});

async function load() {
  try {
    const res  = await fetch(`${ADMIN_BASE}/api/list`, { credentials: 'include' });
    const json = await res.json();
    if (!json.ok) throw new Error('Failed to load.');

    document.getElementById('stat-total').textContent     = json.stats.total_responses;
    document.getElementById('stat-yes').textContent       = json.stats.yes_count;
    document.getElementById('stat-no').textContent        = json.stats.no_count;
    document.getElementById('stat-attendees').textContent = json.stats.total_attendees;
    document.getElementById('stat-kids').textContent      = json.stats.total_kids;

    allRsvps = json.rows;
    renderTable();
  } catch (err) {
    document.getElementById('table-container').innerHTML =
      `<div class="empty"><div class="empty-emoji">⚠️</div>Failed to load: ${err.message}</div>`;
  }
}

function renderTable() {
  const container = document.getElementById('table-container');
  let rows = allRsvps;
  if (currentFilter !== 'all') rows = rows.filter((r) => r.attending === currentFilter);

  if (rows.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-emoji">📭</div>
        <p>No responses yet.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Name</th>
          <th>Email</th>
          <th>Phone</th>
          <th>RSVP</th>
          <th>Guests</th>
          <th>Kids</th>
          <th>Message</th>
          <th>When</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td>${r.id}</td>
            <td><strong>${escape(r.name)}</strong></td>
            <td>${escape(r.email || '—')}</td>
            <td>${escape(r.phone || '—')}</td>
            <td><span class="badge ${r.attending}">${r.attending === 'yes' ? '✓ Yes' : '✗ No'}</span></td>
            <td>${r.attending === 'yes' ? r.guests : '—'}</td>
            <td>${r.attending === 'yes' ? r.kids   : '—'}</td>
            <td class="message-cell">${escape(r.message || '')}</td>
            <td>${formatDate(r.created_at)}</td>
            <td><button class="delete-btn" data-id="${r.id}">Delete</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  container.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this RSVP? This cannot be undone.')) return;
      const id = btn.dataset.id;
      const res = await fetch(`${ADMIN_BASE}/api/rsvp/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) load();
    });
  });
}

function escape(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

load();
// auto-refresh every 30 seconds
setInterval(load, 30000);
