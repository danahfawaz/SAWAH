/* SAWAH planner: pure, deterministic logic shared by the app (browser) and the Node tests.
   Needs a DATA object produced by build.mjs from the CSV files. No DOM access here. */
(function (root) {
'use strict';

/* ---------------- time & opening hours ---------------- */
const WD = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const toMin = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim()); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const hm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const isWinter = month => month >= 10 || month <= 2; // Nov–Mar (used only for "Summer/Winter" schedules)

function daySet(spec) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.trim().split('-');
    const ia = WD.indexOf(a), ib = b === undefined ? ia : WD.indexOf(b);
    if (ia < 0 || ib < 0) return null;
    for (let i = ia, k = 0; k < 8; k++, i = (i + 1) % 7) { out.add(i); if (i === ib) break; }
  }
  return out;
}

/* Parse an OSM-style opening_hours string for one calendar date.
   Returns {kind:'ok', iv:[[openMin, closeMin]...]} | {kind:'dynamic'} | {kind:'none'} */
function hoursOn(raw, date) {
  if (!raw) return { kind: 'none' };
  let s = String(raw).replace(/\([^)]*\)/g, '').replace(/^\s*current calendar snapshot:\s*/i, '').trim();
  if (/showtime|consult/i.test(s)) return { kind: 'dynamic' };
  if (/^24\/7$/.test(s)) return { kind: 'ok', iv: [[0, 1440]] };
  const w = date.getDay(), mo = date.getMonth();
  let iv = [], lastDays = null, cut = null, any = false, inSeason = true;
  for (let seg of s.split(';')) {
    seg = seg.trim(); if (!seg) continue;
    let m;
    if ((m = /^last (?:order|entry)\s+(\d{1,2}:\d{2})$/i.exec(seg))) { cut = toMin(m[1]); continue; }
    if ((m = /^current season\s+(\d{1,2})\s+([a-z]{3})\s*-\s*(\d{1,2})\s+([a-z]{3})$/i.exec(seg))) {
      const a = MON[m[2].toLowerCase()] * 100 + (+m[1]), b = MON[m[4].toLowerCase()] * 100 + (+m[3]), x = mo * 100 + date.getDate();
      inSeason = a <= b ? (x >= a && x <= b) : (x >= a || x <= b); continue;
    }
    let days, rest;
    if ((m = /^(summer|winter)\s+(.*)$/i.exec(seg))) {
      any = true;
      if (/winter/i.test(m[1]) !== isWinter(mo)) continue;
      days = new Set([0, 1, 2, 3, 4, 5, 6]); rest = m[2];
    } else if ((m = /^([A-Z][a-z](?:[-,][A-Z][a-z])*)\s+(.*)$/.exec(seg))) {
      days = daySet(m[1]); rest = m[2];
    } else { days = lastDays; rest = seg; }
    if (!days) return { kind: 'none' };
    lastDays = days; any = true;
    if (/^closed$/i.test(rest.trim())) continue;
    if (!days.has(w)) continue;
    for (const r of rest.split(',')) {
      const mm = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(r.trim());
      if (!mm) return { kind: 'none' };
      const o = toMin(mm[1]); let c = toMin(mm[2]); if (c <= o) c += 1440;
      iv.push([o, c]);
    }
  }
  if (!any) return { kind: 'none' };
  if (!inSeason) return { kind: 'ok', iv: [], offSeason: true };
  if (cut != null) iv = iv.map(([o, c]) => { let k = cut; if (k < o) k += 1440; return [o, Math.min(c, k)]; });
  return { kind: 'ok', iv };
}

