'use strict';
/* 海峽戰術 v0.2 —— 真實地圖部署階段 */
const MD = window.MAP_DATA;
const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;

// ================= 地理工具 =================
const mercY = lat => -Math.log(Math.tan(Math.PI / 4 + lat * DEG / 2)) / DEG;   // 北方為負
const invMercY = y => (2 * Math.atan(Math.exp(-y * DEG)) - Math.PI / 2) / DEG;
function km(a, b) {
  const dx = (a.lon - b.lon) * 111.32 * Math.cos((a.lat + b.lat) / 2 * DEG), dy = (a.lat - b.lat) * 110.57;
  return Math.hypot(dx, dy);
}
const offsetKm = (p, dx, dy) => ({ lon: p.lon + dx / (111.32 * Math.cos(p.lat * DEG)), lat: p.lat + dy / 110.57 });

function toRings(flat) { const pts = []; for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]); return pts; }
function bboxOf(pts) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const [x, y] of pts) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return [a, b, c, d]; }
const TW_RINGS = [], CN_RINGS = [];
for (const c of MD.counties) for (const r of c.rings) { const pts = toRings(r); TW_RINGS.push({ zone: c.zone, county: c.name, pts, bb: bboxOf(pts) }); }
for (const r of MD.china) { const pts = toRings(r); CN_RINGS.push({ pts, bb: bboxOf(pts) }); }

function pip(pts, lon, lat) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inRings = (rings, lon, lat) => rings.find(r => lon >= r.bb[0] && lon <= r.bb[2] && lat >= r.bb[1] && lat <= r.bb[3] && pip(r.pts, lon, lat));
const zoneAt = (lon, lat) => inRings(TW_RINGS, lon, lat)?.zone || null;
const countyAt = (lon, lat) => inRings(TW_RINGS, lon, lat)?.county || null;
const inChina = (lon, lat) => !!inRings(CN_RINGS, lon, lat);
const isLand = (lon, lat) => !!zoneAt(lon, lat) || inChina(lon, lat);
function isCoastal(p) {
  for (let a = 0; a < 16; a++) for (const d of [5, 10, 15]) {
    const q = offsetKm(p, d * Math.cos(a * Math.PI / 8), d * Math.sin(a * Math.PI / 8));
    if (!isLand(q.lon, q.lat)) return true;
  }
  return false;
}

// 防區中心與灘頭吸附
const ZONE_POS = {};
for (const z of Object.keys(ZONES)) { const p = ZONE_LABEL_POS[z] || MD.centroids[z]; ZONE_POS[z] = { lon: p[0], lat: p[1] }; }
for (const b of BEACHES) {
  let best = null, bd = 1e9;
  for (const r of TW_RINGS) if (r.zone === b.zone) for (const [lon, lat] of r.pts) {
    const d = km(b, { lon, lat }); if (d < bd) { bd = d; best = { lon, lat }; }
  }
  if (best) { b.lon = best.lon; b.lat = best.lat; }
}

// ================= 狀態 =================
const S = {
  units: [], nextId: 1, ally: 0, difficulty: 'normal', intel: null,
  placing: null, selected: null, tab: 'land', hover: null, timerLeft: 0, timerOn: false,
};
const cost = () => S.units.reduce((s, u) => s + UNIT_TYPES[u.type].cost, 0) + S.ally;
const remaining = () => TOTAL_BUDGET - cost();

function rollIntel() {
  const m = DIFFICULTY[S.difficulty].mult;
  const w = { north: 0.3 + Math.random() * 0.4, central: 0.2 + Math.random() * 0.4, south: 0.15 + Math.random() * 0.35 };
  const t = w.north + w.central + w.south;
  for (const k in w) w[k] = Math.round(w[k] / t * 100);
  const j = () => 0.85 + Math.random() * 0.3;
  S.intel = {
    probs: w,
    est: {
      brigades: Math.round(14 * m * j()), fleets: Math.round(9 * m * j()),
      squadrons: Math.round(22 * m * j()), salvos: Math.round(6 * m * j()),
    },
  };
}

