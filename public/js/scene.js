// scene.js — Three.js scroll-driven 3D scene
// Twilight Disneyland sky with parallax stars, drifting balloons,
// floating Mickey-ear silhouettes, and a scroll-responsive camera.
// Exposes window.confettiBurst() for the RSVP success moment.

import * as THREE from 'three';

const canvas = document.getElementById('bg-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x1a0d3a, 18, 90);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 0, 22);

// ---------- Lighting ----------
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const keyLight = new THREE.DirectionalLight(0xffe1b3, 1.0);
keyLight.position.set(5, 8, 10);
scene.add(keyLight);
const rimPink = new THREE.PointLight(0xff5d8f, 1.4, 80);
rimPink.position.set(-12, -4, 6);
scene.add(rimPink);
const rimGold = new THREE.PointLight(0xffd93d, 1.1, 80);
rimGold.position.set(12, 6, 6);
scene.add(rimGold);

// ---------- Helpers ----------
const rand = (min, max) => Math.random() * (max - min) + min;
const tau = Math.PI * 2;

// ---------- Mickey head builder ----------
function makeMickey(color = 0x0a0c1f, size = 1, opacity = 1) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.35,
    metalness: 0.05,
    transparent: opacity < 1,
    opacity
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(size, 28, 28), mat);
  group.add(head);
  const earGeo = new THREE.SphereGeometry(size * 0.6, 22, 22);
  const earL = new THREE.Mesh(earGeo, mat);
  earL.position.set(-size * 0.85, size * 0.85, 0);
  const earR = new THREE.Mesh(earGeo, mat);
  earR.position.set(size * 0.85, size * 0.85, 0);
  group.add(earL, earR);
  return group;
}

// ---------- Mickey field (drifting silhouettes through space) ----------
const mickeys = [];
const mickeyColors = [0x0a0c1f, 0xe63946, 0xff4d97, 0xffd93d];
for (let i = 0; i < 14; i++) {
  const m = makeMickey(mickeyColors[i % mickeyColors.length], rand(0.5, 1.4), rand(0.5, 0.95));
  m.position.set(rand(-22, 22), rand(-30, 30), rand(-18, 6));
  m.rotation.z = rand(-0.5, 0.5);
  m.userData = {
    spinX: rand(-0.003, 0.003),
    spinY: rand(-0.004, 0.004),
    floatPhase: rand(0, tau),
    floatSpeed: rand(0.4, 0.9),
    floatAmp: rand(0.3, 0.8),
    yBase: m.position.y
  };
  scene.add(m);
  mickeys.push(m);
}

// ---------- Balloons (string + sphere) ----------
const balloons = [];
const balloonColors = [0xe63946, 0xff4d97, 0xffd93d, 0xff8c42, 0x5e8dde];
function makeBalloon(color) {
  const g = new THREE.Group();
  const balloon = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 24, 24),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.25,
      metalness: 0.05,
      emissive: color,
      emissiveIntensity: 0.18
    })
  );
  balloon.scale.set(1, 1.18, 1);
  g.add(balloon);

  const knot = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.18, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4 })
  );
  knot.position.y = -0.68;
  knot.rotation.x = Math.PI;
  g.add(knot);

  const str = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 0.01, 1.6, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff5e1, transparent: true, opacity: 0.5 })
  );
  str.position.y = -1.55;
  g.add(str);

  return g;
}
for (let i = 0; i < 9; i++) {
  const b = makeBalloon(balloonColors[i % balloonColors.length]);
  b.position.set(rand(-20, 20), rand(-30, 30), rand(-12, 4));
  b.userData = {
    riseSpeed: rand(0.005, 0.015),
    swayPhase: rand(0, tau),
    swaySpeed: rand(0.3, 0.7),
    swayAmp: rand(0.2, 0.5)
  };
  scene.add(b);
  balloons.push(b);
}

