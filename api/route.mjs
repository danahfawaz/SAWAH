// SAWAH road route (Vercel Function). Turns the stops of one plan day into a line that follows the real
// roads, using OpenRouteService (driving). Needs the environment variable ORS_API_KEY.
// Without the key the app keeps showing straight dashed lines between the stops.
const MAX_POINTS = 40;
const inRiyadhRegion = ([lng, lat]) => lng > 45 && lng < 48 && lat > 23 && lat < 26;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const key = process.env.ORS_API_KEY;
  if (!key) return res.status(503).json({ error: 'not_configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const coords = Array.isArray(body && body.coords) ? body.coords : null;
  if (!coords || coords.length < 2 || coords.length > MAX_POINTS
    || !coords.every(c => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite) && inRiyadhRegion(c))) {
    return res.status(400).json({ error: 'bad_request' });
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/geo+json', Authorization: key },
      body: JSON.stringify({ coordinates: coords })
    });
    if (r.status === 429) return res.status(429).json({ error: 'busy' });
    if (!r.ok) return res.status(502).json({ error: 'upstream', status: r.status });
    const data = await r.json();
    const f = data && data.features && data.features[0];
    const line = f && f.geometry && f.geometry.coordinates;
    if (!Array.isArray(line) || line.length < 2) return res.status(502).json({ error: 'bad_answer' });
    const sum = (f.properties && f.properties.summary) || {};
    return res.status(200).json({
      line: line.map(([lng, lat]) => [+lng.toFixed(5), +lat.toFixed(5)]),
      km: sum.distance ? +(sum.distance / 1000).toFixed(1) : null,
      min: sum.duration ? Math.round(sum.duration / 60) : null
    });
  } catch {
    return res.status(504).json({ error: 'timeout' });
  } finally { clearTimeout(timer); }
}