// ================= 部署規則 =================
function validate(type, lon, lat, ignore) {
  const T = UNIT_TYPES[type];
  const others = S.units.filter(u => u !== ignore);
  switch (T.place) {
    case 'land': {
      const z = zoneAt(lon, lat);
      return z ? { ok: true, lon, lat, zone: z } : { ok: false, msg: `${T.name}只能部署在台灣（含離島）陸地上` };
    }
    case 'coast': {
      const z = zoneAt(lon, lat);
      if (!z) return { ok: false, msg: `${T.name}只能部署在陸地上` };
      return isCoastal({ lon, lat }) ? { ok: true, lon, lat, zone: z } : { ok: false, msg: `${T.name}須部署在離海岸 15 km 內` };
    }
    case 'sea': {
      if (isLand(lon, lat)) return { ok: false, msg: '艦艇只能部署在海上' };
      if (!TW_WATERS(lon, lat)) return { ok: false, msg: '只能部署在我方海域界線（虛線）以東' };
      return { ok: true, lon, lat, zone: null };
    }
    case 'airbase': {
      const p = { lon, lat };
      const ab = AIRBASES.map(a => ({ a, d: km(a, p) })).sort((x, y) => x.d - y.d)[0];
      if (ab.d > 30) return { ok: false, msg: '戰機只能部署在空軍基地（紫色圓點）' };
      if (others.filter(u => u.anchor === ab.a.id).length >= AIRBASE_CAP) return { ok: false, msg: `${ab.a.name}已滿（最多 ${AIRBASE_CAP} 個中隊）` };
      return { ok: true, lon: ab.a.lon, lat: ab.a.lat, zone: zoneAt(ab.a.lon, ab.a.lat), anchor: ab.a.id };
    }
    case 'beach': {
      const p = { lon, lat };
      const bb = BEACHES.map(b => ({ b, d: km(b, p) })).sort((x, y) => x.d - y.d)[0];
      if (bb.d > 30) return { ok: false, msg: '水雷只能佈在灘頭（橘色菱形）外海' };
      if (others.filter(u => u.anchor === bb.b.id).length >= MINES_PER_BEACH) return { ok: false, msg: `${bb.b.name}灘頭水雷已達上限` };
      return { ok: true, lon: bb.b.lon, lat: bb.b.lat, zone: bb.b.zone, anchor: bb.b.id };
    }
  }
  return { ok: false, msg: '無法部署' };
}
function place(type, lon, lat, silent) {
  const T = UNIT_TYPES[type];
  if (remaining() < T.cost) { if (!silent) toast('預算不足'); return null; }
  const v = validate(type, lon, lat);
  if (!v.ok) { if (!silent) toast(v.msg); return null; }
  const u = { id: S.nextId++, type, lon: v.lon, lat: v.lat, zone: v.zone, anchor: v.anchor || null };
  S.units.push(u);
  ui(); return u;
}
function removeUnit(u) { S.units = S.units.filter(x => x !== u); if (S.selected === u) S.selected = null; ui(); }

// 同一錨點（基地 / 灘頭）的單位顯示時錯開
function displayPos(u) {
  if (!u.anchor) return { lon: u.lon, lat: u.lat, dx: 0, dy: 0 };
  const group = S.units.filter(x => x.anchor === u.anchor);
  const i = group.indexOf(u), n = group.length;
  if (n === 1) return { lon: u.lon, lat: u.lat, dx: 0, dy: -16 };
  const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.75;
  return { lon: u.lon, lat: u.lat, dx: Math.cos(a) * 20, dy: Math.sin(a) * 20 };
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
  return [
    { name: '防空覆蓋（本島防區）', v: r(mainZones.filter(z => covers(ZONE_POS[z], ['sam_l', 'sam_s'])).length, mainZones.length) },
    { name: '首都防空', v: covers(ZONE_POS.taipei, ['sam_l', 'sam_s']) ? (U.filter(u => ['sam_l', 'sam_s'].includes(u.type) && km(u, ZONE_POS.taipei) <= UNIT_TYPES[u.type].range).length >= 2 ? 1 : 0.6) : 0 },
    { name: '灘頭反艦火力覆蓋', v: r(westBeaches.filter(b => covers(b, ['asm', 'mlrs', 'frigate', 'fac', 'sub'])).length, westBeaches.length) },
    { name: '灘頭地面防守', v: r(westBeaches.filter(groundNear).length, westBeaches.length) },
    { name: '海域預警', v: r(SEA_ZONES.filter(s => covers(s, ['radar'])).length, SEA_ZONES.length) },
    { name: '空軍分散度', v: fighters.length ? Math.min(1, new Set(fighters.map(f => f.anchor)).size / Math.min(4, fighters.length + 1)) : 0 },
    { name: '首都地面兵力', v: Math.min(1, U.filter(u => u.zone === 'taipei' && UNIT_TYPES[u.type].cat === 'land').length / 3) },
  ];
}

