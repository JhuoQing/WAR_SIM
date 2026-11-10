'use strict';
/* 戰爭推演引擎 v0.3
 * 1 tick = 1 遊戲小時，最長 10 天。純邏輯，不碰畫面，可在 node 批次執行。
 * 所有數值皆為遊戲設定，不代表真實戰力。 */
const MAX_DAYS = 10, MAX_T = MAX_DAYS * 24;
const SALVO_T = [0, 2, 5, 9, 14, 20, 28, 38, 50, 64, 80, 100, 124, 150];
const OUTER = ['kinmen', 'matsu'];

// 對海 / 對灘頭火力：r 射程 km、dmg 傷害、cd 冷卻（小時）
const FIRE = {
  asm:     { r: 150, dmg: 80, cd: 6 },
  mlrs:    { r: 70,  dmg: 55, cd: 4 },
  frigate: { r: 100, dmg: 50, cd: 6 },
  fac:     { r: 60,  dmg: 35, cd: 8 },
  sub:     { r: 40,  dmg: 75, cd: 10 },
  drone:   { r: 150, dmg: 25, cd: 4 },
  art:     { r: 30,  dmg: 40, cd: 3 },
  fighter: { r: 450, dmg: 55, cd: 8 },
};
// 被飛彈 / 空襲命中時的閃避率（機動、偽裝）
const EVADE = { asm: .8, mlrs: .7, drone: .7, inf: .7, armor: .5, art: .55, reserve: .7, sam_l: .3, sam_s: .5, radar: .15, frigate: .3, fac: .6, sub: 1, mine: 1, fighter: .3 };
// 機動單位平時隱蔽，開火後暴露 3 小時
const evadeOf = (S, u) => EVADE[u.type] * (u.exposed > S.t ? 0.5 : 1);
const seen = (S, u) => (u.exposed > S.t ? 3 : 1);
const GROUND_ATK = { inf: 30, armor: 60, reserve: 15, art: 27 };
// 各防區的在地守備／動員兵力（不需購買）
const GARRISON = { capital: 160, urban: 80, plain: 50, hill: 55, mountain: 60, island: 60 };
const ZONE_VALUE = { capital: 10, urban: 5, plain: 3, hill: 2, mountain: 1, island: 0 };

function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const fmtT = t => `D+${Math.floor(t / 24)} ${String(t % 24).padStart(2, '0')}:00`;

function createSim(deploy, seed) {
  if (seed === undefined) seed = Math.floor(Math.random() * 4294967295);
  const R = makeRng(seed);
  const m = DIFFICULTY[deploy.difficulty || 'normal'].mult;
  const est = deploy.intel.est, j = () => 0.9 + R() * 0.2;
  const S = {
    R, seed, t: 0, over: false, result: null,
    probs: deploy.intel.probs,
    allyLevel: Math.round((deploy.ally || 0) / 100),
    allyState: (deploy.ally || 0) >= 200 ? 'pending' : 'none',
    allyDay: (deploy.ally || 0) >= 300 ? 4 : 7,
    units: deploy.units.map(u => {
      const T = UNIT_TYPES[u.type];
      return { id: u.id, type: u.type, lon: u.lon, lat: u.lat, zone: u.zone, anchor: u.anchor, hp: T.hp, maxHp: T.hp, alive: true, cd: Math.floor(R() * 3), ammo: AMMO[u.type] || 0, move: null };
    }),
    airbase: Object.fromEntries(AIRBASES.map(a => [a.id, 0])),
    zones: Object.fromEntries(Object.keys(ZONES).map(z => [z, { owner: 'TW', enemy: 0, advCd: 0, gar: GARRISON[ZONES[z].type] * (OUTER.includes(z) ? 1.6 : 1), gar0: GARRISON[ZONES[z].type] * (OUTER.includes(z) ? 1.6 : 1) }])),
    convoys: [], groups: [], nextCid: 1,
    air: 40, sea: 50, resilience: 100, will: 100,
    events: [], news: [],
    stats: { missiles: 0, intercepted: 0, enemyLost: 0, fleetsLost: 0, sqLost: 0, twLost: 0, landed: 0, sunk: 0 },
  };
  const B = Math.max(6, Math.round(est.brigades * j()));
  S.enemy = {
    brig0: B, air0: Math.round(est.squadrons * j()) * 100, fleets0: Math.round(est.fleets * j()),
    salvos: Math.round(est.salvos * j()), perSalvo: Math.round(30 * m),
  };
  S.enemy.airHp = S.enemy.air0;
  const outer = B >= 10 ? 2 : 0, rest = B - outer, w1 = Math.round(rest * 0.6);
  S.plan = { outer, w1, w2: rest - w1, launched2: false, mainBrig: rest };
  return S;
}

