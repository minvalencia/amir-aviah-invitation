// main.js — Kingdom interactivity
// HUD progress, hidden-Mickey gamification, scroll reveal,
// countdown, RSVP form submission, and a Web Audio jingle.

// ---------- DOM refs ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const sections = $$('.section');
const passZoneEl = $('#passZone');
const passMeterEl = $('#passMeter');
const passHolderEl = $('#passHolder');
const sparkleCountEl = $('#sparkleCount');
const earsCountEl = $('#earsCount');
const progressPctEl = $('#progressPct');
const meterStops = $$('.pass-meter-stops span');
const toast = $('#toast');

// ---------- State ----------
const state = {
  sparkles: 0,
  ears: 0,
  zone: 'THE GATES',
  pct: 0,
  zonesVisited: new Set(['THE GATES'])
};

// ---------- Toast ----------
let toastTimer;
function showToast(text, ms = 2200) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
}

// ---------- HUD updates ----------
function bumpSparkles(n = 1) {
  state.sparkles += n;
  sparkleCountEl.textContent = state.sparkles;
}
function setProgress(pct) {
  state.pct = pct;
  passMeterEl.style.width = pct + '%';
  progressPctEl.textContent = Math.round(pct) + '%';
  // Light stops as we cross thresholds
  const stopThresholds = [0, 25, 50, 75, 100];
  meterStops.forEach((stop, i) => {
    if (pct >= stopThresholds[i] - 4) stop.classList.add('lit');
  });
}
function setZone(zone) {
  if (state.zone === zone) return;
  state.zone = zone;
  passZoneEl.textContent = zone;
  if (!state.zonesVisited.has(zone)) {
    state.zonesVisited.add(zone);
    showToast(`✦  Entered: ${zone}`);
    bumpSparkles(5);
    if (window.emitSparkles) window.emitSparkles(20, 0, 0, 6, 6);
  }
}

// ---------- Scroll progress (driven by scene.js custom event) ----------
window.addEventListener('kingdom:scroll', (e) => {
  setProgress(e.detail.progress * 100);
});

// ---------- IntersectionObserver: reveal + zone tracking ----------
const revealItems = [
  ...$$('.section-title'),
  ...$$('.eyebrow'),
  ...$$('.kingdom-title'),
  ...$$('.gate-names'),
  ...$$('.ticket-btn'),
  ...$$('.cast-grid'),
  ...$$('.cast-sub'),
  ...$$('.park-map'),
  ...$$('.countdown-grid'),
  ...$$('.ct-script'),
  ...$$('.boarding-pass')
];
revealItems.forEach((el) => el.classList.add('reveal'));

const revealIO = new IntersectionObserver((entries) => {
  for (const ent of entries) {
    if (ent.isIntersecting) {
      ent.target.classList.add('in');
      revealIO.unobserve(ent.target);
    }
  }
}, { threshold: 0.18 });
revealItems.forEach((el) => revealIO.observe(el));

// Stagger: cast grid + map pins
$$('.cast-grid, .park-map').forEach((el) => el.classList.add('reveal-stagger'));

const zoneIO = new IntersectionObserver((entries) => {
  // Pick the entry closest to the viewport center
  let best = null;
  let bestDist = Infinity;
  for (const ent of entries) {
    if (!ent.isIntersecting) continue;
    const r = ent.target.getBoundingClientRect();
    const dist = Math.abs((r.top + r.bottom) / 2 - window.innerHeight / 2);
    if (dist < bestDist) { bestDist = dist; best = ent.target; }
  }
  if (best) {
    setZone(best.dataset.zone);
  }
}, { threshold: [0.25, 0.5, 0.75] });
sections.forEach((s) => zoneIO.observe(s));

// ---------- Sparkle drip on scroll ----------
let lastSparkleTick = 0;
let lastY = window.scrollY;
window.addEventListener('scroll', () => {
  const dy = Math.abs(window.scrollY - lastY);
  const now = performance.now();
  if (dy > 18 && now - lastSparkleTick > 320) {
    bumpSparkles(1);
    lastSparkleTick = now;
  }
  lastY = window.scrollY;
}, { passive: true });

// ---------- Hidden Mickeys ----------
const hiddenMickeys = $$('.hidden-mickey');
const HM_TOTAL = hiddenMickeys.length;
hiddenMickeys.forEach((hm) => {
  hm.addEventListener('click', () => {
    if (hm.classList.contains('found')) return;
    hm.classList.add('found');
    state.ears += 1;
    earsCountEl.textContent = state.ears;
    bumpSparkles(8);
    showToast(state.ears < HM_TOTAL
      ? `◉  Hidden Mickey ${state.ears}/${HM_TOTAL}!`
      : `★  All Hidden Mickeys found! +50 magic`);
    if (state.ears === HM_TOTAL) {
      bumpSparkles(50);
      if (window.confettiBurst) window.confettiBurst();
    } else if (window.emitSparkles) {
      window.emitSparkles(28, 0, 0, 6, 3);
    }
  });
});