// ================= 推薦部署 =================
function towards(a, b, k) { const d = km(a, b) || 1; return offsetKm(a, (b.lon - a.lon) * 111.32 * Math.cos(a.lat * DEG) / d * k, (b.lat - a.lat) * 110.57 / d * k); }
function tryAt(type, pts) { for (const p of pts) { const u = place(type, p.lon, p.lat, true); if (u) return u; } return null; }
const beach = id => BEACHES.find(b => b.id === id);
function autoDeploy() {
  S.units = []; S.selected = null;
  const inland = (bid, k) => { const b = beach(bid); return [towards(b, ZONE_POS[b.zone], k), towards(b, ZONE_POS[b.zone], k + 4), ZONE_POS[b.zone]]; };
  const seaward = (bid, k) => { const b = beach(bid); return [towards(b, ZONE_POS[b.zone], -k), towards(b, ZONE_POS[b.zone], -k - 10)]; };
  const ab = id => { const a = AIRBASES.find(x => x.id === id); return [a]; };
  const plan = [
    ['sam_l', [ZONE_POS.taipei]], ['sam_l', [ZONE_POS.taichung]], ['radar', inland('tamsui', 4)], ['radar', inland('anping', 4)],
    ['asm', inland('guanyin', 4)], ['asm', inland('tcport', 4)], ['asm', inland('anping', 4)],
    ['fighter', ab('ab_taichung')], ['fighter', ab('ab_hualien')],
    ['inf', inland('tamsui', 6)], ['inf', inland('guanyin', 6)], ['inf', inland('tcport', 7)], ['inf', inland('anping', 6)],
    ['armor', inland('guanyin', 18)], ['sam_s', inland('linyuan', 8)], ['sam_s', [ZONE_POS.tainan]],
    ['mine', [beach('guanyin')]], ['mine', [beach('tamsui')]], ['fac', seaward('tcport', 14)], ['fac', seaward('budai', 14)],
    ['reserve', [ZONE_POS.taipei]], ['reserve', [ZONE_POS.kaohsiung]], ['inf', [ZONE_POS.penghu]],
  ];
  for (const [t, pts] of plan) tryAt(t, pts);
  ui();
}

// ================= 畫面 =================
let cv, ctx, W, H, DPR;
const V = { s: 1, tx: 0, ty: 0 };
const toS = (lon, lat) => [lon * V.s + V.tx, mercY(lat) * V.s + V.ty];
const fromS = (sx, sy) => ({ lon: (sx - V.tx) / V.s, lat: invMercY((sy - V.ty) / V.s) });
const kmToPx = (kmv, lat) => kmv / (111.32 * Math.cos(lat * DEG)) * V.s;