// ---------------- 小工具 ----------------
const alive = S => S.units.filter(u => u.alive);
const hpf = u => u.hp / u.maxHp;
function news(S, level, text) { S.news.push({ t: S.t, level, text }); }
function ev(S, e) { S.events.push(e); }
function radarBonus(S) { return (S.units.some(u => u.alive && u.type === 'radar') ? 0.12 : 0) + (S.allyLevel >= 1 ? 0.08 : 0); }
function weightedPick(R, items) {
  const tot = items.reduce((s, x) => s + x.w, 0); if (tot <= 0) return null;
  let r = R() * tot; for (const x of items) { r -= x.w; if (r <= 0) return x; } return items[items.length - 1];
}
function damageUnit(S, u, dmg, cause) {
  if (!u.alive) return;
  u.hp -= dmg;
  if (u.hp <= 0) {
    u.hp = 0; u.alive = false; S.stats.twLost++;
    ev(S, { type: 'destroyed', lon: u.lon, lat: u.lat });
    const T = UNIT_TYPES[u.type];
    if (['sam_l', 'frigate', 'sub', 'fighter', 'armor', 'radar'].includes(u.type) || S.R() < 0.35) {
      const where = u.zone ? ZONES[u.zone].name : '外海';
      news(S, 'info', `【戰況】${where}的我方${T.name}遭${cause}摧毀`);
    }
  }
}
function lossToEnemy(S, hp, kind) {
  if (hp <= 0) return;
  if (kind === 'fleet') { S.stats.fleetsLost += hp / 100; S.will -= hp / 100 * 1.5; }
  else { S.stats.enemyLost += hp / 100; S.will -= hp / 100 * 2.6; }
}

// ---------------- 登陸地點選擇（依我方部署弱點） ----------------
function beachDefense(S, b) {
  let d = 0;
  for (const u of alive(S)) {
    const T = UNIT_TYPES[u.type];
    if (FIRE[u.type] && u.type !== 'fighter' && km(u, b.sea) <= FIRE[u.type].r) d += T.atk * 0.6 * hpf(u);
    if (['inf', 'armor', 'reserve'].includes(u.type) && km(u, b) <= 30) d += T.atk * hpf(u);
    if (u.type === 'mine' && u.anchor === b.id) d += 40;
  }
  return d;
}
const BEACH_VALUE = { taipei: 1.4, taoyuan: 1.35, hsinchu: 1.1, taichung: 1.25, tainan: 1.2, kaohsiung: 1.2 };
function chooseBeaches(S, n) {
  const scored = BEACHES.filter(b => !OUTER.includes(b.zone) && S.zones[b.zone].owner === 'TW').map(b => {
    const reg = ZONES[b.zone].region;
    const w = reg === 'east' ? 8 : reg === 'islands' ? 7 : (S.probs[reg] || 10);
    return { b, s: w * (BEACH_VALUE[b.zone] || 1) * (0.6 + 0.8 * S.R()) / (1 + beachDefense(S, b) / 150) };
  }).sort((x, y) => y.s - x.s);
  const out = [], used = new Set();
  for (const x of scored) { if (used.has(x.b.zone)) continue; used.add(x.b.zone); out.push(x.b); if (out.length >= n) break; }
  return out;
}
function stagingFor(b) {
  const reg = ZONES[b.zone].region;
  const st = ENEMY_STAGING.find(e => e.region === (reg === 'east' ? (b.lat > 24 ? 'north' : 'south') : reg === 'islands' ? 'central' : reg)) || ENEMY_STAGING[1];
  return towards(st, b.sea, 15);
}
function launchWave(S, brig, beaches, fleetFrac, wave) {
  if (!beaches.length || brig <= 0) return;
  for (const b of beaches) {
    const start = stagingFor(b), path = [start];
    if (ZONES[b.zone].region === 'east') path.push(b.lat > 24 ? { lon: 122.15, lat: 25.6 } : { lon: 120.85, lat: 21.55 });
    path.push(b.sea);
    let total = 0; const seg = [];
    for (let i = 1; i < path.length; i++) { const d = km(path[i - 1], path[i]); seg.push(d); total += d; }
    const trans = brig / beaches.length * 100, esc = S.enemy.fleets0 * fleetFrac / beaches.length * 100;
    S.convoys.push({ id: S.nextCid++, wave, beach: b.id, path, seg, total, dist: 0, speed: 7, trans, trans0: trans, esc, esc0: esc, state: 'sail', lon: start.lon, lat: start.lat });
  }
  const names = beaches.map(b => b.name).join('、');
  news(S, 'major', wave === 1 ? `【快訊】大批敵方兩棲船團駛離港口，研判目標：${names}` : `【快訊】敵方第二波登陸船團出港，駛向${names}`);
}
function convoyPos(c) {
  let d = c.dist;
  for (let i = 0; i < c.seg.length; i++) { if (d <= c.seg[i]) return lerpPos(c.path[i], c.path[i + 1], d / c.seg[i]); d -= c.seg[i]; }
  return c.path[c.path.length - 1];
}

