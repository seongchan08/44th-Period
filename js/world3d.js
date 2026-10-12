'use strict';

// =========================================================
//  학교 소품 배치 (게임 로직의 충돌 판정과 3D 렌더러가 함께 쓴다)
//  [x, y, 종류, 정면 방향(rad), 벽에 붙임]
// =========================================================
const PI = Math.PI;
const DECOR = {
  '3F': [
    [1, 2, 'cabinet', 0, true], [1, 3, 'cabinet', 0, true], [1, 5, 'shelf', 0, true],
    [10, 2, 'copier', PI, true], [10, 6, 'water', PI, true],
    [6, 9, 'ext', PI / 2, true], [30, 11, 'ext', -PI / 2, true], [44, 9, 'ext', PI / 2, true],
  ],
  '2F': [
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => [x, 1, 'shelf', PI / 2, true]),
    ...[3, 4, 5, 6].map((y) => [1, y, 'shelf', 0, true]),
    [32, 2, 'piano', PI, true],
    [1, 13, 'toilet', 0, true], [1, 15, 'toilet', 0, true], [1, 17, 'toilet', 0, true],
    [7, 14, 'urinal', PI, true], [7, 15, 'urinal', PI, true], [7, 16, 'urinal', PI, true],
    [20, 18, 'skeleton', PI, false], [20, 14, 'shelf', PI, true],
    [22, 9, 'ext', PI / 2, true], [40, 11, 'ext', -PI / 2, true],
  ],
  '1F': [
    [10, 1, 'trophy', PI, true], [1, 3, 'shelf', 0, true], [1, 1, 'flag', 0, false],
    [12, 1, 'rack', PI / 2, true], [13, 1, 'rack', PI / 2, true],
    [32, 2, 'cabinet', PI, true], [32, 3, 'cabinet', PI, true],
    [43, 5, 'medcab', PI, true],
    ...[14, 15, 16, 17, 18].map((y) => [20, y, 'counter', PI, true]),
    ...[14, 15, 16, 17, 18].map((y) => [22, y, 'shoes', 0, true]),
    ...[14, 15, 16, 17, 18].map((y) => [33, y, 'shoes', PI, true]),
    [34, 9, 'ext', PI / 2, true],
  ],
  'B1': [],
};
const PROP_SOLID = new Set(['cabinet', 'shelf', 'copier', 'water', 'piano', 'toilet', 'skeleton', 'trophy', 'rack', 'medcab', 'counter', 'shoes', 'podium']);

function roomKind(r) {
  if (r.kind) return r.kind;
  if (/교무실|행정실/.test(r.name)) return 'office';
  if (/도서실/.test(r.name)) return 'library';
  if (/미술실/.test(r.name)) return 'art';
  if (/음악실/.test(r.name)) return 'music';
  if (/과학실/.test(r.name)) return 'lab';
  if (/급식실/.test(r.name)) return 'cafe';
  if (/방송실/.test(r.name)) return 'bcast';
  if (/교장실/.test(r.name)) return 'principal';
  if (/보건실/.test(r.name)) return 'nurse';
  if (/시험장/.test(r.name)) return 'exam';
  return 'class';
}

function decorFor(def) {
  const out = (DECOR[def.id] || []).slice();
  for (const r of def.rooms) {
    if (r.desks && roomKind(r) === 'class') out.push([r.x + r.w - 1, r.y + 3, 'podium', PI, false]);
  }
  return out;
}

