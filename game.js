// ============ GAME CONFIG ============
const TICK_POINTS = 10;
const MAX_DEAD_DEER = 3;

// Difficulty presets
const DIFFICULTY = {
  easy: {
    winScore: 300,
    deerCount: 3,
    maxTicksOnDeer: 4,
    baseTickSpeed: 0.8,
    baseSpawnInterval: 2200,
    minSpawnInterval: 600,
    speedIncreasePer50: 0.10,
    spawnDecreasePer50: 100,
    doubleSpawnThreshold: 4,   // difficulty level (score/50) to start double spawns
    doubleSpawnChance: 0.2,
    tripleSpawnThreshold: 999, // effectively never
    tripleSpawnChance: 0,
    deerMarginPortrait: 0.22,
    deerMarginLandscape: 0.18,
    hitBonusMobile: 30,
    hitBonusDesktop: 18,
    label: 'Easy 🌿',
  },
  normal: {
    winScore: 500,
    deerCount: 5,
    maxTicksOnDeer: 3,
    baseTickSpeed: 1.0,
    baseSpawnInterval: 2000,
    minSpawnInterval: 400,
    speedIncreasePer50: 0.15,
    spawnDecreasePer50: 120,
    doubleSpawnThreshold: 3,
    doubleSpawnChance: 0.3,
    tripleSpawnThreshold: 6,
    tripleSpawnChance: 0.3,
    deerMarginPortrait: 0.18,
    deerMarginLandscape: 0.15,
    hitBonusMobile: 25,
    hitBonusDesktop: 12,
    label: 'Normal 🦌',
  },
  hard: {
    winScore: 800,
    deerCount: 6,
    maxTicksOnDeer: 2,
    baseTickSpeed: 1.3,
    baseSpawnInterval: 1600,
    minSpawnInterval: 350,
    speedIncreasePer50: 0.22,
    spawnDecreasePer50: 100,
    doubleSpawnThreshold: 2,
    doubleSpawnChance: 0.4,
    tripleSpawnThreshold: 4,
    tripleSpawnChance: 0.35,
    deerMarginPortrait: 0.12,
    deerMarginLandscape: 0.10,
    hitBonusMobile: 18,
    hitBonusDesktop: 8,
    label: 'Hard 🔥',
  }
};

let currentDifficulty = 'normal';
function cfg() { return DIFFICULTY[currentDifficulty]; }

// ============ GLOBALS ============
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let W, H, DPR;
let isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

let score = 0;
let deadDeerCount = 0;
let gameRunning = false;
let animFrameId = null;
let spawnTimer = null;
let mouseX = -100, mouseY = -100;
let lastTouchTime = 0;
let showCursor = !isMobile; // hide cursor on mobile until touch

let deer = [];
let ticks = [];
let particles = [];
let swatEffects = [];

// Ania character image
const aniaImg = new Image();
aniaImg.src = 'assets/ania.png';

// ============ RESPONSIVE SCALE ============
// Returns a scale factor so game elements look right on any screen
function getGameScale() {
  const baseWidth = 1024;
  const s = Math.max(0.55, Math.min(1.4, W / baseWidth));
  return s;
}

// ============ AUDIO (procedural via Web Audio API) ============
let audioCtx = null;
let audioUnlocked = false;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Unlock audio on first user interaction (required on mobile)
function unlockAudio() {
  if (audioUnlocked) return;
  ensureAudio();
  // Play a silent buffer to unlock
  const buf = audioCtx.createBuffer(1, 1, 22050);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  src.start(0);
  audioUnlocked = true;
}

function playSwatHit() {
  ensureAudio();
  const t = audioCtx.currentTime;
  // Short punchy noise burst + pitch drop
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(800, t);
  osc.frequency.exponentialRampToValueAtTime(150, t + 0.1);
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.12);

  // Add a noise pop
  const bufSize = audioCtx.sampleRate * 0.05;
  const noiseBuf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
  const noiseSrc = audioCtx.createBufferSource();
  const noiseGain = audioCtx.createGain();
  noiseSrc.buffer = noiseBuf;
  noiseGain.gain.setValueAtTime(0.2, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  noiseSrc.connect(noiseGain);
  noiseGain.connect(audioCtx.destination);
  noiseSrc.start(t);
}

function playSwatMiss() {
  ensureAudio();
  const t = audioCtx.currentTime;
  // Quick whoosh
  const bufSize = audioCtx.sampleRate * 0.08;
  const noiseBuf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) {
    const env = Math.sin((i / bufSize) * Math.PI);
    data[i] = (Math.random() * 2 - 1) * env * 0.5;
  }
  const src = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2000, t);
  filter.frequency.exponentialRampToValueAtTime(500, t + 0.08);
  filter.Q.value = 1;
  src.buffer = noiseBuf;
  gain.gain.setValueAtTime(0.12, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  src.start(t);
}

function playTickBite() {
  ensureAudio();
  const t = audioCtx.currentTime;
  // Unpleasant squelch
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, t);
  osc.frequency.exponentialRampToValueAtTime(80, t + 0.2);
  gain.gain.setValueAtTime(0.15, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + 0.25);
}

function playDeerDeath() {
  ensureAudio();
  const t = audioCtx.currentTime;
  // Sad descending tone
  [0, 0.15, 0.3].forEach((offset, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime([440, 350, 260][i], t + offset);
    gain.gain.setValueAtTime(0.18, t + offset);
    gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.2);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.2);
  });
}

function playGameOver() {
  ensureAudio();
  const t = audioCtx.currentTime;
  // Dramatic low descending tones
  const notes = [300, 250, 200, 130];
  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t + i * 0.25);
    gain.gain.setValueAtTime(0.15, t + i * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.25 + 0.3);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t + i * 0.25);
    osc.stop(t + i * 0.25 + 0.3);
  });
}

function playWinJingle() {
  ensureAudio();
  const t = audioCtx.currentTime;
  // Happy ascending melody
  const notes = [523, 587, 659, 698, 784, 880, 988, 1047];
  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    const start = t + i * 0.12;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.18, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + 0.2);
  });
  // Final chord
  const chordTime = t + notes.length * 0.12;
  [523, 659, 784, 1047].forEach(freq => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, chordTime);
    gain.gain.setValueAtTime(0.12, chordTime);
    gain.gain.exponentialRampToValueAtTime(0.001, chordTime + 0.8);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(chordTime);
    osc.stop(chordTime + 0.8);
  });
}