// ---------------- 飛彈 ----------------
function salvo(S) {
  const n = Math.round(S.enemy.perSalvo * (S.t === 0 ? 1.6 : 1) * (0.85 + S.R() * 0.3));
  const targets = [];
  for (const a of AIRBASES) {
    const f = S.units.filter(u => u.alive && u.anchor === a.id).length;
    targets.push({ kind: 'base', id: a.id, pos: a, w: f ? 3 + f : 0.3 });
  }
  const W = { radar: 2.5, sam_l: 2.0, sam_s: 1.0, asm: 0.4, frigate: 1.6, mlrs: 0.3, armor: 0.3 };
  for (const u of alive(S)) if (W[u.type] && !u.move) targets.push({ kind: 'unit', u, pos: u, w: W[u.type] * seen(S, u) });
  for (const z of Object.keys(ZONES)) {
    const ty = ZONES[z].type;
    if ((ty === 'capital' || ty === 'urban') && S.zones[z].owner === 'TW') targets.push({ kind: 'city', z, pos: ZONE_POS[z], w: ty === 'capital' ? 2.5 : 0.9 });
  }
  const rb = radarBonus(S), shots = [];
  let hit = 0, icpt = 0;
  for (let i = 0; i < n; i++) {
    const tg = weightedPick(S.R, targets); if (!tg) break;
    const pos = tg.pos;
    let ok = false;
    for (let k = 0; k < 2 && !ok; k++) {
      const ints = S.units.filter(u => u.alive && u.ammo > 0 && (u.type === 'frigate' ? km(u, pos) <= 50 : (u.type === 'sam_l' || u.type === 'sam_s') && km(u, pos) <= UNIT_TYPES[u.type].range));
      if (!ints.length) break;
      const s = ints[Math.floor(S.R() * ints.length)];
      s.ammo--;
      const pk = Math.min(0.9, { sam_l: 0.65, sam_s: 0.55, frigate: 0.5 }[s.type] + rb);
      if (S.R() < pk) ok = true;
    }
    if (ok) icpt++;
    else {
      hit++;
      if (tg.kind === 'base') {
        S.airbase[tg.id] = Math.min(0.9, S.airbase[tg.id] + 0.12);
        for (const f of S.units) if (f.alive && f.anchor === tg.id) damageUnit(S, f, 5, '飛彈攻擊');
      } else if (tg.kind === 'unit') {
        if (S.R() > evadeOf(S, tg.u)) damageUnit(S, tg.u, 15, '飛彈攻擊');
      } else S.resilience -= tg.z === 'taipei' ? 0.25 : 0.15;
    }
    if (shots.length < 36) shots.push({ lon: pos.lon + (S.R() - 0.5) * 0.06, lat: pos.lat + (S.R() - 0.5) * 0.06, ok });
  }
  S.stats.missiles += n; S.stats.intercepted += icpt;
  const from = ENEMY_STAGING[Math.floor(S.R() * ENEMY_STAGING.length)];
  ev(S, { type: 'salvo', from: { lon: from.lon - 0.5, lat: from.lat }, shots });
  news(S, S.t === 0 ? 'major' : 'alert', S.t === 0
    ? `【快訊】對岸對台灣發動大規模飛彈攻擊，約 ${n} 枚，我方攔截 ${icpt} 枚，全台進入戰時狀態`
    : `【快訊】敵方第 ${S.enemy.salvoN} 波飛彈來襲，約 ${n} 枚，攔截 ${icpt} 枚`);
}

