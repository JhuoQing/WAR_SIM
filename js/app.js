'use strict';
/* 海峽戰術 v0.3 —— 介面：部署階段 + 戰爭推演畫面 */
const $ = id => document.getElementById(id);
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

// ================= 主題 =================
const THEMES = {
  dark: {
    seaA: '#0a2540', seaB: '#0c1f33', grid: 'rgba(148,163,184,.10)', china: '#2b2724', chinaStroke: 'rgba(239,68,68,.35)', other: '#272b31',
    land: '#3a5a3e', landCap: '#3e5f45', landMtn: '#3d4f3a', landHover: '#4d7556', county: 'rgba(0,0,0,.35)', coast: 'rgba(190,230,200,.55)',
    label: '#e5efe7', labelCap: '#fde68a', labelStroke: 'rgba(0,0,0,.65)', seaLabel: 'rgba(148,197,230,.45)', chinaLabel: 'rgba(239,180,170,.55)',
    neutralLabel: 'rgba(200,200,200,.45)', line: 'rgba(148,163,184,.45)', enemyZone: 'rgba(220,38,38,.42)', chip: '#0f172a', chipText: '#fff',
    beachLabel: '#fdba74', baseLabel: '#ddd6fe', deployGlow: '251,191,36', seaGlow: '34,211,238',
  },
  light: {
    seaA: '#d4e9f7', seaB: '#bcd9ee', grid: 'rgba(30,60,90,.10)', china: '#eadfce', chinaStroke: 'rgba(185,28,28,.45)', other: '#e6e6e6',
    land: '#c3dcaa', landCap: '#cde3b0', landMtn: '#abc68f', landHover: '#ddefc6', county: 'rgba(60,80,50,.35)', coast: 'rgba(40,80,40,.65)',
    label: '#1f2d1f', labelCap: '#92400e', labelStroke: 'rgba(255,255,255,.85)', seaLabel: 'rgba(30,70,110,.5)', chinaLabel: 'rgba(150,40,30,.6)',
    neutralLabel: 'rgba(80,80,80,.5)', line: 'rgba(60,80,100,.55)', enemyZone: 'rgba(220,38,38,.33)', chip: '#ffffff', chipText: '#111',
    beachLabel: '#c2410c', baseLabel: '#6d28d9', deployGlow: '217,119,6', seaGlow: '2,132,199',
  },
};
let TH = THEMES.dark;
function setTheme(name) {
  TH = THEMES[name];
  document.body.classList.toggle('light', name === 'light');
  $('btnTheme').textContent = name === 'light' ? '🌙 深色' : '☀️ 淺色';
  try { localStorage.setItem('warsim_theme', name); } catch {}
}

// ================= 部署狀態 =================
const S = {
  mode: 'deploy', units: [], nextId: 1, ally: 0, difficulty: 'normal', intel: null,
  placing: null, selected: null, tab: 'land', hover: null, timerLeft: 0, timerOn: false,
};
const cost = () => S.units.reduce((s, u) => s + UNIT_TYPES[u.type].cost, 0) + S.ally;
const remaining = () => TOTAL_BUDGET - cost();
const validate = (type, lon, lat, ignore) => checkPlace(S.units, type, lon, lat, ignore);

function rollIntel() {
  const m = DIFFICULTY[S.difficulty].mult;
  const w = { north: 0.3 + Math.random() * 0.4, central: 0.2 + Math.random() * 0.4, south: 0.15 + Math.random() * 0.35 };
  const t = w.north + w.central + w.south;
  for (const k in w) w[k] = Math.round(w[k] / t * 100);
  const j = () => 0.85 + Math.random() * 0.3;
  S.intel = { probs: w, est: { brigades: Math.round(14 * m * j()), fleets: Math.round(9 * m * j()), squadrons: Math.round(22 * m * j()), salvos: Math.round(6 * m * j()) } };
}
function place(type, lon, lat) {
  const T = UNIT_TYPES[type];
  if (remaining() < T.cost) { toast('預算不足'); return null; }
  const v = validate(type, lon, lat);
  if (!v.ok) { toast(v.msg); return null; }
  const u = { id: S.nextId++, type, lon: v.lon, lat: v.lat, zone: v.zone, anchor: v.anchor || null };
  S.units.push(u); ui(); return u;
}
function removeUnit(u) { S.units = S.units.filter(x => x !== u); if (S.selected === u) S.selected = null; ui(); }

// 同一錨點（基地 / 灘頭）的單位錯開顯示
function displayOffset(u, list) {
  if (!u.anchor) return [0, 0];
  const group = list.filter(x => x.anchor === u.anchor && (x.alive !== false));
  const i = group.indexOf(u), n = group.length;
  if (n <= 1) return [0, -17];
  const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.8;
  return [Math.cos(a) * 22, Math.sin(a) * 22];
}

// ================= 部署評估 =================
function evaluate() {
  const U = S.units;
  const covers = (p, types) => U.some(u => types.includes(u.type) && km(u, p) <= UNIT_TYPES[u.type].range);
  const mainZones = Object.keys(ZONES).filter(z => ZONES[z].type !== 'island');
  const westBeaches = BEACHES.filter(b => !['penghu', 'kinmen', 'matsu'].includes(b.zone));
  const fighters = U.filter(u => u.type === 'fighter');
  const groundNear = b => U.some(u => ['inf', 'armor', 'reserve', 'art', 'mlrs'].includes(u.type) && km(u, b) <= 25);
  const r = (n, d) => d ? n / d : 0;
  const capAD = U.filter(u => ['sam_l', 'sam_s'].includes(u.type) && km(u, ZONE_POS.taipei) <= UNIT_TYPES[u.type].range).length;
  return [
    { name: '防空覆蓋（本島防區）', v: r(mainZones.filter(z => covers(ZONE_POS[z], ['sam_l', 'sam_s'])).length, mainZones.length) },
    { name: '首都防空', v: capAD >= 2 ? 1 : capAD ? 0.6 : 0 },
    { name: '灘頭反艦火力覆蓋', v: r(westBeaches.filter(b => covers(b, ['asm', 'mlrs', 'frigate', 'fac', 'sub'])).length, westBeaches.length) },
    { name: '灘頭地面防守', v: r(westBeaches.filter(groundNear).length, westBeaches.length) },
    { name: '海域預警', v: r(SEA_ZONES.filter(s => covers(s, ['radar'])).length, SEA_ZONES.length) },
    { name: '空軍分散度', v: fighters.length ? Math.min(1, new Set(fighters.map(f => f.anchor)).size / Math.min(4, fighters.length + 1)) : 0 },
    { name: '首都地面兵力', v: Math.min(1, U.filter(u => u.zone === 'taipei' && UNIT_TYPES[u.type].cat === 'land').length / 3) },
  ];
}