// ============ RESIZE ============
function resize() {
  DPR = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ============ DRAWING HELPERS ============
function drawForestBackground() {
  // Adapt horizon to aspect ratio: tall screens get less sky
  const isPortrait = H > W;
  const horizon = isPortrait ? 0.35 : 0.6;
  const treeRowBack = horizon - 0.18;
  const treeRowMid = horizon - 0.10;

  // Sky gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
  skyGrad.addColorStop(0, '#87CEEB');
  skyGrad.addColorStop(Math.max(0.15, horizon - 0.25), '#a8d8ea');
  skyGrad.addColorStop(horizon, '#6db36d');
  skyGrad.addColorStop(1, '#3a7d2c');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // Sun (smaller on portrait)
  const sunR = isPortrait ? 28 : 40;
  ctx.beginPath();
  ctx.arc(W * 0.85, H * 0.08, sunR, 0, Math.PI * 2);
  ctx.fillStyle = '#FFD700';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(W * 0.85, H * 0.08, sunR * 1.4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,215,0,0.15)';
  ctx.fill();

  // Background trees
  for (let i = 0; i < 12; i++) {
    drawTree(W * (i / 12) + 30, H * treeRowBack, 0.6 + Math.sin(i) * 0.15, '#2d5a27');
  }
  // Midground trees
  for (let i = 0; i < 8; i++) {
    drawTree(W * (i / 8) + 60, H * treeRowMid, 0.9 + Math.cos(i * 2) * 0.2, '#3a7d2c');
  }

  // Ground
  ctx.fillStyle = '#4a7c3f';
  ctx.fillRect(0, H * horizon, W, H * (1 - horizon));

  // Grass tufts
  ctx.strokeStyle = '#5a9c4f';
  ctx.lineWidth = 2;
  for (let i = 0; i < 60; i++) {
    const gx = (i / 60) * W + Math.sin(i * 7) * 20;
    const gy = H * (horizon + 0.02) + Math.abs(Math.sin(i * 3)) * (H * (0.95 - horizon));
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx - 4, gy - 12);
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + 4, gy - 10);
    ctx.stroke();
  }

  // Flowers
  const flowerColors = ['#ff6b9d', '#ffd93d', '#fff', '#c9b1ff'];
  for (let i = 0; i < 25; i++) {
    const fx = (i / 25) * W + Math.sin(i * 5) * 30;
    const fy = H * (horizon + 0.05) + Math.abs(Math.cos(i * 4)) * (H * (0.90 - horizon));
    ctx.beginPath();
    ctx.arc(fx, fy, 3, 0, Math.PI * 2);
    ctx.fillStyle = flowerColors[i % flowerColors.length];
    ctx.fill();
  }
}

function drawTree(x, y, scale, color) {
  ctx.fillStyle = '#5a3a1a';
  ctx.fillRect(x - 5 * scale, y, 10 * scale, 40 * scale);
  ctx.beginPath();
  ctx.moveTo(x, y - 50 * scale);
  ctx.lineTo(x - 30 * scale, y + 10);
  ctx.lineTo(x + 30 * scale, y + 10);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y - 75 * scale);
  ctx.lineTo(x - 22 * scale, y - 15 * scale);
  ctx.lineTo(x + 22 * scale, y - 15 * scale);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}


// ============ DEER ============
function createDeer() {
  deer = [];
  const gs = getGameScale();
  const isPortrait = H > W;
  const count = W < 500 ? Math.min(3, cfg().deerCount) : cfg().deerCount;
  const horizon = isPortrait ? 0.35 : 0.6;
  // Deer graze from just below the treeline to near the bottom
  const groundTop = H * (horizon + 0.05);
  const groundBottom = H * 0.92;
  // Pull deer inward so side deer aren't at the very edge
  const marginX = isPortrait ? cfg().deerMarginPortrait : cfg().deerMarginLandscape;
  for (let i = 0; i < count; i++) {
    deer.push({
      x: W * marginX + (W * (1 - 2 * marginX)) * (i / (count - 1)) + (Math.random() - 0.5) * 20 * gs,
      y: groundTop + Math.random() * (groundBottom - groundTop),
      ticksOnMe: 0,
      alive: true,
      bobOffset: Math.random() * Math.PI * 2,
      size: (0.9 + Math.random() * 0.3) * gs
    });
  }
  // Sort by y for depth
  deer.sort((a, b) => a.y - b.y);
}