// ---------------- 空戰 ----------------
function airWar(S) {
  const fighters = S.units.filter(u => u.alive && u.type === 'fighter');
  const TA = fighters.reduce((s, f) => s + f.hp * (1 - S.airbase[f.anchor]), 0);
  const AD = alive(S).reduce((s, u) => s + (u.ammo > 0 ? (u.type === 'sam_l' ? u.hp * 1.2 : u.type === 'sam_s' ? u.hp * 0.8 : u.type === 'frigate' ? u.hp * 0.4 : 0) : 0) + (u.type === 'drone' ? u.hp * 0.2 : 0), 0);
  const EA = S.enemy.airHp * 0.3 * (S.allyState === 'arrived' ? 0.7 : 1);
  let target = 100 * (TA + AD) / (TA + AD + EA + 1);
  if (S.allyState === 'arrived') target = Math.min(95, target + 35);
  S.air += (target - S.air) * 0.15;
  const k = S.t < 72 ? 1 : 0.6;
  const eLoss = (TA * 0.02 + AD * 0.015) * k * (0.7 + 0.6 * S.R());
  S.enemy.airHp = Math.max(0, S.enemy.airHp - eLoss);
  S.stats.sqLost += eLoss / 100; S.will -= eLoss / 100 * 0.6;
  let tLoss = EA * 0.004 * k * (0.7 + 0.6 * S.R());
  if (TA > 0) for (const f of fighters) damageUnit(S, f, tLoss * f.hp * (1 - S.airbase[f.anchor]) / TA, '空戰');
  // 敵方空襲
  if (S.air < 55) {
    let power = (55 - S.air) / 55 * S.enemy.airHp * 0.0009 * (S.allyState === 'arrived' ? 0.5 : 1);
    const VIS = { frigate: 3, fac: 1.2, armor: 1.5, art: 1.2, mlrs: 0.5, sam_l: 1.5, sam_s: 1, radar: 2, inf: 0.8, reserve: 0.6, asm: 0.3, drone: 0.3 };
    while (power > 0) {
      if (power < 20 && S.R() > power / 20) break;
      power -= 20;
      const tg = weightedPick(S.R, alive(S).filter(u => VIS[u.type]).map(u => ({ u, w: VIS[u.type] * (u.move ? 2 : 1) * seen(S, u) })));
      if (!tg) break;
      ev(S, { type: 'airstrike', lon: tg.u.lon, lat: tg.u.lat });
      if (S.R() > evadeOf(S, tg.u) * 0.6) damageUnit(S, tg.u, 18, '敵機空襲');
    }
  }
}