/* Effective hours used for scheduling. Unknown/dynamic hours get a conservative window and a visible flag. */
function effHours(p, raw, date, hs) {
  hs = hs || p.hs;
  const h = hoursOn(raw, date);
  if (h.kind === 'ok') return { iv: h.iv, flag: hs === 'verified' ? null : hs === 'seasonal' ? 'hrsSeason' : hs === 'dynamic_calendar' ? 'hrsDyn' : 'hrsUnverified', offSeason: !!h.offSeason };
  if (h.kind === 'dynamic') return { iv: [[13 * 60, 24 * 60]], flag: 'hrsDyn' };
  const outdoor = ['park', 'natural_site', 'nature_reserve'].includes(p.cat);
  return { iv: outdoor ? [[7 * 60, 19 * 60]] : [[10 * 60, 21 * 60]], flag: 'hrsNone' };
}
const fits = (iv, start, dur) => iv.some(([o, c]) => o <= start && start + dur <= c);
/* Sunset in local Riyadh time (UTC+3), minutes after midnight, for a date and a longitude/latitude (NOAA approximation, about ±3 min). */
function sunsetMin(date, ll) {
  const lat = (ll ? ll[0] : 24.7) * Math.PI / 180, lon = ll ? ll[1] : 46.7;
  const n = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 864e5);
  const B = 2 * Math.PI / 365 * (n - 81);
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const dec = 23.44 * Math.PI / 180 * Math.sin(B);
  const cosH = (Math.sin(-0.833 * Math.PI / 180) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec));
  const H = Math.acos(Math.max(-1, Math.min(1, cosH))) * 180 / Math.PI;
  return Math.round(12 * 60 + (45 - lon) * 4 - eot + H * 4);
}
/* Places best seen at sunset (p.when === 'sunset'): arrive about 90 min before sunset so the visit covers it. */
const sunsetArrive = (p, date, ll) => sunsetMin(date, ll || p.ll) - 90;

