'use strict';
/* 遊戲資料：所有數值皆為遊戲設定，不代表真實戰力。 */

const TOTAL_BUDGET = 1200;

const CATS = {
  land: { name: '陸軍', color: '#4ade80' },
  sea:  { name: '海軍', color: '#22d3ee' },
  air:  { name: '空軍', color: '#c4b5fd' },
  ad:   { name: '防空與飛彈', color: '#fbbf24' },
};

// place: land 陸地 / coast 沿岸 15km 內 / sea 我方海域 / airbase 空軍基地 / beach 灘頭外海
// range: 公里（0 = 近戰）
const UNIT_TYPES = {
  inf:     { cat: 'land', name: '步兵旅',     glyph: '步', cost: 40,  place: 'land',    hp: 100, atk: 30, def: 30, range: 0,   desc: '防守主力，在都會與山地有加成' },
  armor:   { cat: 'land', name: '裝甲旅',     glyph: '甲', cost: 80,  place: 'land',    hp: 120, atk: 60, def: 45, range: 0,   desc: '機動打擊，反登陸逆襲主力' },
  art:     { cat: 'land', name: '砲兵群',     glyph: '砲', cost: 50,  place: 'land',    hp: 60,  atk: 45, def: 15, range: 30,  desc: '射程 30 km，壓制灘頭' },
  mlrs:    { cat: 'land', name: '多管火箭',   glyph: '箭', cost: 70,  place: 'land',    hp: 50,  atk: 60, def: 10, range: 70,  desc: '射程 70 km，可打擊近岸船團' },
  reserve: { cat: 'land', name: '後備旅',     glyph: '後', cost: 20,  place: 'land',    hp: 80,  atk: 15, def: 25, range: 0,   desc: '便宜，戰力較弱，適合守城' },
  frigate: { cat: 'sea',  name: '飛彈巡防艦', glyph: '巡', cost: 90,  place: 'sea',     hp: 100, atk: 50, def: 40, range: 100, desc: '海上防空與反艦，容易成為飛彈目標' },
  fac:     { cat: 'sea',  name: '飛彈快艇',   glyph: '艇', cost: 30,  place: 'sea',     hp: 30,  atk: 35, def: 10, range: 60,  desc: '便宜、分散，近岸游擊' },
  sub:     { cat: 'sea',  name: '潛艦',       glyph: '潛', cost: 120, place: 'sea',     hp: 80,  atk: 70, def: 60, range: 40,  desc: '隱密，伏擊渡海船團' },
  mine:    { cat: 'sea',  name: '水雷區',     glyph: '雷', cost: 25,  place: 'beach',   hp: 1,   atk: 40, def: 0,  range: 0,   desc: '佈在灘頭外海，削弱登陸（每灘頭最多 2）' },
  fighter: { cat: 'air',  name: '戰機中隊',   glyph: '機', cost: 110, place: 'airbase', hp: 80,  atk: 60, def: 35, range: 0,   desc: '爭奪制空權，基地被炸會受損（每基地最多 3）' },
  drone:   { cat: 'air',  name: '無人機中隊', glyph: '無', cost: 40,  place: 'land',    hp: 30,  atk: 30, def: 10, range: 150, desc: '偵察與攻擊，可分散部署' },
  sam_l:   { cat: 'ad',   name: '長程防空',   glyph: '長', cost: 100, place: 'land',    hp: 60,  atk: 55, def: 20, range: 120, desc: '攔截飛彈與戰機，射程 120 km' },
  sam_s:   { cat: 'ad',   name: '中短程防空', glyph: '短', cost: 50,  place: 'land',    hp: 40,  atk: 35, def: 15, range: 40,  desc: '保護重點目標，射程 40 km' },
  asm:     { cat: 'ad',   name: '岸置反艦飛彈', glyph: '反', cost: 70, place: 'coast',  hp: 40,  atk: 80, def: 10, range: 150, desc: '射程 150 km，打擊渡海船團，須部署在沿岸' },
  radar:   { cat: 'ad',   name: '雷達站',     glyph: '偵', cost: 40,  place: 'land',    hp: 40,  atk: 0,  def: 10, range: 250, desc: '提早預警，提升攔截與反艦效率' },
};

// 地圖上顯示的表情符號
const UNIT_EMOJI = {
  inf: '🪖', armor: '🛡️', art: '💥', mlrs: '🎇', reserve: '👥',
  frigate: '🚢', fac: '🚤', sub: '🐋', mine: '💣',
  fighter: '✈️', drone: '🛸',
  sam_l: '🚀', sam_s: '🎯', asm: '☄️', radar: '📡',
};
for (const k in UNIT_TYPES) UNIT_TYPES[k].emoji = UNIT_EMOJI[k];