// ================= 畫布 / 視角 =================
let cv, ctx, CW, CH, DPR;
const V = { s: 1, tx: 0, ty: 0 };
const toS = (lon, lat) => [lon * V.s + V.tx, mercY(lat) * V.s + V.ty];
const fromS = (sx, sy) => ({ lon: (sx - V.tx) / V.s, lat: invMercY((sy - V.ty) / V.s) });
const kmToPx = (kmv, lat) => kmv / (111.32 * Math.cos(lat * DEG)) * V.s;
function makePath(pts) { const p = new Path2D(); pts.forEach(([lon, lat], i) => { const y = mercY(lat); i ? p.lineTo(lon, y) : p.moveTo(lon, y); }); p.closePath(); return p; }
const ZONE_PATH = {}, COUNTY_PATHS = [];
let CHINA_PATH, OTHER_PATH;
function buildPaths() {
  CHINA_PATH = new Path2D(); OTHER_PATH = new Path2D();
  for (const r of CN_RINGS) CHINA_PATH.addPath(makePath(r.pts));
  for (const r of OTHER_RINGS) OTHER_PATH.addPath(makePath(r.pts));
  for (const r of TW_RINGS) { const p = makePath(r.pts); COUNTY_PATHS.push(p); (ZONE_PATH[r.zone] ||= new Path2D()).addPath(p); }
}
function fit() {
  const x0 = 116.3, x1 = 123.4, y0 = mercY(26.9), y1 = mercY(21.6);
  V.s = Math.min(CW / (x1 - x0), CH / (y1 - y0));
  V.tx = (CW - (x1 - x0) * V.s) / 2 - x0 * V.s;
  V.ty = (CH - (y1 - y0) * V.s) / 2 - y0 * V.s;
}
function resize() {
  const rect = $('board').getBoundingClientRect();
  const nw = Math.floor(rect.width), nh = Math.max(520, Math.min(window.innerHeight - 115, 1000));
  const first = !CW, keep = first ? null : fromS(CW / 2, CH / 2);
  CW = nw; CH = nh; DPR = Math.min(2, window.devicePixelRatio || 1);
  cv.width = CW * DPR; cv.height = CH * DPR; cv.style.height = CH + 'px';
  if (first) fit(); else { V.tx = CW / 2 - keep.lon * V.s; V.ty = CH / 2 - mercY(keep.lat) * V.s; }
}
function zoomAt(sx, sy, f) {
  const ns = Math.max(40, Math.min(V.s * f, 4000)), k = ns / V.s;
  V.tx = sx - (sx - V.tx) * k; V.ty = sy - (sy - V.ty) * k; V.s = ns;
}