// ---------------- 海上：船團航行、我方攻擊、登陸 ----------------
function navalWar(S) {
  const rb = radarBonus(S);
  const active = S.convoys.filter(c => c.state === 'sail' || (c.state === 'landed' && c.esc > 1));
  for (const c of S.convoys) if (c.state === 'sail') {
    c.dist += c.speed;
    Object.assign(c, convoyPos(c));
    if (S.allyState === 'arrived') hitConvoy(S, c, 35);
  }
  // 潛艦移動
  for (const u of S.units) if (u.alive && u.type === 'sub') {
    const c = active.filter(c => c.state === 'sail').sort((a, b) => km(u, a) - km(u, b))[0];
    if (c && km(u, c) < 300 && km(u, c) > 15) {
      const n = towards(u, c, 12);
      if (!isLand(n.lon, n.lat)) { u.lon = n.lon; u.lat = n.lat; }
    }
  }
  // 我方射擊
  for (const u of S.units) {
    if (!u.alive || u.move || !FIRE[u.type]) continue;
    if (u.cd > 0) { u.cd--; continue; }
    const F = FIRE[u.type];
    if (u.type === 'fighter' && (S.air < 20 || S.airbase[u.anchor] > 0.7)) continue;
    const c = active.filter(c => km(u, c) <= F.r).sort((a, b) => km(u, a) - km(u, b))[0];
    if (!c) continue;
    u.cd = F.cd; u.exposed = S.t + 3;
    let dmg = F.dmg * hpf(u) * (0.8 + 0.4 * S.R()) * (1 + rb);
    if (u.type === 'fighter') { dmg *= (1 - S.airbase[u.anchor]) * (0.4 + S.air / 100); damageUnit(S, u, (100 - S.air) / 100 * 8 * S.R(), '敵方艦隊防空'); }
    const ok = S.R() >= c.esc / (c.esc + 400) * 0.6;
    ev(S, { type: 'shot', kind: u.type, from: { lon: u.lon, lat: u.lat }, to: { lon: c.lon, lat: c.lat }, ok });
    if (ok) hitConvoy(S, c, dmg);
    if (u.type === 'sub' && S.R() < 0.15 + c.esc / (c.esc + 300) * 0.3) damageUnit(S, u, 40, '敵方反潛');
  }
  // 敵方護航艦隊反擊我方艦艇
  for (const u of S.units) if (u.alive && (u.type === 'frigate' || u.type === 'fac')) {
    const threat = active.filter(c => c.esc > 0 && km(u, c) <= 120).reduce((s, c) => s + c.esc, 0);
    if (threat > 0) damageUnit(S, u, threat / 100 * 1.2 * S.R() * (u.type === 'fac' ? 0.5 : 1), '敵艦攻擊');
  }
  for (const c of S.convoys) if (c.state === 'sail' && c.dist >= c.total) land(S, c);
}
function hitConvoy(S, c, dmg) {
  if (c.state === 'sail') {
    const toEsc = c.esc > 0 ? Math.min(c.esc, dmg * 0.35) : 0;
    const toTr = Math.min(c.trans, dmg - toEsc);
    c.esc -= toEsc; c.trans -= toTr;
    lossToEnemy(S, toEsc, 'fleet'); lossToEnemy(S, toTr, 'troops');
    if (c.trans <= 5) {
      lossToEnemy(S, c.trans, 'troops'); c.trans = 0; c.state = 'sunk'; S.stats.sunk++;
      S.resilience = Math.min(100, S.resilience + 3);
      ev(S, { type: 'sunk', lon: c.lon, lat: c.lat });
      news(S, 'major', `【快訊】駛向${beachById(c.beach).name}的敵方登陸船團遭我軍重創，殘部潰散`);
    }
  } else {
    const d = Math.min(c.esc, dmg); c.esc -= d; lossToEnemy(S, d, 'fleet');
  }
}
function land(S, c) {
  const b = beachById(c.beach), z = S.zones[b.zone];
  for (const u of S.units) if (u.alive && u.type === 'mine' && u.anchor === b.id) {
    const d = 45 * (0.7 + 0.6 * S.R()); lossToEnemy(S, Math.min(c.trans, d), 'troops'); c.trans = Math.max(0, c.trans - d);
    u.alive = false; ev(S, { type: 'explosion', lon: b.sea.lon, lat: b.sea.lat });
  }
  let fire = 0;
  for (const u of alive(S)) if (!u.move && ['inf', 'armor', 'reserve', 'art', 'mlrs'].includes(u.type) && km(u, b) <= 30) fire += UNIT_TYPES[u.type].atk * hpf(u) * 0.6;
  const d = Math.min(c.trans, fire * (0.8 + 0.4 * S.R())); lossToEnemy(S, d, 'troops'); c.trans -= d;
  const landed = c.trans; c.trans = 0;
  if (landed < 25) {
    c.state = 'failed'; lossToEnemy(S, landed, 'troops');
    news(S, 'major', `【快訊】敵軍於${b.name}搶灘失敗，灘頭守軍擊退登陸部隊`);
    S.resilience = Math.min(100, S.resilience + 3);
  } else {
    c.state = 'landed'; z.enemy += landed; S.stats.landed += landed / 100;
    ev(S, { type: 'landing', lon: b.lon, lat: b.lat });
    news(S, 'major', `【快訊】敵軍於${b.name}（${ZONES[b.zone].name}）搶灘登陸，上岸兵力約 ${(landed / 100).toFixed(1)} 個旅`);
  }
}