// ---------- 3D Castle ----------
// A Magic-Kingdom-styled castle in the distance. Sits behind everything,
// catches light from the rim point-lights, and slowly sways as the camera
// approaches it on scroll. Built from primitives so no mesh/asset load.
function createCastle() {
  const g = new THREE.Group();
  const stoneMat  = new THREE.MeshStandardMaterial({ color: 0x352873, roughness: 0.7, metalness: 0.05 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x5b3aa8, roughness: 0.6, metalness: 0.1 });
  const spireMat  = new THREE.MeshStandardMaterial({
    color: 0xff5d8f, roughness: 0.4, metalness: 0.05,
    emissive: 0xff5d8f, emissiveIntensity: 0.3
  });
  const goldMat   = new THREE.MeshStandardMaterial({
    color: 0xffd93d, roughness: 0.4, metalness: 0.5,
    emissive: 0xffd93d, emissiveIntensity: 0.45
  });
  const windowMat = new THREE.MeshBasicMaterial({ color: 0xffd93d });

  // Wall base
  const wall = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.4, 1.4), stoneMat);
  wall.position.y = -1.6;
  g.add(wall);

  // Crenellated battlements along the wall top
  for (let i = -3; i <= 3; i += 0.65) {
    const batt = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.3, 1.4), stoneMat);
    batt.position.set(i, -0.85, 0);
    g.add(batt);
  }

  // Central keep
  const keep = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 4, 12), accentMat);
  keep.position.y = 0.4;
  g.add(keep);

  // Main spire (signature pink)
  const mainSpire = new THREE.Mesh(new THREE.ConeGeometry(1, 3.2, 12), spireMat);
  mainSpire.position.y = 4.1;
  g.add(mainSpire);

  // Gold crown ball atop the main spire
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 14), goldMat);
  crown.position.y = 5.85;
  g.add(crown);

  // Side towers (4)
  [[-1.8, 0.4], [1.8, 0.4], [-2.7, -0.5], [2.7, -0.5]].forEach(([x, y]) => {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 2.4, 8), accentMat);
    tower.position.set(x, y, 0);
    g.add(tower);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 8), goldMat);
    spire.position.set(x, y + 1.9, 0);
    g.add(spire);
  });

  // Glowing windows on the keep
  [-0.4, 0.6, 1.6].forEach(y => {
    [-0.25, 0.25].forEach(x => {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.36), windowMat);
      win.position.set(x, y, 0.92);
      g.add(win);
    });
  });

  // Gate glow (entrance)
  const gate = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.4), goldMat);
  gate.position.set(0, -1.45, 0.71);
  g.add(gate);

  // Flag pennants on each spire
  [[-1.8, 2.7], [1.8, 2.7], [0, 5.95]].forEach(([x, y], i) => {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.45, 6),
      new THREE.MeshStandardMaterial({ color: 0xfff5e1 })
    );
    pole.position.set(x, y + 0.2, 0);
    g.add(pole);
    const flagColor = i === 2 ? 0xff5d8f : 0xffd93d;
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.25),
      new THREE.MeshBasicMaterial({ color: flagColor, side: THREE.DoubleSide })
    );
    flag.position.set(x + 0.25, y + 0.3, 0);
    g.add(flag);
  });

  return g;
}
const castle = createCastle();
castle.position.set(0, -3, -11);
castle.scale.setScalar(1.15);
scene.add(castle);

// Spotlight on the castle so its details catch the eye when the camera nears
const castleSpot = new THREE.SpotLight(0xffd9b3, 1.8, 40, Math.PI / 5, 0.4, 1);
castleSpot.position.set(0, 8, 5);
castleSpot.target = castle;
scene.add(castleSpot);
scene.add(castleSpot.target);