/* ---------------- geography ---------------- */
const CENTER = [24.7136, 46.6753]; // King Fahd Rd / Olaya — neutral start when there is no hotel
function km(a, b) {
  if (!a || !b) return null;
  const R = 6371, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
/* Rough travel time: walk when very close, otherwise drive (road factor 1.35, ~38 km/h incl. parking in the city;
   beyond 25 km the rest is highway, road factor 1.25 at ~80 km/h). */
function travelMin(d) {
  if (d == null) return 25;
  if (d < 0.8) return Math.max(5, Math.round(d / 4.5 * 60));
  const city = Math.min(d, 25), hwy = Math.max(0, d - 25);
  return Math.round(8 + city * 1.35 / 38 * 60 + hwy * 1.25 / 80 * 60);
}

/* ---------------- costs ---------------- */
/* cost for ONE person at a given start minute. k: free | paid | dynamic | unknown | browse | hotel */
function costAt(p, start) {
  const c = p.cost || {};
  if (p.cat === 'hotel') return { v: null, k: 'hotel' };
  if (c.dy) return { v: null, k: 'dynamic' };
  if (c.ty === 'time_dependent') { const v = start >= 17 * 60 ? (c.mx != null ? c.mx : c.e) : (c.mn != null ? c.mn : 0); return { v, k: v ? 'paid' : 'free', td: true }; }
  if (c.ty === 'free') return { v: 0, k: 'free' };
  if (c.e != null) return { v: c.e, k: c.e === 0 ? 'free' : 'paid' };
  if (['mall', 'traditional_market', 'landmark'].includes(p.cat) && c.req !== 'yes') return { v: 0, k: 'browse' };
  return { v: null, k: 'unknown' };
}
const TIERN = { low: 1, moderate: 2, high: 3 };
function tierOf(p) {
  const c = p.cost || {};
  if (TIERN[c.tier]) return TIERN[c.tier];
  if (p.tags.includes('luxury')) return 3;
  if (c.ty === 'free') return 1;
  return 1.5;
}
/* Several budget levels may be chosen together (e.g. Budget + Mid): the cap is the highest chosen level,
   preferred price tiers span all chosen levels. A typed amount ("custom") is used on its own. */
const LEVELS = { eco: { cap: 150, w: 1 }, mid: { cap: 450, w: 2 }, high: { cap: Infinity, w: 3 } };
const budgetsOf = f => (Array.isArray(f.budgets) && f.budgets.length ? f.budgets : [f.budget || 'mid']);
const groupsOf = f => (Array.isArray(f.groups) ? f.groups : (f.group ? [f.group] : []));
function budgetOf(f) {
  const bs = budgetsOf(f);
  if (bs.includes('custom')) { const a = Math.max(0, +f.amount || 0), w = a <= 150 ? 1 : a <= 450 ? 2 : 3; return { cap: a, want: w, wantMin: w, strict: true, exact: true }; }
  const ls = bs.map(k => LEVELS[k]).filter(Boolean); if (!ls.length) ls.push(LEVELS.mid);
  const cap = Math.max(...ls.map(l => l.cap)), want = Math.max(...ls.map(l => l.w)), wantMin = Math.min(...ls.map(l => l.w));
  return { cap, want, wantMin, strict: Number.isFinite(cap), exact: want === 1 };
}

/* ---------------- interests ---------------- */
const INT = {
  heritage: ['heritage', 'history', 'local_experience'],
  culture: ['culture', 'art', 'film'],
  nature: ['nature', 'outdoor'],
  shopping: ['shopping'],
  entertainment: ['entertainment', 'film'],
  food: ['food', 'coffee', 'local', 'breakfast', 'local_experience'],
  adventure: ['adventure', 'active', 'sports', 'outdoor'],
  modern: ['modern_riyadh', 'modern', 'city_view', 'views', 'architecture', 'social', 'local_brand', 'sightseeing']
};
const norm = s => String(s || '').toLowerCase().trim();
function textOf(p) { return norm([...(p.n || []), ...(p.d || []), ...(p.tags || []), p.cat, p.sub].join(' ')); }
function interestScore(p, prefs, act) {
  let s = 0, hits = 0;
  for (const k of prefs.interests || []) {
    // for sightseeing slots "food" means food-centred experiences, not every mall with a food court
    const tags = act && k === 'food' ? ['local_experience', 'coffee'] : (INT[k] || []);
    if (p.tags.some(x => tags.includes(x))) { hits++; s += 3; }
  }
  const kw = norm(prefs.other);
  if (kw && kw.split(/[،,\s]+/).filter(w => w.length > 2).some(w => textOf(p).includes(w))) { hits++; s += 3; }
  return { s, hits };
}
function tierFit(p, want, wantMin) {
  const t = tierOf(p), lo = wantMin == null ? want : wantMin;
  let s = t > want ? -(t - want) * 1.5 : t < lo ? -(lo - t) * 0.5 : 0;
  if (want === 3 && t === 3) s += 1;
  if (want === 3 && p.tags.includes('luxury')) s += 1;
  if (want === 1 && p.tags.includes('luxury')) s -= 1;
  return s;
}

/* ---------------- candidate helpers ---------------- */
function restricted(p, form, slot) {
  const r = norm(p.rest && p.rest[1]);
  if (!r || !groupsOf(form).includes('family')) return false;
  if (/children under \d+ are not permitted/.test(r)) return true;
  if (/dinner 12\+/.test(r) && slot === 'dinner') return true;
  return false;
}
function isBreakfast(p) { return p.cat === 'cafe' || p.tags.includes('breakfast') || p.sub === 'saudi_breakfast'; }
function isMeal(p) { return p.cat === 'restaurant'; }

/* location options for one candidate (branches for brands, access points for linear places) */
function optionsOf(D, p, prefs) {
  if (p.branches) return p.branches.map(id => { const b = D.byId[id]; return { br: id, ll: b.ll, hrs: b.hrs, hs: b.hs }; });
  if (p.aps && p.aps.length) {
    const adv = (prefs.interests || []).includes('adventure');
    const list = p.aps.map((a, i) => ({ ap: i, ll: a.ll, role: a.role })).filter(o => o.role !== 'active_segment' || adv);
    return list.length ? list : [{ ll: p.ll }];
  }
  return [{ ll: p.ll }];
}

/* ---------------- the planner ---------------- */
const SLOTS = [
  { k: 'breakfast', from: 8 * 60 + 30, to: 10 * 60 + 30, endBy: 12 * 60 },
  { k: 'act', from: 10 * 60, to: 12 * 60 + 30, endBy: 14 * 60 + 15 },
  { k: 'lunch', from: 13 * 60, to: 15 * 60, endBy: 17 * 60 },
  { k: 'act', from: 15 * 60 + 30, to: 18 * 60, endBy: 21 * 60 },
  { k: 'act', from: 17 * 60, to: 19 * 60, endBy: 21 * 60 + 15, opt: true },
  { k: 'dinner', from: 19 * 60 + 30, to: 21 * 60 + 30, endBy: 24 * 60 + 30 }
];
const SLOTFROM = { breakfast: 8 * 60 + 30, lunch: 13 * 60, dinner: 19 * 60 + 30 };

function dateOf(startISO, d) {
  const [y, m, dd] = String(startISO || '').split('-').map(Number);
  const base = y ? new Date(y, m - 1, dd) : new Date();
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + d);
}

