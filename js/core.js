'use strict';
/* 共用核心：地理運算、部署規則、推薦部署。不依賴畫面，可在 node 中執行。 */
const MD = window.MAP_DATA;
const DEG = Math.PI / 180;

const mercY = lat => -Math.log(Math.tan(Math.PI / 4 + lat * DEG / 2)) / DEG;   // 北方為負
const invMercY = y => (2 * Math.atan(Math.exp(-y * DEG)) - Math.PI / 2) / DEG;
function km(a, b) {
  const dx = (a.lon - b.lon) * 111.32 * Math.cos((a.lat + b.lat) / 2 * DEG), dy = (a.lat - b.lat) * 110.57;
  return Math.hypot(dx, dy);
}
const offsetKm = (p, dx, dy) => ({ lon: p.lon + dx / (111.32 * Math.cos(p.lat * DEG)), lat: p.lat + dy / 110.57 });
function towards(a, b, k) {   // 從 a 往 b 方向走 k 公里（k 為負則反向）
  const d = km(a, b) || 1;
  return offsetKm(a, (b.lon - a.lon) * 111.32 * Math.cos(a.lat * DEG) / d * k, (b.lat - a.lat) * 110.57 / d * k);
}
const lerpPos = (a, b, t) => ({ lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t });

function toRings(flat) { const pts = []; for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]); return pts; }
function bboxOf(pts) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const [x, y] of pts) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return [a, b, c, d]; }
const TW_RINGS = [], CN_RINGS = [], OTHER_RINGS = [];
for (const c of MD.counties) for (const r of c.rings) { const pts = toRings(r); TW_RINGS.push({ zone: c.zone, county: c.name, pts, bb: bboxOf(pts) }); }
for (const r of MD.china) { const pts = toRings(r); CN_RINGS.push({ pts, bb: bboxOf(pts) }); }
for (const r of MD.other || []) { const pts = toRings(r); OTHER_RINGS.push({ pts, bb: bboxOf(pts) }); }

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
const isLand = (lon, lat) => !!zoneAt(lon, lat) || inChina(lon, lat) || !!inRings(OTHER_RINGS, lon, lat);
function isCoastal(p) {
  for (let a = 0; a < 16; a++) for (const d of [5, 10, 15]) {
    const q = offsetKm(p, d * Math.cos(a * Math.PI / 8), d * Math.sin(a * Math.PI / 8));
    if (!isLand(q.lon, q.lat)) return true;
  }
  return false;
}

// 防區中心、相鄰表、灘頭吸附到海岸線
const ZONE_POS = {};
for (const z of Object.keys(ZONES)) { const p = ZONE_LABEL_POS[z] || MD.centroids[z]; ZONE_POS[z] = { lon: p[0], lat: p[1] }; }
const NEIGHBORS = {};
for (const z of Object.keys(ZONES)) NEIGHBORS[z] = [];
for (const [a, b] of ZONE_ADJ) { NEIGHBORS[a].push(b); NEIGHBORS[b].push(a); }
for (const b of BEACHES) {
  let best = null, bd = 1e9;
  for (const r of TW_RINGS) if (r.zone === b.zone) for (const [lon, lat] of r.pts) {
    const d = km(b, { lon, lat }); if (d < bd) { bd = d; best = { lon, lat }; }
  }
  if (best) { b.lon = best.lon; b.lat = best.lat; }
  b.sea = towards(b, ZONE_POS[b.zone], -12);   // 灘頭外海點（船團停泊處）
}
const beachById = id => BEACHES.find(b => b.id === id);

// ================= 部署規則 =================
function checkPlace(units, type, lon, lat, ignore) {
  const T = UNIT_TYPES[type];
  const others = units.filter(u => u !== ignore);
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

// ================= 推薦部署 =================
function recommendedDeploy(budget) {
  const units = []; let left = budget, id = 1;
  const tryAt = (type, pts) => {
    if (left < UNIT_TYPES[type].cost) return;
    for (const p of pts) {
      const v = checkPlace(units, type, p.lon, p.lat);
      if (v.ok) { units.push({ id: id++, type, lon: v.lon, lat: v.lat, zone: v.zone, anchor: v.anchor || null }); left -= UNIT_TYPES[type].cost; return; }
    }
  };
  const inland = (bid, k) => { const b = beachById(bid); return [towards(b, ZONE_POS[b.zone], k), towards(b, ZONE_POS[b.zone], k + 4), ZONE_POS[b.zone]]; };
  const seaward = (bid, k) => { const b = beachById(bid); return [towards(b, ZONE_POS[b.zone], -k), towards(b, ZONE_POS[b.zone], -k - 10)]; };
  const ab = id => [AIRBASES.find(x => x.id === id)];
  const plan = [
    ['sam_l', [ZONE_POS.taipei]], ['sam_l', [ZONE_POS.taichung]], ['radar', inland('tamsui', 4)], ['radar', inland('anping', 4)],
    ['asm', inland('guanyin', 4)], ['asm', inland('tcport', 4)], ['asm', inland('anping', 4)],
    ['fighter', ab('ab_taichung')], ['fighter', ab('ab_hualien')],
    ['inf', inland('tamsui', 6)], ['inf', inland('guanyin', 6)], ['inf', inland('tcport', 7)], ['inf', inland('anping', 6)],
    ['armor', inland('guanyin', 18)], ['sam_s', inland('linyuan', 8)], ['sam_s', [ZONE_POS.tainan]],
    ['mine', [beachById('guanyin')]], ['mine', [beachById('tamsui')]], ['fac', seaward('tcport', 14)], ['fac', seaward('budai', 14)],
    ['reserve', [ZONE_POS.taipei]], ['reserve', [ZONE_POS.kaohsiung]], ['inf', [ZONE_POS.penghu]],
  ];
  for (const [t, pts] of plan) tryAt(t, pts);
  return units;
}