function makePath(pts) { const p = new Path2D(); pts.forEach(([lon, lat], i) => { const y = mercY(lat); i ? p.lineTo(lon, y) : p.moveTo(lon, y); }); p.closePath(); return p; }
const ZONE_PATH = {}, COUNTY_PATHS = [];
let CHINA_PATH;
function buildPaths() {
  CHINA_PATH = new Path2D();
  for (const r of CN_RINGS) CHINA_PATH.addPath(makePath(r.pts));
  for (const r of TW_RINGS) {
    const p = makePath(r.pts); COUNTY_PATHS.push(p);
    (ZONE_PATH[r.zone] ||= new Path2D()).addPath(p);
  }
}
function fit() {
  const x0 = 117.7, x1 = 122.9, y0 = mercY(26.45), y1 = mercY(21.75);
  V.s = Math.min(W / (x1 - x0), H / (y1 - y0));
  V.tx = (W - (x1 - x0) * V.s) / 2 - x0 * V.s;
  V.ty = (H - (y1 - y0) * V.s) / 2 - y0 * V.s;
}
function resize() {
  const rect = $('board').getBoundingClientRect();
  const nw = Math.floor(rect.width), nh = Math.max(520, Math.min(window.innerHeight - 115, 1000));
  const first = !W;
  const keep = !first ? fromS(W / 2, H / 2) : null;
  W = nw; H = nh; DPR = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * DPR; cv.height = H * DPR; cv.style.height = H + 'px';
  if (first) fit();
  else { const [cx, cy] = [keep.lon * V.s, mercY(keep.lat) * V.s]; V.tx = W / 2 - cx; V.ty = H / 2 - cy; }
}
function zoomAt(sx, sy, f) {
  const ns = Math.max(60, Math.min(V.s * f, 4000));
  const k = ns / V.s;
  V.tx = sx - (sx - V.tx) * k; V.ty = sy - (sy - V.ty) * k; V.s = ns;
}

function placeValidHint(type) {
  return type ? UNIT_TYPES[type].place : null;
}