// ================= 繪圖工具 =================
function chip(x, y, emoji, border, o = {}) {
  const r = o.r || 13;
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
  ctx.fillStyle = o.bg || TH.chip; ctx.fill();
  ctx.lineWidth = o.lw || 2.2; ctx.strokeStyle = border; ctx.stroke();
  ctx.font = `${Math.round(r * 1.15)}px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(emoji, x, y + 1);
  if (o.hp !== undefined) {
    const w = r * 2;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - w / 2, y + r + 2, w, 4);
    ctx.fillStyle = o.hp > 0.6 ? '#22c55e' : o.hp > 0.3 ? '#eab308' : '#ef4444'; ctx.fillRect(x - w / 2, y + r + 2, w * Math.max(0, o.hp), 4);
  }
  if (o.label) {
    ctx.font = 'bold 11px sans-serif'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(o.label).width + 8;
    ctx.fillStyle = o.labelBg || 'rgba(127,29,29,.92)'; ctx.fillRect(x + r - 2, y - r - 2, tw, 15);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(o.label, x + r + 2, y - r + 5.5); ctx.textAlign = 'center';
  }
  if (o.sel) { ctx.beginPath(); ctx.arc(x, y, r + 5, 0, 7); ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2.5; ctx.stroke(); }
  ctx.globalAlpha = 1;
}
const twColor = type => CATS[UNIT_TYPES[type].cat].color;
const ENEMY = '#ef4444';
function textLabel(txt, x, y, color, font) {
  ctx.font = font; ctx.lineWidth = 3; ctx.strokeStyle = TH.labelStroke; ctx.strokeText(txt, x, y); ctx.fillStyle = color; ctx.fillText(txt, x, y);
}

// ================= 主繪圖 =================
function drawBase(t) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const g = ctx.createLinearGradient(0, 0, CW, CH);
  g.addColorStop(0, TH.seaA); g.addColorStop(1, TH.seaB);
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
  const hint = S.mode === 'deploy' && S.placing ? UNIT_TYPES[S.placing].place : null;
  const sim = WAR.sim;

  ctx.setTransform(DPR * V.s, 0, 0, DPR * V.s, DPR * V.tx, DPR * V.ty);
  const px = 1 / V.s;
  ctx.strokeStyle = TH.grid; ctx.lineWidth = px; ctx.beginPath();
  for (let lon = 112; lon <= 127; lon += 0.5) { ctx.moveTo(lon, mercY(31)); ctx.lineTo(lon, mercY(18)); }
  for (let lat = 18; lat <= 31; lat += 0.5) { ctx.moveTo(111, mercY(lat)); ctx.lineTo(128, mercY(lat)); }
  ctx.stroke();
  if (hint === 'sea') {
    ctx.fillStyle = `rgba(${TH.seaGlow},${0.08 + 0.05 * Math.sin(t / 300)})`;
    ctx.beginPath(); ctx.moveTo(113, mercY(18)); ctx.lineTo(127, mercY(32)); ctx.lineTo(130, mercY(32)); ctx.lineTo(130, mercY(17)); ctx.closePath(); ctx.fill();
  }
  ctx.save(); ctx.setLineDash([8 * px, 6 * px]); ctx.strokeStyle = TH.line; ctx.lineWidth = 1.5 * px;
  ctx.beginPath(); ctx.moveTo(113.5, mercY(18.5)); ctx.lineTo(126.5, mercY(31.5)); ctx.stroke(); ctx.restore();
  ctx.fillStyle = TH.other; ctx.fill(OTHER_PATH);
  ctx.fillStyle = TH.china; ctx.fill(CHINA_PATH);
  ctx.strokeStyle = TH.chinaStroke; ctx.lineWidth = 1.2 * px; ctx.stroke(CHINA_PATH);
  for (const z of Object.keys(ZONE_PATH)) {
    let fill = ZONES[z].type === 'capital' ? TH.landCap : ZONES[z].type === 'mountain' ? TH.landMtn : TH.land;
    if (S.hover?.zone === z) fill = TH.landHover;
    ctx.fillStyle = fill; ctx.fill(ZONE_PATH[z]);
    if (sim) {
      const zs = sim.zones[z];
      if (zs.owner === 'PRC') { ctx.fillStyle = TH.enemyZone; ctx.fill(ZONE_PATH[z]); }
      else if (zs.enemy > 0) { ctx.fillStyle = `rgba(249,115,22,${0.25 + 0.2 * Math.sin(t / 180)})`; ctx.fill(ZONE_PATH[z]); }
    }
  }
  if (hint === 'land' || hint === 'coast') {
    ctx.fillStyle = `rgba(${TH.deployGlow},${0.14 + 0.08 * Math.sin(t / 300)})`;
    for (const z of Object.keys(ZONE_PATH)) ctx.fill(ZONE_PATH[z]);
  }
  ctx.strokeStyle = TH.county; ctx.lineWidth = 0.8 * px;
  for (const p of COUNTY_PATHS) ctx.stroke(p);
  ctx.strokeStyle = TH.coast; ctx.lineWidth = 1.2 * px;
  for (const z of Object.keys(ZONE_PATH)) ctx.stroke(ZONE_PATH[z]);

  // ---- 螢幕座標 ----
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const showLabels = $('optLabels').checked;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (showLabels) {
    ctx.font = 'italic 12px sans-serif'; ctx.fillStyle = TH.seaLabel;
    for (const s of SEA_ZONES) { const [x, y] = toS(s.lon, s.lat); ctx.fillText(s.name, x, y); }
    for (const l of MAP_LABELS) { const [x, y] = toS(l.lon, l.lat); ctx.font = l.neutral ? '12px sans-serif' : 'bold 15px sans-serif'; ctx.fillStyle = l.neutral ? TH.neutralLabel : TH.chinaLabel; ctx.fillText(l.name, x, y); }
    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = TH.chinaLabel;
    { const [x, y] = toS(117.3, 25.3); ctx.fillText('中國大陸（攻方）', x, y); }
  }
  for (const e of ENEMY_STAGING) {
    const [x, y] = toS(e.lon, e.lat), r = 14 + 3 * Math.sin(t / 400 + e.lon);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = 'rgba(239,68,68,.22)'; ctx.fill();
    ctx.strokeStyle = 'rgba(239,68,68,.8)'; ctx.lineWidth = 1.5; ctx.stroke();
    if (showLabels) { textLabel(e.name, x, y + 24, '#ef4444', 'bold 11px sans-serif'); textLabel(e.sub, x, y + 37, TH.chinaLabel, '10px sans-serif'); }
  }
  // 射程圈（部署階段，或戰爭中選取的單位）
  if ($('optRanges').checked) {
    const list = sim ? sim.units.filter(u => u.alive) : S.units;
    for (const u of list) {
      const T = UNIT_TYPES[u.type];
      if (!T.range || u.type === 'radar' && S.selected !== u) continue;
      if (sim && !['sam_l', 'sam_s', 'asm'].includes(u.type)) continue;
      const [x, y] = toS(u.lon, u.lat);
      ctx.beginPath(); ctx.arc(x, y, kmToPx(T.range, u.lat), 0, 7);
      ctx.strokeStyle = CATS[T.cat].color + (S.selected === u ? 'cc' : '40'); ctx.lineWidth = S.selected === u ? 2 : 1; ctx.stroke();
      ctx.fillStyle = CATS[T.cat].color + (S.selected === u ? '18' : '08'); ctx.fill();
    }
  }
  if (showLabels) for (const z of Object.keys(ZONES)) {
    const [x, y] = toS(ZONE_POS[z].lon, ZONE_POS[z].lat), cap = ZONES[z].type === 'capital';
    textLabel(ZONES[z].name, x, y, cap ? TH.labelCap : TH.label, 'bold 12px sans-serif');
    if (cap) textLabel('★ 首都', x, y + 13, TH.labelCap, '10px sans-serif');
  }
  const pulseB = hint === 'beach';
  for (const b of BEACHES) {
    const [x, y] = toS(b.lon, b.lat), s = pulseB ? 6.5 + 1.5 * Math.sin(t / 200) : 5;
    ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath();
    ctx.fillStyle = '#f97316'; ctx.fill(); ctx.strokeStyle = '#431407'; ctx.lineWidth = 1; ctx.stroke();
    if (showLabels && (V.s > 260 || pulseB)) { ctx.textAlign = 'right'; textLabel(b.name, x - 9, y, TH.beachLabel, '10px sans-serif'); ctx.textAlign = 'center'; }
  }
  const pulseA = hint === 'airbase';
  for (const a of AIRBASES) {
    const [x, y] = toS(a.lon, a.lat);
    ctx.beginPath(); ctx.arc(x, y, pulseA ? 6.5 + 1.5 * Math.sin(t / 200) : 4.5, 0, 7);
    ctx.fillStyle = '#8b5cf6'; ctx.fill(); ctx.strokeStyle = '#1e1b4b'; ctx.lineWidth = 1.2; ctx.stroke();
    if (sim && sim.airbase[a.id] > 0.15) { ctx.beginPath(); ctx.arc(x, y, 9, 0, 7 * sim.airbase[a.id]); ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; ctx.stroke(); }
    if (showLabels && (V.s > 260 || pulseA)) { ctx.textAlign = 'left'; textLabel(a.name, x + 8, y + 1, TH.baseLabel, '10px sans-serif'); ctx.textAlign = 'center'; }
  }
}

function draw(t) {
  drawBase(t);
  if (S.mode === 'war') drawWar(t);
  else drawDeploy(t);
}
function drawDeploy(t) {
  for (const u of S.units) {
    if (u === drag?.unit && drag.moved) continue;
    const [x, y] = toS(u.lon, u.lat), [dx, dy] = displayOffset(u, S.units);
    chip(x + dx, y + dy, UNIT_TYPES[u.type].emoji, twColor(u.type), { sel: S.selected === u });
  }
  if (S.hover && (S.placing || drag?.unit && drag.moved)) {
    const type = S.placing || drag.unit.type, T = UNIT_TYPES[type];
    const v = validate(type, S.hover.lon, S.hover.lat, drag?.unit);
    const [x, y] = v.ok ? toS(v.lon, v.lat) : [S.hover.sx, S.hover.sy];
    if (T.range && v.ok) {
      ctx.beginPath(); ctx.arc(x, y, kmToPx(T.range, v.lat), 0, 7);
      ctx.strokeStyle = CATS[T.cat].color + '99'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    }
    chip(x, y, T.emoji, v.ok ? twColor(type) : '#ef4444', { alpha: v.ok ? 0.8 : 0.45 });
  }
}

// ================= 戰爭模式 =================
const WAR = { sim: null, deploy: null, speed: 1, paused: false, acc: 0, last: 0, alpha: 0, anims: [], newsIdx: 0, log: [], bannerQ: [], bannerUntil: 0, counting: false, resultShown: false };
const lerpObj = o => o._p ? lerpPos(o._p, o, WAR.alpha) : o;

function startWar() {
  if (!S.units.length) return toast('請先部署部隊');
  S.timerOn = false; S.placing = null; S.selected = null;
  saveQuiet();
  WAR.deploy = JSON.parse(JSON.stringify({ units: S.units, ally: S.ally, difficulty: S.difficulty, intel: S.intel }));
  launchSim();
}
function launchSim() {
  Object.assign(WAR, { sim: createSim(WAR.deploy), paused: false, acc: 0, anims: [], newsIdx: 0, log: [], bannerQ: [], bannerUntil: 0, resultShown: false });
  S.mode = 'war';
  document.body.classList.add('war');
  $('overlay').classList.add('hidden');
  $('modeLabel').textContent = 'WAR_SIM v0.3・戰爭推演';
  $('ticker').classList.add('war'); $('tickerTag').textContent = '新聞快報';
  $('tickerText').textContent = '【快訊】戰爭倒數中……';
  setSpeed(WAR.speed); warUI(); ui();
  WAR.counting = true;
  let n = 3; const el = $('countdown'), num = $('countNum');
  el.classList.remove('hidden'); num.textContent = n;
  const iv = setInterval(() => {
    n--;
    if (n > 0) num.textContent = n;
    else if (n === 0) num.textContent = '開戰';
    else { clearInterval(iv); el.classList.add('hidden'); WAR.counting = false; WAR.last = performance.now(); WAR.acc = 1000; }
  }, 800);
}
function backToDeploy() {
  S.mode = 'deploy'; WAR.sim = null;
  document.body.classList.remove('war');
  $('overlay').classList.add('hidden'); $('banner').classList.add('hidden');
  $('modeLabel').textContent = 'WAR_SIM v0.3・部署階段';
  $('ticker').classList.remove('war'); $('tickerTag').textContent = '情報快訊'; lastTicker = '';
  ui();
}
function setSpeed(sp) {
  WAR.speed = sp;
  document.querySelectorAll('.speed button[data-speed]').forEach(b => b.classList.toggle('active', +b.dataset.speed === sp));
}
function warFrame(t) {
  const dt = Math.min(120, t - (WAR.last || t)); WAR.last = t;
  const sim = WAR.sim;
  if (!WAR.paused && !WAR.counting && !sim.over) {
    WAR.acc += dt * WAR.speed;
    let n = 0;
    while (WAR.acc >= 1000 && n < 4) { WAR.acc -= 1000; doStep(t); n++; }
  }
  WAR.alpha = sim.over ? 1 : Math.min(1, WAR.acc / 1000);
  if (t > WAR.bannerUntil) {
    if (WAR.bannerQ.length) { const b = $('banner'); b.textContent = WAR.bannerQ.shift(); b.classList.remove('hidden'); b.style.animation = 'none'; b.offsetWidth; b.style.animation = ''; WAR.bannerUntil = t + (WAR.speed >= 4 ? 1600 : 2800); }
    else $('banner').classList.add('hidden');
  }
}
function doStep(t) {
  const sim = WAR.sim;
  for (const u of sim.units) u._p = { lon: u.lon, lat: u.lat };
  for (const c of sim.convoys) c._p = { lon: c.lon, lat: c.lat };
  for (const g of sim.groups) g._p = { lon: g.lon, lat: g.lat };
  const evs = stepSim(sim);
  spawnAnims(evs, t);
  pullNews();
  warUI();
  if (sim.over && !WAR.resultShown) { WAR.resultShown = true; setTimeout(showResult, 2200); }
}
function skipToEnd() {
  const sim = WAR.sim; if (!sim || sim.over) return;
  WAR.counting = false; $('countdown').classList.add('hidden');
  while (!sim.over) stepSim(sim);
  for (const u of sim.units) delete u._p; for (const c of sim.convoys) delete c._p;
  WAR.anims = []; WAR.bannerQ = [];
  pullNews(true); warUI();
  if (!WAR.resultShown) { WAR.resultShown = true; showResult(); }
}
const BOOM = { destroyed: '💥', explosion: '💥', sunk: '🔥', landing: '⚓', captured: '🚩', battle: '💥' };
function spawnAnims(evs, t) {
  for (const e of evs) {
    if (e.type === 'salvo') e.shots.forEach((s, i) => {
      WAR.anims.push({ k: 'missile', from: e.from, to: s, t0: t + i * 35, dur: 1100, color: '#ef4444' });
      WAR.anims.push({ k: 'boom', at: s, t0: t + i * 35 + 1000, dur: 650, emoji: s.ok ? '✨' : '💥', size: s.ok ? 12 : 16 });
    });
    else if (e.type === 'shot') {
      const col = { asm: '#fbbf24', mlrs: '#fb923c', frigate: '#22d3ee', fac: '#22d3ee', sub: '#38bdf8', drone: '#a3e635', art: '#fb923c', fighter: '#c4b5fd' }[e.kind] || '#fbbf24';
      WAR.anims.push({ k: 'missile', from: e.from, to: e.to, t0: t, dur: 700, color: col, low: true });
      WAR.anims.push({ k: 'boom', at: e.to, t0: t + 650, dur: 600, emoji: e.ok ? '💥' : '✨', size: e.ok ? 15 : 11 });
    } else if (e.type === 'airstrike') {
      const from = offsetKm(e, -45, 25);
      WAR.anims.push({ k: 'missile', from, to: e, t0: t, dur: 500, color: '#f87171', low: true });
      WAR.anims.push({ k: 'boom', at: e, t0: t + 450, dur: 600, emoji: '💥', size: 14 });
    } else if (BOOM[e.type]) WAR.anims.push({ k: 'boom', at: e, t0: t, dur: e.type === 'battle' ? 700 : 1400, emoji: BOOM[e.type], size: e.type === 'battle' ? 13 : 24 });
  }
  if (WAR.anims.length > 400) WAR.anims.splice(0, WAR.anims.length - 400);
}
function drawAnims(t) {
  WAR.anims = WAR.anims.filter(a => t < a.t0 + a.dur);
  for (const a of WAR.anims) {
    if (t < a.t0) continue;
    const k = (t - a.t0) / a.dur;
    if (a.k === 'missile') {
      const [x0, y0] = toS(a.from.lon, a.from.lat), [x1, y1] = toS(a.to.lon, a.to.lat);
      const h = a.low ? 12 : Math.min(90, Math.hypot(x1 - x0, y1 - y0) * 0.25);
      const P = q => [x0 + (x1 - x0) * q, y0 + (y1 - y0) * q - Math.sin(q * Math.PI) * h];
      ctx.beginPath();
      for (let q = Math.max(0, k - 0.25); q <= k; q += 0.04) { const [x, y] = P(q); q === Math.max(0, k - 0.25) ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.strokeStyle = a.color; ctx.lineWidth = 2; ctx.globalAlpha = 0.85; ctx.stroke();
      const [hx, hy] = P(k); ctx.beginPath(); ctx.arc(hx, hy, 2.6, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      const [x, y] = toS(a.at.lon, a.at.lat);
      ctx.globalAlpha = 1 - k; ctx.font = `${Math.round(a.size * (1 + k * 0.6))}px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(a.emoji, x, y - k * 8); ctx.globalAlpha = 1;
    }
  }
}
function drawWar(t) {
  const sim = WAR.sim;
  // 敵方空軍（示意）
  const nAir = Math.ceil(sim.enemy.airHp / 450);
  for (let i = 0; i < nAir; i++) {
    const a = t / 2600 + i * (Math.PI * 2 / nAir), c = toS(119.7, 24.4);
    chip(c[0] + Math.cos(a) * 55, c[1] + Math.sin(a) * 38, '✈️', ENEMY, { r: 10, lw: 1.6, alpha: 0.85 });
  }
  if (sim.allyState === 'arrived') {
    const [x, y] = toS(122.5, 24.3);
    chip(x, y, '✈️', '#60a5fa', { r: 13, label: '協防空軍', labelBg: 'rgba(30,64,175,.9)' });
    chip(x + 10, y + 34, '🚢', '#60a5fa', { r: 13, label: '協防艦隊', labelBg: 'rgba(30,64,175,.9)' });
  }
  // 我方單位
  for (const u of sim.units) {
    if (!u.alive) continue;
    const p = lerpObj(u), [x, y] = toS(p.lon, p.lat), [dx, dy] = displayOffset(u, sim.units);
    chip(x + dx, y + dy, UNIT_TYPES[u.type].emoji, twColor(u.type), { hp: u.hp / u.maxHp, sel: S.selected === u, r: 12 });
  }
  // 敵方地面部隊
  for (const [z, zs] of Object.entries(sim.zones)) if (zs.enemy > 1) {
    const [x, y] = toS(ZONE_POS[z].lon, ZONE_POS[z].lat);
    chip(x + 18, y + 16, '🪖', ENEMY, { r: 13, label: `${(zs.enemy / 100).toFixed(1)}旅` });
  }
  for (const g of sim.groups) { const p = lerpObj(g), [x, y] = toS(p.lon, p.lat); chip(x, y, '🪖', ENEMY, { r: 11, label: `${(g.hp / 100).toFixed(1)}`, alpha: 0.9 }); }
  // 船團
  for (const c of sim.convoys) {
    if (c.state === 'sail') { const p = lerpObj(c), [x, y] = toS(p.lon, p.lat); chip(x, y, '🚢', ENEMY, { r: 14, label: `${(c.trans / 100).toFixed(1)}旅`, hp: (c.trans + c.esc) / (c.trans0 + c.esc0) }); }
    else if (c.state === 'landed' && c.esc > 5) { const [x, y] = toS(c.lon, c.lat); chip(x, y, '🚢', ENEMY, { r: 10, alpha: 0.85 }); }
  }
  drawAnims(t);
}