// ---------- Ticket CTA: smooth scroll to next section ----------
const ticketBtn = $('#ticketBtn');
if (ticketBtn) {
  ticketBtn.addEventListener('click', () => {
    const next = $('#s-cast');
    if (next) next.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (window.emitSparkles) window.emitSparkles(40, 0, -1, 6, 5);
    bumpSparkles(10);
    showToast('✦  Welcome to the park!');
  });
}

// ---------- Countdown ----------
// Christening at Immaculate Conception Parish Church, Concepcion, Marikina —
// Saturday, June 13, 2026 at 11:00 AM (Asia/Manila local time).
const EVENT_DATE = new Date('2026-06-13T11:00:00+08:00');

function updateCountdown() {
  const now = new Date();
  let diff = Math.max(0, EVENT_DATE - now);
  const days    = Math.floor(diff / 86400000); diff -= days * 86400000;
  const hours   = Math.floor(diff / 3600000);  diff -= hours * 3600000;
  const minutes = Math.floor(diff / 60000);    diff -= minutes * 60000;
  const seconds = Math.floor(diff / 1000);
  const set = (unit, val) => {
    const el = document.querySelector(`[data-unit="${unit}"]`);
    if (el) el.textContent = String(val).padStart(2, '0');
  };
  set('days', days); set('hours', hours);
  set('minutes', minutes); set('seconds', seconds);
}
updateCountdown();
setInterval(updateCountdown, 1000);

// ---------- RSVP form ----------
const form = $('#rsvp-form');
const successBox = $('#rsvp-success');
const successMessage = $('#success-message');
const attendingOnly = $$('.attending-only');
const nameInput = $('#name'); // legacy single input — used as fallback when no family

const familyDataEl = document.getElementById('family-data');
const familyData = familyDataEl ? JSON.parse(familyDataEl.textContent) : null;
const token = familyData ? location.pathname.split('/i/')[1] : null;

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

function setAttendingOnly(visible) {
  attendingOnly.forEach(el => el.classList.toggle('hidden', !visible));
}

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

// ---------- Stamped-pass renderer ----------
// Shown both (a) when a guest revisits an already-claimed link, and
// (b) immediately after a fresh submit. Edit + Download buttons live here.
function renderStampedPass() {
  successBox.innerHTML = '';
  const attending = familyData.attending;

  const stamp = document.createElement('div');
  stamp.className = 'bp-stamped';
  stamp.textContent = 'STAMPED';
  successBox.appendChild(stamp);

  const heading = document.createElement('h3');
  heading.textContent = attending === 'yes'
    ? `Pass stamped, ${familyData.name}!`
    : `Thanks, ${familyData.name}.`;
  successBox.appendChild(heading);

  const lead = document.createElement('p');
  lead.id = 'success-message';
  lead.textContent = attending === 'yes'
    ? `${familyData.attendee_count} attendee${familyData.attendee_count === 1 ? '' : 's'} confirmed:`
    : `You'll be missed!`;
  successBox.appendChild(lead);

  if (attending === 'yes' && familyData.attendees?.length) {
    const list = document.createElement('ul');
    list.className = 'stamped-attendees';
    familyData.attendees.forEach(a => {
      const li = document.createElement('li');
      li.textContent = a.name;
      list.appendChild(li);
    });
    successBox.appendChild(list);
  }

  if (familyData.message) {
    const msg = document.createElement('p');
    msg.className = 'stamped-message';
    msg.textContent = `“${familyData.message}”`;
    successBox.appendChild(msg);
  }

  const meta = document.createElement('p');
  meta.className = 'stamped-meta';
  const ts = familyData.updated_at || familyData.claimed_at;
  meta.textContent = ts ? `Last updated ${relativeTime(new Date(ts))}` : '';
  successBox.appendChild(meta);

  // Action row — Edit + Download.
  const actions = document.createElement('div');
  actions.className = 'bp-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'bp-action-btn edit';
  editBtn.textContent = 'EDIT MY PASS';
  editBtn.addEventListener('click', () => showFormView());
  actions.appendChild(editBtn);

  const dlBtn = document.createElement('button');
  dlBtn.type = 'button';
  dlBtn.className = 'bp-action-btn download';
  dlBtn.textContent = 'DOWNLOAD PASS';
  dlBtn.addEventListener('click', () => downloadPass(dlBtn));
  actions.appendChild(dlBtn);

  successBox.appendChild(actions);
}