// ---------------- 地面作戰 ----------------
function groundWar(S) {
  const airTW = 0.7 + S.air / 100 * 0.6, airEN = 1.3 - S.air / 100 * 0.6;
  for (const zid of Object.keys(S.zones)) {
    const z = S.zones[zid];
    if (z.enemy <= 0) continue;
    const zp = ZONE_POS[zid], def = ZONE_TYPES[ZONES[zid].type].def;
    const here = S.units.filter(u => u.alive && !u.move && u.zone === zid);
    const land = here.filter(u => GROUND_ATK[u.type]);
    let twAtk = land.reduce((s, u) => s + GROUND_ATK[u.type] * hpf(u), 0) + (z.owner === 'TW' ? z.gar * 0.25 : 0);
    for (const u of alive(S)) {
      if (u.move || u.zone === zid) continue;
      if ((u.type === 'art' && km(u, zp) <= 30) || (u.type === 'mlrs' && km(u, zp) <= 70)) twAtk += UNIT_TYPES[u.type].atk * 0.5 * hpf(u);
      if (u.type === 'drone' && km(u, zp) <= 150) twAtk += UNIT_TYPES[u.type].atk * 0.3 * hpf(u);
    }
    if (S.allyState === 'arrived') twAtk += 35;
    twAtk *= airTW;
    const naval = S.convoys.filter(c => c.state === 'landed' && beachById(c.beach).zone === zid).reduce((s, c) => s + c.esc * 0.12, 0);
    const enAtk = (z.enemy / 100 * 40 + naval) * airEN;
    const dE = twAtk * 0.05 * (0.8 + 0.4 * S.R()) / (1 + (z.owner === 'PRC' ? def * 0.15 : 0));
    const dT = enAtk * 0.05 * (0.8 + 0.4 * S.R()) / (1 + (z.owner === 'TW' ? def * 0.25 : 0));
    const supply = z.enemy * 0.004 * (S.sea / 100) + (S.allyState === 'arrived' ? z.enemy * 0.008 : 0);
    const lost = Math.min(z.enemy, dE + supply);
    z.enemy -= lost; lossToEnemy(S, lost, 'troops');
    const garW = z.owner === 'TW' && z.gar > 0 ? 1.5 : 0;
    const wsum = here.reduce((s, u) => s + (GROUND_ATK[u.type] ? 1 : 0.4), 0) + garW;
    if (wsum > 0) {
      for (const u of here) damageUnit(S, u, dT * (GROUND_ATK[u.type] ? 1 : 0.4) / wsum, '地面戰鬥');
      if (garW) z.gar = Math.max(0, z.gar - dT * garW / wsum);
    }
    if (S.R() < 0.5) ev(S, { type: 'battle', lon: zp.lon + (S.R() - 0.5) * 0.15, lat: zp.lat + (S.R() - 0.5) * 0.12 });
    const name = ZONES[zid].name;
    if (z.owner === 'TW' && z.enemy > 30 && z.gar <= 0 && !S.units.some(u => u.alive && !u.move && u.zone === zid && GROUND_ATK[u.type])) {
      z.owner = 'PRC';
      for (const u of S.units) if (u.alive && !u.move && u.zone === zid) damageUnit(S, u, 999, '敵軍佔領');
      const ty = ZONES[zid].type;
      S.resilience -= ty === 'capital' ? 40 : ty === 'urban' ? 10 : ty === 'island' ? 5 : 6;
      S.will = Math.min(100, S.will + (ty === 'capital' ? 10 : 3));
      ev(S, { type: 'captured', lon: zp.lon, lat: zp.lat });
      news(S, 'major', `【快訊】${name}失守，敵軍控制當地`);
    } else if (z.enemy <= 5) {
      lossToEnemy(S, z.enemy, 'troops'); z.enemy = 0;
      if (z.owner === 'PRC') { z.owner = 'TW'; z.gar = z.gar0 * 0.3; S.resilience = Math.min(100, S.resilience + 6); news(S, 'major', `【快訊】我軍收復${name}`); }
      else news(S, 'alert', `【戰況】我軍殲滅${name}的登陸部隊`);
    }
  }
  // 敵軍推進
  if (S.t % 6 === 0) for (const zid of Object.keys(S.zones)) {
    const z = S.zones[zid];
    if (z.owner !== 'PRC' || z.enemy < 150 || z.advCd > S.t) continue;
    const cand = NEIGHBORS[zid].filter(n => S.zones[n].owner === 'TW').map(n => {
      const str = S.units.filter(u => u.alive && u.zone === n && GROUND_ATK[u.type]).reduce((s, u) => s + GROUND_ATK[u.type] * hpf(u), 0);
      return { n, s: ZONE_VALUE[ZONES[n].type] - (str + S.zones[n].gar * 0.25) / 80 + S.R() };
    }).sort((a, b) => b.s - a.s)[0];
    if (!cand) continue;
    const hp = z.enemy * 0.5; z.enemy -= hp; z.advCd = S.t + 24;
    const dur = ZONES[cand.n].type === 'mountain' || ZONES[zid].type === 'mountain' ? 30 : 18;
    S.groups.push({ from: zid, to: cand.n, hp, t0: S.t, dur, lon: ZONE_POS[zid].lon, lat: ZONE_POS[zid].lat });
    news(S, 'alert', `【戰況】敵軍自${ZONES[zid].name}向${ZONES[cand.n].name}推進`);
  }
  for (const g of S.groups) {
    const k = Math.min(1, (S.t - g.t0) / g.dur);
    Object.assign(g, lerpPos(ZONE_POS[g.from], ZONE_POS[g.to], k));
    if (S.air > 55) { const d = g.hp * 0.01 * (S.air - 55) / 45; g.hp -= d; lossToEnemy(S, d, 'troops'); }
    if (k >= 1) { S.zones[g.to].enemy += g.hp; g.done = true; }
  }
  S.groups = S.groups.filter(g => !g.done && g.hp > 1);
}