// 防空攔截彈數量（推演用）
const AMMO = { sam_l: 60, sam_s: 40, frigate: 24 };

// 地圖參考地名（非遊戲區域）
const MAP_LABELS = [
  { name: '福建', lon: 118.0, lat: 26.2 }, { name: '浙江', lon: 119.9, lat: 28.6 },
  { name: '廣東', lon: 115.4, lat: 23.6 }, { name: '江西', lon: 115.9, lat: 27.0 },
  { name: '日本・沖繩縣', lon: 124.2, lat: 24.0, neutral: true }, { name: '菲律賓', lon: 121.6, lat: 19.6, neutral: true },
];

const ZONE_TYPES = {
  capital:  { name: '首都都會', def: 3 },
  urban:    { name: '都會區',   def: 2 },
  plain:    { name: '平原',     def: 0 },
  hill:     { name: '丘陵',     def: 1 },
  mountain: { name: '山地',     def: 3 },
  island:   { name: '離島',     def: 1 },
};

// 防區（以縣市合併）。region 用於情報研判的登陸方向。
const ZONES = {
  taipei:    { name: '大台北', type: 'capital',  region: 'north' },
  taoyuan:   { name: '桃園',   type: 'urban',    region: 'north' },
  hsinchu:   { name: '新竹',   type: 'urban',    region: 'north' },
  miaoli:    { name: '苗栗',   type: 'hill',     region: 'central' },
  taichung:  { name: '台中',   type: 'urban',    region: 'central' },
  changhua:  { name: '彰化',   type: 'plain',    region: 'central' },
  nantou:    { name: '南投',   type: 'mountain', region: 'central' },
  yunlin:    { name: '雲林',   type: 'plain',    region: 'central' },
  chiayi:    { name: '嘉義',   type: 'plain',    region: 'south' },
  tainan:    { name: '台南',   type: 'urban',    region: 'south' },
  kaohsiung: { name: '高雄',   type: 'urban',    region: 'south' },
  pingtung:  { name: '屏東',   type: 'plain',    region: 'south' },
  yilan:     { name: '宜蘭',   type: 'hill',     region: 'east' },
  hualien:   { name: '花蓮',   type: 'mountain', region: 'east' },
  taitung:   { name: '台東',   type: 'mountain', region: 'east' },
  penghu:    { name: '澎湖',   type: 'island',   region: 'islands' },
  kinmen:    { name: '金門',   type: 'island',   region: 'islands' },
  matsu:     { name: '馬祖',   type: 'island',   region: 'islands' },
};
// 標籤位置修正（縣市重心在山區時）
const ZONE_LABEL_POS = {
  taichung: [120.66, 24.22], kaohsiung: [120.40, 22.78], hualien: [121.45, 23.75], taitung: [121.05, 22.85],
  pingtung: [120.58, 22.55], taipei: [121.55, 25.02], hsinchu: [121.03, 24.76], miaoli: [120.85, 24.50],
  nantou: [120.92, 23.88], yilan: [121.68, 24.62], chiayi: [120.38, 23.43],
};
// 防區相鄰（推演引擎用）
const ZONE_ADJ = [
  ['taipei', 'taoyuan'], ['taipei', 'yilan'], ['taoyuan', 'hsinchu'], ['hsinchu', 'miaoli'], ['hsinchu', 'yilan'],
  ['miaoli', 'taichung'], ['taichung', 'changhua'], ['taichung', 'nantou'], ['taichung', 'hualien'],
  ['changhua', 'nantou'], ['changhua', 'yunlin'], ['nantou', 'yunlin'], ['nantou', 'chiayi'], ['nantou', 'hualien'],
  ['yunlin', 'chiayi'], ['chiayi', 'tainan'], ['chiayi', 'kaohsiung'], ['tainan', 'kaohsiung'],
  ['kaohsiung', 'pingtung'], ['kaohsiung', 'taitung'], ['pingtung', 'taitung'], ['hualien', 'taitung'], ['yilan', 'hualien'],
];