// ================= 戰爭面板 / 新聞 =================
function pullNews(silent) {
  const sim = WAR.sim; let changed = false;
  while (WAR.newsIdx < sim.news.length) {
    const n = sim.news[WAR.newsIdx++]; WAR.log.unshift(n); changed = true;
    if (n.level === 'major' && !silent) WAR.bannerQ.push(n.text.replace(/^【快訊】/, ''));
  }
  if (WAR.bannerQ.length > 4) WAR.bannerQ.splice(0, WAR.bannerQ.length - 4);
  if (changed) {
    const el = $('tickerText');
    el.textContent = WAR.log.slice(0, 6).map(n => `${fmtT(n.t)}　${n.text}`).join('　　◆　　');
    el.style.animation = 'none'; el.offsetWidth; el.style.animation = '';
  }
}
function meter(name, v, color) {
  return `<div class="ev"><div class="lab"><span>${name}</span><span style="color:${color}">${Math.round(v)}%</span></div><div class="bar"><div style="width:${v}%;background:${color}"></div></div></div>`;
}
const lvl = v => v >= 60 ? '#22c55e' : v >= 35 ? '#eab308' : '#ef4444';
const ALLY_TEXT = { none: '未請求', pending: '請求中（等待回應）', arrived: '✅ 已抵達參戰', declined: '❌ 未獲回應', cancelled: '❌ 已取消' };
function warUI() {
  const sim = WAR.sim; if (!sim) return;
  $('wClock').textContent = fmtT(sim.t);
  $('wPhase').textContent = phaseName(sim);
  $('btnPause').textContent = WAR.paused ? '▶ 繼續' : '⏸ 暫停';
  $('wMeters').innerHTML = meter('制空權（我方）', sim.air, lvl(sim.air)) + meter('制海權（我方）', sim.sea, lvl(sim.sea))
    + meter('社會韌性', sim.resilience, lvl(sim.resilience)) + meter('攻方作戰意志', sim.will, '#ef4444');
  const aliveN = sim.units.filter(u => u.alive).length;
  const atSea = sim.convoys.reduce((s, c) => s + (c.state === 'sail' ? c.trans : 0), 0) / 100;
  const ashore = (Object.values(sim.zones).reduce((s, z) => s + z.enemy, 0) + sim.groups.reduce((s, g) => s + g.hp, 0)) / 100;
  const lost = Object.keys(sim.zones).filter(z => sim.zones[z].owner === 'PRC').map(z => ZONES[z].name);
  const st = sim.stats;
  $('wForces').innerHTML = `我方部隊：<b>${aliveN}</b> / ${sim.units.length}　失守防區：<b style="color:${lost.length ? '#ef4444' : 'inherit'}">${lost.length ? lost.join('、') : '無'}</b><br>
    敵軍海上：<b>${atSea.toFixed(1)}</b> 旅　已上岸：<b>${ashore.toFixed(1)}</b> 旅<br>
    敵軍損失：地面 <b>${st.enemyLost.toFixed(1)}</b> 旅・艦艇 <b>${st.fleetsLost.toFixed(1)}</b> 編隊・戰機 <b>${st.sqLost.toFixed(1)}</b> 中隊<br>
    飛彈來襲 <b>${st.missiles}</b> 枚，攔截率 <b>${st.missiles ? Math.round(st.intercepted / st.missiles * 100) : 0}%</b><br>
    日美協防：<b>${ALLY_TEXT[sim.allyState]}</b>${sim.allyState === 'pending' ? `（預計 D+${sim.allyDay}）` : ''}`;
  $('wLog').innerHTML = WAR.log.slice(0, 80).map(n => `<div class="${n.level}"><span class="tm">${fmtT(n.t)}</span>${n.text}</div>`).join('');
}
const GRADE_COLOR = { '守方大勝': '#16a34a', '守方勝': '#22c55e', '僵持停火': '#eab308', '守方敗': '#f97316', '守方大敗': '#dc2626' };
function showResult() {
  const sim = WAR.sim, r = sim.result, st = sim.stats;
  const major = sim.news.filter(n => n.level === 'major');
  $('overlayCard').innerHTML = `<div class="muted">戰爭結束・${fmtT(r.t)}</div>
    <h2 style="color:${GRADE_COLOR[r.grade]}">${r.grade}</h2>
    <p><b>${r.reason}</b>${r.outerLost.length ? `<br><span class="muted">離島失守：${r.outerLost.join('、')}</span>` : ''}</p>
    <div class="grid">
      <div>評分：<b>${r.score}</b> / 100</div><div>社會韌性：<b>${Math.round(sim.resilience)}%</b></div>
      <div>敵軍地面損失：<b>${st.enemyLost.toFixed(1)}</b> 旅</div><div>敵軍上岸：<b>${st.landed.toFixed(1)}</b> 旅</div>
      <div>擊沉船團：<b>${st.sunk}</b></div><div>敵艦損失：<b>${st.fleetsLost.toFixed(1)}</b> 編隊</div>
      <div>敵機損失：<b>${st.sqLost.toFixed(1)}</b> 中隊</div><div>飛彈攔截：<b>${st.intercepted}</b> / ${st.missiles}</div>
      <div>我方損失單位：<b>${st.twLost}</b> / ${sim.units.length}</div><div>協防：<b>${ALLY_TEXT[sim.allyState]}</b></div>
    </div>
    <div class="tl">${major.map(n => `<div><span class="tm">${fmtT(n.t)}</span>　${n.text.replace('【快訊】', '')}</div>`).join('')}</div>
    <div class="row" style="margin-top:12px">
      <button class="primary" id="rAgain">🔁 同部署再戰一次</button>
      <button id="rView">查看戰場</button>
      <button id="rBack">返回部署</button>
    </div>
    <p class="muted">同一份部署每次推演會有隨機差異。所有數值為遊戲設定，不代表真實情勢。</p>`;
  $('overlay').classList.remove('hidden');
  $('rAgain').onclick = launchSim;
  $('rView').onclick = () => $('overlay').classList.add('hidden');
  $('rBack').onclick = backToDeploy;
}

