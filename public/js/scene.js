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
window.confettiBurst = confettiBurst;
window.emitSparkles  = emitSparkles;

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

function animate() {
  const dt = clock.getDelta();
  const t = clock.getElapsedTime();

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
