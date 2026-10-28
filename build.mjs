// SAWAH build: reads the Riyadh CSV datasets in ./data, converts them into the app's data model,
// inlines data + planner + images into src/app.html and writes dist/index.html (one self-contained file).
// Usage: node build.mjs        (no dependencies; Node 18+)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const V = '1.10';
const file = n => `data/sawah_${n}_FINAL_v${V}.csv`;

/* ---------- tiny RFC-4180 CSV parser ---------- */
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift().map(h => h.replace(/^﻿/, '').trim());
  return rows.filter(r => r.length > 1 || r[0]).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
const load = p => existsSync(p) ? parseCSV(readFileSync(p, 'utf8')) : null;

const main = load(file('main_places'));
const itinFile = load(file('itinerary_eligible'));          // optional: if present it decides itinerary eligibility
const mapPl = load(file('map_places'));
const branches = load(file('branch_locations')) || [];
const access = load(file('access_points')) || [];
const hotels = load(file('hotels')) || [];
const overrides = load('data/coordinate_overrides.csv') || [];
if (!main || !mapPl) throw new Error('main_places and map_places CSV files are required in ./data');

/* ---------- helpers ---------- */
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
const bool = v => v === 'True' || v === 'true' || v === 'yes';
const ll = r => (num(r.latitude) != null && num(r.longitude) != null) ? [+(+r.latitude).toFixed(6), +(+r.longitude).toFixed(6)] : null;
const OVR = Object.fromEntries(overrides.map(o => [o.poi_id, o]));
const GOV = { 'Ad Diriyah Governorate': ['الدرعية', 'Diriyah'], 'Riyadh Governorate': ['الرياض', 'Riyadh'] };
function area(addr, lang) {
  if (!addr) return '';
  const parts = addr.split(lang === 'ar' ? /[،,]/ : /,/).map(s => s.trim()).filter(Boolean);
  const city = s => /^(الرياض|الدرعية|riyadh|diriyah|ad diriyah|al diriyah)(\s+\d+)?$/i.test(s);
  const road = s => /(شارع|طريق|street|road|\brd\b|\bst\b|st\.)/i.test(s);
  const bad = s => city(s) || /\d{3,}|\+|^[A-Z0-9]{4}\d|saudi arabia|المملكة العربية السعودية/i.test(s);
  const clean = s => s.replace(/^حي\s+/, '').replace(/\s*(district|dstrict|distrikt)\s*$/i, '').trim();
  const ci = parts.findIndex(city);
  if (ci > 0 && !bad(parts[ci - 1]) && !road(parts[ci - 1])) return clean(parts[ci - 1]);
  const dist = parts.find(s => /^حي\s/.test(s) || /(district|dstrict|distrikt)$/i.test(s));
  if (dist) return clean(dist);
  const c = parts.find(s => !bad(s) && !road(s));
  return c ? clean(c) : '';
}
const GROUP = {
  restaurant: 'food', cafe: 'food', cinema: 'entertainment', cultural_centre: 'culture', entertainment: 'entertainment',
  historical_site: 'heritage', hotel: 'hotel', landmark: 'heritage', mall: 'shopping', museum: 'heritage', natural_site: 'nature',
  nature_reserve: 'nature', outdoor_activity: 'nature', park: 'nature', theme_park: 'entertainment', traditional_market: 'shopping',
  water_park: 'entertainment', zoo: 'nature', observation_deck: 'entertainment'
};
const REST_AR = {
  'Film age classifications apply; venue states children under 15 are not permitted in screening halls.': 'تطبق تصنيفات الأعمار للأفلام، ولا يُسمح بدخول من هم دون 15 سنة إلى قاعات العرض.',
  'Grip socks required/recommended by venue; some activities have height/guardian rules.': 'الجوارب المانعة للانزلاق مطلوبة، وبعض الأنشطة لها شروط طول أو مرافق.',
  'Minimum age 7': 'العمر الأدنى 7 سنوات',
  'Dinner 12+; afternoon tea all ages': 'العشاء لعمر 12 سنة فأكثر، وشاي العصر لكل الأعمار',
  'Friday is officially positioned for women / women and children (recheck current wording); under 4 free': 'يوم الجمعة مخصص للنساء والأطفال (تحقق من الصياغة الحالية)، ودون 4 سنوات مجانًا'
};
const itinSet = itinFile ? new Set(itinFile.map(r => r.poi_id)) : null;
const brOf = Object.fromEntries(branches.map(b => [b.poi_id, b]));