// ================= 互動 =================
let drag = null;
function evPos(ev) { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
function hitUnit(sx, sy) {
  const list = S.mode === 'war' ? WAR.sim.units.filter(u => u.alive) : S.units;
  let best = null, bd = 15 * 15;
  for (const u of list) {
    const p = S.mode === 'war' ? lerpObj(u) : u;
    const [x, y] = toS(p.lon, p.lat), [dx, dy] = displayOffset(u, list);
    const d = (x + dx - sx) ** 2 + (y + dy - sy) ** 2; if (d < bd) { bd = d; best = u; }
  }
  return best;
}
function setHover(sx, sy) { const p = fromS(sx, sy); S.hover = { ...p, sx, sy, zone: zoneAt(p.lon, p.lat), unit: hitUnit(sx, sy) }; tooltip(); }
function onDown(ev) {
  if (ev.button !== 0) return;
  const [sx, sy] = evPos(ev);
  drag = { sx, sy, tx: V.tx, ty: V.ty, unit: S.mode === 'deploy' && !S.placing ? hitUnit(sx, sy) : null, moved: false };
}
function onMove(ev) {
  const [sx, sy] = evPos(ev);
  if (drag) {
    if (Math.hypot(sx - drag.sx, sy - drag.sy) > 4) drag.moved = true;
    if (drag.moved && !drag.unit) { V.tx = drag.tx + sx - drag.sx; V.ty = drag.ty + sy - drag.sy; }
  }
  setHover(sx, sy);
}
function onUp(ev) {
  if (!drag) return;
  const [sx, sy] = evPos(ev), d = drag; drag = null;
  if (!d.moved) return onClick(sx, sy);
  if (d.unit) {
    const p = fromS(sx, sy), v = validate(d.unit.type, p.lon, p.lat, d.unit);
    if (v.ok) Object.assign(d.unit, { lon: v.lon, lat: v.lat, zone: v.zone, anchor: v.anchor || null }); else toast(v.msg);
    S.selected = d.unit; ui();
  }
}
function onClick(sx, sy) {
  if (S.mode === 'war') { S.selected = hitUnit(sx, sy); return; }
  const p = fromS(sx, sy);
  if (S.placing) { place(S.placing, p.lon, p.lat); return; }
  S.selected = hitUnit(sx, sy); ui();
}
function cancel() { S.placing = null; S.selected = null; ui(); }

function tooltip() {
  const tt = $('tooltip'), h = S.hover;
  if (!h || drag?.moved) { tt.classList.add('hidden'); return; }
  const sim = S.mode === 'war' ? WAR.sim : null;
  let html = '';
  if (h.unit) {
    const u = h.unit, T = UNIT_TYPES[u.type];
    const where = u.anchor ? (AIRBASES.find(a => a.id === u.anchor) || BEACHES.find(b => b.id === u.anchor))?.name : (u.zone ? ZONES[u.zone].name : u.move ? '移動中' : '海上');
    html = `<b style="color:${CATS[T.cat].color}">${T.emoji} ${T.name}</b>　<span style="color:var(--accent)">${T.cost}</span><br>位置：${where}`
      + (sim ? `<br>戰力：${Math.round(u.hp / u.maxHp * 100)}%${u.ammo ? `　攔截彈 ${u.ammo}` : ''}` : `<br>攻 ${T.atk}　防 ${T.def}　兵力 ${T.hp}${T.range ? `　射程 ${T.range} km` : ''}<br><span class="muted">${T.desc}</span><br><span class="muted">拖曳移動・右鍵撤回</span>`);
  } else if (h.zone) {
    const Z = ZONES[h.zone], ZT = ZONE_TYPES[Z.type];
    const list = sim ? sim.units.filter(u => u.alive && u.zone === h.zone) : S.units.filter(u => u.zone === h.zone);
    const cnt = {}; list.forEach(u => cnt[UNIT_TYPES[u.type].emoji + UNIT_TYPES[u.type].name] = (cnt[UNIT_TYPES[u.type].emoji + UNIT_TYPES[u.type].name] || 0) + 1);
    html = `<b>${Z.name}</b>（${countyAt(h.lon, h.lat)}）<br>地形：${ZT.name}${ZT.def ? `（防禦 +${ZT.def}）` : ''}`;
    if (sim) {
      const zs = sim.zones[h.zone];
      html += `<br>控制：<b style="color:${zs.owner === 'PRC' ? '#ef4444' : '#22c55e'}">${zs.owner === 'PRC' ? '敵方佔領' : zs.enemy > 0 ? '交戰中' : '我方'}</b>　在地守備 ${Math.round(zs.gar / zs.gar0 * 100)}%`
        + (zs.enemy > 0 ? `<br>敵軍：${(zs.enemy / 100).toFixed(1)} 旅` : '');
    } else html += `<br>灘頭：${BEACHES.filter(b => b.zone === h.zone).map(b => b.name).join('、') || '無'}`;
    html += `<br>駐軍：${Object.entries(cnt).map(([k, v]) => `${k}×${v}`).join('、') || '無'}`;
  } else if (inChina(h.lon, h.lat)) html = '<b style="color:#ef4444">中國大陸</b>（攻方）';
  else if (inRings(OTHER_RINGS, h.lon, h.lat)) html = '第三國領土（中立）';
  else html = TW_WATERS(h.lon, h.lat) ? '我方海域' : '海峽西側（敵方海域）';
  tt.innerHTML = html; tt.classList.remove('hidden');
  tt.style.left = Math.min(h.sx + 16, CW - 270) + 'px'; tt.style.top = Math.min(h.sy + 14, CH - 130) + 'px';
}
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 1800); }

