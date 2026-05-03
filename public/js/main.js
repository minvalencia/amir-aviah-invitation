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

  // Pre-select the prior choice (or leave both unset on first claim).
  const yesRadio = form.querySelector('input[name="attending"][value="yes"]');
  const noRadio  = form.querySelector('input[name="attending"][value="no"]');
  yesRadio.checked = familyData.attending === 'yes';
  noRadio.checked  = familyData.attending === 'no';

  if (familyData.attending === 'no') {
    setAttendingOnly(false);
  } else {
    setAttendingOnly(true);
    const initialCount = isEdit && familyData.attending === 'yes'
      ? familyData.attendee_count
      : familyData.max_slots;
    currentAttendeeCount = initialCount;
    renderCountPills(familyData.max_slots, initialCount);
    renderAttendeeRows(initialCount, familyData.attendees || []);
  }

  // Pre-fill message
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

// ---------- Download pass (html2canvas → PNG) ----------
async function downloadPass(button) {
  if (typeof html2canvas !== 'function') {
    showToast('⚠ Download library still loading — try again in a moment.');
    return;
  }
  const target = document.querySelector('.boarding-pass');
  if (!target) return;
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'CAPTURING…';
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const canvas = await html2canvas(target, {
      backgroundColor: '#fff5e1',
      scale: 2,
      useCORS: true,
      ignoreElements: (el) => el.classList && el.classList.contains('bp-actions')
    });
    const slug = (familyData.name || 'pass').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
    const a = document.createElement('a');
    a.download = `${slug}-pass.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    showToast('★  Pass downloaded.');
  } catch (err) {
    console.error(err);
    showToast('⚠ Could not capture pass — try a different browser.');
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

// ---------- Initialise based on page mode ----------
if (familyData && form) {
  // gate-family mode: bind form to this family.
  passHolderEl.textContent = familyData.name;
  if (slotsLineEl) {
    slotsLineEl.textContent = `Up to ${familyData.max_slots} attendees on this invitation.`;
  }

  // attending toggle (form mode only)
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
      submitBtn.disabled = false;
      submitBtn.querySelector('span').textContent = originalLabel;
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

// ---------- Music (Web Audio synth, no audio files) ----------
const musicBtn = $('#music-toggle');
let audioCtx = null;
let musicTimer = null;
let isPlaying = false;

const NOTES = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392,
  A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99
};
// Cheerful 16-step jingle (royalty-free, original)
const MELODY = [
  ['C5', 0.25], ['E5', 0.25], ['G5', 0.5],  ['E5', 0.25], ['G5', 0.25], ['C5', 0.5],
  ['D5', 0.25], ['E5', 0.25], ['G5', 0.5],  ['F4', 0.25], ['A4', 0.25], ['C5', 0.5]
];

function playNote(freq, duration, when) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(0.16, when + 0.02);
  gain.gain.linearRampToValueAtTime(0,    when + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(when);
  osc.stop(when + duration);
}
function startMusic() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  function loop() {
    let t = audioCtx.currentTime;
    MELODY.forEach(([note, dur]) => {
      playNote(NOTES[note], dur * 0.95, t);
      t += dur;
    });
    musicTimer = setTimeout(loop, MELODY.reduce((s, [, d]) => s + d, 0) * 1000 + 500);
  }
  loop();
  isPlaying = true;
  musicBtn.classList.remove('muted');
}
function stopMusic() {
  if (musicTimer) clearTimeout(musicTimer);
  if (audioCtx) audioCtx.suspend();
  isPlaying = false;
  musicBtn.classList.add('muted');
}
musicBtn.addEventListener('click', () => isPlaying ? stopMusic() : startMusic());
