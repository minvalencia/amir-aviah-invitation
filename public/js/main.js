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
// ✏️ EDIT: set this to your event's date/time (local browser time)
const EVENT_DATE = new Date('2026-06-15T15:00:00');

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
const attendingOnly = $('.attending-only');
const nameInput = $('#name');

// Pass-holder name mirrors the name input as it's typed
nameInput.addEventListener('input', () => {
  const v = nameInput.value.trim();
  passHolderEl.textContent = v ? v.split(/\s+/).slice(0, 2).join(' ') : '— guest —';
});

// Show/hide guest count fields based on attendance choice
form.addEventListener('change', (e) => {
  if (e.target.name === 'attending') {
    if (e.target.value === 'no') attendingOnly.classList.add('hidden');
    else                          attendingOnly.classList.remove('hidden');
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = form.querySelector('.bp-submit');
  submitBtn.disabled = true;
  const original = submitBtn.innerHTML;
  submitBtn.innerHTML = '<span>STAMPING…</span>';

  const data = Object.fromEntries(new FormData(form).entries());

  try {
    const res = await fetch('/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Something went wrong.');

    form.classList.add('hidden');
    successBox.classList.remove('hidden');

    if (data.attending === 'yes') {
      successMessage.textContent =
        `Pass stamped, ${data.name.split(' ')[0]}! See you at the parade.`;
      if (window.confettiBurst) window.confettiBurst();
      bumpSparkles(25);
      showToast('★  Magic Pass stamped — see you soon!');
    } else {
      successMessage.textContent =
        `Thanks for letting us know, ${data.name.split(' ')[0]}. You'll be missed!`;
    }

    // Force progress to 100% on completion
    setProgress(100);
    successBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    showToast('⚠  ' + err.message);
    submitBtn.disabled = false;
    submitBtn.innerHTML = original;
  }
});

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