function draw(t) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0a2540'); g.addColorStop(1, '#0c1f33');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  const hint = placeValidHint(S.placing);
  // ---- 地理座標層 ----
  ctx.setTransform(DPR * V.s, 0, 0, DPR * V.s, DPR * V.tx, DPR * V.ty);
  const px = 1 / V.s;
  // 經緯網
  ctx.strokeStyle = 'rgba(148,163,184,.10)'; ctx.lineWidth = px;
  ctx.beginPath();
  for (let lon = 116; lon <= 124; lon += 0.5) { ctx.moveTo(lon, mercY(28)); ctx.lineTo(lon, mercY(20)); }
  for (let lat = 20; lat <= 28; lat += 0.5) { ctx.moveTo(115, mercY(lat)); ctx.lineTo(125, mercY(lat)); }
  ctx.stroke();
  // 我方海域提示
  if (hint === 'sea') {
    ctx.fillStyle = `rgba(34,211,238,${0.07 + 0.04 * Math.sin(t / 300)})`;
    ctx.beginPath(); ctx.moveTo(117.5 + 0, mercY(22.5)); ctx.lineTo(122.5 + 5, mercY(27.5)); ctx.lineTo(130, mercY(27.5)); ctx.lineTo(130, mercY(18)); ctx.lineTo(113, mercY(18)); ctx.closePath(); ctx.fill();
  }
  // 海域界線
  ctx.save(); ctx.setLineDash([8 * px, 6 * px]); ctx.strokeStyle = 'rgba(148,163,184,.45)'; ctx.lineWidth = 1.5 * px;
  ctx.beginPath(); ctx.moveTo(116.5, mercY(21.5)); ctx.lineTo(123, mercY(28)); ctx.stroke(); ctx.restore();
  // 中國大陸
  ctx.fillStyle = '#2b2724'; ctx.fill(CHINA_PATH);
  ctx.strokeStyle = 'rgba(239,68,68,.35)'; ctx.lineWidth = 1.2 * px; ctx.stroke(CHINA_PATH);
  // 台灣防區
  for (const z of Object.keys(ZONE_PATH)) {
    let fill = ZONES[z].type === 'capital' ? '#3e5f45' : ZONES[z].type === 'mountain' ? '#3d4f3a' : '#3a5a3e';
    if (S.hover?.zone === z) fill = '#4d7556';
    ctx.fillStyle = fill; ctx.fill(ZONE_PATH[z]);
  }
  if (hint === 'land' || hint === 'coast') {
    ctx.fillStyle = `rgba(251,191,36,${0.12 + 0.07 * Math.sin(t / 300)})`;
    for (const z of Object.keys(ZONE_PATH)) ctx.fill(ZONE_PATH[z]);
  }
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.8 * px;
  for (const p of COUNTY_PATHS) ctx.stroke(p);
  ctx.strokeStyle = 'rgba(190,230,200,.55)'; ctx.lineWidth = 1.2 * px;
  for (const z of Object.keys(ZONE_PATH)) ctx.stroke(ZONE_PATH[z]);

  // ---- 螢幕座標層 ----
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const showLabels = $('optLabels').checked;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (showLabels) {
    ctx.font = 'italic 12px sans-serif'; ctx.fillStyle = 'rgba(148,197,230,.45)';
    for (const s of SEA_ZONES) { const [x, y] = toS(s.lon, s.lat); ctx.fillText(s.name, x, y); }
    ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = 'rgba(239,180,170,.55)';
    { const [x, y] = toS(117.95, 25.9); ctx.fillText('中國大陸（攻方）', x, y); }
  }
  // 敵方集結區
  for (const e of ENEMY_STAGING) {
    const [x, y] = toS(e.lon, e.lat), r = 14 + 3 * Math.sin(t / 400 + e.lon);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = 'rgba(239,68,68,.25)'; ctx.fill();
    ctx.strokeStyle = 'rgba(239,68,68,.8)'; ctx.lineWidth = 1.5; ctx.stroke();
    if (showLabels) { ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#fca5a5'; ctx.fillText(e.name, x, y + 24); ctx.font = '10px sans-serif'; ctx.fillStyle = '#b98b8b'; ctx.fillText(e.sub, x, y + 37); }
  }
  // 射程圈
  if ($('optRanges').checked) {
    for (const u of S.units) {
      const T = UNIT_TYPES[u.type];
      if (!T.range || T.cat === 'air' && u.type !== 'drone') continue;
      if (u.type === 'radar' && S.selected !== u) continue;
      const [x, y] = toS(u.lon, u.lat);
      ctx.beginPath(); ctx.arc(x, y, kmToPx(T.range, u.lat), 0, 7);
      ctx.strokeStyle = CATS[T.cat].color + (S.selected === u ? 'cc' : '44'); ctx.lineWidth = S.selected === u ? 2 : 1; ctx.stroke();
      ctx.fillStyle = CATS[T.cat].color + (S.selected === u ? '1a' : '0a'); ctx.fill();
    }
  }
  // 防區名稱
  if (showLabels) {
    ctx.font = 'bold 12px sans-serif';
    for (const z of Object.keys(ZONES)) {
      const [x, y] = toS(ZONE_POS[z].lon, ZONE_POS[z].lat);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(ZONES[z].name, x, y);
      ctx.fillStyle = ZONES[z].type === 'capital' ? '#fde68a' : '#e5efe7'; ctx.fillText(ZONES[z].name, x, y);
      if (ZONES[z].type === 'capital') { ctx.font = '10px sans-serif'; ctx.fillStyle = '#fde68a'; ctx.fillText('★ 首都', x, y + 13); ctx.font = 'bold 12px sans-serif'; }
    }
  }
  // 灘頭
  const pulseB = hint === 'beach';
  for (const b of BEACHES) {
    const [x, y] = toS(b.lon, b.lat), s = pulseB ? 6 + 1.5 * Math.sin(t / 200) : 5;
    ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath();
    ctx.fillStyle = '#f97316'; ctx.fill(); ctx.strokeStyle = '#1a0d04'; ctx.lineWidth = 1; ctx.stroke();
    if (showLabels && V.s > 260) { ctx.font = '10px sans-serif'; ctx.fillStyle = '#fdba74'; ctx.textAlign = 'right'; ctx.fillText(b.name, x - 9, y); ctx.textAlign = 'center'; }
  }
  // 空軍基地
  const pulseA = hint === 'airbase';
  for (const a of AIRBASES) {
    const [x, y] = toS(a.lon, a.lat);
    ctx.beginPath(); ctx.arc(x, y, pulseA ? 6 + 1.5 * Math.sin(t / 200) : 4.5, 0, 7);
    ctx.fillStyle = '#c4b5fd'; ctx.fill(); ctx.strokeStyle = '#1e1b4b'; ctx.lineWidth = 1.2; ctx.stroke();
    if (showLabels && (V.s > 260 || pulseA)) { ctx.font = '10px sans-serif'; ctx.fillStyle = '#ddd6fe'; ctx.textAlign = 'left'; ctx.fillText(a.name, x + 8, y + 1); ctx.textAlign = 'center'; }
  }
  // 單位
  for (const u of S.units) if (u !== drag?.unit || !drag.moved) drawUnit(u, ...unitScreen(u), S.selected === u, 1);
  // 拖曳 / 放置預覽
  if (S.hover && (S.placing || drag?.unit && drag.moved)) {
    const type = S.placing || drag.unit.type;
    const v = validate(type, S.hover.lon, S.hover.lat, drag?.unit);
    const [x, y] = v.ok ? toS(v.lon, v.lat) : [S.hover.sx, S.hover.sy];
    const T = UNIT_TYPES[type];
    if (T.range && v.ok && T.cat !== 'air' || type === 'drone' && v.ok) {
      ctx.beginPath(); ctx.arc(x, y, kmToPx(T.range, v.lat), 0, 7);
      ctx.strokeStyle = CATS[T.cat].color + '99'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    }
    drawUnit({ type }, x, y, false, v.ok ? 0.75 : 0.35, !v.ok);
  }
  requestAnimationFrame(draw);
}
function unitScreen(u) { const d = displayPos(u); const [x, y] = toS(d.lon, d.lat); return [x + d.dx, y + d.dy]; }

