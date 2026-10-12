'use strict';

(() => {
  // =========================================================
  //  기본 설정 / 유틸
  // =========================================================
  const TILE = 32, VW = 960, VH = 600;
  const CLASS_T = 40, BREAK_T = 45;
  const wrapEl = document.getElementById('wrap');
  const canvas = document.getElementById('hud');
  const glCanvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');
  let SCALE = 1;

  const FONT = '"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
  const font = (size, weight = '') => `${weight} ${size}px ${FONT}`;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const tc = (v) => (v + 0.5) * TILE;
  const tileOf = (e) => ({ x: Math.floor(e.x / TILE), y: Math.floor(e.y / TILE) });
  const reverseStr = (s) => [...s].reverse().join('');
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function angDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function fit() {
    const s = Math.min(innerWidth / VW, innerHeight / VH);
    const w = Math.floor(VW * s), h = Math.floor(VH * s);
    wrapEl.style.width = w + 'px';
    wrapEl.style.height = h + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    SCALE = canvas.width / VW;
    W3D.resize(w, h);
  }

  // =========================================================
  //  입력
  // =========================================================
  const keys = {};
  const pressed = new Set();
  addEventListener('keydown', (e) => {
    Sound.init();
    if (!e.repeat) pressed.add(e.code);
    keys[e.code] = true;
    if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  const mouse = { x: VW / 2, y: VH / 2, click: false, dx: 0, dy: 0 };
  const locked = () => document.pointerLockElement === canvas;
  function requestLock() {
    if (locked() || !canvas.requestPointerLock) return;
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* 사용자 제스처 없이 호출되면 무시 */ }
  }
  function releaseLock() { if (locked()) document.exitPointerLock(); }
  canvas.addEventListener('mousemove', (e) => {
    if (locked()) { mouse.dx += e.movementX; mouse.dy += e.movementY; return; }
    const r = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * VW;
    mouse.y = ((e.clientY - r.top) / r.height) * VH;
  });
  canvas.addEventListener('mousedown', () => {
    Sound.init();
    mouse.click = true;
    canvas.focus();
    if ((G.scene === 'play' && !(G.overlay && G.overlay.type === 'pause')) || G.scene === 'stairs') requestLock();
  });
  document.addEventListener('pointerlockchange', () => {
    if (!locked() && G.scene === 'play' && !G.dialog && !G.overlay) { G.overlay = { type: 'pause' }; G.pauseGuard = 0.35; }
  });
  const hit = (...codes) => codes.some((c) => pressed.has(c));
  const held = (...codes) => codes.some((c) => keys[c]);
  const inRect = (r) => r && !locked() && mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h;

  // =========================================================
  //  게임 상태
  // =========================================================
  const G = {
    scene: 'title', time: 0,
    floorIndex: 0, def: null, grid: null, W: 0, H: 0,
    player: null, npcs: [], objects: [], monsters: [], rings: [], particles: [], timers: [],
    inventory: new Set(), flags: {}, marks: new Set(), rules: new Set(),
    persistent: { introDone: false, taeoDead: false, deaths: 0, start: 0 },
    checkpoint: null,
    bell: { period: 5 }, bc: null,
    dialog: null, overlay: null, toasts: [], subs: [],
    cam: { x: 0, y: 0 }, shake: 0, flash: 0, flashColor: '255,255,255',
    gaze: 0, gazeWarned: false, doppel: null, reflX: null,
    gateOpen: false, danger: 0, hbT: 0, flickT: 0, focus: null,
    titleSel: 0, codexTab: 0, codexIdx: 0, showMap: true, pauseGuard: 0,
  };

  // =========================================================
  //  층 정의
  // =========================================================
  const FLOORS = [
    {
      id: '3F', name: '3층 · 1학년 교실동', W: 50, H: 21, hall: [1, 9, 48, 3], bell: true, flicker: 0.012,
      start: [40, 7], startFace: -1.0, lockKey: 'key3F',
      rooms: [
        { name: '교무실', x: 1, y: 1, w: 10, h: 7, doors: [[3, 8], [8, 8]] },
        { name: '1학년 4반', x: 12, y: 1, w: 10, h: 7, doors: [[14, 8], [19, 8]], desks: true },
        { name: '1학년 5반', x: 23, y: 1, w: 10, h: 7, doors: [[25, 8], [30, 8]], desks: true },
        { name: '1학년 6반', x: 34, y: 1, w: 10, h: 7, doors: [[36, 8], [41, 8]], desks: true, lit: true, board: '5교시 국어 — 자습' },
        { name: '계단실', x: 45, y: 1, w: 4, h: 7, floor: 'w', doors: [[46, 8, 'L']] },
        { name: '1학년 3반', x: 9, y: 13, w: 12, h: 7, doors: [[11, 12], [18, 12]], desks: true },
        { name: '1학년 2반', x: 22, y: 13, w: 12, h: 7, doors: [[24, 12], [31, 12]], desks: true },
        { name: '1학년 1반', x: 35, y: 13, w: 14, h: 7, doors: [[37, 12], [46, 12]], desks: true },
      ],
      tiles: [[47, 3, 'S'], [3, 3, 'd'], [4, 3, 'd'], [7, 3, 'd'], [8, 3, 'd'], [3, 5, 'd'], [4, 5, 'd'], [7, 5, 'd'], [8, 5, 'd']],
      setup: setup3F, objective: obj3F, onStairs: () => goFloor(1, '2층', '특별실동'),
    },
    {
      id: '2F', name: '2층 · 특별실동', W: 50, H: 21, hall: [1, 9, 48, 3], bell: true, flicker: 0.03,
      start: [47, 5], startFace: Math.PI / 2, lockKey: 'key2F',
      rooms: [
        { name: '도서실', x: 1, y: 1, w: 10, h: 7, doors: [[3, 8], [8, 8]], desks: true },
        { name: '미술실', x: 12, y: 1, w: 10, h: 7, doors: [[14, 8], [19, 8]], desks: true, board: '자화상 — 뒤를 보고 그릴 것' },
        { name: '음악실', x: 23, y: 1, w: 10, h: 7, doors: [[25, 8], [30, 8]], desks: true },
        { name: '2학년 1반', x: 34, y: 1, w: 10, h: 7, doors: [[36, 8], [41, 8]], desks: true },
        { name: '계단실 (위)', x: 45, y: 1, w: 4, h: 7, floor: 'w', doors: [[46, 8]] },
        { name: '화장실', x: 1, y: 13, w: 7, h: 7, floor: 'r', doors: [[4, 12]] },
        { name: '과학실', x: 9, y: 13, w: 12, h: 7, doors: [[11, 12], [18, 12]], desks: true },
        { name: '2학년 2반', x: 22, y: 13, w: 12, h: 7, doors: [[24, 12], [31, 12]], desks: true },
        { name: '2학년 3반', x: 35, y: 13, w: 9, h: 7, doors: [[37, 12], [41, 12]], desks: true },
        { name: '계단실 (아래)', x: 45, y: 13, w: 4, h: 7, floor: 'w', doors: [[46, 12, 'L']] },
      ],
      tiles: [[47, 2, 'U'], [47, 18, 'S'], [2, 20, 'M'], [3, 20, 'M'], [4, 20, 'M'], [5, 20, 'M'], [6, 20, 'M'], [1, 14, '#'], [1, 16, '#']],
      setup: setup2F, objective: obj2F, onStairs: () => goFloor(2, '1층', '현관 · 방송실'),
    },
    {
      id: '1F', name: '1층 · 현관과 방송실', W: 50, H: 21, hall: [1, 9, 48, 3], bell: true, flicker: 0.06, broadcast: true,
      start: [47, 15], startFace: -Math.PI / 2, lockKey: 'keyB1',
      speakers: [[8, 8], [27, 8], [40, 8], [22, 12]],
      rooms: [
        { name: '교장실', x: 1, y: 1, w: 10, h: 7, doors: [[8, 8]] },
        { name: '방송실', x: 12, y: 1, w: 10, h: 7, doors: [[14, 8]], lit: true },
        { name: '행정실', x: 23, y: 1, w: 10, h: 7, doors: [[25, 8], [30, 8]], desks: true },
        { name: '보건실', x: 34, y: 1, w: 10, h: 7, doors: [[36, 8]] },
        { name: '지하 계단', x: 1, y: 13, w: 7, h: 7, floor: 'w', doors: [[4, 12, 'L']] },
        { name: '급식실', x: 9, y: 13, w: 12, h: 7, doors: [[11, 12], [18, 12]], desks: true },
        { name: '중앙 현관', x: 22, y: 13, w: 12, h: 7, floor: '.' },
        { name: '1학년 7반', x: 35, y: 13, w: 9, h: 7, doors: [[37, 12], [41, 12]], desks: true },
        { name: '계단실', x: 45, y: 13, w: 4, h: 7, floor: 'w', doors: [[46, 12]] },
      ],
      tiles: [
        [4, 18, 'S'], [47, 18, 'U'],
        [24, 12, '.'], [25, 12, '.'], [26, 12, '.'], [27, 12, '.'], [28, 12, '.'], [29, 12, '.'], [30, 12, '.'], [31, 12, '.'],
        [26, 20, 'G'], [27, 20, 'G'], [28, 20, 'G'], [29, 20, 'G'],
        [15, 1, 'd'], [16, 1, 'd'], [17, 1, 'd'], [18, 1, 'd'],
        [4, 2, 'd'], [5, 2, 'd'], [6, 2, 'd'], [2, 5, 'd'], [3, 5, 'd'],
        [36, 2, 'd'], [36, 3, 'd'], [39, 2, 'd'], [39, 3, 'd'], [42, 2, 'd'], [42, 3, 'd'],
      ],
      setup: setup1F, objective: obj1F, onStairs: () => startStairs(),
    },
    {
      id: 'B1', name: '지하 · 44교시 시험장', W: 30, H: 21, bell: false, flicker: 0, noFlash: true,
      start: [14.5, 2], startFace: Math.PI / 2,
      rooms: [
        { name: '지하 계단 끝', x: 13, y: 1, w: 4, h: 6, floor: 'w' },
        { name: '44교시 시험장', x: 2, y: 7, w: 26, h: 13, lit: true, dim: 0.42 },
      ],
      tiles: (() => {
        const a = [];
        for (const y of [9, 11, 13]) for (const x of [3, 5, 7, 9, 11, 18, 20, 22, 24, 26]) a.push([x, y, 'd']);
        return a;
      })(),
      block: (x, y) => !G.flags.examPassed && y > 15 * TILE,
      setup: setupB1, objective: objB1,
    },
  ];

  function buildFloor(def) {
    const g = Array.from({ length: def.H }, () => Array(def.W).fill('#'));
    const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < def.W && y < def.H) g[y][x] = c; };
    const fill = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c); };
    if (def.hall) fill(def.hall[0], def.hall[1], def.hall[2], def.hall[3], '.');
    for (const r of def.rooms) {
      fill(r.x, r.y, r.w, r.h, r.floor || ',');
      if (r.desks) {
        for (let j = r.y + 2; j < r.y + r.h - 1; j += 2)
          for (let i = r.x + 1; i < r.x + r.w - 1; i += 2) set(i, j, 'd');
      }
      for (const d of r.doors || []) set(d[0], d[1], d[2] || 'D');
    }
    for (const [x, y, c] of def.tiles || []) set(x, y, c);
    for (const [x, y, type] of decorFor(def)) {
      if (PROP_SOLID.has(type) && 'r,.w'.includes(g[y][x])) set(x, y, 'b');
    }
    return g;
  }

  // =========================================================
  //  타일 판정
  // =========================================================
  const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= G.W || ty >= G.H ? '#' : G.grid[ty][tx]);
  const SOLID = new Set(['#', 'L', 'M', 'd', 'U', 'b']);
  const isSolid = (tx, ty) => {
    const t = tileAt(tx, ty);
    if (t === 'G') return !G.gateOpen;
    return SOLID.has(t);
  };
  const LIGHT_BLOCK = new Set(['#', 'L', 'M', 'U']);
  const blocksLight = (tx, ty) => LIGHT_BLOCK.has(tileAt(tx, ty));
  const isSafeTile = (t) => t === ',' || t === 'd' || t === 'b' || t === 'w' || t === 'S';
  const isWallish = (t) => t === '#' || t === 'L' || t === 'M';
  const playerTile = () => { const p = tileOf(G.player); return tileAt(p.x, p.y); };
  const playerSafe = () => isSafeTile(playerTile());
  const passHall = (x, y) => { const t = tileAt(x, y); return t === '.' || t === 'D'; };
  const passRest = (x, y) => tileAt(x, y) === 'r';
  const passEraser = (x, y) => x >= 0 && y >= 0 && x < G.W && y < G.H && G.eraserZone[y * G.W + x] === 1;

  function collides(x, y, r) {
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!isSolid(tx, ty)) continue;
        const cx = clamp(x, tx * TILE, tx * TILE + TILE), cy = clamp(y, ty * TILE, ty * TILE + TILE);
        if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
      }
    }
    return false;
  }
  function moveEntity(e, dx, dy, block) {
    if (!collides(e.x + dx, e.y, e.r) && !(block && block(e.x + dx, e.y))) e.x += dx;
    if (!collides(e.x, e.y + dy, e.r) && !(block && block(e.x, e.y + dy))) e.y += dy;
  }

  function bfs(sx, sy, gx, gy, pass) {
    const W = G.W, H = G.H;
    if (gx < 0 || gy < 0 || gx >= W || gy >= H || !pass(gx, gy)) return null;
    const start = sy * W + sx, goal = gy * W + gx;
    if (start === goal) return [];
    const prev = new Int32Array(W * H).fill(-1);
    prev[start] = start;
    const q = [start];
    let head = 0;
    while (head < q.length) {
      const c = q[head++];
      if (c === goal) break;
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (prev[n] !== -1 || !pass(nx, ny)) continue;
        prev[n] = c;
        q.push(n);
      }
    }
    if (prev[goal] === -1) return null;
    const path = [];
    let c = goal;
    while (c !== start) { path.push({ x: c % W, y: (c / W) | 0 }); c = prev[c]; }
    return path.reverse();
  }

  function followPath(m, path, speed, dt) {
    if (!path || !path.length) return true;
    const n = path[0];
    const tx = tc(n.x), ty = tc(n.y);
    const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy);
    const st = speed * dt;
    if (d <= st) { m.x = tx; m.y = ty; path.shift(); }
    else { m.x += (dx / d) * st; m.y += (dy / d) * st; m.face = Math.atan2(dy, dx); }
    return path.length === 0;
  }

  function los(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(d / 8);
    for (let i = 1; i < steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps, y = y0 + ((y1 - y0) * i) / steps;
      if (blocksLight(Math.floor(x / TILE), Math.floor(y / TILE))) return false;
    }
    return true;
  }

  // =========================================================
  //  공용 헬퍼 (메시지, 규칙, 타이머)
  // =========================================================
  function toast(text) { G.toasts.push({ text, t: 4 }); if (G.toasts.length > 3) G.toasts.shift(); }
  function sub(text, dur = 3.5, color = '#ddd') { G.subs.push({ text, t: dur, color }); if (G.subs.length > 3) G.subs.shift(); }
  function addTimer(t, fn) { G.timers.push({ t, fn }); }
  function unlockRule(id) {
    if (G.rules.has(id)) return;
    G.rules.add(id);
    toast(`수첩에 새 수칙이 적혔다 — 「${RULES[id].title}」  [Tab]`);
  }
  function mark(key) {
    if (G.marks.has(key)) return;
    G.marks.add(key);
  }
  function addNPC(o) {
    const n = Object.assign({ face: Math.PI / 2, bubble: '', bubbleT: 0, alpha: 1, r: 10 }, o);
    n.x = tc(o.x); n.y = tc(o.y);
    G.npcs.push(n);
    return n;
  }
  function addObj(o) {
    const n = Object.assign({}, o);
    n.x = tc(o.x); n.y = tc(o.y);
    G.objects.push(n);
    return n;
  }
  function addNote(id, x, y) {
    const d = NOTES[id];
    return addObj({ kind: 'note', id, x, y, label: '쪽지 읽기', title: d.title, text: d.text, rules: d.rules, flag: d.flag });
  }
  function makeNoise(x, y, radiusTiles, visible = true) {
    const t = tileAt(Math.floor(x / TILE), Math.floor(y / TILE));
    const safe = isSafeTile(t);
    if (visible) G.rings.push({ x, y, r: 4, max: radiusTiles * TILE, life: 1 });
    for (const m of G.monsters) if (m.type === 'eraser') eraserHear(m, x, y, radiusTiles * TILE, safe);
  }

  // =========================================================
  //  층 로딩 / 전환
  // =========================================================
  function loadFloor(i) {
    const def = FLOORS[i];
    G.floorIndex = i; G.def = def; G.W = def.W; G.H = def.H;
    G.grid = buildFloor(def);
    G.npcs = []; G.objects = []; G.monsters = []; G.rings = []; G.particles = []; G.timers = [];
    G.subs = []; G.dialog = null; G.overlay = null;
    G.gateOpen = false; G.gaze = 0; G.gazeWarned = false; G.doppel = null; G.reflX = null;
    G.floorTime = 0; G.danger = 0; G.shake = 0; G.flash = 0;
    G.bc = def.broadcast ? { next: 16, active: false, t: 0, type: null } : null;
    G.bell = { enabled: def.bell, phase: 'break', t: 25, period: G.bell.period || 5, warned: false, tickT: 0, tickHi: false };
    G.mirrors = []; G.hallTiles = [];
    for (let y = 0; y < G.H; y++) for (let x = 0; x < G.W; x++) {
      const t = G.grid[y][x];
      if (t === 'M') G.mirrors.push({ x, y });
      if (t === '.') G.hallTiles.push({ x, y });
    }
    G.eraserZone = new Uint8Array(G.W * G.H);
    for (let y = 0; y < G.H; y++) for (let x = 0; x < G.W; x++) {
      const t = G.grid[y][x];
      if (t === '.' || t === 'D') { G.eraserZone[y * G.W + x] = 1; continue; }
      if (t === '#' && DIRS.some(([dx, dy]) => tileAt(x + dx, y + dy) === '.')) G.eraserZone[y * G.W + x] = 1;
    }
    G.speakers = (def.speakers || []).map(([sx, sy]) => addObj({ kind: 'speaker', x: sx, y: sy, noInteract: true }));
    G.player = {
      x: tc(def.start[0]), y: tc(def.start[1]), r: 10, face: def.startFace ?? -Math.PI / 2, pitch: 0, eye: 1.6, bob: 0, bobT: 0,
      stance: 'walk', moving: false, stepT: 0, wasSafe: true, noise: 0,
    };
    G.checkpoint = { inventory: new Set(G.inventory), flags: { ...G.flags } };
    G.scene = 'play';
    Sound.hush();
    W3D.stairsExit();
    W3D.buildLevel();
    def.setup();
    requestLock();
  }

  function goFloor(i, title, subtitle) {
    G.scene = 'transition';
    G.trans = { t: 0, title, sub: subtitle, next: () => loadFloor(i) };
    Sound.whisper();
  }

  function newGame() {
    G.inventory = new Set(); G.flags = {}; G.marks = new Set(); G.rules = new Set();
    G.persistent = { introDone: false, taeoDead: false, deaths: 0, start: performance.now() };
    G.bell = { period: 5 };
    G.toasts = []; G.subs = [];
    Sound.init();
    Sound.startDrone();
    goFloor(0, '3층', '1학년 교실동 · 5교시');
  }

  function restart() {
    if (G.deathCause === 'stairs') { startStairs(); return; }
    G.inventory = new Set(G.checkpoint.inventory);
    G.flags = { ...G.checkpoint.flags };
    G.toasts = [];
    loadFloor(G.floorIndex);
  }

  function kill(cause) {
    if (G.scene !== 'play' && G.scene !== 'stairs') return;
    G.scene = 'dead';
    G.deathCause = cause;
    G.deadT = 0;
    G.dialog = null; G.overlay = null;
    G.persistent.deaths++;
    Sound.hush();
    Sound.jumpscare();
    releaseLock();
  }

  // =========================================================
  //  3층
  // =========================================================
  const STUDENT_LINES = [
    '엄마한테 전화가 안 돼… 화면이 계속 깨져.',
    '(고개를 무릎에 묻고 떨고 있다.)',
    '복도에서 누가 우리 반 출석을 불러. 아직… 내 이름은 안 불렀어.',
    '창밖 봤어? 아무것도 없어. 진짜 아무것도.',
    '하람아, 나가지 마. 제발.',
  ];
  function talkStudent() { startDialog([{ who: '학생', text: pick(STUDENT_LINES) }]); }

  function setup3F() {
    addNPC({ id: 'dokyung', ch: '도경', x: 36, y: 6, face: -Math.PI / 2, talk: talkDokyung, lookAtPlayer: true });
    addNPC({ id: 's1', ch: '학생', x: 35, y: 3, seated: true, talk: talkStudent, face: 0 });
    addNPC({ id: 's2', ch: '학생', x: 39, y: 5, seated: true, talk: talkStudent, face: 0 });
    addNPC({ id: 's3', ch: '학생', x: 41, y: 3, seated: true, talk: talkStudent, face: 0 });
    addObj({ kind: 'board', x: 43, y: 1, label: '증명사진 게시판' });
    addObj({ kind: 'key', id: 'key3F', name: '3층 계단실 열쇠', x: 5, y: 2, label: '열쇠 줍기' });
    addNote('n3_rollcall', 16, 2);
    addNote('n3_circle', 27, 14);
    addNote('n3_tick', 14, 14);
    addNote('n3_late', 44, 14);

    if (!G.persistent.introDone) {
      G.bell.enabled = false;
      const teacher = addNPC({ id: 'teacher', ch: '기철', x: 42, y: 4, face: Math.PI });
      addTimer(0.8, () => startDialog(INTRO_LINES, {
        onEnd: () => {
          teacher.path = [[42, 6], [42, 7], [41, 7], [41, 8], [41, 9], [41, 10]];
          teacher.speed = 60;
          teacher.onArrive = teacherTaken;
        },
      }));
    } else {
      G.bell.t = 22;
      toast('쉬는 시간이다. 교무실은 복도 왼쪽 끝.');
    }
  }

  const INTRO_LINES = [
    { who: '', text: '5교시, 국어 시간. 창밖의 운동장이 끝에서부터 까맣게 지워지기 시작했다.' },
    { who: '', text: '뉴스에서만 보던 「검은 원」이었다. 비명을 지를 틈도 없이, 학교 전체가 아래로 떨어졌다.' },
    { who: '', text: '…정신을 차렸을 때, 교실은 그대로였다. 창밖이 온통 새까맣다는 것만 빼면.' },
    { who: '기철', text: '다들 진정해! 자리에서 움직이지 마. 선생님이 복도 상황만 보고 올게.' },
    { who: '도경', text: '선생님, 나가지 마세요. 복도… 불이 다 꺼져 있어요.' },
    { who: '기철', text: '금방 온다. 반장, 애들 좀 부탁한다. 하람이 너도 자리 지키고.' },
  ];
  const DOKYUNG_AFTER = [
    { who: '도경', text: '…방금 들었어? 선생님 이름을 불렀어. 출석 부르듯이.' },
    { who: '도경', text: '종이 울리자마자 나타났어. 그런데 교실 문턱 앞에서는 더 안 들어와.' },
    { who: '도경', text: '하람아, 이거 받아. 생존 수칙 수첩이야. 지금부터 알게 되는 건 전부 여기 적자.' },
    { who: '도경', text: '수업 시간엔 무조건 교실 안. 종 치기 전에 째깍째깍 소리가 나면, 제일 가까운 문으로 들어가.' },
    { who: '도경', text: '계단 문은 잠겨 있을 거야. 열쇠는 교무실에 있어. 복도 왼쪽 끝. …쉬는 시간이 되면, 부탁할게.' },
  ];

  function teacherTaken(teacher) {
    G.bell.enabled = true;
    startClass();
    const rc = spawnRollCaller({ x: 33, y: 10 });
    rc.state = 'scripted';
    rc.face = 0;
    teacher.face = Math.PI;
    addTimer(1.8, () => { rc.bubble = '한기철?'; rc.bubbleT = 2.5; sub('복도: 「한기철?」', 2.5, '#cfc9ba'); Sound.speak('한기철', { pitch: 0.1, rate: 0.6 }); });
    addTimer(3.6, () => { teacher.bubble = '…네?'; teacher.bubbleT = 1.6; sub('한기철: 「…네?」', 1.8, '#bbb'); });
    addTimer(4.8, () => {
      G.flash = 1; G.flashColor = '255,40,40'; G.shake = 0.6;
      Sound.stinger();
      teacher.gone = true;
      mark('기철');
      rc.state = 'patrol';
      sub('복도의 불빛이 한 번 깜빡였다. 선생님의 대답은 다시 들리지 않았다.', 4.5, '#ff9a9a');
    });
    addTimer(8, () => startDialog(DOKYUNG_AFTER, {
      onEnd: () => {
        G.inventory.add('notebook');
        unlockRule('R1');
        G.persistent.introDone = true;
        toast('[Tab] 생존 수칙 수첩 · [E] 조사 · [C] 살금살금 · [Shift] 달리기');
      },
    }));
  }

  function talkDokyung() {
    if (!G.persistent.introDone) return;
    if (G.inventory.has('key3F')) {
      startDialog([
        { who: '도경', text: '열쇠 찾았구나…! 다행이다.' },
        { who: '도경', text: '먼저 내려가서 길을 봐 줘. 나는 애들이랑 여기서 수칙을 지키고 있을게. 길을 찾으면… 그 길 그대로 따라갈게.' },
      ]);
      return;
    }
    startDialog([{ who: '도경', text: pick([
      '쉬는 시간에만 움직여. 째깍 소리가 나면 바로 아무 교실이나 들어가.',
      '교무실은 복도 왼쪽 끝이야. 계단실은 오른쪽 끝.',
      '…뒤에 게시판 봤어? 선생님 사진에 붉은 X가 그어졌어. 아무도 안 그었는데.',
      '다른 반 교실도 뒤져 봐. 우리보다 먼저 뭔가 알아낸 애들이 있을지도 몰라.',
    ]) }]);
  }

  function obj3F() {
    if (!G.persistent.introDone) return '…';
    if (!G.inventory.has('key3F')) return '쉬는 시간에 교무실(복도 왼쪽 끝)에서 계단실 열쇠를 찾아라';
    return '복도 오른쪽 끝, 계단실 문을 열고 아래로 내려가라';
  }

  // =========================================================
  //  2층
  // =========================================================
  function setup2F() {
    addNote('n2_eraser', 46, 6);
    addNote('n2_key', 5, 2);
    addNote('n2_art', 16, 2);
    addNote('n2_sci', 14, 14);
    addObj({ kind: 'key', id: 'key2F', name: '2층 계단실 열쇠', x: 4, y: 19, label: '열쇠 줍기' });
    spawnEraser(12, 10, 1);
    if (!G.persistent.taeoDead) addTimer(7, taeoEvent);
    else addTaeoTag();
    toast('2층. 공기가 분필가루처럼 텁텁하다.');
  }

  function addTaeoTag() {
    addObj({
      kind: 'tag', x: 5, y: 10, label: '이름표 줍기', title: '하얀 가루를 뒤집어쓴 이름표',
      text: '「1-6 강태오」\n\n이름표 뒷면에 볼펜으로 급하게 적힌 글씨.\n「벽 지우는 놈 눈 없음. 소리 따라옴. 교실 안 소리는 못 들음」\n\n…태오는 이걸 알면서도 친구들을 부른 것이다.',
    });
  }

  function taeoEvent() {
    sub('강태오: 「야아아! 거기 누구 있어?! 나 태오야, 6반 강태오!!」', 4, '#ffd27a');
    makeNoise(tc(3), tc(10), 40);
    addTimer(1.3, () => { sub('강태오: 「하람이야? 하람아! 나 여기—」', 3, '#ffd27a'); makeNoise(tc(3), tc(10), 40); });
    addTimer(3.4, () => { Sound.scrape(1.3); sub('…쉬이이이이—', 2.5, '#e8e8e8'); });
    addTimer(4.5, () => { Sound.scream(); sub('강태오: 「잠깐, 벽이 왜 접히— 」', 2.5, '#ffd27a'); G.shake = 0.4; });
    addTimer(5.8, () => {
      mark('태오');
      G.persistent.taeoDead = true;
      addTaeoTag();
      sub('…조용해졌다.', 3, '#aaa');
      toast('누군가의 증명사진에 붉은 X가 그어졌다.');
    });
  }

  function obj2F() {
    if (G.inventory.has('key2F')) return '오른쪽 아래 계단실 문을 열고 내려가라';
    if (G.flags.knowKey2F) return '화장실(왼쪽 아래) 세면대의 열쇠를 가져와라 — 거울을 오래 보지 말 것';
    return '아래층 계단실 열쇠를 찾아라 — 복도에서는 소리 내지 말 것';
  }

  // =========================================================
  //  1층
  // =========================================================
  function setup1F() {
    addNote('n1_broadcast', 46, 14);
    addNote('n1_lunch', 14, 14);
    addNote('n1_nurse', 38, 5);
    addNote('n1_principal', 5, 4);
    addNPC({ id: 'chaeyi', ch: '채이', x: 17, y: 3, face: Math.PI / 2, talk: talkChaeyi, lookAtPlayer: true });
    spawnEraser(24, 10, 0.85);
    if (!G.flags.fakeDone) addTimer(28, spawnFake);
    toast('1층. 어딘가에서 스피커가 지직거린다.');
  }

  function talkChaeyi() {
    if (G.flags.metChaeyi) {
      startDialog([{ who: '채이', text: pick([
        '방송은 내가 최대한 끊어 볼게. 가, 하람아. 지하 계단은 왼쪽 아래야.',
        '현관이 열려도 절대 가지 마. 그건 문이 아니라 입이야.',
        '계단에서… 뒤돌아보지 마. 약속해.',
      ]) }]);
      return;
    }
    startDialog([
      { who: '채이', text: '…누구야? 아, 6반 하람이구나. 이름표가 오른쪽에 있네. 다행이다, 진짜 너구나.' },
      { who: '채이', text: '나 방송부 류채이. 그 방송이 처음 나왔을 때 여기 있었어. 근데 이상하지. 방송 장비 전원은 전부 나가 있었거든.' },
      { who: '채이', text: '그러니까 방송은 우리 쪽이 아니야. 대피하라고 해도, 줄 서라고 해도 절대 따르지 마.' },
      { who: '채이', text: '그리고… 나랑 똑같이 생긴 애가 복도를 돌아다녀. 말을 거꾸로 해. 이름표도 반대쪽이야. 걔 따라가면 안 돼.' },
      { who: '채이', text: '이거, 지하 계단 열쇠. 교장 선생님이 나한테 맡겼어. 우린 위에서 떨어졌으니까, 나가는 길은 아래일 거야.' },
      { who: '채이', text: '마지막으로. 지하 계단에서 녹음된 소리가 있어. 누가 이름을 부르는데… 뒤돌아본 애들은 안 돌아왔어. 무슨 소리가 들려도 뒤돌아보지 마.' },
    ], {
      onEnd: () => {
        G.flags.metChaeyi = true;
        G.inventory.add('keyB1');
        Sound.pickup();
        toast('지하 계단 열쇠를 얻었다.');
        unlockRule('R4'); unlockRule('R5'); unlockRule('R8');
      },
    });
  }

  function spawnFake() {
    if (G.flags.fakeDone || G.npcs.some((n) => n.fake)) return;
    const P = G.player;
    const cands = G.hallTiles.filter((h) => {
      const d = Math.hypot(tc(h.x) - P.x, tc(h.y) - P.y) / TILE;
      return d > 7 && d < 12;
    });
    const h = cands.length ? pick(cands) : pick(G.hallTiles);
    addNPC({ id: 'fake', ch: '채이', fake: true, x: h.x, y: h.y, talk: (n) => { if (!n.talked) { n.talked = true; talkFake(n); } }, repath: 0 });
    Sound.whisper();
    sub('복도 어딘가에서 익숙한 목소리가 들린다. …거꾸로.', 3.5, '#b9a3ff');
  }

  function talkFake(n) {
    const lines = G.flags.metChaeyi ? [
      { who: '채이', fake: true, rev: true, text: '하람아! 방송실에 있는 건 내가 아니야!' },
      { who: '채이', fake: true, rev: true, text: '진짜 출구를 찾았어. 현관이야. 같이 가자, 응?' },
    ] : [
      { who: '채이', fake: true, rev: true, text: '하람아, 다행이다! 살아 있었구나!' },
      { who: '채이', fake: true, rev: true, text: '나 방송부 채이야. 출구를 찾았어. 이쪽이야, 따라와!' },
    ];
    startDialog(lines, {
      choices: [
        { label: '따라간다', action: () => kill('doppel') },
        { label: '따라가지 않는다 — 말이 거꾸로 들린다', action: () => refuseFake(n) },
      ],
    });
  }

  function refuseFake(n) {
    startDialog([{ who: '채이', fake: true, rev: true, text: '왜? 왜 안 와? 왜 안 와? 왜 안 와? 왜' }], {
      onEnd: () => {
        n.gone = true;
        G.flags.fakeDone = true;
        G.flash = 0.6; G.flashColor = '160,120,255';
        Sound.glitch();
        unlockRule('R5');
        sub('그것은 목이 반대로 꺾인 채 벽 속으로 스며들었다.', 4, '#b9a3ff');
      },
    });
  }

  function obj1F() {
    if (G.inventory.has('keyB1')) return '왼쪽 아래, 지하 계단 문을 열고 내려가라';
    if (G.flags.knowChaeyi) return '방송실에서 방송부 류채이를 찾아라';
    return '지하로 내려가는 길을 찾아라 — 방송을 믿지 말 것';
  }

  // =========================================================
  //  지하 1층 (44교시)
  // =========================================================
  function setupB1() {
    addObj({ kind: 'examdesk', x: 14, y: 12, label: '답안지 앞에 앉기' });
    G.exitCircle = addObj({ kind: 'circle', x: 14, y: 18, noInteract: true });
    G.exitCircle.x = 15 * TILE; G.exitCircle.y = 18.5 * TILE;
    const p = addNPC({ id: 'proctor', ch: '감독관', x: 14, y: 16, face: -Math.PI / 2, talk: talkProctor });
    p.x = 15 * TILE;
    for (const [x, y] of [[5, 9], [9, 11], [20, 9], [24, 13], [7, 13], [22, 11], [3, 11], [26, 9]]) {
      addNPC({ id: 'ghoststudent', ch: '학생', faceless: true, seated: true, x, y, face: Math.PI / 2,
        talk: () => startDialog([{ who: '', text: pick(['답안지에 무언가를 계속 쓰고 있다. 얼굴이 없다.', '연필 소리만 사각사각 난다. 이 아이는 몇 교시째 여기 앉아 있는 걸까.', '답안지에 같은 문장이 빼곡하다. 「뒤돌아보지 않는다 뒤돌아보지 않는다 뒤돌아보지」']) }]) });
    }
    G.player.x = 15 * TILE;
    addTimer(0.6, () => { sub('휴대폰 화면이 깨지며 플래시가 완전히 꺼졌다.', 4, '#ff9a9a'); Sound.glitch(); });
    addTimer(3, () => { p.bubble = '착석.'; p.bubbleT = 3; });
  }

  function talkProctor() {
    if (G.flags.examPassed) return;
    startDialog([
      { who: '감독관', text: '착석하라.' },
      { who: '감독관', text: '44교시. 생존수업. 기말고사. 가운데 책상에 앉아라.' },
    ]);
  }

  function objB1() {
    if (G.flags.examPassed) return '감독관 뒤, 검은 원의 맨 아래로 들어가라';
    return '시험장 가운데 책상에 앉아 44교시 시험을 치러라';
  }

  function startExam() {
    const qs = shuffle(EXAM.slice()).slice(0, 5).map((q) => {
      const opts = shuffle(q.a.map((t, i) => ({ t, ok: i === q.c })));
      return { q: q.q, opts };
    });
    G.overlay = { type: 'exam', qs, i: 0, wrong: 0, sel: -1, fb: null, fbT: 0, rects: [], cool: 0.8 };
    Sound.page();
  }

  function examPassed(wrong) {
    G.flags.examPassed = true;
    G.examWrong = wrong;
    const p = G.npcs.find((n) => n.id === 'proctor');
    startDialog([
      { who: '감독관', text: wrong === 0 ? '…만점.' : '…통과.' },
      { who: '감독관', text: '하교를 허가한다.' },
    ], {
      onEnd: () => {
        if (p) p.fading = true;
        Sound.bell(false);
        sub('— 종례 종이 울렸다. 맑은 소리였다. —', 4, '#9fe0a8');
      },
    });
  }

  // =========================================================
  //  열세 번째 계단 (1층 → 지하)
  // =========================================================
  const STAIR_VOICES = {
    3: { text: '…하람아.', color: '#ccc', speak: '하람아' },
    5: { text: '도경: 「하람아, 잠깐만! 나도 같이 가!」', color: '#d6c4a8', speak: '하람아 잠깐만' },
    7: { text: '태오: 「야… 나 살아 있어. 진짜야. 뒤 좀 봐 봐.」', color: '#ffd27a', speak: '나 살아 있어 뒤 좀 봐' },
    9: { text: '한기철: 「윤하람. 거기 서. 선생님 말 안 들리니?」', color: '#bbb', speak: '윤하람 거기 서' },
    11: { text: '채이: 「하람아, 나야! 진짜 나야! 돌아봐!」', color: '#d8b4ff', speak: '하람아 돌아봐' },
    12: { text: '…………', color: '#888' },
    13: { text: '바로 귓가에서: 「뒤돌아봐.」', color: '#ff6b6b', speak: '뒤돌아봐' },
  };

  const LOOK_BACK = 1.75;

  function startStairs() {
    G.scene = 'stairs';
    G.st = { step: 0, prog: 0, t: 0, idle: 0, said: new Set(), done: false, yaw: 0, pitch: -0.15, warnT: 0 };
    G.subs = [];
    G.dialog = null; G.overlay = null;
    W3D.stairsEnter();
    requestLock();
    sub('지하로 내려가는 계단. 열두 칸이라고 했다.', 4, '#ccc');
    sub('[W / ↑] 를 꾹 눌러 내려간다. 무슨 소리가 들려도 절대 뒤돌아보지 말 것.', 6, '#9fd3ff');
  }

  function updateStairs(dt) {
    const S = G.st;
    S.t += dt;
    updateMessages(dt);
    if (G.flickT > 0) G.flickT -= dt;
    if (S.done) {
      S.doneT += dt;
      if (S.doneT > 2.2) goFloor(3, '지하', '44교시');
      return;
    }
    S.yaw -= mouse.dx * 0.0024;
    S.pitch = clamp(S.pitch - mouse.dy * 0.0024, -1.1, 1.0);
    if (held('ArrowLeft')) S.yaw += 1.6 * dt;
    if (held('ArrowRight')) S.yaw -= 1.6 * dt;
    if (Math.abs(S.yaw) > LOOK_BACK) { kill('stairs'); return; }
    if (Math.abs(S.yaw) > 0.8) {
      S.warnT -= dt;
      if (S.warnT <= 0) {
        S.warnT = 1.6;
        Sound.whisper();
        Sound.heartbeat(1);
        sub(pick(['…그래, 조금만 더. 돌아봐.', '등 뒤에서 숨소리가 가까워진다.', '목덜미에 차가운 손끝이 닿았다.']), 2, '#ff9a9a');
      }
    }
    if (held('KeyW', 'ArrowUp')) {
      S.idle = 0;
      S.prog += dt / 0.55;
      if (S.prog >= 1) {
        S.prog = 0;
        S.step++;
        Sound.step('walk');
        const v = STAIR_VOICES[S.step];
        if (v && !S.said.has(S.step)) {
          S.said.add(S.step);
          sub(v.text, 3.2, v.color);
          Sound.whisper();
          if (v.speak) Sound.speak(v.speak, { pitch: 0.3, rate: 0.7, volume: 0.6 });
          if (S.step === 13) { G.shake = 0.5; Sound.stinger(); }
        }
        if (S.step === 12) sub('열두 번째 칸. …그런데 발밑에 한 칸이 더 있다.', 3, '#ff9a9a');
        if (S.step >= 14) {
          S.done = true; S.doneT = 0;
          sub('…발이 평평한 바닥에 닿았다. 뒤에서 들리던 숨소리가 멎었다.', 3, '#ccc');
        }
        if (Math.random() < 0.25) G.flickT = rand(0.1, 0.4);
      }
    } else {
      S.idle += dt;
      if (S.idle > 6 && !S.said.has('idle')) {
        S.said.add('idle');
        sub('등 뒤: 「왜 멈췄어? 기다려 줄까?」', 3, '#ff9a9a');
        Sound.whisper();
      }
    }
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt);
  }

  // =========================================================
  //  몬스터: 출석부
  // =========================================================
  const ROLL_NAMES = ['김민수', '오석진', '박하늘', '이수아', '최지훈', '정예린', '백도경', '강태오', '류채이'];

  function spawnRollCaller(atTile) {
    let m = G.monsters.find((q) => q.type === 'roll');
    if (!m) {
      m = { type: 'roll', x: 0, y: 0, r: 12, state: 'absent', alpha: 0, path: null, repath: 0, lostT: 0, callT: 2.5, bubble: '', bubbleT: 0, face: 0 };
      G.monsters.push(m);
    }
    let t = atTile;
    if (!t) {
      const P = G.player;
      let best = null, bd = -1;
      for (let i = 0; i < 50; i++) {
        const h = pick(G.hallTiles);
        const d = Math.hypot(tc(h.x) - P.x, tc(h.y) - P.y);
        if (d > bd) { bd = d; best = h; }
      }
      t = best;
    }
    m.x = tc(t.x); m.y = tc(t.y);
    m.state = 'patrol'; m.alpha = 0; m.path = null; m.lostT = 0;
    return m;
  }

  function updateRoll(m, dt) {
    if (m.bubbleT > 0) m.bubbleT -= dt;
    if (m.state === 'absent') return;
    if (m.state === 'leaving') {
      m.alpha -= dt * 0.8;
      if (m.alpha <= 0) { m.alpha = 0; m.state = 'absent'; }
      return;
    }
    m.alpha = Math.min(1, m.alpha + dt * 0.7);
    if (m.state === 'scripted') return;
    const P = G.player;
    const d = dist(m, P);
    const pSafe = playerSafe();

    m.callT -= dt;
    if (m.callT <= 0 && m.state !== 'chase') {
      m.callT = rand(4.5, 7.5);
      const name = pick(ROLL_NAMES);
      m.bubble = name + '?';
      m.bubbleT = 2.2;
      if (d < 14 * TILE) Sound.speak(name, { pitch: 0.05, rate: 0.55, volume: clamp(1 - d / (14 * TILE), 0.15, 0.8) });
    }

    const inClass = G.bell && G.bell.phase === 'class';
    const sees = !pSafe && m.alpha > 0.5 && (inClass || (d < 7.5 * TILE && los(m.x, m.y, P.x, P.y)));
    if (sees && m.state !== 'chase') {
      m.state = 'chase';
      m.bubble = PLAYER_NAME + '?';
      m.bubbleT = 2.5;
      Sound.stinger();
      Sound.speak(PLAYER_NAME, { pitch: 0.05, rate: 0.6 });
    }

    if (m.state === 'chase') {
      if (pSafe) {
        m.state = 'patrol'; m.path = null;
        m.bubble = '…결석.'; m.bubbleT = 2;
        return;
      }
      m.lostT = sees ? 0 : m.lostT + dt;
      if (m.lostT > 4) { m.state = 'patrol'; m.path = null; return; }
      if (d < TILE * 1.3) {
        m.x += ((P.x - m.x) / d) * 160 * dt;
        m.y += ((P.y - m.y) / d) * 160 * dt;
        m.face = Math.atan2(P.y - m.y, P.x - m.x);
      } else {
        m.repath -= dt;
        if (m.repath <= 0) {
          m.repath = 0.25;
          const pt = tileOf(P), mt = tileOf(m);
          m.path = passHall(pt.x, pt.y) ? bfs(mt.x, mt.y, pt.x, pt.y, passHall) : null;
        }
        followPath(m, m.path, 160, dt);
      }
      if (d < 20) kill('rollcall');
    } else {
      if (!m.path || !m.path.length) {
        const mt = tileOf(m);
        const h = pick(G.hallTiles);
        m.path = bfs(mt.x, mt.y, h.x, h.y, passHall);
      }
      followPath(m, m.path, 58, dt);
    }
  }

  // =========================================================
  //  몬스터: 칠판지우개
  // =========================================================
  function spawnEraser(x, y, mul) {
    G.monsters.push({ type: 'eraser', x: tc(x), y: tc(y), r: 14, state: 'wander', path: null, pause: 0, mul, face: 0, bubble: '', bubbleT: 0, shhT: 3, scrapeT: 0 });
  }

  function eraserHear(m, x, y, R, safe) {
    if (safe) return;
    if (Math.hypot(m.x - x, m.y - y) > R) return;
    const t = tileOf({ x, y }), mt = tileOf(m);
    if (!passEraser(t.x, t.y)) return;
    const p = bfs(mt.x, mt.y, t.x, t.y, passEraser);
    if (!p) return;
    m.path = p;
    if (m.state !== 'hunt') { m.bubble = '쉬이—'; m.bubbleT = 1.6; }
    m.state = 'hunt';
  }

  function updateEraser(m, dt) {
    if (m.bubbleT > 0) m.bubbleT -= dt;
    const P = G.player;
    const d = dist(m, P);
    if (m.state === 'hunt') {
      m.scrapeT -= dt;
      if (m.scrapeT <= 0) { m.scrapeT = 0.7; Sound.scrape(clamp(1.2 - d / (12 * TILE), 0.1, 1)); }
      if (followPath(m, m.path, 124 * m.mul, dt)) { m.state = 'listen'; m.pause = 2.2; m.bubble = '……'; m.bubbleT = 1.5; }
    } else if (m.state === 'listen') {
      m.pause -= dt;
      if (m.pause <= 0) { m.state = 'wander'; m.path = null; }
    } else {
      if (!m.path || !m.path.length) {
        const mt = tileOf(m);
        for (let i = 0; i < 12; i++) {
          const tx = mt.x + ((Math.random() * 24) | 0) - 12, ty = mt.y + ((Math.random() * 5) | 0) - 2;
          if (passEraser(tx, ty)) { m.path = bfs(mt.x, mt.y, tx, ty, passEraser); break; }
        }
      }
      followPath(m, m.path, 35 * m.mul, dt);
    }
    m.shhT -= dt;
    if (m.shhT <= 0) {
      m.shhT = rand(3, 5.5);
      if (d < 10 * TILE) Sound.shh(clamp(1.1 - d / (10 * TILE), 0.1, 1));
    }
    if (Math.random() < dt * (m.state === 'hunt' ? 30 : 8)) {
      G.particles.push({ x: m.x + rand(-14, 14), y: m.y + rand(-8, 8), vx: rand(-10, 10), vy: rand(-10, 10), h: rand(0.9, 1.6), vh: rand(0.05, 0.3), life: rand(0.8, 1.6), max: 1.6, c: '235,235,225', s: rand(1, 2.5) });
    }
    if (d < 24 && !playerSafe()) kill('eraser');
  }

  // =========================================================
  //  몬스터: 거꾸로 (거울 도플갱어)
  // =========================================================
  function updateMirror(dt) {
    if (!G.mirrors.length) return;
    const P = G.player;
    let gazing = false, near = null;
    if (playerTile() === 'r') {
      for (const mr of G.mirrors) {
        const mx = tc(mr.x), my = mr.y * TILE + 6;
        const d = Math.hypot(mx - P.x, my - P.y);
        if (d < 3.6 * TILE && Math.abs(angDiff(Math.atan2(my - P.y, mx - P.x), P.face)) < 0.8) { gazing = true; near = mr; break; }
      }
    }
    G.gaze = gazing ? Math.min(1.2, G.gaze + dt / 2.2) : Math.max(0, G.gaze - dt / 3);
    if (G.gaze > 0.45 && !G.gazeWarned) {
      G.gazeWarned = true;
      G.reflX = P.x;
      Sound.whisper();
      sub('…거울 속의 내가 반 박자 늦게 움직인다.', 3, '#9fd3ff');
    }
    if (G.gaze < 0.1) { G.gazeWarned = false; G.reflX = null; }
    if (G.gaze >= 1 && !G.doppel && near) {
      G.doppel = { type: 'doppel', x: tc(near.x), y: near.y * TILE + 4, r: 10, alpha: 0, wake: 1.1, idle: 0, path: null, repath: 0, face: -Math.PI / 2, bubble: reverseStr('자꾸바 리자'), bubbleT: 2.5 };
      G.monsters.push(G.doppel);
      G.flash = 0.5; G.flashColor = '150,200,255';
      Sound.stinger();
      sub('거울 속의 하람이 웃었다. 그리고 유리 밖으로 손을 뻗었다.', 3.5, '#9fd3ff');
    }
  }

  function updateDoppel(m, dt) {
    if (m.bubbleT > 0) m.bubbleT -= dt;
    m.alpha = Math.min(1, m.alpha + dt * 1.5);
    const P = G.player;
    if (m.wake > 0) {
      m.wake -= dt;
      m.y += 22 * dt;
      return;
    }
    if (playerTile() === 'r') {
      m.idle = 0;
      const d = dist(m, P);
      if (d < TILE * 1.2) {
        m.x += ((P.x - m.x) / d) * 85 * dt;
        m.y += ((P.y - m.y) / d) * 85 * dt;
        m.face = Math.atan2(P.y - m.y, P.x - m.x);
      } else {
        m.repath -= dt;
        if (m.repath <= 0) {
          m.repath = 0.3;
          const pt = tileOf(P), mt = tileOf(m);
          m.path = bfs(mt.x, mt.y, pt.x, pt.y, passRest);
        }
        followPath(m, m.path, 85, dt);
      }
      if (d < 18) kill('mirror');
    } else {
      m.idle += dt;
      m.bubble = reverseStr('와 리이 왜'); m.bubbleT = 0.5;
      if (m.idle > 4) {
        m.gone = true;
        G.doppel = null;
        G.gaze = 0;
      }
    }
  }

  const MON_UPDATE = { roll: updateRoll, eraser: updateEraser, doppel: updateDoppel };

  // =========================================================
  //  수업 종 / 방송
  // =========================================================
  function startClass() {
    const b = G.bell;
    b.phase = 'class'; b.t = CLASS_T; b.period++; b.warned = false;
    Sound.bell(true);
    sub(`— ${b.period}교시 수업 종이 울렸다 —`, 3, '#ff8a8a');
    if (G.persistent.introDone) spawnRollCaller();
  }

  function startBreak() {
    const b = G.bell;
    b.phase = 'break'; b.t = BREAK_T; b.warned = false;
    Sound.bell(false);
    sub('— 쉬는 시간 —', 3, '#9fe0a8');
    const m = G.monsters.find((q) => q.type === 'roll');
    if (m && m.state !== 'absent') m.state = 'leaving';
  }

  function updateBell(dt) {
    const b = G.bell;
    if (!b.enabled) return;
    b.t -= dt;
    if (b.phase === 'break') {
      if (b.t <= 8 && !b.warned) { b.warned = true; toast('째깍… 째깍… 곧 수업 종이 울린다!'); }
      if (b.warned) {
        b.tickT -= dt;
        if (b.tickT <= 0) { b.tickT = 0.5; b.tickHi = !b.tickHi; Sound.tick(b.tickHi); }
      }
      if (b.t <= 0) startClass();
    } else if (b.t <= 0) startBreak();
  }

  const BC_LINES = {
    gate: ['지지직… 안내 방송입니다. 1층에 있는 학생들은 지금 즉시 중앙 현관으로 대피하십시오.', '…반복합니다. 중앙 현관이 열렸습니다. 질서 있게, 질서 있게 대피하십시오.'],
    hall: ['지지직… 수업이 끝났습니다. 모든 학생은 지금 복도로 나와 한 줄로 서십시오.', '…복도로 나오십시오. 출석을 확인하겠습니다.'],
  };

  function updateBroadcast(dt) {
    const bc = G.bc;
    if (!bc) return;
    if (!bc.active) {
      bc.next -= dt;
      if (bc.next > 0) return;
      bc.active = true;
      bc.t = 11;
      bc.type = G.bell.phase === 'class' && Math.random() < 0.6 ? 'hall' : 'gate';
      Sound.staticNoise(1.6);
      if (G.speakers.length) { const s = pick(G.speakers); makeNoise(s.x, s.y, 7); }
      const lines = BC_LINES[bc.type];
      addTimer(1.3, () => {
        if (!G.bc || !G.bc.active) return;
        sub('스피커: 「' + lines[0] + '」', 5, '#9dffb5');
        Sound.speak(lines[0].replace('지지직… ', ''), { pitch: 0.7, rate: 0.95, volume: 0.7 });
        if (bc.type === 'gate') { G.gateOpen = true; Sound.unlock(); }
      });
      addTimer(6.5, () => {
        if (!G.bc || !G.bc.active) return;
        sub('스피커: 「' + lines[1] + '」', 4.5, '#9dffb5');
        Sound.staticNoise(0.6);
      });
    } else {
      bc.t -= dt;
      if (bc.t <= 0) {
        bc.active = false;
        G.gateOpen = false;
        bc.next = G.flags.metChaeyi ? rand(65, 85) : rand(38, 52);
        Sound.staticNoise(0.4);
      }
    }
  }

  // =========================================================
  //  플레이어 / NPC
  // =========================================================
  function updatePlayer(dt) {
    const P = G.player;
    P.face += mouse.dx * 0.0024;
    P.pitch = clamp(P.pitch - mouse.dy * 0.0024, -1.25, 1.25);
    if (held('ArrowLeft')) P.face -= 2.2 * dt;
    if (held('ArrowRight')) P.face += 2.2 * dt;
    if (P.face > Math.PI) P.face -= Math.PI * 2;
    if (P.face < -Math.PI) P.face += Math.PI * 2;
    let fw = 0, sd = 0;
    if (held('KeyW', 'ArrowUp')) fw += 1;
    if (held('KeyS', 'ArrowDown')) fw -= 1;
    if (held('KeyD')) sd += 1;
    if (held('KeyA')) sd -= 1;
    const sneak = held('KeyC');
    const run = !sneak && held('ShiftLeft', 'ShiftRight');
    P.stance = sneak ? 'sneak' : run ? 'run' : 'walk';
    const sp = { sneak: 44, walk: 82, run: 148 }[P.stance];
    const len = Math.hypot(fw, sd);
    P.moving = len > 0;
    P.eye = lerp(P.eye, sneak ? 1.15 : 1.6, Math.min(1, dt * 8));
    if (P.moving) {
      const cf = Math.cos(P.face), sf = Math.sin(P.face);
      const mx = (cf * fw - sf * sd) / len, my = (sf * fw + cf * sd) / len;
      const ox = P.x, oy = P.y;
      moveEntity(P, mx * sp * dt, my * sp * dt, G.def.block);
      const movedD = Math.hypot(P.x - ox, P.y - oy);
      P.bobT += movedD * 0.11;
      P.bob = Math.sin(P.bobT) * (P.stance === 'run' ? 0.05 : 0.03);
      if (movedD > 0.1) {
        P.stepT -= dt;
        if (P.stepT <= 0) {
          P.stepT = { sneak: 0.55, walk: 0.42, run: 0.28 }[P.stance];
          Sound.step(P.stance);
          const R = { sneak: 0, walk: 3, run: 8.5 }[P.stance];
          if (R > 0) makeNoise(P.x, P.y, R);
        }
      }
    }
    else P.bob = lerp(P.bob, 0, Math.min(1, dt * 6));
    P.noise = lerp(P.noise, P.moving ? { sneak: 0.06, walk: 0.35, run: 1 }[P.stance] : 0, Math.min(1, dt * 6));

    const t = playerTile();
    const safe = isSafeTile(t);
    if (P.wasSafe && !safe && G.bc && G.bc.active && G.bc.type === 'hall' && G.bc.t < 9.7) {
      kill('broadcast');
      return;
    }
    P.wasSafe = safe;
    if (t === 'G' && G.gateOpen) { kill('broadcast'); return; }
    if (t === 'S' && G.def.onStairs) { G.def.onStairs(); return; }
    if (G.def.id === 'B1' && G.flags.examPassed && G.exitCircle && dist(P, G.exitCircle) < 26) startEnding();
  }

  function updateNPCs(dt) {
    const P = G.player;
    for (const n of G.npcs) {
      if (n.bubbleT > 0) n.bubbleT -= dt;
      if (n.fading) { n.alpha -= dt * 0.6; if (n.alpha <= 0) n.gone = true; }
      if (n.path && n.path.length) {
        const [px, py] = n.path[0];
        const tx = tc(px), ty = tc(py);
        const dx = tx - n.x, dy = ty - n.y, d = Math.hypot(dx, dy);
        const st = (n.speed || 56) * dt;
        if (d <= st) {
          n.x = tx; n.y = ty; n.path.shift();
          if (!n.path.length && n.onArrive) { const cb = n.onArrive; n.onArrive = null; cb(n); }
        } else { n.x += (dx / d) * st; n.y += (dy / d) * st; n.face = Math.atan2(dy, dx); }
      } else if (n.lookAtPlayer && dist(n, P) < 5 * TILE) {
        n.face += angDiff(Math.atan2(P.y - n.y, P.x - n.x), n.face) * Math.min(1, dt * 4);
      }
      if (n.fake) updateFake(n, dt);
    }
    G.npcs = G.npcs.filter((n) => !n.gone);
  }

  function updateFake(n, dt) {
    const P = G.player;
    const d = dist(n, P);
    n.face = Math.atan2(P.y - n.y, P.x - n.x);
    if (n.talked) return;
    const safe = playerSafe();
    if (d < 46 && !safe) { n.talked = true; talkFake(n); return; }
    if (safe) {
      if (n.bubbleT <= 0) { n.bubble = reverseStr(pick(['하람아, 나와 봐. 나야.', '거기 있는 거 알아.', '왜 안 나와?'])); n.bubbleT = 3; }
    }
    n.repath -= dt;
    if (n.repath <= 0) {
      n.repath = 0.5;
      const pt = tileOf(P), nt = tileOf(n);
      n.mpath = passHall(pt.x, pt.y) ? bfs(nt.x, nt.y, pt.x, pt.y, passHall) : n.mpath;
    }
    followPath(n, n.mpath, 42, dt);
  }

  // =========================================================
  //  상호작용
  // =========================================================
  // 1인칭: 시선 방향 앞쪽 원뿔 안의 가장 가까운 대상
  function findInteract() {
    const P = G.player;
    let best = null, bs = Infinity;
    const score = (e, reach) => {
      const d = dist(P, e);
      if (d > reach) return Infinity;
      const a = Math.abs(angDiff(Math.atan2(e.y - P.y, e.x - P.x), P.face));
      if (d > 18 && a > 0.75) return Infinity;
      return d + a * 30;
    };
    for (const o of G.objects) {
      if (o.noInteract || o.hidden) continue;
      const s = score(o, 56);
      if (s < bs) { best = o; bs = s; }
    }
    for (const n of G.npcs) {
      if (!n.talk || n.gone) continue;
      const s = score(n, 60);
      if (s < bs) { best = n; bs = s; }
    }
    if (!best) {
      const cf = Math.cos(P.face), sf = Math.sin(P.face);
      for (let d = 8; d <= 52; d += 6) {
        const tx = Math.floor((P.x + cf * d) / TILE), ty = Math.floor((P.y + sf * d) / TILE);
        const t = tileAt(tx, ty);
        if (t === 'L') return { kind: 'lock', tx, ty, label: '잠긴 문 열기' };
        if (t === 'U') return { kind: 'up', label: '위층 계단 살펴보기' };
        if (isSolid(tx, ty)) break;
      }
    }
    return best;
  }

  function interact(o) {
    if (o.talk) { o.talk(o); return; }
    switch (o.kind) {
      case 'note':
        G.overlay = { type: 'note', title: o.title, text: o.text };
        Sound.page();
        o.read = true;
        for (const r of o.rules || []) unlockRule(r);
        if (o.flag) G.flags[o.flag] = true;
        break;
      case 'tag':
        G.overlay = { type: 'note', title: o.title, text: o.text };
        Sound.page();
        o.read = true;
        unlockRule('R2');
        break;
      case 'key':
        G.inventory.add(o.id);
        G.objects = G.objects.filter((q) => q !== o);
        Sound.pickup();
        toast(`「${o.name}」 획득.`);
        break;
      case 'board':
        G.overlay = { type: 'board' };
        Sound.page();
        break;
      case 'examdesk':
        if (G.flags.examPassed) { toast('답안지는 이미 걷어 갔다.'); break; }
        startDialog([
          { who: '감독관', text: '착석.' },
          { who: '감독관', text: '44교시 생존수업 기말고사. 문항은 다섯. 두 번 틀리면… 0점이다.' },
        ], { onEnd: startExam });
        break;
      case 'lock': {
        const need = G.def.lockKey;
        if (need && G.inventory.has(need)) {
          G.grid[o.ty][o.tx] = 'D';
          Sound.unlock();
          makeNoise(tc(o.tx), tc(o.ty), 4.5);
          toast('철컥. 문이 열렸다. …소리가 컸다.');
        } else {
          Sound.blip();
          toast('잠겨 있다. 열쇠가 필요하다.');
        }
        break;
      }
      case 'up':
        toast('위층으로 가는 계단은 검게 무너져 있다. 출구는 아래다.');
        unlockRule('R6');
        break;
    }
  }

  // =========================================================
  //  대화창
  // =========================================================
  function startDialog(lines, opts = {}) {
    G.dialog = { lines, i: 0, charT: 0, choices: opts.choices || null, onEnd: opts.onEnd || null, sel: -1, rects: [], choiceT: 0 };
    Sound.blip();
  }
  const lineText = (l) => (l.rev ? reverseStr(l.text) : l.text);

  function updateDialog(dt) {
    const D = G.dialog;
    const line = D.lines[D.i];
    const full = lineText(line);
    const before = Math.floor(D.charT);
    D.charT += dt * 40;
    const shown = Math.min(full.length, Math.floor(D.charT));
    if (shown > before && shown < full.length && shown % 3 === 0) Sound.blip();
    const last = D.i === D.lines.length - 1;
    if (last && D.choices && shown >= full.length) {
      // 대사를 연타하다 실수로 선택지가 골라지지 않도록, 선택지는 숫자/방향키+Enter/클릭으로만 고른다
      D.choiceT += dt;
      if (D.choiceT < 0.5) return;
      if (hit('ArrowUp', 'KeyW')) D.sel = D.sel < 0 ? D.choices.length - 1 : (D.sel + D.choices.length - 1) % D.choices.length;
      if (hit('ArrowDown', 'KeyS')) D.sel = (D.sel + 1) % D.choices.length;
      let chosen = -1;
      D.choices.forEach((c, k) => { if (hit('Digit' + (k + 1))) chosen = k; });
      if (mouse.click) D.rects.forEach((r, k) => { if (inRect(r)) chosen = k; });
      if (hit('Enter') && D.sel >= 0) chosen = D.sel;
      if (chosen >= 0) {
        const c = D.choices[chosen];
        G.dialog = null;
        if (c.action) c.action();
      }
      return;
    }
    if (hit('KeyE', 'Space', 'Enter') || mouse.click) {
      if (shown < full.length) D.charT = full.length;
      else {
        D.i++;
        D.charT = 0;
        if (D.i >= D.lines.length) {
          const cb = D.onEnd;
          G.dialog = null;
          if (cb) cb();
        }
      }
    }
  }

  // =========================================================
  //  오버레이 (수첩, 쪽지, 게시판, 시험, 일시정지)
  // =========================================================
  function updateOverlay(dt) {
    const o = G.overlay;
    if (o.type === 'exam') { updateExam(o, dt); return; }
    if (o.type === 'pause') {
      if (G.pauseGuard > 0) { G.pauseGuard -= dt; return; }
      if (hit('Escape', 'Enter', 'Space') || mouse.click) { G.overlay = null; requestLock(); }
      if (hit('KeyQ')) { Sound.stopDrone(); G.overlay = null; G.scene = 'title'; releaseLock(); }
      return;
    }
    if (hit('Escape', 'KeyE', 'Space', 'Enter', 'Tab', 'KeyR') || mouse.click) { G.overlay = null; Sound.page(); }
  }

  function updateExam(o, dt) {
    if (o.fb) {
      o.fbT -= dt;
      if (o.fbT <= 0) {
        if (o.wrong >= 2) { G.overlay = null; kill('exam'); return; }
        o.fb = null; o.i++; o.sel = -1; o.cool = 0.5;
        if (o.i >= o.qs.length) { G.overlay = null; examPassed(o.wrong); }
      }
      return;
    }
    if (o.cool > 0) { o.cool -= dt; return; }
    const q = o.qs[o.i];
    if (hit('ArrowUp', 'KeyW')) o.sel = o.sel < 0 ? 3 : (o.sel + 3) % 4;
    if (hit('ArrowDown', 'KeyS')) o.sel = (o.sel + 1) % 4;
    let chosen = -1;
    for (let k = 0; k < 4; k++) if (hit('Digit' + (k + 1))) chosen = k;
    if (mouse.click) o.rects.forEach((r, k) => { if (inRect(r)) chosen = k; });
    if (hit('Enter') && o.sel >= 0) chosen = o.sel;
    if (chosen < 0) return;
    o.sel = chosen;
    const ok = q.opts[chosen].ok;
    o.fb = ok ? '정답.' : '오답.';
    o.fbOk = ok;
    o.fbT = 1.4;
    if (ok) Sound.pickup();
    else { o.wrong++; Sound.stinger(); G.shake = 0.6; }
  }

  // =========================================================
  //  메인 업데이트
  // =========================================================
  function updateMessages(dt) {
    for (const t of G.toasts) t.t -= dt;
    G.toasts = G.toasts.filter((t) => t.t > 0);
    for (const s of G.subs) s.t -= dt;
    G.subs = G.subs.filter((s) => s.t > 0);
  }

  function updatePlay(dt) {
    updateMessages(dt);
    if (G.flash > 0) G.flash = Math.max(0, G.flash - dt * 1.5);
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt);
    if (G.dialog) { updateDialog(dt); return; }
    if (G.overlay) { updateOverlay(dt); return; }
    if (hit('Escape')) { G.overlay = { type: 'pause' }; return; }
    if (hit('Tab', 'KeyR')) {
      if (G.inventory.has('notebook') || G.rules.size) { G.overlay = { type: 'rules' }; Sound.page(); }
      else toast('아직 수첩이 없다.');
      return;
    }
    if (hit('KeyM')) toast(Sound.toggleMute() ? '소리 끔' : '소리 켬');
    if (hit('KeyF')) G.showMap = !G.showMap;

    G.floorTime += dt;
    const timers = G.timers;
    G.timers = [];
    for (const t of timers) {
      t.t -= dt;
      if (t.t <= 0) t.fn(); else G.timers.push(t);
      if (G.scene !== 'play') return;
    }
    if (G.dialog) return;

    updateBell(dt);
    updateBroadcast(dt);
    updatePlayer(dt);
    if (G.scene !== 'play') return;
    updateMirror(dt);
    updateNPCs(dt);
    for (const m of G.monsters) {
      MON_UPDATE[m.type](m, dt);
      if (G.scene !== 'play') return;
    }
    G.monsters = G.monsters.filter((m) => !m.gone);

    for (const r of G.rings) { r.r += (r.max / 0.7) * dt; r.life -= dt / 0.7; }
    G.rings = G.rings.filter((r) => r.life > 0);
    for (const p of G.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.h += (p.vh || 0) * dt; p.life -= dt; }
    G.particles = G.particles.filter((p) => p.life > 0);

    // 위험도 / 심장박동
    let near = Infinity;
    for (const m of G.monsters) {
      if (m.type === 'roll' && (m.state === 'absent' || m.alpha < 0.3)) continue;
      near = Math.min(near, dist(m, G.player));
    }
    G.danger = lerp(G.danger, near < 8 * TILE ? 1 - near / (8 * TILE) : 0, Math.min(1, dt * 3));
    if (G.danger > 0.15) {
      G.hbT -= dt;
      if (G.hbT <= 0) { G.hbT = lerp(1.1, 0.42, G.danger); Sound.heartbeat(0.4 + G.danger * 0.6); }
    }
    const droneLevel = Math.round((0.04 + G.danger * 0.05) * 200) / 200;
    if (droneLevel !== G.droneLevel) { G.droneLevel = droneLevel; Sound.setDrone(droneLevel); }

    if (G.def.flicker && Math.random() < G.def.flicker) G.flickT = rand(0.05, 0.3);
    if (G.flickT > 0) G.flickT -= dt;

    G.focus = findInteract();
    if (G.focus && hit('KeyE', 'Space')) interact(G.focus);
  }

  function updateTitle() {
    const n = 3;
    if (hit('ArrowUp', 'KeyW')) { G.titleSel = (G.titleSel + n - 1) % n; Sound.blip(); }
    if (hit('ArrowDown', 'KeyS')) { G.titleSel = (G.titleSel + 1) % n; Sound.blip(); }
    let chosen = -1;
    if (hit('Enter', 'Space', 'KeyE')) chosen = G.titleSel;
    if (mouse.click && G.titleRects) G.titleRects.forEach((r, k) => { if (inRect(r)) chosen = k; });
    if (chosen === 0) newGame();
    if (chosen === 1) { G.scene = 'codex'; G.codexIdx = 0; Sound.page(); }
    if (chosen === 2) { G.scene = 'controls'; Sound.page(); }
  }

  function updateCodex() {
    const list = G.codexTab === 0 ? CODEX_PEOPLE : CODEX_GHOSTS;
    if (hit('ArrowLeft', 'KeyA')) { G.codexIdx = (G.codexIdx + list.length - 1) % list.length; Sound.page(); }
    if (hit('ArrowRight', 'KeyD')) { G.codexIdx = (G.codexIdx + 1) % list.length; Sound.page(); }
    if (hit('Tab', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyS')) { G.codexTab = 1 - G.codexTab; G.codexIdx = 0; Sound.page(); }
    if (mouse.click) {
      if (mouse.y < 90) { G.codexTab = mouse.x < VW / 2 ? 0 : 1; G.codexIdx = 0; }
      else if (mouse.x < 120) G.codexIdx = (G.codexIdx + list.length - 1) % list.length;
      else if (mouse.x > VW - 120) G.codexIdx = (G.codexIdx + 1) % list.length;
      Sound.page();
    }
    if (hit('Escape', 'Enter', 'Backspace')) G.scene = 'title';
  }

  function startEnding() {
    G.scene = 'ending';
    G.end = { t: 0, wrong: G.examWrong || 0, deaths: G.persistent.deaths, secs: (performance.now() - G.persistent.start) / 1000, period: G.bell.period };
    Sound.stopDrone();
    releaseLock();
  }

  function update(dt) {
    switch (G.scene) {
      case 'title': updateTitle(); break;
      case 'codex': updateCodex(); break;
      case 'controls': if (hit('Escape', 'Enter', 'Space') || mouse.click) G.scene = 'title'; break;
      case 'transition':
        G.trans.t += dt;
        updateMessages(dt);
        if (G.trans.t > 2.6) G.trans.next();
        break;
      case 'play': updatePlay(dt); break;
      case 'stairs': updateStairs(dt); break;
      case 'dead':
        G.deadT += dt;
        if (G.deadT > 1.5 && (hit('KeyR', 'Enter', 'Space') || mouse.click)) restart();
        if (G.deadT > 1.5 && hit('Escape')) { Sound.stopDrone(); G.scene = 'title'; }
        break;
      case 'ending':
        G.end.t += dt;
        if (G.end.t > 4 && (hit('Enter', 'Escape') || mouse.click)) G.scene = 'title';
        break;
    }
  }

  // =========================================================
  //  그리기 헬퍼
  // =========================================================
  function ellipse(c, x, y, rx, ry, rot = 0) { c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2); c.fill(); }
  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2); c.fill(); }
  function rrect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function wrap(c, text, maxW) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const ch of para) {
        const test = line + ch;
        if (c.measureText(test).width > maxW && line) {
          const sp = line.lastIndexOf(' ');
          if (sp > 0 && line.length - sp < 8) { out.push(line.slice(0, sp)); line = line.slice(sp + 1) + ch; }
          else { out.push(line); line = ch; }
        } else line = test;
      }
      out.push(line);
    }
    return out;
  }
  function textBlock(c, text, x, y, maxW, lh) {
    const lines = wrap(c, text, maxW);
    lines.forEach((l, i) => c.fillText(l, x, y + i * lh));
    return lines.length * lh;
  }
  function panel(x, y, w, h, a = 0.75) {
    ctx.fillStyle = `rgba(8,8,12,${a})`;
    rrect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  function shadowText(text, x, y, color = '#fff', blur = 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillText(text, x + 1, y + 1);
    if (blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
  }

  // ---------- 초상화 (정면) ----------
  function drawPortrait(c, key, cx, cy, s, o = {}) {
    const ch = CHARS[key];
    if (!ch) return;
    if (ch.ghost) { drawGhostArt(c, ch.ghost, cx, cy, s * 1.2, G.time); return; }
    c.save();
    if (o.mirrored) { c.translate(cx, 0); c.scale(-1, 1); c.translate(-cx, 0); }
    if (o.faceless) c.globalAlpha = 0.8;
    if (ch.style === 'long') { c.fillStyle = ch.hair; rrect(c, cx - 0.28 * s, cy - 0.3 * s, 0.56 * s, 0.66 * s, 0.2 * s); c.fill(); }
    // 몸
    c.fillStyle = ch.body;
    c.beginPath();
    c.moveTo(cx - 0.5 * s, cy + 0.56 * s);
    c.quadraticCurveTo(cx - 0.48 * s, cy + 0.18 * s, cx - 0.2 * s, cy + 0.14 * s);
    c.lineTo(cx + 0.2 * s, cy + 0.14 * s);
    c.quadraticCurveTo(cx + 0.48 * s, cy + 0.18 * s, cx + 0.5 * s, cy + 0.56 * s);
    c.closePath();
    c.fill();
    c.fillStyle = '#e9e9e4';
    c.beginPath(); c.moveTo(cx - 0.1 * s, cy + 0.14 * s); c.lineTo(cx, cy + 0.34 * s); c.lineTo(cx + 0.1 * s, cy + 0.14 * s); c.closePath(); c.fill();
    c.fillStyle = ch.tie;
    c.beginPath();
    c.moveTo(cx - 0.025 * s, cy + 0.17 * s); c.lineTo(cx + 0.025 * s, cy + 0.17 * s);
    c.lineTo(cx + 0.04 * s, cy + 0.37 * s); c.lineTo(cx, cy + 0.42 * s); c.lineTo(cx - 0.04 * s, cy + 0.37 * s);
    c.closePath(); c.fill();
    // 이름표 (착용자 기준 오른쪽 가슴 = 화면 왼쪽)
    if (!ch.adult) {
      c.fillStyle = '#f4f4f0'; c.fillRect(cx - 0.36 * s, cy + 0.26 * s, 0.15 * s, 0.055 * s);
      c.fillStyle = '#444'; c.fillRect(cx - 0.34 * s, cy + 0.278 * s, 0.11 * s, 0.018 * s);
    }
    // 단추
    c.fillStyle = '#c9b46a';
    for (let i = 0; i < 2; i++) circle(c, cx + 0.16 * s, cy + (0.3 + i * 0.12) * s, 0.018 * s);
    // 목, 얼굴
    c.fillStyle = o.faceless ? '#b9b4ab' : ch.skin;
    c.fillRect(cx - 0.06 * s, cy + 0.03 * s, 0.12 * s, 0.13 * s);
    ellipse(c, cx, cy - 0.08 * s, 0.2 * s, 0.24 * s);
    // 머리카락
    c.fillStyle = ch.hair;
    switch (ch.style) {
      case 'short':
        c.beginPath(); c.ellipse(cx, cy - 0.2 * s, 0.22 * s, 0.15 * s, 0, Math.PI, 0); c.fill();
        c.beginPath(); c.moveTo(cx - 0.22 * s, cy - 0.2 * s);
        c.quadraticCurveTo(cx + 0.02 * s, cy - 0.06 * s, cx + 0.22 * s, cy - 0.15 * s);
        c.lineTo(cx + 0.22 * s, cy - 0.22 * s); c.closePath(); c.fill();
        break;
      case 'long':
        c.beginPath(); c.ellipse(cx, cy - 0.2 * s, 0.23 * s, 0.16 * s, 0, Math.PI, 0); c.fill();
        c.beginPath(); c.moveTo(cx - 0.23 * s, cy - 0.2 * s);
        c.quadraticCurveTo(cx - 0.1 * s, cy - 0.1 * s, cx + 0.04 * s, cy - 0.17 * s);
        c.lineTo(cx + 0.23 * s, cy - 0.22 * s); c.closePath(); c.fill();
        c.fillRect(cx - 0.25 * s, cy - 0.2 * s, 0.06 * s, 0.38 * s);
        c.fillRect(cx + 0.19 * s, cy - 0.2 * s, 0.06 * s, 0.38 * s);
        break;
      case 'buzz':
        c.beginPath(); c.ellipse(cx, cy - 0.17 * s, 0.205 * s, 0.15 * s, 0, Math.PI, 0); c.fill();
        break;
      case 'bob':
        c.beginPath(); c.ellipse(cx, cy - 0.18 * s, 0.25 * s, 0.18 * s, 0, Math.PI, 0); c.fill();
        c.fillRect(cx - 0.25 * s, cy - 0.18 * s, 0.08 * s, 0.24 * s);
        c.fillRect(cx + 0.17 * s, cy - 0.18 * s, 0.08 * s, 0.24 * s);
        c.beginPath(); c.moveTo(cx - 0.2 * s, cy - 0.22 * s);
        c.quadraticCurveTo(cx - 0.15 * s, cy - 0.08 * s, cx - 0.02 * s, cy - 0.12 * s);
        c.lineTo(cx + 0.2 * s, cy - 0.2 * s); c.closePath(); c.fill();
        break;
      case 'side':
        c.beginPath(); c.ellipse(cx, cy - 0.19 * s, 0.215 * s, 0.14 * s, 0, Math.PI, 0); c.fill();
        c.beginPath(); c.moveTo(cx - 0.2 * s, cy - 0.2 * s); c.quadraticCurveTo(cx - 0.12 * s, cy - 0.3 * s, cx + 0.21 * s, cy - 0.16 * s); c.lineTo(cx + 0.21 * s, cy - 0.22 * s); c.closePath(); c.fill();
        break;
    }
    if (ch.band) { c.fillStyle = '#d03a3a'; c.fillRect(cx - 0.21 * s, cy - 0.2 * s, 0.42 * s, 0.04 * s); }
    // 얼굴
    if (!o.faceless) {
      const ey = cy - 0.07 * s;
      if (o.blackEyes) {
        c.fillStyle = '#000';
        ellipse(c, cx - 0.08 * s, ey, 0.045 * s, 0.055 * s);
        ellipse(c, cx + 0.08 * s, ey, 0.045 * s, 0.055 * s);
      } else {
        c.fillStyle = '#fff';
        ellipse(c, cx - 0.08 * s, ey, 0.035 * s, 0.025 * s);
        ellipse(c, cx + 0.08 * s, ey, 0.035 * s, 0.025 * s);
        c.fillStyle = '#1b1410';
        circle(c, cx - 0.08 * s, ey, 0.018 * s);
        circle(c, cx + 0.08 * s, ey, 0.018 * s);
      }
      if (ch.glasses) {
        c.strokeStyle = '#222'; c.lineWidth = Math.max(1, 0.012 * s);
        c.strokeRect(cx - 0.14 * s, ey - 0.04 * s, 0.11 * s, 0.075 * s);
        c.strokeRect(cx + 0.03 * s, ey - 0.04 * s, 0.11 * s, 0.075 * s);
        c.beginPath(); c.moveTo(cx - 0.03 * s, ey); c.lineTo(cx + 0.03 * s, ey); c.stroke();
      }
      c.strokeStyle = o.smile ? '#a01818' : 'rgba(80,30,30,0.7)';
      c.lineWidth = Math.max(1, (o.smile ? 0.02 : 0.012) * s);
      c.beginPath();
      if (o.smile) { c.moveTo(cx - 0.13 * s, cy + 0.03 * s); c.quadraticCurveTo(cx, cy + 0.14 * s, cx + 0.13 * s, cy + 0.03 * s); }
      else { c.moveTo(cx - 0.04 * s, cy + 0.06 * s); c.lineTo(cx + 0.04 * s, cy + 0.06 * s); }
      c.stroke();
    }
    if (ch.headset) {
      c.strokeStyle = '#2a2a2a'; c.lineWidth = Math.max(1.5, 0.03 * s);
      c.beginPath(); c.arc(cx, cy - 0.1 * s, 0.25 * s, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
      c.fillStyle = '#2a2a2a';
      ellipse(c, cx - 0.24 * s, cy - 0.05 * s, 0.04 * s, 0.06 * s);
      ellipse(c, cx + 0.24 * s, cy - 0.05 * s, 0.04 * s, 0.06 * s);
    }
    c.restore();
  }

  // ---------- 괴이 일러스트 ----------
  function drawGhostArt(c, type, cx, cy, s, t) {
    c.save();
    switch (type) {
      case 'roll': {
        const sway = Math.sin(t * 1.3) * 0.02 * s;
        c.fillStyle = '#060607';
        c.beginPath();
        c.moveTo(cx - 0.32 * s, cy + 0.55 * s);
        c.lineTo(cx - 0.15 * s + sway, cy - 0.22 * s);
        c.lineTo(cx + 0.15 * s + sway, cy - 0.22 * s);
        c.lineTo(cx + 0.32 * s, cy + 0.55 * s);
        c.closePath(); c.fill();
        c.strokeStyle = '#060607'; c.lineWidth = 0.035 * s; c.lineCap = 'round';
        c.beginPath();
        c.moveTo(cx - 0.14 * s + sway, cy - 0.18 * s); c.lineTo(cx - 0.3 * s, cy + 0.15 * s); c.lineTo(cx - 0.12 * s, cy + 0.08 * s);
        c.moveTo(cx + 0.14 * s + sway, cy - 0.18 * s); c.lineTo(cx + 0.3 * s, cy + 0.15 * s); c.lineTo(cx + 0.12 * s, cy + 0.08 * s);
        c.stroke();
        c.fillStyle = '#d8d3c6';
        ellipse(c, cx + sway, cy - 0.36 * s, 0.11 * s, 0.16 * s);
        c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 0.008 * s;
        c.beginPath(); c.moveTo(cx + sway, cy - 0.5 * s); c.lineTo(cx + sway, cy - 0.22 * s); c.stroke();
        c.fillStyle = '#204a2b';
        c.fillRect(cx - 0.16 * s, cy, 0.32 * s, 0.2 * s);
        c.fillStyle = '#e8e4d8';
        c.fillRect(cx - 0.14 * s, cy + 0.02 * s, 0.28 * s, 0.16 * s);
        c.strokeStyle = '#555'; c.lineWidth = 0.006 * s;
        for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(cx - 0.12 * s, cy + (0.04 + i * 0.024) * s); c.lineTo(cx + 0.12 * s, cy + (0.04 + i * 0.024) * s); c.stroke(); }
        c.strokeStyle = '#c01818'; c.lineWidth = 0.012 * s;
        c.beginPath(); c.moveTo(cx - 0.12 * s, cy + 0.112 * s); c.lineTo(cx + 0.12 * s, cy + 0.112 * s); c.stroke();
        break;
      }
      case 'eraser': {
        const wob = Math.sin(t * 2) * 0.02 * s;
        c.fillStyle = 'rgba(235,235,225,0.12)';
        for (let i = 0; i < 40; i++) circle(c, cx + Math.sin(i * 7.1 + t) * 0.5 * s, cy + Math.cos(i * 3.3 + t * 0.7) * 0.35 * s, 0.01 * s + (i % 3) * 0.004 * s);
        c.fillStyle = '#e9e6dc';
        rrect(c, cx - 0.42 * s, cy - 0.2 * s + wob, 0.84 * s, 0.4 * s, 0.08 * s); c.fill();
        c.fillStyle = '#3a3a3e';
        rrect(c, cx - 0.42 * s, cy + 0.06 * s + wob, 0.84 * s, 0.14 * s, 0.05 * s); c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 0.006 * s;
        for (let i = -6; i <= 6; i++) { c.beginPath(); c.moveTo(cx + i * 0.06 * s, cy + 0.07 * s + wob); c.lineTo(cx + i * 0.06 * s, cy + 0.19 * s + wob); c.stroke(); }
        c.fillStyle = '#120f10';
        ellipse(c, cx, cy - 0.04 * s + wob, 0.18 * s, 0.035 * s + Math.abs(Math.sin(t * 3)) * 0.02 * s);
        c.fillStyle = 'rgba(255,255,255,0.8)';
        c.font = font(Math.round(0.08 * s), 'bold');
        c.textAlign = 'center';
        c.fillText('쉬이—', cx, cy - 0.28 * s);
        break;
      }
      case 'mirror': {
        c.fillStyle = '#8a8f96';
        c.fillRect(cx - 0.34 * s, cy - 0.5 * s, 0.68 * s, 0.98 * s);
        const g = c.createLinearGradient(cx - 0.3 * s, cy - 0.46 * s, cx + 0.3 * s, cy + 0.44 * s);
        g.addColorStop(0, '#2b3b45'); g.addColorStop(1, '#0d1418');
        c.fillStyle = g;
        c.fillRect(cx - 0.3 * s, cy - 0.46 * s, 0.6 * s, 0.9 * s);
        c.save();
        c.beginPath(); c.rect(cx - 0.3 * s, cy - 0.46 * s, 0.6 * s, 0.9 * s); c.clip();
        drawPortrait(c, '하람', cx, cy + 0.02 * s, 0.75 * s, { mirrored: true, blackEyes: true, smile: true });
        c.restore();
        c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 0.006 * s;
        c.beginPath();
        c.moveTo(cx + 0.1 * s, cy - 0.46 * s); c.lineTo(cx + 0.02 * s, cy - 0.2 * s); c.lineTo(cx + 0.12 * s, cy); c.lineTo(cx + 0.05 * s, cy + 0.2 * s);
        c.moveTo(cx + 0.02 * s, cy - 0.2 * s); c.lineTo(cx - 0.15 * s, cy - 0.1 * s);
        c.stroke();
        break;
      }
      case 'broadcast': {
        c.strokeStyle = '#222'; c.lineWidth = 0.012 * s;
        c.beginPath(); c.moveTo(cx, cy - 0.55 * s); c.lineTo(cx, cy - 0.3 * s); c.stroke();
        c.fillStyle = '#2a2a2c';
        rrect(c, cx - 0.32 * s, cy - 0.3 * s, 0.64 * s, 0.46 * s, 0.04 * s); c.fill();
        c.fillStyle = '#111';
        for (let y = 0; y < 5; y++) for (let x = 0; x < 9; x++) circle(c, cx - 0.24 * s + x * 0.06 * s, cy - 0.22 * s + y * 0.06 * s, 0.014 * s);
        const open = 0.02 + Math.abs(Math.sin(t * 6)) * 0.05;
        c.fillStyle = '#7a0d0d';
        ellipse(c, cx, cy + 0.06 * s, 0.16 * s, open * s);
        c.fillStyle = '#eee';
        for (let i = -3; i <= 3; i++) c.fillRect(cx + i * 0.04 * s - 0.012 * s, cy + 0.06 * s - open * s, 0.024 * s, 0.03 * s);
        c.strokeStyle = 'rgba(160,255,190,0.5)'; c.lineWidth = 0.008 * s;
        for (let i = 1; i <= 3; i++) {
          const r = (0.36 + i * 0.08 + ((t * 0.3) % 0.08)) * s;
          c.beginPath(); c.arc(cx, cy - 0.05 * s, r, -0.5, 0.5); c.stroke();
          c.beginPath(); c.arc(cx, cy - 0.05 * s, r, Math.PI - 0.5, Math.PI + 0.5); c.stroke();
        }
        c.fillStyle = 'rgba(160,255,190,0.85)';
        c.font = font(Math.round(0.06 * s), 'bold');
        c.textAlign = 'center';
        c.fillText('질서 있게 대피하십시오', cx, cy + 0.34 * s);
        break;
      }
      case 'stairs': {
        for (let i = 0; i < 7; i++) {
          const y = cy - 0.2 * s + i * 0.11 * s;
          c.fillStyle = `rgb(${40 - i * 4},${40 - i * 4},${46 - i * 4})`;
          c.fillRect(cx - 0.4 * s, y, 0.8 * s, 0.1 * s);
          c.fillStyle = 'rgba(255,255,255,0.06)';
          c.fillRect(cx - 0.4 * s, y, 0.8 * s, 0.01 * s);
        }
        c.fillStyle = '#d9d2c5';
        const hy = cy - 0.3 * s + Math.sin(t * 1.5) * 0.02 * s;
        ellipse(c, cx, hy, 0.09 * s, 0.07 * s);
        c.strokeStyle = '#d9d2c5'; c.lineCap = 'round'; c.lineWidth = 0.028 * s;
        for (let i = 0; i < 4; i++) {
          const fx = cx - 0.06 * s + i * 0.04 * s;
          c.beginPath(); c.moveTo(fx, hy + 0.04 * s); c.lineTo(fx + (i - 1.5) * 0.02 * s, hy + (0.18 + (i === 1 || i === 2 ? 0.05 : 0)) * s); c.stroke();
        }
        c.beginPath(); c.moveTo(cx + 0.08 * s, hy); c.lineTo(cx + 0.16 * s, hy + 0.08 * s); c.stroke();
        c.fillStyle = 'rgba(255,90,90,0.85)';
        c.font = font(Math.round(0.07 * s), 'bold');
        c.textAlign = 'center';
        c.fillText('13', cx + 0.3 * s, cy - 0.12 * s);
        break;
      }
      case 'proctor': {
        c.fillStyle = '#121214';
        c.beginPath();
        c.moveTo(cx - 0.3 * s, cy + 0.55 * s);
        c.lineTo(cx - 0.22 * s, cy - 0.12 * s);
        c.lineTo(cx + 0.22 * s, cy - 0.12 * s);
        c.lineTo(cx + 0.3 * s, cy + 0.55 * s);
        c.closePath(); c.fill();
        c.fillStyle = '#e9e9e2'; c.fillRect(cx - 0.05 * s, cy - 0.12 * s, 0.1 * s, 0.2 * s);
        c.fillStyle = '#6b1111'; c.fillRect(cx - 0.02 * s, cy - 0.1 * s, 0.04 * s, 0.18 * s);
        c.save();
        c.translate(cx, cy - 0.32 * s); c.rotate(Math.sin(t * 0.8) * 0.04);
        c.fillStyle = '#f2f0e8'; c.fillRect(-0.15 * s, -0.2 * s, 0.3 * s, 0.38 * s);
        c.strokeStyle = '#9aa'; c.lineWidth = 0.005 * s;
        for (let i = 0; i < 10; i++) { c.beginPath(); c.moveTo(-0.12 * s, -0.15 * s + i * 0.032 * s); c.lineTo(0.12 * s, -0.15 * s + i * 0.032 * s); c.stroke(); }
        c.strokeStyle = '#c41616'; c.lineWidth = 0.025 * s;
        c.beginPath(); c.ellipse(0, 0, 0.07 * s, 0.1 * s, 0, 0, Math.PI * 2); c.stroke();
        c.restore();
        break;
      }
      case 'doppel':
        drawPortrait(c, '채이', cx, cy, s * 0.9, { mirrored: true, blackEyes: true, smile: true });
        break;
    }
    c.restore();
  }

  function livingSources() {
    const a = [G.player];
    for (const n of G.npcs) if (!n.fake && !n.faceless && n.ch !== '감독관') a.push(n);
    return a;
  }

  let LIVING = [];
  function twistAt(tx, ty) {
    let best = Infinity;
    for (const s of LIVING) {
      const d = Math.hypot(s.x / TILE - tx - 0.5, s.y / TILE - ty - 0.5);
      if (d < best) best = d;
    }
    return clamp((best - 2.5) / 4, 0, 1);
  }

  function drawScreenFX() {
    const g = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.35, VW / 2, VH / 2, VH * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
    const classDanger = G.bell && G.bell.enabled && G.bell.phase === 'class' && G.scene === 'play' && !playerSafe();
    const red = Math.max(G.danger * 0.6, classDanger ? 0.35 + Math.sin(G.time * 5) * 0.15 : 0);
    if (red > 0.02) {
      const rg = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.3, VW / 2, VH / 2, VH * 0.8);
      rg.addColorStop(0, 'rgba(120,0,0,0)');
      rg.addColorStop(1, `rgba(150,0,0,${red * 0.6})`);
      ctx.fillStyle = rg; ctx.fillRect(0, 0, VW, VH);
    }
    if (G.gaze > 0.3) {
      ctx.fillStyle = `rgba(120,180,255,${(G.gaze - 0.3) * 0.25})`;
      ctx.fillRect(0, 0, VW, VH);
    }
    if (G.flash > 0) { ctx.fillStyle = `rgba(${G.flashColor},${G.flash * 0.7})`; ctx.fillRect(0, 0, VW, VH); }
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let i = 0; i < 160; i++) ctx.fillRect(Math.random() * VW, Math.random() * VH, 1.5, 1.5);
    if (G.def && G.def.flicker && Math.random() < 0.015) {
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(0, Math.random() * VH, VW, rand(2, 30));
    }
  }

  // =========================================================
  //  HUD
  // =========================================================
  function drawHUD() {
    const P = G.player;
    panel(12, 12, 360, 92);
    ctx.textAlign = 'left';
    ctx.font = font(15, 'bold');
    shadowText(G.def.name, 24, 34, '#e8e2d0');
    const room = G.def.rooms.find((r) => P.x >= r.x * TILE && P.x < (r.x + r.w) * TILE && P.y >= r.y * TILE && P.y < (r.y + r.h) * TILE);
    const t = playerTile();
    const where = room ? room.name : t === '.' || t === 'D' ? '복도' : '';
    ctx.font = font(12);
    shadowText(where + (playerSafe() ? '  · 안전 (그것들의 영역 밖)' : where === '복도' ? '  · 위험' : ''), 24, 52, playerSafe() ? '#9fe0a8' : '#d9b48a');
    const b = G.bell;
    if (b.enabled) {
      const cls = b.phase === 'class';
      ctx.font = font(14, 'bold');
      const blink = b.warned && Math.sin(G.time * 10) > 0;
      const label = cls ? `${b.period}교시 수업 중` : `쉬는 시간 → ${b.period + 1}교시`;
      shadowText(`${label}  ${Math.max(0, Math.ceil(b.t))}초`, 200, 34, cls ? '#ff7a7a' : blink ? '#ffdf6b' : '#9fe0a8');
    } else if (G.def.id === 'B1') {
      ctx.font = font(14, 'bold');
      shadowText('44교시', 200, 34, '#ff5a5a', 8);
    }
    ctx.font = font(12);
    ctx.fillStyle = '#e8e2d0';
    textBlock(ctx, '▶ ' + G.def.objective(), 24, 72, 336, 16);

    // 증명사진
    HUD_FACES.forEach((k, i) => {
      const x = VW - 214 + i * 40, y = 16;
      ctx.save();
      ctx.fillStyle = '#ddd'; ctx.fillRect(x, y, 34, 42);
      ctx.beginPath(); ctx.rect(x + 2, y + 2, 30, 38); ctx.clip();
      ctx.fillStyle = '#7d93a8'; ctx.fillRect(x, y, 34, 42);
      drawPortrait(ctx, k, x + 17, y + 22, 40);
      ctx.restore();
      if (G.marks.has(k)) {
        ctx.strokeStyle = '#e01010'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + 32, y + 40); ctx.moveTo(x + 32, y + 2); ctx.lineTo(x + 2, y + 40); ctx.stroke();
      }
    });

    // 자세 / 소음
    panel(12, VH - 58, 220, 46);
    ctx.font = font(12, 'bold');
    const stName = { sneak: '살금살금 [C]', walk: '걷기', run: '달리기 [Shift]' }[P.stance];
    shadowText(stName, 24, VH - 38, P.stance === 'run' ? '#ff8a8a' : P.stance === 'sneak' ? '#9fd3ff' : '#ddd');
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(24, VH - 30, 196, 8);
    ctx.fillStyle = P.noise > 0.6 ? '#ff5a5a' : P.noise > 0.25 ? '#ffd166' : '#7fd1ff';
    ctx.fillRect(24, VH - 30, 196 * P.noise, 8);
    ctx.font = font(10);
    shadowText('소음', 190, VH - 38, '#aaa');

    // 소지품
    const items = [];
    if (G.inventory.has('notebook')) items.push('📓 수첩 [Tab]');
    for (const k of ['key3F', 'key2F', 'keyB1']) if (G.inventory.has(k)) items.push('🔑 ' + { key3F: '3층 열쇠', key2F: '2층 열쇠', keyB1: '지하 열쇠' }[k]);
    if (items.length) {
      ctx.font = font(12);
      const w = Math.max(...items.map((s) => ctx.measureText(s).width)) + 24;
      panel(VW - w - 12, VH - 18 - items.length * 20, w, items.length * 20 + 6);
      items.forEach((s, i) => { ctx.textAlign = 'left'; shadowText(s, VW - w, VH - 22 - (items.length - 1 - i) * 20, '#e8e2d0'); });
    }

    drawMessages();
  }

  function drawMessages() {
    ctx.textAlign = 'center';
    G.toasts.forEach((t, i) => {
      ctx.font = font(13, 'bold');
      const a = Math.min(1, t.t);
      const w = ctx.measureText(t.text).width + 28;
      ctx.globalAlpha = a;
      panel(VW / 2 - w / 2, 112 + i * 30, w, 24, 0.8);
      shadowText(t.text, VW / 2, 129 + i * 30, '#ffe9a8');
      ctx.globalAlpha = 1;
    });
    const baseY = G.dialog ? 410 : VH - 80;
    G.subs.forEach((s, i) => {
      ctx.font = font(16, 'bold');
      ctx.globalAlpha = Math.min(1, s.t * 1.5);
      const y = baseY - (G.subs.length - 1 - i) * 26;
      const w = ctx.measureText(s.text).width + 24;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(VW / 2 - w / 2, y - 18, w, 24);
      shadowText(s.text, VW / 2, y, s.color);
      ctx.globalAlpha = 1;
    });
  }

  // ---------- 대화창 ----------
  function drawDialog() {
    const D = G.dialog;
    const line = D.lines[D.i];
    const full = lineText(line);
    const shown = full.slice(0, Math.floor(D.charT));
    const x = 30, y = VH - 170, w = VW - 60, h = 150;
    panel(x, y, w, h, 0.9);
    let tx = x + 24;
    if (line.who) {
      ctx.save();
      ctx.fillStyle = '#1a1a22'; ctx.fillRect(x + 14, y + 14, 120, 122);
      ctx.beginPath(); ctx.rect(x + 14, y + 14, 120, 122); ctx.clip();
      const jitter = line.fake && Math.random() < 0.2 ? rand(-4, 4) : 0;
      drawPortrait(ctx, line.who, x + 74 + jitter, y + 80, 120, { mirrored: !!line.fake, blackEyes: line.fake && Math.random() < 0.1 });
      ctx.restore();
      tx = x + 150;
      const nm = CHARS[line.who] ? CHARS[line.who].name : line.who;
      ctx.font = font(15, 'bold'); ctx.textAlign = 'left';
      shadowText(line.fake ? reverseStr(nm) : nm, tx, y + 34, line.fake ? '#c9a8ff' : line.who === '감독관' ? '#ff6b6b' : '#ffd27a');
    }
    ctx.font = font(16);
    ctx.textAlign = 'left';
    ctx.fillStyle = line.fake ? '#d9c8ff' : line.who === '' ? '#c8c8d0' : '#f2f2ee';
    const jx = line.fake && Math.random() < 0.1 ? rand(-2, 2) : 0;
    textBlock(ctx, shown, tx + jx, y + (line.who ? 64 : 44), x + w - 24 - tx, 24);
    const doneTyping = shown.length >= full.length;
    if (D.choices && D.i === D.lines.length - 1 && doneTyping) {
      D.rects = [];
      D.choices.forEach((c, k) => {
        ctx.font = font(15, 'bold');
        const cw = ctx.measureText(c.label).width + 60;
        const cx = VW / 2 - cw / 2, cy = y - 50 - (D.choices.length - 1 - k) * 42;
        const r = { x: cx, y: cy, w: cw, h: 34 };
        D.rects.push(r);
        const sel = k === D.sel || inRect(r);
        if (inRect(r)) D.sel = k;
        panel(cx, cy, cw, 34, sel ? 0.95 : 0.8);
        if (sel) { ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 2; rrect(ctx, cx, cy, cw, 34, 8); ctx.stroke(); }
        ctx.textAlign = 'center';
        shadowText(`${k + 1}. ${c.label}`, VW / 2, cy + 23, sel ? '#ffd27a' : '#ddd');
      });
      ctx.font = font(12); ctx.textAlign = 'center';
      shadowText('[1] [2] 숫자키 또는 클릭으로 선택', VW / 2, y - 60 - (D.choices.length - 1) * 42, '#999');
    } else if (doneTyping && Math.sin(G.time * 6) > 0) {
      ctx.font = font(12); ctx.textAlign = 'right';
      shadowText('▼ E', x + w - 16, y + h - 14, '#aaa');
    }
  }

  // ---------- 오버레이 ----------
  function paper(x, y, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = '#e6dfcc'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(120,90,50,0.12)';
    for (let i = 0; i < h; i += 26) ctx.fillRect(x, y + i + 25, w, 1);
    ctx.fillStyle = 'rgba(160,30,30,0.35)'; ctx.fillRect(x + 50, y, 1.5, h);
  }

  function drawOverlay() {
    const o = G.overlay;
    if (o.type === 'note') {
      const x = 170, y = 60, w = 620, h = 470;
      paper(x, y, w, h);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#5a2a1a'; ctx.font = font(18, 'bold');
      ctx.fillText(o.title, x + 64, y + 42);
      ctx.fillStyle = '#2a2420'; ctx.font = font(16);
      textBlock(ctx, o.text, x + 64, y + 84, w - 100, 26);
      ctx.fillStyle = '#7a6a5a'; ctx.font = font(12); ctx.textAlign = 'right';
      ctx.fillText('[E] 닫기', x + w - 20, y + h - 16);
    } else if (o.type === 'rules') {
      const x = 130, y = 18, w = 700, h = 566;
      paper(x, y, w, h);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#5a2a1a'; ctx.font = font(20, 'bold');
      ctx.fillText('생존 수칙 수첩', x + 64, y + 38);
      ctx.fillStyle = '#7a6a5a'; ctx.font = font(12);
      ctx.fillText('— 1학년 6반 반장 백도경이 적기 시작함', x + 220, y + 38);
      let yy = y + 72;
      RULE_ORDER.forEach((id, i) => {
        const r = RULES[id];
        const known = G.rules.has(id);
        ctx.font = font(14, 'bold');
        ctx.fillStyle = known ? '#2a2420' : '#9a8f80';
        const head = `${i + 1}. ${known ? r.title : '???'}`;
        ctx.fillText(head, x + 64, yy);
        if (known) {
          const hw = ctx.measureText(head).width;
          ctx.font = font(11); ctx.fillStyle = r.src === '오리지널' ? '#6a4aa0' : '#a03a2a';
          ctx.fillText(`[${r.src}]`, x + 64 + hw + 10, yy);
          ctx.font = font(12); ctx.fillStyle = '#3a3430';
          yy += textBlock(ctx, r.text, x + 84, yy + 18, w - 130, 17) + 24;
        } else {
          ctx.font = font(12); ctx.fillStyle = '#a89f90';
          ctx.fillText('아직 알아내지 못했다.', x + 84, yy + 18);
          yy += 40;
        }
      });
      ctx.fillStyle = '#7a6a5a'; ctx.font = font(12); ctx.textAlign = 'right';
      ctx.fillText('[Tab] 닫기', x + w - 20, y + h - 14);
    } else if (o.type === 'board') {
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, VW, VH);
      ctx.fillStyle = '#6e5232'; ctx.fillRect(140, 90, 680, 400);
      ctx.fillStyle = '#8a6a44'; ctx.fillRect(150, 100, 660, 380);
      ctx.textAlign = 'center'; ctx.font = font(20, 'bold'); ctx.fillStyle = '#2a1a0a';
      ctx.fillText('1학년 6반 — 증명사진', VW / 2, 136);
      HUD_FACES.forEach((k, i) => {
        const px = 180 + i * 124, py = 170;
        ctx.save();
        ctx.fillStyle = '#eee'; ctx.fillRect(px, py, 100, 130);
        ctx.beginPath(); ctx.rect(px + 5, py + 5, 90, 120); ctx.clip();
        ctx.fillStyle = '#7d93a8'; ctx.fillRect(px, py, 100, 130);
        drawPortrait(ctx, k, px + 50, py + 70, 118);
        ctx.restore();
        ctx.fillStyle = '#d33'; circle(ctx, px + 50, py - 2, 4);
        if (G.marks.has(k)) {
          ctx.strokeStyle = 'rgba(210,10,10,0.9)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(px + 8, py + 10); ctx.lineTo(px + 92, py + 120); ctx.moveTo(px + 92, py + 10); ctx.lineTo(px + 8, py + 120); ctx.stroke();
        }
        ctx.fillStyle = '#1a1a1a'; ctx.font = font(14, 'bold');
        ctx.fillText(CHARS[k].name, px + 50, py + 156);
      });
      ctx.font = font(13); ctx.fillStyle = '#2a1a0a';
      ctx.fillText('아무도 긋지 않았는데, 사라진 사람의 사진에는 붉은 X가 생긴다.', VW / 2, 380);
      ctx.fillText('[E] 닫기', VW / 2, 460);
    } else if (o.type === 'exam') {
      drawExam(o);
    } else if (o.type === 'pause') {
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 0, VW, VH);
      ctx.textAlign = 'center'; ctx.font = font(32, 'bold');
      shadowText('일시정지', VW / 2, 180, '#eee');
      ctx.font = font(15);
      CONTROLS.forEach((l, i) => shadowText(l, VW / 2, 240 + i * 26, '#bbb'));
      ctx.font = font(15, 'bold');
      shadowText('[Esc] 계속하기     [Q] 타이틀로', VW / 2, 470, '#ffd27a');
    }
  }

  function drawExam(o) {
    ctx.fillStyle = 'rgba(10,0,0,0.85)'; ctx.fillRect(0, 0, VW, VH);
    const x = 150, y = 50, w = 660, h = 500;
    ctx.fillStyle = '#efece2'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.strokeRect(x + 10, y + 10, w - 20, h - 20);
    ctx.textAlign = 'center'; ctx.fillStyle = '#111'; ctx.font = font(20, 'bold');
    ctx.fillText('44교시 · 생존수업 기말고사', VW / 2, y + 48);
    ctx.font = font(13); ctx.fillStyle = '#555';
    ctx.fillText(`문항 ${Math.min(o.i + 1, o.qs.length)} / ${o.qs.length}      오답 ${o.wrong} / 2      성명: 윤하람`, VW / 2, y + 74);
    ctx.strokeStyle = '#999'; ctx.beginPath(); ctx.moveTo(x + 30, y + 88); ctx.lineTo(x + w - 30, y + 88); ctx.stroke();
    const q = o.qs[Math.min(o.i, o.qs.length - 1)];
    ctx.textAlign = 'left'; ctx.fillStyle = '#111'; ctx.font = font(17, 'bold');
    textBlock(ctx, `${o.i + 1}. ${q.q}`, x + 40, y + 130, w - 80, 26);
    o.rects = [];
    q.opts.forEach((op, k) => {
      const ry = y + 200 + k * 58;
      const r = { x: x + 40, y: ry - 26, w: w - 80, h: 44 };
      o.rects.push(r);
      if (!o.fb && inRect(r)) o.sel = k;
      const sel = k === o.sel;
      ctx.fillStyle = o.fb && sel ? (o.fbOk ? 'rgba(40,140,60,0.25)' : 'rgba(180,20,20,0.25)') : sel ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#222'; ctx.font = font(16);
      ctx.fillText(`${'①②③④'[k]}  ${op.t}`, x + 56, ry);
    });
    if (o.fb) {
      ctx.textAlign = 'center';
      ctx.font = font(64, 'bold');
      ctx.fillStyle = o.fbOk ? 'rgba(30,120,50,0.85)' : 'rgba(200,10,10,0.9)';
      ctx.fillText(o.fbOk ? '○' : '✕', x + w - 90, y + 150);
    }
    ctx.textAlign = 'center'; ctx.fillStyle = '#777'; ctx.font = font(12);
    ctx.fillText('[1~4] 또는 [↑↓ + Enter] 로 답을 고른다', VW / 2, y + h - 22);
  }

  // =========================================================
  //  씬: 타이틀, 도감, 조작법, 전환, 계단, 사망, 엔딩
  // =========================================================
  const CONTROLS = [
    'WASD — 이동     마우스 / ← → — 둘러보기 (화면 클릭 시 마우스 고정)',
    'Shift — 달리기 (빠르지만 소리가 크다)',
    'C — 살금살금 · 웅크리기 (느리지만 소리가 나지 않는다)',
    'E / Space — 조사 · 대화 · 대사 넘기기     1~4 — 선택지',
    'Tab / R — 생존 수칙 수첩     F — 층별 안내도 켜기/끄기',
    'M — 소리 켜기/끄기     Esc — 일시정지',
  ];

  function drawBlackCircle(cx, cy, r, t) {
    const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.4);
    g.addColorStop(0, '#000'); g.addColorStop(0.6, '#000'); g.addColorStop(0.75, 'rgba(50,0,60,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; circle(ctx, cx, cy, r * 1.4);
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = `rgba(${120 + i * 15},40,${140 + i * 10},${0.25 - i * 0.03})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r * (0.75 + i * 0.09), t * (0.3 + i * 0.12), t * (0.3 + i * 0.12) + 1.6 + i * 0.3);
      ctx.stroke();
    }
  }

  function renderTitle() {
    ctx.fillStyle = '#050407'; ctx.fillRect(0, 0, VW, VH);
    drawBlackCircle(VW / 2, 210, 150, G.time);
    ctx.textAlign = 'center';
    ctx.font = font(96, 'bold');
    const jx = Math.random() < 0.05 ? rand(-4, 4) : 0;
    ctx.fillStyle = 'rgba(200,20,20,0.5)'; ctx.fillText('44교시', VW / 2 + 3 + jx, 233);
    shadowText('44교시', VW / 2 + jx, 230, '#efe8dc');
    ctx.font = font(20);
    shadowText('— 검은 원 생존수업 —', VW / 2, 272, '#b9a9a0');
    const items = ['수업 시작', '인물 · 괴이 도감', '조작법'];
    G.titleRects = [];
    items.forEach((s, i) => {
      const y = 360 + i * 48;
      const r = { x: VW / 2 - 130, y: y - 28, w: 260, h: 40 };
      G.titleRects.push(r);
      if (inRect(r)) G.titleSel = i;
      const sel = G.titleSel === i;
      panel(r.x, r.y, r.w, r.h, sel ? 0.9 : 0.5);
      if (sel) { ctx.strokeStyle = '#c03030'; ctx.lineWidth = 2; rrect(ctx, r.x, r.y, r.w, r.h, 8); ctx.stroke(); }
      ctx.font = font(18, sel ? 'bold' : '');
      shadowText(s, VW / 2, y, sel ? '#ffd6d6' : '#aaa');
    });
    ctx.font = font(11);
    shadowText('네이버웹툰 「44교시 생존수업」(상C)의 검은 원 규칙에서 영감을 받은 비공식 팬메이드 게임입니다. 등장인물과 괴이는 모두 오리지널 창작입니다.', VW / 2, VH - 34, '#777');
    shadowText('헤드폰 권장 · 소리가 안 나면 아무 키나 한 번 누르세요', VW / 2, VH - 16, '#555');
    drawScreenFXLite();
  }

  function drawScreenFXLite() {
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i < 120; i++) ctx.fillRect(Math.random() * VW, Math.random() * VH, 1.5, 1.5);
  }

  function renderCodex() {
    ctx.fillStyle = '#08070a'; ctx.fillRect(0, 0, VW, VH);
    const tabs = ['인물', '괴이'];
    tabs.forEach((t, i) => {
      const sel = G.codexTab === i;
      ctx.textAlign = 'center'; ctx.font = font(20, sel ? 'bold' : '');
      shadowText(t, VW / 2 + (i === 0 ? -80 : 80), 50, sel ? '#ffd27a' : '#666');
      if (sel) { ctx.fillStyle = '#ffd27a'; ctx.fillRect(VW / 2 + (i === 0 ? -110 : 50), 60, 60, 2); }
    });
    const list = G.codexTab === 0 ? CODEX_PEOPLE : CODEX_GHOSTS;
    const e = list[G.codexIdx];
    panel(60, 90, 300, 420, 0.8);
    ctx.save();
    ctx.beginPath(); ctx.rect(70, 100, 280, 400); ctx.clip();
    if (G.codexTab === 0) {
      ctx.fillStyle = '#7d93a8'; ctx.fillRect(70, 100, 280, 400);
      drawPortrait(ctx, e.key, 210, 320, 380, { mirrored: false });
    } else {
      ctx.fillStyle = '#120a0c'; ctx.fillRect(70, 100, 280, 400);
      drawGhostArt(ctx, e.key, 210, 300, 330, G.time);
    }
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.font = font(30, 'bold');
    shadowText(e.name, 390, 140, '#efe8dc');
    ctx.font = font(14);
    shadowText(G.codexTab === 0 ? e.role : '정체 — ' + e.origin, 390, 170, G.codexTab === 0 ? '#ffd27a' : '#ff8a8a');
    ctx.font = font(15); ctx.fillStyle = '#ccc';
    const hgt = textBlock(ctx, e.desc, 390, 210, 520, 25);
    if (e.tip) {
      ctx.font = font(14, 'bold');
      ctx.fillStyle = '#9fe0a8';
      textBlock(ctx, '대처법 — ' + e.tip, 390, 230 + hgt, 520, 22);
    }
    ctx.textAlign = 'center'; ctx.font = font(13);
    shadowText(`◀  ${G.codexIdx + 1} / ${list.length}  ▶`, 635, 500, '#888');
    shadowText('[← →] 넘기기   [Tab] 인물/괴이 전환   [Esc] 돌아가기', VW / 2, VH - 30, '#666');
  }

  function renderControls() {
    ctx.fillStyle = '#08070a'; ctx.fillRect(0, 0, VW, VH);
    ctx.textAlign = 'center'; ctx.font = font(28, 'bold');
    shadowText('조작법 & 생존 요령', VW / 2, 80, '#efe8dc');
    ctx.font = font(16);
    CONTROLS.forEach((l, i) => shadowText(l, VW / 2, 140 + i * 30, '#ccc'));
    ctx.font = font(15, 'bold');
    const tips = [
      '• 수업 종이 울리면 교실 안에 있어라. 째깍 소리는 종이 곧 울린다는 신호다.',
      '• 내 발소리는 바닥에 하얀 고리로 퍼진다. 고리가 클수록 멀리 들린다.',
      '• 사람이 없는 곳은 뒤틀린다. 벽의 눈과 핏자국은 곧 「아무도 없다」는 뜻이다.',
      '• 쪽지를 모두 읽어라. 수첩의 수칙은 마지막 시험에 나온다.',
    ];
    tips.forEach((l, i) => shadowText(l, VW / 2, 380 + i * 28, '#ffd27a'));
    ctx.font = font(13);
    shadowText('[Esc] 돌아가기', VW / 2, VH - 30, '#666');
  }

  function renderTransition() {
    const t = G.trans.t;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, VH);
    const a = t < 0.6 ? t / 0.6 : t > 2.0 ? Math.max(0, (2.6 - t) / 0.6) : 1;
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = font(48, 'bold');
    shadowText(G.trans.title, VW / 2, VH / 2 - 10, '#efe8dc');
    ctx.font = font(18);
    shadowText(G.trans.sub, VW / 2, VH / 2 + 30, '#998');
    ctx.globalAlpha = 1;
    drawScreenFXLite();
  }

  function renderDead() {
    const t = G.deadT;
    const D = DEATHS[G.deathCause];
    if (t < 0.75) {
      ctx.fillStyle = Math.random() < 0.5 ? '#1a0000' : '#000';
      ctx.fillRect(0, 0, VW, VH);
      const s = 380 + t * 500;
      drawGhostArt(ctx, D.ghost, VW / 2 + rand(-10, 10), VH / 2 + 40 + rand(-10, 10), s, G.time * 6);
      ctx.fillStyle = `rgba(255,0,0,${0.15 + Math.random() * 0.15})`;
      ctx.fillRect(0, 0, VW, VH);
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.15})`;
        ctx.fillRect(0, Math.random() * VH, VW, rand(2, 20));
      }
      return;
    }
    ctx.fillStyle = '#060000'; ctx.fillRect(0, 0, VW, VH);
    const a = Math.min(1, (t - 0.75) / 0.8);
    ctx.globalAlpha = a;
    ctx.save();
    ctx.fillStyle = '#ddd'; ctx.fillRect(VW / 2 - 50, 70, 100, 130);
    ctx.beginPath(); ctx.rect(VW / 2 - 45, 75, 90, 120); ctx.clip();
    ctx.fillStyle = '#7d93a8'; ctx.fillRect(VW / 2 - 50, 70, 100, 130);
    drawPortrait(ctx, '하람', VW / 2, 140, 118);
    ctx.restore();
    const xa = clamp((t - 1.0) / 0.5, 0, 1);
    ctx.strokeStyle = 'rgba(220,10,10,0.95)'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(VW / 2 - 42, 80); ctx.lineTo(VW / 2 - 42 + 84 * xa, 80 + 110 * xa);
    if (xa >= 1) { ctx.moveTo(VW / 2 + 42, 80); ctx.lineTo(VW / 2 - 42, 190); }
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = font(44, 'bold');
    shadowText(D.title, VW / 2, 270, '#ff4040', 12);
    ctx.font = font(17);
    ctx.fillStyle = '#ddd';
    const lines = wrap(ctx, D.text, 640);
    lines.forEach((l, i) => shadowText(l, VW / 2, 320 + i * 28, '#ddd'));
    if (D.rule) {
      ctx.font = font(14, 'bold');
      const rl = wrap(ctx, `어긴 수칙 — 「${RULES[D.rule].title}」 ${RULES[D.rule].text}`, 700);
      rl.forEach((l, i) => shadowText(l, VW / 2, 340 + lines.length * 28 + i * 22, '#ffd27a'));
    }
    ctx.font = font(14);
    if (t > 1.5) shadowText(G.deathCause === 'stairs' ? '[R] 계단 처음부터 다시     [Esc] 타이틀로' : '[R] 이 층 처음부터 다시     [Esc] 타이틀로', VW / 2, VH - 60, '#aaa');
    shadowText(`사망 ${G.persistent.deaths}회`, VW / 2, VH - 30, '#644');
    ctx.globalAlpha = 1;
    drawScreenFXLite();
  }

  function renderEnding() {
    const E = G.end;
    const t = E.t;
    const bright = clamp(t / 6, 0, 1);
    ctx.fillStyle = `rgb(${Math.round(bright * 18)},${Math.round(bright * 22)},${Math.round(bright * 34)})`;
    ctx.fillRect(0, 0, VW, VH);
    const perfect = E.wrong === 0;
    const lines = [
      '검은 원의 맨 아래는, 바닥이 아니었다.',
      '떨어지는 감각이 끝나자 하람은 운동장 한가운데 누워 있었다. 하늘이 파랬다.',
      '구급차 사이렌. 누군가 시계를 보며 외쳤다. 「아직 몇 분밖에 안 지났어요!」',
      '검은 원 안의 하루는, 바깥의 몇 분에 불과했다.',
      perfect
        ? '잠시 후 원 아래에서 도경이, 채이가, 그리고 6반 아이들이 하나둘 떨어져 내렸다. 수첩의 수칙을 그대로 따라온 아이들이었다.'
        : '잠시 후 도경이 떨어져 내렸다. 뒤따라오기로 한 아이들 몇 명은… 끝내 오지 않았다. 수첩 한 페이지가 비어 있었다.',
      '하지만 검은 원은 사라지지 않았다. 깨진 휴대폰 화면 위로, 알림 하나가 떠올랐다.',
      '【 45교시 시간표가 등록되었습니다 】',
    ];
    ctx.textAlign = 'center';
    ctx.font = font(26, 'bold');
    shadowText(perfect ? '엔딩 — 하교 (만점)' : '엔딩 — 하교', VW / 2, 70, perfect ? '#ffe9a8' : '#ddd');
    let ly = 130;
    lines.forEach((l, i) => {
      const lastLine = i === lines.length - 1;
      ctx.font = font(lastLine ? 18 : 16, lastLine ? 'bold' : '');
      const wl = wrap(ctx, l, 760);
      const a = clamp((t - 1 - i * 1.6) / 1.2, 0, 1);
      if (a > 0) {
        ctx.globalAlpha = a;
        wl.forEach((s, j) => shadowText(s, VW / 2, ly + j * 24, lastLine ? '#ff6b6b' : '#ddd'));
        ctx.globalAlpha = 1;
      }
      ly += wl.length * 24 + 22;
    });
    const sa = clamp((t - 13) / 1.5, 0, 1);
    if (sa > 0) {
      ctx.globalAlpha = sa;
      ctx.font = font(14);
      const m = Math.floor(E.secs / 60), s = Math.floor(E.secs % 60);
      shadowText(`사망 ${E.deaths}회  ·  플레이 ${m}분 ${s}초  ·  ${E.period}교시까지 버팀  ·  시험 오답 ${E.wrong}개`, VW / 2, VH - 70, '#9fe0a8');
      ctx.font = font(13);
      shadowText('— THE END —     [Enter] 타이틀로', VW / 2, VH - 36, '#888');
      ctx.globalAlpha = 1;
    }
  }

  // =========================================================
  //  3D 화면 + 2D 오버레이
  // =========================================================
  function renderPlay() {
    LIVING = livingSources();
    W3D.sync(G.dt || 1 / 60);
    W3D.render();
    ctx.clearRect(0, 0, VW, VH);
    drawWorldLabels();
    drawScreenFX();
    drawCrosshair();
    drawHUD();
    if (G.showMap) drawMinimap();
    if (G.dialog) drawDialog();
    if (G.overlay) drawOverlay();
    if (!locked() && !G.dialog && !G.overlay) {
      ctx.textAlign = 'center'; ctx.font = font(14, 'bold');
      shadowText('화면을 클릭하면 마우스로 둘러볼 수 있다  (← → 키로도 회전)', VW / 2, VH / 2 + 60, 'rgba(255,233,168,0.85)');
    }
  }

  function bubbleHeight(e) {
    if (e.type === 'roll') return 2.95;
    if (e.type === 'eraser') return 1.85;
    if (e.ch === '감독관') return 2.7;
    return e.seated ? 1.5 : 2.0;
  }

  function drawWorldLabels() {
    const P = G.player;
    ctx.textAlign = 'center';
    for (const e of [...G.npcs, ...G.monsters]) {
      if (!(e.bubbleT > 0) || !e.bubble) continue;
      if (e.alpha !== undefined && e.alpha < 0.3) continue;
      const d = dist(P, e);
      if (d > 16 * TILE || !los(P.x, P.y, e.x, e.y)) continue;
      const p = W3D.project(e.x, e.y, bubbleHeight(e));
      if (!p) continue;
      const fs = clamp(Math.round(22 - d / TILE), 12, 20);
      ctx.font = font(fs, 'bold');
      const w = ctx.measureText(e.bubble).width + 18;
      ctx.globalAlpha = Math.min(1, e.bubbleT * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      rrect(ctx, p.x - w / 2, p.y - fs - 7, w, fs + 12, 6); ctx.fill();
      const col = e.type === 'roll' ? '#ff6b6b' : e.fake || e.type === 'doppel' ? '#c9a8ff' : e.type === 'eraser' ? '#e8e8e8' : '#f2f2ee';
      shadowText(e.bubble, p.x, p.y, col);
      ctx.globalAlpha = 1;
    }
  }

  function focusLabel(f) {
    if (f.label) return f.label;
    if (f.faceless) return '살펴보기';
    const ch = CHARS[f.ch];
    const nm = ch ? ch.name : '';
    if (f.fake) return reverseStr(nm) + '에게 말 걸기';
    return (nm ? nm + '에게 ' : '') + '말 걸기';
  }

  function drawCrosshair() {
    const f = G.focus;
    ctx.fillStyle = f ? 'rgba(255,230,160,0.95)' : 'rgba(255,255,255,0.35)';
    circle(ctx, VW / 2, VH / 2, f ? 3.2 : 2);
    if (f && !G.dialog && !G.overlay) {
      ctx.font = font(15, 'bold'); ctx.textAlign = 'center';
      const s = `[E] ${focusLabel(f)}`;
      const w = ctx.measureText(s).width + 24;
      panel(VW / 2 - w / 2, VH / 2 + 78, w, 28, 0.7);
      shadowText(s, VW / 2, VH / 2 + 98, '#ffe9a8');
    }
  }

  const MAP_COL = { '.': '#56625c', D: '#8a7550', ',': '#463a2e', d: '#5a4a38', b: '#5a4a38', r: '#40505a', w: '#3a3a44', S: '#9fd3ff', U: '#803030', L: '#c04030', G: '#2a8a6a' };
  function drawMinimap() {
    const s = 4, mw = G.W * s, mh = G.H * s;
    const x0 = VW - mw - 14, y0 = 82;
    panel(x0 - 6, y0 - 20, mw + 12, mh + 26, 0.62);
    ctx.font = font(10, 'bold'); ctx.textAlign = 'left';
    shadowText('층별 안내도 [F]', x0, y0 - 7, '#aaa');
    for (let y = 0; y < G.H; y++) for (let x = 0; x < G.W; x++) {
      const c = MAP_COL[G.grid[y][x]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x0 + x * s, y0 + y * s, s, s);
    }
    const px = x0 + (G.player.x / TILE) * s, py = y0 + (G.player.y / TILE) * s, f = G.player.face;
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(f) * 7, py + Math.sin(f) * 7);
    ctx.lineTo(px + Math.cos(f + 2.5) * 4.5, py + Math.sin(f + 2.5) * 4.5);
    ctx.lineTo(px + Math.cos(f - 2.5) * 4.5, py + Math.sin(f - 2.5) * 4.5);
    ctx.closePath(); ctx.fill();
  }

  function renderStairs() {
    const S = G.st;
    W3D.renderStairs(S, S.yaw, S.pitch);
    ctx.clearRect(0, 0, VW, VH);
    const g = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.25, VW / 2, VH / 2, VH * 0.8);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
    const look = clamp((Math.abs(S.yaw) - 0.5) / (LOOK_BACK - 0.5), 0, 1);
    if (look > 0) {
      const rg = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.1, VW / 2, VH / 2, VH * 0.75);
      rg.addColorStop(0, `rgba(120,0,0,${look * 0.15})`); rg.addColorStop(1, `rgba(170,0,0,${look * 0.7})`);
      ctx.fillStyle = rg; ctx.fillRect(0, 0, VW, VH);
    }
    ctx.textAlign = 'center'; ctx.font = font(16, 'bold');
    const label = S.step >= 13 ? `${S.step} / 12 …?` : `${S.step} / 12`;
    shadowText(`계단  ${label}`, VW / 2, 40, S.step >= 13 ? '#ff6b6b' : '#ccc');
    ctx.font = font(13);
    shadowText('[W / ↑] 꾹 눌러 내려가기        ※ 절대 뒤돌아보지 말 것', VW / 2, VH - 24, '#888');
    drawMessages();
    drawScreenFXLite();
    if (S.done) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, S.doneT / 2)})`; ctx.fillRect(0, 0, VW, VH); }
  }

  function render() {
    switch (G.scene) {
      case 'title': renderTitle(); break;
      case 'codex': renderCodex(); break;
      case 'controls': renderControls(); break;
      case 'transition': renderTransition(); break;
      case 'play': renderPlay(); break;
      case 'stairs': renderStairs(); break;
      case 'dead': renderDead(); break;
      case 'ending': renderEnding(); break;
    }
  }

  // =========================================================
  //  루프
  // =========================================================
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    G.time += dt;
    G.dt = dt;
    try {
      update(dt);
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      render();
    } catch (err) {
      console.error(String((err && err.stack) || err));
    }
    pressed.clear();
    mouse.click = false;
    mouse.dx = mouse.dy = 0;
    requestAnimationFrame(frame);
  }
  W3D.init(glCanvas, G, { tileAt, twistAt, drawPortrait });
  addEventListener('resize', fit);
  fit();
  requestAnimationFrame(frame);
})();