function chooseHotel(D, form, prefs, pool) {
  const b = budgetOf(form);
  // hotel class follows the trip budget; a modest set amount never gets an upscale hotel
  const hw = budgetsOf(form).includes('custom') ? ((+form.amount || 0) <= 250 ? 1 : (+form.amount || 0) <= 600 ? 2 : 3) : b.wantMin;
  const tierName = hw === 1 ? 'budget' : hw === 2 ? 'mid-range' : 'luxury';
  const order = ['budget', 'mid-range', 'luxury'], max = order.indexOf(tierName);
  let hs = [];
  for (let k = max; k >= 0 && !hs.length; k--) hs = D.hotels.filter(h => h.anchor && h.ll && h.tier === order[k]);
  if (!hs.length) return null;
  const top = pool.filter(p => p.ll).map(p => [p, interestScore(p, prefs).s + tierFit(p, b.want, b.wantMin)]).sort((a, c) => c[1] - a[1]).slice(0, 12);
  const c = top.length ? [top.reduce((s, x) => s + x[0].ll[0], 0) / top.length, top.reduce((s, x) => s + x[0].ll[1], 0) / top.length] : CENTER;
  hs.sort((a, h) => km(a.ll, c) - km(h.ll, c) || (a.id < h.id ? -1 : 1));
  return hs[0];
}