/* ---------- main places ---------- */
const report = { missingCoords: [], resolvedByOverride: [], unparsedHours: [], brands: {} };
const places = main.map(r => {
  const b = brOf[r.poi_id];
  let coords = ll(r) || (b ? ll(b) : null);
  if (!coords && OVR[r.poi_id]) { coords = [+OVR[r.poi_id].latitude, +OVR[r.poi_id].longitude]; report.resolvedByOverride.push(r.name_en); }
  if (!coords) report.missingCoords.push(r.name_en);
  const govA = GOV[r.governorate] || ['الرياض', 'Riyadh'];
  const p = {
    id: r.poi_id,
    n: [r.name_ar || r.name_en, r.name_en || r.name_ar],
    d: [r.description_ar, r.description_en],
    a: [area(r.address_ar, 'ar') || govA[0], area(r.address_en, 'en') || govA[1]],
    addr: [r.address_ar, r.address_en],
    cat: r.category, sub: r.subcategory, g: GROUP[r.category] || 'culture',
    tags: r.interest_tags ? r.interest_tags.split(';').map(s => s.trim()).filter(Boolean) : [],
    ll: coords,
    hrs: (b && b.opening_hours) || r.opening_hours || '', hs: (b && b.opening_hours_status) || r.opening_hours_status || 'unknown',
    op: r.operating_status,
    free: r.is_free === '' ? null : bool(r.is_free),
    cost: {
      e: num(r.estimated_cost_sar), mn: num(r.cost_min_sar), mx: num(r.cost_max_typical_sar), b: r.cost_basis || null,
      ty: r.cost_type || 'unknown', dy: bool(r.cost_dynamic), req: r.experience_cost_required || null,
      opt: r.optional_spend_available || null, tier: r.budget_tier_display || null
    },
    dur: num(r.estimated_visit_duration_min),
    bk: { rq: (b && b.booking_required) || r.booking_required || null, rc: (b && b.booking_recommended) || r.booking_recommended || null, url: (b && b.external_booking_url) || r.external_booking_url || null },
    web: r.official_website_url || null,
    rest: r.visitor_restrictions ? [REST_AR[r.visitor_restrictions] || r.visitor_restrictions, r.visitor_restrictions] : null,
    itin: itinSet ? itinSet.has(r.poi_id) : bool(r.itinerary_eligible),
    rec: bool(r.recommendation_eligible), map: bool(r.map_display_eligible),
    dq: r.data_status, parent: r.parent_poi_id || null,
    mapUrl: (b && b.routing_map_url) || r.routing_map_url || null,
    gpid: (b && b.routing_provider_place_id) || r.routing_provider_place_id || null
  };
  if (r.brand_group_id) {
    p.brand = r.brand_group_id; p.isBranch = true;
    p.bn = [r.branch_name_ar || (b && b.branch_name_ar) || '', r.branch_name_en || (b && b.branch_name_en) || ''];
    p.brandN = [r.brand_name_ar || (b && b.brand_name_ar) || p.n[0], r.brand_name_en || (b && b.brand_name_en) || p.n[1]];
  }
  return p;
});

/* access points (linear destinations) */
const apBy = {};
for (const a of access) (apBy[a.place_poi_id] = apBy[a.place_poi_id] || []).push({ n: [a.access_name_ar, a.access_name_en], ll: ll(a), role: a.access_role });
for (const p of places) if (apBy[p.id]) p.aps = apBy[p.id];

