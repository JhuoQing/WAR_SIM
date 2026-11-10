'use strict';
/* 海峽戰術 WAR_SIM v0.1
 * 模擬邏輯（規則、AI）與畫面（Canvas/DOM）分開，畫面部分在 HEADLESS 時不執行，
 * 方便用 node 跑 AI 對 AI 測試平衡。 */
const HEADLESS = typeof document === 'undefined';

// ================= 設定與資料 =================
const COLS = 22, ROWS = 14, SIZE = 24, SQ3 = Math.sqrt(3);
const MAX_ROUNDS = 12, DEPLOY_TIME = 60, TURN_TIME = 60;
const BUDGET = { TW: 180, PRC: 200 };
const SIDE_NAME = { TW: '守方（藍）', PRC: '攻方（紅）' };

const TERRAIN = {
  sea:      { name: '海面', color: '#1c4a73', def: 0 },
  beach:    { name: '海灘', color: '#d4c084', def: 0 },
  plain:    { name: '平原', color: '#5b8a46', def: 0 },
  hill:     { name: '丘陵', color: '#7a7a45', def: 1 },
  mountain: { name: '山地', color: '#665643', def: 3 },
  city:     { name: '城市', color: '#868c94', def: 2 },
};

const UNIT_TYPES = {
  inf:  { name: '步兵', short: '步', domain: 'land',  mv: 3, atk: 4, minR: 1, maxR: 1, hp: 10, def: 2, cost: 10, sides: ['TW', 'PRC'], desc: '便宜、能上山、守城主力' },
  tank: { name: '戰車', short: '車', domain: 'land',  mv: 4, atk: 7, minR: 1, maxR: 1, hp: 14, def: 4, cost: 25, sides: ['TW', 'PRC'], desc: '高攻高防，山地難行' },
  art:  { name: '砲兵', short: '砲', domain: 'land',  mv: 2, atk: 5, minR: 2, maxR: 3, hp: 8,  def: 1, cost: 20, sides: ['TW', 'PRC'], desc: '射程 2-3，移動後不能射擊', noMoveFire: true },
  asm:  { name: '反艦飛彈車', short: '飛', domain: 'land', mv: 2, atk: 2, atkNaval: 10, minR: 1, maxR: 4, hp: 7, def: 1, cost: 25, sides: ['TW'], desc: '射程 4，對海上目標傷害極高' },
  dd:   { name: '驅逐艦', short: '艦', domain: 'naval', mv: 4, atk: 5, minR: 1, maxR: 3, hp: 14, def: 3, cost: 35, sides: ['PRC'], desc: '只能在海上，射程 3 支援登陸' },
};

// ================= 地圖 =================
// 西側為海峽，東側為島嶼。COAST[r] = 該列的海岸格。
const COAST = [12, 12, 11, 11, 10, 10, 11, 11, 10, 11, 12, 12, 12, 13];
const OBJECTIVES = [
  { name: '港口', c: 12, r: 3 },
  { name: '市區', c: 16, r: 7 },
  { name: '機場', c: 14, r: 11 },
];
const MAP = [];
for (let r = 0; r < ROWS; r++) {
  MAP[r] = [];
  for (let c = 0; c < COLS; c++) {
    let t;
    if (c < COAST[r]) t = 'sea';
    else if (c === COAST[r]) t = (r >= 2 && r <= 11) ? 'beach' : 'hill';
    else t = 'plain';
    if (c >= 20 || (c === 19 && (r <= 4 || r >= 10)) || (c === 18 && (r <= 1 || r >= 12))) t = 'mountain';
    MAP[r][c] = t;
  }
}
for (const [c, r] of [[15, 4], [17, 9], [14, 6], [18, 5], [13, 8], [19, 7]]) MAP[r][c] = 'hill';
MAP[3][17] = 'city';
for (const o of OBJECTIVES) MAP[o.r][o.c] = 'city';

const ALL_TILES = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) ALL_TILES.push({ c, r });