function buildPlan(D, form) {
  const prefs = form, b = budgetOf(form), ppl = Math.max(1, +form.people || 1);
  const pool = D.places.filter(p => p.itin && !p.isBranch && p.cat !== 'hotel' && !['closed_unverified', 'closed'].includes(p.op));
  const hotel = form.stay ? chooseHotel(D, form, prefs, pool.filter(p => !isMeal(p))) : null;
  const usedAll = new Map(); // key -> day index
  const groupCount = {};
  const days = [], warnings = [];
  const meals = Array.isArray(form.meals) ? form.meals : ['breakfast', 'lunch', 'dinner'];
  const SL = [];
  for (const s of SLOTS) {
    if (s.k === 'act' || meals.includes(s.k)) SL.push(s);
    else if (s.k === 'breakfast') continue;
    else if (s.k === 'lunch') SL.push({ k: 'act', from: 12 * 60 + 45, to: 14 * 60, endBy: 16 * 60 + 30, opt: true });
  }
  if (!meals.includes('breakfast')) SL[0] = Object.assign({}, SL[0], { from: 9 * 60 + 30 });
  const dayNotes = [];
  const minMeal = Math.min(...pool.filter(isMeal).map(p => costAt(p, 13 * 60).v).filter(v => v != null && v > 0));

  for (let d = 0; d < Math.max(1, +form.days || 1); d++) {
    const date = dateOf(form.start, d);
    const stops = [], usedToday = {}, notes = [];
    let prevLL = hotel ? hotel.ll : null, prevEnd = 8 * 60, spent = 0;
    /* money to keep aside for the meals still to come today: cheapest unused restaurant open in each later meal slot */
    const openIn = (p, s) => optionsOf(D, p, prefs).some(o => fits(effHours(p, o.hrs != null ? o.hrs : p.hrs, date, o.hs).iv, s.from + 15, Math.min(p.dur || 60, 90)));
    const reserveAfter = (i, skipId) => {                 // distinct cheapest restaurants for each later meal slot
      const taken = new Set([skipId]); let sum = 0;
      for (const s of SL.slice(i + 1).filter(s => s.k !== 'act')) {
        const c = pool.filter(p => (s.k === 'breakfast' ? isBreakfast(p) : isMeal(p)) && !usedAll.has(p.id) && !taken.has(p.id) && openIn(p, s))
          .map(p => [p.id, costAt(p, s.from).v]).filter(x => x[1] != null).sort((a, b) => a[1] - b[1])[0];
        if (c) { taken.add(c[0]); sum += c[1]; } else sum += Number.isFinite(minMeal) ? minMeal : 0;
      }
      return sum;
    };
    const resCache = {};

    SL.forEach((slot, si) => {
            const cands = pool.filter(p => slot.k === 'breakfast' ? isBreakfast(p) : (slot.k === 'lunch' || slot.k === 'dinner') ? isMeal(p) : (!isMeal(p) && p.cat !== 'cafe'));
      // a set amount is a hard limit: no pass may go over it (high budget has no cap)
      const passes = slot.k === 'act' ? [{ reuse: false, budget: true }] : [{ reuse: false, budget: true }, { reuse: true, budget: true }, { reuse: false, budget: false }, { reuse: true, budget: false }];
      let best = null;
      for (const pass of passes) {
        for (const p of cands) {
          const key = p.id;
          if (usedAll.has(key) && !(pass.reuse && usedAll.get(key) !== d)) continue;
          if (restricted(p, form, slot.k)) continue;
          const ints = interestScore(p, prefs, slot.k === 'act');
          for (const o of optionsOf(D, p, prefs)) {
            const dist = km(prevLL || CENTER, o.ll);
            if (dist != null && dist > 35 && ints.hits === 0) continue;          // no long day-trip without a matching interest
            const tm = prevLL ? travelMin(dist) : 0;
            let arr = Math.max(prevEnd + tm, slot.from);
            if (p.when === 'sunset') { if (slot.k !== 'act') continue; const tg = sunsetArrive(p, date, o.ll); arr = Math.max(arr, tg); if (arr > tg + 60) continue; }   // arrive 30–90 min before sunset
            if (arr > slot.to) continue;
            const dur = Math.min(p.dur || 60, slot.k === 'breakfast' ? 60 : 240);
            if (arr + dur > slot.endBy) continue;
            const eh = effHours(p, o.hrs != null ? o.hrs : p.hrs, date, o.hs);
            if (eh.offSeason || !fits(eh.iv, arr, dur)) continue;
            const ci = costAt(p, arr);
            if (b.exact && (ci.k === 'dynamic' || ci.k === 'unknown')) continue;   // cannot guarantee the limit with an unknown price
            if (Number.isFinite(b.cap) && ci.v != null && spent + ci.v > b.cap) continue;
            if (pass.budget && b.strict && ci.v) {   // keep money for today's remaining meals (meals come before paid sightseeing)
              const rk = si + ':' + p.id; const reserve = resCache[rk] != null ? resCache[rk] : (resCache[rk] = reserveAfter(si, p.id)); if (spent + ci.v + reserve > b.cap) continue; }
            let sc = ints.s + tierFit(p, b.want, b.wantMin);
            if (slot.k !== 'act') {
              const want = prefs.interests || [];
              const saudi = p.tags.some(x => ['local', 'heritage', 'local_experience'].includes(x));
              if (saudi && (want.includes('food') || want.includes('heritage') || want.includes('culture'))) sc += 2;
              if (p.tags.includes('culture') && want.includes('culture')) sc += 0.5;
              if (p.tags.includes('international') && want.includes('food')) sc += 0.4;
              if (slot.k === 'breakfast' && p.sub === 'saudi_breakfast') sc += 0.8;
            }
            if (groupsOf(form).includes('family') && p.tags.includes('family')) sc += 1.2;
            if (groupsOf(form).includes('friends') && p.tags.some(x => ['social', 'entertainment', 'adventure'].includes(x))) sc += 0.5;
            sc += p.dq === 'complete' || p.dq === 'complete_routable_external_pin' ? 0.6 : p.dq === 'needs_verification' ? -0.4 : 0;
            sc += p.op === 'open' ? 0.3 : p.op === 'open_unverified' ? -0.3 : p.op === 'not_assessed' ? -0.2 : 0;
            sc += eh.flag === 'hrsNone' ? -1.2 : eh.flag === 'hrsDyn' ? -0.6 : eh.flag ? -0.2 : 0;
            if (ci.k === 'dynamic') sc -= b.strict ? 3 : 0.5;
            if (ci.k === 'unknown') sc -= 0.4;
            const dk = dist == null ? 12 : dist;                                 // stay close to the previous stop
            sc -= (prevLL ? 1 : 0.4) * (0.16 * Math.min(dk, 20) + 0.05 * Math.max(0, dk - 20));
            if (!o.ll) sc -= 1.5;                                                // location must be opened in Google Maps
            if (slot.k === 'act') { sc -= (usedToday[p.g] || 0) * 2.5 + (groupCount[p.g] || 0) * 0.6; }
            else sc -= (usedToday[p.sub] || 0) * 1.5;
            if (form.days <= 1 && dur > 150 && ints.hits < 2) sc -= 0.6;
            if (slot.opt && ints.hits === 0) continue;                           // optional evening stop only when it fits the user's interests
            if (pass.reuse) sc -= 1.5;
            const cand = { p, o, arr, dur, dist, tm, ci, sc, flag: eh.flag, over: !pass.budget && ci.v != null && b.strict && spent + ci.v > b.cap };
            if (!best || cand.sc > best.sc + 1e-9 || (Math.abs(cand.sc - best.sc) < 1e-9 && cand.p.id < best.p.id)) best = cand;
          }
        }
        if (best) break;
      }
      if (!best) {
        if (slot.k !== 'act') {                                // explain a skipped meal instead of breaking the budget
          const open = cands.filter(p => !restricted(p, form, slot.k) && openIn(p, slot)).map(p => costAt(p, slot.from).v).filter(v => v != null);
          notes.push({ k: 'skipMeal', slot: slot.k, need: open.length ? Math.min(...open) : null, left: Number.isFinite(b.cap) ? Math.max(0, +(b.cap - spent).toFixed(2)) : null });
        }
        return;
      }
      const { p, o, arr, dur, dist, tm, ci } = best;
      const fl = [];
      if (best.flag) fl.push(best.flag);
      if (ci.k === 'dynamic') fl.push('priceDyn');
      if (ci.k === 'unknown') fl.push('priceUnknown');
      if (ci.k === 'browse') fl.push('browse');
      if (p.cost && p.cost.opt === 'yes') fl.push('optSpend');
      if (p.bk && p.bk.rq === 'yes') fl.push('book'); else if (p.bk && p.bk.rc === 'yes') fl.push('bookRec');
      if (!o.ll) fl.push('noCoords');
      if (p.when === 'sunset') fl.push('sunset');
      if (best.over) fl.push('over');
      if (dist != null && dist > 35) fl.push('far');
      stops.push({ id: p.id, br: o.br || null, ap: o.ap != null ? o.ap : null, slot: slot.k, sf: slot.from, t: arr, e: arr + dur, km: dist == null ? null : +dist.toFixed(1), tm, cost: ci.v, ck: ci.k, fl });
      usedAll.set(p.id, d); usedToday[slot.k === 'act' ? p.g : p.sub] = (usedToday[slot.k === 'act' ? p.g : p.sub] || 0) + 1;
      if (slot.k === 'act') groupCount[p.g] = (groupCount[p.g] || 0) + 1;
      if (ci.v != null) spent += ci.v;
      prevEnd = arr + dur; if (o.ll) prevLL = o.ll;
    });
    refineLocations(D, stops, hotel, date, prefs);
    days.push(stops); dayNotes.push(notes);
  }
  const plan = { id: 'p' + Date.now(), created: Date.now(), form: JSON.parse(JSON.stringify(form)), hotel: hotel ? hotel.id : null, days, dayNotes };
  return plan;
}

