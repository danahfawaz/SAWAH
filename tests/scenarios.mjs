// Scenario tests for the SAWAH planner (run after `node build.mjs`):  node tests/scenarios.mjs
// Uses the same planner.js and the data generated from the CSVs. Exits with code 1 on any failed check.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../src/planner.js');
const DATA = JSON.parse(readFileSync(new URL('../dist/data.json', import.meta.url)));
const D = { ...DATA, byId: Object.fromEntries([...DATA.places, ...DATA.hotels].map(p => [p.id, p])) };
const nearIds = new Set(DATA.near.map(x => x.id));

const START = process.env.START || '2026-11-05'; // Thursday → day 2 is a Friday (different hours)
const base = { start: START, days: 2, people: 1, group: 'solo', budget: 'mid', amount: 300, stay: false, interests: [], other: '' };
const SC = {
  'A  Low budget + Saudi culture/history': { ...base, budget: 'eco', interests: ['heritage', 'culture'] },
  'B  Family + entertainment': { ...base, people: 4, group: 'family', interests: ['entertainment'], stay: true },
  'C  Food + modern Riyadh': { ...base, days: 1, people: 2, group: 'friends', interests: ['food', 'modern'] },
  'D  Adventure/outdoor + low/moderate budget': { ...base, people: 2, group: 'friends', budget: 'custom', amount: 250, interests: ['adventure', 'nature'] },
  'E  Luxury / high budget': { ...base, people: 2, group: 'friends', budget: 'high', interests: ['food', 'shopping', 'culture'], stay: true },
  'H  Budget+Mid chosen together, family+friends': { ...base, people: 3, group: undefined, groups: ['family', 'friends'], budget: undefined, budgets: ['eco', 'mid'], interests: ['entertainment', 'nature'], stay: true },
  'F  Very small set amount (50 SAR)': { ...base, days: 1, budget: 'custom', amount: 50, interests: ['heritage', 'food'] },
  'G  Lunch + dinner only, set amount 200': { ...base, days: 1, people: 2, group: 'friends', budget: 'custom', amount: 200, interests: ['culture', 'shopping'], meals: ['lunch', 'dinner'], stay: true }
};

let fails = 0;
const fail = (sc, msg) => { fails++; console.log(`   ✗ ${msg}`); };
const name = id => D.byId[id].n[1];

for (const [label, form] of Object.entries(SC)) {
  const pl = P.buildPlan(D, form), c = P.planCost(D, pl);
  console.log(`\n${label}`);
  if (pl.hotel) { const h = D.byId[pl.hotel]; console.log(`   hotel anchor: ${h.n[1]} (${h.tier})`); const tiers = ['budget', 'mid-range', 'luxury']; const hw = P.budgetsOf(form).includes('custom') ? (form.amount <= 250 ? 1 : form.amount <= 600 ? 2 : 3) : P.budgetOf(form).wantMin; if (tiers.indexOf(h.tier) > hw - 1) fail(label, 'hotel tier above the budget'); }
  pl.days.forEach((stops, d) => {
    const date = P.dateOf(form.start, d);
    console.log(`   Day ${d + 1} (${date.toDateString().slice(0, 10)})  per-person ${c.perDay[d]} SAR / cap ${c.cap}`);
    let dayKm = 0;
    for (const s of stops) {
      const p = D.byId[s.id];
      const br = s.br ? ` → branch ${D.byId[s.br].bn[1]}` : '', ap = s.ap != null ? ` → access ${p.aps[s.ap].n[1]}` : '';
      dayKm += s.km || 0;
      console.log(`     ${P.hm(s.t)}-${P.hm(s.e)} ${s.slot.padEnd(9)} ${p.n[1]}${br}${ap}  [${s.ck}${s.cost != null ? ' ' + s.cost : ''}] ${s.km != null ? s.km + 'km' : ''} ${s.fl.join(',')}`);
      // checks
      if (!p.itin) fail(label, `${p.n[1]} is not itinerary-eligible`);
      if (nearIds.has(s.id)) fail(label, `${p.n[1]} is a nearby-only place`);
      if (p.cat === 'hotel') fail(label, 'hotel scheduled as a stop');
      if (s.fl.includes('closedRisk')) fail(label, `${p.n[1]} may be closed at ${P.hm(s.t)}`);
      const raw = s.br ? D.byId[s.br].hrs : p.hrs, hs = s.br ? D.byId[s.br].hs : p.hs;
      const eh = P.effHours(p, raw, date, hs);
      if (!P.fits(eh.iv, s.t, s.e - s.t)) fail(label, `${p.n[1]} not open ${P.hm(s.t)}-${P.hm(s.e)}`);
      if (p.branches && !s.br) fail(label, `${p.n[1]} has no branch selected`);
      if (/magic planet/i.test(p.n[1]) && s.ck !== 'paid') fail(label, 'Magic Planet must be paid');
      if (form.group === 'family' && P.restricted(p, form, s.slot)) fail(label, `${p.n[1]} restricted for families`);
    }
    console.log(`     day travel ≈ ${dayKm.toFixed(1)} km`);
    if (Number.isFinite(c.cap) && c.perDay[d] > c.cap) fail(label, `day ${d + 1} is over the budget`);
    const bx = P.budgetOf(form);
    if (bx.exact && stops.some(s => s.ck === 'dynamic' || s.ck === 'unknown')) fail(label, 'unknown/variable price used with a set amount');
    if (form.meals && stops.some(s => s.slot !== 'act' && !form.meals.includes(s.slot))) fail(label, 'meal the user did not ask for');
    for (const n of (pl.dayNotes[d] || [])) console.log(`     note: skipped ${n.slot} (left ${n.left}, cheapest open ${n.need})`);
  });
  const ids = pl.days.flat().map(s => s.id);
  if (new Set(ids).size !== ids.length) console.log('   (note) a meal place is reused on another day to stay within budget');
  console.log(`   total ${c.total} SAR for ${form.people} people · variable/unknown prices: ${c.variable}`);
}

/* rule checks independent of scenarios */
const mp = DATA.places.find(p => /magic planet/i.test(p.n[1]));
const mpc = P.costAt(mp, 600);
console.log(`\nMagic Planet cost model: ${mpc.k} ${mpc.v} SAR`); if (mpc.k !== 'paid') { fails++; console.log('   ✗ Magic Planet not paid'); }
const rs = DATA.places.find(p => /red sand/i.test(p.n[1])); const rsc = P.costAt(rs, 600);
console.log(`Red Sand Dunes base cost: ${rsc.k} ${rsc.v} · optional extras flagged: ${rs.cost.opt}`); if (rsc.v !== 0) { fails++; console.log('   ✗ Red Sands base should be free'); }
const cin = DATA.places.filter(p => p.cat === 'cinema').map(p => P.costAt(p, 1200).k);
console.log(`Cinemas cost kinds: ${[...new Set(cin)].join(',')}`); if (cin.some(k => k !== 'dynamic')) { fails++; console.log('   ✗ cinema price must be dynamic'); }
const kap = DATA.places.find(p => /king abdullah park/i.test(p.n[1]));
console.log(`King Abdullah Park hours ${START}: ${JSON.stringify(P.effHours(kap, kap.hrs, P.dateOf(START, 0)))}`);
console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