function drawDeer(d, time) {
  const s = d.size;
  const bob = Math.sin(time / 600 + d.bobOffset) * 3;

  if (!d.alive) {
    // Monument: grey stone deer silhouette
    ctx.save();
    ctx.translate(d.x, d.y + bob * 0.2);
    ctx.globalAlpha = 0.7;
    // Stone base
    ctx.fillStyle = '#888';
    ctx.fillRect(-15 * s, -2, 30 * s, 6);
    // Body
    ctx.fillStyle = '#999';
    ctx.beginPath();
    ctx.ellipse(0, -22 * s, 20 * s, 14 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.beginPath();
    ctx.arc(18 * s, -35 * s, 9 * s, 0, Math.PI * 2);
    ctx.fill();
    // Legs
    ctx.fillRect(-12 * s, -10 * s, 5 * s, 14 * s);
    ctx.fillRect(6 * s, -10 * s, 5 * s, 14 * s);
    // X eyes
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(15*s, -37*s); ctx.lineTo(19*s, -33*s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(19*s, -37*s); ctx.lineTo(15*s, -33*s); ctx.stroke();
    // RIP text
    ctx.fillStyle = '#555';
    ctx.font = `${12 * s}px serif`;
    ctx.textAlign = 'center';
    ctx.fillText('RIP', 0, -42 * s);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.translate(d.x, d.y + bob);

  // Body
  ctx.fillStyle = '#c4884d';
  ctx.beginPath();
  ctx.ellipse(0, -22 * s, 22 * s, 15 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // White belly spots
  ctx.fillStyle = '#e8d5b7';
  ctx.beginPath();
  ctx.ellipse(0, -17 * s, 14 * s, 8 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Spots on back
  ctx.fillStyle = '#f5e6d0';
  for (let sp = 0; sp < 4; sp++) {
    ctx.beginPath();
    ctx.arc((-8 + sp * 6) * s, (-28 + (sp % 2) * 4) * s, 2.5 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Legs
  ctx.fillStyle = '#a06830';
  const legKick = Math.sin(time / 300 + d.bobOffset) * 2;
  ctx.fillRect(-14 * s, -10 * s, 5 * s, 16 * s + legKick);
  ctx.fillRect(-4 * s, -10 * s, 5 * s, 15 * s - legKick);
  ctx.fillRect(5 * s, -10 * s, 5 * s, 16 * s + legKick);
  ctx.fillRect(11 * s, -10 * s, 5 * s, 15 * s - legKick);

  // Hooves
  ctx.fillStyle = '#4a3520';
  ctx.fillRect(-14*s, 5*s + legKick, 5*s, 3*s);
  ctx.fillRect(-4*s, 4*s - legKick, 5*s, 3*s);
  ctx.fillRect(5*s, 5*s + legKick, 5*s, 3*s);
  ctx.fillRect(11*s, 4*s - legKick, 5*s, 3*s);

  // Tail
  ctx.fillStyle = '#e8d5b7';
  ctx.beginPath();
  ctx.ellipse(-22 * s, -26 * s, 5 * s, 3 * s, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // Neck
  ctx.fillStyle = '#c4884d';
  ctx.beginPath();
  ctx.moveTo(14 * s, -30 * s);
  ctx.lineTo(22 * s, -48 * s);
  ctx.lineTo(26 * s, -44 * s);
  ctx.lineTo(18 * s, -26 * s);
  ctx.closePath();
  ctx.fill();

  // Head
  ctx.beginPath();
  ctx.ellipse(22 * s, -52 * s, 10 * s, 8 * s, 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Snout
  ctx.fillStyle = '#d4a06a';
  ctx.beginPath();
  ctx.ellipse(30 * s, -49 * s, 5 * s, 4 * s, 0.1, 0, Math.PI * 2);
  ctx.fill();

  // Nose
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.ellipse(34 * s, -49 * s, 2 * s, 1.5 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eye
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(25 * s, -54 * s, 2.5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(25.8 * s, -55 * s, 1 * s, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.fillStyle = '#c4884d';
  ctx.beginPath();
  ctx.ellipse(16 * s, -60 * s, 4 * s, 7 * s, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(26 * s, -62 * s, 4 * s, 7 * s, 0.3, 0, Math.PI * 2);
  ctx.fill();
  // Inner ears
  ctx.fillStyle = '#e8b8a0';
  ctx.beginPath();
  ctx.ellipse(16 * s, -60 * s, 2 * s, 4 * s, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(26 * s, -62 * s, 2 * s, 4 * s, 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Antlers
  ctx.strokeStyle = '#5a3a1a';
  ctx.lineWidth = 2.5 * s;
  ctx.lineCap = 'round';
  // Left antler
  ctx.beginPath();
  ctx.moveTo(18 * s, -62 * s);
  ctx.lineTo(12 * s, -78 * s);
  ctx.lineTo(8 * s, -72 * s);
  ctx.moveTo(12 * s, -78 * s);
  ctx.lineTo(16 * s, -85 * s);
  ctx.stroke();
  // Right antler
  ctx.beginPath();
  ctx.moveTo(26 * s, -64 * s);
  ctx.lineTo(32 * s, -80 * s);
  ctx.lineTo(36 * s, -74 * s);
  ctx.moveTo(32 * s, -80 * s);
  ctx.lineTo(28 * s, -87 * s);
  ctx.stroke();

  // Tick damage indicator
  if (d.ticksOnMe > 0) {
    ctx.fillStyle = 'rgba(255,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, -22 * s, 24 * s, 17 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff0000';
    ctx.font = `bold ${14 * s}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('🩸'.repeat(d.ticksOnMe), 0, -40 * s);
  }

  ctx.restore();
}


// ============ TICKS ============
function spawnTick() {
  if (!gameRunning) return;

  // Pick a random alive deer as target
  const aliveDeer = deer.filter(d => d.alive);
  if (aliveDeer.length === 0) return;
  const target = aliveDeer[Math.floor(Math.random() * aliveDeer.length)];

  // Spawn from edges
  const side = Math.floor(Math.random() * 4);
  let sx, sy;
  if (side === 0) { sx = -30; sy = Math.random() * H; }
  else if (side === 1) { sx = W + 30; sy = Math.random() * H; }
  else if (side === 2) { sx = Math.random() * W; sy = -30; }
  else { sx = Math.random() * W; sy = H + 30; }

  const difficultyLevel = Math.floor(score / 50);
  const speed = cfg().baseTickSpeed + difficultyLevel * cfg().speedIncreasePer50;
  const gs = getGameScale();

  ticks.push({
    x: sx, y: sy,
    targetDeer: target,
    speed: speed,
    size: (18 + Math.random() * 8) * gs,
    angle: 0,
    legPhase: Math.random() * Math.PI * 2,
    alive: true
  });
}

function updateTicks(dt) {
  for (let i = ticks.length - 1; i >= 0; i--) {
    const t = ticks[i];
    if (!t.alive) { ticks.splice(i, 1); continue; }

    // If target deer is dead, retarget
    if (!t.targetDeer.alive) {
      const aliveDeer = deer.filter(d => d.alive);
      if (aliveDeer.length === 0) { ticks.splice(i, 1); continue; }
      t.targetDeer = aliveDeer[Math.floor(Math.random() * aliveDeer.length)];
    }

    const dx = t.targetDeer.x - t.x;
    const dy = t.targetDeer.y - t.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    t.angle = Math.atan2(dy, dx);

    if (dist < 20) {
      // Tick reached deer!
      t.targetDeer.ticksOnMe++;
      playTickBite();
      if (t.targetDeer.ticksOnMe >= cfg().maxTicksOnDeer) {
        t.targetDeer.alive = false;
        deadDeerCount++;
        document.getElementById('deerLost').textContent = deadDeerCount;
        playDeerDeath();
        // Spawn sad particles
        for (let p = 0; p < 15; p++) {
          particles.push({
            x: t.targetDeer.x, y: t.targetDeer.y - 30,
            vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 3 - 1,
            life: 60, maxLife: 60, color: '#888', text: '💀'
          });
        }
        if (deadDeerCount >= MAX_DEAD_DEER) {
          endGame(false);
        }
      }
      ticks.splice(i, 1);
      continue;
    }

    t.x += (dx / dist) * t.speed * (dt / 16);
    t.y += (dy / dist) * t.speed * (dt / 16);
    t.legPhase += 0.15;
  }
}

function drawTick(t, time) {
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.angle + Math.PI / 2);

  const s = t.size / 20;

  // Legs (8 legs, 4 per side)
  ctx.strokeStyle = '#2a1a0a';
  ctx.lineWidth = 2 * s;
  for (let leg = 0; leg < 4; leg++) {
    const legY = (-8 + leg * 5) * s;
    const wiggle = Math.sin(t.legPhase + leg * 0.8) * 4 * s;
    // Left legs
    ctx.beginPath();
    ctx.moveTo(-6 * s, legY);
    ctx.lineTo(-16 * s + wiggle, legY - 3 * s);
    ctx.stroke();
    // Right legs
    ctx.beginPath();
    ctx.moveTo(6 * s, legY);
    ctx.lineTo(16 * s - wiggle, legY - 3 * s);
    ctx.stroke();
  }

  // Body (oval)
  ctx.fillStyle = '#3d2b1f';
  ctx.beginPath();
  ctx.ellipse(0, 0, 8 * s, 12 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body pattern
  ctx.fillStyle = '#5a3d2b';
  ctx.beginPath();
  ctx.ellipse(0, -2 * s, 5 * s, 7 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Shield/scutum marking
  ctx.fillStyle = '#4a3020';
  ctx.beginPath();
  ctx.ellipse(0, -6 * s, 4 * s, 3 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = '#2a1a0a';
  ctx.beginPath();
  ctx.ellipse(0, -13 * s, 4 * s, 4 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Pincers/mouthparts
  ctx.strokeStyle = '#1a0a00';
  ctx.lineWidth = 1.5 * s;
  ctx.beginPath();
  ctx.moveTo(-2 * s, -16 * s);
  ctx.lineTo(-3 * s, -20 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(2 * s, -16 * s);
  ctx.lineTo(3 * s, -20 * s);
  ctx.stroke();

  // Evil red eyes
  ctx.fillStyle = '#ff0000';
  ctx.beginPath();
  ctx.arc(-2 * s, -14 * s, 1.2 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(2 * s, -14 * s, 1.2 * s, 0, Math.PI * 2);
  ctx.fill();

  // Danger glow
  ctx.shadowColor = 'rgba(255,0,0,0.3)';
  ctx.shadowBlur = 10 * s;

  ctx.restore();
}


// ============ SWAT / INPUT ============
function handleSwat(px, py) {
  if (!gameRunning || winTransitionActive) return;
  // Bigger hit area on mobile for fat fingers
  const hitBonus = isMobile ? cfg().hitBonusMobile : cfg().hitBonusDesktop;
  for (let i = ticks.length - 1; i >= 0; i--) {
    const t = ticks[i];
    const dx = t.x - px;
    const dy = t.y - py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < t.size + hitBonus) {
      // Swatted!
      t.alive = false;
      score += TICK_POINTS;
      playSwatHit();
      document.getElementById('scoreDisplay').textContent = score;

      // Splat particles
      for (let p = 0; p < 10; p++) {
        particles.push({
          x: t.x, y: t.y,
          vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6,
          life: 30, maxLife: 30, color: '#3d2b1f', text: null
        });
      }
      swatEffects.push({ x: t.x, y: t.y, life: 20, maxLife: 20 });

      // Check win
      if (score >= cfg().winScore) {
        startWinTransition();
      }
      return; // Only swat one tick per tap
    }
  }
  // Miss effect
  playSwatMiss();
  swatEffects.push({ x: px, y: py, life: 10, maxLife: 10 });
}

canvas.addEventListener('mousedown', (e) => {
  if (isMobile) return; // avoid ghost clicks on mobile
  handleSwat(e.clientX, e.clientY);
});
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  lastTouchTime = Date.now();
  showCursor = true;
  for (const touch of e.changedTouches) {
    mouseX = touch.clientX;
    mouseY = touch.clientY;
    handleSwat(touch.clientX, touch.clientY);
  }
}, { passive: false });

canvas.addEventListener('mousemove', (e) => {
  if (isMobile) return;
  mouseX = e.clientX; mouseY = e.clientY;
  showCursor = true;
});
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length > 0) {
    mouseX = e.touches[0].clientX;
    mouseY = e.touches[0].clientY;
  }
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  // Fade cursor away after a short delay on mobile
  setTimeout(() => {
    if (Date.now() - lastTouchTime > 800) showCursor = false;
  }, 900);
}, { passive: false });

// Prevent iOS Safari pull-to-refresh and pinch zoom
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });

// Handle orientation change
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    resize();
    if (gameRunning) createDeer();
  }, 300);
});

// ============ PARTICLES ============
function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.1;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = swatEffects.length - 1; i >= 0; i--) {
    swatEffects[i].life--;
    if (swatEffects[i].life <= 0) swatEffects.splice(i, 1);
  }
}

function drawParticles() {
  for (const p of particles) {
    const alpha = p.life / p.maxLife;
    if (p.text) {
      ctx.globalAlpha = alpha;
      ctx.font = `${Math.round(16 * getGameScale())}px sans-serif`;
      ctx.fillText(p.text, p.x, p.y);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 * getGameScale(), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  const gs = getGameScale();
  for (const s of swatEffects) {
    const alpha = s.life / s.maxLife;
    const radius = ((1 - alpha) * 30 + 10) * gs;
    ctx.strokeStyle = `rgba(255, 100, 0, ${alpha})`;
    ctx.lineWidth = 3 * gs;
    ctx.beginPath();
    ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    // SWAT text
    ctx.fillStyle = `rgba(255, 50, 0, ${alpha})`;
    ctx.font = `bold ${Math.round((16 + (1 - alpha) * 10) * gs)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('SWAT!', s.x, s.y - radius - 5 * gs);
  }
}

// ============ ANIA CURSOR ============
function drawAnia() {
  if (!showCursor) return;
  const gs = getGameScale();
  const size = Math.round(50 * gs);
  if (aniaImg.complete && aniaImg.naturalWidth > 0) {
    ctx.save();
    // Draw circular avatar
    ctx.beginPath();
    ctx.arc(mouseX, mouseY - 30 * gs, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(aniaImg, mouseX - size / 2, mouseY - 30 * gs - size / 2, size, size);
    ctx.restore();
    // Border
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mouseX, mouseY - 30 * gs, size / 2 + 1, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Fallback: draw a hand
    ctx.font = `${Math.round(36 * gs)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('🖐️', mouseX, mouseY);
  }
  // Swatter below avatar
  ctx.save();
  ctx.translate(mouseX, mouseY);
  const sw = gs; // swatter scale
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(-2 * sw, -5 * sw, 4 * sw, 25 * sw);
  ctx.fillStyle = '#d44';
  ctx.beginPath();
  ctx.ellipse(0, 22 * sw, 14 * sw, 10 * sw, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#a00';
  ctx.lineWidth = 1.5 * sw;
  // Grid on swatter
  ctx.beginPath();
  ctx.moveTo(-10 * sw, 22 * sw); ctx.lineTo(10 * sw, 22 * sw);
  ctx.moveTo(-8 * sw, 17 * sw); ctx.lineTo(8 * sw, 17 * sw);
  ctx.moveTo(-8 * sw, 27 * sw); ctx.lineTo(8 * sw, 27 * sw);
  ctx.moveTo(-3 * sw, 13 * sw); ctx.lineTo(-3 * sw, 31 * sw);
  ctx.moveTo(3 * sw, 13 * sw); ctx.lineTo(3 * sw, 31 * sw);
  ctx.stroke();
  ctx.restore();
}


// ============ GAME LOOP ============
let lastTime = 0;
function gameLoop(timestamp) {
  if (!gameRunning) return;
  const dt = timestamp - lastTime || 16;
  lastTime = timestamp;

  ctx.clearRect(0, 0, W, H);
  drawForestBackground();

  // Draw deer
  for (const d of deer) {
    drawDeer(d, timestamp);
  }

  // Update & draw ticks
  updateTicks(dt);
  for (const t of ticks) {
    drawTick(t, timestamp);
  }

  // Particles
  updateParticles();
  drawParticles();

  // Ania cursor
  drawAnia();

  animFrameId = requestAnimationFrame(gameLoop);
}

// ============ SPAWN TIMER ============
function startSpawning() {
  function scheduleNext() {
    if (!gameRunning) return;
    const difficultyLevel = Math.floor(score / 50);
    const interval = Math.max(cfg().minSpawnInterval, cfg().baseSpawnInterval - difficultyLevel * cfg().spawnDecreasePer50);
    spawnTimer = setTimeout(() => {
      spawnTick();
      // Occasionally spawn extra ticks at higher difficulty
      if (difficultyLevel >= cfg().doubleSpawnThreshold && Math.random() < cfg().doubleSpawnChance) spawnTick();
      if (difficultyLevel >= cfg().tripleSpawnThreshold && Math.random() < cfg().tripleSpawnChance) spawnTick();
      scheduleNext();
    }, interval);
  }
  scheduleNext();
}

// ============ START / END ============
function startGame() {
  unlockAudio();
  score = 0;
  deadDeerCount = 0;
  ticks = [];
  particles = [];
  swatEffects = [];
  winTransitionActive = false;
  document.getElementById('scoreDisplay').textContent = '0';
  document.getElementById('winScoreDisplay').textContent = cfg().winScore;
  document.getElementById('deerLost').textContent = '0';
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('gameOverScreen').style.display = 'none';
  document.getElementById('winScreen').style.display = 'none';
  document.getElementById('hud').style.display = 'flex';

  resize();
  createDeer();
  gameRunning = true;
  lastTime = 0;
  animFrameId = requestAnimationFrame(gameLoop);
  startSpawning();
}

// ============ WIN TRANSITION (purification aura) ============
let winTransitionActive = false;
let winTransitionStart = 0;
const WIN_TRANSITION_DURATION = 2800; // ms

function startWinTransition() {
  // Stop spawning and disable further input
  if (spawnTimer) clearTimeout(spawnTimer);
  winTransitionActive = true;
  winTransitionStart = performance.now();
  gameRunning = false; // stops normal game loop

  // Play a power-up sound: ascending shimmer
  playPurificationSound();

  // Run the transition animation loop
  requestAnimationFrame(winTransitionLoop);
}

function playPurificationSound() {
  ensureAudio();
  const t = audioCtx.currentTime;
  // Shimmering ascending tones
  const notes = [392, 440, 523, 587, 659, 784, 880, 1047, 1175, 1319];
  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    const start = t + i * 0.1;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.12, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + 0.35);
  });
  // Sustained warm chord at the end
  const chordStart = t + notes.length * 0.1;
  [523, 659, 784, 1047].forEach(freq => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, chordStart);
    gain.gain.setValueAtTime(0.1, chordStart);
    gain.gain.linearRampToValueAtTime(0.08, chordStart + 1.0);
    gain.gain.exponentialRampToValueAtTime(0.001, chordStart + 1.8);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(chordStart);
    osc.stop(chordStart + 1.8);
  });
}

function winTransitionLoop(timestamp) {
  const elapsed = timestamp - winTransitionStart;
  const progress = Math.min(elapsed / WIN_TRANSITION_DURATION, 1);

  ctx.clearRect(0, 0, W, H);
  drawForestBackground();

  const gs = getGameScale();
  const centerX = W / 2;
  const centerY = H * 0.45;

  // Aura radius expands to cover the whole screen
  const maxRadius = Math.sqrt(W * W + H * H);
  const auraRadius = progress * maxRadius;

  // Phase 1 (0-30%): Ania moves to center and grows
  // Phase 2 (15-90%): Aura expands, kills ticks, heals deer
  // Phase 3 (80-100%): Flash and fade to white

  // --- Kill ticks caught by the aura ---
  for (let i = ticks.length - 1; i >= 0; i--) {
    const t = ticks[i];
    if (!t.alive) continue;
    const dx = t.x - centerX;
    const dy = t.y - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < auraRadius) {
      t.alive = false;
      // Golden vaporize particles
      for (let p = 0; p < 8; p++) {
        particles.push({
          x: t.x, y: t.y,
          vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 5,
          life: 40, maxLife: 40, color: '#ffd700', text: null
        });
      }
      particles.push({
        x: t.x, y: t.y - 10,
        vx: 0, vy: -1.5,
        life: 50, maxLife: 50, color: '#ffd700', text: '✨'
      });
    }
  }
  // Remove dead ticks
  ticks = ticks.filter(t => t.alive);

  // --- Heal deer caught by the aura ---
  for (const d of deer) {
    if (!d.alive || d.ticksOnMe === 0) continue;
    const dx = d.x - centerX;
    const dy = d.y - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < auraRadius && d.ticksOnMe > 0) {
      d.ticksOnMe = 0;
      // Green healing sparkles
      for (let p = 0; p < 10; p++) {
        particles.push({
          x: d.x + (Math.random() - 0.5) * 30, y: d.y - 20 + (Math.random() - 0.5) * 20,
          vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 2 - 1,
          life: 45, maxLife: 45, color: '#4ade80', text: null
        });
      }
      particles.push({
        x: d.x, y: d.y - 40,
        vx: 0, vy: -1,
        life: 55, maxLife: 55, color: '#4ade80', text: '💚'
      });
    }
  }

  // --- Draw deer ---
  for (const d of deer) {
    drawDeer(d, timestamp);
  }

  // --- Draw remaining ticks ---
  for (const t of ticks) {
    drawTick(t, timestamp);
  }

  // --- Update & draw particles ---
  updateParticles();
  drawParticles();

  // --- Draw the expanding golden aura ---
  if (progress < 0.9) {
    const auraAlpha = 0.25 * (1 - progress);
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, auraRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 215, 0, ${auraAlpha + 0.2})`;
    ctx.lineWidth = 6 * gs;
    ctx.stroke();
    // Inner glow fill
    const grad = ctx.createRadialGradient(centerX, centerY, auraRadius * 0.7, centerX, centerY, auraRadius);
    grad.addColorStop(0, `rgba(255, 215, 0, 0)`);
    grad.addColorStop(1, `rgba(255, 215, 0, ${auraAlpha})`);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  // --- Draw Ania at center, growing ---
  const aniaProgress = Math.min(progress / 0.3, 1); // fully grown by 30%
  const aniaScale = 1 + aniaProgress * 2.5; // grows to 3.5x
  const aniaSize = Math.round(50 * gs * aniaScale);
  const aniaAlpha = progress < 0.85 ? 1 : Math.max(0, 1 - (progress - 0.85) / 0.15);

  // Ania moves from last cursor position to center
  const aniaX = mouseX + (centerX - mouseX) * Math.min(aniaProgress * 1.5, 1);
  const aniaY = (mouseY - 30 * gs) + (centerY - (mouseY - 30 * gs)) * Math.min(aniaProgress * 1.5, 1);

  ctx.save();
  ctx.globalAlpha = aniaAlpha;

  // Golden glow behind Ania
  const glowRadius = aniaSize * 0.8 + Math.sin(timestamp / 200) * 5;
  const glowGrad = ctx.createRadialGradient(aniaX, aniaY, aniaSize * 0.3, aniaX, aniaY, glowRadius);
  glowGrad.addColorStop(0, 'rgba(255, 215, 0, 0.4)');
  glowGrad.addColorStop(1, 'rgba(255, 215, 0, 0)');
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.arc(aniaX, aniaY, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  // Ania portrait
  if (aniaImg.complete && aniaImg.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(aniaX, aniaY, aniaSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    const imgAspect = aniaImg.naturalWidth / aniaImg.naturalHeight;
    let drawW, drawH;
    if (imgAspect > 1) { drawH = aniaSize; drawW = aniaSize * imgAspect; }
    else { drawW = aniaSize; drawH = aniaSize / imgAspect; }
    ctx.drawImage(aniaImg, aniaX - drawW / 2, aniaY - drawH / 2, drawW, drawH);
    ctx.restore();

    // Golden border
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 3 * gs * aniaScale;
    ctx.beginPath();
    ctx.arc(aniaX, aniaY, aniaSize / 2 + 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // --- White flash at the end ---
  if (progress > 0.85) {
    const flashAlpha = (progress - 0.85) / 0.15;
    ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  // --- Continue or finish ---
  if (progress < 1) {
    requestAnimationFrame(winTransitionLoop);
  } else {
    winTransitionActive = false;
    endGame(true);
  }
}

function endGame(won) {
  gameRunning = false;
  if (animFrameId) cancelAnimationFrame(animFrameId);
  if (spawnTimer) clearTimeout(spawnTimer);

  if (won) {
    playWinJingle();
    document.getElementById('winScreen').style.display = 'flex';
    document.getElementById('hud').style.display = 'none';
    startWinAnimation();
  } else {
    playGameOver();
    document.getElementById('finalScore').textContent = score;
    document.getElementById('gameOverScreen').style.display = 'flex';
    document.getElementById('hud').style.display = 'none';
  }
}

// ============ WIN ANIMATION ============
function startWinAnimation() {
  const wc = document.getElementById('winCanvas');
  const wcW = window.innerWidth;
  const wcH = window.innerHeight;
  const wcDPR = window.devicePixelRatio || 1;
  wc.width = wcW * wcDPR;
  wc.height = wcH * wcDPR;
  wc.style.width = wcW + 'px';
  wc.style.height = wcH + 'px';
  const wctx = wc.getContext('2d');
  wctx.setTransform(wcDPR, 0, 0, wcDPR, 0, 0);

  const gs = Math.max(0.5, Math.min(1.3, wcW / 1024));

  // ---- Compute vertical layout so nothing overlaps ----
  // Reserve bottom 60px for the Play Again button
  const usableH = wcH - 60;
  // Proportional vertical slots (top to bottom):
  //   portrait center: 22% of usable
  //   title baseline:  42%
  //   subtitle:        48%
  //   cake center:     62%
  //   deer baseline:   84%
  const portraitY = usableH * 0.20;
  const titleY    = usableH * 0.41;
  const subtitleY = usableH * 0.47;
  const cakeY     = usableH * 0.62;
  const deerY     = usableH * 0.84;

  const dancingDeer = [];
  const deerCount = wcW < 400 ? 4 : 6;
  for (let i = 0; i < deerCount; i++) {
    dancingDeer.push({
      x: wcW * (0.1 + 0.8 * i / (deerCount - 1)),
      baseY: deerY,
      phase: (i / deerCount) * Math.PI * 2,
      size: (0.7 + Math.random() * 0.25) * gs
    });
  }

  // Confetti
  const confetti = [];
  for (let i = 0; i < 100; i++) {
    confetti.push({
      x: Math.random() * wcW,
      y: Math.random() * wcH - wcH,
      vx: (Math.random() - 0.5) * 2,
      vy: Math.random() * 3 + 1,
      size: Math.random() * 8 + 3,
      color: ['#ff6b9d','#ffd93d','#6bcbff','#ff6b6b','#9dff6b','#d46bff'][Math.floor(Math.random()*6)],
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.2
    });
  }

  let winAnimId;
  function winLoop(time) {
    wctx.clearRect(0, 0, wcW, wcH);

    // Confetti
    for (const c of confetti) {
      c.x += c.vx;
      c.y += c.vy;
      c.rot += c.rotSpeed;
      if (c.y > wcH + 20) { c.y = -20; c.x = Math.random() * wcW; }
      wctx.save();
      wctx.translate(c.x, c.y);
      wctx.rotate(c.rot);
      wctx.fillStyle = c.color;
      wctx.fillRect(-c.size/2, -c.size/4, c.size, c.size/2);
      wctx.restore();
    }

    // Dancing deer
    for (const dd of dancingDeer) {
      const bounce = Math.abs(Math.sin(time / 300 + dd.phase)) * 30;
      const sway = Math.sin(time / 500 + dd.phase) * 10;
      const y = dd.baseY - bounce;

      wctx.save();
      wctx.translate(dd.x + sway, y);
      const s = dd.size;

      // Body
      wctx.fillStyle = '#c4884d';
      wctx.beginPath();
      wctx.ellipse(0, 0, 20*s, 14*s, 0, 0, Math.PI*2);
      wctx.fill();

      // Head
      wctx.beginPath();
      wctx.arc(18*s, -20*s, 9*s, 0, Math.PI*2);
      wctx.fill();

      // Happy eyes
      wctx.fillStyle = '#222';
      wctx.beginPath();
      wctx.arc(20*s, -22*s, 2*s, 0, Math.PI*2);
      wctx.fill();

      // Smile
      wctx.strokeStyle = '#222';
      wctx.lineWidth = 1.5;
      wctx.beginPath();
      wctx.arc(22*s, -18*s, 4*s, 0, Math.PI);
      wctx.stroke();

      // Antlers
      wctx.strokeStyle = '#5a3a1a';
      wctx.lineWidth = 2.5*s;
      wctx.lineCap = 'round';
      wctx.beginPath();
      wctx.moveTo(14*s, -26*s); wctx.lineTo(10*s, -40*s); wctx.lineTo(6*s, -35*s);
      wctx.stroke();
      wctx.beginPath();
      wctx.moveTo(22*s, -28*s); wctx.lineTo(28*s, -42*s); wctx.lineTo(32*s, -36*s);
      wctx.stroke();

      // Legs (dancing)
      wctx.fillStyle = '#a06830';
      const lk = Math.sin(time/150 + dd.phase) * 8;
      wctx.fillRect(-10*s, 10*s, 4*s, 16*s + lk);
      wctx.fillRect(0, 10*s, 4*s, 16*s - lk);
      wctx.fillRect(8*s, 10*s, 4*s, 16*s + lk);
      wctx.fillRect(14*s, 10*s, 4*s, 16*s - lk);

      // Party hat
      wctx.fillStyle = '#ff6b9d';
      wctx.beginPath();
      wctx.moveTo(18*s, -32*s);
      wctx.lineTo(14*s, -22*s);
      wctx.lineTo(22*s, -22*s);
      wctx.closePath();
      wctx.fill();
      // Pom pom
      wctx.fillStyle = '#ffd93d';
      wctx.beginPath();
      wctx.arc(18*s, -33*s, 3*s, 0, Math.PI*2);
      wctx.fill();

      wctx.restore();
    }

    // ===== ANIA PORTRAIT (centerpiece) =====
    const aniaSize = Math.round(Math.min(wcW * 0.26, usableH * 0.28, 160) * gs);
    const aniaCenterX = wcW / 2;
    const aniaCenterY = portraitY;
    const aniaFloat = Math.sin(time / 800) * 6;
    const aniaGlowPulse = 0.5 + 0.5 * Math.sin(time / 400);

    // Outer glow rings
    for (let ring = 3; ring >= 0; ring--) {
      const r = aniaSize / 2 + 12 + ring * 8;
      const alpha = (0.12 - ring * 0.025) * (0.7 + aniaGlowPulse * 0.3);
      wctx.beginPath();
      wctx.arc(aniaCenterX, aniaCenterY + aniaFloat, r, 0, Math.PI * 2);
      wctx.fillStyle = `rgba(255, 215, 0, ${alpha})`;
      wctx.fill();
    }

    // Sparkles around portrait
    for (let sp = 0; sp < 8; sp++) {
      const spAngle = (sp / 8) * Math.PI * 2 + time / 1500;
      const spDist = aniaSize / 2 + 25 + Math.sin(time / 300 + sp * 1.5) * 10;
      const spX = aniaCenterX + Math.cos(spAngle) * spDist;
      const spY = aniaCenterY + aniaFloat + Math.sin(spAngle) * spDist;
      const spSize = (2 + Math.sin(time / 200 + sp) * 1.5) * gs;
      wctx.fillStyle = `rgba(255, 255, 200, ${0.6 + Math.sin(time / 250 + sp * 2) * 0.4})`;
      // Draw 4-point star
      wctx.save();
      wctx.translate(spX, spY);
      wctx.rotate(time / 600 + sp);
      wctx.beginPath();
      wctx.moveTo(0, -spSize * 2);
      wctx.lineTo(spSize * 0.5, -spSize * 0.5);
      wctx.lineTo(spSize * 2, 0);
      wctx.lineTo(spSize * 0.5, spSize * 0.5);
      wctx.lineTo(0, spSize * 2);
      wctx.lineTo(-spSize * 0.5, spSize * 0.5);
      wctx.lineTo(-spSize * 2, 0);
      wctx.lineTo(-spSize * 0.5, -spSize * 0.5);
      wctx.closePath();
      wctx.fill();
      wctx.restore();
    }

    // Golden border circle
    const borderWidth = 4 * gs;
    wctx.beginPath();
    wctx.arc(aniaCenterX, aniaCenterY + aniaFloat, aniaSize / 2 + borderWidth + 2, 0, Math.PI * 2);
    wctx.fillStyle = '#ffd700';
    wctx.fill();

    // White inner border
    wctx.beginPath();
    wctx.arc(aniaCenterX, aniaCenterY + aniaFloat, aniaSize / 2 + 2, 0, Math.PI * 2);
    wctx.fillStyle = '#fff';
    wctx.fill();

    // Ania image (clipped circle)
    if (aniaImg.complete && aniaImg.naturalWidth > 0) {
      wctx.save();
      wctx.beginPath();
      wctx.arc(aniaCenterX, aniaCenterY + aniaFloat, aniaSize / 2, 0, Math.PI * 2);
      wctx.closePath();
      wctx.clip();
      // Draw image covering the circle (center-crop)
      const imgAspect = aniaImg.naturalWidth / aniaImg.naturalHeight;
      let drawW, drawH;
      if (imgAspect > 1) {
        drawH = aniaSize;
        drawW = aniaSize * imgAspect;
      } else {
        drawW = aniaSize;
        drawH = aniaSize / imgAspect;
      }
      wctx.drawImage(aniaImg,
        aniaCenterX - drawW / 2,
        aniaCenterY + aniaFloat - drawH / 2,
        drawW, drawH
      );
      wctx.restore();
    }

    // Party hat on top of portrait
    const hatScale = gs * 1.2;
    const hatTipX = aniaCenterX;
    const hatTipY = aniaCenterY + aniaFloat - aniaSize / 2 - 30 * hatScale;
    const hatBaseY = aniaCenterY + aniaFloat - aniaSize / 2 + 8 * hatScale;
    const hatWidth = 28 * hatScale;

    wctx.fillStyle = '#ff6b9d';
    wctx.beginPath();
    wctx.moveTo(hatTipX, hatTipY);
    wctx.lineTo(hatTipX - hatWidth, hatBaseY);
    wctx.lineTo(hatTipX + hatWidth, hatBaseY);
    wctx.closePath();
    wctx.fill();

    // Hat stripes
    wctx.fillStyle = '#ffd93d';
    wctx.beginPath();
    const stripeY1 = hatTipY + (hatBaseY - hatTipY) * 0.35;
    const stripeW1 = hatWidth * 0.4;
    wctx.moveTo(hatTipX - stripeW1, stripeY1);
    wctx.lineTo(hatTipX + stripeW1, stripeY1);
    wctx.lineTo(hatTipX + stripeW1 + 4 * hatScale, stripeY1 + 6 * hatScale);
    wctx.lineTo(hatTipX - stripeW1 - 4 * hatScale, stripeY1 + 6 * hatScale);
    wctx.closePath();
    wctx.fill();

    const stripeY2 = hatTipY + (hatBaseY - hatTipY) * 0.65;
    const stripeW2 = hatWidth * 0.7;
    wctx.beginPath();
    wctx.moveTo(hatTipX - stripeW2, stripeY2);
    wctx.lineTo(hatTipX + stripeW2, stripeY2);
    wctx.lineTo(hatTipX + stripeW2 + 4 * hatScale, stripeY2 + 6 * hatScale);
    wctx.lineTo(hatTipX - stripeW2 - 4 * hatScale, stripeY2 + 6 * hatScale);
    wctx.closePath();
    wctx.fill();

    // Pom pom on top
    wctx.fillStyle = '#ffd93d';
    wctx.beginPath();
    wctx.arc(hatTipX, hatTipY, 6 * hatScale, 0, Math.PI * 2);
    wctx.fill();
    wctx.fillStyle = '#ff6b6b';
    wctx.beginPath();
    wctx.arc(hatTipX, hatTipY, 3.5 * hatScale, 0, Math.PI * 2);
    wctx.fill();

    // ===== TITLE TEXT (drawn on canvas) =====
    const titlePulse = 1 + 0.04 * Math.sin(time / 500);
    wctx.save();
    wctx.translate(wcW / 2, titleY);
    wctx.scale(titlePulse, titlePulse);
    wctx.font = `bold ${Math.round(Math.min(wcW * 0.055, 42) * gs)}px 'Segoe UI', Arial, sans-serif`;
    wctx.textAlign = 'center';
    wctx.textBaseline = 'middle';
    // Text glow
    wctx.shadowColor = '#ffd700';
    wctx.shadowBlur = 20;
    wctx.fillStyle = '#ffd700';
    wctx.fillText('🎂 Happy Birthday Ania! 🎂', 0, 0);
    wctx.shadowBlur = 0;
    wctx.restore();

    // Subtitle
    wctx.save();
    wctx.font = `bold ${Math.round(Math.min(wcW * 0.04, 28) * gs)}px 'Segoe UI', Arial, sans-serif`;
    wctx.textAlign = 'center';
    wctx.textBaseline = 'middle';
    wctx.fillStyle = '#fff';
    wctx.fillText('Congratulations! You saved the deer! 🦌🎉', wcW / 2, subtitleY);
    wctx.restore();

    // Birthday cake (below title, above deer)
    const cakeX = wcW / 2;
    const cakeCenterY = cakeY;
    const cakeScale = 1.2 * gs;
    wctx.save();
    wctx.translate(cakeX, cakeCenterY);

    // Cake plate
    wctx.fillStyle = '#ddd';
    wctx.beginPath();
    wctx.ellipse(0, 30*cakeScale, 50*cakeScale, 8*cakeScale, 0, 0, Math.PI*2);
    wctx.fill();

    // Bottom tier
    wctx.fillStyle = '#f8b4c8';
    wctx.fillRect(-40*cakeScale, -10*cakeScale, 80*cakeScale, 40*cakeScale);
    wctx.fillStyle = '#fff';
    for (let d = 0; d < 8; d++) {
      wctx.beginPath();
      wctx.arc((-35 + d*10)*cakeScale, 20*cakeScale, 5*cakeScale, Math.PI, 0);
      wctx.fill();
    }

    // Top tier
    wctx.fillStyle = '#ffd93d';
    wctx.fillRect(-28*cakeScale, -40*cakeScale, 56*cakeScale, 30*cakeScale);
    wctx.fillStyle = '#ff6b9d';
    for (let d = 0; d < 6; d++) {
      wctx.beginPath();
      wctx.arc((-23 + d*10)*cakeScale, -15*cakeScale, 4*cakeScale, Math.PI, 0);
      wctx.fill();
    }

    // Candles
    const candleColors = ['#ff6b6b','#6bcbff','#9dff6b','#ffd93d','#d46bff'];
    for (let c = 0; c < 5; c++) {
      const cx = (-20 + c*10)*cakeScale;
      wctx.fillStyle = candleColors[c];
      wctx.fillRect(cx - 2*cakeScale, -55*cakeScale, 4*cakeScale, 15*cakeScale);
      // Flame
      const flicker = Math.sin(time/100 + c*2) * 2;
      wctx.fillStyle = '#ff8c00';
      wctx.beginPath();
      wctx.ellipse(cx + flicker, -60*cakeScale, 3*cakeScale, 5*cakeScale, 0, 0, Math.PI*2);
      wctx.fill();
      wctx.fillStyle = '#ffff00';
      wctx.beginPath();
      wctx.ellipse(cx + flicker, -60*cakeScale, 1.5*cakeScale, 3*cakeScale, 0, 0, Math.PI*2);
      wctx.fill();
    }

    wctx.restore();

    winAnimId = requestAnimationFrame(winLoop);
  }
  winAnimId = requestAnimationFrame(winLoop);

  // Store for cleanup
  window._winAnimId = winAnimId;
}

// ============ BUTTON HANDLERS ============
// Difficulty picker buttons
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentDifficulty = btn.dataset.diff;
    startGame();
  });
});

// Restart buttons go back to the start screen so player can pick difficulty
function showStartScreen() {
  if (window._winAnimId) cancelAnimationFrame(window._winAnimId);
  const wc = document.getElementById('winCanvas');
  if (wc) wc.getContext('2d').clearRect(0, 0, wc.width, wc.height);
  document.getElementById('gameOverScreen').style.display = 'none';
  document.getElementById('winScreen').style.display = 'none';
  document.getElementById('hud').style.display = 'none';
  document.getElementById('startScreen').style.display = 'flex';
}
document.getElementById('restartBtn').addEventListener('click', showStartScreen);
document.getElementById('winRestartBtn').addEventListener('click', showStartScreen);