/* After a day is built: re-pick branch / access point using BOTH the previous and the next stop. */
function refineLocations(D, stops, hotel, date, prefs) {
  const before = stops.map(s => ({ br: s.br, ap: s.ap, fl: s.fl.slice(), t: s.t, e: s.e, km: s.km, tm: s.tm, cost: s.cost, ck: s.ck }));
  stops.forEach((s, i) => {
    const p = D.byId[s.id]; if (!p || !(p.branches || (p.aps && p.aps.length))) return;
    const prev = i ? locOf(D, stops[i - 1]) : (hotel ? hotel.ll : null);
    const next = i < stops.length - 1 ? locOf(D, stops[i + 1]) : (hotel ? hotel.ll : null);
    let best = null;
    for (const o of optionsOf(D, p, prefs)) {
      const eh = effHours(p, o.hrs != null ? o.hrs : p.hrs, date, o.hs);
      if (!fits(eh.iv, s.t, s.e - s.t)) continue;
      const cost = o.ll ? (km(prev, o.ll) || 0) + (km(o.ll, next) || 0) : 1e6;
      if (!best || cost < best.cost) best = { o, cost };
    }
    if (best) { s.br = best.o.br || null; s.ap = best.o.ap != null ? best.o.ap : null; const fl = s.fl.filter(x => x !== 'noCoords'); if (!best.o.ll) fl.push('noCoords'); s.fl = fl; }
  });
  retimeStops(D, stops, hotel, date);
  /* keep the first choice if re-picking would push a later stop outside its opening hours */
  const lateSun = s => { const p = D.byId[s.id]; return p && p.when === 'sunset' && s.t > sunsetArrive(p, date, locOf(D, s)) + 60; };
  if (stops.some((s, i) => (s.fl.includes('closedRisk') && !before[i].fl.includes('closedRisk')) || (lateSun(s) && !(before[i].t > s.t))))
    stops.forEach((s, i) => Object.assign(s, before[i]));
}