// ================= 部署側邊欄 =================
function ui() {
  if (S.mode !== 'deploy') return;
  const rem = remaining();
  $('budgetText').textContent = `剩餘 ${rem} / ${TOTAL_BUDGET}`;
  const byCat = { land: 0, sea: 0, air: 0, ad: 0 };
  for (const u of S.units) byCat[UNIT_TYPES[u.type].cat] += UNIT_TYPES[u.type].cost;
  const parts = [...Object.entries(byCat).map(([k, v]) => [CATS[k].name, v, CATS[k].color]), ['協防預備金', S.ally, '#60a5fa']];
  $('budgetBar').innerHTML = parts.map(([, v, c]) => `<div style="width:${v / TOTAL_BUDGET * 100}%;background:${c}"></div>`).join('');
  $('budgetLegend').innerHTML = parts.map(([n, v, c]) => `<span><i style="background:${c}"></i>${n} ${v}</span>`).join('');
  $('tabs').innerHTML = Object.entries(CATS).map(([k, c]) => `<button data-tab="${k}" class="${S.tab === k ? 'active' : ''}">${c.name}</button>`).join('');
  $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; ui(); });
  $('shop').innerHTML = Object.entries(UNIT_TYPES).filter(([, T]) => T.cat === S.tab).map(([k, T]) => {
    const n = S.units.filter(u => u.type === k).length;
    return `<button class="item ${S.placing === k ? 'active' : ''}" data-type="${k}" ${rem < T.cost ? 'disabled' : ''}>
      <span class="ic" style="border-color:${CATS[T.cat].color}">${T.emoji}</span>
      <span class="nm">${T.name}${n ? ` <span class="ct">×${n}</span>` : ''}<small>${T.desc}</small></span>
      <span class="cs">${T.cost}</span></button>`;
  }).join('');
  $('shop').querySelectorAll('.item').forEach(b => b.onclick = () => { S.placing = S.placing === b.dataset.type ? null : b.dataset.type; S.selected = null; ui(); });
  $('ally').innerHTML = ALLY_LEVELS.map(a => `<label class="ally ${S.ally === a.amount ? 'active' : ''}" data-amt="${a.amount}"><span class="amt">${a.amount}</span><b>${a.name}</b><small>${a.desc}</small></label>`).join('');
  $('ally').querySelectorAll('.ally').forEach(el => el.onclick = () => {
    const amt = +el.dataset.amt;
    if (amt - S.ally > remaining()) return toast('預算不足，請先撤回部分部隊');
    S.ally = amt; ui();
  });
  $('eval').innerHTML = evaluate().map(e => meter(e.name, e.v * 100, lvl(e.v * 100))).join('');
  const I = S.intel;
  $('intel').innerHTML = `兩棲／空降旅　約 <b>${I.est.brigades}</b><br>水面艦艇編隊　約 <b>${I.est.fleets}</b><br>戰機中隊　約 <b>${I.est.squadrons}</b><br>飛彈攻擊　約 <b>${I.est.salvos}</b> 波<br>
    研判登陸方向：北部 <b>${I.probs.north}%</b>・中部 <b>${I.probs.central}%</b>・南部 <b>${I.probs.south}%</b><br><span class="muted">情報估計誤差約 ±15%；敵方會依你的部署弱點調整登陸地點。</span>`;
  cv.style.cursor = S.placing ? 'crosshair' : 'default';
  $('deployTimer').textContent = S.timerOn ? `部署剩餘 ${Math.floor(S.timerLeft / 60)}:${String(S.timerLeft % 60).padStart(2, '0')}` : '';
  updateTicker();
}
let lastTicker = '';
function updateTicker() {
  const I = S.intel, top = Object.entries(I.probs).sort((a, b) => b[1] - a[1])[0];
  const text = [
    `【情報】對岸沿海港口船艦活動明顯增加，研判集結兩棲部隊約 ${I.est.brigades} 個旅`,
    `【國防】國防預算總額 ${TOTAL_BUDGET} 點，完成陸海空部署後按下「戰爭開始」`,
    `【情報】研判主要威脅方向為${REGION_NAME[top[0]]}沿海（${top[1]}%）`,
    '【外交】日美協防為不確定因素：預備金越多、撐得越久，獲得支援的機會越高',
    '【提醒】本遊戲為虛構推演，數值不代表真實戰力',
  ].join('　　　◆　　　');
  if (text !== lastTicker) { $('tickerText').textContent = text; lastTicker = text; }
}