// 可登陸灘頭（座標於載入時吸附到海岸線）
const BEACHES = [
  { id: 'tamsui',   name: '淡水河口', zone: 'taipei',    lon: 121.40, lat: 25.19 },
  { id: 'guanyin',  name: '觀音',     zone: 'taoyuan',   lon: 121.07, lat: 25.06 },
  { id: 'nanliao',  name: '新竹南寮', zone: 'hsinchu',   lon: 120.91, lat: 24.86 },
  { id: 'houlong',  name: '後龍',     zone: 'miaoli',    lon: 120.75, lat: 24.62 },
  { id: 'tcport',   name: '台中港',   zone: 'taichung',  lon: 120.49, lat: 24.28 },
  { id: 'lukang',   name: '彰化濱海', zone: 'changhua',  lon: 120.36, lat: 24.05 },
  { id: 'yunlin',   name: '雲林沿海', zone: 'yunlin',    lon: 120.13, lat: 23.72 },
  { id: 'budai',    name: '布袋',     zone: 'chiayi',    lon: 120.13, lat: 23.38 },
  { id: 'anping',   name: '台南安平', zone: 'tainan',    lon: 120.14, lat: 23.00 },
  { id: 'linyuan',  name: '高雄林園', zone: 'kaohsiung', lon: 120.37, lat: 22.50 },
  { id: 'fangliao', name: '枋寮',     zone: 'pingtung',  lon: 120.57, lat: 22.36 },
  { id: 'toucheng', name: '頭城',     zone: 'yilan',     lon: 121.85, lat: 24.86 },
  { id: 'hualienb', name: '花蓮',     zone: 'hualien',   lon: 121.64, lat: 23.98 },
  { id: 'taitungb', name: '台東',     zone: 'taitung',   lon: 121.17, lat: 22.75 },
  { id: 'penghub',  name: '澎湖',     zone: 'penghu',    lon: 119.54, lat: 23.55 },
  { id: 'kinmenb',  name: '金門',     zone: 'kinmen',    lon: 118.41, lat: 24.41 },
  { id: 'matsub',   name: '馬祖',     zone: 'matsu',     lon: 119.96, lat: 26.14 },
];

const AIRBASES = [
  { id: 'ab_taoyuan',  name: '桃園基地', lon: 121.24, lat: 25.06 },
  { id: 'ab_hsinchu',  name: '新竹基地', lon: 120.94, lat: 24.82 },
  { id: 'ab_taichung', name: '台中基地', lon: 120.62, lat: 24.26 },
  { id: 'ab_chiayi',   name: '嘉義基地', lon: 120.39, lat: 23.46 },
  { id: 'ab_tainan',   name: '台南基地', lon: 120.21, lat: 22.95 },
  { id: 'ab_pingtung', name: '屏東基地', lon: 120.46, lat: 22.70 },
  { id: 'ab_hualien',  name: '花蓮基地', lon: 121.62, lat: 24.02 },
  { id: 'ab_taitung',  name: '台東基地', lon: 121.18, lat: 22.79 },
  { id: 'ab_magong',   name: '馬公基地', lon: 119.63, lat: 23.57 },
];
const AIRBASE_CAP = 3;
const MINES_PER_BEACH = 2;

const SEA_ZONES = [
  { id: 'north',    name: '台灣北部海域', lon: 121.7, lat: 25.75 },
  { id: 'strait_n', name: '海峽北段',     lon: 120.3, lat: 25.25 },
  { id: 'strait_c', name: '海峽中段',     lon: 119.9, lat: 24.3 },
  { id: 'strait_s', name: '海峽南段',     lon: 119.7, lat: 22.75 },
  { id: 'bashi',    name: '巴士海峽',     lon: 120.9, lat: 21.75 },
  { id: 'east',     name: '東部海域',     lon: 122.3, lat: 23.6 },
];

const ENEMY_STAGING = [
  { name: '北部集結區', sub: '福州・平潭', lon: 119.55, lat: 25.6, region: 'north' },
  { name: '中部集結區', sub: '泉州',       lon: 118.75, lat: 24.9, region: 'central' },
  { name: '南部集結區', sub: '廈門・漳州', lon: 118.05, lat: 24.4, region: 'south' },
];

// 我方海域界線（遊戲設定）：lon - lat > 95 的一側
const TW_WATERS = (lon, lat) => lon - lat > 95;

// 日美協防預備金（虛構設定）
const ALLY_LEVELS = [
  { amount: 0,   name: '不請求',       desc: '完全依靠自身戰力，預算全數用於部隊' },
  { amount: 100, name: '情報合作',     desc: '開戰起即獲得預警情報：雷達預警與飛彈攔截效率提升' },
  { amount: 200, name: '有限支援',     desc: '若守住首都撐過約 D+7，有機會獲得空中與潛艦支援' },
  { amount: 300, name: '全面協防請求', desc: '若守住首都撐過約 D+4，有較高機會獲得大規模支援' },
];

const DIFFICULTY = {
  easy:   { name: '簡單', mult: 0.8 },
  normal: { name: '普通', mult: 1.0 },
  hard:   { name: '困難', mult: 1.25 },
};
const REGION_NAME = { north: '北部', central: '中部', south: '南部' };