/* location actually used for a stop (branch / access point / place) */
function locOf(D, s) {
  const p = D.byId[s.id]; if (!p) return null;
  if (s.br) return (D.byId[s.br] || {}).ll || null;
  if (s.ap != null && p.aps && p.aps[s.ap]) return p.aps[s.ap].ll;
  return p.ll;
}

/* Recompute times, travel and costs for a day (used after the user edits a plan). */
function retimeStops(D, stops, hotel, date) {
  let prevLL = hotel ? hotel.ll : null, prevEnd = 8 * 60;
  stops.forEach(s => {
    const p = D.byId[s.id]; if (!p) return;
    const ll = locOf(D, s), dist = prevLL && ll ? km(prevLL, ll) : null;
    const tm = prevLL ? travelMin(dist) : 0;
    const from = s.sf != null ? s.sf : (SLOTFROM[s.slot] || 600);
    let arr = Math.max(prevEnd + tm, from);
    if (p.when === 'sunset') arr = Math.max(arr, sunsetArrive(p, date, ll));
    const dur = Math.min(p.dur || 60, s.slot === 'breakfast' ? 60 : 240);
    const brp = s.br ? (D.byId[s.br] || {}) : null;
    const eh = effHours(p, brp ? brp.hrs : p.hrs, date, brp ? brp.hs : p.hs);
    if (!eh.offSeason && !fits(eh.iv, arr, dur)) {             // wait for opening if it is soon
      const o = eh.iv.map(x => x[0]).filter(o => o > arr && o - arr <= 150 && fits(eh.iv, o, dur)).sort((a, b) => a - b)[0];
      if (o != null) arr = o;
    }
    const ci = costAt(p, arr);
    const keep = (s.fl || []).filter(x => x === 'over');
    const fl = keep;
    if (eh.flag) fl.push(eh.flag);
    if (eh.offSeason || !fits(eh.iv, arr, dur)) fl.push('closedRisk');
    if (ci.k === 'dynamic') fl.push('priceDyn');
    if (ci.k === 'unknown') fl.push('priceUnknown');
    if (ci.k === 'browse') fl.push('browse');
    if (p.cost && p.cost.opt === 'yes') fl.push('optSpend');
    if (p.bk && p.bk.rq === 'yes') fl.push('book'); else if (p.bk && p.bk.rc === 'yes') fl.push('bookRec');
    if (!ll) fl.push('noCoords');
    if (p.when === 'sunset') fl.push('sunset');
    if (dist != null && dist > 35) fl.push('far');
    Object.assign(s, { t: arr, e: arr + dur, km: dist == null ? null : +dist.toFixed(1), tm, cost: ci.v, ck: ci.k, fl });
    prevEnd = arr + dur; if (ll) prevLL = ll;
  });
  return stops;
}
function retimePlan(D, pl) {
  const hotel = pl.hotel ? D.byId[pl.hotel] : null;
  pl.days.forEach((stops, d) => retimeStops(D, stops, hotel, dateOf(pl.form.start, d)));
  return pl;
}

