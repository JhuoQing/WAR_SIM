// 用 node 批次跑推演，檢查平衡： node tools/sim_test.js [場數] [難度]
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { window: {}, console, Math, JSON, Object };
vm.createContext(ctx);
for (const f of ['data/map-data.js', 'js/data.js', 'js/core.js', 'js/engine.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
const N = +process.argv[2] || 200, diff = process.argv[3] || 'normal';
const run = vm.runInContext(`(function(N, diff, variant){
  const res = {}, reasons = {}; let days = 0, landed = 0, sunk = 0;
  for (let i = 0; i < N; i++) {
    const ally = variant.ally || 0;
    let units = variant.units ? variant.units() : recommendedDeploy(TOTAL_BUDGET - ally);
    const intel = { probs: { north: 45, central: 35, south: 20 }, est: { brigades: 14, fleets: 9, squadrons: 22, salvos: 6 } };
    const S = createSim({ units, ally, difficulty: diff, intel }, i * 7919 + 1);
    while (!S.over) stepSim(S);
    res[S.result.grade] = (res[S.result.grade] || 0) + 1;
    const r = S.result.reason.replace(/[0-9.]+/g, 'N').replace(/：.*/, ''); reasons[r] = (reasons[r] || 0) + 1;
    days += S.t / 24; landed += S.stats.landed; sunk += S.stats.sunk;
  }
  return { res, reasons, avgDays: (days / N).toFixed(1), avgLanded: (landed / N).toFixed(1), avgSunk: (sunk / N).toFixed(1) };
})`, ctx);
const variants = {
  '推薦部署': {},
  '推薦+有限協防': { ally: 200 }, '推薦+全面協防': { ally: 300 },
  '空部署': { units: () => [] },
  '只買步兵': { units: () => { const u = []; const zs = Object.keys(ctx.window ? {} : {}); return vm.runInContext(`(()=>{const u=[];let id=1;const zs=Object.keys(ZONES).filter(z=>!['kinmen','matsu','penghu'].includes(z));for(let i=0;i<30;i++){const p=ZONE_POS[zs[i%zs.length]];u.push({id:id++,type:'inf',lon:p.lon,lat:p.lat,zone:zs[i%zs.length],anchor:null});}return u;})()`, ctx); } },
  '反艦重裝': { units: () => vm.runInContext(`(()=>{const u=[];let left=1200,id=1;const add=(t,p)=>{if(left<UNIT_TYPES[t].cost)return;const v=checkPlace(u,t,p.lon,p.lat);if(v.ok){u.push({id:id++,type:t,lon:v.lon,lat:v.lat,zone:v.zone,anchor:v.anchor||null});left-=UNIT_TYPES[t].cost;}};
    for(const b of ['guanyin','tcport','anping','tamsui','lukang','linyuan']){const B=beachById(b);add('asm',towards(B,ZONE_POS[B.zone],4));}
    add('sam_l',ZONE_POS.taipei);add('radar',towards(beachById('tamsui'),ZONE_POS.taipei,4));add('sub',{lon:120.0,lat:24.6});add('sub',{lon:120.2,lat:23.3});
    for(const b of ['tamsui','guanyin','tcport','anping']){const B=beachById(b);add('inf',towards(B,ZONE_POS[B.zone],6));}
    add('armor',ZONE_POS.taoyuan);add('mine',beachById('guanyin'));add('mine',beachById('tcport'));return u;})()`, ctx) },
};
for (const [name, v] of Object.entries(variants)) console.log(name.padEnd(10), JSON.stringify(run(N, diff, v)));