function drawUnit(u, x, y, sel, alpha, bad) {
  const T = UNIT_TYPES[u.type], col = CATS[T.cat].color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2; ctx.strokeStyle = bad ? '#ef4444' : col;
  if (T.cat === 'sea' && u.type !== 'mine') {          // 艦艇：船形
    ctx.beginPath(); ctx.moveTo(x - 14, y - 7); ctx.lineTo(x + 9, y - 7); ctx.lineTo(x + 16, y); ctx.lineTo(x + 9, y + 7); ctx.lineTo(x - 14, y + 7); ctx.closePath();
    ctx.fillStyle = '#0e4b6b'; ctx.fill(); ctx.stroke();
  } else if (T.cat === 'air') {                           // 空軍：菱形
    ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x + 12, y); ctx.lineTo(x, y + 12); ctx.lineTo(x - 12, y); ctx.closePath();
    ctx.fillStyle = '#3b2f7a'; ctx.fill(); ctx.stroke();
  } else if (u.type === 'mine') {
    ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fillStyle = '#4a2a0a'; ctx.fill(); ctx.stroke();
  } else {                                                // 陸軍 / 防空：方框
    ctx.beginPath(); ctx.roundRect(x - 12, y - 9, 24, 18, 3);
    ctx.fillStyle = T.cat === 'ad' ? '#5a3d0a' : '#1d4ed8'; ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(T.glyph, x - (T.cat === 'sea' && u.type !== 'mine' ? 2 : 0), y + 0.5);
  if (sel) { ctx.beginPath(); ctx.arc(x, y, 17, 0, 7); ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.globalAlpha = 1;
}

// ================= 互動 =================
let drag = null;
function evPos(ev) { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
function hitUnit(sx, sy) {
  let best = null, bd = 15 * 15;
  for (const u of S.units) { const [x, y] = unitScreen(u); const d = (x - sx) ** 2 + (y - sy) ** 2; if (d < bd) { bd = d; best = u; } }
  return best;
}
function setHover(sx, sy) {
  const p = fromS(sx, sy);
  S.hover = { ...p, sx, sy, zone: zoneAt(p.lon, p.lat), unit: hitUnit(sx, sy) };
  tooltip();
}
function onDown(ev) {
  if (ev.button !== 0) return;
  const [sx, sy] = evPos(ev);
  drag = { sx, sy, tx: V.tx, ty: V.ty, unit: S.placing ? null : hitUnit(sx, sy), moved: false };
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
  const [sx, sy] = evPos(ev);
  const d = drag; drag = null;
  if (!d.moved) return onClick(sx, sy);
  if (d.unit) {
    const p = fromS(sx, sy), v = validate(d.unit.type, p.lon, p.lat, d.unit);
    if (v.ok) Object.assign(d.unit, { lon: v.lon, lat: v.lat, zone: v.zone, anchor: v.anchor || null });
    else toast(v.msg);
    S.selected = d.unit; ui();
  }
}
function onClick(sx, sy) {
  const p = fromS(sx, sy);
  if (S.placing) { place(S.placing, p.lon, p.lat); return; }
  S.selected = hitUnit(sx, sy); ui();
}
function cancel() { S.placing = null; S.selected = null; ui(); }

function tooltip() {
  const tt = $('tooltip'), h = S.hover;
  if (!h || drag?.moved) { tt.classList.add('hidden'); return; }
  let html = '';
  if (h.unit) {
    const T = UNIT_TYPES[h.unit.type];
    const where = h.unit.anchor ? (AIRBASES.find(a => a.id === h.unit.anchor) || BEACHES.find(b => b.id === h.unit.anchor))?.name : (h.unit.zone ? ZONES[h.unit.zone].name : '海上');
    html = `<b style="color:${CATS[T.cat].color}">${T.name}</b>　<span style="color:#fbbf24">${T.cost}</span><br>位置：${where}<br>攻 ${T.atk}　防 ${T.def}　兵力 ${T.hp}${T.range ? `　射程 ${T.range} km` : ''}<br><span style="color:#8796a8">${T.desc}</span><br><span style="color:#6f7d8c">拖曳移動・右鍵撤回</span>`;
  } else if (h.zone) {
    const Z = ZONES[h.zone], ZT = ZONE_TYPES[Z.type];
    const us = S.units.filter(u => u.zone === h.zone);
    const cnt = {}; us.forEach(u => cnt[UNIT_TYPES[u.type].name] = (cnt[UNIT_TYPES[u.type].name] || 0) + 1);
    const bs = BEACHES.filter(b => b.zone === h.zone).map(b => b.name);
    html = `<b>${Z.name}</b>（${countyAt(h.lon, h.lat)}）<br>地形：${ZT.name}${ZT.def ? `（防禦 +${ZT.def}）` : ''}<br>灘頭：${bs.join('、') || '無'}<br>駐軍：${Object.entries(cnt).map(([k, v]) => `${k}×${v}`).join('、') || '無'}`;
  } else if (inChina(h.lon, h.lat)) html = '<b style="color:#fca5a5">中國大陸</b>（攻方）';
  else html = TW_WATERS(h.lon, h.lat) ? '我方海域' : '海峽西側（敵方海域）';
  tt.innerHTML = html;
  tt.classList.remove('hidden');
  const bx = Math.min(h.sx + 16, W - 260), by = Math.min(h.sy + 14, H - 120);
  tt.style.left = bx + 'px'; tt.style.top = by + 'px';
}

let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 1800); }