// 我方增援與反擊（每 6 小時）
function hopsBetween(S, a, b) {
  const seen = { [a]: 0 }, q = [a];
  while (q.length) { const x = q.shift(); if (x === b) return seen[x]; for (const n of NEIGHBORS[x]) if (seen[n] === undefined && (S.zones[n].owner === 'TW' || n === b)) { seen[n] = seen[x] + 1; q.push(n); } }
  return 99;
}
function sendUnit(S, u, zid, hops) {
  const to = offsetKm(ZONE_POS[zid], (S.R() - 0.5) * 16, (S.R() - 0.5) * 16);
  u.move = { from: { lon: u.lon, lat: u.lat }, to, toZone: zid, t0: S.t, dur: Math.max(6, hops * 10 * (S.air < 40 ? 1.4 : 1)) };
  u.zone = null;
}
function reinforce(S) {
  const strength = zid => S.units.filter(u => u.alive && !u.move && u.zone === zid && GROUND_ATK[u.type]).reduce((s, u) => s + GROUND_ATK[u.type] * hpf(u), 0) + (S.zones[zid].owner === 'TW' ? S.zones[zid].gar * 0.25 : 0);
  const threatened = Object.keys(S.zones).filter(z => S.zones[z].enemy > 0 && !OUTER.includes(z)).sort((a, b) => S.zones[b].enemy - S.zones[a].enemy);
  for (const zid of threatened) {
    const z = S.zones[zid];
    if (z.owner === 'PRC' && z.enemy > 140) continue;          // 只反擊兵力較弱的佔領區
    const need = z.enemy / 100 * 40 * 1.1;
    if (strength(zid) + S.units.filter(u => u.move?.toZone === zid).length * 40 >= need) continue;
    const avail = S.units.filter(u => u.alive && !u.move && (u.type === 'armor' || u.type === 'inf') && u.zone && u.zone !== zid
      && !OUTER.includes(u.zone) && ZONES[u.zone].type !== 'island' && S.zones[u.zone].enemy === 0
      && !(u.zone === 'taipei' && S.units.filter(x => x.alive && x.zone === 'taipei' && GROUND_ATK[x.type]).length <= 2))
      .map(u => ({ u, h: hopsBetween(S, u.zone, zid) })).filter(x => x.h <= 3)
      .sort((a, b) => (a.u.type === 'armor' ? -1 : 0) - (b.u.type === 'armor' ? -1 : 0) || a.h - b.h);
    for (const { u, h } of avail.slice(0, 2)) sendUnit(S, u, zid, h);
    if (avail.length) news(S, 'info', `【戰況】我軍調動預備部隊增援${ZONES[zid].name}`);
  }
  for (const u of S.units) if (u.alive && u.move) {
    const k = Math.min(1, (S.t - u.move.t0) / u.move.dur);
    Object.assign(u, lerpPos(u.move.from, u.move.to, k));
    if (k >= 1) { u.zone = u.move.toZone; u.move = null; }
  }
}

// ---------------- 協防 ----------------
function allyCheck(S) {
  if (S.allyState === 'pending' && S.zones.taipei.owner === 'PRC') { S.allyState = 'cancelled'; news(S, 'major', '【快訊】首都失守，協防行動取消'); }
  if (S.allyState === 'pending' && S.t === S.allyDay * 24) {
    const p = (S.allyLevel >= 3 ? 0.75 : 0.55) + (S.resilience - 50) / 250;
    if (S.R() < p) { S.allyState = 'arrived'; S.will -= 20; ev(S, { type: 'ally' }); news(S, 'major', '【快訊】日美協防部隊抵達，聯合空海兵力投入戰場'); }
    else { S.allyState = 'declined'; news(S, 'major', '【快訊】協防請求未獲正面回應，我軍持續獨力作戰'); }
  }
  if (S.allyState === 'arrived') { S.enemy.airHp = Math.max(0, S.enemy.airHp - 15); S.will -= 0.5; }
}

