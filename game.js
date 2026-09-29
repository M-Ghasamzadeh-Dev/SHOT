/* ============================================================================
 *  ASHFALL : LAST CITY
 *  Mobile-first 3D wave shooter. Three.js r128 + Web Audio. Zero asset files.
 *
 *  Architecture (one IIFE, modules in order):
 *    01 Utils & config          07 Enemies & AI (nav + melee)
 *    02 Settings & storage      08 Pickups & explosive barrels
 *    03 Audio (procedural)      09 Wave director
 *    04 Renderer, scene, sky    10 Input (touch / keyboard / mouse)
 *    05 City generation         11 HUD & menus
 *    06 FX, player, weapons     12 Performance governor & main loop
 * ========================================================================== */
(function () {
  'use strict';

  /* =========================================================================
   * 01. UTILITIES & CONFIG
   * ======================================================================= */
  const $ = (id) => document.getElementById(id);

  function fatal(msg) {
    const box = $('error-box');
    if (box) { box.textContent = msg; box.classList.remove('hidden'); }
    const st = $('loading-status');
    if (st) st.textContent = 'Engine failed to start';
  }

  if (typeof THREE === 'undefined') {
    fatal('Three.js could not be loaded. The engine comes from a CDN, so open the game with an internet connection and reload.');
    return;
  }

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const angleDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
    return d;
  };
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  document.body.classList.add(IS_TOUCH ? 'is-touch' : 'no-touch');

  const FOG_COLOR = 0x0c1016;
  const NEON = 0x9dff5a;

  /** Quality presets. The performance governor can step down at runtime. */
  const QUALITY = {
    low:    { pixelRatio: 0.8,  shadows: false, shadowMap: 512,  particles: 0.4, lights: 1, maxAlive: 7 },
    medium: { pixelRatio: 1.25, shadows: true,  shadowMap: 512,  particles: 0.7, lights: 2, maxAlive: 10 },
    high:   { pixelRatio: 1.75, shadows: true,  shadowMap: 1024, particles: 1.0, lights: 4, maxAlive: 13 }
  };
  const QUALITY_ORDER = ['low', 'medium', 'high'];

  /** Weapon definitions: every gun differs in damage, fire rate, magazine and reload. */
  const WEAPONS = [
    { id: 'pistol',  name: 'PISTOL',        damage: 28, headMul: 2.0, interval: 0.2,   mag: 12, reserve: Infinity, maxReserve: Infinity,
      reload: 1.1, spread: 0.006, pellets: 1, range: 90,  recoil: 0.022, kick: 0.07,  shake: 0.06, tracer: 0xffd08a, flash: 0.3,  gap: 7 },
    { id: 'rifle',   name: 'ASSAULT RIFLE', damage: 19, headMul: 2.0, interval: 0.095, mag: 30, reserve: 150, maxReserve: 300,
      reload: 1.9, spread: 0.017, pellets: 1, range: 100, recoil: 0.013, kick: 0.045, shake: 0.07, tracer: 0xffe6a0, flash: 0.36, gap: 10 },
    { id: 'shotgun', name: 'SHOTGUN',       damage: 14, headMul: 1.5, interval: 0.8,   mag: 6,  reserve: 30,  maxReserve: 60,
      reload: 2.3, spread: 0.075, pellets: 9, range: 38,  recoil: 0.06,  kick: 0.17,  shake: 0.24, tracer: 0xffb070, flash: 0.55, gap: 18 }
  ];

  /** Enemy archetypes. Wave multipliers scale hp / damage / speed on top of these. */
  const ENEMY_TYPES = {
    walker: { hp: 60,  speed: 2.3, damage: 10, range: 1.7, cooldown: 1.2, windup: 0.38, score: 100, scale: 1.0,  radius: 0.42,
      skin: 0x5d6b55, cloth: 0x2b2e36, eye: 0xff3b2f, bar: 0xff4a3a, blood: [0.32, 0.03, 0.02], spark: [1, 0.25, 0.15] },
    runner: { hp: 36,  speed: 5.1, damage: 7,  range: 1.6, cooldown: 0.8, windup: 0.22, score: 150, scale: 0.9,  radius: 0.38,
      skin: 0x7a6a50, cloth: 0x40221e, eye: 0xffd21f, bar: 0xffc21f, blood: [0.3, 0.05, 0.02], spark: [1, 0.8, 0.2] },
    brute:  { hp: 280, speed: 1.6, damage: 26, range: 2.6, cooldown: 2.0, windup: 0.6,  score: 400, scale: 1.55, radius: 0.75,
      skin: 0x584868, cloth: 0x1d1b24, eye: 0xc04cff, bar: 0xc04cff, blood: [0.18, 0.04, 0.22], spark: [0.8, 0.3, 1] }
  };

  const PLAYER_CFG = { eye: 1.65, radius: 0.38, walk: 5.2, run: 8.6, jump: 7.2, gravity: 21, maxHp: 100 };
  const SWITCH_TIME = 0.42;
  const WORLD_LIMIT = 69.8;

  // Reusable temporaries (avoid per-frame allocations)
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  const _dir = new THREE.Vector3(), _baseDir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
  const _muzzle = new THREE.Vector3(), _n = new THREE.Vector3(), _fxv = new THREE.Vector3(), _proj = new THREE.Vector3();
  const _sp = new THREE.Vector3(), _ex = new THREE.Vector3(), _kv = new THREE.Vector3();
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  const _color = new THREE.Color();

  /* =========================================================================
   * 02. SETTINGS & STORAGE
   * ======================================================================= */
  const Settings = {
    quality: IS_TOUCH ? 'medium' : 'high',
    sensitivity: 1,
    volume: 0.7,
    autoQuality: true,
    showFps: false,
    keys: ['quality', 'sensitivity', 'volume', 'autoQuality', 'showFps'],
    load() {
      try {
        const raw = JSON.parse(localStorage.getItem('ashfall.settings') || '{}');
        this.keys.forEach((k) => { if (k in raw) this[k] = raw[k]; });
      } catch (err) { /* storage unavailable: keep defaults */ }
      if (!QUALITY[this.quality]) this.quality = 'medium';
      this.sensitivity = clamp(Number(this.sensitivity) || 1, 0.3, 2.5);
      this.volume = clamp(Number(this.volume), 0, 1);
      if (Number.isNaN(this.volume)) this.volume = 0.7;
    },
    save() {
      try {
        const o = {};
        this.keys.forEach((k) => { o[k] = this[k]; });
        localStorage.setItem('ashfall.settings', JSON.stringify(o));
      } catch (err) { /* ignore */ }
    }
  };
  Settings.load();

  function loadBest() { try { return parseInt(localStorage.getItem('ashfall.best') || '0', 10) || 0; } catch (err) { return 0; } }
  function saveBest(v) { try { localStorage.setItem('ashfall.best', String(v)); } catch (err) { /* ignore */ } }

  /* =========================================================================
   * 03. AUDIO  (all sounds are synthesized with the Web Audio API)
   * ======================================================================= */
  const Sound = {
    ctx: null, master: null, noise: null, volume: Settings.volume, lastHit: 0,
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noise = buf;
      } catch (err) { this.ctx = null; }
    },
    setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; },
    ok() { return !!this.ctx && this.volume > 0 && this.ctx.state === 'running'; },
    now() { return this.ctx.currentTime; },
    noiseHit(t, dur, type, freq, q, gain, freqEnd) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      const f = this.ctx.createBiquadFilter();
      f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(freq, t);
      if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.02);
    },
    tone(t, dur, type, f0, f1, gain) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    },
    shot(id) {
      if (!this.ok()) return;
      const t = this.now();
      if (id === 'pistol') {
        this.noiseHit(t, 0.2, 'bandpass', 2400, 0.8, 0.9, 500);
        this.tone(t, 0.12, 'sine', 190, 50, 0.7);
      } else if (id === 'rifle') {
        this.noiseHit(t, 0.13, 'bandpass', 1700, 0.9, 0.75, 450);
        this.tone(t, 0.09, 'square', 150, 55, 0.22);
      } else {
        this.noiseHit(t, 0.5, 'lowpass', 3200, 0.5, 1.1, 250);
        this.tone(t, 0.32, 'sine', 120, 32, 0.95);
        this.noiseHit(t + 0.42, 0.06, 'highpass', 2500, 1, 0.25); // pump
      }
    },
    reload() {
      if (!this.ok()) return;
      const t = this.now();
      this.tone(t, 0.05, 'square', 900, 400, 0.18);
      this.noiseHit(t + 0.02, 0.05, 'highpass', 3000, 1, 0.3);
      this.tone(t + 0.4, 0.06, 'square', 620, 300, 0.2);
      this.noiseHit(t + 0.42, 0.07, 'highpass', 2600, 1, 0.35);
    },
    reloadDone() {
      if (!this.ok()) return;
      const t = this.now();
      this.noiseHit(t, 0.06, 'highpass', 3500, 1, 0.4);
      this.tone(t, 0.05, 'square', 1200, 700, 0.15);
    },
    hit(head) {
      if (!this.ok()) return;
      const t = this.now();
      if (t - this.lastHit < 0.035) return;
      this.lastHit = t;
      this.tone(t, 0.06, 'triangle', head ? 2000 : 1400, head ? 1500 : 900, head ? 0.3 : 0.22);
    },
    death(scale) {
      if (!this.ok()) return;
      const t = this.now();
      const s = scale || 1;
      this.tone(t, 0.55 * s, 'sawtooth', 240 / s, 38, 0.22);
      this.noiseHit(t, 0.35, 'lowpass', 900, 1, 0.45, 100);
      this.tone(t, 0.09, 'triangle', 1300, 1900, 0.2);
    },
    click() {
      if (!this.ok()) return;
      const t = this.now();
      this.tone(t, 0.07, 'sine', 900, 650, 0.22);
    },
    empty() {
      if (!this.ok()) return;
      this.tone(this.now(), 0.04, 'square', 1300, 1000, 0.12);
    },
    swap() {
      if (!this.ok()) return;
      const t = this.now();
      this.noiseHit(t, 0.08, 'bandpass', 1800, 2, 0.3);
      this.tone(t + 0.05, 0.05, 'square', 500, 300, 0.12);
    },
    explosion(dist) {
      if (!this.ok()) return;
      const t = this.now();
      const v = clamp(1.4 - (dist || 0) / 45, 0.3, 1.4);
      this.noiseHit(t, 1.3, 'lowpass', 1800, 0.7, v, 55);
      this.tone(t, 0.9, 'sine', 90, 24, v * 0.9);
    },
    hurt() {
      if (!this.ok()) return;
      const t = this.now();
      this.tone(t, 0.2, 'sawtooth', 150, 70, 0.3);
      this.noiseHit(t, 0.12, 'lowpass', 700, 1, 0.3);
    },
    slam() {
      if (!this.ok()) return;
      const t = this.now();
      this.tone(t, 0.45, 'sine', 85, 28, 0.8);
      this.noiseHit(t, 0.4, 'lowpass', 700, 1, 0.5, 80);
    },
    growl(vol) {
      if (!this.ok()) return;
      const t = this.now();
      this.noiseHit(t, 0.5, 'bandpass', 320, 3, 0.25 * vol, 180);
      this.tone(t, 0.5, 'sawtooth', rand(70, 95), 45, 0.07 * vol);
    },
    pickup() {
      if (!this.ok()) return;
      const t = this.now();
      this.tone(t, 0.12, 'sine', 520, 1040, 0.25);
      this.tone(t + 0.08, 0.12, 'sine', 780, 1560, 0.18);
    },
    wave() {
      if (!this.ok()) return;
      const t = this.now();
      this.tone(t, 0.4, 'square', 110, 108, 0.1);
      this.tone(t + 0.25, 0.4, 'square', 147, 145, 0.1);
      this.tone(t + 0.5, 0.7, 'sawtooth', 165, 80, 0.12);
    },
    clear() {
      if (!this.ok()) return;
      const t = this.now();
      [440, 554, 659].forEach((f, i) => this.tone(t + i * 0.1, 0.35, 'triangle', f, f * 1.01, 0.18));
    },
    thunder() {
      if (!this.ok()) return;
      const t = this.now();
      this.noiseHit(t, 2.6, 'lowpass', 500, 0.6, 0.55, 60);
    }
  };

  /* =========================================================================
   * 04. RENDERER, SCENE, CAMERAS, SKY & LIGHTS
   * ======================================================================= */
  const canvas = $('game-canvas');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  } catch (err) {
    fatal('WebGL is not available on this device or browser.');
    return;
  }
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.autoClear = false;
  renderer.setClearColor(FOG_COLOR, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.03);

  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 220);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  // First-person weapon is rendered in its own scene on top (never clips into walls)
  const weaponScene = new THREE.Scene();
  const weaponCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 10);

  // ---- Procedural textures ------------------------------------------------
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function canvasTex(c, srgb) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb !== false) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return t;
  }

  function makeGlowTexture() {
    const c = makeCanvas(64, 64), g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.65)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return canvasTex(c, false);
  }
  function makeSmokeTexture() {
    const c = makeCanvas(64, 64), g = c.getContext('2d');
    const rng = mulberry32(7);
    for (let i = 0; i < 14; i++) {
      const x = 20 + rng() * 24, y = 20 + rng() * 24, r = 10 + rng() * 14;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.22)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    }
    return canvasTex(c, false);
  }
  function makeFlashTexture() {
    const c = makeCanvas(128, 128), g = c.getContext('2d');
    g.translate(64, 64);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, 60);
    grd.addColorStop(0, 'rgba(255,255,240,1)');
    grd.addColorStop(0.2, 'rgba(255,220,140,0.9)');
    grd.addColorStop(0.55, 'rgba(255,140,40,0.25)');
    grd.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, 60, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,230,170,0.85)';
    for (let i = 0; i < 6; i++) {
      g.rotate(TAU / 6);
      g.beginPath(); g.moveTo(-5, 0); g.lineTo(0, -62); g.lineTo(5, 0); g.closePath(); g.fill();
    }
    return canvasTex(c, false);
  }
  function makeAsphaltTexture() {
    const c = makeCanvas(256, 256), g = c.getContext('2d');
    const rng = mulberry32(99);
    g.fillStyle = '#2a2c30'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5000; i++) {
      const v = 30 + rng() * 40 | 0;
      g.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + rng() * 0.35})`;
      g.fillRect(rng() * 256, rng() * 256, 1 + rng() * 2, 1 + rng() * 2);
    }
    g.strokeStyle = 'rgba(8,8,10,0.75)'; g.lineWidth = 1.2;
    for (let i = 0; i < 16; i++) {
      let x = rng() * 256, y = rng() * 256;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 7; k++) { x += (rng() - 0.5) * 34; y += (rng() - 0.5) * 34; g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 10; i++) { // oil / soot stains
      const x = rng() * 256, y = rng() * 256, r = 10 + rng() * 26;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(0,0,0,0.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return canvasTex(c);
  }
  function makeConcreteTexture() {
    const c = makeCanvas(128, 128), g = c.getContext('2d');
    const rng = mulberry32(5);
    g.fillStyle = '#4a4a47'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1600; i++) {
      const v = 55 + rng() * 40 | 0;
      g.fillStyle = `rgba(${v},${v},${v - 3},0.35)`;
      g.fillRect(rng() * 128, rng() * 128, 2, 2);
    }
    g.strokeStyle = 'rgba(20,20,20,0.7)'; g.lineWidth = 2;
    for (let i = 0; i <= 128; i += 32) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
    }
    return canvasTex(c);
  }
  /** Facade texture + matching emissive map (lit windows glow in the dark). */
  function makeFacadeTextures(base, seed) {
    const W = 128, H = 384;
    const rng = mulberry32(seed);
    const c = makeCanvas(W, H), e = makeCanvas(W, H);
    const g = c.getContext('2d'), ge = e.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1400; i++) {
      const dark = rng() < 0.6;
      g.fillStyle = dark ? `rgba(0,0,0,${0.04 + rng() * 0.08})` : `rgba(255,255,255,${0.02 + rng() * 0.04})`;
      g.fillRect(rng() * W, rng() * H, 2 + rng() * 5, 2 + rng() * 8);
    }
    ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
    for (let fy = 0; fy < 8; fy++) {
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, fy * 48, W, 3);
      for (let fx = 0; fx < 4; fx++) {
        const x = fx * 32 + 7, y = fy * 48 + 12, w = 18, h = 25;
        const r = rng();
        if (r < 0.1) {
          const col = rng() < 0.75 ? '#ffae55' : '#8fd2ff';
          g.fillStyle = col; g.fillRect(x, y, w, h);
          ge.fillStyle = col; ge.fillRect(x, y, w, h);
          ge.fillStyle = 'rgba(0,0,0,0.45)'; ge.fillRect(x, y + h * 0.55, w, h * 0.45);
        } else if (r < 0.34) {
          g.fillStyle = '#040506'; g.fillRect(x, y, w, h);
          g.fillStyle = 'rgba(120,130,140,0.25)';
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * rng(), y); g.lineTo(x, y + h * rng()); g.fill();
        } else {
          const v = 18 + rng() * 14 | 0;
          g.fillStyle = `rgb(${v},${v + 6},${v + 14})`; g.fillRect(x, y, w, h);
          g.fillStyle = 'rgba(170,190,210,0.12)'; g.fillRect(x, y, w, 3);
        }
        g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x - 2, y + h, w + 4, 3);
      }
    }
    for (let i = 0; i < 7; i++) { // soot streaks
      g.fillStyle = `rgba(0,0,0,${0.12 + rng() * 0.15})`;
      g.fillRect(rng() * W, rng() * H, 3 + rng() * 9, 40 + rng() * 140);
    }
    return { map: canvasTex(c), emissive: canvasTex(e) };
  }
  function makeBarrelTexture() {
    const c = makeCanvas(128, 64), g = c.getContext('2d');
    const rng = mulberry32(3);
    g.fillStyle = '#7d1c12'; g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#e0a614'; g.fillRect(0, 10, 128, 7); g.fillRect(0, 47, 128, 7);
    g.fillStyle = '#1a1a1a';
    for (let x = -10; x < 128; x += 14) { g.beginPath(); g.moveTo(x, 17); g.lineTo(x + 7, 10); g.lineTo(x + 12, 10); g.lineTo(x + 5, 17); g.fill(); }
    g.fillStyle = '#f0d040';
    g.beginPath(); g.moveTo(64, 22); g.lineTo(74, 40); g.lineTo(54, 40); g.closePath(); g.fill();
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(60,25,10,${rng() * 0.5})`; g.fillRect(rng() * 128, rng() * 64, 2, 2); }
    return canvasTex(c);
  }

  const glowTex = makeGlowTexture();
  const smokeTex = makeSmokeTexture();
  const flashTex = makeFlashTexture();
  const asphaltTex = makeAsphaltTexture();
  const concreteTex = makeConcreteTexture();
  const barrelTex = makeBarrelTexture();

  // ---- Sky dome (gradient + burning horizon + lightning) ------------------
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(0x04060b) },
      horizon: { value: new THREE.Color(FOG_COLOR) },
      glow: { value: new THREE.Color(0x4a2210) },
      flash: { value: 0 }
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; uniform float flash; varying vec3 vDir;',
      'void main(){',
      '  float h = clamp(vDir.y, 0.0, 1.0);',
      '  vec3 c = mix(horizon, top, pow(h, 0.5));',
      '  c += glow * pow(1.0 - h, 7.0) * 0.7;',
      '  c += vec3(0.32, 0.38, 0.55) * flash * (1.0 - h * 0.4);',
      '  gl_FragColor = vec4(c, 1.0);',
      '}'
    ].join('\n'),
    side: THREE.BackSide, depthWrite: false, fog: false
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 12), skyMat);
  sky.renderOrder = -10;
  scene.add(sky);

  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x6f86b8, fog: false, depthWrite: false, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending }));
  moonHalo.scale.set(55, 55, 1);
  const moonCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xdfe8ff, fog: false, depthWrite: false, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }));
  moonCore.scale.set(12, 12, 1);
  scene.add(moonHalo); scene.add(moonCore);
  const MOON_DIR = new THREE.Vector3(-0.45, 0.5, -0.74).normalize();

  // ---- Lights --------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0x6f80a8, 0x221a14, 0.55);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xa4b8e6, 0.6);
  moon.shadow.camera.left = -34; moon.shadow.camera.right = 34;
  moon.shadow.camera.top = 34; moon.shadow.camera.bottom = -34;
  moon.shadow.camera.near = 1; moon.shadow.camera.far = 140;
  moon.shadow.bias = -0.0009;
  moon.shadow.normalBias = 0.04;
  scene.add(moon); scene.add(moon.target);
  const MOON_OFFSET = new THREE.Vector3(-30, 58, -20);

  // Fixed pool of point lights. Their count never changes during play, so shaders never recompile mid-fight.
  const streetLights = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xffa35a, 0, 24, 2);
    l.userData.lamp = null;
    scene.add(l); streetLights.push(l);
  }
  const fireLight = new THREE.PointLight(0xff6a20, 0, 18, 2); scene.add(fireLight);
  const muzzleLight = new THREE.PointLight(0xffc070, 0, 14, 2); scene.add(muzzleLight);
  const explosionLight = new THREE.PointLight(0xff8a30, 0, 32, 2); scene.add(explosionLight);
  // Player flashlight: a soft cone that follows the view (no shadows, cheap)
  const flashlight = new THREE.SpotLight(0xdfe6ff, 0, 32, 0.5, 0.55, 1.5);
  scene.add(flashlight); scene.add(flashlight.target);

  // Weapon scene lights
  weaponScene.add(new THREE.AmbientLight(0x8898b0, 1.0));
  const wKey = new THREE.DirectionalLight(0xffffff, 1.1); wKey.position.set(1, 2, 1.5); weaponScene.add(wKey);
  const wRim = new THREE.DirectionalLight(NEON, 0.55); wRim.position.set(-1.5, 0.4, -1); weaponScene.add(wRim);
  const vmFlashLight = new THREE.PointLight(0xffb060, 0, 2.5, 2);
  weaponScene.add(vmFlashLight);

  /* =========================================================================
   * 05. CITY GENERATION  (merged geometry: only a handful of draw calls)
   * ======================================================================= */
  const BLOCK = 28, BLOCK_SIZE = 18;
  const ROAD_LINES = [-67.5, -42, -14, 14, 42, 67.5];
  const colliders = [];      // { minX, maxX, minZ, maxZ, top, active, building }
  const worldMeshes = [];    // static meshes bullets can hit
  const lamps = [];          // working street lamps
  const fireSpots = [];      // permanent burning spots
  const barrelSpawns = [];
  const intersections = [];
  ROAD_LINES.forEach((x) => ROAD_LINES.forEach((z) => intersections.push({ x, z })));

  function addCollider(minX, maxX, minZ, maxZ, top, building) {
    const c = { minX, maxX, minZ, maxZ, top, active: true, building: !!building };
    colliders.push(c);
    return c;
  }
  function boxOverlaps(minX, maxX, minZ, maxZ, margin) {
    for (const c of colliders) {
      if (maxX + margin > c.minX && minX - margin < c.maxX && maxZ + margin > c.minZ && minZ - margin < c.maxZ) return true;
    }
    return false;
  }

  /** Bakes transform (and optional vertex color) into a geometry. */
  function placed(geo, x, y, z, ry, rx, rz, color) {
    _e.set(rx || 0, ry || 0, rz || 0);
    _q.setFromEuler(_e);
    _m4.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1));
    geo.applyMatrix4(_m4);
    if (color !== undefined && color !== null) {
      const n = geo.attributes.position.count;
      const arr = new Float32Array(n * 3);
      _color.setHex(color);
      for (let i = 0; i < n; i++) { arr[i * 3] = _color.r; arr[i * 3 + 1] = _color.g; arr[i * 3 + 2] = _color.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    return geo;
  }
  /** Scale box UVs to world size so windows keep a constant size on every building. */
  function scaleBoxUV(geo, w, h, d) {
    const uv = geo.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let i = 0; i < uv.count; i++) {
      const f = dims[Math.floor(i / 4)];
      uv.setXY(i, uv.getX(i) * f[0] / 8, uv.getY(i) * f[1] / 24);
    }
    return geo;
  }
  function mergeGeos(list, withColor) {
    const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
    let total = 0;
    parts.forEach((g) => { total += g.attributes.position.count; });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    const col = withColor ? new Float32Array(total * 3) : null;
    let o = 0;
    parts.forEach((g, i) => {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      if (col && g.attributes.color) col.set(g.attributes.color.array, o * 3);
      o += n;
      if (list[i] !== g) list[i].dispose();
      g.dispose();
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }

  const facades = [makeFacadeTextures('#403e3a', 11), makeFacadeTextures('#44362f', 23), makeFacadeTextures('#343a40', 37)];
  const wallMats = facades.map((f) => new THREE.MeshStandardMaterial({
    map: f.map, emissive: 0xffffff, emissiveMap: f.emissive, emissiveIntensity: 1.1, roughness: 0.9, metalness: 0.05
  }));
  const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.35 });
  const groundMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.93, metalness: 0.0, color: 0xa0a0a0 });
  const walkMat = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.95, metalness: 0.0, color: 0x9a9a98 });
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xffd09a });
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xffa050, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });

  const RUST = [0x4a2a1e, 0x2c3a44, 0x3c3c38, 0x5a4a2a, 0x223029, 0x3a2222, 0x51524e];
  const CONCRETE = [0x4c4b48, 0x3f3e3b, 0x55534f, 0x36352f];

  function buildCity() {
    const rng = mulberry32(20260929);
    const bGeos = [[], [], []], props = [], walks = [], heads = [], cones = [];
    const pick = (arr) => arr[(rng() * arr.length) | 0];

    // Ground
    const gGeo = new THREE.PlaneGeometry(240, 240);
    gGeo.rotateX(-Math.PI / 2);
    const uvs = gGeo.attributes.uv;
    for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * 48, uvs.getY(i) * 48);
    const ground = new THREE.Mesh(gGeo, groundMat);
    ground.receiveShadow = true;
    ground.matrixAutoUpdate = false;
    scene.add(ground);
    worldMeshes.push(ground);

    function addRubble(x, z, s) {
      const k = s || 1;
      const w = (0.3 + rng() * 0.8) * k, h = (0.15 + rng() * 0.45) * k, d = (0.3 + rng() * 0.8) * k;
      props.push(placed(new THREE.BoxGeometry(w, h, d), x, h * 0.35, z, rng() * TAU, (rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6, pick(CONCRETE)));
    }

    function addBuilding(x, z, w, d, h, variant, collapsed, collide) {
      const g = scaleBoxUV(new THREE.BoxGeometry(w, h, d), w, h, d);
      bGeos[variant].push(placed(g, x, h / 2, z));
      if (collide) addCollider(x - w / 2, x + w / 2, z - d / 2, z + d / 2, h, true);
      if (!collapsed && rng() < 0.45) { // broken crown
        const n = 2 + ((rng() * 3) | 0);
        for (let k = 0; k < n; k++) {
          const pw = w * (0.2 + rng() * 0.35), pd = d * (0.2 + rng() * 0.35), ph = 0.8 + rng() * 3.5;
          const px = x + (rng() - 0.5) * (w - pw), pz = z + (rng() - 0.5) * (d - pd);
          const pg = scaleBoxUV(new THREE.BoxGeometry(pw, ph, pd), pw, ph, pd);
          bGeos[variant].push(placed(pg, px, h + ph / 2 - 0.3, pz, rng() * 0.3, (rng() - 0.5) * 0.25, (rng() - 0.5) * 0.25));
        }
      }
      if (!collapsed && rng() < 0.5) {
        props.push(placed(new THREE.BoxGeometry(1.4, 1, 1), x + (rng() - 0.5) * (w - 2), h + 0.5, z + (rng() - 0.5) * (d - 2), rng() * 3, 0, 0, 0x33363a));
      }
      if (!collapsed && rng() < 0.35) { // exposed floor slab jutting out of a facade
        const side = rng() < 0.5 ? 1 : -1;
        const sy = 3 + ((rng() * (h - 4) / 3) | 0) * 3;
        props.push(placed(new THREE.BoxGeometry(w * 0.6, 0.25, 1.2), x + (rng() - 0.5) * w * 0.3, sy, z + side * (d / 2 + 0.5), 0, 0, (rng() - 0.5) * 0.3, 0x4a4945));
      }
      if (collapsed) {
        for (let k = 0; k < 22; k++) addRubble(x + (rng() - 0.5) * (w + 3), z + (rng() - 0.5) * (d + 3), 0.6 + rng() * 1.4);
      }
    }

    function addLamp(x, z, ax, az, working) {
      props.push(placed(new THREE.CylinderGeometry(0.07, 0.11, 6, 6), x, 3, z, 0, 0, 0, 0x2a2d30));
      const armLen = 1.6;
      props.push(placed(new THREE.BoxGeometry(Math.abs(ax) * armLen + 0.08, 0.08, Math.abs(az) * armLen + 0.08), x + ax * armLen / 2, 5.95, z + az * armLen / 2, 0, 0, 0, 0x2a2d30));
      const hx = x + ax * armLen, hz = z + az * armLen;
      const head = placed(new THREE.BoxGeometry(0.5, 0.14, 0.3), hx, 5.88, hz);
      if (working) {
        heads.push(head);
        cones.push(placed(new THREE.ConeGeometry(2.7, 5.7, 12, 1, true), hx, 5.8 - 2.85, hz));
        lamps.push({ x: hx, y: 5.6, z: hz, flicker: rng() < 0.25, on: true, cur: 1, timer: rng() * 2, gi: 0 });
      } else {
        const n = head.attributes.position.count, arr = new Float32Array(n * 3);
        for (let i = 0; i < arr.length; i++) arr[i] = 0.08;
        head.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        props.push(head);
      }
      addCollider(x - 0.15, x + 0.15, z - 0.15, z + 0.15, 6, false);
    }

    function addCar(x, z, alongX, burning) {
      const ry = (alongX ? Math.PI / 2 : 0) + (rng() - 0.5) * 0.25;
      const flipped = rng() < 0.1;
      const col = pick(RUST);
      const tmp = [];
      tmp.push(new THREE.BoxGeometry(1.9, 0.75, 4.2).translate(0, 0.62, 0));
      tmp.push(new THREE.BoxGeometry(1.7, 0.6, 2.2).translate(0, 1.28, -0.2));
      [[-0.95, -1.35], [0.95, -1.35], [-0.95, 1.35], [0.95, 1.35]].forEach(([wx, wz]) => {
        const wg = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10);
        wg.rotateZ(Math.PI / 2); wg.translate(wx, 0.36, wz);
        tmp.push(wg);
      });
      tmp.forEach((g, i) => {
        if (flipped) { g.rotateZ(Math.PI); g.translate(0, 1.7, 0); }
        props.push(placed(g, x, 0, z, ry, 0, 0, i < 1 ? col : i < 2 ? 0x15181b : 0x0e0e0f));
      });
      const hw = alongX ? 2.2 : 1.05, hd = alongX ? 1.05 : 2.2;
      addCollider(x - hw, x + hw, z - hd, z + hd, 1.6, false);
      if (burning) fireSpots.push({ x, y: 1.5, z, s: 1.2, acc: 0 });
    }

    // ---- City blocks
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const cx = i * BLOCK, cz = j * BLOCK;
        walks.push(placed(new THREE.BoxGeometry(BLOCK_SIZE + 0.4, 0.14, BLOCK_SIZE + 0.4), cx, 0.07, cz));

        if (i === 0 && j === 0) { // central plaza
          props.push(placed(new THREE.BoxGeometry(3.2, 1, 3.2), 0, 0.5, -7, 0, 0, 0, 0x4a4845));
          props.push(placed(new THREE.CylinderGeometry(0.45, 0.5, 3.2, 10), 0.3, 2.5, -7, 0, 0, 0.22, 0x55534f));
          props.push(placed(new THREE.CylinderGeometry(0.45, 0.45, 2.6, 10), 2.4, 0.45, -5, 0.6, 0, Math.PI / 2, 0x55534f));
          addCollider(-1.6, 1.6, -8.6, -5.4, 3.8, false);
          addCollider(1.4, 3.4, -6, -4, 0.9, false);
          props.push(placed(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 12), 5, 0.55, 2, 0, 0, 0, 0x2b1a14));
          addCollider(4.55, 5.45, 1.55, 2.45, 1.1, false);
          fireSpots.push({ x: 5, y: 1.15, z: 2, s: 0.8, acc: 0 });
          props.push(placed(new THREE.BoxGeometry(2, 0.45, 0.6), -5, 0.36, 3, 0.2, 0, 0, 0x3a2e24));
          props.push(placed(new THREE.BoxGeometry(2, 0.45, 0.6), -5.5, 0.36, -2.5, -0.4, 0, 0.3, 0x3a2e24));
          addCar(-4.2, -5.5, true, false);
          addCar(6.5, -3, false, false);
          for (let k = 0; k < 16; k++) addRubble(rng() * 16 - 8, rng() * 16 - 8, 0.6);
          [[-8, -8], [8, -8], [-8, 8], [8, 8]].forEach(([lx, lz]) => addLamp(lx, lz, lx > 0 ? -1 : 1, 0, true));
          continue;
        }

        const outer = Math.abs(i) === 2 || Math.abs(j) === 2;
        const hMin = outer ? 12 : 6, hMax = outer ? 30 : 22;
        const inner = 7.6;
        const lots = [];
        const L = rng();
        if (L < 0.28) {
          lots.push([cx, cz, inner * 2 - rng() * 2, inner * 2 - rng() * 2]);
        } else if (L < 0.62) {
          if (rng() < 0.5) {
            lots.push([cx - inner / 2 - 0.3, cz, inner - 0.6, inner * 2 - 0.5]);
            lots.push([cx + inner / 2 + 0.3, cz, inner - 0.6, inner * 2 - 0.5]);
          } else {
            lots.push([cx, cz - inner / 2 - 0.3, inner * 2 - 0.5, inner - 0.6]);
            lots.push([cx, cz + inner / 2 + 0.3, inner * 2 - 0.5, inner - 0.6]);
          }
        } else {
          for (const a of [-1, 1]) for (const b of [-1, 1]) {
            lots.push([cx + a * (inner / 2 + 0.3), cz + b * (inner / 2 + 0.3), inner - 0.8 - rng() * 1.2, inner - 0.8 - rng() * 1.2]);
          }
        }
        for (const [x, z, w, d] of lots) {
          const collapsed = rng() < 0.12;
          const h = collapsed ? 2.5 + rng() * 3 : hMin + rng() * (hMax - hMin);
          addBuilding(x, z, w, d, h, (rng() * 3) | 0, collapsed, true);
        }
        for (let k = 0; k < 12; k++) {
          const side = (rng() * 4) | 0, t = (rng() - 0.5) * BLOCK_SIZE, off = BLOCK_SIZE / 2 + 0.2 + rng() * 1.4;
          const rx = side === 0 ? cx + off : side === 1 ? cx - off : cx + t;
          const rz = side === 2 ? cz + off : side === 3 ? cz - off : cz + t;
          addRubble(rx, rz, 0.7);
        }
      }
    }

    // ---- Distant skyline ring (visual only, the edge wall is a collider)
    for (let t = -90; t <= 90; t += 12) {
      [[t, -84], [t, 84], [-84, t], [84, t]].forEach(([x, z]) => {
        const w = 9 + rng() * 3, d = 9 + rng() * 3, h = 16 + rng() * 26;
        addBuilding(x, z, w, d, h, (rng() * 3) | 0, false, false);
      });
    }
    // ---- Container barricade marking the playable edge
    for (let t = -66; t <= 66; t += 6.4) {
      [[t, -72, true], [t, 72, true], [-72, t, false], [72, t, false]].forEach(([x, z, alongX]) => {
        const h = 2.6 * (rng() < 0.25 ? 2 : 1);
        props.push(placed(new THREE.BoxGeometry(alongX ? 6 : 2.4, h, alongX ? 2.4 : 6), x, h / 2, z, 0, 0, 0, pick(RUST)));
      });
    }
    addCollider(70.3, 95, -95, 95, 60, true);
    addCollider(-95, -70.3, -95, 95, 60, true);
    addCollider(-95, 95, 70.3, 95, 60, true);
    addCollider(-95, 95, -95, -70.3, 60, true);

    // ---- Street lamps (intersections + mid-block)
    const inner4 = [-42, -14, 14, 42];
    inner4.forEach((ix) => inner4.forEach((iz) => {
      const sx = rng() < 0.5 ? 1 : -1, sz = rng() < 0.5 ? 1 : -1;
      addLamp(ix + 5.6 * sx, iz + 5.6 * sz, -sx, 0, rng() > 0.22);
    }));
    inner4.forEach((line) => [-56, -28, 28, 56].forEach((t) => {
      const s = rng() < 0.5 ? 1 : -1;
      if (rng() < 0.5) addLamp(line + 5.6 * s, t, -s, 0, rng() > 0.3);
      else addLamp(t, line + 5.6 * s, 0, -s, rng() > 0.3);
    }));

    // ---- Road markings (dashed center lines)
    [-42, -14, 14, 42].forEach((line) => {
      for (let t = -64; t <= 64; t += 4) {
        if (inner4.some((L2) => Math.abs(t - L2) < 6)) continue;
        if (rng() < 0.18) continue; // worn away
        const a = new THREE.PlaneGeometry(0.16, 2); a.rotateX(-Math.PI / 2);
        props.push(placed(a, line, 0.02, t, 0, 0, 0, 0x6e6230));
        const b = new THREE.PlaneGeometry(2, 0.16); b.rotateX(-Math.PI / 2);
        props.push(placed(b, t, 0.02, line, 0, 0, 0, 0x6e6230));
      }
    });

    // ---- Wrecked cars, barriers, barrels on the roads
    let carTries = 0, cars = 0;
    while (cars < 22 && carTries < 400) {
      carTries++;
      const line = inner4[(rng() * 4) | 0];
      const t = (rng() - 0.5) * 124;
      if (inner4.some((L2) => Math.abs(t - L2) < 7)) continue;
      const vertical = rng() < 0.5;
      const lat = (rng() < 0.5 ? -1 : 1) * (1.8 + rng() * 1.2);
      const x = vertical ? line + lat : t, z = vertical ? t : line + lat;
      if (Math.hypot(x, z) < 12) continue;
      const hw = vertical ? 1.05 : 2.2, hd = vertical ? 2.2 : 1.05;
      if (boxOverlaps(x - hw, x + hw, z - hd, z + hd, 1.2)) continue;
      addCar(x, z, !vertical, cars < 4);
      cars++;
    }
    let barTries = 0, bars = 0;
    while (bars < 12 && barTries < 300) {
      barTries++;
      const line = ROAD_LINES[1 + ((rng() * 4) | 0)];
      const t = (rng() - 0.5) * 124;
      const vertical = rng() < 0.5;
      const lat = (rng() - 0.5) * 6;
      const x = vertical ? line + lat : t, z = vertical ? t : line + lat;
      if (Math.hypot(x, z) < 10) continue;
      const hw = vertical ? 0.3 : 1.3, hd = vertical ? 1.3 : 0.3;
      if (boxOverlaps(x - hw, x + hw, z - hd, z + hd, 1.5)) continue;
      props.push(placed(new THREE.BoxGeometry(hw * 2, 0.85, hd * 2), x, 0.425, z, 0, 0, 0, 0x6a6862));
      props.push(placed(new THREE.BoxGeometry(hw * 2 + 0.02, 0.12, hd * 2 + 0.02), x, 0.7, z, 0, 0, 0, 0x8a3a1a));
      addCollider(x - hw, x + hw, z - hd, z + hd, 0.85, false);
      bars++;
    }
    let brTries = 0;
    while (barrelSpawns.length < 14 && brTries < 400) {
      brTries++;
      const line = ROAD_LINES[1 + ((rng() * 4) | 0)];
      const t = (rng() - 0.5) * 120;
      const vertical = rng() < 0.5;
      const lat = (rng() < 0.5 ? -1 : 1) * (3.2 + rng() * 1.2);
      const x = vertical ? line + lat : t, z = vertical ? t : line + lat;
      if (Math.hypot(x, z) < 9) continue;
      if (boxOverlaps(x - 0.45, x + 0.45, z - 0.45, z + 0.45, 0.6)) continue;
      barrelSpawns.push({ x, z });
    }

    // ---- Build merged meshes
    bGeos.forEach((list, vi) => {
      const m = new THREE.Mesh(mergeGeos(list, false), wallMats[vi]);
      m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false;
      scene.add(m); worldMeshes.push(m);
    });
    const propMesh = new THREE.Mesh(mergeGeos(props, true), propMat);
    propMesh.castShadow = true; propMesh.receiveShadow = true; propMesh.matrixAutoUpdate = false;
    scene.add(propMesh); worldMeshes.push(propMesh);
    const walkMesh = new THREE.Mesh(mergeGeos(walks, false), walkMat);
    walkMesh.receiveShadow = true; walkMesh.matrixAutoUpdate = false;
    scene.add(walkMesh); worldMeshes.push(walkMesh);
    const headMesh = new THREE.Mesh(mergeGeos(heads, false), lampHeadMat);
    headMesh.matrixAutoUpdate = false; scene.add(headMesh);
    const coneMesh = new THREE.Mesh(mergeGeos(cones, false), coneMat);
    coneMesh.matrixAutoUpdate = false; coneMesh.renderOrder = 3; scene.add(coneMesh);
  }
  buildCity();

  // Lamp halo glows ("bloom" without a post-processing pass)
  const glowGeo = new THREE.BufferGeometry();
  (function buildLampGlows() {
    const pos = new Float32Array(lamps.length * 3), col = new Float32Array(lamps.length * 3);
    lamps.forEach((L, i) => {
      L.gi = i;
      pos[i * 3] = L.x; pos[i * 3 + 1] = L.y + 0.2; pos[i * 3 + 2] = L.z;
      col[i * 3] = 1; col[i * 3 + 1] = 0.66; col[i * 3 + 2] = 0.36;
    });
    glowGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    glowGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(glowGeo, new THREE.PointsMaterial({
      size: 3.2, map: glowTex, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true
    }));
    pts.renderOrder = 4;
    scene.add(pts);
  })();

  /** Circle vs AABB collision. Pushes pos out of boxes; returns the ground height under the feet. */
  function resolveCircle(pos, radius, feetY) {
    let ground = 0;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (!c.active) continue;
      const cx = pos.x < c.minX ? c.minX : pos.x > c.maxX ? c.maxX : pos.x;
      const cz = pos.z < c.minZ ? c.minZ : pos.z > c.maxZ ? c.maxZ : pos.z;
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (feetY >= c.top - 0.35) { if (c.top > ground) ground = c.top; continue; }
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), push = radius - d;
        pos.x += (dx / d) * push; pos.z += (dz / d) * push;
      } else {
        const l = pos.x - c.minX, r = c.maxX - pos.x, b = pos.z - c.minZ, f = c.maxZ - pos.z;
        const m = Math.min(l, r, b, f);
        if (m === l) pos.x = c.minX - radius;
        else if (m === r) pos.x = c.maxX + radius;
        else if (m === b) pos.z = c.minZ - radius;
        else pos.z = c.maxZ + radius;
      }
    }
    return ground;
  }
  function pointBlocked(x, z, r) {
    for (const c of colliders) {
      if (c.active && x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
    }
    return false;
  }
  /** 2D segment vs building AABBs (slab test). Used by enemy navigation. */
  function segmentBlocked(x1, z1, x2, z2, pad) {
    const dx = x2 - x1, dz = z2 - z1;
    for (const c of colliders) {
      if (!c.building) continue;
      let tmin = 0, tmax = 1;
      const minX = c.minX - pad, maxX = c.maxX + pad, minZ = c.minZ - pad, maxZ = c.maxZ + pad;
      if (Math.abs(dx) < 1e-8) { if (x1 < minX || x1 > maxX) continue; }
      else {
        let t1 = (minX - x1) / dx, t2 = (maxX - x1) / dx;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      if (Math.abs(dz) < 1e-8) { if (z1 < minZ || z1 > maxZ) continue; }
      else {
        let t1 = (minZ - z1) / dz, t2 = (maxZ - z1) / dz;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      return true;
    }
    return false;
  }

  /* =========================================================================
   * 06a. FX: pooled GPU particles, tracers, screen shake
   * ======================================================================= */
  const PARTICLE_VS = [
    'attribute float size; attribute float alpha; attribute vec3 pcolor;',
    'uniform float scale; varying float vAlpha; varying vec3 vColor;',
    'void main(){',
    '  vColor = pcolor; vAlpha = alpha;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = size * scale / max(0.1, -mv.z);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  const PARTICLE_FS = [
    'uniform sampler2D map; varying float vAlpha; varying vec3 vColor;',
    'void main(){',
    '  vec4 t = texture2D(map, gl_PointCoord);',
    '  float a = t.a * vAlpha;',
    '  if (a < 0.01) discard;',
    '  gl_FragColor = vec4(vColor * t.rgb, a);',
    '}'
  ].join('\n');

  /** Fixed-size ring-buffer particle system: one draw call, zero allocations after init. */
  class ParticleSystem {
    constructor(max, texture, additive) {
      this.max = max; this.cursor = 0; this.alive = 0;
      this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
      this.alpha = new Float32Array(max); this.size = new Float32Array(max);
      this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
      this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max);
      this.grav = new Float32Array(max); this.drag = new Float32Array(max);
      for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -1000;
      const g = new THREE.BufferGeometry();
      this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
      this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
      this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
      this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', this.aPos); g.setAttribute('pcolor', this.aCol);
      g.setAttribute('alpha', this.aAlpha); g.setAttribute('size', this.aSize);
      this.mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: texture }, scale: { value: 400 } },
        vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
        transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
      });
      this.points = new THREE.Points(g, this.mat);
      this.points.frustumCulled = false;
      this.points.renderOrder = additive ? 6 : 5;
      scene.add(this.points);
    }
    spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, grav, drag) {
      const i = this.cursor;
      this.cursor = (i + 1) % this.max;
      const i3 = i * 3;
      if (this.life[i] <= 0) this.alive++;
      this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
      this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
      this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
      this.life[i] = life; this.maxLife[i] = life;
      this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a;
      this.grav[i] = grav; this.drag[i] = drag;
      this.size[i] = s0; this.alpha[i] = 0;
    }
    update(dt) {
      if (this.alive <= 0) return;
      let alive = 0;
      for (let i = 0; i < this.max; i++) {
        if (this.life[i] <= 0) continue;
        const i3 = i * 3;
        this.life[i] -= dt;
        if (this.life[i] <= 0) {
          this.alpha[i] = 0; this.size[i] = 0; this.pos[i3 + 1] = -1000;
          continue;
        }
        alive++;
        const t = 1 - this.life[i] / this.maxLife[i];
        const damp = Math.max(0, 1 - this.drag[i] * dt);
        this.vel[i3] *= damp; this.vel[i3 + 2] *= damp;
        this.vel[i3 + 1] = this.vel[i3 + 1] * damp - this.grav[i] * dt;
        this.pos[i3] += this.vel[i3] * dt;
        this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
        this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
        if (this.pos[i3 + 1] < 0.03 && this.grav[i] > 0) { this.pos[i3 + 1] = 0.03; this.vel[i3 + 1] *= -0.3; }
        this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
        this.alpha[i] = this.a0[i] * Math.min(1, t * 8) * (1 - t);
      }
      this.alive = alive;
      this.aPos.needsUpdate = true; this.aCol.needsUpdate = true;
      this.aAlpha.needsUpdate = true; this.aSize.needsUpdate = true;
    }
    clear() {
      for (let i = 0; i < this.max; i++) { this.life[i] = 0; this.alpha[i] = 0; this.size[i] = 0; this.pos[i * 3 + 1] = -1000; }
      this.alive = 1; this.update(0);
    }
  }

  const sparks = new ParticleSystem(700, glowTex, true);   // fire, sparks, embers, flashes
  const smoke = new ParticleSystem(460, smokeTex, false);  // smoke, dust, blood, debris
  let particleMult = 1;
  const cnt = (n) => Math.max(1, Math.round(n * particleMult));

  function fxImpact(p, n) {
    const c = cnt(9);
    for (let i = 0; i < c; i++) {
      const s = rand(2, 6);
      sparks.spawn(p.x, p.y, p.z, n.x * s + rand(-2, 2), n.y * s + rand(-1, 3), n.z * s + rand(-2, 2), rand(0.12, 0.35), 0.09, 0.02, 1, 0.62, 0.25, 1, 12, 1);
    }
    sparks.spawn(p.x + n.x * 0.05, p.y + n.y * 0.05, p.z + n.z * 0.05, 0, 0, 0, 0.07, 0.8, 0.2, 1, 0.8, 0.5, 1, 0, 0);
    const d = cnt(3);
    for (let i = 0; i < d; i++) {
      smoke.spawn(p.x + n.x * 0.1, p.y + n.y * 0.1, p.z + n.z * 0.1, n.x * 0.8 + rand(-0.3, 0.3), n.y * 0.8 + rand(0.1, 0.5), n.z * 0.8 + rand(-0.3, 0.3), rand(0.6, 1.2), 0.25, 1.1, 0.34, 0.32, 0.3, 0.5, -0.3, 1.5);
    }
  }
  function fxBlood(p, dir, def) {
    const c = cnt(9), b = def.blood, s = def.spark;
    for (let i = 0; i < c; i++) {
      smoke.spawn(p.x, p.y, p.z, dir.x * rand(1, 3) + rand(-1, 1), rand(0, 2.5), dir.z * rand(1, 3) + rand(-1, 1), rand(0.35, 0.7), 0.13, 0.05, b[0], b[1], b[2], 0.95, 14, 1);
    }
    const k = cnt(4);
    for (let i = 0; i < k; i++) {
      sparks.spawn(p.x, p.y, p.z, rand(-2, 2) - dir.x, rand(0, 2), rand(-2, 2) - dir.z, rand(0.1, 0.25), 0.1, 0.02, s[0], s[1], s[2], 0.9, 6, 1);
    }
  }
  function fxDeath(p, def) {
    const b = def.blood, s = def.spark, k = def.scale;
    const c = cnt(18);
    for (let i = 0; i < c; i++) {
      smoke.spawn(p.x + rand(-0.3, 0.3) * k, p.y + rand(-0.5, 0.5) * k, p.z + rand(-0.3, 0.3) * k, rand(-2.5, 2.5), rand(0.5, 4), rand(-2.5, 2.5), rand(0.4, 0.9), 0.16 * k, 0.06, b[0], b[1], b[2], 0.95, 12, 0.8);
    }
    const d = cnt(6);
    for (let i = 0; i < d; i++) {
      smoke.spawn(p.x, p.y - 0.5, p.z, rand(-0.6, 0.6), rand(0.3, 1), rand(-0.6, 0.6), rand(1, 1.8), 0.6 * k, 2.2 * k, 0.12, 0.11, 0.12, 0.55, -0.2, 1);
    }
    const e = cnt(12);
    for (let i = 0; i < e; i++) {
      sparks.spawn(p.x, p.y + 0.4 * k, p.z, rand(-3, 3), rand(0, 4), rand(-3, 3), rand(0.2, 0.5), 0.14, 0.02, s[0], s[1], s[2], 1, 8, 1);
    }
  }
  function fxMuzzleWorld(p, dir) {
    const c = cnt(2);
    for (let i = 0; i < c; i++) {
      smoke.spawn(p.x + dir.x * 0.15, p.y + dir.y * 0.15, p.z + dir.z * 0.15, dir.x * 1.2 + rand(-0.2, 0.2), dir.y * 1.2 + rand(0.2, 0.6), dir.z * 1.2 + rand(-0.2, 0.2), rand(0.6, 1.1), 0.12, 0.8, 0.55, 0.55, 0.55, 0.3, -0.4, 2.2);
    }
    const s = cnt(3);
    for (let i = 0; i < s; i++) {
      sparks.spawn(p.x, p.y, p.z, dir.x * rand(8, 16) + rand(-1, 1), dir.y * rand(8, 16) + rand(-1, 1), dir.z * rand(8, 16) + rand(-1, 1), rand(0.04, 0.1), 0.07, 0.02, 1, 0.75, 0.35, 1, 0, 0);
    }
  }
  function fxExplosion(p) {
    sparks.spawn(p.x, p.y + 1, p.z, 0, 0, 0, 0.14, 9, 3, 1, 0.85, 0.55, 1, 0, 0);
    const f = cnt(42);
    for (let i = 0; i < f; i++) {
      sparks.spawn(p.x + rand(-0.5, 0.5), p.y + rand(0, 1), p.z + rand(-0.5, 0.5), rand(-6, 6), rand(1, 8), rand(-6, 6), rand(0.4, 0.85), rand(1.3, 2.2), 0.2, 1, rand(0.35, 0.6), 0.12, 1, 2, 3);
    }
    const h = cnt(30);
    for (let i = 0; i < h; i++) {
      sparks.spawn(p.x, p.y + 0.5, p.z, rand(-14, 14), rand(4, 16), rand(-14, 14), rand(0.5, 1.1), 0.14, 0.03, 1, 0.7, 0.3, 1, 16, 0.6);
    }
    const s = cnt(24);
    for (let i = 0; i < s; i++) {
      smoke.spawn(p.x + rand(-1, 1), p.y + rand(0.3, 1.6), p.z + rand(-1, 1), rand(-1.6, 1.6), rand(0.8, 2.6), rand(-1.6, 1.6), rand(2, 3.6), rand(1.2, 2), rand(4, 6.5), 0.09, 0.085, 0.08, 0.72, -0.3, 0.8);
    }
    const d = cnt(16);
    for (let i = 0; i < d; i++) {
      smoke.spawn(p.x, p.y + 0.6, p.z, rand(-9, 9), rand(4, 11), rand(-9, 9), rand(0.9, 1.6), 0.16, 0.12, 0.08, 0.07, 0.06, 1, 20, 0.3);
    }
  }
  function fxDust(x, z, count, radius) {
    const c = cnt(count);
    for (let i = 0; i < c; i++) {
      const a = Math.random() * TAU, r = rand(0.2, radius);
      smoke.spawn(x + Math.cos(a) * r, 0.2, z + Math.sin(a) * r, Math.cos(a) * rand(0.8, 2.2), rand(0.2, 1), Math.sin(a) * rand(0.8, 2.2), rand(0.8, 1.6), 0.5, 1.8, 0.28, 0.25, 0.22, 0.5, -0.1, 1.6);
    }
  }

  // Bullet tracers (pooled additive boxes)
  const tracerGeo = new THREE.BoxGeometry(0.028, 0.028, 1);
  const tracers = [];
  for (let i = 0; i < 28; i++) {
    const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    m.visible = false; m.renderOrder = 7;
    scene.add(m);
    tracers.push({ mesh: m, life: 0 });
  }
  let tracerIdx = 0;
  function spawnTracer(a, b, color) {
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % tracers.length;
    const len = a.distanceTo(b);
    if (len < 0.5) return;
    t.mesh.position.copy(a).lerp(b, 0.5);
    t.mesh.lookAt(b);
    t.mesh.scale.set(1, 1, len);
    t.mesh.material.color.setHex(color);
    t.mesh.material.opacity = 0.9;
    t.mesh.visible = true;
    t.life = 0.07;
  }
  function updateTracers(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
      if (t.life <= 0) t.mesh.visible = false;
    }
  }

  let shake = 0;
  const addShake = (v) => { shake = Math.min(1.3, shake + v); };

  /* =========================================================================
   * 06b. PLAYER, FIRST-PERSON WEAPONS & SHOOTING
   * ======================================================================= */
  let state = 'menu';        // menu | playing | paused | dead | over
  let score = 0, kills = 0, gameTime = 0, dmgFlash = 0;
  let maxAlive = 10, enemyShadows = false, activeQuality = Settings.quality;

  const player = {
    pos: new THREE.Vector3(0, 0, 2), vx: 0, vz: 0, velY: 0, grounded: true,
    yaw: 0, pitch: 0, hp: PLAYER_CFG.maxHp, alive: true, eye: PLAYER_CFG.eye,
    lastHurt: -99, moving: 0, running: false, bobT: 0, deathT: 0
  };

  const arsenal = WEAPONS.map((def) => ({ def, mag: def.mag, reserve: def.reserve }));
  let curW = 0, fireCd = 0, reloadT = 0, switchT = 0, pendingSwitch = 0, switchSwapped = true, autoReloadT = 0, flashT = 0;
  const vm = { kick: 0, swayX: 0, swayY: 0, lookX: 0, lookY: 0, bobT: 0, recoilPitch: 0, heat: 0 };

  // ---- Viewmodels (built from primitives, rendered in weaponScene)
  const vmRoot = new THREE.Group();
  weaponScene.add(vmRoot);
  const gm = {
    metal: new THREE.MeshStandardMaterial({ color: 0x5a616b, metalness: 0.3, roughness: 0.4 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.2, roughness: 0.6 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x24201c, metalness: 0.1, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x4a2f1c, metalness: 0.05, roughness: 0.75 }),
    accent: new THREE.MeshStandardMaterial({ color: 0x0c120c, emissive: NEON, emissiveIntensity: 0.9 })
  };
  function vbox(parent, w, h, d, mat, x, y, z, rx) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.x = rx || 0;
    parent.add(m); return m;
  }
  function vcyl(parent, r, len, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
    m.rotation.x = Math.PI / 2; m.position.set(x, y, z);
    parent.add(m); return m;
  }
  function buildPistol() {
    const g = new THREE.Group();
    vbox(g, 0.07, 0.075, 0.3, gm.metal, 0, 0.03, -0.05);
    vbox(g, 0.066, 0.05, 0.26, gm.dark, 0, -0.022, -0.04);
    vbox(g, 0.062, 0.17, 0.085, gm.grip, 0, -0.11, 0.07, 0.22);
    vbox(g, 0.074, 0.01, 0.2, gm.accent, 0, 0.069, -0.06);
    vcyl(g, 0.014, 0.05, gm.dark, 0, 0.03, -0.215);
    vbox(g, 0.024, 0.026, 0.02, gm.dark, 0, 0.08, 0.08);
    vbox(g, 0.012, 0.022, 0.012, gm.accent, 0, 0.078, -0.18);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.26);
    g.userData.base = new THREE.Vector3(0.2, -0.2, -0.46);
    return g;
  }
  function buildRifle() {
    const g = new THREE.Group();
    vbox(g, 0.08, 0.11, 0.42, gm.metal, 0, 0, 0);
    vbox(g, 0.088, 0.085, 0.26, gm.dark, 0, -0.005, -0.3);
    vbox(g, 0.092, 0.01, 0.22, gm.accent, 0, 0.012, -0.3);
    vcyl(g, 0.017, 0.3, gm.dark, 0, 0.01, -0.56);
    vcyl(g, 0.026, 0.06, gm.metal, 0, 0.01, -0.72);
    vbox(g, 0.05, 0.19, 0.085, gm.dark, 0, -0.14, -0.06, 0.25);
    vbox(g, 0.065, 0.11, 0.24, gm.dark, 0, -0.02, 0.3);
    vbox(g, 0.05, 0.13, 0.06, gm.grip, 0, -0.11, 0.12, 0.35);
    vbox(g, 0.035, 0.045, 0.14, gm.dark, 0, 0.08, -0.02);
    vbox(g, 0.03, 0.014, 0.03, gm.accent, 0, 0.108, -0.02);
    g.userData.muzzle = new THREE.Vector3(0, 0.01, -0.76);
    g.userData.base = new THREE.Vector3(0.22, -0.22, -0.42);
    return g;
  }
  function buildShotgun() {
    const g = new THREE.Group();
    vcyl(g, 0.026, 0.62, gm.metal, 0, 0.025, -0.33);
    vcyl(g, 0.02, 0.5, gm.dark, 0, -0.03, -0.27);
    vbox(g, 0.075, 0.065, 0.17, gm.wood, 0, -0.03, -0.33);
    vbox(g, 0.085, 0.11, 0.24, gm.dark, 0, 0, 0.04);
    vbox(g, 0.088, 0.012, 0.2, gm.accent, 0, 0.02, 0.04);
    vbox(g, 0.07, 0.12, 0.3, gm.wood, 0, -0.045, 0.3, -0.12);
    vbox(g, 0.02, 0.02, 0.02, gm.accent, 0, 0.05, -0.62);
    g.userData.muzzle = new THREE.Vector3(0, 0.025, -0.67);
    g.userData.base = new THREE.Vector3(0.22, -0.21, -0.4);
    return g;
  }
  const gunModels = [buildPistol(), buildRifle(), buildShotgun()];
  gunModels.forEach((g) => { g.visible = false; vmRoot.add(g); });
  const muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xffd08a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  muzzleFlash.visible = false;

  function showGun(i) {
    gunModels.forEach((g, k) => { g.visible = k === i; });
    const g = gunModels[i];
    g.add(muzzleFlash);
    muzzleFlash.position.copy(g.userData.muzzle);
    g.add(vmFlashLight);
    vmFlashLight.position.copy(g.userData.muzzle);
  }
  showGun(0);

  // ---- Shooting
  const raycaster = new THREE.Raycaster();
  const rayTargets = [];
  let rayDirty = true;
  function rebuildRayTargets() {
    rayTargets.length = 0;
    for (const m of worldMeshes) rayTargets.push(m);
    for (const b of barrels) if (b.active) rayTargets.push(b.mesh);
    for (const e of enemies) if (e.state !== 'dying' && e.state !== 'idle') for (const h of e.hitMeshes) rayTargets.push(h);
    rayDirty = false;
  }

  /** Nearest enemy within a small cone around the aim direction (light mobile aim assist + crosshair feedback). */
  function findConeTarget(origin, dir, maxDist, cone) {
    let best = null, bestA = cone;
    for (const e of enemies) {
      if (e.state === 'dying' || e.state === 'idle' || (e.state === 'spawn' && e.spawnT < 0.5)) continue;
      _v3.copy(e.root.position); _v3.y += 1.2 * e.def.scale; _v3.sub(origin);
      const d = _v3.length();
      if (d > maxDist) continue;
      const a = _v3.angleTo(dir) / (0.8 + 0.2 * e.def.scale * e.def.scale);
      if (a < bestA) { bestA = a; best = e; }
    }
    return best;
  }

  function shootPellet(def, origin, spread, assist, withTracer) {
    _dir.copy(_baseDir);
    if (spread > 0) {
      const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * spread;
      _dir.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
    }
    raycaster.set(origin, _dir);
    raycaster.far = def.range;
    const hits = raycaster.intersectObjects(rayTargets, false);
    let hit = hits.length ? hits[0] : null;
    let hitDist = hit ? hit.distance : def.range;
    let target = null, isHead = false;
    if (hit && hit.object.userData.enemy) { target = hit.object.userData.enemy; isHead = !!hit.object.userData.head; }
    _v1.copy(origin).addScaledVector(_dir, hitDist);
    if (!target && assist) {
      const e = findConeTarget(origin, _dir, Math.min(hitDist + 0.5, def.range), IS_TOUCH ? 0.055 : 0.022);
      if (e) {
        target = e; hit = null;
        _v1.copy(e.root.position); _v1.y += 1.2 * e.def.scale;
        hitDist = origin.distanceTo(_v1);
      }
    }
    if (target) {
      let dmg = def.damage * (isHead ? def.headMul : 1);
      if (def.pellets > 1) dmg *= clamp(1 - (hitDist / def.range) * 0.55, 0.45, 1);
      damageEnemy(target, dmg, _v1, _dir, isHead, false);
    } else if (hit) {
      if (hit.face) _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      else _n.copy(_dir).negate();
      fxImpact(hit.point, _n);
      if (hit.object.userData.barrel) damageBarrel(hit.object.userData.barrel, def.damage);
    }
    if (withTracer) spawnTracer(_muzzle, _v1, def.tracer);
  }

  function tryFire() {
    if (switchT > 0 || reloadT > 0 || fireCd > 0) return;
    const w = arsenal[curW], def = w.def;
    if (w.mag <= 0) {
      Sound.empty();
      fireCd = 0.3;
      if (w.reserve > 0) startReload(); else toast('OUT OF AMMO: SWAP WEAPON');
      return;
    }
    w.mag--;
    fireCd = def.interval;
    if (rayDirty) rebuildRayTargets();

    camera.updateMatrixWorld();
    camera.getWorldDirection(_baseDir);
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    _muzzle.set(0.2, -0.17, -0.85).applyQuaternion(camera.quaternion).add(camera.position);

    const spread = def.spread * (1 + vm.heat * 0.35 + player.moving * 0.6 + (player.grounded ? 0 : 1));
    for (let p = 0; p < def.pellets; p++) {
      shootPellet(def, camera.position, spread, p === 0, def.pellets === 1 || p % 2 === 0);
    }

    // Feedback: recoil, flash, smoke, light, sound, shake
    vm.kick = Math.min(0.3, vm.kick + def.kick);
    vm.recoilPitch += def.recoil;
    player.pitch = clamp(player.pitch + def.recoil * 0.35, -1.4, 1.4);
    player.yaw += (Math.random() - 0.5) * def.recoil * 0.4;
    vm.heat = Math.min(4, vm.heat + 1);
    flashT = 0.05;
    const fs = def.flash * rand(0.85, 1.2);
    muzzleFlash.scale.set(fs, fs, 1);
    muzzleFlash.material.rotation = Math.random() * TAU;
    muzzleLight.position.copy(_muzzle);
    muzzleLight.intensity = 2.8;
    fxMuzzleWorld(_muzzle, _baseDir);
    Sound.shot(def.id);
    addShake(def.shake);
    if (w.mag === 0 && w.reserve > 0) autoReloadT = 0.3;
  }

  function startReload() {
    if (reloadT > 0 || switchT > 0) return;
    const w = arsenal[curW];
    if (w.mag >= w.def.mag) return;
    if (w.reserve <= 0) { Sound.empty(); toast('NO RESERVE AMMO'); return; }
    reloadT = w.def.reload;
    Sound.reload();
  }
  function finishReload() {
    const w = arsenal[curW];
    const take = Math.min(w.def.mag - w.mag, w.reserve);
    w.mag += take;
    w.reserve -= take;
    Sound.reloadDone();
  }
  function switchWeapon(idx) {
    if (idx === curW && switchT <= 0) return;
    if (switchT > 0) return;
    reloadT = 0; autoReloadT = 0;
    pendingSwitch = idx; switchT = SWITCH_TIME; switchSwapped = false;
    Sound.swap();
  }
  function jump() {
    if (player.grounded && player.alive) { player.velY = PLAYER_CFG.jump; player.grounded = false; }
  }

  function updateWeapons(dt) {
    fireCd -= dt;
    vm.heat = Math.max(0, vm.heat - dt * 4);
    if (switchT > 0) {
      switchT -= dt;
      if (!switchSwapped && switchT < SWITCH_TIME / 2) { switchSwapped = true; curW = pendingSwitch; showGun(curW); }
      if (switchT < 0) switchT = 0;
    }
    if (reloadT > 0) { reloadT -= dt; if (reloadT <= 0) { reloadT = 0; finishReload(); } }
    if (autoReloadT > 0) { autoReloadT -= dt; if (autoReloadT <= 0) { autoReloadT = 0; startReload(); } }
    if ((input.firing || input.mouseFire) && player.alive) tryFire();
  }

  function updatePlayer(dt) {
    // Look
    const tf = 0.0052 * Settings.sensitivity, mf = 0.0022 * Settings.sensitivity;
    const dYaw = input.lookDX * tf + input.mouseDX * mf;
    const dPitch = input.lookDY * tf + input.mouseDY * mf;
    player.yaw -= dYaw; player.pitch -= dPitch;
    vm.lookX = dYaw; vm.lookY = dPitch;
    input.lookDX = input.lookDY = input.mouseDX = input.mouseDY = 0;
    player.pitch = clamp(player.pitch, -1.4, 1.4);

    // Move (joystick or keyboard)
    let mx = input.moveX, my = input.moveY;
    const k = input.keys;
    const kx = ((k.KeyD || k.ArrowRight) ? 1 : 0) - ((k.KeyA || k.ArrowLeft) ? 1 : 0);
    const ky = ((k.KeyS || k.ArrowDown) ? 1 : 0) - ((k.KeyW || k.ArrowUp) ? 1 : 0);
    if (kx || ky) { const l = Math.hypot(kx, ky); mx = kx / l; my = ky / l; }
    const mag = Math.min(1, Math.hypot(mx, my));
    const autoRun = IS_TOUCH && mag > 0.95 && my < -0.7;
    player.running = (input.sprint || k.ShiftLeft || k.ShiftRight || autoRun) && my < -0.3;
    const speed = (player.running ? PLAYER_CFG.run : PLAYER_CFG.walk) * ((input.firing || input.mouseFire) ? 0.85 : 1);
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    const fwd = -my, str = mx;
    const tvx = (-sin * fwd + cos * str) * speed;
    const tvz = (-cos * fwd - sin * str) * speed;
    const accel = Math.min(1, dt * (player.grounded ? 12 : 3));
    player.vx = lerp(player.vx, tvx, accel);
    player.vz = lerp(player.vz, tvz, accel);
    player.pos.x += player.vx * dt;
    player.pos.z += player.vz * dt;

    const ground = resolveCircle(player.pos, PLAYER_CFG.radius, player.pos.y);
    player.pos.x = clamp(player.pos.x, -WORLD_LIMIT, WORLD_LIMIT);
    player.pos.z = clamp(player.pos.z, -WORLD_LIMIT, WORLD_LIMIT);

    player.velY -= PLAYER_CFG.gravity * dt;
    player.pos.y += player.velY * dt;
    if (player.pos.y <= ground) {
      if (!player.grounded && player.velY < -7) addShake(0.12);
      player.pos.y = ground; player.velY = 0; player.grounded = true;
    } else {
      player.grounded = player.pos.y - ground < 0.02;
    }
    player.moving = Math.min(1.6, Math.hypot(player.vx, player.vz) / PLAYER_CFG.walk);

    // Slow regeneration when out of combat (caps at half health)
    if (gameTime - player.lastHurt > 6 && player.hp < PLAYER_CFG.maxHp * 0.5) {
      player.hp = Math.min(PLAYER_CFG.maxHp * 0.5, player.hp + 3 * dt);
    }
  }

  function hurtPlayer(amount, fromX, fromZ) {
    if (!player.alive) return;
    player.hp = Math.max(0, player.hp - amount);
    player.lastHurt = gameTime;
    dmgFlash = Math.min(1, dmgFlash + 0.35 + amount / 70);
    addShake(0.25 + amount / 60);
    Sound.hurt();
    showDamageIndicator(fromX, fromZ);
    if (player.hp <= 0) die();
  }

  function die() {
    player.alive = false;
    state = 'dead';
    player.deathT = 0;
    input.firing = false; input.mouseFire = false;
    exitPointerLock();
    Sound.death(1.3);
  }

  function updateCamera(dt) {
    const mv = Math.min(1, player.moving);
    player.bobT += dt * (player.running ? 12 : 8.5) * mv;
    const bobY = player.grounded ? Math.sin(player.bobT * 2) * 0.045 * mv : 0;
    camera.position.set(player.pos.x, player.pos.y + player.eye + bobY, player.pos.z);
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake * 0.16;
      camera.position.y += (Math.random() - 0.5) * shake * 0.16;
    }
    vm.recoilPitch = lerp(vm.recoilPitch, 0, Math.min(1, dt * 9));
    const sp = shake > 0 ? (Math.random() - 0.5) * shake * 0.02 : 0;
    camera.rotation.set(player.pitch + vm.recoilPitch + sp, player.yaw + sp, Math.sin(player.bobT) * 0.006 * mv);
    shake = Math.max(0, shake - dt * 2.2);
    camera.getWorldDirection(_fxv);
    flashlight.position.copy(camera.position).addScaledVector(_right.set(1, 0, 0).applyQuaternion(camera.quaternion), 0.25);
    flashlight.target.position.copy(camera.position).addScaledVector(_fxv, 12);
    flashlight.intensity = 1.6;
  }

  function updateViewmodel(dt) {
    const def = arsenal[curW].def, g = gunModels[curW], base = g.userData.base;
    vm.kick *= Math.exp(-dt * 14);
    vm.swayX = lerp(vm.swayX, clamp(vm.lookX * 0.9, -0.04, 0.04), Math.min(1, dt * 10));
    vm.swayY = lerp(vm.swayY, clamp(-vm.lookY * 0.9, -0.04, 0.04), Math.min(1, dt * 10));
    const mv = player.grounded ? Math.min(1, player.moving) : 0;
    vm.bobT += dt * (player.running ? 13 : 9) * mv;
    const bx = Math.sin(vm.bobT) * 0.012 * mv;
    const by = -Math.abs(Math.cos(vm.bobT)) * 0.014 * mv;
    let y = 0, rotX = 0, rotZ = 0, rotY = 0;
    if (reloadT > 0) {
      const p = 1 - reloadT / def.reload;
      const kk = Math.sin(Math.min(1, p) * Math.PI);
      y -= kk * 0.12; rotX -= kk * 0.45; rotZ += kk * 0.55;
    }
    if (switchT > 0) {
      const half = SWITCH_TIME / 2;
      const kk = switchT > half ? (SWITCH_TIME - switchT) / half : switchT / half;
      y -= kk * 0.38; rotX -= kk * 0.4;
    }
    if (player.running && reloadT <= 0) { rotY += 0.35; rotZ += 0.18; y -= 0.03; }
    if (!player.grounded) y += clamp(player.velY * 0.004, -0.03, 0.03);
    vmRoot.position.set(base.x + bx - vm.swayX, base.y + by + y + vm.swayY, base.z + vm.kick * 0.5);
    vmRoot.rotation.set(vm.kick * 1.3 + rotX, rotY, rotZ);

    flashT -= dt;
    const on = flashT > 0;
    muzzleFlash.visible = on;
    vmFlashLight.intensity = on ? 3 : 0;
    muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 50);
  }

  /* =========================================================================
   * 07. ENEMIES & AI
   *     States: spawn -> chase -> windup -> recover -> chase ... -> dying
   *     Navigation: direct chase when line of sight is clear, otherwise
   *     greedy hop between road intersections toward the player.
   * ======================================================================= */
  const enemies = [];
  const enemyPools = { walker: [], runner: [], brute: [] };
  const geoCache = new Map();
  function cachedBox(w, h, d) {
    const key = w.toFixed(3) + '|' + h.toFixed(3) + '|' + d.toFixed(3);
    let g = geoCache.get(key);
    if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(key, g); }
    return g;
  }
  const spikeGeo = new THREE.ConeGeometry(0.07, 0.3, 6);
  const hbGeo = new THREE.PlaneGeometry(0.9, 0.08);
  const hbBgMat = new THREE.MeshBasicMaterial({ color: 0x07090c, transparent: true, opacity: 0.6, depthWrite: false });

  function createEnemy(typeKey) {
    const def = ENEMY_TYPES[typeKey];
    const skin = new THREE.MeshStandardMaterial({ color: def.skin, roughness: 0.82, metalness: 0.05 });
    const cloth = new THREE.MeshStandardMaterial({ color: def.cloth, roughness: 0.95, metalness: 0.0 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: def.eye });
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const e = {
      typeKey, def, root, body, mats: [skin, cloth], hitMeshes: [], state: 'idle',
      hp: 0, maxHp: 0, speed: 0, damage: 0, timer: 0, flash: 0, flashOn: false, deathT: 0, spawnT: 0,
      phase: Math.random() * TAU, stuckT: 0, sideT: 0, sideDir: 1, lungeT: 0, lungeCd: 0,
      growlT: rand(2, 6), navT: 0, tx: 0, tz: 0, hasLOS: true, moveSpeed: 0
    };
    const part = (geo, mat, x, y, z, parent) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      (parent || body).add(m);
      m.userData.enemy = e;
      e.hitMeshes.push(m);
      return m;
    };
    const wide = typeKey === 'brute' ? 1.25 : typeKey === 'runner' ? 0.85 : 1;
    part(cachedBox(0.5 * wide, 0.28, 0.3), cloth, 0, 0.86, 0);
    part(cachedBox(0.62 * wide, 0.74, 0.36 * wide), cloth, 0, 1.35, 0);
    const head = part(cachedBox(0.36, 0.4, 0.36), skin, 0, 1.94, 0.03);
    head.userData.head = true;
    const eyeGeo = cachedBox(0.08, 0.045, 0.02);
    [-0.085, 0.085].forEach((x) => { const m = new THREE.Mesh(eyeGeo, eyeMat); m.position.set(x, 1.98, 0.215); body.add(m); });
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: def.eye, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
    glow.position.set(0, 1.98, 0.27); glow.scale.set(0.6, 0.32, 1);
    body.add(glow);
    const limb = (x, y, w, len, mat) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      body.add(pivot);
      part(cachedBox(w, len, w * 1.1), mat, 0, -len / 2, 0, pivot);
      return pivot;
    };
    e.legL = limb(-0.14 * wide, 0.78, 0.2 * wide, 0.78, cloth);
    e.legR = limb(0.14 * wide, 0.78, 0.2 * wide, 0.78, cloth);
    e.armL = limb(-0.41 * wide, 1.64, 0.16 * wide, 0.76, skin);
    e.armR = limb(0.41 * wide, 1.64, 0.16 * wide, 0.76, skin);
    if (typeKey === 'brute') {
      [-1, 1].forEach((s) => {
        part(cachedBox(0.36, 0.24, 0.44), cloth, s * 0.52, 1.74, 0);
        for (let k = 0; k < 3; k++) {
          const sp = new THREE.Mesh(spikeGeo, eyeMat);
          sp.position.set(s * 0.52, 1.92, -0.14 + k * 0.14);
          sp.rotation.z = -s * 0.4;
          body.add(sp);
        }
      });
    }
    root.scale.setScalar(def.scale);

    const hb = new THREE.Group();
    const bg = new THREE.Mesh(hbGeo, hbBgMat);
    const fill = new THREE.Mesh(hbGeo, new THREE.MeshBasicMaterial({ color: def.bar, transparent: true, depthWrite: false }));
    fill.position.z = 0.002;
    hb.add(bg); hb.add(fill);
    hb.scale.setScalar(def.scale > 1.2 ? 1.35 : 1);
    hb.visible = false;
    hb.renderOrder = 8;
    scene.add(hb);
    e.hb = hb; e.hbFill = fill;

    root.visible = false;
    scene.add(root);
    return e;
  }

  function setEmissive(e, f) {
    for (const m of e.mats) m.emissive.setScalar(f);
    e.flashOn = f > 0;
  }

  function spawnEnemy(typeKey, x, z) {
    const pool = enemyPools[typeKey];
    const e = pool.length ? pool.pop() : createEnemy(typeKey);
    const def = e.def, m = wave.mul;
    e.maxHp = def.hp * m.hp; e.hp = e.maxHp;
    e.speed = def.speed * m.spd * rand(0.9, 1.1);
    e.damage = def.damage * m.dmg;
    e.state = 'spawn'; e.spawnT = 0; e.deathT = 0; e.flash = 0; e.timer = 0;
    e.sideT = 0; e.stuckT = 0; e.lungeT = 0; e.lungeCd = rand(1, 3); e.navT = 0; e.tx = player.pos.x; e.tz = player.pos.z;
    setEmissive(e, 0);
    e.root.position.set(x, -2.2 * def.scale, z);
    e.root.rotation.set(0, Math.atan2(player.pos.x - x, player.pos.z - z), 0);
    e.body.rotation.set(0, 0, 0); e.body.position.set(0, 0, 0);
    e.hitMeshes.forEach((h) => { h.castShadow = enemyShadows; });
    e.hbFill.scale.x = 1; e.hbFill.position.x = 0;
    e.root.visible = true; e.hb.visible = false;
    enemies.push(e);
    rayDirty = true;
    fxDust(x, z, 14, 1.2 * def.scale);
  }

  function releaseEnemy(e) {
    const i = enemies.indexOf(e);
    if (i >= 0) { enemies[i] = enemies[enemies.length - 1]; enemies.pop(); }
    e.root.visible = false; e.hb.visible = false; e.state = 'idle';
    enemyPools[e.typeKey].push(e);
    rayDirty = true;
  }

  function liveEnemyCount() {
    let n = 0;
    for (const e of enemies) if (e.state !== 'dying') n++;
    return n;
  }

  const pendingNumbers = new Map();
  function damageEnemy(e, amount, point, dir, isHead, explosive) {
    if (e.state === 'dying' || e.state === 'idle') return;
    e.hp -= amount;
    e.flash = 0.12;
    e.hb.visible = true;
    const frac = Math.max(0, e.hp / e.maxHp);
    e.hbFill.scale.x = Math.max(0.001, frac);
    e.hbFill.position.x = -(1 - frac) * 0.45;
    fxBlood(point, dir, e.def);
    const prev = pendingNumbers.get(e);
    if (prev) { prev.amt += amount; prev.head = prev.head || isHead; }
    else pendingNumbers.set(e, { amt: amount, head: isHead });
    if (e.hp <= 0) { killEnemy(e, isHead, explosive); return; }
    if (!explosive) hitmarker(isHead ? 'head' : 'hit');
    Sound.hit(isHead);
    if (e.typeKey !== 'brute' && (e.state === 'chase' || e.state === 'recover')) {
      e.root.position.x += dir.x * 0.08;
      e.root.position.z += dir.z * 0.08;
    }
  }

  function killEnemy(e, isHead, explosive) {
    e.state = 'dying'; e.deathT = 0; e.hb.visible = false;
    rayDirty = true;
    kills++;
    const pts = Math.round(e.def.score * (1 + (wave.n - 1) * 0.1)) + (isHead ? 50 : 0) + (explosive ? 25 : 0);
    score += pts;
    popup('+' + pts + (isHead ? '  HEADSHOT' : explosive ? '  BOOM' : ''), isHead ? 'head' : '');
    hitmarker('kill');
    Sound.death(e.def.scale);
    _kv.copy(e.root.position); _kv.y += 1.1 * e.def.scale;
    fxDeath(_kv, e.def);
    const brute = e.typeKey === 'brute';
    const r = Math.random();
    if (r < (brute ? 0.5 : 0.1)) spawnPickup('health', e.root.position.x, e.root.position.z);
    else if (r < (brute ? 1.0 : 0.26)) spawnPickup('ammo', e.root.position.x, e.root.position.z);
  }

  /** Chooses where an enemy walks: the player if visible, else the best road intersection. */
  function updateNav(e) {
    const ex = e.root.position.x, ez = e.root.position.z;
    const px = player.pos.x, pz = player.pos.z;
    const pad = e.def.radius * 0.8;
    if (!segmentBlocked(ex, ez, px, pz, pad)) { e.hasLOS = true; e.tx = px; e.tz = pz; return; }
    e.hasLOS = false;
    let best = null, bestCost = Infinity;
    for (const it of intersections) {
      const d1 = Math.hypot(it.x - ex, it.z - ez);
      if (d1 < 1.5) continue;
      const cost = d1 + Math.hypot(it.x - px, it.z - pz);
      if (cost >= bestCost) continue;
      if (segmentBlocked(ex, ez, it.x, it.z, pad)) continue;
      best = it; bestCost = cost;
    }
    if (best) { e.tx = best.x; e.tz = best.z; } else { e.tx = px; e.tz = pz; }
  }

  function updateEnemies(dt) {
    const px = player.pos.x, pz = player.pos.z;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i], def = e.def, r = e.root;

      if (e.flash > 0) { e.flash -= dt; setEmissive(e, Math.max(0, e.flash / 0.12) * 0.9); }
      else if (e.flashOn) setEmissive(e, 0);

      if (e.state === 'dying') {
        e.deathT += dt;
        const t = Math.min(1, e.deathT / 0.55);
        r.rotation.x = -t * t * 1.45;
        if (e.deathT > 1.0) r.position.y -= dt * 0.8;
        if (e.deathT > 2.0) releaseEnemy(e);
        continue;
      }

      const dx = px - r.position.x, dz = pz - r.position.z;
      const dist = Math.hypot(dx, dz) || 0.001;

      if (e.state === 'spawn') {
        e.spawnT += dt;
        const t = Math.min(1, e.spawnT / 0.9);
        r.position.y = -2.2 * def.scale * (1 - t) * (1 - t);
        r.rotation.y += angleDiff(r.rotation.y, Math.atan2(dx, dz)) * Math.min(1, dt * 6);
        e.armL.rotation.x = e.armR.rotation.x = -2.6 * (1 - t);
        if (t >= 1) { r.position.y = 0; e.state = 'chase'; }
        continue;
      }

      // Navigation target (refreshed a few times per second, staggered by random offsets)
      e.navT -= dt;
      if (e.navT <= 0) { e.navT = 0.35 + Math.random() * 0.25; updateNav(e); }
      if (e.hasLOS) { e.tx = px; e.tz = pz; }

      const faceYaw = Math.atan2(dx, dz);
      let moveSpeed = 0;
      e.lungeCd -= dt;

      if (e.state === 'chase') {
        if (dist < def.range && e.hasLOS) { e.state = 'windup'; e.timer = def.windup; }
        else {
          moveSpeed = e.speed;
          if (e.typeKey === 'runner') {
            if (e.lungeT > 0) { e.lungeT -= dt; moveSpeed *= 1.75; }
            else if (dist < 7 && e.hasLOS && e.lungeCd <= 0) { e.lungeT = 0.45; e.lungeCd = 3; }
          }
        }
      } else if (e.state === 'windup') {
        e.timer -= dt;
        if (e.timer <= 0) {
          if (dist < def.range + 0.6 && player.alive) hurtPlayer(e.damage, r.position.x, r.position.z);
          if (e.typeKey === 'brute') {
            fxDust(r.position.x + Math.sin(r.rotation.y) * 1.2, r.position.z + Math.cos(r.rotation.y) * 1.2, 16, 2.2);
            addShake(Math.max(0.1, 0.55 - dist * 0.03));
            Sound.slam();
          }
          e.state = 'recover'; e.timer = def.cooldown;
        }
      } else if (e.state === 'recover') {
        e.timer -= dt;
        if (dist > def.range) moveSpeed = e.speed * 0.5;
        if (e.timer <= 0) e.state = 'chase';
      }

      // Steering: toward nav target + separation + unstick sidestep
      if (moveSpeed > 0) {
        let mx = e.tx - r.position.x, mz = e.tz - r.position.z;
        const ml = Math.hypot(mx, mz) || 1;
        mx /= ml; mz /= ml;
        if (e.sideT > 0) {
          e.sideT -= dt;
          const sx = -mz * e.sideDir, sz = mx * e.sideDir;
          mx = mx * 0.35 + sx; mz = mz * 0.35 + sz;
        }
        for (let j = 0; j < enemies.length; j++) {
          const o = enemies[j];
          if (o === e || o.state === 'dying') continue;
          const ox = r.position.x - o.root.position.x, oz = r.position.z - o.root.position.z;
          const d2 = ox * ox + oz * oz, minD = def.radius + o.def.radius;
          if (d2 < minD * minD && d2 > 1e-6) {
            const d = Math.sqrt(d2), push = (minD - d) / minD;
            mx += (ox / d) * push * 1.6; mz += (oz / d) * push * 1.6;
          }
        }
        const l2 = Math.hypot(mx, mz) || 1;
        mx /= l2; mz /= l2;
        const bx = r.position.x, bz = r.position.z;
        r.position.x += mx * moveSpeed * dt;
        r.position.z += mz * moveSpeed * dt;
        resolveCircle(r.position, def.radius, 0);
        r.position.x = clamp(r.position.x, -WORLD_LIMIT, WORLD_LIMIT);
        r.position.z = clamp(r.position.z, -WORLD_LIMIT, WORLD_LIMIT);
        const moved = Math.hypot(r.position.x - bx, r.position.z - bz);
        if (moved < moveSpeed * dt * 0.35) {
          e.stuckT += dt;
          if (e.stuckT > 0.4 && e.sideT <= 0) { e.sideT = 1.1; e.sideDir = Math.random() < 0.5 ? -1 : 1; e.stuckT = 0; e.navT = 0; }
        } else e.stuckT = Math.max(0, e.stuckT - dt);
        e.phase += dt * moveSpeed * 2.6;
        const walkYaw = Math.atan2(mx, mz);
        const targetYaw = dist < 6 ? faceYaw : walkYaw;
        r.rotation.y += angleDiff(r.rotation.y, targetYaw) * Math.min(1, dt * 8);
      } else {
        r.rotation.y += angleDiff(r.rotation.y, faceYaw) * Math.min(1, dt * 8);
      }

      // Keep enemies from overlapping the player
      const minP = def.radius + PLAYER_CFG.radius;
      const pdx = r.position.x - px, pdz = r.position.z - pz, pd = Math.hypot(pdx, pdz);
      if (pd < minP && pd > 1e-4) { r.position.x = px + (pdx / pd) * minP; r.position.z = pz + (pdz / pd) * minP; }

      // Procedural animation
      const swing = moveSpeed > 0 ? Math.sin(e.phase) : 0;
      e.legL.rotation.x = swing * 0.7;
      e.legR.rotation.x = -swing * 0.7;
      const baseArm = e.typeKey === 'brute' ? -0.35 : -1.25;
      let armX = baseArm + swing * 0.15;
      if (e.state === 'windup') armX = lerp(baseArm, -2.8, 1 - e.timer / def.windup);
      else if (e.state === 'recover') armX = lerp(-2.8, baseArm + 0.3, Math.min(1, (def.cooldown - e.timer) / 0.15));
      e.armL.rotation.x = armX + (e.state === 'chase' ? swing * 0.2 : 0);
      e.armR.rotation.x = armX - (e.state === 'chase' ? swing * 0.2 : 0);
      e.body.rotation.x = e.typeKey === 'runner' ? 0.3 : e.state === 'windup' ? -0.12 : 0.05;
      e.body.position.y = Math.abs(Math.sin(e.phase)) * 0.06;

      if (e.hb.visible) {
        e.hb.position.set(r.position.x, r.position.y + 2.4 * def.scale, r.position.z);
        e.hb.quaternion.copy(camera.quaternion);
      }

      e.growlT -= dt;
      if (e.growlT <= 0) {
        e.growlT = rand(3, 7);
        if (dist < 18) Sound.growl(clamp(1 - dist / 18, 0.1, 1) * def.scale);
      }
    }
  }

  /* =========================================================================
   * 08. PICKUPS & EXPLOSIVE BARRELS
   * ======================================================================= */
  const pickups = [];
  const pickMats = {
    health: new THREE.MeshStandardMaterial({ color: 0x163a22, emissive: 0x2dff7a, emissiveIntensity: 1.1 }),
    ammo: new THREE.MeshStandardMaterial({ color: 0x3d2e10, emissive: 0xffa820, emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.5 }),
    band: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffd060, emissiveIntensity: 1.4 })
  };
  function makePickup(type) {
    const g = new THREE.Group();
    if (type === 'health') {
      g.add(new THREE.Mesh(cachedBox(0.5, 0.16, 0.16), pickMats.health));
      g.add(new THREE.Mesh(cachedBox(0.16, 0.5, 0.16), pickMats.health));
    } else {
      g.add(new THREE.Mesh(cachedBox(0.5, 0.3, 0.3), pickMats.ammo));
      g.add(new THREE.Mesh(cachedBox(0.52, 0.06, 0.32), pickMats.band));
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: type === 'health' ? 0x40ff90 : 0xffb030, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
    glow.scale.set(1.7, 1.7, 1);
    g.add(glow);
    g.visible = false;
    scene.add(g);
    return { type, g, active: false, t: 0 };
  }
  function spawnPickup(type, x, z) {
    let p = null;
    for (const q of pickups) if (!q.active && q.type === type) { p = q; break; }
    if (!p) { if (pickups.length >= 18) return; p = makePickup(type); pickups.push(p); }
    p.active = true; p.t = 0;
    p.g.position.set(x, 0.6, z);
    p.g.visible = true;
  }
  function collectPickup(p) {
    if (p.type === 'health') {
      if (player.hp >= PLAYER_CFG.maxHp) return false;
      player.hp = Math.min(PLAYER_CFG.maxHp, player.hp + 35);
      popup('+35 HP', 'hp');
    } else {
      const rifle = arsenal[1], shotgun = arsenal[2];
      rifle.reserve = Math.min(rifle.def.maxReserve, rifle.reserve + 45);
      shotgun.reserve = Math.min(shotgun.def.maxReserve, shotgun.reserve + 10);
      popup('+AMMO', '');
    }
    Sound.pickup();
    return true;
  }
  function updatePickups(dt) {
    for (const p of pickups) {
      if (!p.active) continue;
      p.t += dt;
      p.g.rotation.y += dt * 2;
      p.g.position.y = 0.6 + Math.sin(p.t * 3) * 0.12;
      p.g.visible = p.t < 20 || Math.floor(p.t * 8) % 2 === 0;
      if (p.t > 25) { p.active = false; p.g.visible = false; continue; }
      const dx = p.g.position.x - player.pos.x, dz = p.g.position.z - player.pos.z;
      if (dx * dx + dz * dz < 1.8 && Math.abs(player.pos.y - 0) < 2.2) {
        if (collectPickup(p)) { p.active = false; p.g.visible = false; }
      }
    }
  }
  function clearPickups() { for (const p of pickups) { p.active = false; p.g.visible = false; } }

  const barrels = [];
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 14);
  const barrelMat = new THREE.MeshStandardMaterial({ map: barrelTex, roughness: 0.5, metalness: 0.45, emissive: 0x2a0600 });
  barrelSpawns.forEach((p) => {
    const m = new THREE.Mesh(barrelGeo, barrelMat);
    m.position.set(p.x, 0.55, p.z);
    m.rotation.y = Math.random() * TAU;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    const c = addCollider(p.x - 0.42, p.x + 0.42, p.z - 0.42, p.z + 0.42, 1.1, false);
    const b = { mesh: m, collider: c, hp: 30, active: true, fuse: -1, pos: m.position };
    m.userData.barrel = b;
    barrels.push(b);
  });
  function damageBarrel(b, dmg) {
    if (!b.active || b.fuse > 0) return;
    b.hp -= dmg;
    if (b.hp <= 0) b.fuse = 0.06;
  }
  function explodeBarrel(b) {
    b.active = false; b.fuse = -1;
    b.mesh.visible = false; b.collider.active = false;
    rayDirty = true;
    explosion(b.pos.x, 0.6, b.pos.z);
  }
  function explosion(x, y, z) {
    _ex.set(x, y, z);
    fxExplosion(_ex);
    explosionLight.position.set(x, y + 1.5, z);
    explosionLight.intensity = 9;
    const dp = Math.hypot(player.pos.x - x, player.pos.z - z);
    Sound.explosion(dp);
    addShake(clamp(1.3 - dp / 25, 0.15, 1.3));
    if (dp < 7 && player.alive) hurtPlayer(55 * (1 - dp / 7) + 5, x, z);
    const R = 7.5;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.state === 'dying' || e.state === 'idle') continue;
      const ex = e.root.position.x - x, ez = e.root.position.z - z, d = Math.hypot(ex, ez);
      if (d > R) continue;
      _v2.set(ex, 0, ez).normalize();
      _v3.copy(e.root.position); _v3.y += 1.1 * e.def.scale;
      damageEnemy(e, 190 * (1 - d / R) + 20, _v3, _v2, false, true);
    }
    for (const b of barrels) {
      if (!b.active || b.fuse > 0) continue;
      if (Math.hypot(b.pos.x - x, b.pos.z - z) < 5.5) b.fuse = 0.15 + Math.random() * 0.15;
    }
  }
  function updateBarrels(dt) {
    for (const b of barrels) {
      if (b.active && b.fuse > 0) {
        b.fuse -= dt;
        if (Math.random() < 0.5) sparks.spawn(b.pos.x, 1.15, b.pos.z, rand(-1, 1), rand(1, 3), rand(-1, 1), 0.3, 0.2, 0.05, 1, 0.6, 0.2, 1, 5, 1);
        if (b.fuse <= 0) explodeBarrel(b);
      }
    }
  }
  function resetBarrels() {
    for (const b of barrels) {
      b.active = true; b.hp = 30; b.fuse = -1;
      b.mesh.visible = true; b.collider.active = true;
    }
    rayDirty = true;
  }

  /* =========================================================================
   * 09. WAVE DIRECTOR
   * ======================================================================= */
  const wave = { n: 0, toSpawn: 0, spawnT: 0, breakT: 0, inBreak: false, mul: { hp: 1, dmg: 1, spd: 1 } };
  const SPAWN_LINES = [-67.5, -42, -14, 14, 42, 67.5];

  function chooseType(n) {
    const bruteP = n >= 3 ? Math.min(0.06 + (n - 3) * 0.03, 0.25) : 0;
    const runnerP = n >= 2 ? Math.min(0.2 + (n - 2) * 0.04, 0.4) : 0;
    const r = Math.random();
    if (r < bruteP) return 'brute';
    if (r < bruteP + runnerP) return 'runner';
    return 'walker';
  }
  function findSpawnPoint(out) {
    for (let tries = 0; tries < 28; tries++) {
      const line = SPAWN_LINES[(Math.random() * SPAWN_LINES.length) | 0];
      const t = rand(-64, 64);
      const vertical = Math.random() < 0.5;
      const x = vertical ? line + rand(-2.5, 2.5) : t;
      const z = vertical ? t : line + rand(-2.5, 2.5);
      const d = Math.hypot(x - player.pos.x, z - player.pos.z);
      if (d < 22 || d > 58) continue;
      if (pointBlocked(x, z, 1.1)) continue;
      out.set(x, 0, z);
      return true;
    }
    let best = null, bestD = 0;
    for (const it of intersections) {
      const d = Math.hypot(it.x - player.pos.x, it.z - player.pos.z);
      if (d > bestD && !pointBlocked(it.x, it.z, 1)) { bestD = d; best = it; }
    }
    if (best) { out.set(best.x, 0, best.z); return true; }
    return false;
  }
  function startWave(n) {
    wave.n = n;
    wave.toSpawn = Math.round(3 + n * 2.5 + n * n * 0.25);
    wave.mul = { hp: 1 + (n - 1) * 0.14, dmg: 1 + (n - 1) * 0.08, spd: 1 + Math.min(0.4, (n - 1) * 0.035) };
    wave.spawnT = 1.2;
    wave.inBreak = false;
    if (n > 1) resetBarrels();
    banner('WAVE ' + n, n === 1 ? 'SURVIVE THE NIGHT' : n === 3 ? 'BRUTES INBOUND' : 'INCOMING', false);
    Sound.wave();
  }
  function updateWaves(dt) {
    if (wave.inBreak) {
      wave.breakT -= dt;
      if (wave.breakT <= 0) startWave(wave.n + 1);
      return;
    }
    wave.spawnT -= dt;
    const live = liveEnemyCount();
    if (wave.toSpawn > 0 && wave.spawnT <= 0 && live < maxAlive) {
      const type = wave.n === 1 ? 'walker' : chooseType(wave.n);
      if (findSpawnPoint(_sp)) { spawnEnemy(type, _sp.x, _sp.z); wave.toSpawn--; }
      wave.spawnT = Math.max(0.35, 1.6 - wave.n * 0.1) * rand(0.6, 1.2);
    }
    if (wave.toSpawn === 0 && live === 0) {
      wave.inBreak = true;
      wave.breakT = 6;
      const bonus = 250 * wave.n;
      score += bonus;
      player.hp = Math.min(PLAYER_CFG.maxHp, player.hp + 25);
      const pistolAmmo = arsenal[0];
      pistolAmmo.mag = pistolAmmo.def.mag;
      banner('WAVE CLEARED', '+' + bonus + '  ·  NEXT WAVE IN 6s', true);
      Sound.clear();
    }
  }

  /* =========================================================================
   * 10. INPUT  (multi-touch pointer events + keyboard + pointer-locked mouse)
   * ======================================================================= */
  const input = {
    moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, mouseDX: 0, mouseDY: 0,
    firing: false, mouseFire: false, sprint: false, keys: Object.create(null)
  };
  const joy = { id: null, ox: 0, oy: 0, radius: 60 };
  const lookPointers = new Map();
  let firePointer = null;
  const joyZone = $('joystick-zone'), joyBase = $('joystick-base'), joyKnob = $('joystick-knob');
  const lookZone = $('look-zone'), fireBtn = $('btn-fire'), sprintBtn = $('btn-sprint');

  function updateJoy(x, y) {
    let dx = x - joy.ox, dy = y - joy.oy;
    const len = Math.hypot(dx, dy), max = joy.radius;
    if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
    joyKnob.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    let nx = dx / max, ny = dy / max;
    const m = Math.hypot(nx, ny);
    if (m < 0.12) { nx = 0; ny = 0; }
    input.moveX = nx; input.moveY = ny;
  }
  function resetJoy() {
    joy.id = null;
    input.moveX = 0; input.moveY = 0;
    joyKnob.style.transform = '';
    joyBase.classList.remove('active');
    joyBase.style.left = ''; joyBase.style.top = '';
  }
  function resetInput() {
    resetJoy();
    lookPointers.clear();
    firePointer = null;
    input.firing = false; input.mouseFire = false;
    input.lookDX = input.lookDY = input.mouseDX = input.mouseDY = 0;
    fireBtn.classList.remove('pressed');
    for (const k in input.keys) input.keys[k] = false;
  }

  joyZone.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    if (state !== 'playing' || joy.id !== null) return;
    joy.id = ev.pointerId;
    const rect = joyZone.getBoundingClientRect();
    joy.radius = (joyBase.offsetWidth / 2) || 60;
    joy.ox = ev.clientX; joy.oy = ev.clientY;
    joyBase.style.left = (ev.clientX - rect.left) + 'px';
    joyBase.style.top = (ev.clientY - rect.top) + 'px';
    joyBase.classList.add('active');
    try { joyZone.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
    updateJoy(ev.clientX, ev.clientY);
  });
  lookZone.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    if (state !== 'playing') return;
    lookPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try { lookZone.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
  });
  fireBtn.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (state !== 'playing') return;
    Sound.init();
    input.firing = true;
    firePointer = ev.pointerId;
    lookPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); // drag-to-aim while firing
    fireBtn.classList.add('pressed');
    try { fireBtn.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
  });
  window.addEventListener('pointermove', (ev) => {
    if (ev.pointerId === joy.id) updateJoy(ev.clientX, ev.clientY);
    const lp = lookPointers.get(ev.pointerId);
    if (lp) {
      input.lookDX += ev.clientX - lp.x;
      input.lookDY += ev.clientY - lp.y;
      lp.x = ev.clientX; lp.y = ev.clientY;
    }
  }, { passive: true });
  function endPointer(ev) {
    if (ev.pointerId === joy.id) resetJoy();
    lookPointers.delete(ev.pointerId);
    if (ev.pointerId === firePointer) { firePointer = null; input.firing = false; fireBtn.classList.remove('pressed'); }
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  function bindTap(el, fn) {
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      el.classList.add('pressed');
      fn();
    });
    const up = () => el.classList.remove('pressed');
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }
  bindTap($('btn-jump'), () => { if (state === 'playing') jump(); });
  bindTap($('btn-reload'), () => { if (state === 'playing') startReload(); });
  bindTap($('btn-switch'), () => { if (state === 'playing') switchWeapon((curW + 1) % arsenal.length); });
  bindTap(sprintBtn, () => {
    if (state !== 'playing') return;
    input.sprint = !input.sprint;
    sprintBtn.classList.toggle('toggled', input.sprint);
  });
  bindTap($('btn-pause'), () => { if (state === 'playing') pause(); });

  // Block browser gestures (pinch zoom, pull-to-refresh, long-press menus)
  document.addEventListener('touchmove', (ev) => { if (!ev.target.closest('.scroll')) ev.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', (ev) => ev.preventDefault());
  document.addEventListener('gesturestart', (ev) => ev.preventDefault());

  // Keyboard
  window.addEventListener('keydown', (ev) => {
    const k = ev.code;
    input.keys[k] = true;
    if (state === 'playing') {
      if (k === 'Space') { jump(); ev.preventDefault(); }
      else if (k === 'KeyR') startReload();
      else if (k === 'KeyQ') switchWeapon((curW + 1) % arsenal.length);
      else if (k === 'Digit1') switchWeapon(0);
      else if (k === 'Digit2') switchWeapon(1);
      else if (k === 'Digit3') switchWeapon(2);
      else if (k === 'KeyP' || k === 'Escape') pause();
    } else if (state === 'paused' && (k === 'KeyP')) {
      resume();
    }
  });
  window.addEventListener('keyup', (ev) => { input.keys[ev.code] = false; });

  // Mouse (desktop): pointer lock for look, left button fires
  const canLock = !!canvas.requestPointerLock;
  function requestLock() {
    if (IS_TOUCH || !canLock || document.pointerLockElement === canvas) return;
    try {
      const r = canvas.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => { /* user can click again */ });
    } catch (err) { /* ignore */ }
  }
  function exitPointerLock() {
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }
  canvas.addEventListener('mousedown', (ev) => {
    if (state !== 'playing' || IS_TOUCH) return;
    if (document.pointerLockElement !== canvas) { requestLock(); return; }
    if (ev.button === 0) input.mouseFire = true;
  });
  window.addEventListener('mouseup', (ev) => { if (ev.button === 0) input.mouseFire = false; });
  window.addEventListener('mousemove', (ev) => {
    if (document.pointerLockElement === canvas && state === 'playing') {
      input.mouseDX += ev.movementX || 0;
      input.mouseDY += ev.movementY || 0;
    }
  });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && state === 'playing' && !IS_TOUCH) pause();
  });

  /* =========================================================================
   * 11. HUD & MENUS
   * ======================================================================= */
  const H = {
    hud: $('hud'), hpFill: $('hp-fill'), hpLag: $('hp-lag'), hpText: $('hp-text'),
    score: $('score-text'), kills: $('kills-text'), wave: $('wave-text'), enemies: $('enemies-text'),
    mag: $('ammo-mag'), reserve: $('ammo-reserve'), weaponName: $('weapon-name'),
    slots: $('weapon-slots').children, ammoBox: document.querySelector('.ammo-box'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), fps: $('fps-meter'),
    reloadRing: $('reload-ring'), reloadProgress: $('reload-progress'),
    banner: $('wave-banner'), bannerTitle: $('wave-banner-title'), bannerSub: $('wave-banner-sub'),
    dmgWrap: $('dmg-indicators'), numWrap: $('dmg-numbers'), popWrap: $('score-popups'),
    fxDamage: $('fx-damage'), fxLowhp: $('fx-lowhp'), toast: $('toast')
  };
  const hudCache = Object.create(null);
  function setText(key, el, v) { if (hudCache[key] !== v) { hudCache[key] = v; el.textContent = v; } }
  function resetHudCache() { for (const k in hudCache) delete hudCache[k]; }

  function restartAnim(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // force reflow so the CSS animation restarts
    el.classList.add(cls);
  }
  function hitmarker(kind) {
    const el = H.hitmarker;
    el.classList.remove('head', 'kill');
    if (kind === 'head') el.classList.add('head');
    if (kind === 'kill') el.classList.add('kill');
    restartAnim(el, 'show');
  }
  const popEls = [];
  for (let i = 0; i < 5; i++) { const d = document.createElement('div'); d.className = 'pop'; H.popWrap.appendChild(d); popEls.push(d); }
  let popIdx = 0;
  function popup(text, cls) {
    const el = popEls[popIdx]; popIdx = (popIdx + 1) % popEls.length;
    el.textContent = text;
    el.className = 'pop' + (cls ? ' ' + cls : '');
    el.style.marginTop = (-popIdx * 4) + 'px';
    restartAnim(el, 'show');
  }
  const numEls = [];
  for (let i = 0; i < 10; i++) { const d = document.createElement('div'); d.className = 'dmg-num'; H.numWrap.appendChild(d); numEls.push(d); }
  let numIdx = 0;
  function flushDamageNumbers() {
    if (pendingNumbers.size === 0) return;
    pendingNumbers.forEach((info, e) => {
      _proj.copy(e.root.position); _proj.y += 2.1 * e.def.scale;
      _proj.project(camera);
      if (_proj.z > 1 || Math.abs(_proj.x) > 1.1 || Math.abs(_proj.y) > 1.1) return;
      const el = numEls[numIdx]; numIdx = (numIdx + 1) % numEls.length;
      el.textContent = String(Math.round(info.amt));
      el.className = 'dmg-num' + (info.head ? ' head' : '');
      const x = (_proj.x * 0.5 + 0.5) * window.innerWidth + rand(-14, 14);
      const y = (-_proj.y * 0.5 + 0.5) * window.innerHeight;
      el.style.transform = 'translate(' + x.toFixed(0) + 'px,' + y.toFixed(0) + 'px)';
      restartAnim(el, 'show');
    });
    pendingNumbers.clear();
  }
  let toastTimer = 0;
  function toast(msg) {
    H.toast.textContent = msg;
    H.toast.classList.add('show');
    toastTimer = 1.8;
  }
  function banner(title, sub, clear) {
    H.bannerTitle.textContent = title;
    H.bannerSub.textContent = sub;
    H.banner.classList.toggle('clear', !!clear);
    restartAnim(H.banner, 'show');
  }

  // Directional damage indicators (they keep pointing at the attacker while you turn)
  const dmgInds = [];
  for (let i = 0; i < 4; i++) {
    const d = document.createElement('div'); d.className = 'dmg-ind';
    H.dmgWrap.appendChild(d);
    dmgInds.push({ el: d, t: 0, x: 0, z: 0 });
  }
  function showDamageIndicator(x, z) {
    let slot = dmgInds[0];
    for (const d of dmgInds) if (d.t < slot.t) slot = d;
    slot.t = 1.3; slot.x = x; slot.z = z;
  }
  function updateDamageIndicators(dt) {
    for (const d of dmgInds) {
      if (d.t <= 0) continue;
      d.t -= dt;
      const attacker = Math.atan2(d.x - player.pos.x, d.z - player.pos.z);
      const forward = Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw));
      const rel = angleDiff(forward, attacker);
      d.el.style.transform = 'rotate(' + (-rel * 180 / Math.PI).toFixed(1) + 'deg)';
      d.el.style.opacity = Math.max(0, Math.min(1, d.t)).toFixed(2);
    }
  }

  let lastGap = -1;
  function updateHUD(dt) {
    const hpFrac = clamp(player.hp / PLAYER_CFG.maxHp, 0, 1);
    const hpKey = Math.round(hpFrac * 200);
    if (hudCache.hp !== hpKey) {
      hudCache.hp = hpKey;
      H.hpFill.style.transform = 'scaleX(' + hpFrac.toFixed(3) + ')';
      H.hpLag.style.transform = 'scaleX(' + hpFrac.toFixed(3) + ')';
      H.hpText.textContent = String(Math.ceil(player.hp));
      const low = hpFrac < 0.3 && player.alive;
      H.hud.classList.toggle('hp-low', low);
      H.fxLowhp.classList.toggle('on', low);
    }
    setText('score', H.score, String(score));
    setText('kills', H.kills, String(kills));
    setText('wave', H.wave, String(wave.n));
    setText('enemies', H.enemies, String(wave.toSpawn + liveEnemyCount()));

    const w = arsenal[curW];
    setText('mag', H.mag, String(w.mag));
    setText('res', H.reserve, w.reserve === Infinity ? '\u221E' : String(w.reserve));
    setText('wname', H.weaponName, w.def.name);
    if (hudCache.slot !== curW) {
      hudCache.slot = curW;
      for (let i = 0; i < H.slots.length; i++) H.slots[i].classList.toggle('on', i === curW);
    }
    const low = w.mag <= Math.ceil(w.def.mag * 0.25);
    if (hudCache.lowAmmo !== low) { hudCache.lowAmmo = low; H.ammoBox.classList.toggle('low', low); }

    const reloading = reloadT > 0;
    if (hudCache.reloading !== reloading) { hudCache.reloading = reloading; H.reloadRing.classList.toggle('hidden', !reloading); }
    if (reloading) H.reloadProgress.style.strokeDashoffset = (106.8 * (reloadT / w.def.reload)).toFixed(1);

    dmgFlash = Math.max(0, dmgFlash - dt * 1.8);
    const df = Math.round(dmgFlash * 50) / 50;
    if (hudCache.df !== df) { hudCache.df = df; H.fxDamage.style.opacity = String(df); }

    const gap = Math.round(w.def.gap + vm.heat * 3 + Math.min(1, player.moving) * 6 + (player.grounded ? 0 : 8));
    if (gap !== lastGap) { lastGap = gap; H.crosshair.style.setProperty('--gap', gap + 'px'); }

    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) H.toast.classList.remove('show'); }
    updateDamageIndicators(dt);
    flushDamageNumbers();
  }

  let aimT = 0, onTarget = false;
  function aimFeedback(dt) {
    aimT -= dt;
    if (aimT > 0) return;
    aimT = 0.08;
    camera.getWorldDirection(_baseDir);
    const hit = !!findConeTarget(camera.position, _baseDir, arsenal[curW].def.range, 0.045);
    if (hit !== onTarget) { onTarget = hit; H.crosshair.classList.toggle('on-target', hit); }
  }

  // ---- Screens
  const SCREENS = ['menu-main', 'menu-settings', 'menu-howto', 'menu-pause', 'menu-over'];
  let returnScreen = 'menu-main';
  function showScreen(id) { SCREENS.forEach((s) => $(s).classList.toggle('active', s === id)); }
  function setHudVisible(v) { H.hud.classList.toggle('hidden', !v); }

  function tryFullscreenLandscape() {
    if (!IS_TOUCH) return;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req && !document.fullscreenElement && !document.webkitFullscreenElement) {
      try {
        const p = req.call(el);
        if (p && typeof p.then === 'function') {
          p.then(() => {
            if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
          }).catch(() => {});
        }
      } catch (err) { /* not allowed: ignore */ }
    }
  }

  function resetGame() {
    while (enemies.length) releaseEnemy(enemies[enemies.length - 1]);
    clearPickups();
    resetBarrels();
    sparks.clear(); smoke.clear();
    pendingNumbers.clear();
    player.pos.set(0, 0, 2); player.vx = 0; player.vz = 0; player.velY = 0; player.grounded = true;
    player.yaw = 0; player.pitch = 0; player.hp = PLAYER_CFG.maxHp; player.alive = true;
    player.eye = PLAYER_CFG.eye; player.lastHurt = -99; player.deathT = 0; player.moving = 0;
    arsenal.forEach((a) => { a.mag = a.def.mag; a.reserve = a.def.reserve; });
    curW = 0; showGun(0);
    reloadT = 0; switchT = 0; fireCd = 0; autoReloadT = 0; flashT = 0;
    vm.kick = 0; vm.heat = 0; vm.recoilPitch = 0;
    score = 0; kills = 0; gameTime = 0; shake = 0; dmgFlash = 0;
    dmgInds.forEach((d) => { d.t = 0; d.el.style.opacity = '0'; });
    input.sprint = false; sprintBtn.classList.remove('toggled');
    resetInput();
    resetHudCache(); lastGap = -1;
    overShown = false;
  }

  function startGame() {
    Sound.init();
    tryFullscreenLandscape();
    applyQuality(Settings.quality);
    resetGame();
    state = 'playing';
    showScreen(null);
    setHudVisible(true);
    startWave(1);
    updateCamera(0);
    requestLock();
  }
  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    resetInput();
    exitPointerLock();
    showScreen('menu-pause');
  }
  function resume() {
    if (state !== 'paused') return;
    state = 'playing';
    showScreen(null);
    last = performance.now();
    requestLock();
  }
  function toMenu() {
    flashlight.intensity = 0;
    while (enemies.length) releaseEnemy(enemies[enemies.length - 1]);
    clearPickups();
    state = 'menu';
    exitPointerLock();
    setHudVisible(false);
    H.fxLowhp.classList.remove('on');
    H.fxDamage.style.opacity = '0';
    $('best-score').textContent = String(loadBest());
    showScreen('menu-main');
  }
  let overShown = false;
  function showGameOver() {
    state = 'over';
    const best = Math.max(loadBest(), score);
    const isNew = score > 0 && score >= best && score > loadBest();
    if (isNew) saveBest(score);
    $('over-wave').textContent = String(wave.n);
    $('over-kills').textContent = String(kills);
    $('over-score').textContent = String(score);
    $('over-best').textContent = String(best);
    $('over-newbest').classList.toggle('hidden', !isNew);
    showScreen('menu-over');
  }
  function updateDeath(dt) {
    player.deathT += dt;
    const t = Math.min(1, player.deathT / 1.1);
    player.eye = lerp(PLAYER_CFG.eye, 0.35, t * t);
    camera.position.set(player.pos.x, player.pos.y + player.eye, player.pos.z);
    camera.rotation.set(lerp(player.pitch, 0.25, t), player.yaw, t * 0.7);
    if (player.deathT > 1.6 && !overShown) { overShown = true; showGameOver(); }
  }

  function handleAction(a) {
    switch (a) {
      case 'play': startGame(); break;
      case 'restart': startGame(); break;
      case 'settings':
        returnScreen = state === 'paused' ? 'menu-pause' : 'menu-main';
        syncSettingsUI(); showScreen('menu-settings'); break;
      case 'howto':
        returnScreen = state === 'paused' ? 'menu-pause' : 'menu-main';
        showScreen('menu-howto'); break;
      case 'back': showScreen(returnScreen); break;
      case 'resume': resume(); break;
      case 'menu': toMenu(); break;
      case 'portrait-ok': document.body.classList.add('portrait-ok'); break;
      default: break;
    }
  }
  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      Sound.init();
      Sound.click();
      handleAction(btn.dataset.action);
    });
  });

  // ---- Settings UI
  const qBtns = document.querySelectorAll('[data-quality]');
  const sensInput = $('set-sens'), volInput = $('set-vol'), autoInput = $('set-auto'), fpsInput = $('set-fps');
  function syncSettingsUI() {
    qBtns.forEach((b) => b.classList.toggle('on', b.dataset.quality === Settings.quality));
    sensInput.value = String(Settings.sensitivity);
    $('sens-val').textContent = Settings.sensitivity.toFixed(2) + 'x';
    volInput.value = String(Settings.volume);
    $('vol-val').textContent = Math.round(Settings.volume * 100) + '%';
    autoInput.checked = !!Settings.autoQuality;
    fpsInput.checked = !!Settings.showFps;
    H.fps.classList.toggle('hidden', !Settings.showFps);
  }
  qBtns.forEach((b) => b.addEventListener('click', () => {
    Settings.quality = b.dataset.quality;
    Settings.save();
    applyQuality(Settings.quality);
    syncSettingsUI();
    Sound.init(); Sound.click();
  }));
  sensInput.addEventListener('input', () => {
    Settings.sensitivity = parseFloat(sensInput.value) || 1;
    $('sens-val').textContent = Settings.sensitivity.toFixed(2) + 'x';
    Settings.save();
  });
  volInput.addEventListener('input', () => {
    Settings.volume = parseFloat(volInput.value);
    if (Number.isNaN(Settings.volume)) Settings.volume = 0.7;
    Sound.setVolume(Settings.volume);
    $('vol-val').textContent = Math.round(Settings.volume * 100) + '%';
    Settings.save();
  });
  autoInput.addEventListener('change', () => { Settings.autoQuality = autoInput.checked; Settings.save(); });
  fpsInput.addEventListener('change', () => { Settings.showFps = fpsInput.checked; Settings.save(); syncSettingsUI(); });

  /* =========================================================================
   * 12. QUALITY, PERFORMANCE GOVERNOR, ENVIRONMENT & MAIN LOOP
   * ======================================================================= */
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 80 : 72;
    camera.updateProjectionMatrix();
    weaponCamera.aspect = w / h;
    weaponCamera.fov = w < h ? 70 : 60;
    weaponCamera.updateProjectionMatrix();
    const scale = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    sparks.mat.uniforms.scale.value = scale;
    smoke.mat.uniforms.scale.value = scale;
  }

  function applyQuality(name) {
    const q = QUALITY[name] || QUALITY.medium;
    activeQuality = QUALITY[name] ? name : 'medium';
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    if (moon.castShadow !== q.shadows) moon.castShadow = q.shadows;
    if (moon.shadow.mapSize.x !== q.shadowMap) {
      moon.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      if (moon.shadow.map) { moon.shadow.map.dispose(); moon.shadow.map = null; }
    }
    streetLights.forEach((l, i) => { l.visible = i < q.lights; });
    particleMult = q.particles;
    maxAlive = q.maxAlive;
    enemyShadows = q.shadows && activeQuality === 'high';
    enemies.forEach((e) => e.hitMeshes.forEach((h) => { h.castShadow = enemyShadows; }));
    Object.keys(enemyPools).forEach((k) => enemyPools[k].forEach((e) => e.hitMeshes.forEach((h) => { h.castShadow = enemyShadows; })));
    barrels.forEach((b) => { b.mesh.castShadow = q.shadows; });
    resize();
  }

  const perf = { acc: 0, frames: 0, fps: 60, low: 0 };
  function perfTick(raw) {
    perf.acc += raw; perf.frames++;
    if (perf.acc < 1) return;
    perf.fps = Math.round(perf.frames / perf.acc);
    perf.acc = 0; perf.frames = 0;
    if (Settings.showFps) H.fps.textContent = perf.fps + ' FPS  ·  ' + activeQuality.toUpperCase();
    if (!Settings.autoQuality || state !== 'playing') { perf.low = 0; return; }
    if (perf.fps < 34) {
      perf.low++;
      if (perf.low >= 3) { perf.low = 0; degradeQuality(); }
    } else perf.low = Math.max(0, perf.low - 1);
  }
  function degradeQuality() {
    const idx = QUALITY_ORDER.indexOf(activeQuality);
    if (idx > 0) {
      applyQuality(QUALITY_ORDER[idx - 1]);
      toast('Graphics lowered to keep it smooth');
    } else if (renderer.getPixelRatio() > 0.6) {
      renderer.setPixelRatio(Math.max(0.6, renderer.getPixelRatio() - 0.1));
      resize();
    }
  }

  // Street light assignment: the N nearest working lamps get real point lights
  let lightAssignT = 0;
  const lampOrder = lamps.map((_, i) => i);
  function updateWorldLights(dt) {
    let glowDirty = false;
    const cAttr = glowGeo.attributes.color;
    for (const L of lamps) {
      if (!L.flicker) continue;
      L.timer -= dt;
      if (L.timer <= 0) { L.on = !L.on; L.timer = L.on ? rand(0.05, 1.8) : rand(0.03, 0.25); }
      const target = L.on ? 1 : 0.08;
      if (L.cur !== target) {
        L.cur = target;
        cAttr.setXYZ(L.gi, 1 * L.cur, 0.66 * L.cur, 0.36 * L.cur);
        glowDirty = true;
      }
    }
    if (glowDirty) cAttr.needsUpdate = true;

    lightAssignT -= dt;
    if (lightAssignT <= 0 && lamps.length) {
      lightAssignT = 0.25;
      const cx = camera.position.x, cz = camera.position.z;
      lampOrder.sort((a, b) => {
        const A = lamps[a], B = lamps[b];
        return ((A.x - cx) ** 2 + (A.z - cz) ** 2) - ((B.x - cx) ** 2 + (B.z - cz) ** 2);
      });
      streetLights.forEach((l, i) => {
        const L = lamps[lampOrder[i]];
        l.userData.lamp = L || null;
        if (L) l.position.set(L.x, L.y - 0.4, L.z);
      });
    }
    for (const l of streetLights) {
      const L = l.userData.lamp;
      l.intensity = L ? 2.4 * L.cur : 0;
    }
    explosionLight.intensity = Math.max(0, explosionLight.intensity - dt * 18);
  }

  function updateFires(dt) {
    let nearest = null, nd = Infinity;
    const cx = camera.position.x, cz = camera.position.z;
    for (const f of fireSpots) {
      const dx = f.x - cx, dz = f.z - cz, d = dx * dx + dz * dz;
      if (d < nd) { nd = d; nearest = f; }
      if (d > 45 * 45) continue;
      f.acc += dt * 26 * particleMult;
      while (f.acc >= 1) {
        f.acc -= 1;
        sparks.spawn(f.x + rand(-0.35, 0.35) * f.s, f.y, f.z + rand(-0.35, 0.35) * f.s, rand(-0.2, 0.2), rand(1.2, 2.6), rand(-0.2, 0.2),
          rand(0.35, 0.75), rand(0.7, 1.1) * f.s, 0.1, 1, rand(0.35, 0.6), 0.12, 1, -1.5, 1.2);
        if (Math.random() < 0.3) {
          smoke.spawn(f.x, f.y + 0.8, f.z, rand(-0.3, 0.3), rand(1, 1.8), rand(-0.3, 0.3), rand(2, 3.5), 0.8 * f.s, 3.2 * f.s, 0.08, 0.07, 0.07, 0.55, -0.2, 0.4);
        }
      }
    }
    if (nearest && nd < 35 * 35) {
      fireLight.position.set(nearest.x, nearest.y + 0.8, nearest.z);
      fireLight.intensity = 1.6 + Math.random() * 0.9;
    } else fireLight.intensity = 0;
  }

  let ambientAcc = 0;
  function updateAmbient(dt) {
    ambientAcc += dt * 22 * particleMult;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    while (ambientAcc >= 1) {
      ambientAcc -= 1;
      const x = cx + rand(-18, 18), z = cz + rand(-18, 18), y = cy + rand(-1, 9);
      if (Math.random() < 0.25) sparks.spawn(x, y, z, rand(-0.3, 0.3), rand(-0.1, 0.4), rand(-0.3, 0.3), rand(2, 4), 0.07, 0.03, 1, 0.45, 0.15, 0.9, 0.05, 0.2);
      else smoke.spawn(x, y, z, rand(0.2, 0.6), rand(-0.5, -0.2), rand(-0.2, 0.2), rand(3, 5), 0.06, 0.06, 0.55, 0.55, 0.55, 0.5, 0, 0);
    }
  }

  const lightning = { t: rand(10, 20), flash: 0 };
  function updateLightning(dt) {
    lightning.t -= dt;
    if (lightning.t <= 0) {
      lightning.t = rand(14, 30);
      lightning.flash = 1;
      setTimeout(() => { if (state === 'playing' || state === 'menu') Sound.thunder(); }, 500 + Math.random() * 900);
    }
    if (lightning.flash > 0) {
      lightning.flash = Math.max(0, lightning.flash - dt * 2.5);
      const f = lightning.flash * (Math.random() < 0.3 ? 0.3 : 1);
      hemi.intensity = 0.55 + f * 2.2;
      skyMat.uniforms.flash.value = f;
    } else if (hemi.intensity !== 0.55) {
      hemi.intensity = 0.55; skyMat.uniforms.flash.value = 0;
    }
  }

  function updateEnvironment(dt) {
    sky.position.copy(camera.position);
    moonHalo.position.copy(camera.position).addScaledVector(MOON_DIR, 150);
    moonCore.position.copy(camera.position).addScaledVector(MOON_DIR, 150);
    // Shadow frustum follows the player, snapped to a grid to avoid shimmering
    const fx = Math.round(camera.position.x / 2) * 2, fz = Math.round(camera.position.z / 2) * 2;
    moon.target.position.set(fx, 0, fz);
    moon.position.set(fx + MOON_OFFSET.x, MOON_OFFSET.y, fz + MOON_OFFSET.z);
    updateWorldLights(dt);
    updateFires(dt);
    updateAmbient(dt);
    updateLightning(dt);
  }

  let menuAngle = 0.6;
  function updateMenuCamera(dt) {
    menuAngle += dt * 0.05;
    const r = 12;
    camera.position.set(Math.sin(menuAngle) * r, 8.5 + Math.sin(menuAngle * 0.7) * 1.5, Math.cos(menuAngle) * r);
    camera.lookAt(0, 3.5, 0);
  }

  function render() {
    renderer.clear();
    renderer.render(scene, camera);
    if (state === 'playing' || state === 'paused') {
      renderer.clearDepth();
      renderer.render(weaponScene, weaponCamera);
    }
  }

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = Math.max(0, (now - last) / 1000);
    last = now;
    const dt = Math.min(raw, 0.05);
    perfTick(raw);

    if (state === 'playing') {
      gameTime += dt;
      updatePlayer(dt);
      updateWeapons(dt);
      updateEnemies(dt);
      updateWaves(dt);
      updateBarrels(dt);
      updatePickups(dt);
      if (state === 'playing') {
        updateCamera(dt);
        updateViewmodel(dt);
        aimFeedback(dt);
      }
    } else if (state === 'dead') {
      updateEnemies(dt * 0.5);
      updateDeath(dt);
    } else if (state === 'menu') {
      updateMenuCamera(dt);
    }

    if (state !== 'paused') {
      sparks.update(dt);
      smoke.update(dt);
      updateTracers(dt);
      updateEnvironment(dt);
    }
    if (state === 'playing' || state === 'dead' || state === 'paused') updateHUD(state === 'paused' ? 0 : dt);
    render();
  }

  // ---- Lifecycle
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pause(); });

  // ---- Boot
  applyQuality(Settings.quality);
  Sound.setVolume(Settings.volume);
  syncSettingsUI();
  $('best-score').textContent = String(loadBest());
  updateMenuCamera(0);
  updateEnvironment(0.016);
  requestAnimationFrame((t) => { last = t; frame(t); });
  const playBtn = $('btn-play');
  playBtn.disabled = false;
  $('loading-status').textContent = IS_TOUCH ? 'Ready. Landscape recommended' : 'Ready';
})();