// =========================================================
//  3D 렌더러
//  게임 로직은 2D 평면 좌표(px, 1칸 = 32px)로 돌아가고, 여기서 1칸 = 1.2m 로 옮겨 그린다.
//  평면 (x, y) → 월드 (X, Z), 높이는 Y.
// =========================================================
const W3D = (() => {
  const TILE = 32, T = 1.2, S = T / TILE, WALL_H = 3.0, FLASH = 1.45;
  const VW = 960, VH = 600;
  const FONT = '"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
  const font = (size, weight = '') => `${weight} ${size}px ${FONT}`;
  let renderer, scene, camera, flash, ambient, G, H;
  let lv = null, st = null;
  let time = 0;
  const tracked = new Map();
  const geoCache = {};
  const texCache = {};

  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------------------------------------------------------
  //  캔버스 텍스처
  // ---------------------------------------------------------
  function canvasTex(w, h, draw, key) {
    if (key && texCache[key]) return texCache[key];
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    draw(x, w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    if (key) texCache[key] = t;
    return t;
  }
  function speckle(x, w, h, n, col, amax, smax = 2) {
    for (let i = 0; i < n; i++) {
      x.fillStyle = `rgba(${col},${Math.random() * amax})`;
      const s = 0.5 + Math.random() * smax;
      x.fillRect(Math.random() * w, Math.random() * h, s, s);
    }
  }
  function streaks(x, w, h, n, col, a) {
    for (let i = 0; i < n; i++) {
      const sx = Math.random() * w, sy = Math.random() * h * 0.6;
      const g = x.createLinearGradient(0, sy, 0, sy + 40 + Math.random() * 120);
      g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
      x.fillStyle = g;
      x.fillRect(sx, sy, 1 + Math.random() * 3, 160);
    }
  }
  const PXM = 320 / WALL_H;
  const ym = (m) => 320 - m * PXM;

  function wallBase(x, w, h, upper, lower, lowerTop = 1.05) {
    x.fillStyle = upper; x.fillRect(0, 0, w, h);
    speckle(x, w, h, 500, '0,0,0', 0.08);
    streaks(x, w, h, 6, '40,30,20', 0.12);
    x.fillStyle = lower; x.fillRect(0, ym(lowerTop), w, h);
    speckle(x, w, ym(0) - ym(lowerTop), 300, '0,0,0', 0.1);
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, ym(lowerTop) - 5, w, 5);
    x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(0, ym(lowerTop) - 7, w, 2);
    x.fillStyle = '#222'; x.fillRect(0, ym(0.1), w, h);
  }

  const TEX = {
    hall: () => canvasTex(128, 320, (x, w, h) => wallBase(x, w, h, '#cdc5ab', '#4f7f70'), 'hall'),
    class: () => canvasTex(128, 320, (x, w, h) => {
      wallBase(x, w, h, '#d6cfb9', '#6e5034');
      x.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < w; i += 21) x.fillRect(i, ym(1.05), 1, ym(0.1) - ym(1.05));
    }, 'class'),
    win: (hand) => canvasTex(128, 320, (x, w, h) => {
      wallBase(x, w, h, '#d6cfb9', '#6e5034');
      const y0 = ym(2.6), y1 = ym(0.95);
      x.fillStyle = '#8f969a'; x.fillRect(4, y0 - 4, w - 8, y1 - y0 + 8);
      const g = x.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, '#05060a'); g.addColorStop(1, '#000');
      x.fillStyle = g; x.fillRect(9, y0 + 2, w - 18, y1 - y0 - 4);
      x.fillStyle = '#8f969a'; x.fillRect(w / 2 - 2, y0, 4, y1 - y0); x.fillRect(4, y0 + (y1 - y0) * 0.3, w - 8, 3);
      x.strokeStyle = 'rgba(160,180,200,0.08)'; x.lineWidth = 6;
      x.beginPath(); x.moveTo(20, y1 - 20); x.lineTo(60, y0 + 30); x.stroke();
      if (hand) {
        x.fillStyle = 'rgba(210,205,195,0.28)';
        const hx = 40 + Math.random() * 40, hy = y0 + 60 + Math.random() * 40;
        x.beginPath(); x.ellipse(hx, hy, 11, 14, 0, 0, PI * 2); x.fill();
        for (let i = 0; i < 4; i++) { x.beginPath(); x.ellipse(hx - 10 + i * 7, hy - 22, 3, 9, (i - 1.5) * 0.15, 0, PI * 2); x.fill(); }
        x.beginPath(); x.ellipse(hx + 14, hy - 4, 3, 8, 0.8, 0, PI * 2); x.fill();
      }
    }, hand ? 'winHand' : 'win'),
    winHall: () => canvasTex(128, 320, (x, w, h) => {
      wallBase(x, w, h, '#cdc5ab', '#4f7f70');
      const y0 = ym(2.5), y1 = ym(1.0);
      x.fillStyle = '#8f969a'; x.fillRect(10, y0 - 4, w - 20, y1 - y0 + 8);
      x.fillStyle = '#020204'; x.fillRect(15, y0 + 1, w - 30, y1 - y0 - 2);
      x.fillStyle = '#8f969a'; x.fillRect(w / 2 - 2, y0, 4, y1 - y0);
    }, 'winHall'),
    locker: () => canvasTex(128, 320, (x, w, h) => {
      wallBase(x, w, h, '#cdc5ab', '#4f7f70');
      const top = ym(1.9);
      x.fillStyle = '#6d7a86'; x.fillRect(2, top, w - 4, ym(0.1) - top);
      for (let c = 0; c < 2; c++) for (let r = 0; r < 3; r++) {
        const lx = 4 + c * 62, ly = top + 3 + r * ((ym(0.1) - top - 6) / 3);
        const lh = (ym(0.1) - top - 6) / 3 - 3;
        x.fillStyle = r === 1 && c === 0 && Math.random() < 0.5 ? '#56626d' : '#7c8995';
        x.fillRect(lx, ly, 58, lh);
        x.fillStyle = 'rgba(0,0,0,0.35)';
        for (let v = 0; v < 4; v++) x.fillRect(lx + 10, ly + 6 + v * 5, 22, 2);
        x.fillStyle = '#c9cdd1'; x.fillRect(lx + 48, ly + lh / 2 - 6, 4, 12);
        x.fillStyle = '#eee'; x.fillRect(lx + 8, ly + lh - 14, 18, 7);
      }
      speckle(x, w, h, 200, '0,0,0', 0.15);
    }, 'locker'),
    rest: () => canvasTex(128, 320, (x, w, h) => {
      x.fillStyle = '#e4e6e2'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#9fb7c2'; x.fillRect(0, ym(1.6), w, h);
      x.strokeStyle = 'rgba(60,70,75,0.35)'; x.lineWidth = 1;
      for (let i = 0; i <= w; i += 16) { x.beginPath(); x.moveTo(i + 0.5, 0); x.lineTo(i + 0.5, h); x.stroke(); }
      for (let j = 0; j <= h; j += 16) { x.beginPath(); x.moveTo(0, j + 0.5); x.lineTo(w, j + 0.5); x.stroke(); }
      speckle(x, w, h, 300, '30,30,20', 0.12);
      streaks(x, w, h, 5, '90,70,40', 0.12);
    }, 'rest'),
    conc: () => canvasTex(128, 320, (x, w, h) => {
      x.fillStyle = '#7a7a74'; x.fillRect(0, 0, w, h);
      speckle(x, w, h, 1500, '0,0,0', 0.18);
      streaks(x, w, h, 10, '20,20,20', 0.25);
      x.fillStyle = '#3d5c4a'; x.fillRect(0, ym(1.0), w, 6);
      x.fillStyle = '#333'; x.fillRect(0, ym(0.1), w, h);
    }, 'conc'),
    b1: () => canvasTex(128, 320, (x, w, h) => {
      x.fillStyle = '#3a3030'; x.fillRect(0, 0, w, h);
      speckle(x, w, h, 1500, '0,0,0', 0.25);
      streaks(x, w, h, 14, '70,0,0', 0.3);
      x.strokeStyle = 'rgba(150,140,130,0.25)'; x.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const sx = 20 + Math.random() * 90, sy = 80 + Math.random() * 120;
        for (let k = 0; k < 4; k++) { x.beginPath(); x.moveTo(sx + k * 4, sy); x.lineTo(sx + k * 4 + 6, sy + 30); x.stroke(); }
      }
    }, 'b1'),
    fHall: () => canvasTex(128, 128, (x, w, h) => {
      x.fillStyle = '#8d9289'; x.fillRect(0, 0, w, h);
      speckle(x, w, h, 900, '255,255,255', 0.12, 1.5);
      speckle(x, w, h, 900, '0,0,0', 0.15, 1.5);
      x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, 0, w, 1); x.fillRect(0, 0, 1, h); x.fillRect(0, 64, w, 1); x.fillRect(64, 0, 1, h);
    }, 'fHall'),
    fClass: () => canvasTex(128, 128, (x, w, h) => {
      for (let i = 0; i < 8; i++) {
        const v = 100 + Math.random() * 25;
        x.fillStyle = `rgb(${v + 22},${v - 8},${v - 45})`;
        x.fillRect(0, i * 16, w, 16);
        x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, i * 16, w, 1);
        x.fillRect(((i * 53) % 128), i * 16, 1, 16);
      }
      speckle(x, w, h, 400, '0,0,0', 0.12);
    }, 'fClass'),
    fRest: () => canvasTex(128, 128, (x, w, h) => {
      x.fillStyle = '#8e9a9e'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        x.fillStyle = (i + j) % 2 ? '#98a4a8' : '#869296';
        x.fillRect(i * 16 + 1, j * 16 + 1, 15, 15);
      }
      speckle(x, w, h, 300, '40,30,10', 0.2);
    }, 'fRest'),
    fConc: () => canvasTex(128, 128, (x, w, h) => {
      x.fillStyle = '#5a5a56'; x.fillRect(0, 0, w, h);
      speckle(x, w, h, 1500, '0,0,0', 0.2);
      speckle(x, w, h, 300, '255,255,255', 0.05);
    }, 'fConc'),
    fB1: () => canvasTex(128, 128, (x, w, h) => {
      x.fillStyle = '#2c2424'; x.fillRect(0, 0, w, h);
      speckle(x, w, h, 1500, '0,0,0', 0.3);
      speckle(x, w, h, 100, '90,0,0', 0.3, 4);
    }, 'fB1'),
    ceil: () => canvasTex(128, 128, (x, w, h) => {
      x.fillStyle = '#a9a69c'; x.fillRect(0, 0, w, h);
      speckle(x, w, h, 700, '0,0,0', 0.2, 1.2);
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 0, w, 2); x.fillRect(0, 0, 2, h); x.fillRect(0, 63, w, 2); x.fillRect(63, 0, 2, h);
      if (Math.random() < 1) { x.fillStyle = 'rgba(90,70,30,0.18)'; x.beginPath(); x.ellipse(90, 30, 20, 14, 0.4, 0, PI * 2); x.fill(); }
    }, 'ceil'),
    door: () => canvasTex(128, 256, (x, w, h) => {
      x.fillStyle = '#7a5532'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 12; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`; x.fillRect(0, Math.random() * h, w, 2); }
      x.fillStyle = '#4a3218'; x.fillRect(0, 0, w, 6); x.fillRect(0, 0, 6, h); x.fillRect(w - 6, 0, 6, h); x.fillRect(0, h - 6, w, 6);
      x.fillStyle = '#0a0a0c'; x.fillRect(22, 24, w - 44, 70);
      x.fillStyle = '#8f969a'; x.fillRect(22, 56, w - 44, 3);
      x.fillStyle = '#c8a640'; x.fillRect(w - 26, 130, 10, 22);
      x.fillStyle = '#000'; x.fillRect(w - 23, 140, 4, 8);
      x.fillStyle = 'rgba(200,30,30,0.85)'; x.font = font(16, 'bold'); x.textAlign = 'center';
      x.fillText('잠김', w / 2, 190);
    }, 'door'),
    blood: () => canvasTex(128, 128, (x, w, h) => {
      for (let i = 0; i < 9; i++) {
        const r = 6 + Math.random() * 22, cx = 64 + (Math.random() - 0.5) * 60, cy = 64 + (Math.random() - 0.5) * 60;
        const g = x.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
        g.addColorStop(0, 'rgba(70,0,0,0.95)'); g.addColorStop(0.7, 'rgba(60,0,0,0.8)'); g.addColorStop(1, 'rgba(40,0,0,0)');
        x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, PI * 2); x.fill();
      }
      x.fillStyle = 'rgba(80,0,0,0.8)';
      for (let i = 0; i < 5; i++) { x.beginPath(); x.arc(20 + i * 22, 110, 3, 0, PI * 2); x.fill(); }
    }, 'blood'),
    bloodText: () => canvasTex(256, 128, (x, w, h) => {
      x.font = font(54, 'bold'); x.textAlign = 'center';
      x.fillStyle = 'rgba(110,0,0,0.9)';
      x.fillText('출석', w / 2, 70);
      for (let i = 0; i < 10; i++) { const dx = 60 + Math.random() * 140; x.fillRect(dx, 60, 3, 20 + Math.random() * 50); }
    }, 'bloodText'),
    eye: () => canvasTex(128, 64, (x, w, h) => {
      const g = x.createRadialGradient(64, 32, 4, 64, 32, 50);
      g.addColorStop(0, '#f2ebdc'); g.addColorStop(0.75, '#d8c9b0'); g.addColorStop(1, 'rgba(80,20,20,0)');
      x.fillStyle = g; x.beginPath(); x.ellipse(64, 32, 58, 26, 0, 0, PI * 2); x.fill();
      x.strokeStyle = 'rgba(170,20,20,0.6)'; x.lineWidth = 1;
      for (let i = 0; i < 10; i++) { x.beginPath(); x.moveTo(10 + Math.random() * 20, 20 + Math.random() * 24); x.lineTo(40 + Math.random() * 10, 32 + (Math.random() - 0.5) * 10); x.stroke(); }
      x.strokeStyle = '#1a0505'; x.lineWidth = 4; x.beginPath(); x.ellipse(64, 32, 58, 26, 0, 0, PI * 2); x.stroke();
    }, 'eye'),
    clock: () => canvasTex(128, 128, (x, w, h) => {
      x.fillStyle = '#222'; x.beginPath(); x.arc(64, 64, 62, 0, PI * 2); x.fill();
      x.fillStyle = '#efece2'; x.beginPath(); x.arc(64, 64, 56, 0, PI * 2); x.fill();
      x.fillStyle = '#222';
      for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; x.fillRect(64 + Math.sin(a) * 48 - 2, 64 - Math.cos(a) * 48 - 2, 4, 4); }
      x.strokeStyle = '#111'; x.lineCap = 'round';
      const hA = ((4 + 44 / 60) / 12) * PI * 2, mA = (44 / 60) * PI * 2;
      x.lineWidth = 5; x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.sin(hA) * 28, 64 - Math.cos(hA) * 28); x.stroke();
      x.lineWidth = 3; x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.sin(mA) * 44, 64 - Math.cos(mA) * 44); x.stroke();
      x.strokeStyle = '#b01010'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.sin(mA + 0.02) * 50, 64 - Math.cos(mA + 0.02) * 50); x.stroke();
    }, 'clock'),
    exit: () => canvasTex(128, 48, (x, w, h) => {
      x.fillStyle = '#0c8a3a'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#e8ffe8'; x.font = font(22, 'bold'); x.textAlign = 'center';
      x.fillText('비상구', 76, 32);
      x.fillRect(12, 12, 10, 10); x.fillRect(14, 22, 6, 14); x.fillRect(22, 24, 10, 4);
    }, 'exit'),
    proctor: () => canvasTex(128, 160, (x, w, h) => {
      x.fillStyle = '#f2f0e8'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#9aa'; x.lineWidth = 1;
      for (let i = 0; i < 12; i++) { x.beginPath(); x.moveTo(10, 18 + i * 12); x.lineTo(w - 10, 18 + i * 12); x.stroke(); }
      x.fillStyle = '#333'; x.font = font(10); x.fillText('성명:', 10, 12);
      x.strokeStyle = '#c41616'; x.lineWidth = 9;
      x.beginPath(); x.ellipse(64, 84, 28, 40, 0, 0, PI * 2); x.stroke();
    }, 'proctor'),
    portal: () => canvasTex(256, 256, (x, w, h) => {
      const g = x.createRadialGradient(128, 128, 20, 128, 128, 128);
      g.addColorStop(0, '#000'); g.addColorStop(0.6, '#000'); g.addColorStop(0.8, 'rgba(60,0,80,0.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.lineWidth = 4;
      for (let i = 0; i < 6; i++) {
        x.strokeStyle = `rgba(${150 + i * 15},50,${180 + i * 10},${0.5 - i * 0.06})`;
        x.beginPath(); x.arc(128, 128, 80 + i * 8, i, i + 1.8 + i * 0.3); x.stroke();
      }
    }, 'portal'),
    paper: () => canvasTex(64, 96, (x, w, h) => {
      x.fillStyle = '#e8e1cc'; x.fillRect(0, 0, w, h);
      x.fillStyle = 'rgba(40,40,60,0.7)';
      for (let i = 0; i < 8; i++) x.fillRect(8, 12 + i * 9, 30 + Math.random() * 18, 2);
      x.fillStyle = 'rgba(140,0,0,0.6)'; x.fillRect(8, 84, 26, 3);
    }, 'paper'),
    grille: () => canvasTex(64, 48, (x, w, h) => {
      x.fillStyle = '#2a2a2c'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#0d0d0d';
      for (let i = 0; i < 9; i++) for (let j = 0; j < 6; j++) { x.beginPath(); x.arc(8 + i * 6, 8 + j * 6, 2, 0, PI * 2); x.fill(); }
    }, 'grille'),
  };

  function boardTex(text, twisted, key) {
    return canvasTex(512, 160, (x, w, h) => {
      x.fillStyle = '#6b5236'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#1d3a2b'; x.fillRect(8, 8, w - 16, h - 16);
      speckle(x, w, h, 800, '255,255,255', 0.04);
      x.textAlign = 'left';
      if (twisted) {
        x.fillStyle = 'rgba(230,140,140,0.75)'; x.font = font(26, 'bold');
        for (let i = 0; i < 4; i++) x.fillText('출석 출석 출석 출석 출석 출석', 20 + (i % 2) * 14, 40 + i * 32);
        x.fillStyle = 'rgba(240,240,230,0.25)';
        for (let i = 0; i < 6; i++) { x.beginPath(); x.ellipse(60 + i * 75, 100, 14, 18, 0, 0, PI * 2); x.fill(); }
      } else {
        x.fillStyle = 'rgba(235,235,225,0.85)'; x.font = font(28, 'bold');
        x.fillText(text, 26, 52);
        x.font = font(18); x.fillStyle = 'rgba(235,235,225,0.6)';
        x.fillText('4월 4일 (목)   주번: 윤하람', 26, 92);
        x.fillText('떠든 사람:', 26, 124);
        x.textAlign = 'right'; x.fillStyle = 'rgba(255,220,120,0.7)';
        x.fillText('※ 종이 치면 자리에 앉을 것', w - 24, 124);
      }
    }, key);
  }

  function signTex(name) {
    return canvasTex(160, 56, (x, w, h) => {
      x.fillStyle = '#e6e3d8'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#2a4a7a'; x.fillRect(0, 0, w, 8);
      x.fillStyle = '#1a1a1a'; x.font = font(24, 'bold'); x.textAlign = 'center';
      x.fillText(name, w / 2, 42);
    }, 'sign:' + name);
  }

  function photoBoardCanvas() {
    const c = document.createElement('canvas');
    c.width = 360; c.height = 260;
    return c;
  }
  function drawPhotoBoard(c) {
    const x = c.getContext('2d');
    x.fillStyle = '#8a6a44'; x.fillRect(0, 0, c.width, c.height);
    speckle(x, c.width, c.height, 600, '40,20,0', 0.2);
    x.fillStyle = '#2a1a0a'; x.font = font(18, 'bold'); x.textAlign = 'center';
    x.fillText('1학년 6반 — 증명사진', c.width / 2, 28);
    HUD_FACES.forEach((k, i) => {
      const px = 16 + i * 68, py = 52;
      x.save();
      x.fillStyle = '#eee'; x.fillRect(px, py, 60, 78);
      x.beginPath(); x.rect(px + 3, py + 3, 54, 72); x.clip();
      x.fillStyle = '#7d93a8'; x.fillRect(px, py, 60, 78);
      H.drawPortrait(x, k, px + 30, py + 42, 70);
      x.restore();
      x.fillStyle = '#d33'; x.beginPath(); x.arc(px + 30, py - 1, 3, 0, PI * 2); x.fill();
      if (G.marks.has(k)) {
        x.strokeStyle = 'rgba(210,10,10,0.9)'; x.lineWidth = 5; x.lineCap = 'round';
        x.beginPath(); x.moveTo(px + 5, py + 6); x.lineTo(px + 55, py + 72); x.moveTo(px + 55, py + 6); x.lineTo(px + 5, py + 72); x.stroke();
      }
      x.fillStyle = '#1a1a1a'; x.font = font(12, 'bold');
      x.fillText(CHARS[k].name, px + 30, py + 96);
    });
  }

  // ---------------------------------------------------------
  //  지오메트리 도우미
  // ---------------------------------------------------------
  const Geo = () => ({ p: [], n: [], uv: [] });
  function quad(g, a, b, c, d, nrm, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
    g.p.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) g.n.push(nrm[0], nrm[1], nrm[2]);
    g.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
  }
  function vface(g, cx, cz, nx, nz, w, y0, y1) {
    const rx = nz, rz = -nx, hw = w / 2;
    const a = [cx - rx * hw, y0, cz - rz * hw], b = [cx + rx * hw, y0, cz + rz * hw];
    quad(g, a, b, [b[0], y1, b[2]], [a[0], y1, a[2]], [nx, 0, nz], 0, y0 / WALL_H, 1, y1 / WALL_H);
  }
  function hface(g, x0, z0, x1, z1, y, up) {
    if (up) quad(g, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0]);
    else quad(g, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0]);
  }
  function boxFaces(g, x0, x1, y0, y1, z0, z1, faces) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (faces.includes('n')) vface(g, cx, z0, 0, -1, x1 - x0, y0, y1);
    if (faces.includes('s')) vface(g, cx, z1, 0, 1, x1 - x0, y0, y1);
    if (faces.includes('w')) vface(g, x0, cz, -1, 0, z1 - z0, y0, y1);
    if (faces.includes('e')) vface(g, x1, cz, 1, 0, z1 - z0, y0, y1);
    if (faces.includes('t')) hface(g, x0, z0, x1, z1, y1, true);
    if (faces.includes('b')) hface(g, x0, z0, x1, z1, y0, false);
  }
  function geoMesh(g, mat) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
    bg.setAttribute('normal', new THREE.Float32BufferAttribute(g.n, 3));
    bg.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    return new THREE.Mesh(bg, mat);
  }

  // 정점 색 파츠로 모델 만들기: [종류, a, b, c, x, y, z, 색, ry, rx, rz]
  const _m4 = new THREE.Matrix4(), _eu = new THREE.Euler(), _col = new THREE.Color();
  function build(parts) {
    const geos = parts.map((pt) => {
      const [k, a, b, c, x, y, z, col, ry = 0, rx = 0, rz = 0] = pt;
      let g;
      if (k === 'b') g = new THREE.BoxGeometry(a, b, c);
      else if (k === 'c') g = new THREE.CylinderGeometry(a, b, c, 12);
      else if (k === 's') { g = new THREE.SphereGeometry(1, 14, 10); g.scale(a, b, c); }
      else g = a.clone();
      if (rx || ry || rz) g.applyMatrix4(_m4.makeRotationFromEuler(_eu.set(rx, ry, rz, 'YXZ')));
      g.translate(x, y, z);
      if (g.index) g = g.toNonIndexed();
      const n = g.attributes.position.count, arr = new Float32Array(n * 3);
      _col.set(col);
      for (let i = 0; i < n; i++) { arr[i * 3] = _col.r; arr[i * 3 + 1] = _col.g; arr[i * 3 + 2] = _col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      return g;
    });
    return THREE.BufferGeometryUtils.mergeBufferGeometries(geos);
  }
  const vcMat = () => new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 4, specular: 0x080808 });

  function sphereCap(phiStart, phiLen, thetaLen, sx, sy, sz) {
    const g = new THREE.SphereGeometry(1, 14, 10, phiStart, phiLen, 0, thetaLen);
    g.scale(sx, sy, sz);
    return g;
  }

  // ---------------------------------------------------------
  //  가구 / 소품 모델 (정면 = +X, 원점 = 칸 중앙 바닥)
  // ---------------------------------------------------------
  const WOOD = '#b58a5a', METAL = '#3a3d42';
  function chairParts(x0, seatCol = '#a87d4f') {
    const p = [['b', 0.36, 0.03, 0.38, x0, 0.44, 0, seatCol], ['b', 0.03, 0.32, 0.36, x0 - 0.18, 0.7, 0, seatCol]];
    for (const dx of [-0.15, 0.15]) for (const dz of [-0.15, 0.15]) p.push(['b', 0.025, 0.44, 0.025, x0 + dx, 0.22, dz, METAL]);
    p.push(['b', 0.025, 0.3, 0.025, x0 - 0.18, 0.56, 0.15, METAL], ['b', 0.025, 0.3, 0.025, x0 - 0.18, 0.56, -0.15, METAL]);
    return p;
  }
  const PROP_PARTS = {
    deskset: () => {
      const p = [['b', 0.46, 0.035, 0.64, 0.14, 0.72, 0, WOOD], ['b', 0.42, 0.12, 0.58, 0.14, 0.62, 0, '#2f3236']];
      for (const dx of [-0.07, 0.35]) for (const dz of [-0.29, 0.29]) p.push(['b', 0.03, 0.7, 0.03, dx, 0.35, dz, METAL]);
      return p.concat(chairParts(-0.3));
    },
    exam: () => PROP_PARTS.deskset().concat([['b', 0.2, 0.004, 0.28, 0.14, 0.74, 0.02, '#ece8dc', 0.2]]),
    office: () => [
      ['b', 0.7, 0.04, 1.12, 0.05, 0.74, 0, '#8a7a66'], ['b', 0.6, 0.7, 0.4, 0.05, 0.36, 0.34, '#6a6f74'],
      ['b', 0.04, 0.3, 0.46, 0.25, 1.0, -0.1, '#151515'], ['b', 0.12, 0.02, 0.14, 0.25, 0.77, -0.1, '#222'], ['b', 0.04, 0.1, 0.04, 0.25, 0.81, -0.1, '#222'],
      ['b', 0.22, 0.03, 0.3, -0.05, 0.775, 0.25, '#e8e4d8', 0.3], ['b', 0.2, 0.06, 0.28, 0.0, 0.79, 0.3, '#ddd8c8', -0.2],
      ['b', 0.66, 0.68, 0.03, 0.05, 0.36, -0.54, '#6a6f74'],
      ...chairParts(-0.45, '#2b2b30'),
    ],
    cafe: () => {
      const p = [['b', 0.8, 0.04, 1.18, 0, 0.74, 0, '#c9c9c4'], ['b', 0.08, 0.7, 0.08, 0, 0.36, 0, METAL]];
      for (const dz of [-0.3, 0.3]) for (const dx of [-0.55, 0.55]) p.push(['c', 0.15, 0.15, 0.04, dx, 0.45, dz, '#3a6e8a'], ['b', 0.04, 0.43, 0.04, dx, 0.22, dz, METAL]);
      p.push(['b', 0.3, 0.02, 0.4, -0.18, 0.77, -0.25, '#8aa0a8'], ['b', 0.3, 0.02, 0.4, 0.2, 0.77, 0.28, '#8aa0a8'], ['c', 0.05, 0.04, 0.04, 0.2, 0.8, 0.2, '#ddd']);
      return p;
    },
    library: () => {
      const p = [['b', 0.9, 0.05, 1.15, 0, 0.74, 0, '#7a5a3a'], ['b', 0.06, 0.7, 0.9, 0, 0.36, 0, '#5a4028']];
      const cols = ['#7a2020', '#203a6a', '#2a5a2a', '#6a5a20'];
      for (let i = 0; i < 4; i++) p.push(['b', 0.2, 0.05, 0.14, -0.2 + (i % 2) * 0.05, 0.79 + i * 0.05, 0.3, cols[i], i * 0.2]);
      p.push(['b', 0.24, 0.02, 0.32, 0.18, 0.775, -0.2, '#e8e4d8', 0.5]);
      return p.concat(chairParts(-0.62, '#6a4a2a'));
    },
    art: () => [
      ['b', 0.04, 1.5, 0.04, 0.05, 0.72, -0.22, '#7a5a3a', 0, 0, 0.12], ['b', 0.04, 1.5, 0.04, 0.05, 0.72, 0.22, '#7a5a3a', 0, 0, 0.12],
      ['b', 0.04, 1.4, 0.04, -0.2, 0.68, 0, '#7a5a3a', 0, 0, -0.25],
      ['b', 0.04, 0.03, 0.56, 0.11, 0.86, 0, '#7a5a3a'],
      ['b', 0.03, 0.62, 0.5, 0.12, 1.2, 0, '#e6e0d0', 0, 0, 0.12],
      ['s', 0.012, 0.09, 0.07, 0.137, 1.24, 0, '#3a2a2a', 0, 0, 0.12],
      ['c', 0.17, 0.17, 0.04, -0.45, 0.6, 0, '#7a5a3a'], ['b', 0.04, 0.58, 0.04, -0.45, 0.29, 0, METAL],
    ],
    music: () => chairParts(-0.2, '#3a3a40').concat([
      ['b', 0.02, 1.0, 0.02, 0.32, 0.5, 0, METAL], ['b', 0.02, 0.3, 0.42, 0.33, 1.08, 0, '#202022', 0, 0, 0.35],
      ['b', 0.01, 0.24, 0.3, 0.315, 1.1, 0, '#e8e4d8', 0, 0, 0.35],
    ]),
    lab: () => [
      ['b', 0.95, 0.06, 1.18, 0, 0.88, 0, '#1d1f22'], ['b', 0.85, 0.85, 1.08, 0, 0.42, 0, '#d8d4c8'],
      ['b', 0.02, 0.6, 0.5, 0.43, 0.42, 0.26, '#bdb8aa'], ['b', 0.02, 0.6, 0.5, 0.43, 0.42, -0.26, '#bdb8aa'],
      ['c', 0.015, 0.015, 0.3, 0, 1.06, 0, '#aaa'], ['b', 0.14, 0.015, 0.015, 0.06, 1.2, 0, '#aaa'],
      ['c', 0.05, 0.05, 0.18, 0.25, 1.0, 0.35, '#9fd0c0'], ['c', 0.04, 0.06, 0.12, -0.2, 0.97, -0.38, '#c8e8f0'],
    ],
    bcast: () => [
      ['b', 0.7, 0.75, 1.18, 0, 0.375, 0, '#2a2a30'], ['b', 0.5, 0.06, 1.1, 0.02, 0.79, 0, '#3a3a44', 0, 0, -0.18],
      ...[-0.4, -0.25, -0.1, 0.05, 0.2, 0.35].map((z) => ['b', 0.05, 0.03, 0.02, 0.05, 0.83, z, '#c8c8c8', 0, 0, -0.18]),
      ['c', 0.012, 0.012, 0.35, 0.1, 0.98, 0.2, '#111'], ['s', 0.04, 0.05, 0.04, 0.1, 1.18, 0.2, '#333'],
      ['b', 0.25, 0.4, 0.5, -0.15, 1.0, -0.25, '#151515'],
    ],
    principal: () => [
      ['b', 0.82, 0.05, 1.2, 0, 0.78, 0, '#5a3a22'], ['b', 0.8, 0.74, 0.06, 0, 0.37, -0.56, '#4a2e18'], ['b', 0.8, 0.74, 0.06, 0, 0.37, 0.56, '#4a2e18'],
      ['b', 0.05, 0.7, 1.1, 0.38, 0.37, 0, '#4a2e18'], ['b', 0.12, 0.08, 0.2, -0.1, 0.84, 0.3, '#c8a640'],
    ],
    sofa: () => [
      ['b', 0.8, 0.42, 1.2, 0, 0.21, 0, '#5a2a2a'], ['b', 0.22, 0.5, 1.2, -0.3, 0.62, 0, '#5a2a2a'], ['b', 0.5, 0.12, 0.5, 0.05, 0.48, -0.28, '#6a3232'],
    ],
    nurse: () => [
      ['b', 0.9, 0.08, 1.2, 0, 0.42, 0, '#c8ccd0'], ['b', 0.86, 0.14, 1.2, 0, 0.53, 0, '#eeeeea'],
      ...[-0.42, 0.42].map((dx) => ['b', 0.04, 0.42, 0.04, dx, 0.21, 0, '#aab']),
    ],
    nurseHead: () => PROP_PARTS.nurse().concat([['b', 0.5, 0.1, 0.3, 0, 0.65, -0.42, '#fff'], ['b', 0.9, 0.5, 0.04, 0, 0.7, -0.58, '#c8ccd0']]),
    cabinet: () => [
      ['b', 0.5, 1.35, 1.1, 0, 0.675, 0, '#6a6f74'],
      ...[0.3, 0.62, 0.94, 1.26].map((y) => ['b', 0.02, 0.02, 1.0, 0.26, y, 0, '#3a3d42']),
      ...[0.45, 0.77, 1.09].map((y) => ['b', 0.03, 0.03, 0.18, 0.26, y, 0, '#c8c8c8']),
    ],
    shelf: () => {
      const p = [['b', 0.42, 2.0, 1.18, 0, 1.0, 0, '#5a4028']];
      const cols = ['#7a2020', '#203a6a', '#2a5a2a', '#6a5a20', '#4a2a5a', '#888070'];
      for (let r = 0; r < 4; r++) {
        p.push(['b', 0.02, 0.02, 1.1, 0.21, 0.12 + r * 0.48, 0, '#3a2a18']);
        let z = -0.52;
        while (z < 0.5) {
          const w = 0.04 + hash(r * 31 + Math.round(z * 100), 7) * 0.05, hh = 0.28 + hash(r, Math.round(z * 100)) * 0.12;
          if (hash(Math.round(z * 100), r * 9) > 0.12) p.push(['b', 0.28, hh, w, 0.06, 0.14 + r * 0.48 + hh / 2, z + w / 2, cols[(r * 7 + Math.round(z * 50)) % cols.length]]);
          z += w + 0.005;
        }
      }
      return p;
    },
    copier: () => [['b', 0.65, 0.95, 0.6, 0, 0.475, 0, '#d4d4d0'], ['b', 0.5, 0.05, 0.45, 0.02, 0.98, 0, '#555'], ['b', 0.25, 0.03, 0.3, 0.3, 0.7, 0, '#e8e4d8']],
    water: () => [['b', 0.35, 1.0, 0.35, 0, 0.5, 0, '#e0e0e0'], ['c', 0.14, 0.14, 0.4, 0, 1.2, 0, '#6aa8e8'], ['b', 0.04, 0.05, 0.05, 0.19, 0.8, 0.06, '#c22'], ['b', 0.04, 0.05, 0.05, 0.19, 0.8, -0.06, '#22c']],
    piano: () => [
      ['b', 0.6, 1.25, 1.18, -0.05, 0.625, 0, '#0c0c0e'], ['b', 0.25, 0.04, 1.1, 0.3, 0.74, 0, '#f0f0ea'],
      ...Array.from({ length: 14 }, (_, i) => ['b', 0.12, 0.03, 0.03, 0.27, 0.77, -0.5 + i * 0.077, '#0a0a0a']),
      ['b', 0.25, 0.06, 1.1, 0.3, 0.7, 0, '#0c0c0e'], ['b', 0.3, 0.5, 0.6, 0.6, 0.25, 0, '#0c0c0e'],
    ],
    toilet: () => [['c', 0.2, 0.15, 0.4, 0.05, 0.2, 0, '#f2f2f0'], ['b', 0.2, 0.42, 0.42, -0.2, 0.55, 0, '#f2f2f0'], ['c', 0.21, 0.21, 0.03, 0.05, 0.42, 0, '#e8e8e4']],
    urinal: () => [['b', 0.3, 0.6, 0.4, -0.3, 0.75, 0, '#f2f2f0'], ['b', 0.05, 0.4, 0.3, -0.13, 0.7, 0, '#222']],
    skeleton: () => {
      const B = '#e8e2d0';
      const p = [['c', 0.2, 0.25, 0.04, 0, 0.02, 0, METAL], ['b', 0.03, 1.0, 0.03, 0, 0.5, 0, METAL],
        ['s', 0.1, 0.12, 0.09, 0.02, 1.66, 0, B], ['b', 0.04, 0.05, 0.08, 0.1, 1.6, 0, '#111'],
        ['b', 0.04, 0.6, 0.04, 0, 1.25, 0, B], ['b', 0.12, 0.1, 0.32, 0, 0.92, 0, B]];
      for (let i = 0; i < 5; i++) p.push(['b', 0.16, 0.025, 0.32 - i * 0.03, 0.02, 1.45 - i * 0.07, 0, B]);
      for (const z of [-0.2, 0.2]) p.push(['b', 0.035, 0.6, 0.035, 0, 1.15, z, B, 0, z > 0 ? -0.1 : 0.1], ['b', 0.04, 0.85, 0.04, 0, 0.45, z * 0.5, B]);
      return p;
    },
    trophy: () => [
      ['b', 0.45, 1.8, 1.15, 0, 0.9, 0, '#4a2e18'], ['b', 0.02, 1.2, 1.0, 0.23, 1.15, 0, '#203038'],
      ...[-0.3, 0, 0.3].map((z, i) => ['c', 0.05, 0.03, 0.22, 0.05, 0.75 + i * 0.4, z, '#c8a640']),
    ],
    flag: () => [['c', 0.015, 0.015, 2.2, 0, 1.1, 0, '#c8a640'], ['b', 0.01, 0.55, 0.8, 0, 1.85, 0.42, '#f4f4f0'], ['s', 0.012, 0.1, 0.1, 0.006, 1.85, 0.42, '#b02030']],
    rack: () => [
      ['b', 0.6, 1.9, 1.0, 0, 0.95, 0, '#121214'],
      ...[0.4, 0.7, 1.0, 1.3, 1.6].map((y) => ['b', 0.02, 0.2, 0.9, 0.31, y, 0, '#26262c']),
      ...[0.45, 0.75, 1.05, 1.35].map((y, i) => ['b', 0.02, 0.02, 0.02, 0.32, y, -0.35 + i * 0.05, i % 2 ? '#2f2' : '#f42']),
    ],
    medcab: () => [['b', 0.36, 1.8, 1.0, 0, 0.9, 0, '#e8e8e4'], ['b', 0.02, 0.18, 0.06, 0.19, 1.5, 0, '#c22'], ['b', 0.02, 0.06, 0.18, 0.19, 1.5, 0, '#c22'], ['b', 0.02, 1.0, 0.02, 0.19, 0.8, 0, '#aaa']],
    counter: () => [['b', 0.75, 0.95, 1.2, 0, 0.475, 0, '#a8adb2'], ['b', 0.02, 0.4, 1.15, 0.15, 1.2, 0, '#cfe8f0'], ['b', 0.5, 0.12, 0.3, -0.05, 1.0, 0.2, '#888c90']],
    shoes: () => {
      const p = [['b', 0.42, 1.8, 1.18, 0, 0.9, 0, '#9aa0a6']];
      for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) p.push(['b', 0.02, 0.24, 0.24, 0.21, 0.2 + r * 0.28, -0.42 + c * 0.28, hash(r, c) < 0.15 ? '#3a3f44' : '#14161a']);
      return p;
    },
    podium: () => [['b', 0.55, 1.05, 0.75, 0, 0.525, 0, '#7a5a3a'], ['b', 0.6, 0.04, 0.8, 0, 1.07, 0, '#8a6a44'], ['b', 0.3, 0.06, 0.22, 0.05, 1.12, 0.12, '#204a2b']],
    ext: () => [['c', 0.08, 0.08, 0.5, 0, 0.27, 0, '#c41a1a'], ['c', 0.03, 0.03, 0.08, 0, 0.56, 0, '#222'], ['b', 0.12, 0.03, 0.04, 0.05, 0.58, 0, '#222']],
    frame: () => [],
  };
  function propGeo(type) {
    if (!geoCache['prop:' + type]) geoCache['prop:' + type] = build(PROP_PARTS[type]());
    return geoCache['prop:' + type];
  }
  const DESK_MODEL = { class: 'deskset', exam: 'exam', office: 'office', cafe: 'cafe', library: 'library', art: 'art', music: 'music', lab: 'lab', bcast: 'bcast', principal: 'principal', nurse: 'nurse' };

  // ---------------------------------------------------------
  //  인물 / 괴이 모델
  // ---------------------------------------------------------
  function personGeo(key, o = {}) {
    const ck = 'person:' + key + ':' + (o.seated ? 1 : 0) + (o.faceless ? 1 : 0) + (o.blackEyes ? 1 : 0) + (o.smile ? 1 : 0) + (o.mirrored ? 1 : 0);
    if (geoCache[ck]) return geoCache[ck];
    const ch = CHARS[key] || CHARS['학생'];
    const skin = o.faceless ? '#9b968e' : ch.skin || '#e9cfb4';
    const body = ch.body || '#1e2943', hair = ch.hair || '#111';
    const girl = ch.style === 'long' || ch.style === 'bob';
    const legC = girl ? '#16161a' : '#23262e';
    const P = [];
    const y0 = o.seated ? 0.47 : 0.8;
    if (o.seated) {
      for (const z of [-0.09, 0.09]) P.push(['b', 0.42, 0.14, 0.15, 0.12, 0.5, z, girl ? '#2a3046' : legC], ['b', 0.13, 0.47, 0.13, 0.32, 0.235, z, legC], ['b', 0.22, 0.06, 0.12, 0.36, 0.03, z, '#111']);
    } else {
      for (const z of [-0.09, 0.09]) P.push(['b', 0.13, 0.8, 0.13, 0, 0.4, z, legC], ['b', 0.24, 0.06, 0.12, 0.04, 0.03, z, '#111']);
      if (girl) P.push(['c', 0.2, 0.27, 0.3, 0, 0.7, 0, '#2a3046']);
    }
    P.push(['b', 0.24, 0.56, 0.42, 0, y0 + 0.28, 0, body]);
    P.push(['b', 0.02, 0.15, 0.13, 0.12, y0 + 0.48, 0, '#e9e9e4']);
    P.push(['b', 0.02, 0.24, 0.045, 0.125, y0 + 0.37, 0, ch.tie || '#7a1f2b']);
    if (!ch.adult) P.push(['b', 0.02, 0.04, 0.1, 0.125, y0 + 0.44, o.mirrored ? -0.13 : 0.13, '#f4f4f0'], ['b', 0.022, 0.012, 0.07, 0.126, y0 + 0.44, o.mirrored ? -0.13 : 0.13, '#444']);
    for (const z of [-0.27, 0.27]) {
      if (o.seated) P.push(['b', 0.11, 0.42, 0.11, 0.08, y0 + 0.33, z, body, 0, 0, -0.5], ['b', 0.09, 0.09, 0.09, 0.22, y0 + 0.1, z * 0.85, skin]);
      else P.push(['b', 0.11, 0.56, 0.11, 0, y0 + 0.27, z, body], ['b', 0.09, 0.1, 0.09, 0, y0 - 0.06, z, skin]);
    }
    P.push(['b', 0.09, 0.08, 0.09, 0, y0 + 0.6, 0, skin]);
    const hy = y0 + 0.75;
    P.push(['s', 0.125, 0.145, 0.12, 0, hy, 0, skin]);
    if (!o.faceless) {
      switch (ch.style) {
        case 'buzz':
          P.push(['g', sphereCap(0, PI * 2, 1.2, 0.131, 0.151, 0.126), 0, 0, 0, hy, 0, hair]);
          break;
        case 'long':
          P.push(['g', sphereCap(0, PI * 2, 1.05, 0.136, 0.156, 0.131), 0, 0, 0, hy, 0, hair]);
          P.push(['g', sphereCap(-PI / 2, PI, 2.3, 0.138, 0.158, 0.133), 0, 0, 0, hy, 0, hair]);
          P.push(['b', 0.07, 0.4, 0.27, -0.09, hy - 0.22, 0, hair]);
          for (const z of [-0.12, 0.12]) P.push(['b', 0.07, 0.3, 0.03, 0.03, hy - 0.12, z, hair]);
          break;
        case 'bob':
          P.push(['g', sphereCap(0, PI * 2, 1.0, 0.138, 0.158, 0.134), 0, 0, 0, hy, 0, hair]);
          P.push(['g', sphereCap(-PI / 2, PI, 2.1, 0.142, 0.16, 0.138), 0, 0, 0, hy, 0, hair]);
          for (const z of [-0.125, 0.125]) P.push(['b', 0.16, 0.17, 0.035, 0.0, hy - 0.05, z, hair]);
          break;
        default:
          P.push(['g', sphereCap(0, PI * 2, 1.15, 0.134, 0.154, 0.129), 0, 0, 0, hy, 0, hair]);
          P.push(['g', sphereCap(-PI / 2, PI, 1.95, 0.136, 0.156, 0.131), 0, 0, 0, hy, 0, hair]);
          if (ch.style === 'side') P.push(['b', 0.04, 0.05, 0.17, 0.11, hy + 0.08, 0.02, hair, 0, 0.3]);
      }
      const ex = 0.116, ey = hy + 0.012;
      if (o.blackEyes) for (const z of [-0.045, 0.045]) P.push(['b', 0.016, 0.055, 0.045, ex, ey, z, '#000']);
      else for (const z of [-0.045, 0.045]) P.push(['b', 0.01, 0.03, 0.042, ex, ey, z, '#f2f2f2'], ['b', 0.012, 0.026, 0.024, ex + 0.002, ey - 0.001, z, '#1b1410']);
      for (const z of [-0.047, 0.047]) P.push(['b', 0.01, 0.01, 0.05, 0.113, ey + 0.035, z, o.blackEyes ? '#000' : hair, 0, z > 0 ? -0.15 : 0.15]);
      if (ch.glasses) {
        for (const z of [-0.047, 0.047]) P.push(['b', 0.006, 0.006, 0.06, 0.124, ey + 0.026, z, '#222'], ['b', 0.006, 0.006, 0.06, 0.124, ey - 0.02, z, '#222']);
        P.push(['b', 0.006, 0.006, 0.03, 0.125, ey + 0.01, 0, '#222']);
      }
      if (o.smile) P.push(['b', 0.012, 0.025, 0.12, 0.112, hy - 0.058, 0, '#6a0a0a'], ['b', 0.013, 0.008, 0.1, 0.113, hy - 0.05, 0, '#eee']);
      else P.push(['b', 0.008, 0.008, 0.04, 0.113, hy - 0.06, 0, '#7a3a3a']);
      if (ch.band) P.push(['g', new THREE.CylinderGeometry(0.128, 0.128, 0.03, 16, 1, true), 0, 0, 0, hy + 0.06, 0, '#d03a3a']);
      if (ch.headset) {
        const arc = new THREE.TorusGeometry(0.155, 0.012, 6, 16, PI);
        arc.rotateY(PI / 2);
        P.push(['g', arc, 0, 0, 0, hy, 0, '#2a2a2a']);
        for (const z of [-0.14, 0.14]) P.push(['c', 0.045, 0.045, 0.035, 0, hy - 0.01, z, '#2a2a2a', 0, PI / 2]);
      }
    } else {
      P.push(['g', sphereCap(0, PI * 2, 1.1, 0.13, 0.15, 0.125), 0, 0, 0, hy, 0, '#2a2a2a']);
    }
    return (geoCache[ck] = build(P));
  }

  function makePerson(key, o = {}) {
    const mat = vcMat();
    if (o.tint) mat.color.set(o.tint);
    const mesh = new THREE.Mesh(personGeo(key, o), mat);
    const g = new THREE.Group();
    g.add(mesh);
    if (CHARS[key] && CHARS[key].adult) g.scale.setScalar(1.08);
    return { g, mesh, mat };
  }

  function makeRoll() {
    const g = new THREE.Group();
    const mat = new THREE.MeshPhongMaterial({ color: 0x060607, shininess: 2, transparent: true });
    const robe = build([
      ['c', 0.22, 0.52, 2.05, 0, 1.02, 0, '#ffffff'], ['s', 0.3, 0.13, 0.3, 0, 2.05, 0, '#ffffff'],
      ['b', 0.06, 0.75, 0.06, 0.2, 1.68, 0.3, '#ffffff', 0, 0, 0.55], ['b', 0.06, 0.75, 0.06, 0.2, 1.68, -0.3, '#ffffff', 0, 0, 0.55],
    ]);
    g.add(new THREE.Mesh(robe, mat));
    const pale = new THREE.MeshBasicMaterial({ color: 0xcfc9ba, transparent: true, fog: true });
    const head = new THREE.Mesh(build([
      ['c', 0.045, 0.06, 0.25, 0, 2.15, 0, '#ffffff'], ['s', 0.13, 0.23, 0.13, 0.02, 2.42, 0, '#ffffff'],
      ...[-0.03, -0.01, 0.01, 0.03].map((z) => ['b', 0.015, 0.16, 0.012, 0.47, 1.25, 0.16 + z, '#ffffff', 0, 0, 0.3]),
      ...[-0.03, -0.01, 0.01, 0.03].map((z) => ['b', 0.015, 0.16, 0.012, 0.47, 1.25, -0.16 + z, '#ffffff', 0, 0, 0.3]),
    ]), pale);
    g.add(head);
    const book = new THREE.Mesh(build([['b', 0.03, 0.28, 0.42, 0.44, 1.38, 0, '#204a2b', 0, 0, -0.55], ['b', 0.035, 0.25, 0.38, 0.45, 1.39, 0, '#e8e4d8', 0, 0, -0.55]]), new THREE.MeshPhongMaterial({ vertexColors: true, transparent: true }));
    g.add(book);
    return { g, mats: [mat, pale, book.material] };
  }

  function makeEraser() {
    const g = new THREE.Group();
    const mat = vcMat();
    const body = new THREE.Mesh(build([
      ['b', 0.55, 0.32, 1.3, 0, 0.08, 0, '#e9e6dc'], ['b', 0.56, 0.16, 1.31, 0, -0.16, 0, '#3a3a3e'],
      ...Array.from({ length: 11 }, (_, i) => ['b', 0.565, 0.15, 0.012, 0, -0.16, -0.55 + i * 0.11, '#222226']),
      ['b', 0.02, 0.04, 1.0, 0.285, 0.18, 0, '#bdb8aa'],
    ]), mat);
    g.add(body);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.5), new THREE.MeshBasicMaterial({ color: 0x050404 }));
    mouth.position.set(0.282, 0.02, 0);
    g.add(mouth);
    return { g, mouth };
  }

  function makeProctor() {
    const g = new THREE.Group();
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, transparent: true });
    g.add(new THREE.Mesh(build([
      ['c', 0.22, 0.46, 1.8, 0, 0.9, 0, '#121214'], ['s', 0.3, 0.12, 0.3, 0, 1.8, 0, '#121214'],
      ['b', 0.02, 0.22, 0.1, 0.2, 1.68, 0, '#e9e9e2'], ['b', 0.024, 0.18, 0.04, 0.205, 1.66, 0, '#6b1111'],
      ['b', 0.07, 0.7, 0.07, 0.05, 1.4, 0.3, '#121214'], ['b', 0.07, 0.7, 0.07, 0.05, 1.4, -0.3, '#121214'],
      ['c', 0.05, 0.05, 0.2, 0, 1.92, 0, '#121214'],
    ]), mat));
    const fmat = new THREE.MeshBasicMaterial({ map: TEX.proctor(), transparent: true, side: THREE.DoubleSide });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.55), fmat);
    face.rotation.y = PI / 2;
    face.position.set(0.04, 2.2, 0);
    g.add(face);
    return { g, mats: [mat, fmat], face };
  }

  // ---------------------------------------------------------
  //  초기화
  // ---------------------------------------------------------
  function init(canvas, game, helpers) {
    G = game; H = helpers;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(66, VW / VH, 0.05, 80);
    camera.rotation.order = 'YXZ';
    camera.layers.set(0);
    flash = new THREE.SpotLight(0xfff1d6, FLASH, 26, 0.52, 0.5, 1.5);
    flash.position.set(0.12, -0.12, 0);
    const tgt = new THREE.Object3D();
    tgt.position.set(0, -0.15, -3);
    camera.add(flash); camera.add(tgt);
    flash.target = tgt;
    ambient = new THREE.AmbientLight(0x4a4a5a, 0.22);
    scene.add(camera);
    scene.add(ambient);
  }

  function resize(w, h) {
    if (!renderer) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(w, h, false);
  }

  function disposeLevel() {
    for (const k in geoCache) geoCache[k].__shared = true;
    if (!lv) return;
    scene.remove(lv.root);
    lv.root.traverse((o) => {
      if (o.geometry && !o.geometry.__shared) o.geometry.dispose();
      if (o.isReflector && o.getRenderTarget) o.getRenderTarget().dispose();
    });
    tracked.clear();
    lv = null;
  }

  // ---------------------------------------------------------
  //  층 만들기
  // ---------------------------------------------------------
  function buildLevel() {
    disposeLevel();
    const def = G.def, W = G.W, Hh = G.H, B1 = def.id === 'B1';
    const root = new THREE.Group();
    lv = { root, lockDoors: [], gates: [], decals: [], eyes: [], boards: [], deskSets: [], lights: [], speakers: [], avatar: null, photo: null, B1 };
    scene.add(root);
    scene.fog = new THREE.FogExp2(0x010102, B1 ? 0.07 : 0.085);
    ambient.intensity = B1 ? 0.12 : 0.2;
    ambient.color.set(B1 ? 0x5a3030 : 0x4a4a5a);

    const tile = (x, y) => H.tileAt(x, y);
    const wallish = (t) => t === '#' || t === 'M';
    const hallish = (t) => t === '.' || t === 'D' || t === 'G' || t === 'L';
    const roomAt = (x, y) => def.rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    const geos = {};
    const gk = (k) => geos[k] || (geos[k] = Geo());
    const statics = [];
    const addStatic = (geo, x, z, face, y = 0) => {
      const g = geo.clone();
      g.applyMatrix4(_m4.makeRotationY(-face));
      g.translate(x, y, z);
      statics.push(g);
    };
    const addParts = (parts) => statics.push(build(parts));
    const doorAt = new Set();
    for (const r of def.rooms) for (const d of r.doors || []) doorAt.add(d[0] + ',' + d[1]);

    // 바닥 / 천장
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const t = G.grid[y][x];
      if (wallish(t)) continue;
      const x0 = x * T, z0 = y * T, x1 = x0 + T, z1 = z0 + T;
      let fk;
      if (B1) fk = t === 'w' ? 'fConc' : 'fB1';
      else if (t === 'r') fk = 'fRest';
      else if (t === 'w' || t === 'S' || t === 'U') fk = 'fConc';
      else if (t === ',' || t === 'd' || t === 'b') fk = 'fClass';
      else fk = 'fHall';
      if (t === 'S') buildStairsDown(gk, x, y);
      else hface(gk(fk), x0, z0, x1, z1, 0, true);
      hface(gk('ceil'), x0, z0, x1, z1, WALL_H, false);
      if (t === 'U') buildStairsUp(gk, addParts, x, y);
    }

    // 벽면
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      if (!wallish(G.grid[y][x])) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= Hh) continue;
        const n = G.grid[ny][nx];
        if (wallish(n)) continue;
        const edge = x === 0 || y === 0 || x === W - 1 || y === Hh - 1;
        let k;
        if (B1) k = n === 'w' ? 'conc' : 'b1';
        else if (n === 'r') k = 'rest';
        else if (n === 'w' || n === 'S' || n === 'U') k = 'conc';
        else if (n === 'D' || n === 'L') k = 'hall';
        else if (hallish(n)) {
          if (edge) k = 'winHall';
          else {
            const nearDoor = doorAt.has((x - 1) + ',' + y) || doorAt.has((x + 1) + ',' + y) || doorAt.has(x + ',' + (y - 1)) || doorAt.has(x + ',' + (y + 1));
            k = !nearDoor && hash(x * 7 + dx, y * 7 + dy) < 0.38 ? 'locker' : 'hall';
          }
        } else k = edge ? (hash(x, y * 3) < 0.12 ? 'winHand' : 'win') : 'class';
        const cx = (x + 0.5 + dx * 0.5) * T, cz = (y + 0.5 + dy * 0.5) * T;
        vface(gk(k), cx, cz, dx, dy, T, 0, WALL_H);
        // 뒤틀림 장식: 벽의 눈, 피 글씨
        const hh = hash(x * 13 + dx * 3, y * 17 + dy * 5);
        if (k !== 'win' && k !== 'winHand' && k !== 'winHall') {
          if (hh < 0.07) addEye(cx + dx * 0.012, cz + dy * 0.012, dx, dy, 1.25 + hash(x, y) * 0.6, x, y);
          else if (hh > 0.955) addWallText(cx + dx * 0.012, cz + dy * 0.012, dx, dy, nx, ny);
        }
      }
    }

    // 문 (상인방, 문틀, 잠긴 문, 방 표지판)
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const t = G.grid[y][x];
      if (t !== 'D' && t !== 'L') continue;
      const ns = wallish(tile(x - 1, y)) && wallish(tile(x + 1, y));
      const x0 = x * T, z0 = y * T;
      boxFaces(gk('hall'), x0, x0 + T, 2.25, WALL_H, z0, z0 + T, ns ? 'nsb' : 'ewb');
      let hx = 0, hy = 0;
      if (ns) hy = hallish(tile(x, y + 1)) && tile(x, y + 1) !== 'D' ? 1 : -1;
      else hx = hallish(tile(x + 1, y)) ? 1 : -1;
      const bx = (x + 0.5 + hx * 0.5) * T, bz = (y + 0.5 + hy * 0.5) * T;
      const face = Math.atan2(hy, hx);
      const trim = [];
      const rx = -hy, rz = hx;
      for (const s of [-1, 1]) trim.push(['b', 0.05, 2.28, 0.07, 0, 1.14, s * (T / 2 - 0.035), '#6b4a2a']);
      trim.push(['b', 0.05, 0.07, T, 0, 2.27, 0, '#6b4a2a']);
      const tg = build(trim);
      addStatic(tg, bx, bz, face);
      tg.dispose();
      if (t === 'L') {
        const dm = new THREE.Mesh(new THREE.BoxGeometry(ns ? T : 0.08, 2.25, ns ? 0.08 : T), [
          phongM(TEX.door()), phongM(TEX.door()), phongM(null, 0x4a3218), phongM(null, 0x4a3218), phongM(TEX.door()), phongM(TEX.door()),
        ]);
        dm.position.set(x0 + T / 2, 1.125, z0 + T / 2);
        root.add(dm);
        lv.lockDoors.push({ x, y, mesh: dm });
      }
      const room = def.rooms.find((r) => (r.doors || []).some((d) => d[0] === x && d[1] === y));
      if (room && /계단/.test(room.name)) {
        const sg = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.23), new THREE.MeshBasicMaterial({ map: TEX.exit(), fog: false }));
        sg.position.set(bx + hx * 0.012, 2.62, bz + hy * 0.012);
        sg.rotation.y = Math.atan2(hx, hy);
        root.add(sg);
      } else if (room && room.doors[0][0] === x && room.doors[0][1] === y) {
        const name = room.name.replace('1학년 ', '1-').replace('2학년 ', '2-');
        const tex = signTex(name);
        for (const s of [1, -1]) {
          const sg = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.16), new THREE.MeshPhongMaterial({ map: tex }));
          sg.position.set(bx + hx * 0.24 + rx * (0.75 + s * 0.008), 2.55, bz + hy * 0.24 + rz * (0.75 + s * 0.008));
          sg.rotation.y = Math.atan2(rx * s, rz * s);
          root.add(sg);
        }
        const plate = build([['b', 0.48, 0.18, 0.012, 0, 0, 0, '#d8d4c8']]);
        addStatic(plate, bx + hx * 0.24 + rx * 0.75, bz + hy * 0.24 + rz * 0.75, face, 2.55);
        plate.dispose();
      }
    }

    // 현관 유리문
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      if (G.grid[y][x] !== 'G') continue;
      const cx = (x + 0.5) * T, z = (y + 1) * T;
      const voidM = new THREE.Mesh(new THREE.PlaneGeometry(T, WALL_H), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
      voidM.position.set(cx, WALL_H / 2, z + 0.02); voidM.rotation.y = PI;
      root.add(voidM);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(T - 0.04, 2.4, 0.05), new THREE.MeshPhongMaterial({ color: 0x1a3036, transparent: true, opacity: 0.45, shininess: 80, specular: 0x666666 }));
      glass.position.set(cx, 1.2, z - 0.06);
      root.add(glass);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(T, 2.4), new THREE.MeshBasicMaterial({ color: 0x3cff82, transparent: true, opacity: 0.5, fog: false, side: THREE.DoubleSide }));
      glow.position.set(cx, 1.2, z - 0.01);
      glow.visible = false;
      root.add(glow);
      addParts([['b', 0.06, 2.4, 0.08, x * T + 0.03, 1.2, z - 0.06, '#8f969a'], ['b', T, 0.08, 0.1, cx, 2.44, z - 0.06, '#8f969a']]);
      boxFaces(gk('hall'), x * T, x * T + T, 2.48, WALL_H, z - 0.1, z, 'nb');
      lv.gates.push({ glass, glow });
    }

    // 거울 + 세면대
    const mirrors = [];
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) if (G.grid[y][x] === 'M') mirrors.push({ x, y });
    if (mirrors.length) {
      const xs = mirrors.map((m) => m.x), my = mirrors[0].y;
      const mx0 = Math.min(...xs) * T, mx1 = (Math.max(...xs) + 1) * T;
      const refl = new THREE.Reflector(new THREE.PlaneGeometry(mx1 - mx0 - 0.1, 1.0), {
        clipBias: 0.003, textureWidth: 1024, textureHeight: 256, color: 0x8a9696,
      });
      refl.position.set((mx0 + mx1) / 2, 1.6, my * T - 0.03);
      refl.rotation.y = PI;
      refl.camera.layers.enable(1);
      root.add(refl);
      lv.reflector = refl;
      const parts = [['b', mx1 - mx0, 0.05, 0.04, (mx0 + mx1) / 2, 2.12, my * T - 0.02, '#8b939a'], ['b', mx1 - mx0, 0.05, 0.04, (mx0 + mx1) / 2, 1.08, my * T - 0.02, '#8b939a']];
      for (const m of mirrors) {
        const cx = (m.x + 0.5) * T;
        parts.push(['b', 0.55, 0.12, 0.4, cx, 0.82, my * T - 0.2, '#e8eae8'], ['b', 0.36, 0.03, 0.26, cx, 0.885, my * T - 0.2, '#9aa3a8'],
          ['b', 0.14, 0.76, 0.14, cx, 0.38, my * T - 0.12, '#dcdedc'], ['c', 0.012, 0.012, 0.14, cx, 0.95, my * T - 0.06, '#c8c8c8'], ['b', 0.1, 0.015, 0.015, cx, 1.02, my * T - 0.1, '#c8c8c8']);
      }
      addParts(parts);
      const av = makePerson('하람');
      av.g.traverse((o) => o.layers.set(1));
      root.add(av.g);
      const avG = makePerson('하람', { blackEyes: true, smile: true, mirrored: true });
      avG.g.traverse((o) => o.layers.set(1));
      avG.g.visible = false;
      root.add(avG.g);
      lv.avatar = { normal: av.g, grin: avG.g, x: 0, y: 0, face: 0 };
    }

    // 책상 (인스턴스) — 사람 없는 방에서는 비뚤어진다
    const deskGroups = {};
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      if (G.grid[y][x] !== 'd') continue;
      const r = roomAt(x, y);
      const kind = r ? roomKind(r) : 'class';
      let model = DESK_MODEL[kind] || 'deskset';
      let face = 0;
      if (kind === 'exam') face = PI / 2;
      else if (kind === 'bcast' || kind === 'principal') face = PI / 2;
      else if (kind === 'office') face = (x % 2 === 0) ? PI : 0;
      else if (kind === 'nurse') { model = G.grid[y - 1] && G.grid[y - 1][x] === 'd' ? 'nurse' : 'nurseHead'; face = 0; }
      if (def.id === '1F' && r && r.name === '교장실' && y === 5) { model = 'sofa'; face = 0; }
      (deskGroups[model] || (deskGroups[model] = [])).push({ x, y, face, h: hash(x, y), h2: hash(y, x + 3), cur: 0, tilt: 0 });
    }
    for (const model in deskGroups) {
      const list = deskGroups[model];
      const im = new THREE.InstancedMesh(propGeo(model), vcMat(), list.length);
      im.geometry.__shared = true;
      root.add(im);
      lv.deskSets.push({ im, list });
    }

    // 장식 소품
    for (const [x, y, type, face, flush] of decorFor(def)) {
      if (!PROP_PARTS[type]) continue;
      let px = (x + 0.5) * T, pz = (y + 0.5) * T;
      if (flush) {
        const off = type === 'shelf' || type === 'shoes' ? 0.38 : type === 'ext' ? 0.5 : 0.3;
        px -= Math.cos(face) * off; pz -= Math.sin(face) * off;
      }
      addStatic(propGeo(type), px, pz, face);
    }

    // 칠판, 시계, 방 조명
    for (const r of def.rooms) {
      const kind = roomKind(r);
      if (r.desks && ['class', 'art', 'music', 'lab'].includes(kind)) {
        const bx = (r.x + r.w) * T - 0.025, bz = (r.y + r.h / 2) * T;
        const bw = Math.min(4.4, (r.h - 2) * T);
        const text = r.board || r.name;
        const mN = new THREE.MeshPhongMaterial({ map: boardTex(text, false, 'board:' + text), shininess: 20 });
        const mT = new THREE.MeshPhongMaterial({ map: boardTex('', true, 'boardT') });
        const bm = new THREE.Mesh(new THREE.PlaneGeometry(bw, 1.25), mN);
        bm.position.set(bx, 1.5, bz); bm.rotation.y = -PI / 2;
        root.add(bm);
        lv.boards.push({ mesh: bm, mN, mT, tx: r.x + r.w - 1, ty: Math.floor(r.y + r.h / 2) });
        addParts([['b', 0.08, 0.04, bw, bx - 0.04, 0.86, bz, '#8a6a44']]);
        const ck = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), new THREE.MeshPhongMaterial({ map: TEX.clock() }));
        ck.position.set(bx - 0.01, 2.5, bz); ck.rotation.y = -PI / 2;
        root.add(ck);
      }
      if (r.lit) {
        const L = new THREE.PointLight(B1 ? 0xff4a3a : 0xfff0d8, B1 ? 1.1 : 1.0, B1 ? 30 : 11, 1.4);
        L.position.set((r.x + r.w / 2) * T, 2.7, (r.y + r.h / 2) * T);
        root.add(L);
        lv.lights.push({ L, base: L.intensity });
      }
    }
    if (B1) {
      const L2 = new THREE.PointLight(0xffe8c8, 0.7, 6, 1.6);
      L2.position.set(14.5 * T, 1.8, 12.5 * T);
      root.add(L2);
      lv.circleLight = new THREE.PointLight(0x9a40ff, 0, 8, 1.5);
      lv.circleLight.position.set(15 * TILE * S, 0.6, 18.5 * TILE * S);
      root.add(lv.circleLight);
    }

    // 천장 형광등
    const lampOn = gk('lampOn'), lampOff = gk('lampOff');
    const lampAt = (x, y, on) => {
      const g = on ? lampOn : lampOff;
      boxFaces(g, x * T + 0.45, x * T + 0.75, WALL_H - 0.06, WALL_H, y * T + 0.05, y * T + T - 0.05, 'nsewb');
    };
    if (!B1) {
      if (def.hall) for (let x = def.hall[0] + 1; x < def.hall[0] + def.hall[2]; x += 3) lampAt(x, def.hall[1] + 1, false);
      for (const r of def.rooms) {
        for (let x = r.x + 1; x < r.x + r.w - 1; x += 3) for (let y = r.y + 1; y < r.y + r.h - 1; y += 3) {
          const t = G.grid[y][x];
          if (!wallish(t)) lampAt(x, y, !!r.lit);
        }
      }
    }

    // 바닥 핏자국
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const t = G.grid[y][x];
      if (wallish(t) || t === 'S' || t === 'U' || t === 'G') continue;
      const h = hash(x, y);
      if (h < 0.11) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9 + h * 4, 0.9 + h * 4), new THREE.MeshPhongMaterial({ map: TEX.blood(), transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
        m.rotation.x = -PI / 2; m.rotation.z = h * 50;
        m.position.set((x + 0.5) * T, 0.006 + h * 0.01, (y + 0.5) * T);
        m.visible = false;
        root.add(m);
        lv.decals.push({ m, x, y, k: 0.85 });
      }
    }

    // 머티리얼 + 메시
    const MATS = {
      hall: () => phongM(TEX.hall()), class: () => phongM(TEX.class()), win: () => phongM(TEX.win(false)), winHand: () => phongM(TEX.win(true)),
      winHall: () => phongM(TEX.winHall()), locker: () => phongM(TEX.locker()), rest: () => phongM(TEX.rest(), 0xffffff, 30), conc: () => phongM(TEX.conc()),
      b1: () => phongM(TEX.b1()), fHall: () => phongM(TEX.fHall(), 0xffffff, 40), fClass: () => phongM(TEX.fClass(), 0xffffff, 20),
      fRest: () => phongM(TEX.fRest(), 0xffffff, 40), fConc: () => phongM(TEX.fConc()), fB1: () => phongM(TEX.fB1(), 0xffffff, 30),
      ceil: () => phongM(TEX.ceil()),
      lampOn: () => new THREE.MeshBasicMaterial({ color: 0xfffbe8 }),
      lampOff: () => (lv.lampMat = new THREE.MeshBasicMaterial({ color: 0x2a2a28 })),
    };
    for (const k in geos) {
      if (!geos[k].p.length) continue;
      const mesh = geoMesh(geos[k], MATS[k] ? MATS[k]() : phongM(null, 0x888888));
      root.add(mesh);
    }
    if (statics.length) {
      const merged = THREE.BufferGeometryUtils.mergeBufferGeometries(statics);
      root.add(new THREE.Mesh(merged, vcMat()));
      for (const g of statics) g.dispose();
    }

    // 소음 고리, 분필가루
    lv.rings = [];
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      m.rotation.x = -PI / 2;
      m.visible = false;
      root.add(m);
      lv.rings.push(m);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(300 * 3), 3));
    lv.points = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xebebe1, size: 0.035, transparent: true, opacity: 0.85, depthWrite: false }));
    lv.points.frustumCulled = false;
    root.add(lv.points);

    if (camera.parent !== scene) scene.add(camera);
  }

  function phongM(map, color = 0xffffff, shininess = 6) {
    return new THREE.MeshPhongMaterial({ map: map || null, color, shininess, specular: 0x141414 });
  }

  function addEye(cx, cz, nx, nz, y, tx, ty) {
    const mat = new THREE.MeshBasicMaterial({ map: TEX.eye(), transparent: true, opacity: 0, depthWrite: false });
    const eye = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), mat);
    eye.position.set(cx, y, cz);
    eye.rotation.y = Math.atan2(nx, nz);
    const pm = new THREE.MeshBasicMaterial({ color: 0x8a0000, transparent: true, opacity: 0, depthWrite: false });
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), pm);
    pupil.position.set(0, 0, 0.004);
    eye.add(pupil);
    eye.visible = false;
    lv.root.add(eye);
    lv.eyes.push({ eye, pupil, mat, pm, x: tx + nx, y: ty + nz, nx, nz, seed: hash(tx, ty) * 10 });
  }

  function addWallText(cx, cz, nx, nz, tx, ty) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), new THREE.MeshPhongMaterial({ map: TEX.bloodText(), transparent: true, opacity: 0, depthWrite: false }));
    m.position.set(cx, 1.4, cz);
    m.rotation.y = Math.atan2(nx, nz);
    m.visible = false;
    lv.root.add(m);
    lv.decals.push({ m, x: tx, y: ty, k: 0.9 });
  }

  function buildStairsDown(gk, x, y) {
    const x0 = x * T, z0 = y * T, n = 6, d = T / n;
    const g = gk('conc');
    for (let k = 0; k < n; k++) {
      const top = -(k + 1) * 0.22;
      hface(gk('fConc'), x0, z0 + k * d, x0 + T, z0 + (k + 1) * d, top, true);
      vface(g, x0 + T / 2, z0 + k * d, 0, 1, T, top, top + 0.22);
    }
    boxFaces(g, x0, x0 + T, -2.2, 0, z0, z0 + T, '');
    vface(g, x0 + 0.0001, z0 + T / 2, 1, 0, T, -2.2, 0);
    vface(g, x0 + T - 0.0001, z0 + T / 2, -1, 0, T, -2.2, 0);
    vface(g, x0 + T / 2, z0 + T - 0.0001, 0, -1, T, -2.2, 0);
    hface(gk('fConc'), x0, z0, x0 + T, z0 + T, -1.6, true);
  }

  function buildStairsUp(gk, addParts, x, y) {
    const x0 = x * T, z0 = y * T, n = 5, d = T / n;
    const parts = [];
    for (let k = 0; k < n; k++) parts.push(['b', T, (k + 1) * 0.22, d, x0 + T / 2, (k + 1) * 0.11, z0 + T - (k + 0.5) * d, '#6a6a66']);
    for (let i = 0; i < 9; i++) {
      const h = hash(x * 5 + i, y * 3 + i);
      parts.push(['s', 0.25 + h * 0.3, 0.2 + h * 0.4, 0.25 + h * 0.2, x0 + 0.2 + h * 0.8, 0.6 + i * 0.18, z0 + 0.2 + hash(i, x) * 0.8, '#050505']);
    }
    parts.push(['b', 0.1, 0.08, 1.3, x0 + 0.6, 0.9, z0 + 0.5, '#5a3a22', 0.6, 0.3], ['b', 0.08, 0.1, 1.1, x0 + 0.3, 1.2, z0 + 0.7, '#5a3a22', -0.4, 0, 0.5]);
    addParts(parts);
  }

  // ---------------------------------------------------------
  //  개체 메시
  // ---------------------------------------------------------
  function makeEntity(e) {
    if (e.kind) return makeObject(e);
    if (e.type === 'roll') { const r = makeRoll(); return { g: r.g, mats: r.mats, type: 'roll' }; }
    if (e.type === 'eraser') { const r = makeEraser(); return { g: r.g, mouth: r.mouth, type: 'eraser' }; }
    if (e.type === 'doppel') {
      const p = makePerson('하람', { blackEyes: true, smile: true, mirrored: true, tint: 0xb8c8ff });
      p.mat.transparent = true;
      return { g: p.g, mats: [p.mat], type: 'doppel' };
    }
    if (e.ch === '감독관') { const r = makeProctor(); return { g: r.g, mats: r.mats, face: r.face, type: 'proctor' }; }
    if (e.fake) {
      const a = makePerson(e.ch, { mirrored: true });
      const b = makePerson(e.ch, { mirrored: true, blackEyes: true, smile: true });
      b.g.visible = false;
      const g = new THREE.Group();
      g.add(a.g); g.add(b.g);
      return { g, a: a.g, b: b.g, type: 'fake' };
    }
    const p = makePerson(e.ch, { seated: e.seated, faceless: e.faceless });
    p.mat.transparent = true;
    return { g: p.g, mats: [p.mat], type: 'npc' };
  }

  function wallDir(tx, ty) {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const t = H.tileAt(tx + dx, ty + dy);
      if (t === '.' || t === 'D') return [dx, dy];
    }
    return [0, 1];
  }

  function makeObject(o) {
    const g = new THREE.Group();
    const tx = Math.floor(o.x / TILE), ty = Math.floor(o.y / TILE);
    const res = { g, type: 'obj:' + o.kind };
    switch (o.kind) {
      case 'note': {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.3), new THREE.MeshBasicMaterial({ map: TEX.paper(), color: 0x9a9484 }));
        m.rotation.x = -PI / 2; m.rotation.z = hash(tx, ty) * 6;
        m.position.y = 0.012;
        g.add(m);
        const glint = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.6 }));
        glint.position.y = 0.06;
        g.add(glint);
        res.glint = glint;
        break;
      }
      case 'tag': {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0xbdbdb6 }));
        m.rotation.x = -PI / 2; m.position.y = 0.012;
        g.add(m);
        const dust = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0xd8d8d0, transparent: true, opacity: 0.25, depthWrite: false }));
        dust.rotation.x = -PI / 2; dust.position.y = 0.008;
        g.add(dust);
        break;
      }
      case 'key': {
        const kg = build([
          ['g', new THREE.TorusGeometry(0.035, 0.012, 6, 14), 0, 0, 0, 0, 0, '#d8b440'],
          ['b', 0.12, 0.016, 0.012, 0.09, 0, 0, '#d8b440'], ['b', 0.016, 0.03, 0.012, 0.13, -0.02, 0, '#d8b440'], ['b', 0.016, 0.022, 0.012, 0.1, -0.016, 0, '#d8b440'],
        ]);
        const m = new THREE.Mesh(kg, new THREE.MeshBasicMaterial({ vertexColors: true }));
        g.add(m);
        res.spin = m;
        const nearSink = H.tileAt(tx, ty + 1) === 'M';
        res.baseY = nearSink ? 0.96 : 0.3;
        if (nearSink) g.position.z = -0.25;
        const glint = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff0a0 }));
        glint.position.set(0.05, 0.05, 0);
        m.add(glint);
        break;
      }
      case 'board': {
        const c = photoBoardCanvas();
        drawPhotoBoard(c);
        const tex = new THREE.CanvasTexture(c);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), new THREE.MeshPhongMaterial({ map: tex }));
        let face = -PI / 2;
        let wx = 0, wz = 0;
        if (H.tileAt(tx + 1, ty) === '#') { wx = (tx + 1) * T - 0.02; wz = (ty + 0.5) * T; m.rotation.y = -PI / 2; }
        else { wx = (tx + 0.5) * T; wz = ty * T + 0.02; m.rotation.y = 0; face = PI / 2; }
        m.position.set(wx, 1.55, wz);
        lv.root.add(m);
        lv.photo = { canvas: c, tex, marks: G.marks.size };
        res.static = true;
        res.extra = m;
        break;
      }
      case 'examdesk': {
        const m = new THREE.Mesh(propGeo('exam'), vcMat());
        m.rotation.y = -PI / 2;
        g.add(m);
        const lamp = new THREE.Mesh(build([['c', 0.06, 0.08, 0.02, 0.3, 0.75, 0.25, '#222'], ['c', 0.01, 0.01, 0.35, 0.3, 0.92, 0.25, '#222'], ['c', 0.05, 0.09, 0.08, 0.3, 1.1, 0.18, '#222']]), vcMat());
        lamp.rotation.y = -PI / 2;
        g.add(lamp);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff0c0 }));
        bulb.position.set(-0.18, 1.06, 0.3);
        g.add(bulb);
        break;
      }
      case 'circle': {
        const m = new THREE.Mesh(new THREE.CircleGeometry(1.25, 40), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
        m.rotation.x = -PI / 2; m.position.y = 0.01;
        g.add(m);
        const ring = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.MeshBasicMaterial({ map: TEX.portal(), transparent: true, depthWrite: false, fog: false }));
        ring.rotation.x = -PI / 2; ring.position.y = 0.015;
        g.add(ring);
        res.ring = ring;
        break;
      }
      case 'speaker': {
        const [dx, dy] = wallDir(tx, ty);
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.14), [
          phongM(null, 0x2a2a2c), phongM(null, 0x2a2a2c), phongM(null, 0x2a2a2c), phongM(null, 0x2a2a2c), phongM(TEX.grille()), phongM(null, 0x2a2a2c),
        ]);
        m.rotation.y = Math.atan2(dx, dy);
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0x103018 }));
        led.position.set(0.15, -0.1, 0.075);
        m.add(led);
        m.position.set((tx + 0.5 + dx * 0.5) * T + dx * 0.07, 2.55, (ty + 0.5 + dy * 0.5) * T + dy * 0.07);
        lv.root.add(m);
        res.static = true;
        res.extra = m;
        res.led = led;
        break;
      }
    }
    return res;
  }

  // ---------------------------------------------------------
  //  매 프레임 동기화
  // ---------------------------------------------------------
  const _v = new THREE.Vector3();
  function sync(dt) {
    if (!lv) return;
    time += dt;
    const P = G.player;
    const sh = G.shake > 0 ? G.shake * 0.08 : 0;
    camera.position.set(P.x * S + (Math.random() - 0.5) * sh, P.eye + (P.bob || 0) + (Math.random() - 0.5) * sh, P.y * S + (Math.random() - 0.5) * sh);
    camera.rotation.set(P.pitch || 0, -P.face - PI / 2, P.roll || 0);
    camera.updateMatrixWorld();

    // 손전등
    if (G.def.noFlash) flash.intensity = 0;
    else {
      let k = FLASH;
      if (G.flickT > 0) k *= Math.random() < 0.5 ? 0.15 : 0.7;
      flash.intensity = k;
    }
    if (lv.lampMat) lv.lampMat.color.setHex(G.flickT > 0 && Math.random() < 0.7 ? 0x9a9a90 : 0x2a2a28);
    for (const l of lv.lights) l.L.intensity = l.base * (G.flickT > 0 && Math.random() < 0.3 ? 0.4 : 1);
    if (lv.circleLight) lv.circleLight.intensity = G.flags.examPassed ? 1.2 + Math.sin(time * 3) * 0.3 : 0;

    // 개체
    const live = new Set();
    const handle = (e) => {
      live.add(e);
      let m = tracked.get(e);
      if (!m) {
        m = makeEntity(e);
        tracked.set(e, m);
        if (!m.static) lv.root.add(m.g);
      }
      updateEntity(e, m, dt);
    };
    for (const o of G.objects) handle(o);
    for (const n of G.npcs) handle(n);
    for (const mo of G.monsters) handle(mo);
    for (const [e, m] of tracked) {
      if (!live.has(e)) {
        lv.root.remove(m.g);
        if (m.extra) lv.root.remove(m.extra);
        tracked.delete(e);
      }
    }

    // 잠긴 문 / 현관
    for (const d of lv.lockDoors) d.mesh.visible = G.grid[d.y][d.x] === 'L';
    for (const gt of lv.gates) {
      gt.glass.visible = !G.gateOpen;
      gt.glow.visible = G.gateOpen;
      if (G.gateOpen) gt.glow.material.opacity = 0.35 + Math.sin(time * 6) * 0.2;
    }

    // 뒤틀림
    for (const d of lv.decals) {
      const tw = H.twistAt(d.x, d.y);
      d.m.visible = tw > 0.04;
      d.m.material.opacity = tw * d.k;
    }
    for (const e of lv.eyes) {
      const tw = H.twistAt(e.x, e.y);
      const on = tw > 0.25;
      e.eye.visible = on;
      if (!on) continue;
      const blink = Math.sin(time * 0.7 + e.seed) > 0.96 ? 0.15 : 1;
      e.eye.scale.y = blink;
      e.mat.opacity = e.pm.opacity = Math.min(1, (tw - 0.25) * 2);
      _v.set(P.x * S, P.eye, P.y * S);
      e.eye.worldToLocal(_v);
      const len = Math.hypot(_v.x, _v.y) || 1;
      e.pupil.position.x = clamp(_v.x / Math.max(1, _v.z), -1, 1) * 0.07;
      e.pupil.position.y = clamp(_v.y / Math.max(1, _v.z), -1, 1) * 0.025;
      void len;
    }
    for (const b of lv.boards) {
      const tw = H.twistAt(b.tx, b.ty);
      b.mesh.material = tw > 0.5 ? b.mT : b.mN;
    }
    for (const ds of lv.deskSets) {
      let i = 0;
      for (const d of ds.list) {
        const tw = H.twistAt(d.x, d.y);
        const target = tw > 0.3 ? (d.h - 0.5) * tw * 1.4 : 0;
        const tiltT = tw > 0.5 ? (d.h2 - 0.5) * tw * 0.35 : 0;
        d.cur += (target - d.cur) * Math.min(1, dt * 3);
        d.tilt += (tiltT - d.tilt) * Math.min(1, dt * 3);
        _m4.makeRotationFromEuler(_eu.set(0, -d.face + d.cur, d.tilt, 'YXZ'));
        _m4.setPosition((d.x + 0.5) * T, Math.abs(d.tilt) * 0.12, (d.y + 0.5) * T);
        ds.im.setMatrixAt(i++, _m4);
      }
      ds.im.instanceMatrix.needsUpdate = true;
    }
    if (lv.photo && lv.photo.marks !== G.marks.size) {
      lv.photo.marks = G.marks.size;
      drawPhotoBoard(lv.photo.canvas);
      lv.photo.tex.needsUpdate = true;
    }

    // 거울 속 하람
    if (lv.avatar) {
      const A = lv.avatar;
      if (G.doppel) { A.normal.visible = A.grin.visible = false; }
      else {
        const frozen = G.reflX != null;
        if (!frozen) { A.x = P.x; A.y = P.y; A.face = P.face; }
        else {
          A.x += (P.x - A.x) * Math.min(1, dt * 0.6);
          A.y += (P.y - A.y) * Math.min(1, dt * 0.6);
          let df = P.face - A.face;
          while (df > PI) df -= PI * 2;
          while (df < -PI) df += PI * 2;
          A.face += df * Math.min(1, dt * 0.5);
        }
        const g = frozen && G.gaze > 0.7 ? A.grin : A.normal;
        A.normal.visible = g === A.normal;
        A.grin.visible = g === A.grin;
        g.position.set(A.x * S, 0, A.y * S);
        g.rotation.y = -A.face;
      }
    }

    // 소음 고리
    lv.rings.forEach((m, i) => {
      const r = G.rings[G.rings.length - 1 - i];
      if (!r) { m.visible = false; return; }
      m.visible = true;
      m.position.set(r.x * S, 0.04, r.y * S);
      const s = Math.max(0.05, r.r * S);
      m.scale.set(s, s, 1);
      m.material.opacity = Math.max(0, r.life) * 0.35;
    });
    const pos = lv.points.geometry.attributes.position;
    const arr = pos.array;
    let n = 0;
    for (const p of G.particles) {
      if (n >= 300) break;
      arr[n * 3] = p.x * S; arr[n * 3 + 1] = p.h || 1; arr[n * 3 + 2] = p.y * S;
      n++;
    }
    lv.points.geometry.setDrawRange(0, n);
    pos.needsUpdate = true;
  }

  function updateEntity(e, m, dt) {
    if (m.type.startsWith('obj:')) {
      if (m.static) {
        if (m.led) m.led.material.color.setHex(G.bc && G.bc.active && Math.sin(time * 14) > 0 ? 0x40ff80 : 0x103018);
        return;
      }
      m.g.position.x = e.x * S;
      m.g.position.z = e.y * S + (m.g.userData.dz || 0);
      if (m.spin) {
        m.spin.rotation.y += dt * 1.6;
        m.g.position.y = m.baseY + Math.sin(time * 2) * 0.03;
        if (m.baseY > 0.5) m.g.position.z = e.y * S - 0.25;
      }
      if (m.glint) m.glint.material.opacity = 0.3 + Math.abs(Math.sin(time * 2.2 + e.x)) * 0.6;
      if (m.ring) m.ring.rotation.z = time * 0.4;
      return;
    }
    const g = m.g;
    const px = e.x * S, pz = e.y * S;
    const moved = Math.hypot(px - g.position.x, pz - g.position.z);
    m.walk = (m.walk || 0) + moved * 9;
    switch (m.type) {
      case 'roll': {
        const a = clamp(e.alpha, 0, 1);
        g.visible = a > 0.02;
        for (const mt of m.mats) mt.opacity = a;
        g.position.set(px, Math.sin(time * 1.3) * 0.03, pz);
        g.rotation.y = -e.face;
        g.rotation.z = Math.sin(time * 1.3) * 0.03;
        break;
      }
      case 'eraser': {
        g.position.set(px, 1.25 + Math.sin(time * 2) * 0.05, pz);
        g.rotation.y = -e.face;
        const open = e.state === 'hunt' ? 1 + Math.abs(Math.sin(time * 9)) * 2.2 : 0.6 + Math.abs(Math.sin(time * 3)) * 0.6;
        m.mouth.scale.y = open;
        g.rotation.z = e.state === 'hunt' ? Math.sin(time * 18) * 0.04 : 0;
        break;
      }
      case 'doppel': {
        for (const mt of m.mats) { mt.opacity = clamp(e.alpha, 0, 1); }
        g.position.set(px + (Math.random() < 0.06 ? (Math.random() - 0.5) * 0.08 : 0), 0, pz);
        g.rotation.y = -e.face;
        break;
      }
      case 'proctor': {
        for (const mt of m.mats) mt.opacity = clamp(e.alpha, 0, 1);
        g.visible = e.alpha > 0.02;
        g.position.set(px, 0, pz);
        g.rotation.y = -e.face;
        m.face.rotation.z = Math.sin(time * 0.8) * 0.05;
        break;
      }
      case 'fake': {
        const P = G.player;
        const near = Math.hypot(P.x - e.x, P.y - e.y) < 70;
        m.a.visible = !near; m.b.visible = near;
        const j = Math.random() < 0.08 ? (Math.random() - 0.5) * 0.12 : 0;
        g.position.set(px + j, Math.abs(Math.sin(m.walk)) * 0.03, pz);
        g.rotation.y = -e.face + (Math.random() < 0.03 ? 0.4 : 0);
        break;
      }
      default: {
        for (const mt of m.mats) mt.opacity = clamp(e.alpha ?? 1, 0, 1);
        g.visible = !e.gone && (e.alpha ?? 1) > 0.02;
        let ox = 0, oz = 0;
        if (e.seated) { ox = -Math.cos(e.face) * 0.3; oz = -Math.sin(e.face) * 0.3; }
        g.position.set(px + ox, e.seated ? 0 : Math.abs(Math.sin(m.walk)) * 0.04, pz + oz);
        g.rotation.y = -e.face;
      }
    }
  }

  function render() {
    renderer.render(scene, camera);
  }

  function project(x, y, h) {
    _v.set(x * S, h, y * S).project(camera);
    if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.3 || Math.abs(_v.y) > 1.3) return null;
    return { x: (_v.x + 1) / 2 * VW, y: (1 - _v.y) / 2 * VH };
  }

  // ---------------------------------------------------------
  //  열세 번째 계단 (별도 장면)
  // ---------------------------------------------------------
  const STEP_D = 0.3, STEP_H = 0.18;
  function buildStairScene() {
    const sc = new THREE.Scene();
    sc.fog = new THREE.FogExp2(0x000000, 0.14);
    sc.add(new THREE.AmbientLight(0x404048, 0.14));
    const gc = Geo(), gf = Geo();
    const HW = 0.75;
    hface(gf, -HW, 0, HW, 2.2, 0, true);
    const nosing = [], N = 40, LEN = N * STEP_D + 2;
    for (let k = 0; k < N; k++) {
      const top = -(k + 1) * STEP_H, z0 = -(k + 1) * STEP_D, z1 = -k * STEP_D;
      hface(gf, -HW, z0, HW, z1, top, true);
      nosing.push(['b', HW * 2 - 0.04, 0.012, 0.05, 0, top + 0.006, z0 + 0.03, k === 12 ? '#a02020' : '#b8a040']);
      const num = k + 1;
      if (num <= 13) {
        const tex = canvasTex(64, 32, (x, w, h) => {
          x.fillStyle = num === 13 ? 'rgba(220,30,30,1)' : 'rgba(235,235,225,0.85)';
          x.font = font(24, 'bold'); x.textAlign = 'center';
          x.fillText(String(num), w / 2, 25);
        }, 'stairNum' + num);
        const nm = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        nm.rotation.x = -PI / 2;
        nm.position.set(-HW + 0.2, top + 0.004, (z0 + z1) / 2);
        sc.add(nm);
      }
    }
    sc.add(new THREE.Mesh(build(nosing), vcMat()));
    for (const s of [-1, 1]) {
      const g = gc;
      for (let z = 2.2; z > -LEN; z -= 0.6) {
        const cz = z - 0.3;
        const fy = cz > 0 ? 0 : (cz / STEP_D) * STEP_H;
        vface(g, s * HW, cz, -s, 0, 0.6, fy - 0.4, fy + 3.2);
      }
    }
    const ceilY = (z) => (z > 0 ? 0 : (z / STEP_D) * STEP_H) + 3.0;
    for (let z = 2.2; z > -LEN; z -= 0.6) {
      const ya = ceilY(z), yb = ceilY(z - 0.6);
      quad(gc, [-HW, yb, z - 0.6], [HW, yb, z - 0.6], [HW, ya, z], [-HW, ya, z], [0, -1, 0]);
    }
    vface(gc, 0, 2.2, 0, -1, HW * 2, 0, 3);
    sc.add(geoMesh(gc, phongM(TEX.conc())));
    sc.add(geoMesh(gf, phongM(TEX.fConc(), 0xd8d8d0)));
    for (const s of [-1, 1]) {
      const ang = Math.atan2(STEP_H, STEP_D), rl = (N * STEP_D) / Math.cos(ang);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, rl, 6), phongM(null, 0x555555, 40));
      rail.rotation.x = PI / 2 - ang;
      rail.position.set(s * (HW - 0.06), -(N * STEP_H) / 2 + 0.9, -(N * STEP_D) / 2);
      sc.add(rail);
    }
    const pale = new THREE.MeshBasicMaterial({ color: 0xd9d2c5 });
    const ghost = new THREE.Group();
    ghost.add(new THREE.Mesh(build([['s', 0.12, 0.16, 0.12, 0, 1.75, 0, '#ffffff'], ['c', 0.2, 0.32, 1.6, 0, 0.8, 0, '#151515']]), new THREE.MeshBasicMaterial({ vertexColors: true })));
    for (const z of [-0.25, 0.25]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), pale);
      arm.position.set(0.25, 1.35, z); arm.rotation.z = -1.1;
      ghost.add(arm);
    }
    sc.add(ghost);
    const hands = new THREE.Group();
    const handGeo = build([
      ['b', 0.09, 0.02, 0.1, 0, 0, 0, '#ffffff'],
      ...[-0.033, -0.011, 0.011, 0.033].map((z, i) => ['b', 0.09 + (i === 1 || i === 2 ? 0.02 : 0), 0.014, 0.016, -0.08, 0, z, '#ffffff']),
      ['b', 0.05, 0.014, 0.016, -0.02, 0, 0.065, '#ffffff', -0.7],
    ]);
    const hm = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xd9d2c5, transparent: true });
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(handGeo, hm);
      h.userData.side = s;
      h.rotation.set(0.3, s * 0.6 + PI / 2, s * 0.4);
      hands.add(h);
    }
    st = { scene: sc, ghost, hands, hm };
  }

  function stairsEnter() {
    if (!st) buildStairScene();
    st.scene.add(camera);
    camera.add(st.hands);
  }
  function stairsExit() {
    if (st) camera.remove(st.hands);
    scene.add(camera);
  }

  function renderStairs(S0, yaw, pitch) {
    const p = S0.step + S0.prog;
    const z = 0.4 - p * STEP_D, baseY = p <= 0 ? 0 : -p * STEP_H;
    const sh = G.shake > 0 ? G.shake * 0.06 : 0;
    camera.position.set((Math.random() - 0.5) * sh, baseY + 1.6 + Math.sin(p * PI) * 0.03, z);
    camera.rotation.set(pitch, yaw, 0);
    flash.intensity = G.flickT > 0 ? FLASH * 0.3 : FLASH;
    const near = clamp(S0.step / 13, 0, 1);
    st.ghost.position.set(0.35, baseY - 0.25 + 0.18, z + 1.2);
    st.ghost.rotation.y = PI / 2;
    st.ghost.visible = S0.step > 1;
    for (const h of st.hands.children) {
      const s = h.userData.side;
      h.position.set(s * (0.36 - near * 0.08), -0.16 + near * 0.05, 0.3 - near * 0.62);
    }
    st.hands.visible = S0.step > 2;
    st.hm.opacity = 0.4 + near * 0.6;
    renderer.render(st.scene, camera);
  }

  return { init, resize, buildLevel, sync, render, project, stairsEnter, stairsExit, renderStairs, S };
})();