// ---------------- 主迴圈 ----------------
function stepSim(S) {
  if (S.over) return [];
  S.events = [];
  const t = S.t;
  const si = SALVO_T.indexOf(t);
  if (si >= 0 && si < S.enemy.salvos) { S.enemy.salvoN = si + 1; salvo(S); }
  if (t === 4 && S.plan.outer) {
    for (const z of OUTER) { S.zones[z].enemy += S.plan.outer / 2 * 100; ev(S, { type: 'landing', ...ZONE_POS[z] }); }
    news(S, 'major', '【快訊】敵軍同時對金門、馬祖發動登陸作戰');
  }
  if (t === 10) news(S, 'alert', '【快訊】衛星影像顯示對岸港口大批船艦升火待發');
  if (t === 20) launchWave(S, S.plan.w1, chooseBeaches(S, S.plan.mainBrig >= 12 ? 3 : 2), 0.7, 1);
  if (t === 70 && S.plan.w2 > 0) {
    const heads = BEACHES.filter(b => !OUTER.includes(b.zone) && (S.zones[b.zone].enemy > 0 || S.zones[b.zone].owner === 'PRC'));
    const uniq = []; for (const b of heads) if (!uniq.some(x => x.zone === b.zone)) uniq.push(b);
    launchWave(S, S.plan.w2, uniq.length ? uniq.slice(0, 2) : chooseBeaches(S, 2), 0.3, 2);
    S.plan.launched2 = true;
  }
  airWar(S);
  navalWar(S);
  groundWar(S);
  if (t % 6 === 3) reinforce(S); else for (const u of S.units) if (u.alive && u.move) {
    const k = Math.min(1, (S.t - u.move.t0) / u.move.dur);
    Object.assign(u, lerpPos(u.move.from, u.move.to, k));
    if (k >= 1) { u.zone = u.move.toZone; u.move = null; }
  }
  allyCheck(S);
  // 指標
  const nav = alive(S).reduce((s, u) => s + ({ asm: 1, frigate: 0.8, fac: 0.6, sub: 1, mlrs: 0.4 }[u.type] || 0) * u.hp, 0) + (S.allyState === 'arrived' ? 300 : 0);
  const en = S.convoys.reduce((s, c) => s + (c.state === 'sail' || c.state === 'landed' ? c.esc : 0), 0) + S.enemy.fleets0 * 20;
  S.sea += (100 * nav / (nav + en + 1) - S.sea) * 0.2;
  S.resilience -= 0.03;
  if (t > 120) S.will -= 0.12;
  for (const k in S.airbase) S.airbase[k] = Math.max(0, S.airbase[k] - 0.01);
  S.resilience = Math.max(0, S.resilience); S.will = Math.max(0, S.will);
  checkEnd(S);
  S.t++;
  return S.events;
}

function phaseName(S) {
  if (S.over) return '戰爭結束';
  if (S.convoys.some(c => c.state === 'sail')) return S.convoys.some(c => c.state === 'landed') ? '渡海與陸戰' : '渡海作戰';
  if (Object.entries(S.zones).some(([z, v]) => v.enemy > 0 && !OUTER.includes(z))) return '陸上作戰';
  return S.t < 24 ? '飛彈與制空作戰' : '對峙';
}

function checkEnd(S) {
  const main = Object.keys(S.zones).filter(z => !OUTER.includes(z));
  const lostZones = main.filter(z => S.zones[z].owner === 'PRC');
  const names = lostZones.map(z => ZONES[z].name).join('、');
  if (S.zones.taipei.owner === 'PRC') return finish(S, lostZones.length >= 5 ? '守方大敗' : '守方敗', `首都失守（敵方控制 ${lostZones.length} 個防區）`);
  if (S.resilience <= 0) return finish(S, '守方敗', '社會韌性崩潰，被迫談判停火');
  if (S.will <= 0) return finish(S, lostZones.length ? '守方勝' : '守方大勝', '攻方傷亡過大，被迫撤軍');
  const enemyLeft = main.reduce((s, z) => s + S.zones[z].enemy, 0)
    + S.convoys.reduce((s, c) => s + (c.state === 'sail' ? c.trans : 0), 0)
    + S.groups.reduce((s, g) => s + g.hp, 0) + (S.plan.launched2 ? 0 : S.plan.w2 * 100);
  if (S.t > 30 && enemyLeft < 20 && !lostZones.length) {
    const frac = S.stats.landed / S.plan.mainBrig;
    return finish(S, frac < 0.25 ? '守方大勝' : '守方勝', frac < 0.25 ? '渡海失敗：登陸部隊大多在海上被殲滅' : '登陸部隊全數被殲滅');
  }
  if (S.t >= MAX_T - 1) {
    if (!lostZones.length) return finish(S, '守方勝', `撐過 ${MAX_DAYS} 天，敵軍未能建立據點`);
    if (lostZones.length <= 2) return finish(S, '僵持停火', `${MAX_DAYS} 天後雙方停火，敵方控制：${names}`);
    return finish(S, '守方敗', `${MAX_DAYS} 天後敵方控制 ${lostZones.length} 個防區：${names}`);
  }
}
const GRADE_SCORE = { '守方大勝': 90, '守方勝': 72, '僵持停火': 50, '守方敗': 28, '守方大敗': 10 };
function finish(S, grade, reason) {
  S.over = true;
  const score = Math.round(Math.max(0, Math.min(100, GRADE_SCORE[grade] + (S.resilience - 50) / 10 + (S.stats.enemyLost - S.stats.twLost) / 4)));
  S.result = { grade, reason, t: S.t, score, outerLost: OUTER.filter(z => S.zones[z].owner === 'PRC').map(z => ZONES[z].name) };
  news(S, 'major', `【快訊】${grade}：${reason}`);
}