/* brands: one entity per brand_group_id; branches stay as their own records for routing */
const brandMap = {};
for (const p of places.filter(x => x.brand)) (brandMap[p.brand] = brandMap[p.brand] || []).push(p);
const brands = Object.entries(brandMap).map(([gid, list]) => {
  const f = list.find(x => x.ll) || list[0];
  report.brands[gid] = list.map(x => `${x.bn[1]}${x.ll ? '' : ' (no static coords)'}`);
  return {
    ...f, id: gid, isBranch: false, isBrand: true, n: f.brandN, a: list.length > 1 ? ['عدة فروع', 'Several branches'] : f.a,
    branches: list.map(x => x.id), ll: f.ll, hrs: '', hs: f.hs, itin: list.some(x => x.itin), rec: list.some(x => x.rec),
    dq: list.map(x => x.dq).sort()[0]
  };
});

/* hotels: anchors only (never itinerary stops) */
const hotelRecs = hotels.map(r => ({
  id: r.poi_id, n: [r.name_ar || r.name_en, r.name_en || r.name_ar], d: [r.description_ar, r.description_en],
  a: [area(r.address_ar, 'ar') || 'الرياض', area(r.address_en, 'en') || 'Riyadh'], cat: 'hotel', sub: 'hotel', g: 'hotel', tags: [],
  ll: ll(r), tier: r.hotel_tier || null, anchor: bool(r.hotel_anchor_eligible), priceDyn: bool(r.hotel_price_dynamic) || true,
  hrs: '', hs: 'unknown', op: r.operating_status, cost: { ty: 'unknown', tier: null }, dur: null, bk: { url: r.external_booking_url || null },
  web: r.official_website_url || null, itin: false, rec: bool(r.recommendation_eligible), map: true, dq: r.data_status
}));

/* nearby / map-only supporting places */
const mainIds = new Set(main.map(r => r.poi_id)), hotelIds = new Set(hotels.map(r => r.poi_id));
const near = mapPl.filter(r => !mainIds.has(r.poi_id) && ll(r)).map(r => ({
  id: r.poi_id, n: [r.name_ar || r.name_en, r.name_en || r.name_ar], ll: ll(r), cat: r.category,
  hrs: r.opening_hours || '', core: r.tourism_role === 'core_tourism_poi', hotel: hotelIds.has(r.poi_id)
}));

const DATA = { v: V, built: new Date().toISOString().slice(0, 10), places: [...places, ...brands], hotels: hotelRecs, near };
mkdirSync('dist', { recursive: true });
writeFileSync('dist/data.json', JSON.stringify(DATA));

/* ---------- validate with the real planner ---------- */
const require = createRequire(import.meta.url);
const P = require('./src/planner.js');
const D = { ...DATA, byId: Object.fromEntries([...DATA.places, ...DATA.hotels].map(p => [p.id, p])) };
const today = new Date();
for (const p of DATA.places.filter(x => x.hrs)) for (let k = 0; k < 7; k++) {
  const h = P.hoursOn(p.hrs, new Date(today.getFullYear(), today.getMonth(), today.getDate() + k));
  if (h.kind === 'none') { report.unparsedHours.push(`${p.n[1]}: ${p.hrs}`); break; }
}
report.counts = { main: main.length, itineraryEligibleRecords: places.filter(p => p.itin).length, plannerCandidates: DATA.places.filter(p => p.itin && !p.isBranch && p.cat !== 'hotel').length, brands: brands.length, hotels: hotelRecs.length, nearby: near.length, accessPoints: access.length };

/* ---------- inline into the app ---------- */
mkdirSync('dist', { recursive: true });
const imgs = JSON.parse(readFileSync('src/images.json', 'utf8'));
let html = readFileSync('src/app.html', 'utf8');
for (const [k, v] of Object.entries(imgs)) html = html.split(`__IMG_${k}__`).join(v);
const planner = readFileSync('src/planner.js', 'utf8');
const dataJs = 'const DATA=' + JSON.stringify(DATA).replace(/</g, '\\u003c') + ';';
if (!html.includes('/*__DATA__*/') || !html.includes('/*__PLANNER__*/')) throw new Error('app.html is missing the /*__DATA__*/ or /*__PLANNER__*/ markers');
html = html.replace('/*__DATA__*/', () => dataJs).replace('/*__PLANNER__*/', () => planner);
writeFileSync('dist/index.html', html);
writeFileSync('dist/data-report.json', JSON.stringify(report, null, 2));
console.log('built dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
console.log(JSON.stringify(report, null, 2));