// Render the form-view (claim or update). isEdit toggles the title + submit-button copy.
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

// Show the stamped pass (already-claimed view).
function showStampedView() {
  renderStampedPass();
  form.classList.add('hidden');
  successBox.classList.remove('hidden');
  setProgress(100);
}

// ---------- Download pass ----------
// Builds a clean, off-screen snapshot DOM tailored for PNG export, captures it
// with html2canvas, removes it. Avoids the live boarding-pass element's quirks
// (pseudo-element notches positioned outside the bounds, complex gradients,
// long-name layout breakage) and produces a consistent, keepsake-quality image.

function escapeHTML(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Truncate gracefully — long stress-test names shouldn't blow up the layout.
function fit(s, max) {
  s = String(s ?? '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function buildPassSnapshot(family) {
  const isYes = family.attending === 'yes';
  const safeName = escapeHTML(fit(family.name, 60));
  const safeMessage = family.message ? escapeHTML(fit(family.message, 240)) : '';
  const attendees = (family.attendees || []).map(a =>
    `<li style="font-family:'Caveat',cursive;font-size:22px;color:#0a0c1f;line-height:1.25;margin:2px 0;">✦ ${escapeHTML(fit(a.name, 40))}</li>`
  ).join('');
  const passNum = String(family.id ?? 0).padStart(4, '0');

  const wrap = document.createElement('div');
  // Off-screen but rendered, so html2canvas can read computed styles.
  wrap.style.cssText = `
    position:fixed; left:-10000px; top:0;
    width:600px; box-sizing:border-box;
    font-family:'Fredoka',system-ui,sans-serif;
    color:#0a0c1f;
  `;
  wrap.innerHTML = `
    <div style="
      background:linear-gradient(165deg,#fff5e1 0%,#ffe1c1 100%);
      border:3px solid #0a0c1f;
      border-radius:18px;
      padding:28px 32px;
      box-shadow:0 30px 70px -22px rgba(0,0,0,.85);
    ">
      <!-- Header band -->
      <div style="
        background:#e63946; color:#fff5e1;
        margin:-28px -32px 18px;
        padding:10px 0;
        text-align:center;
        font-family:'Bungee',sans-serif; font-size:11px; letter-spacing:.3em;
        border-radius:14px 14px 0 0;
      ">★ VIP BOARDING PASS · No. ${passNum} ★</div>

      <!-- Kingdom title -->
      <div style="text-align:center;">
        <div style="font-family:'Lilita One',cursive; font-size:30px; line-height:1; color:#0a0c1f;">The Valencia Kingdom</div>
        <div style="font-family:'Caveat',cursive; font-size:18px; color:#b51c2a; margin-top:2px;">
          Amir's Christening · Aviah's 3rd Birthday
        </div>
      </div>

      <!-- Family name + Mickey ears motif -->
      <div style="display:flex; align-items:center; justify-content:center; gap:14px; margin:18px 0 10px;">
        <svg width="44" height="36" viewBox="0 0 60 50" style="flex:none;">
          <circle cx="30" cy="32" r="16" fill="#0a0c1f"/>
          <circle cx="14" cy="14" r="11" fill="#0a0c1f"/>
          <circle cx="46" cy="14" r="11" fill="#0a0c1f"/>
        </svg>
        <div style="font-family:'Caveat',cursive; font-size:30px; line-height:1.05; color:#b51c2a; max-width:380px; text-align:left;">${safeName}</div>
      </div>

      <!-- YES / NO badge -->
      <div style="text-align:center; margin:8px 0 18px;">
        <span style="
          display:inline-block;
          font-family:'Bungee',sans-serif; font-size:22px; letter-spacing:.18em;
          padding:6px 22px; border-radius:8px;
          background:${isYes ? '#06A77D' : '#0a0c1f'};
          color:#fff5e1;
        ">${isYes ? 'CONFIRMED · YES' : 'DECLINED · NO'}</span>
      </div>

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

      ${safeMessage ? `
      <div style="font-family:'Caveat',cursive; font-size:18px; color:#1c1e3d; font-style:italic; text-align:center; margin:12px 24px 0; line-height:1.3;">
        "${safeMessage}"
      </div>` : ''}

      <!-- Event details -->
      <div style="border-top:2px dashed rgba(0,0,0,.25); margin-top:18px; padding-top:14px; text-align:center;">
        <div style="font-family:'Bungee',sans-serif; font-size:10px; letter-spacing:.25em; color:#b51c2a;">⛪ CHRISTENING · 11:00 AM</div>
        <div style="font-family:'Lilita One',cursive; font-size:18px; line-height:1.1; margin-top:2px;">Saturday, June 13, 2026</div>
        <div style="font-family:'Fredoka',sans-serif; font-size:13px; color:#1c1e3d; margin-top:2px;">
          Immaculate Conception Parish<br/>Concepcion, Marikina · Diocese of Antipolo
        </div>
        <div style="font-family:'Bungee',sans-serif; font-size:10px; letter-spacing:.25em; color:#b51c2a; margin:14px 0 2px;">🎉 RECEPTION · 12:00 PM</div>
        <div style="font-family:'Fredoka',sans-serif; font-size:13px; color:#1c1e3d;">
          Naysa's Kitchen · 67 Katipunan St, Marikina
        </div>
      </div>

      <!-- STAMPED mark -->
      <div style="text-align:center; margin-top:20px;">
        <span style="display:inline-block; transform:rotate(-6deg);
          font-family:'Bungee',sans-serif; font-size:20px; letter-spacing:.25em;
          color:#e63946; border:4px solid #e63946; padding:6px 16px; border-radius:6px;
        ">STAMPED</span>
      </div>

      <div style="text-align:center; margin-top:14px; font-family:'Bungee',sans-serif; font-size:8px; letter-spacing:.25em; color:rgba(10,12,31,.45);">
        Pass non-transferable · The Valencia Kingdom · 2026
      </div>
    </div>
  `;
  return wrap;
}

async function downloadPass(button) {
  if (typeof html2canvas !== 'function') {
    showToast('⚠ Download library still loading — try again in a moment.');
    return;
  }
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'CAPTURING…';

  const snapshot = buildPassSnapshot(familyData);
  document.body.appendChild(snapshot);

  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    // small RAF tick to ensure layout has settled before capture
    await new Promise((r) => requestAnimationFrame(r));
    const canvas = await html2canvas(snapshot, {
      backgroundColor: null,
      scale: 2,
      useCORS: true,
      logging: false
    });
    const slug = (familyData.name || 'pass')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
      .slice(0, 40) || 'pass';
    const a = document.createElement('a');
    a.download = `${slug}-pass.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    showToast('★  Pass downloaded.');
  } catch (err) {
    console.error(err);
    showToast('⚠ Could not capture pass — try a different browser.');
  } finally {
    snapshot.remove();
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

// ---------- Initialise based on page mode ----------
if (familyData && form) {
  // gate-family mode: bind form to this family.
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

  // attending toggle (form mode only)
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

  // submit
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

      // Refresh local snapshot, then show the stamped pass.
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

  // Initial render — claimed families see the stamped pass; new ones see the form.
  if (familyData.attending !== null) {
    showStampedView();
  } else {
    showFormView();
  }
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

// ---------- Music (muted-autoplay + first-gesture unmute) ----------
// The autoplay-with-sound policy in modern browsers blocks audible playback
// without user activation. The reliable workaround:
//   1. Set audio.muted = true and call play() — browsers ALLOW muted autoplay,
//      so the soundtrack is actually decoding/playing from page load.
//   2. On the first sign of presence (mouse move, scroll, click, key, touch),
//      flip muted = false. Audio becomes audible instantly with no replay
//      glitch because it was already running.
//   3. mousemove + scroll are not "user-activation" events but they trigger
//      reliable unmute in practice — and we also bind real activation events
//      (pointerdown/touchstart/keydown) so click-only browsers still work.
const musicBtn = $('#music-toggle');
const audio = new Audio('/assets/music.mp3');
audio.loop = true;
audio.preload = 'auto';
audio.volume = 0.45;
audio.muted = true; // crucial — lets the play() call below succeed cold.

const MUTE_KEY = 'kingdom:music-muted';
let userMuted = localStorage.getItem(MUTE_KEY) === '1';

function reflectMuteState() {
  // Visual mute state covers (a) user explicitly muted, (b) audio paused,
  // and (c) the silent-autoplay phase before unmute.
  const visualMuted = userMuted || audio.paused || audio.muted;
  musicBtn.classList.toggle('muted', visualMuted);
}

// Full-screen entry modal — the user must tap "ENTER THE KINGDOM" to dismiss.
// That tap is the user activation that unmutes audible playback. Skipped
// entirely if the visitor previously chose to mute.
function showEntryModal() {
  if (userMuted) return null;
  if (document.querySelector('.entry-modal')) return null;

  const modal = document.createElement('div');
  modal.className = 'entry-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'em-title');
  modal.innerHTML = `
    <div class="em-card">
      <div class="em-mickey" aria-hidden="true"><span></span><span></span><span></span></div>
      <p class="em-eyebrow">★ Welcome to ★</p>
      <h2 class="em-title" id="em-title">The Valencia Kingdom</h2>
      <p class="em-sub">A Mickey &amp; Minnie celebration awaits</p>
      <button class="em-cta" type="button" autofocus>
        <span>TAP TO ENTER</span>
        <span class="em-cta-spark" aria-hidden="true">✨</span>
      </button>
      <p class="em-fine">music will begin when you enter</p>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => modal.classList.add('show'));

  const dismiss = async () => {
    modal.classList.remove('show');
    setTimeout(() => {
      modal.remove();
      document.body.classList.remove('modal-open');
    }, 450);
    audio.muted = false;
    if (audio.paused) {
      try { await audio.play(); } catch {}
    }
    reflectMuteState();
    if (window.confettiBurst) window.confettiBurst();
  };

  // Any click on the modal (including its CTA) dismisses + unmutes.
  modal.addEventListener('click', dismiss);
  // Esc as an accessibility fallback so visitors don't get trapped.
  const onEsc = (e) => {
    if (e.key === 'Escape') {
      window.removeEventListener('keydown', onEsc);
      dismiss();
    }
  };
  window.addEventListener('keydown', onEsc);

  // Auto-focus the CTA so screen readers announce it and keyboard users can hit Enter.
  setTimeout(() => modal.querySelector('.em-cta')?.focus(), 50);

  return dismiss;
}

async function startMutedAutoplay() {
  if (userMuted) {
    // Visitor previously chose silence — honour it: stay paused, no modal.
    audio.muted = true;
    audio.pause();
    reflectMuteState();
    return;
  }
  // Try muted autoplay so the audio is decoding/buffering by the time the
  // visitor taps the modal — there's no perceptible delay when it unmutes.
  try { await audio.play(); } catch { /* fall through to modal */ }
  reflectMuteState();
  showEntryModal();
}

musicBtn.addEventListener('click', async () => {
  if (audio.paused || audio.muted) {
    userMuted = false;
    localStorage.setItem(MUTE_KEY, '0');
    audio.muted = false;
    try { await audio.play(); } catch {}
  } else {
    userMuted = true;
    localStorage.setItem(MUTE_KEY, '1');
    audio.pause();
  }
  reflectMuteState();
});

audio.addEventListener('play',  reflectMuteState);
audio.addEventListener('pause', reflectMuteState);
audio.addEventListener('volumechange', reflectMuteState);

reflectMuteState();
startMutedAutoplay();

// ---------- 3D tilt-on-hover (cards, pins, boarding pass) ----------
// Track mouse over each tiltable element; rotate it in 3D toward the cursor
// for a "popping out of the page" effect. Combines with each element's
// existing rest-tilt (e.g. star-card.boy = -3°) so nothing fights.
function setupTilt(el) {
  // Resolve the rest transform from the element's class so we can preserve it
  // while the cursor is inside.
  let rest = '';
  if (el.classList.contains('star-card')) {
    rest = el.classList.contains('boy') ? 'rotate(-3deg)' : 'rotate(3deg)';
  } else if (el.classList.contains('map-pin')) {
    const idx = Array.from(el.parentElement.children).indexOf(el);
    // Pins are siblings of <svg.map-paths>; indexes 1, 2, 3 in that order.
    rest = ['', 'rotate(-2deg)', 'rotate(1.5deg) translateY(-12px)', 'rotate(-1deg)'][idx] || '';
  }

  let raf = null;
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const dx = ((e.clientX - r.left) / r.width  - 0.5) * 2;
    const dy = ((e.clientY - r.top)  / r.height - 0.5) * 2;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      el.style.transition = 'transform .08s linear';
      el.style.transform =
        `${rest} perspective(900px) rotateX(${(-dy * 9).toFixed(2)}deg) rotateY(${(dx * 9).toFixed(2)}deg) translateZ(16px) scale(1.02)`;
    });
  });
  el.addEventListener('pointerleave', () => {
    cancelAnimationFrame(raf);
    el.style.transition = 'transform .35s cubic-bezier(.2,.9,.2,1)';
    el.style.transform = '';
  });
}

// Skip on touch-only devices — pointermove fires noisily on touch and the tilt
// looks awkward without a hover state.
const isTouchOnly = matchMedia('(hover: none)').matches;
if (!isTouchOnly) {
  ['.star-card', '.map-pin', '.boarding-pass'].forEach((sel) => {
    document.querySelectorAll(sel).forEach(setupTilt);
  });
}