// ---------- Star field (instanced points) ----------
function makeStarField(count = 400, spread = 70, depth = -25) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3]     = rand(-spread, spread);
    positions[i * 3 + 1] = rand(-spread, spread);
    positions[i * 3 + 2] = rand(depth, -8);
    const tint = Math.random();
    if (tint < 0.7) {
      colors[i * 3] = 1; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1;
    } else if (tint < 0.9) {
      colors[i * 3] = 1; colors[i * 3 + 1] = 0.85; colors[i * 3 + 2] = 0.24; // gold
    } else {
      colors[i * 3] = 1; colors[i * 3 + 1] = 0.36; colors[i * 3 + 2] = 0.56; // pink
    }
    sizes[i] = rand(0.05, 0.18);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.PointsMaterial({
    vertexColors: true,
    size: 0.13,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  return new THREE.Points(geo, mat);
}
const stars = makeStarField(450, 80, -32);
scene.add(stars);

// ---------- Sparkle particle pool (used on scroll + clicks + RSVP burst) ----------
const SPARKLE_MAX = 220;
const sparkleGeo = new THREE.BufferGeometry();
const sparklePositions = new Float32Array(SPARKLE_MAX * 3);
const sparkleVel = new Float32Array(SPARKLE_MAX * 3);
const sparkleLife = new Float32Array(SPARKLE_MAX);
const sparkleColor = new Float32Array(SPARKLE_MAX * 3);
const sparkleSize = new Float32Array(SPARKLE_MAX);
for (let i = 0; i < SPARKLE_MAX; i++) sparkleLife[i] = 0;
sparkleGeo.setAttribute('position', new THREE.BufferAttribute(sparklePositions, 3));
sparkleGeo.setAttribute('color', new THREE.BufferAttribute(sparkleColor, 3));
sparkleGeo.setAttribute('size', new THREE.BufferAttribute(sparkleSize, 1));

const sparkleMat = new THREE.PointsMaterial({
  size: 0.4,
  vertexColors: true,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  sizeAttenuation: true
});
const sparkles = new THREE.Points(sparkleGeo, sparkleMat);
scene.add(sparkles);

let sparkleHead = 0;
const SPARKLE_PALETTE = [
  [1, 0.85, 0.24],   // gold
  [1, 0.36, 0.56],   // pink
  [1, 1, 1],         // white
  [1, 0.55, 0.26]    // sunset
];
function emitSparkles(count, x = 0, y = 0, z = 5, spread = 4) {
  for (let i = 0; i < count; i++) {
    const idx = sparkleHead;
    sparkleHead = (sparkleHead + 1) % SPARKLE_MAX;
    sparklePositions[idx * 3]     = x + rand(-spread, spread);
    sparklePositions[idx * 3 + 1] = y + rand(-spread * 0.5, spread * 0.5);
    sparklePositions[idx * 3 + 2] = z + rand(-1, 1);
    sparkleVel[idx * 3]     = rand(-0.04, 0.04);
    sparkleVel[idx * 3 + 1] = rand(0.02, 0.12);
    sparkleVel[idx * 3 + 2] = rand(-0.02, 0.02);
    const c = SPARKLE_PALETTE[Math.floor(Math.random() * SPARKLE_PALETTE.length)];
    sparkleColor[idx * 3]     = c[0];
    sparkleColor[idx * 3 + 1] = c[1];
    sparkleColor[idx * 3 + 2] = c[2];
    sparkleSize[idx] = rand(0.2, 0.55);
    sparkleLife[idx] = rand(60, 120);
  }
}

// Confetti-style big burst, used on RSVP success and finale
function confettiBurst() {
  emitSparkles(120, 0, -2, 6, 7);
}

// ---------- Fireworks ----------
// A "burst" emits many sparkles outward from a 3D point, in a paired palette.
// Reuses the same particle pool as the ambient sparkles.
const FIREWORK_PALETTES = [
  [[1.0, 0.85, 0.24], [1, 1, 1]],         // gold + white
  [[1.0, 0.36, 0.56], [1, 0.55, 0.26]],   // pink + sunset
  [[0.55, 0.75, 1],   [1, 1, 1]],         // sky blue + white
  [[1.0, 0.30, 0.30], [1, 0.85, 0.24]],   // red + gold
  [[0.7, 0.5, 1.0],   [1, 0.36, 0.56]]    // lilac + pink
];
function fireworkBurst(x, y, z) {
  const palette = FIREWORK_PALETTES[Math.floor(Math.random() * FIREWORK_PALETTES.length)];
  const count = 64;
  for (let i = 0; i < count; i++) {
    const idx = sparkleHead;
    sparkleHead = (sparkleHead + 1) % SPARKLE_MAX;
    sparklePositions[idx * 3]     = x;
    sparklePositions[idx * 3 + 1] = y;
    sparklePositions[idx * 3 + 2] = z;
    // Spherical outward velocity
    const theta = Math.random() * tau;
    const phi   = (Math.random() - 0.5) * Math.PI;
    const speed = rand(0.10, 0.22);
    sparkleVel[idx * 3]     = Math.cos(theta) * Math.cos(phi) * speed;
    sparkleVel[idx * 3 + 1] = Math.sin(phi) * speed + 0.025; // slight upward bias
    sparkleVel[idx * 3 + 2] = Math.sin(theta) * Math.cos(phi) * speed;
    const c = palette[i % palette.length];
    sparkleColor[idx * 3]     = c[0];
    sparkleColor[idx * 3 + 1] = c[1];
    sparkleColor[idx * 3 + 2] = c[2];
    sparkleSize[idx] = rand(0.32, 0.7);
    sparkleLife[idx] = rand(70, 140);
  }
}

window.confettiBurst = confettiBurst;
window.emitSparkles  = emitSparkles;
window.fireworkBurst = fireworkBurst;

// ---------- Click anywhere → fireworks ----------
// Listens on the document but skips clicks that land on interactive UI so we
// don't fire a burst when the user is just trying to RSVP or click a button.
const NON_FIREWORK_SEL =
  'button, input, textarea, select, a, label, .magic-pass, .boarding-pass, .rsvp-success, .ticket, .map-pin, .star-card, .hidden-mickey';
document.addEventListener('click', (e) => {
  if (e.target.closest(NON_FIREWORK_SEL)) return;
  // Convert viewport pos to a comfortable scene-space depth (z=4)
  const x = ((e.clientX / window.innerWidth) - 0.5) * 18;
  const y = -((e.clientY / window.innerHeight) - 0.5) * 11;
  fireworkBurst(x, y, 4);
});

// ---------- Cursor sparkle trail ----------
let lastCursorEmit = 0;
window.addEventListener('pointermove', (e) => {
  const now = performance.now();
  if (now - lastCursorEmit < 55) return;
  lastCursorEmit = now;
  const x = ((e.clientX / window.innerWidth) - 0.5) * 18;
  const y = -((e.clientY / window.innerHeight) - 0.5) * 11;
  // One small sparkle that lingers near the cursor (pierce-through pool size = OK)
  const idx = sparkleHead;
  sparkleHead = (sparkleHead + 1) % SPARKLE_MAX;
  sparklePositions[idx * 3]     = x;
  sparklePositions[idx * 3 + 1] = y;
  sparklePositions[idx * 3 + 2] = 4;
  sparkleVel[idx * 3]     = rand(-0.01, 0.01);
  sparkleVel[idx * 3 + 1] = rand(0.005, 0.025);
  sparkleVel[idx * 3 + 2] = 0;
  const c = SPARKLE_PALETTE[Math.floor(Math.random() * SPARKLE_PALETTE.length)];
  sparkleColor[idx * 3]     = c[0];
  sparkleColor[idx * 3 + 1] = c[1];
  sparkleColor[idx * 3 + 2] = c[2];
  sparkleSize[idx] = rand(0.18, 0.32);
  sparkleLife[idx] = rand(40, 80);
}, { passive: true });

// ---------- Scroll progress (0..1) ----------
let scrollProgress = 0;
function readScroll() {
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  scrollProgress = Math.min(1, Math.max(0, window.scrollY / max));
  // Notify HUD/main.js
  window.dispatchEvent(new CustomEvent('kingdom:scroll', {
    detail: { progress: scrollProgress, scrollY: window.scrollY }
  }));
}
window.addEventListener('scroll', readScroll, { passive: true });
readScroll();

// Emit sparkles occasionally as user scrolls
let lastScrollEmit = 0;
let lastY = window.scrollY;
window.addEventListener('scroll', () => {
  const now = performance.now();
  const dy = Math.abs(window.scrollY - lastY);
  if (now - lastScrollEmit > 90 && dy > 8) {
    emitSparkles(2, rand(-6, 6), rand(-4, 4), rand(2, 6), 0.5);
    lastScrollEmit = now;
  }
  lastY = window.scrollY;
}, { passive: true });

// ---------- Pointer parallax ----------
let mouseX = 0, mouseY = 0;
window.addEventListener('pointermove', (e) => {
  mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
  mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
}, { passive: true });

// ---------- Resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Animation loop ----------
const tmpColor = new THREE.Color();
const skyTopColors = [
  new THREE.Color('#0a0c2a'), // gates
  new THREE.Color('#221a5e'), // cast
  new THREE.Color('#3a1a6e'), // map
  new THREE.Color('#5b1e84'), // countdown
  new THREE.Color('#8a2470')  // rsvp
];

const clock = new THREE.Clock();
let nextFirework = 3 + Math.random() * 4;  // first auto-burst seeds the show

function animate() {
  const dt = clock.getDelta();
  const t = clock.getElapsedTime();

  // ---- Auto-firework: random burst every 5–10 seconds ----
  if (t > nextFirework) {
    fireworkBurst(rand(-9, 9), rand(0.5, 5), rand(2, 6));
    nextFirework = t + rand(5, 10);
  }

  // ---- Castle sway (gentle parallax of its own) ----
  castle.rotation.y = Math.sin(t * 0.15) * 0.18;
  castle.position.y = -3 + Math.sin(t * 0.22) * 0.15;

  // Camera dolly: gently move forward and slightly up as user scrolls
  const targetZ = 22 - scrollProgress * 14;       // 22 → 8
  const targetY = -scrollProgress * 4;            // 0 → -4
  camera.position.z += (targetZ - camera.position.z) * 0.06;
  camera.position.y += (targetY - camera.position.y) * 0.06;
  // mouse parallax (subtle)
  camera.position.x += (mouseX * 0.6 - camera.position.x) * 0.04;
  camera.lookAt(0, camera.position.y * 0.4, 0);

  // Fog color shifts with scroll progress
  const segs = skyTopColors.length - 1;
  const f = scrollProgress * segs;
  const i0 = Math.min(segs, Math.floor(f));
  const i1 = Math.min(segs, i0 + 1);
  const frac = f - i0;
  tmpColor.copy(skyTopColors[i0]).lerp(skyTopColors[i1], frac);
  scene.fog.color.copy(tmpColor);

  // Mickeys: spin + bob
  for (const m of mickeys) {
    const u = m.userData;
    m.rotation.x += u.spinX;
    m.rotation.y += u.spinY;
    m.position.y = u.yBase + Math.sin(t * u.floatSpeed + u.floatPhase) * u.floatAmp;
  }

  // Balloons: rise & sway, wrap when off the top
  for (const b of balloons) {
    const u = b.userData;
    b.position.y += u.riseSpeed * 60 * dt;
    b.position.x += Math.sin(t * u.swaySpeed + u.swayPhase) * 0.005;
    b.rotation.z = Math.sin(t * u.swaySpeed + u.swayPhase) * 0.08;
    if (b.position.y > 32) {
      b.position.y = -32;
      b.position.x = rand(-20, 20);
    }
  }

  // Stars: drift slowly + scroll parallax
  stars.rotation.z = t * 0.005;
  stars.position.y = -scrollProgress * 6;

  // Sparkles tick
  for (let i = 0; i < SPARKLE_MAX; i++) {
    if (sparkleLife[i] <= 0) {
      sparkleSize[i] = 0;
      continue;
    }
    sparkleLife[i] -= 1;
    sparklePositions[i * 3]     += sparkleVel[i * 3];
    sparklePositions[i * 3 + 1] += sparkleVel[i * 3 + 1];
    sparklePositions[i * 3 + 2] += sparkleVel[i * 3 + 2];
    // gravity-ish slowdown
    sparkleVel[i * 3 + 1] *= 0.985;
  }
  sparkleGeo.attributes.position.needsUpdate = true;
  sparkleGeo.attributes.color.needsUpdate = true;
  sparkleGeo.attributes.size.needsUpdate = true;

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// Initial sparkle to welcome the user
setTimeout(() => emitSparkles(30, 0, -2, 6, 6), 400);