// ================= 存檔 =================
const SAVE_KEY = 'warsim_v02';
function saveQuiet() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ units: S.units, ally: S.ally, difficulty: S.difficulty, intel: S.intel })); return true; } catch { return false; } }
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!d) return toast('沒有存檔');
    Object.assign(S, { units: d.units, ally: d.ally, difficulty: d.difficulty, intel: d.intel, selected: null, placing: null });
    S.nextId = Math.max(0, ...S.units.map(u => u.id)) + 1;
    $('selDiff').value = S.difficulty; toast('已載入部署'); ui();
  } catch { toast('讀取存檔失敗'); }
}
function tick() {
  if (!S.timerOn || S.mode !== 'deploy') return;
  S.timerLeft--;
  if (S.timerLeft <= 0) { S.timerOn = false; toast('部署時間到！'); if (S.units.length) startWar(); }
  ui();
}

// ================= 初始化 =================
function frame(t) {
  if (S.mode === 'war' && WAR.sim) warFrame(t);
  draw(t);
  requestAnimationFrame(frame);
}
function init() {
  cv = $('cv'); ctx = cv.getContext('2d');
  buildPaths(); rollIntel();
  let theme = 'dark'; try { theme = localStorage.getItem('warsim_theme') || 'dark'; } catch {}
  setTheme(theme);
  $('btnTheme').onclick = () => setTheme(document.body.classList.contains('light') ? 'dark' : 'light');
  $('mapSource').textContent = MD.source;
  $('selDiff').innerHTML = Object.entries(DIFFICULTY).map(([k, d]) => `<option value="${k}">${d.name}</option>`).join('');
  $('selDiff').value = S.difficulty;
  $('selDiff').onchange = e => { S.difficulty = e.target.value; rollIntel(); ui(); };
  $('selTimer').onchange = e => { const v = +e.target.value; S.timerOn = v > 0; S.timerLeft = v; ui(); };
  resize(); window.addEventListener('resize', resize);
  cv.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', ev => { if (drag || ev.target === cv) onMove(ev); });
  window.addEventListener('mouseup', onUp);
  cv.addEventListener('mouseleave', () => { if (!drag) { S.hover = null; tooltip(); } });
  cv.addEventListener('wheel', ev => { ev.preventDefault(); const [sx, sy] = evPos(ev); zoomAt(sx, sy, ev.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
  cv.addEventListener('contextmenu', ev => {
    ev.preventDefault(); if (S.mode !== 'deploy') return;
    const [sx, sy] = evPos(ev), u = hitUnit(sx, sy);
    if (u) { removeUnit(u); toast(`已撤回 ${UNIT_TYPES[u.type].name}（退款 ${UNIT_TYPES[u.type].cost}）`); } else cancel();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') cancel();
    if (S.mode === 'deploy' && (e.key === 'Delete' || e.key === 'Backspace') && S.selected && e.target === document.body) removeUnit(S.selected);
    if (S.mode === 'war' && e.key === ' ') { e.preventDefault(); WAR.paused = !WAR.paused; warUI(); }
  });
  $('zIn').onclick = () => zoomAt(CW / 2, CH / 2, 1.3);
  $('zOut').onclick = () => zoomAt(CW / 2, CH / 2, 1 / 1.3);
  $('zReset').onclick = fit;
  $('btnAuto').onclick = () => { S.units = recommendedDeploy(TOTAL_BUDGET - S.ally); S.nextId = S.units.length + 1; S.selected = null; ui(); toast('已套用推薦部署，可再自行調整'); };
  $('btnClear').onclick = () => { S.units = []; S.selected = null; ui(); };
  $('btnSave').onclick = () => toast(saveQuiet() ? '已儲存部署' : '此瀏覽器無法儲存');
  $('btnLoad').onclick = load;
  $('btnWar').onclick = startWar;
  $('btnPause').onclick = () => { WAR.paused = !WAR.paused; warUI(); };
  document.querySelectorAll('.speed button[data-speed]').forEach(b => b.onclick = () => setSpeed(+b.dataset.speed));
  $('btnSkip').onclick = skipToEnd;
  setInterval(tick, 1000);
  ui();
  requestAnimationFrame(frame);
}
init();