/* Plan cost summary (per person sums × people). Hotel prices are dynamic and never added. */
function planCost(D, pl) {
  const b = budgetOf(pl.form), ppl = Math.max(1, +pl.form.people || 1);
  const perDay = pl.days.map(st => st.reduce((s, x) => s + (x.cost || 0), 0));
  const variable = pl.days.flat().filter(x => x.ck === 'dynamic' || x.ck === 'unknown').length;
  const per = perDay.reduce((s, x) => s + x, 0);
  const over = perDay.map((v, d) => ({ d, v, x: Number.isFinite(b.cap) ? v - b.cap : 0 })).filter(o => o.x > 0);
  return { perPerson: per, places: per * ppl, total: per * ppl, perDay, variable, cap: b.cap, over, hotelDynamic: !!pl.hotel };
}

/* Nearby discovery: nearest map places to a point (supporting places only, never itinerary stops). */
function nearby(D, ll, n, maxKm, skipId) {
  if (!ll) return [];
  const out = [];
  for (const x of D.near) {
    if (x.id === skipId) continue;
    const d = km(ll, x.ll); if (d <= maxKm) out.push([d, x]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.slice(0, n).map(([d, x]) => ({ d, x }));
}

const API = { sunsetMin, budgetsOf, groupsOf, hoursOn, effHours, fits, km, travelMin, costAt, tierOf, budgetOf, interestScore, tierFit, buildPlan, retimePlan, retimeStops, planCost, nearby, locOf, dateOf, hm, toMin, INT, SLOTS, CENTER, isBreakfast, isMeal, restricted };
root.SAWAH_PLANNER = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