// ================= 六角格數學（odd-r 偏移座標，尖頂六角） =================
const DIRS = [
  [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]],
  [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]],
];
const inBounds = p => p.c >= 0 && p.c < COLS && p.r >= 0 && p.r < ROWS;
const neighbors = (c, r) => DIRS[r & 1].map(([dc, dr]) => ({ c: c + dc, r: r + dr })).filter(inBounds);
function dist(a, b) {
  const aq = a.c - (a.r - (a.r & 1)) / 2, bq = b.c - (b.r - (b.r & 1)) / 2;
  const dq = aq - bq, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
const key = (c, r) => c + ',' + r;

// 每格到最近海面的距離（AI 部署用）
const SEA_DIST = ALL_TILES.reduce((m, p) => {
  let best = 99;
  for (const q of ALL_TILES) if (MAP[q.r][q.c] === 'sea') best = Math.min(best, dist(p, q));
  m[key(p.c, p.r)] = best; return m;
}, {});

// ================= 遊戲狀態 =================
const S = {};
function newState(player) {
  Object.assign(S, {
    phase: 'deploy', player, ai: player === 'TW' ? 'PRC' : 'TW', autoBoth: false,
    units: [], nextId: 1, budget: { ...BUDGET },
    turn: 'PRC', round: 1, selected: null, placing: null,
    timer: DEPLOY_TIME, timerOn: true, reach: new Map(), targets: [],
    logs: [], effects: [], busy: false, winner: null, hover: null,
    objectives: OBJECTIVES.map(o => ({ ...o, owner: 'TW' })),
  });
}

const unitAt = (c, r) => S.units.find(u => u.c === c && u.r === r && u.hp > 0);
const enemiesOf = side => S.units.filter(u => u.side !== side && u.hp > 0);
const isSea = (c, r) => MAP[r][c] === 'sea';
const embarked = u => UNIT_TYPES[u.type].domain === 'land' && isSea(u.c, u.r);

function addUnit(type, side, c, r) {
  const u = { id: S.nextId++, type, side, c, r, hp: UNIT_TYPES[type].hp, moved: false, attacked: false, anim: null };
  S.units.push(u); return u;
}
function log(text, cls = '') { S.logs.push({ text, cls }); if (S.logs.length > 200) S.logs.shift(); }

// ================= 規則：移動 =================
function moveCost(u, from, to) {
  const T = UNIT_TYPES[u.type], tf = MAP[from.r][from.c], tt = MAP[to.r][to.c];
  if (T.domain === 'naval') return tt === 'sea' ? 1 : Infinity;
  if (tf === 'sea') {                       // 搭載中
    if (tt === 'sea') return 1;
    if (tt === 'beach') return 'land';      // 登陸：抵達後停止
    return Infinity;
  }
  if (tt === 'sea') return Infinity;
  const vehicle = u.type !== 'inf';
  if (tt === 'mountain') return vehicle ? 3 : 2;
  if (tt === 'hill') return vehicle ? 2 : 1;
  return 1;
}
const adjacentEnemy = (c, r, side) => neighbors(c, r).some(n => { const e = unitAt(n.c, n.r); return e && e.side !== side; });

function reachable(u) {
  const T = UNIT_TYPES[u.type];
  const budget = (T.domain === 'land' && isSea(u.c, u.r)) ? 3 : T.mv;
  const best = new Map([[key(u.c, u.r), 0]]);
  const open = [{ c: u.c, r: u.r, g: 0, stop: false }];
  const result = new Map();
  while (open.length) {
    open.sort((a, b) => a.g - b.g);
    const cur = open.shift();
    if (cur.stop) continue;
    for (const n of neighbors(cur.c, cur.r)) {
      let cost = moveCost(u, cur, n), stop = false;
      if (cost === 'land') { cost = 1; stop = true; }
      if (cost === Infinity) continue;
      const g = cur.g + cost;
      if (g > budget) continue;
      const occ = unitAt(n.c, n.r);
      if (occ && occ.side !== u.side) continue;
      if (T.domain === 'land' && adjacentEnemy(n.c, n.r, u.side)) stop = true; // 控制區
      const k = key(n.c, n.r);
      if (best.has(k) && best.get(k) <= g) continue;
      best.set(k, g);
      if (!occ) result.set(k, { c: n.c, r: n.r });
      open.push({ c: n.c, r: n.r, g, stop });
    }
  }
  return result;
}

// ================= 規則：戰鬥 =================
function canAttackFrom(u, c, r, target) {
  const T = UNIT_TYPES[u.type];
  if (T.domain === 'land' && isSea(c, r)) return false;     // 搭載中不能攻擊
  const d = dist({ c, r }, target);
  return d >= T.minR && d <= T.maxR;
}
function targetsFor(u) {
  const T = UNIT_TYPES[u.type];
  if (u.attacked || (T.noMoveFire && u.moved)) return [];
  return enemiesOf(u.side).filter(e => canAttackFrom(u, u.c, u.r, e));
}
function damage(att, attHp, def, defC, defR, counter, rnd) {
  const A = UNIT_TYPES[att.type], D = UNIT_TYPES[def.type];
  const tile = MAP[defR][defC], onSea = tile === 'sea';
  let atk = (A.atkNaval !== undefined && onSea) ? A.atkNaval : A.atk;
  atk *= 0.5 + 0.5 * Math.max(0, attHp) / A.hp;   // 受損單位火力下降
  if (counter) atk *= 0.5;
  const dv = onSea ? (D.domain === 'land' ? Math.max(0, D.def - 2) : D.def) : D.def + TERRAIN[tile].def;
  return Math.max(1, Math.round(atk + rnd - dv * 0.6));
}

function doAttack(att, def) {
  const dmg = damage(att, att.hp, def, def.c, def.r, false, Math.random() * 3);
  def.hp -= dmg; att.attacked = true; att.moved = true;
  fxShot(att, def); fxText(def, '-' + dmg, '#ffdf6b');
  log(`${UNIT_TYPES[att.type].name} 攻擊 ${UNIT_TYPES[def.type].name}，造成 ${dmg} 傷害`, att.side);
  if (def.hp <= 0) kill(def);
  else if (canAttackFrom(def, def.c, def.r, att)) {
    const c = damage(def, def.hp, att, att.c, att.r, true, Math.random() * 3);
    att.hp -= c; fxText(att, '-' + c, '#ff9b6b');
    log(`　${UNIT_TYPES[def.type].name} 反擊 ${c}`, def.side);
    if (att.hp <= 0) kill(att);
  }
  updateObjectives();
}
function kill(u) {
  u.hp = 0;
  S.units = S.units.filter(x => x !== u);
  if (S.selected === u) S.selected = null;
  fxText(u, '殲滅', '#ff5555');
  log(`${SIDE_NAME[u.side]} 的 ${UNIT_TYPES[u.type].name} 被殲滅`, 'sys');
  if (!S.units.some(x => x.side === 'PRC')) setWinner('TW', '攻方部隊全數殲滅');
  else if (!S.units.some(x => x.side === 'TW')) setWinner('PRC', '守方部隊全數殲滅');
}
function moveUnit(u, c, r) {
  const wasSea = isSea(u.c, u.r);
  u.anim = { from: { c: u.c, r: u.r }, t0: now() };
  u.c = c; u.r = r; u.moved = true;
  if (wasSea && !isSea(c, r)) log(`${UNIT_TYPES[u.type].name} 搶灘登陸！`, u.side);
  updateObjectives();
}
function updateObjectives() {
  for (const o of S.objectives) {
    const u = unitAt(o.c, o.r);
    if (u && UNIT_TYPES[u.type].domain === 'land' && o.owner !== u.side) {
      o.owner = u.side;
      log(`${SIDE_NAME[u.side]} 佔領了「${o.name}」`, 'sys');
    }
  }
}
const prcObjCount = () => S.objectives.filter(o => o.owner === 'PRC').length;

function setWinner(side, reason) {
  if (S.winner) return;
  S.winner = side; S.phase = 'over'; S.busy = false;
  log(`★ ${SIDE_NAME[side]} 獲勝：${reason}`, 'sys');
  showResult(side, reason);
}

// ================= 回合流程 =================
function startBattle() {
  S.phase = 'battle'; S.turn = 'PRC'; S.round = 1; S.timer = TURN_TIME;
  for (const u of S.units) { u.moved = false; u.attacked = false; }
  log(`— 第 1 回合・${SIDE_NAME.PRC} 行動 —`, 'sys');
  ui();
  if (S.turn === S.ai || S.autoBoth) return runAI(S.turn);
}
function endTurn() {
  if (S.winner) return;
  S.selected = null; S.reach = new Map(); S.targets = [];
  if (S.turn === 'TW') {           // 一輪結束
    const n = prcObjCount();
    if (n === 3) return setWinner('PRC', '佔領全部據點');
    if (S.round >= MAX_ROUNDS) {
      return n >= 2 ? setWinner('PRC', `第 ${MAX_ROUNDS} 回合結束時佔有 ${n} 個據點`)
                    : setWinner('TW', `撐過 ${MAX_ROUNDS} 回合，攻方只佔 ${n} 個據點`);
    }
    S.round++;
  }
  S.turn = S.turn === 'PRC' ? 'TW' : 'PRC';
  for (const u of S.units) if (u.side === S.turn) { u.moved = false; u.attacked = false; }
  S.timer = TURN_TIME;
  log(`— 第 ${S.round} 回合・${SIDE_NAME[S.turn]} 行動 —`, 'sys');
  ui();
  if (S.turn === S.ai || S.autoBoth) return runAI(S.turn);
}

// ================= AI（分數評估法） =================
const sleep = ms => HEADLESS ? Promise.resolve() : new Promise(r => setTimeout(r, ms));
const nearestObj = (p, f = () => true) => S.objectives.filter(f).sort((a, b) => dist(p, a) - dist(p, b))[0];
const nearestEnemy = (p, side) => enemiesOf(side).sort((a, b) => dist(p, a) - dist(p, b))[0];
const adjEnemies = (p, side) => enemiesOf(side).filter(e => dist(p, e) === 1).length;

function threatAt(u, p) {   // 敵人從現在位置能打到 p 的預估總傷害
  let t = 0;
  for (const e of enemiesOf(u.side)) if (canAttackFrom(e, e.c, e.r, p)) t += damage(e, e.hp, u, p.c, p.r, false, 1.5);
  return t;
}
function attackValue(u, p, e) {
  const dmg = damage(u, u.hp, e, e.c, e.r, false, 1.5);
  let v = dmg * 1.2;
  if (dmg >= e.hp) v += 10 + UNIT_TYPES[e.type].cost / 5;
  else if (canAttackFrom(e, e.c, e.r, p)) v -= damage(e, e.hp - dmg, u, p.c, p.r, true, 1.5) * 0.8;
  return v;
}
function posScore(u, p) {
  const T = UNIT_TYPES[u.type], tile = MAP[p.r][p.c];
  let s = 0;
  if (u.side === 'PRC') {
    if (T.domain === 'naval') {
      const e = nearestEnemy(p, u.side);
      if (e) s -= Math.max(0, dist(p, e) - T.maxR) * 1.0;
      s -= threatAt(u, p) * 0.5;
    } else {
      const obj = nearestObj(p, o => o.owner !== 'PRC') || nearestObj(p);
      s -= dist(p, obj) * 2;
      if (S.objectives.some(o => o.c === p.c && o.r === p.r)) s += 8;
      if (tile !== 'sea') s += TERRAIN[tile].def * 0.8;
      else s -= threatAt(u, p) * 0.3;
      if (T.noMoveFire) s -= adjEnemies(p, u.side) * 3;
    }
  } else {
    const obj = nearestObj(p);
    const d = dist(p, obj);
    s -= Math.max(0, d - 1) * 1.2;
    if (d === 0) s += obj.owner === 'PRC' ? 10 : 3;
    s += TERRAIN[tile].def;
    if (T.noMoveFire || u.type === 'asm') s -= adjEnemies(p, u.side) * 3;
  }
  return s;
}
function aiAct(u) {
  const T = UNIT_TYPES[u.type];
  const opts = [{ c: u.c, r: u.r, move: false }];
  for (const p of reachable(u).values()) opts.push({ c: p.c, r: p.r, move: true });
  let best = null;
  for (const o of opts) {
    let av = 0, tgt = null;
    if (!(T.noMoveFire && o.move)) {
      for (const e of enemiesOf(u.side)) {
        if (!canAttackFrom(u, o.c, o.r, e)) continue;
        const v = attackValue(u, o, e);
        if (v > av) { av = v; tgt = e; }
      }
    }
    const s = av + posScore(u, o) + Math.random() * 0.3;
    if (!best || s > best.s) best = { ...o, s, tgt };
  }
  if (best.move) moveUnit(u, best.c, best.r);
  if (best.tgt && best.tgt.hp > 0 && !S.winner) doAttack(u, best.tgt);
}
async function runAI(side) {
  S.busy = true; ui();
  await sleep(500);
  const pr = { art: 0, asm: 0, dd: 0, tank: 1, inf: 2 };
  const order = S.units.filter(u => u.side === side).sort((a, b) => pr[a.type] - pr[b.type]);
  for (const u of order) {
    if (S.winner) break;
    if (u.hp <= 0) continue;
    aiAct(u); ui();
    await sleep(380);
  }
  S.busy = false;
  if (!S.winner) return endTurn();
}

// ================= 部署 =================
function inZone(side, c, r) {
  return side === 'PRC' ? (c <= 3 && isSea(c, r)) : !isSea(c, r);
}
function deployScore(side, t, p) {
  const tile = MAP[p.r][p.c];
  const own = S.units.filter(u => u.side === side && dist(u, p) <= 1).length;
  let s = -own * 0.8;
  if (side === 'PRC') {
    s += p.c * 1.2 - Math.abs(p.r - 6.5) * 0.3;
    if (t !== 'dd' && p.c === 3) s -= 0.5;
  } else {
    const dSea = SEA_DIST[key(p.c, p.r)], dObj = dist(p, nearestObj(p));
    if (t === 'inf') s += -dObj * 1.5 - Math.abs(dSea - 1) * 0.5;
    if (t === 'tank') s += -Math.abs(dObj - 1) - Math.abs(dSea - 2) * 0.5 - (tile === 'mountain' ? 2 : 0);
    if (t === 'art') s += -Math.abs(dSea - 3) - dObj * 0.5;
    if (t === 'asm') s += -Math.abs(dSea - 2.5) * 1.2 - dObj * 0.3;
    s += TERRAIN[tile].def * 0.3;
  }
  return s;
}
function aiDeploy(side) {
  const plan = side === 'PRC'
    ? ['dd', 'dd', 'tank', 'tank', 'art', 'inf', 'inf', 'inf', 'inf', 'inf', 'inf']
    : ['asm', 'asm', 'asm', 'art', 'art', 'tank', 'inf', 'inf', 'inf', 'inf'];
  for (const t of plan) {
    const cost = UNIT_TYPES[t].cost;
    if (S.budget[side] < cost) continue;
    let best = null, bs = -1e9;
    for (const p of ALL_TILES) {
      if (unitAt(p.c, p.r) || !inZone(side, p.c, p.r)) continue;
      const s = deployScore(side, t, p) + Math.random() * 1.5;
      if (s > bs) { bs = s; best = p; }
    }
    if (best) { addUnit(t, side, best.c, best.r); S.budget[side] -= cost; }
  }
}
function finishDeploy() {
  if (S.phase !== 'deploy') return;
  if (!S.units.some(u => u.side === S.player)) aiDeploy(S.player);   // 沒放任何單位就幫忙自動部署
  aiDeploy(S.ai);
  S.phase = 'countdown'; S.placing = null;
  log(`部署結束。${SIDE_NAME.PRC} 先攻。`, 'sys');
  ui();
  countdown(3);
}

// ================= 畫面（瀏覽器才執行） =================
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
let cv, ctx, terrainCanvas, W, H, DPR = 1;
const OX = SIZE * SQ3 / 2 + 6, OY = SIZE + 6;
const center = (c, r) => ({ x: OX + SIZE * SQ3 * (c + 0.5 * (r & 1)), y: OY + SIZE * 1.5 * r });
const $ = id => document.getElementById(id);

function fxText(u, text, color) { if (HEADLESS) return; const p = center(u.c, u.r); S.effects.push({ type: 'text', x: p.x, y: p.y, text, color, t0: now() }); }
function fxShot(a, b) { if (HEADLESS) return; const p = center(a.c, a.r), q = center(b.c, b.r); S.effects.push({ type: 'shot', x1: p.x, y1: p.y, x2: q.x, y2: q.y, t0: now() }); }

function hexPath(g, x, y, s) {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    const px = x + s * Math.cos(a), py = y + s * Math.sin(a);
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.closePath();
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
const hash = (c, r) => { const x = Math.sin(c * 127.1 + r * 311.7) * 43758.5453; return x - Math.floor(x); };

function buildTerrain() {
  terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = W * DPR; terrainCanvas.height = H * DPR;
  const g = terrainCanvas.getContext('2d');
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.fillStyle = '#0b2238'; g.fillRect(0, 0, W, H);
  for (const { c, r } of ALL_TILES) {
    const t = MAP[r][c], { x, y } = center(c, r);
    hexPath(g, x, y, SIZE + 0.5);
    g.fillStyle = shade(TERRAIN[t].color, (hash(c, r) - 0.5) * 0.16 - (t === 'sea' ? c * 0.012 : 0));
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1; g.stroke();
    g.save();
    if (t === 'sea') {
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1.2;
      for (let k = -1; k <= 1; k += 2) {
        g.beginPath();
        const yy = y + k * 6 + hash(r, c) * 4;
        g.moveTo(x - 10, yy); g.quadraticCurveTo(x - 5, yy - 3, x, yy); g.quadraticCurveTo(x + 5, yy + 3, x + 10, yy);
        g.stroke();
      }
    } else if (t === 'mountain') {
      g.fillStyle = 'rgba(40,30,20,.55)';
      g.beginPath(); g.moveTo(x - 12, y + 8); g.lineTo(x - 2, y - 10); g.lineTo(x + 8, y + 8); g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.beginPath(); g.moveTo(x - 5, y - 5); g.lineTo(x - 2, y - 10); g.lineTo(x + 1, y - 5); g.fill();
      g.fillStyle = 'rgba(40,30,20,.4)';
      g.beginPath(); g.moveTo(x + 2, y + 8); g.lineTo(x + 9, y - 3); g.lineTo(x + 14, y + 8); g.fill();
    } else if (t === 'hill') {
      g.strokeStyle = 'rgba(40,40,20,.45)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x - 4, y + 5, 8, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.beginPath(); g.arc(x + 6, y + 7, 6, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    } else if (t === 'city') {
      g.fillStyle = 'rgba(220,225,230,.55)';
      for (let i = 0; i < 6; i++) {
        const bx = x - 11 + (i % 3) * 8, by = y - 8 + Math.floor(i / 3) * 9;
        g.fillRect(bx, by, 5 + hash(i, c) * 2, 5 + hash(r, i) * 3);
      }
    } else if (t === 'plain') {
      g.fillStyle = 'rgba(30,60,20,.35)';
      for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(x - 9 + hash(i, r * c) * 18, y - 8 + hash(c, i) * 16, 2, 0, 7); g.fill(); }
    } else if (t === 'beach') {
      g.fillStyle = 'rgba(255,255,255,.15)';
      g.fillRect(x - 12, y - 1, 24, 2);
    }
    g.restore();
  }
}

function render() {
  const t = now();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.drawImage(terrainCanvas, 0, 0, W, H);

  // 部署區
  if (S.phase === 'deploy') {
    const pulse = 0.18 + 0.1 * Math.sin(t / 300);
    for (const { c, r } of ALL_TILES) if (inZone(S.player, c, r)) {
      const p = center(c, r); hexPath(ctx, p.x, p.y, SIZE - 1);
      ctx.fillStyle = `rgba(245,185,66,${pulse})`; ctx.fill();
    }
  }
  // 可移動範圍
  for (const p of S.reach.values()) {
    const q = center(p.c, p.r); hexPath(ctx, q.x, q.y, SIZE - 2);
    ctx.fillStyle = 'rgba(90,230,120,.28)'; ctx.fill();
    ctx.strokeStyle = 'rgba(90,230,120,.7)'; ctx.lineWidth = 1; ctx.stroke();
  }
  // 據點
  for (const o of S.objectives) {
    const p = center(o.c, o.r);
    hexPath(ctx, p.x, p.y, SIZE - 2);
    ctx.strokeStyle = o.owner === 'TW' ? '#5b9cff' : '#ff5c5c'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#f5d76e'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('★ ' + o.name, p.x, p.y - SIZE + 4);
  }
  // hover
  if (S.hover) { const p = center(S.hover.c, S.hover.r); hexPath(ctx, p.x, p.y, SIZE - 1); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  // 單位
  for (const u of S.units) drawUnit(u, t);
  // 可攻擊目標
  for (const e of S.targets) {
    const p = center(e.c, e.r);
    ctx.beginPath(); ctx.arc(p.x, p.y, SIZE * 0.8 + Math.sin(t / 150) * 1.5, 0, 7);
    ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 2.5; ctx.stroke();
  }
  // 特效
  S.effects = S.effects.filter(f => t - f.t0 < (f.type === 'text' ? 1000 : 300));
  for (const f of S.effects) {
    const k = (t - f.t0);
    if (f.type === 'shot') {
      ctx.strokeStyle = `rgba(255,230,120,${1 - k / 300})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke();
      ctx.beginPath(); ctx.arc(f.x2, f.y2, 6 + k / 30, 0, 7); ctx.fillStyle = `rgba(255,150,50,${0.7 - k / 450})`; ctx.fill();
    } else {
      ctx.globalAlpha = 1 - k / 1000;
      ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(f.text, f.x, f.y - 14 - k / 40);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y - 14 - k / 40);
      ctx.globalAlpha = 1;
    }
  }
  requestAnimationFrame(render);
}

function drawUnit(u, t) {
  const T = UNIT_TYPES[u.type];
  let { x, y } = center(u.c, u.r);
  if (u.anim) {
    const k = Math.min(1, (t - u.anim.t0) / 260), a = center(u.anim.from.c, u.anim.from.r);
    x = a.x + (x - a.x) * k; y = a.y + (y - a.y) * k;
    if (k >= 1) u.anim = null;
  }
  const base = u.side === 'TW' ? '#2f6fd6' : '#c93a3a';
  const done = S.phase === 'battle' && u.side === S.turn && u.moved && (u.attacked || targetsFor(u).length === 0);
  ctx.globalAlpha = done ? 0.55 : 1;
  if (T.domain === 'naval') {
    ctx.beginPath();
    ctx.moveTo(x - 18, y - 6); ctx.lineTo(x + 12, y - 6); ctx.lineTo(x + 20, y); ctx.lineTo(x + 12, y + 6); ctx.lineTo(x - 18, y + 6); ctx.closePath();
    ctx.fillStyle = base; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#ddd'; ctx.fillRect(x - 6, y - 3, 8, 6);
  } else {
    if (isSea(u.c, u.r) && !u.anim) {    // 搭載中：畫登陸艇船身
      ctx.beginPath(); ctx.moveTo(x - 17, y + 2); ctx.lineTo(x + 17, y + 2); ctx.lineTo(x + 12, y + 12); ctx.lineTo(x - 12, y + 12); ctx.closePath();
      ctx.fillStyle = '#4a545e'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(x, y - 1, SIZE * 0.58, 0, 7);
    ctx.fillStyle = base; ctx.fill();
    ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(T.short, x, y - 1);
    ctx.textBaseline = 'alphabetic';
  }
  if (T.domain === 'naval') {
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(T.short, x + 9, y + 4);
  }
  // 血條
  const w = 26, frac = Math.max(0, u.hp / T.hp);
  ctx.fillStyle = '#111'; ctx.fillRect(x - w / 2, y + 13, w, 4);
  ctx.fillStyle = frac > 0.6 ? '#4ade80' : frac > 0.3 ? '#facc15' : '#ef4444';
  ctx.fillRect(x - w / 2, y + 13, w * frac, 4);
  if (S.selected === u) {
    ctx.beginPath(); ctx.arc(x, y, SIZE * 0.82, 0, 7);
    ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2.5; ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function pickHex(ev) {
  const rect = cv.getBoundingClientRect();
  const mx = (ev.clientX - rect.left) * (W / rect.width), my = (ev.clientY - rect.top) * (H / rect.height);
  let best = null, bd = 1e9;
  for (const p of ALL_TILES) {
    const q = center(p.c, p.r), d = (q.x - mx) ** 2 + (q.y - my) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return bd <= SIZE * SIZE ? best : null;
}

function onClick(ev) {
  const h = pickHex(ev); if (!h) return;
  const { c, r } = h;
  if (S.phase === 'deploy') return deployClick(c, r);
  if (S.phase !== 'battle' || S.busy || S.turn !== S.player || S.winner) return;
  const u = unitAt(c, r), sel = S.selected;
  if (sel) {
    if (u && u.side !== sel.side && S.targets.includes(u)) { doAttack(sel, u); refreshSel(); return; }
    if (!u && S.reach.has(key(c, r))) { moveUnit(sel, c, r); refreshSel(); return; }
  }
  if (u && u.side === S.player) { S.selected = u; refreshSel(); return; }
  S.selected = null; S.reach = new Map(); S.targets = []; ui();
}
function refreshSel() {
  const u = S.selected;
  if (!u || u.hp <= 0 || S.winner) { S.selected = null; S.reach = new Map(); S.targets = []; ui(); return; }
  S.reach = u.moved ? new Map() : reachable(u);
  S.targets = targetsFor(u);
  ui();
}
function deployClick(c, r) {
  const u = unitAt(c, r);
  if (u && u.side === S.player) {
    S.units = S.units.filter(x => x !== u);
    S.budget[S.player] += UNIT_TYPES[u.type].cost; ui(); return;
  }
  if (!S.placing || u) return;
  if (!inZone(S.player, c, r)) { log('只能部署在發光區域內', 'sys'); ui(); return; }
  const cost = UNIT_TYPES[S.placing].cost;
  if (S.budget[S.player] < cost) { log('預算不足', 'sys'); ui(); return; }
  addUnit(S.placing, S.player, c, r); S.budget[S.player] -= cost; ui();
}

function countdown(n) {
  const ov = $('overlay-count'), num = $('countNum');
  ov.classList.remove('hidden');
  num.textContent = n > 0 ? n : '開戰！';
  if (n > 0) setTimeout(() => countdown(n - 1), 800);
  else setTimeout(() => { ov.classList.add('hidden'); startBattle(); }, 700);
}

function showResult(side, reason) {
  if (HEADLESS) return;
  setTimeout(() => {
    $('resultTitle').textContent = side === S.player ? '勝利！' : '戰敗';
    $('resultTitle').className = side === 'TW' ? 'blue' : 'red';
    $('resultText').textContent = `${SIDE_NAME[side]} 獲勝 —— ${reason}（第 ${S.round} 回合）`;
    $('overlay-result').classList.remove('hidden');
    ui();
  }, 900);
}

function describeUnit(u) {
  const T = UNIT_TYPES[u.type];
  const atk = T.atkNaval !== undefined ? `${T.atk}（對海 ${T.atkNaval}）` : T.atk;
  return `<b class="${u.side === 'TW' ? 'blue' : 'red'}">${SIDE_NAME[u.side]}・${T.name}</b>${embarked(u) ? '（搭載中）' : ''}<br>
    兵力 ${u.hp}/${T.hp}　攻 ${atk}　防 ${T.def}<br>移動 ${embarked(u) ? 3 : T.mv}　射程 ${T.minR === T.maxR ? T.maxR : T.minR + '-' + T.maxR}<br>
    <span style="color:#8796a8">${T.desc}</span>`;
}

function ui() {
  if (HEADLESS) return;
  const phaseText = {
    deploy: `部署階段（${SIDE_NAME[S.player]}）`,
    countdown: '開戰倒數',
    battle: `第 ${S.round}/${MAX_ROUNDS} 回合・${SIDE_NAME[S.turn]}${S.turn === S.player ? '（你）' : '（電腦）'}`,
    over: '戰鬥結束',
  }[S.phase] || '—';
  $('phase').textContent = phaseText;
  $('status').textContent = S.phase === 'battle' || S.phase === 'over'
    ? `攻方 ${S.units.filter(u => u.side === 'PRC').length} 單位　守方 ${S.units.filter(u => u.side === 'TW').length} 單位` : '';

  const showTimer = S.phase === 'deploy' || (S.phase === 'battle' && S.turn === S.player && S.timerOn);
  const total = S.phase === 'deploy' ? DEPLOY_TIME : TURN_TIME;
  $('timerBar').style.width = showTimer ? (100 * S.timer / total) + '%' : '0%';
  $('timerBar').style.background = S.timer <= 10 ? '#ef4444' : '#f5b942';
  $('timerText').textContent = showTimer ? `剩餘 ${S.timer} 秒` : (S.busy ? '電腦思考中…' : '');

  $('deployBox').classList.toggle('hidden', S.phase !== 'deploy');
  $('battleBox').classList.toggle('hidden', S.phase !== 'battle');
  $('btnEnd').disabled = S.busy || S.turn !== S.player;

  if (S.phase === 'deploy') {
    $('budget').textContent = `預算 ${S.budget[S.player]}`;
    const shop = $('shop'); shop.innerHTML = '';
    for (const [k, T] of Object.entries(UNIT_TYPES)) {
      if (!T.sides.includes(S.player)) continue;
      const b = document.createElement('button');
      b.className = 'shopItem' + (S.placing === k ? ' active' : '');
      b.disabled = S.budget[S.player] < T.cost;
      b.innerHTML = `<span><b>${T.short}</b> ${T.name}<br><span class="meta">${T.desc}</span></span><span class="cost">${T.cost}</span>`;
      b.onclick = () => { S.placing = k; ui(); };
      shop.appendChild(b);
    }
  }

  let info = '';
  const h = S.hover;
  if (S.selected) info += describeUnit(S.selected) + '<hr style="border-color:#222b35">';
  if (h) {
    const t = TERRAIN[MAP[h.r][h.c]];
    const hu = unitAt(h.c, h.r);
    if (hu && hu !== S.selected) {
      info += describeUnit(hu);
      if (S.selected && S.targets.includes(hu)) {
        const d = damage(S.selected, S.selected.hp, hu, hu.c, hu.r, false, 1.5);
        info += `<br><b style="color:#ffdf6b">預估傷害 ≈ ${d}</b>`;
      }
      info += '<br>';
    }
    info += `地形：${t.name}${t.def ? `（防禦 +${t.def}）` : ''}`;
  }
  $('info').innerHTML = info || '滑鼠移到格子上查看';

  $('objs').innerHTML = S.objectives.map(o =>
    `<div><span>★ ${o.name}</span><span class="${o.owner === 'TW' ? 'blue' : 'red'}">${o.owner === 'TW' ? '守方控制' : '攻方佔領'}</span></div>`).join('');

  const lg = $('log');
  lg.innerHTML = S.logs.slice(-80).map(l => `<div class="${l.cls}">${l.text}</div>`).join('');
  lg.scrollTop = lg.scrollHeight;
}

function tick() {
  if (S.phase === 'deploy') {
    S.timer--;
    if (S.timer <= 0) { log('部署時間到！', 'sys'); finishDeploy(); }
    ui();
  } else if (S.phase === 'battle' && S.turn === S.player && S.timerOn && !S.busy && !S.winner) {
    S.timer--;
    if (S.timer <= 0) { log('回合時間到，自動結束回合', 'sys'); endTurn(); }
    ui();
  }
}

function startGame(side) {
  newState(side);
  S.timerOn = $('optTimer').checked;
  $('overlay-menu').classList.add('hidden');
  $('overlay-result').classList.add('hidden');
  log(`你扮演 ${SIDE_NAME[side]}。部署倒數 ${DEPLOY_TIME} 秒，預算 ${S.budget[side]}。`, 'sys');
  ui();
}

function initBrowser() {
  cv = $('cv'); ctx = cv.getContext('2d');
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = Math.ceil(SIZE * SQ3 * (COLS + 0.5) + 12);
  H = Math.ceil(SIZE * 1.5 * (ROWS - 1) + SIZE * 2 + 12);
  cv.width = W * DPR; cv.height = H * DPR;
  buildTerrain();
  newState('TW'); S.phase = 'menu';
  cv.addEventListener('click', onClick);
  cv.addEventListener('mousemove', ev => { const h = pickHex(ev); if (key(h?.c, h?.r) !== key(S.hover?.c, S.hover?.r)) { S.hover = h; ui(); } });
  cv.addEventListener('mouseleave', () => { S.hover = null; ui(); });
  cv.addEventListener('contextmenu', ev => { ev.preventDefault(); if (S.phase === 'battle') { S.selected = null; S.reach = new Map(); S.targets = []; ui(); } });
  document.querySelectorAll('.side').forEach(b => b.onclick = () => startGame(b.dataset.side));
  $('btnAgain').onclick = () => { $('overlay-result').classList.add('hidden'); $('overlay-menu').classList.remove('hidden'); newState(S.player); S.phase = 'menu'; ui(); };
  $('btnReady').onclick = finishDeploy;
  $('btnAuto').onclick = () => { aiDeploy(S.player); ui(); };
  $('btnClear').onclick = () => { S.units = S.units.filter(u => u.side !== S.player); S.budget[S.player] = BUDGET[S.player]; ui(); };
  $('btnEnd').onclick = () => { if (!S.busy && S.turn === S.player) endTurn(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { S.selected = null; S.reach = new Map(); S.targets = []; ui(); } });
  setInterval(tick, 1000);
  ui();
  requestAnimationFrame(render);
}

if (!HEADLESS) initBrowser();
else module.exports = { S, newState, aiDeploy, startBattle, UNIT_TYPES, MAP };