// ================= 側邊欄 =================
function ui() {
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
      <span class="ic" style="border-color:${CATS[T.cat].color}">${T.glyph}</span>
      <span class="nm">${T.name}${n ? ` <span class="ct">×${n}</span>` : ''}<small>${T.desc}</small></span>
      <span class="cs">${T.cost}</span></button>`;
  }).join('');
  $('shop').querySelectorAll('.item').forEach(b => b.onclick = () => { S.placing = S.placing === b.dataset.type ? null : b.dataset.type; S.selected = null; ui(); });

  $('ally').innerHTML = ALLY_LEVELS.map(a =>
    `<label class="ally ${S.ally === a.amount ? 'active' : ''}" data-amt="${a.amount}"><span class="amt">${a.amount}</span><b>${a.name}</b><small>${a.desc}</small></label>`).join('');
  $('ally').querySelectorAll('.ally').forEach(el => el.onclick = () => {
    const amt = +el.dataset.amt;
    if (amt - S.ally > remaining()) return toast('預算不足，請先撤回部分部隊');
    S.ally = amt; ui();
  });

  $('eval').innerHTML = evaluate().map(e => {
    const c = e.v >= 0.7 ? '#4ade80' : e.v >= 0.4 ? '#fbbf24' : '#ef4444';
    return `<div class="ev"><div class="lab"><span>${e.name}</span><span style="color:${c}">${Math.round(e.v * 100)}%</span></div><div class="bar"><div style="width:${e.v * 100}%;background:${c}"></div></div></div>`;
  }).join('');

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
  const msgs = [
    `【情報】對岸沿海港口船艦活動明顯增加，研判集結兩棲部隊約 ${I.est.brigades} 個旅`,
    `【國防】國防預算總額 ${TOTAL_BUDGET} 點，請完成陸海空部署後按下「戰爭開始」`,
    `【情報】研判主要威脅方向為${REGION_NAME[top[0]]}沿海（${top[1]}%）`,
    `【外交】日美協防為不確定因素，預備金越多、撐得越久，獲得支援的機會越高`,
    `【提醒】本遊戲為虛構推演，數值不代表真實戰力`,
  ];
  const text = msgs.join('　　　◆　　　');
  if (text !== lastTicker) { $('tickerText').textContent = text; lastTicker = text; }
}

// ================= 存檔 / 開戰 =================
const SAVE_KEY = 'warsim_v02';
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ units: S.units, ally: S.ally, difficulty: S.difficulty, intel: S.intel })); toast('已儲存部署'); }
  catch { toast('此瀏覽器無法儲存'); }
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!d) return toast('沒有存檔');
    S.units = d.units; S.ally = d.ally; S.difficulty = d.difficulty; S.intel = d.intel;
    S.nextId = Math.max(0, ...S.units.map(u => u.id)) + 1; S.selected = null; S.placing = null;
    $('selDiff').value = S.difficulty; toast('已載入部署'); ui();
  } catch { toast('讀取存檔失敗'); }
}
function warStart() {
  if (!S.units.length) return toast('請先部署部隊');
  S.timerOn = false; S.placing = null;
  const ev = evaluate(), weak = ev.filter(e => e.v < 0.4).map(e => e.name);
  const cnt = {}; S.units.forEach(u => cnt[UNIT_TYPES[u.type].name] = (cnt[UNIT_TYPES[u.type].name] || 0) + 1);
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ units: S.units, ally: S.ally, difficulty: S.difficulty, intel: S.intel })); } catch {}
  $('overlayCard').innerHTML = `<h2>部署完成</h2>
    <p>共 ${S.units.length} 個單位，花費 ${cost() - S.ally} 點，協防預備金 ${S.ally} 點（${ALLY_LEVELS.find(a => a.amount === S.ally).name}）。</p>
    <p style="color:#9fb0c2">${Object.entries(cnt).map(([k, v]) => `${k}×${v}`).join('、')}</p>
    ${weak.length ? `<p style="color:#fca5a5">弱點：${weak.join('、')}</p>` : '<p style="color:#86efac">各項評估都在合格以上。</p>'}
    <p>⚠ <b>戰爭推演引擎</b>（飛彈與空優 → 渡海 → 搶灘 → 陸戰 → 結局、新聞快報、動態戰場、勝負判定）將在 <b>v0.3</b> 加入。部署已自動儲存，屆時可直接用這份部署開戰。</p>
    <button class="primary" id="btnBack">返回部署</button>`;
  $('overlay').classList.remove('hidden');
  $('btnBack').onclick = () => { $('overlay').classList.add('hidden'); ui(); };
  ui();
}

function tick() {
  if (!S.timerOn) return;
  S.timerLeft--;
  if (S.timerLeft <= 0) { S.timerOn = false; toast('部署時間到！'); warStart(); }
  ui();
}

// ================= 初始化 =================
function init() {
  cv = $('cv'); ctx = cv.getContext('2d');
  buildPaths(); rollIntel();
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
    ev.preventDefault(); const [sx, sy] = evPos(ev); const u = hitUnit(sx, sy);
    if (u) { removeUnit(u); toast(`已撤回 ${UNIT_TYPES[u.type].name}（退款 ${UNIT_TYPES[u.type].cost}）`); } else cancel();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') cancel();
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.selected && e.target === document.body) removeUnit(S.selected);
  });
  $('zIn').onclick = () => zoomAt(W / 2, H / 2, 1.3);
  $('zOut').onclick = () => zoomAt(W / 2, H / 2, 1 / 1.3);
  $('zReset').onclick = fit;
  $('btnAuto').onclick = () => { autoDeploy(); toast('已套用推薦部署，可再自行調整'); };
  $('btnClear').onclick = () => { S.units = []; S.selected = null; ui(); };
  $('btnSave').onclick = save; $('btnLoad').onclick = load;
  $('btnWar').onclick = warStart;
  setInterval(tick, 1000);
  ui();
  requestAnimationFrame(draw);
}
init();
