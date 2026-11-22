/* Address Report — queries public US datasets directly from the browser. No keys, no backend. */
(() => {
'use strict';

// ---------- endpoints ----------
const EP = {
  nominatim: 'https://nominatim.openstreetmap.org',
  nfhl: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer',
  nri: 'https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Census_Tracts/FeatureServer/0',
  tiger: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer',
  acsBasics: 'https://P3ePLMYs2RVChkJx.svcs.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/ACS_Population_and_Housing_Basics_View_Boundaries/FeatureServer',
  acsNet: 'https://P3ePLMYs2RVChkJx.svcs.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/ACS_Internet_Connectivity_View_Boundaries/FeatureServer',
  acsCost: 'https://P3ePLMYs2RVChkJx.svcs.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/ACS_Housing_Costs_View_Boundaries/FeatureServer',
  nces: 'https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_GEOCODE_PUBLICSCH_2425/MapServer/0',
  epa: 'https://geopub.epa.gov/arcgis/rest/services/EMEF/efpoints/MapServer',
  walk: 'https://geodata.epa.gov/arcgis/rest/services/OA/WalkabilityIndex/MapServer/0',
  noise: {
    conus: 'https://geo.dot.gov/server/rest/services/hosted/NTAD_Noise_2020_CONUS_Aviation_Road_Rail/MapServer',
    alaska: 'https://geo.dot.gov/server/rest/services/hosted/NTAD_Noise_2020_Alaska_Aviation_Road_Rail/MapServer',
    hawaii: 'https://geo.dot.gov/server/rest/services/hosted/NTAD_Noise_2020_Hawaii_Aviation_Road/MapServer',
  },
  epqs: 'https://epqs.nationalmap.gov/v1/json',
  nws: 'https://api.weather.gov',
  aq: 'https://air-quality-api.open-meteo.com/v1/air-quality',
  usgs: 'https://earthquake.usgs.gov/fdsnws/event/1/query',
  overpass: ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'],
};

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtInt = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US');
// ACS top-codes some medians (e.g. home value 2,000,001, rent 3,501, income 250,001): show them as "X+".
const TOPCODES = new Set([2000001, 3501, 250001, 4001]);
const fmtMoney = n => (n == null || isNaN(n) || n < 0) ? '—' : TOPCODES.has(Math.round(n)) ? '$' + (Math.round(n) - 1).toLocaleString('en-US') + '+' : '$' + Math.round(n).toLocaleString('en-US');
const fmtPct = n => (n == null || isNaN(n)) ? '—' : (Math.round(n * 10) / 10) + '%';
const miles = m => m < 0.1 ? 'under 0.1 mi' : (Math.round(m * 10) / 10) + ' mi';
function distMi(lat1, lon1, lat2, lon2) {
  const R = 3958.8, t = Math.PI / 180;
  const dLat = (lat2 - lat1) * t, dLon = (lon2 - lon1) * t;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * t) * Math.cos(lat2 * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
async function getJSON(url, opts = {}) {
  try { return await getJSONOnce(url, opts); }
  catch (e) {
    if (opts.noRetry || !/too long|reached|HTTP 5/.test(e.message)) throw e;
    await new Promise(r => setTimeout(r, 800));
    return getJSONOnce(url, opts);
  }
}
async function getJSONOnce(url, { timeout = 20000, init } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j && j.error) throw new Error(j.error.message || 'service error');
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('the service took too long to answer');
    if (e instanceof TypeError) throw new Error('the service could not be reached');
    throw e;
  } finally { clearTimeout(timer); }
}
const qs = o => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
function pointQuery(base, lon, lat, extra = {}) {
  return base + '/query?' + qs({
    geometry: lon + ',' + lat, geometryType: 'esriGeometryPoint', inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'false', outFields: '*', f: 'json', ...extra,
  });
}
async function firstFeature(base, lon, lat, extra) {
  const j = await getJSON(pointQuery(base, lon, lat, extra));
  return j.features && j.features[0] ? j.features[0].attributes : null;
}
async function nearby(base, lon, lat, radiusMi, extra = {}) {
  const j = await getJSON(base + '/query?' + qs({
    geometry: lon + ',' + lat, geometryType: 'esriGeometryPoint', inSR: 4326, spatialRel: 'esriSpatialRelIntersects',
    distance: radiusMi, units: 'esriSRUnit_StatuteMile', outFields: '*', returnGeometry: 'true', outSR: 4326, f: 'json', ...extra,
  }));
  return (j.features || []).map(f => ({ ...f.attributes, _lat: f.geometry?.y, _lon: f.geometry?.x }));
}

// ---------- rating scales ----------
const NRI_LEVEL = { 'Very High': 5, 'Relatively High': 4, 'Relatively Moderate': 3, 'Relatively Low': 2, 'Very Low': 1 };
const NRI_HAZ = {
  CFLD: 'Coastal flooding', IFLD: 'River flooding', HRCN: 'Hurricane', TRND: 'Tornado', SWND: 'Strong wind',
  HAIL: 'Hail', LTNG: 'Lightning', WFIR: 'Wildfire', ERQK: 'Earthquake', LNDS: 'Landslide', HWAV: 'Heat wave',
  CWAV: 'Cold wave', WNTW: 'Winter weather', ISTM: 'Ice storm', DRGT: 'Drought', TSUN: 'Tsunami',
  VLCN: 'Volcanic activity', AVLN: 'Avalanche',
};
const NOISE_CLASSES = [
  { label: '45–50 dB', rgb: [255, 193, 7], lvl: 1, say: 'about like a quiet suburban street' },
  { label: '50–55 dB', rgb: [255, 128, 0], lvl: 2, say: 'like a quiet conversation, noticeable outdoors' },
  { label: '55–60 dB', rgb: [255, 0, 0], lvl: 3, say: 'around the 55 dB guideline the EPA set for outdoor areas, so traffic will be noticeable outside' },
  { label: '60–70 dB', rgb: [255, 51, 153], lvl: 4, say: 'loud: steady traffic noise, may affect sleep with windows open' },
  { label: '70–80 dB', rgb: [163, 0, 204], lvl: 5, say: 'very loud, typical right next to a highway or busy rail line' },
  { label: '80–90 dB', rgb: [82, 0, 204], lvl: 5, say: 'extremely loud, typical beside a major highway or under a flight path' },
  { label: 'over 90 dB', rgb: [0, 0, 255], lvl: 5, say: 'extremely loud, typical at an airport boundary' },
];

// ---------- map ----------
const map = L.map('map', { zoomControl: true, scrollWheelZoom: false }).setView([39.5, -98.35], 4);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
map.on('focus', () => map.scrollWheelZoom.enable());
const pinIcon = L.divIcon({ className: 'addr-pin', iconSize: [18, 18] });
let pin = null, radiusRing = null;

const ArcExport = L.TileLayer.extend({
  getTileUrl(c) {
    const size = 256, ts = 2 * 20037508.342789 / Math.pow(2, c.z);
    const xmin = -20037508.342789 + c.x * ts, ymax = 20037508.342789 - c.y * ts;
    return this._url + '/export?' + qs({
      bbox: [xmin, ymax - ts, xmin + ts, ymax].join(','), bboxSR: 3857, imageSR: 3857, size: size + ',' + size,
      format: 'png32', transparent: 'true', layers: this.options.layers, f: 'image',
    });
  },
});
const floodLayer = new ArcExport(EP.nfhl, { layers: 'show:28', opacity: 0.55, minZoom: 12, maxZoom: 19, attribution: 'FEMA NFHL' });
const NOISE_BOUNDS = { conus: [[24, -125], [49.5, -66.5]], alaska: [[51, -180], [71.5, -129]], hawaii: [[18.5, -161], [22.5, -154.5]] };
const noiseLayers = Object.entries(EP.noise).map(([k, u]) => L.tileLayer(u + '/tile/{z}/{y}/{x}', { maxNativeZoom: 12, maxZoom: 19, opacity: 0.55, bounds: NOISE_BOUNDS[k], attribution: 'US DOT BTS' }));

function renderLegend() {
  const parts = [];
  if ($('#ov-flood').checked) parts.push('<h4>FEMA flood zones</h4><div>Zoom in to street level to see zones. Each area is labeled with its zone: A and V zones are high risk, shaded X (0.2% annual chance) is moderate, and unshaded X is minimal.</div>');
  if ($('#ov-noise').checked) parts.push('<h4>Transportation noise (24-hour average)</h4>' + NOISE_CLASSES.map(c => `<div><span class="sw" style="background:rgb(${c.rgb})"></span>${c.label}</div>`).join(''));
  $('#legend').innerHTML = parts.join('');
  $('#legend').hidden = !parts.length;
}
$('#ov-flood').addEventListener('change', e => { e.target.checked ? floodLayer.addTo(map) : map.removeLayer(floodLayer); renderLegend(); });
$('#ov-noise').addEventListener('change', e => { noiseLayers.forEach(l => e.target.checked ? l.addTo(map) : map.removeLayer(l)); renderLegend(); });

// ---------- geocoding ----------
let lastNominatim = 0;
async function nominatim(path) {
  const wait = Math.max(0, lastNominatim + 1100 - Date.now());
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastNominatim = Date.now();
  return getJSON(EP.nominatim + path, { timeout: 15000, noRetry: true });
}
async function geocode(q) {
  const res = await nominatim('/search?' + qs({ q, format: 'jsonv2', addressdetails: 1, countrycodes: 'us', limit: 5 }));
  return res.map(r => ({ lat: +r.lat, lon: +r.lon, label: tidyLabel(r), type: r.addresstype || r.type }));
}
function tidyLabel(r) {
  const a = r.address || {};
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const city = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || '';
  const st = (a['ISO3166-2-lvl4'] || '').replace('US-', '') || a.state || '';
  const name = r.name && !street.includes(r.name) && r.name !== a.road ? r.name : '';
  const parts = [name, street, city, [st, a.postcode].filter(Boolean).join(' ')].filter(Boolean);
  const s = parts.filter((p, i) => parts.indexOf(p) === i).join(', ');
  return s || r.display_name;
}
async function reverse(lat, lon) {
  try {
    const r = await nominatim('/reverse?' + qs({ lat, lon, format: 'jsonv2', addressdetails: 1, zoom: 18 }));
    return r && !r.error ? tidyLabel(r) : null;
  } catch { return null; }
}

// ---------- search UI ----------
const form = $('#search'), input = $('#q'), msg = $('#search-msg'), choices = $('#choices');
form.addEventListener('submit', async e => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  await runSearch(q);
});
async function runSearch(q) {
  choices.hidden = true; msg.textContent = 'Finding the address…'; $('#go').disabled = true;
  try {
    const res = await geocode(q);
    if (!res.length) { msg.textContent = 'No US match for that address. Try adding the city and state, or click the spot on the map.'; return; }
    const seen = new Set(), uniq = res.filter(r => !seen.has(r.label) && seen.add(r.label));
    // A query with a house number goes straight to the best match carrying that number.
    const num = (q.match(/^\s*(\d+[A-Za-z]?)\b/) || [])[1];
    if (num) {
      const hit = uniq.find(r => r.label.startsWith(num + ' ')) || uniq.find(r => new RegExp('\\b' + num + '\\b').test(r.label));
      if (hit) { msg.textContent = ''; return report(hit); }
    }
    if (uniq.length > 1) {
      msg.textContent = 'Several places match. Pick one:';
      choices.innerHTML = uniq.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.label)}</button></li>`).join('');
      choices.hidden = false;
      choices.querySelectorAll('button').forEach(b => b.onclick = () => { choices.hidden = true; msg.textContent = ''; report(uniq[+b.dataset.i]); });
      return;
    }
    msg.textContent = '';
    report(uniq[0]);
  } catch (err) {
    msg.textContent = 'Address lookup failed (' + err.message + '). Try again, or click the spot on the map.';
  } finally { $('#go').disabled = false; }
}
map.on('click', async e => {
  const lat = +e.latlng.lat.toFixed(6), lon = +e.latlng.lng.toFixed(6);
  report({ lat, lon, label: `Point at ${lat.toFixed(5)}, ${lon.toFixed(5)}`, fromClick: true });
});

// ---------- report orchestration ----------
let runId = 0;
const glance = {};
const GLANCE_ORDER = ['flood', 'risk', 'noise', 'net', 'walk', 'env'];
function setGlance(key, label, value, lvl) {
  glance[key] = { label, value, lvl };
  $('#glance').innerHTML = GLANCE_ORDER.filter(k => glance[k]).map(k =>
    `<div class="chip lvl${glance[k].lvl ?? 0}"><div class="k">${esc(glance[k].label)}</div><div class="v">${esc(glance[k].value)}</div></div>`).join('');
}
function card(id, title) {
  const el = document.createElement('section');
  el.className = 'card loading'; el.id = 'card-' + id;
  el.innerHTML = `<h2>${esc(title)}</h2><div class="body">Loading…</div>`;
  $('#cards').appendChild(el);
  return {
    done(html, badge) {
      el.className = 'card';
      el.querySelector('h2').innerHTML = esc(title) + (badge ? ' ' + badge : '');
      el.querySelector('.body').innerHTML = html;
    },
    fail(err, src) {
      el.className = 'card error';
      el.querySelector('.body').innerHTML = `<p>Couldn't load this section: ${esc(err.message || err)}. The source may be down; try again later.</p>${src || ''}`;
    },
  };
}
const badge = (text, lvl) => `<span class="badge lvl${lvl ?? 0}">${esc(text)}</span>`;
const src = (html) => `<p class="src">Source: ${html}</p>`;

function report(place) {
  const id = ++runId;
  const { lat, lon } = place;
  for (const k in glance) delete glance[k];
  $('#glance').innerHTML = '';
  $('#cards').innerHTML = '';
  $('#intro').hidden = true; $('#report').hidden = false;
  $('#r-addr').textContent = place.label;
  $('#r-geo').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  $('#msc-link').href = 'https://msc.fema.gov/portal/search?AddressQuery=' + encodeURIComponent(place.fromClick ? `${lat},${lon}` : place.label);
  if (!place.fromClick) input.value = place.label;

  if (pin) map.removeLayer(pin);
  if (radiusRing) map.removeLayer(radiusRing);
  pin = L.marker([lat, lon], { icon: pinIcon, keyboard: false }).addTo(map);
  radiusRing = L.circle([lat, lon], { radius: 1609, color: '#1f3a5f', weight: 1, fill: false, dashArray: '4 4' }).addTo(map);
  map.setView([lat, lon], 15);

  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('lat', lat.toFixed(6)); url.searchParams.set('lon', lon.toFixed(6));
  url.searchParams.set('label', place.label);
  history.replaceState(null, '', url);
  document.title = place.label + ' · Address Report';

  if (place.fromClick) reverse(lat, lon).then(l => { if (l && id === runId) { $('#r-addr').textContent = l; place.label = l; input.value = l;
    url.searchParams.set('label', l); history.replaceState(null, '', url); document.title = l + ' · Address Report'; } });

  const live = fn => (...a) => id === runId && fn(...a);
  const sections = [
    ['place', 'Where this is', loadPlace],
    ['flood', 'Flood zone', loadFlood],
    ['risk', 'Natural hazard risk', loadRisk],
    ['noise', 'Transportation noise', loadNoise],
    ['env', 'Contamination and pollution nearby', loadEnv],
    ['hood', 'Neighborhood (Census tract)', loadHood],
    ['net', 'Home internet', loadNet],
    ['schools', 'Nearest public schools', loadSchools],
    ['walk', 'Walkability and everyday errands', loadWalk],
    ['now', 'Right now: weather alerts and air quality', loadNow],
    ['ground', 'Elevation and earthquakes', loadGround],
  ];
  for (const [key, title, fn] of sections) {
    const c = card(key, title);
    const wrapped = { done: live(c.done), fail: live(c.fail) };
    fn(lat, lon, wrapped, live(setGlance)).catch(err => wrapped.fail(err));
  }
}

// ---------- sections ----------
async function loadPlace(lat, lon, c) {
  const L_ = { state: 80, county: 82, place: 28, cdp: 30, cd: 54, unified: 14, elem: 18, sec: 16, tract: 8 };
  const q = k => firstFeature(EP.tiger + '/' + L_[k], lon, lat, { outFields: 'NAME,GEOID,BASENAME' }).catch(() => null);
  const [state, county, place, cdp, cd, uni, elem, sec, tract] = await Promise.all(Object.keys(L_).map(q));
  if (!state) throw new Error('this point is outside the United States, or the Census boundary service did not answer');
  const town = place ? place.NAME.replace(/ (city|town|village|borough|municipality)$/i, '') : cdp ? cdp.NAME.replace(/ CDP$/, '') : 'Unincorporated area';
  const districts = [uni, elem, sec].filter(Boolean).map(d => d.NAME);
  $('#r-geo').textContent = [town, county?.NAME, state.NAME].filter(Boolean).join(' · ');
  c.done(`<div class="kv">
      <div><b>${esc(town)}</b><span>City or town</span></div>
      <div><b>${esc(county?.NAME || '—')}</b><span>County</span></div>
      <div><b>${esc(cd?.NAME?.replace('Congressional District', 'District') || '—')}</b><span>US House district</span></div>
      <div><b>${esc(tract?.NAME?.replace('Census Tract ', '') || '—')}</b><span>Census tract</span></div>
    </div>
    <p><strong>School district${districts.length > 1 ? 's' : ''}:</strong> ${districts.length ? districts.map(esc).join('; ') : 'not found'}</p>`
    + src('US Census Bureau <a href="https://tigerweb.geo.census.gov/" target="_blank" rel="noopener">TIGERweb</a> current boundaries.'));
}

async function loadFlood(lat, lon, c, g) {
  const j = await getJSON(pointQuery(EP.nfhl + '/28', lon, lat, { outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DEPTH' }));
  const f = j.features?.[0]?.attributes;
  const s = src('FEMA <a href="https://www.fema.gov/flood-maps/national-flood-hazard-layer" target="_blank" rel="noopener">National Flood Hazard Layer</a>, effective flood maps. Lenders use the official map panel; check the <a href="https://msc.fema.gov/portal/home" target="_blank" rel="noopener">Map Service Center</a> before you rely on this.');
  if (!f) {
    g('flood', 'Flood zone', 'No digital map', 0);
    return c.done(`<p class="lede">FEMA has no digital flood map for this spot.</p><p>Some counties only have older paper maps, and a few areas have never been mapped. No map does <em>not</em> mean no flood risk. Look at the river and coastal flood ratings in the hazard section below, and ask the seller or landlord about past flooding.</p>` + s, badge('Not mapped', 0));
  }
  const z = (f.FLD_ZONE || '').trim(), sub = (f.ZONE_SUBTY || '').toUpperCase();
  let lvl, short, lede, more = '';
  if (/^V/.test(z)) {
    lvl = 5; short = 'High risk, coastal';
    lede = `Zone ${z}: a high-risk coastal flood zone with storm waves.`;
    more = 'There is at least a 1% chance of flooding each year, about a 26% chance over a 30-year mortgage, with added damage from waves. Federally backed mortgages require flood insurance here, and building rules are strict.';
  } else if (/^A/.test(z)) {
    lvl = 5; short = 'High risk';
    lede = `Zone ${z}: a high-risk flood zone (Special Flood Hazard Area).`;
    more = 'There is at least a 1% chance of flooding each year, about a 26% chance over a 30-year mortgage. Lenders require flood insurance for federally backed mortgages. Renters should get contents coverage.';
    if (z === 'AO' || z === 'AH') more += ' This zone type means shallow flooding, usually 1 to 3 feet, from ponding or sheet flow.';
  } else if (z === 'X' && sub.includes('0.2 PCT')) {
    lvl = 3; short = 'Moderate risk';
    lede = 'Zone X (shaded): a moderate flood risk area.';
    more = 'This area floods in roughly a 500-year event (0.2% chance each year), or has shallow 1% flooding. Insurance is not required but is usually cheap here and worth pricing: a large share of flood claims come from outside high-risk zones.';
  } else if (z === 'X' && sub.includes('LEVEE')) {
    lvl = 3; short = 'Behind a levee';
    lede = 'Zone X, protected by a levee.';
    more = 'The levee lowers the mapped risk, but levees can be overtopped or fail, and the land behind one is often low. FEMA recommends flood insurance here.';
  } else if (z === 'X' || z === 'C' || z === 'B') {
    lvl = 1; short = 'Minimal risk';
    lede = `Zone ${z}: minimal mapped flood risk.`;
    more = 'This spot is outside the 500-year floodplain on FEMA\'s map. Heavy rain and backed-up drains can still flood homes, and these maps don\'t include future climate.';
  } else if (z === 'D') {
    lvl = 2; short = 'Undetermined';
    lede = 'Zone D: flood risk is possible but has not been studied.';
  } else if (z.includes('OPEN WATER')) {
    lvl = 0; short = 'Open water'; lede = 'This point falls on open water.';
  } else { lvl = 2; short = 'Zone ' + z; lede = `Zone ${z}.`; }
  const bfe = f.STATIC_BFE != null && f.STATIC_BFE > -9000 ? `<p><strong>Base flood elevation:</strong> ${Math.round(f.STATIC_BFE * 10) / 10} ft. A building's lowest floor should be above this.</p>` : '';
  g('flood', 'Flood zone', short, lvl);
  c.done(`<p class="lede">${esc(lede)}</p><p>${esc(more)}</p>${bfe}<p class="weak">Tip: turn on "FEMA flood zones" under the map to see where the zone boundary falls around the property.</p>` + s, badge(short, lvl));
}

async function loadRisk(lat, lon, c, g) {
  const a = await firstFeature(EP.nri, lon, lat);
  if (!a) throw new Error('no risk data for this location');
  const comp = a.RISK_RATNG, lvl = NRI_LEVEL[comp] ?? 0;
  const haz = Object.entries(NRI_HAZ).map(([k, name]) => ({ name, r: a[k + '_RISKR'], lvl: NRI_LEVEL[a[k + '_RISKR']] ?? 0 }))
    .filter(h => h.lvl > 0).sort((x, y) => y.lvl - x.lvl);
  const top = haz.filter(h => h.lvl >= 4).slice(0, 3).map(h => h.name.toLowerCase());
  const colors = ['#9aa3ae', '#3f8a6a', '#7fae6b', '#e2a13b', '#d4562e', '#a3142b'];
  const bars = haz.slice(0, 10).map(h => `<div class="bar"><span>${esc(h.name)}</span><span class="track"><span class="fill" style="width:${h.lvl * 20}%;background:${colors[h.lvl]}"></span></span><span class="lab">${esc(h.r)}</span></div>`).join('');
  const eal = a.EAL_VALT ? fmtMoney(a.EAL_VALT) : null;
  g('risk', 'Hazard risk', comp || '—', lvl);
  const why = !top.length ? '' : lvl >= 3 ? `, driven mainly by ${esc(listJoin(top))}` : `, although ${esc(listJoin(top))} ${top.length > 1 ? 'are' : 'is'} rated high here`;
  c.done(`<p class="lede">Overall natural hazard risk for this Census tract is <strong>${esc((comp || 'not rated').toLowerCase())}</strong> compared with the rest of the US${why}.</p>
    <div class="bars">${bars || '<p>No hazards are rated for this tract.</p>'}</div>
    <p class="weak">Ratings compare this tract with every other US tract. They combine how often a hazard happens, what's exposed and how well the community recovers${eal ? `; FEMA estimates about ${eal} a year in losses across the whole tract` : ''}. Community resilience: ${esc(a.RESL_RATNG || '—')}. Social vulnerability: ${esc(a.SOVI_RATNG || '—')}.</p>`
    + src('FEMA <a href="https://hazards.fema.gov/nri/" target="_blank" rel="noopener">National Risk Index</a>, tract ' + esc(a.TRACTFIPS || '') + '. For property-level wildfire detail see <a href="https://wildfirerisk.org/" target="_blank" rel="noopener">Wildfire Risk to Communities</a>.'), badge(comp || 'Not rated', lvl));
}
const listJoin = arr => arr.length < 2 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];

function noiseService(lat, lon) {
  if (lat > 51 && lon < -129) return EP.noise.alaska;
  if (lat < 23.5 && lon < -154) return EP.noise.hawaii;
  return EP.noise.conus;
}
async function samplePixels(base, lat, lon, z, offsets) {
  const n = 2 ** z, fx = (lon + 180) / 360 * n, r = lat * Math.PI / 180;
  const fy = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  const cache = {};
  const out = [];
  for (const [dx, dy] of offsets) {
    const gx = fx * 256 + dx, gy = fy * 256 + dy;
    const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256), key = tx + '/' + ty;
    if (!(key in cache)) cache[key] = (async () => {
      const resp = await fetch(`${base}/tile/${z}/${ty}/${tx}`);
      if (resp.status === 404) return null; // no tile = no noise mapped
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const bm = await createImageBitmap(await resp.blob());
      const cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bm, 0, 0);
      return cx;
    })();
    const cx = await cache[key];
    if (!cx) { out.push(null); continue; }
    const d = cx.getImageData(Math.floor(gx - tx * 256), Math.floor(gy - ty * 256), 1, 1).data;
    out.push(d[3] < 60 ? null : classifyNoise(d));
  }
  return out;
}
function classifyNoise(d) {
  let best = null, bd = 1e9;
  NOISE_CLASSES.forEach((cl, i) => { const dd = (d[0] - cl.rgb[0]) ** 2 + (d[1] - cl.rgb[1]) ** 2 + (d[2] - cl.rgb[2]) ** 2; if (dd < bd) { bd = dd; best = i; } });
  return bd < 9000 ? best : null;
}
async function loadNoise(lat, lon, c, g) {
  const base = noiseService(lat, lon);
  const offs = [[0, 0]];
  for (const r of [2, 4]) for (const [a, b] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) offs.push([a, b]);
  const vals = await samplePixels(base, lat, lon, 12, offs);
  const here = vals[0];
  const near = vals.filter(v => v != null).reduce((m, v) => Math.max(m, v), -1);
  const s = src('US DOT Bureau of Transportation Statistics <a href="https://www.bts.gov/geospatial/national-transportation-noise-map" target="_blank" rel="noopener">National Transportation Noise Map</a> (2020), modeled 24-hour average road, rail and aviation noise. It does not include local sources like bars, construction or industry. Grid resolution is about 30 to 40 m.');
  if (here == null && near < 0) {
    g('noise', 'Noise', 'Under 45 dB', 1);
    return c.done(`<p class="lede">Modeled transportation noise here is <strong>below 45 dB</strong>, the lowest level the map shows.</p><p>Road, rail and aircraft noise should be low. That's quieter than a typical suburban street.</p>` + s, badge('Quiet', 1));
  }
  const cl = here != null ? NOISE_CLASSES[here] : null, nc = NOISE_CLASSES[near];
  const lvl = cl ? cl.lvl : 1;
  g('noise', 'Noise', cl ? cl.label : 'Under 45 dB', lvl);
  let html = cl ? `<p class="lede">Modeled transportation noise at this spot: <strong>${cl.label}</strong>, ${esc(cl.say)}.</p>`
                : `<p class="lede">Modeled transportation noise at this spot is <strong>below 45 dB</strong>.</p>`;
  if (near > (here ?? -1)) html += `<p>Within about 150 m it rises to <strong>${nc.label}</strong> (${esc(nc.say)}), so which side of the building faces the road matters.</p>`;
  html += `<p class="weak">Turn on "Transportation noise" under the map to see where the loud corridors are.</p>`;
  c.done(html + s, badge(cl ? cl.label : 'Quiet', lvl));
}

async function loadEnv(lat, lon, c, g) {
  const fields = { outFields: '*' };
  const [sf, tri, bf] = await Promise.all([
    nearby(EP.epa + '/0', lon, lat, 3, fields), nearby(EP.epa + '/1', lon, lat, 1, fields), nearby(EP.epa + '/5', lon, lat, 1, fields),
  ]);
  const withD = arr => arr.map(x => ({ ...x, d: distMi(lat, lon, x.latitude ?? x._lat, x.longitude ?? x._lon) })).sort((a, b) => a.d - b.d);
  const S = withD(sf), T = withD(tri), B = withD(bf);
  const sfClose = S.filter(x => x.d <= 1).length;
  const lvl = sfClose ? 4 : S.length ? 3 : T.length > 2 ? 3 : (T.length || B.length) ? 2 : 1;
  g('env', 'Contamination', S.length ? `${S.length} Superfund ≤3 mi` : T.length ? `${T.length} toxic-release ≤1 mi` : 'None flagged nearby', lvl);
  const li = x => `<li>${esc(titleCase(x.primary_name))} — ${miles(x.d)}${x.profile_url || x.facility_url ? ` · <a href="${esc(x.profile_url || x.facility_url)}" target="_blank" rel="noopener">EPA record</a>` : ''}</li>`;
  let html = `<div class="kv">
      <div><b>${S.length}</b><span>Superfund sites within 3 mi</span></div>
      <div><b>${T.length}</b><span>Toxic Release Inventory facilities within 1 mi</span></div>
      <div><b>${B.length}</b><span>Brownfield sites within 1 mi</span></div></div>`;
  if (!S.length && !T.length && !B.length) html += '<p class="lede">No Superfund, toxic-release or brownfield sites are recorded close by.</p>';
  if (S.length) html += `<h3>Superfund sites</h3><ul class="list">${S.slice(0, 5).map(li).join('')}</ul><p class="weak">Superfund sites are places with hazardous contamination that the EPA tracks for cleanup. Being nearby is not proof of exposure; groundwater direction and cleanup status matter. Follow the EPA record for the current status.</p>`;
  if (T.length) html += `<h3>Facilities that report toxic releases</h3><ul class="list">${T.slice(0, 5).map(li).join('')}</ul>`;
  if (B.length) html += `<h3>Brownfields</h3><ul class="list">${B.slice(0, 5).map(li).join('')}</ul>`;
  c.done(html + src('EPA <a href="https://www.epa.gov/enviro/envirofacts-overview" target="_blank" rel="noopener">Envirofacts</a> facility locations (Superfund/SEMS, TRI, ACRES brownfields). Locations are facility points, not contamination footprints.'), badge(S.length ? 'Check' : 'Low', lvl));
}
const titleCase = s => String(s || '').toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(Llc|Inc|Usa|Us|Epa|Dod|Afb)\b/g, m => m.toUpperCase());

function reliability(est, moe) {
  if (est == null || moe == null || est <= 0) return '';
  return moe / 1.645 / est > 0.3 ? ' <span class="weak" title="The Census margin of error is large relative to the estimate">(low reliability)</span>' : '';
}
async function loadHood(lat, lon, c) {
  const [t, k, tc] = await Promise.all([firstFeature(EP.acsBasics + '/2', lon, lat), firstFeature(EP.acsBasics + '/1', lon, lat), firstFeature(EP.acsCost + '/2', lon, lat).catch(() => null)]);
  if (!t) throw new Error('no Census tract data here');
  const row = (label, a, b, f, moeKey) => `<tr><td>${label}</td><td class="num">${f(a?.[moeKey.replace(/M$/, 'E')])}${reliability(a?.[moeKey.replace(/M$/, 'E')], a?.[moeKey])}</td><td class="num">${f(b?.[moeKey.replace(/M$/, 'E')])}</td></tr>`;
  const own = t.B25003_calc_pctOwnE;
  const burden = tc?.B25070_calc_pctGE30pctE;
  c.done(`<table class="data"><thead><tr><th></th><th class="num">This tract</th><th class="num">${esc(k?.NAME || 'County')}</th></tr></thead><tbody>
      ${row('Population', t, k, fmtInt, 'B01001_001M')}
      ${row('Median age', t, k, v => v == null ? '—' : v.toFixed(1), 'B01002_001M')}
      ${row('Median household income', t, k, fmtMoney, 'B19049_001M')}
      ${row('Median rent (contract)', t, k, fmtMoney, 'B25058_001M')}
      ${row('Median home value', t, k, fmtMoney, 'B25077_001M')}
      <tr><td>Homes owner-occupied</td><td class="num">${fmtPct(own)}</td><td class="num">${fmtPct(k?.B25003_calc_pctOwnE)}</td></tr>
      <tr><td>Vacant housing units</td><td class="num">${fmtPct(t.B25002_001E ? t.B25002_003E / t.B25002_001E * 100 : null)}</td><td class="num">${fmtPct(k?.B25002_001E ? k.B25002_003E / k.B25002_001E * 100 : null)}</td></tr>
      <tr><td>Under 18 / 65 and over</td><td class="num">${fmtPct(t.B01001_calc_pctLT18E)} / ${fmtPct(t.B01001_calc_pctGE65E)}</td><td class="num">${fmtPct(k?.B01001_calc_pctLT18E)} / ${fmtPct(k?.B01001_calc_pctGE65E)}</td></tr>
    </tbody></table>
    ${burden != null ? `<p>${fmtPct(burden)} of renters in this tract spend 30% or more of their income on rent${burden >= 50 ? ', a sign rents are high relative to local incomes' : ''}.</p>` : ''}
    <p class="weak">Figures are survey estimates for ${esc(t.NAME || 'the tract')}, not this address. Rows marked "low reliability" have a large margin of error.</p>`
    + src('US Census Bureau American Community Survey 5-year estimates, via the <a href="https://livingatlas.arcgis.com/" target="_blank" rel="noopener">ArcGIS Living Atlas</a> (latest release).'));
}

async function loadNet(lat, lon, c, g) {
  const [t, k] = await Promise.all([firstFeature(EP.acsNet + '/2', lon, lat), firstFeature(EP.acsNet + '/1', lon, lat)]);
  if (!t) throw new Error('no Census tract data here');
  const share = a => a && a.B28001_001E ? a.B28002_004E / a.B28001_001E * 100 : null;
  const fiberish = a => a && a.B28001_001E ? a.B28002_007E / a.B28001_001E * 100 : null;
  const bb = share(t), none = t.B28002_calc_pctNoIntE;
  const lvl = bb == null ? 0 : bb >= 90 ? 1 : bb >= 80 ? 2 : bb >= 70 ? 3 : 4;
  g('net', 'Broadband homes', bb == null ? '—' : fmtPct(bb), lvl);
  c.done(`<p class="lede"><strong>${fmtPct(bb)}</strong> of households in this tract subscribe to broadband (county: ${fmtPct(share(k))}).</p>
    <div class="kv"><div><b>${fmtPct(fiberish(t))}</b><span>Cable, fiber or DSL subscription</span></div>
    <div><b>${fmtPct(none)}</b><span>No internet at all</span></div>
    <div><b>${fmtPct(t.B28001_calc_pctNoCompE)}</b><span>No computer</span></div></div>
    <p class="weak">This is what neighbors subscribe to, which is a good hint at what's available. A low share in a rural area often means wired service doesn't reach. <a href="https://broadbandmap.fcc.gov/home" target="_blank" rel="noopener">Check exact providers at this address on the FCC map</a>.</p>`
    + src('US Census Bureau American Community Survey 5-year estimates (tables B28001, B28002).'), badge(bb == null ? 'No data' : fmtPct(bb) + ' broadband', lvl));
}

const LOCALE = { 11: 'Large city', 12: 'Midsize city', 13: 'Small city', 21: 'Large suburb', 22: 'Midsize suburb', 23: 'Small suburb', 31: 'Fringe town', 32: 'Distant town', 33: 'Remote town', 41: 'Fringe rural', 42: 'Distant rural', 43: 'Remote rural' };
async function loadSchools(lat, lon, c) {
  const f = { outFields: 'NCESSCH,NAME,STREET,CITY,LAT,LON,LOCALE,SCHOOLYEAR' };
  let r = 2, list = await nearby(EP.nces, lon, lat, r, f);
  if (list.length < 3) { r = 10; list = await nearby(EP.nces, lon, lat, r, f); }
  if (list.length < 1) { r = 30; list = await nearby(EP.nces, lon, lat, r, f); }
  const S = list.map(s => ({ ...s, d: distMi(lat, lon, s.LAT, s.LON) })).sort((a, b) => a.d - b.d).slice(0, 8);
  if (!S.length) return c.done('<p>No public schools found within 30 miles.</p>' + src('NCES EDGE public school locations.'));
  c.done(`<table class="data"><thead><tr><th>School</th><th class="num">Distance</th></tr></thead><tbody>
    ${S.map(s => `<tr><td><a href="https://nces.ed.gov/ccd/schoolsearch/school_detail.asp?ID=${esc(s.NCESSCH)}" target="_blank" rel="noopener">${esc(titleCase(s.NAME))}</a><br><span class="weak">${esc(titleCase(s.STREET))}, ${esc(titleCase(s.CITY))}</span></td><td class="num">${miles(s.d)}</td></tr>`).join('')}
    </tbody></table>
    <p class="weak">Straight-line distance. Nearest isn't necessarily assigned: confirm attendance zones with the school district listed above. Area type: ${esc(LOCALE[+S[0].LOCALE] || '—')}.</p>`
    + src(`National Center for Education Statistics <a href="https://nces.ed.gov/programs/edge/Geographic/SchoolLocations" target="_blank" rel="noopener">EDGE public school locations</a>, ${esc(S[0].SCHOOLYEAR || '2024-25')}.`));
}

async function loadWalk(lat, lon, c, g) {
  const s = src('EPA <a href="https://www.epa.gov/smartgrowth/smart-location-mapping" target="_blank" rel="noopener">National Walkability Index</a> (block group); places from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors via Overpass. OpenStreetMap coverage varies by area.');
  const w = await firstFeature(EP.walk, lon, lat, { outFields: 'NatWalkInd' }).catch(() => null);
  const wi = w?.NatWalkInd;
  let wl = null, wlvl = 0;
  if (wi != null) {
    if (wi > 15.25) { wl = 'Most walkable'; wlvl = 1; } else if (wi > 10.5) { wl = 'Above average'; wlvl = 2; }
    else if (wi > 5.75) { wl = 'Below average'; wlvl = 3; } else { wl = 'Least walkable'; wlvl = 4; }
    g('walk', 'Walkability', `${wl} (${wi.toFixed(1)}/20)`, wlvl);
  }
  const head = wi != null ? `<p class="lede">EPA walkability score: <strong>${wi.toFixed(1)} out of 20</strong>, ${esc(wl.toLowerCase())}.</p>` : '';
  c.done(head + '<p class="weak"><span class="spin"></span>Looking up shops and services within a mile. This part can take up to a minute.</p>' + s, wl ? badge(wl, wlvl) : '');
  const R = 1609;
  const q = `[out:json][timeout:55];(
    nw(around:${R},${lat},${lon})[shop~"^(supermarket|grocery|greengrocer)$"];
    nw(around:${R},${lat},${lon})[amenity~"^(pharmacy|hospital|clinic|doctors|cafe|restaurant)$"];
    nw(around:${R},${lat},${lon})[leisure~"^(park|playground)$"];
    node(around:800,${lat},${lon})[highway=bus_stop];
    node(around:${R},${lat},${lon})[railway~"^(station|halt|tram_stop)$"];
  );out tags center 600;`;
  let data = null, lastErr;
  try {
    data = await Promise.any(EP.overpass.map(u => getJSON(u, { timeout: 65000, noRetry: true,
      init: { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } })));
  } catch (e) { lastErr = e.errors ? e.errors[0] : e; }
  if (!data) return c.done(head + `<p class="weak">Nearby shops and services couldn't load (${esc(lastErr?.message)}). The OpenStreetMap servers may be busy; reload in a few minutes.</p>` + s, wl ? badge(wl, wlvl) : '');
  const cats = [
    ['Grocery stores', t => /^(supermarket|grocery|greengrocer)$/.test(t.shop)],
    ['Pharmacies', t => t.amenity === 'pharmacy'],
    ['Parks and playgrounds', t => /^(park|playground)$/.test(t.leisure)],
    ['Doctors, clinics, hospitals', t => /^(hospital|clinic|doctors)$/.test(t.amenity)],
    ['Cafés and restaurants', t => /^(cafe|restaurant)$/.test(t.amenity)],
    ['Bus stops (within ½ mi)', t => t.highway === 'bus_stop'],
    ['Rail or tram stations', t => /^(station|halt|tram_stop)$/.test(t.railway)],
  ];
  const els = data.elements.map(e => ({ t: e.tags || {}, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon }));
  const rows = cats.map(([name, test]) => {
    const m = els.filter(e => test(e.t)).map(e => ({ ...e, d: distMi(lat, lon, e.lat, e.lon) })).sort((a, b) => a.d - b.d);
    const nearest = m[0];
    return `<tr><td>${name}</td><td class="num">${m.length}${m.length >= 100 ? '+' : ''}</td><td>${nearest ? esc(nearest.t.name || 'unnamed') + ' · ' + miles(nearest.d) : '<span class="weak">none within range</span>'}</td></tr>`;
  }).join('');
  c.done(head + `<table class="data"><thead><tr><th>Within 1 mile</th><th class="num">Count</th><th>Nearest</th></tr></thead><tbody>${rows}</tbody></table>` + s, wl ? badge(wl, wlvl) : '');
}

const AQI = v => v <= 50 ? ['Good', 1] : v <= 100 ? ['Moderate', 2] : v <= 150 ? ['Unhealthy for sensitive groups', 3] : v <= 200 ? ['Unhealthy', 4] : ['Very unhealthy', 5];
async function loadNow(lat, lon, c) {
  const [alerts, aq] = await Promise.all([
    getJSON(`${EP.nws}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { init: { headers: { Accept: 'application/geo+json' } } }).catch(e => ({ _err: e })),
    getJSON(EP.aq + '?' + qs({ latitude: lat, longitude: lon, current: 'us_aqi,pm2_5,ozone', timezone: 'auto' })).catch(e => ({ _err: e })),
  ]);
  let html = '';
  if (alerts._err) html += `<p class="weak">Weather alerts unavailable (${esc(alerts._err.message)}).</p>`;
  else if (!alerts.features?.length) html += '<p class="lede">No active National Weather Service alerts here.</p>';
  else html += '<h3>Active weather alerts</h3><ul class="list">' + alerts.features.slice(0, 6).map(f => `<li><strong>${esc(f.properties.event)}</strong>${f.properties.ends || f.properties.expires ? ' until ' + esc(new Date(f.properties.ends || f.properties.expires).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })) : ''}<br><span class="weak">${esc(f.properties.headline || '')}</span></li>`).join('') + '</ul>';
  if (!aq._err && aq.current?.us_aqi != null) {
    const [lab, lv] = AQI(aq.current.us_aqi);
    html += `<p>Air quality right now: <span class="badge lvl${lv}">AQI ${Math.round(aq.current.us_aqi)} · ${lab}</span> <span class="weak">(PM2.5 ${aq.current.pm2_5 ?? '—'} µg/m³; modeled estimate)</span></p>`;
  }
  c.done(html + src('<a href="https://www.weather.gov/" target="_blank" rel="noopener">National Weather Service</a> active alerts; <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noopener">Open-Meteo</a> air quality model (CAMS). Official readings: <a href="https://www.airnow.gov/" target="_blank" rel="noopener">AirNow</a>.'));
}

async function loadGround(lat, lon, c) {
  const [el, eq, big] = await Promise.all([
    getJSON(EP.epqs + '?' + qs({ x: lon, y: lat, units: 'Feet', wkid: 4326 })).catch(() => null),
    getJSON(EP.usgs.replace('/query', '/count') + '?' + qs({ format: 'geojson', latitude: lat, longitude: lon, maxradiuskm: 100, minmagnitude: 4, starttime: '1976-01-01' })).catch(() => null),
    getJSON(EP.usgs + '?' + qs({ format: 'geojson', latitude: lat, longitude: lon, maxradiuskm: 100, minmagnitude: 4, starttime: '1976-01-01', orderby: 'magnitude', limit: 1 })).catch(() => null),
  ]);
  const ft = el && el.value != null && el.value > -1000 ? +el.value : null;
  const top = big?.features?.[0]?.properties;
  const n = eq?.count;
  c.done(`<div class="kv"><div><b>${ft == null ? '—' : fmtInt(ft) + ' ft'}</b><span>Ground elevation above sea level</span></div>
      <div><b>${n == null ? '—' : fmtInt(n)}</b><span>Magnitude 4+ earthquakes within 100 km since 1976</span></div>
      <div><b>${top ? 'M' + top.mag.toFixed(1) : '—'}</b><span>Largest of those${top ? ' (' + new Date(top.time).getFullYear() + ')' : ''}</span></div></div>
    ${ft != null && ft < 10 ? '<p>This ground sits less than 10 ft above sea level, so storm surge and sea level rise matter. See <a href="https://coast.noaa.gov/slr/" target="_blank" rel="noopener">NOAA\'s Sea Level Rise Viewer</a>.</p>' : ''}`
    + src('USGS <a href="https://apps.nationalmap.gov/epqs/" target="_blank" rel="noopener">Elevation Point Query Service</a> (3DEP); USGS <a href="https://earthquake.usgs.gov/earthquakes/search/" target="_blank" rel="noopener">earthquake catalog</a>.'));
}

// ---------- buttons & startup ----------
$('#share').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); $('#share').textContent = 'Link copied'; }
  catch { prompt('Copy this link:', location.href); }
  setTimeout(() => $('#share').textContent = 'Copy link', 2000);
});
$('#print').addEventListener('click', () => window.print());

const p = new URLSearchParams(location.search);
if (p.get('lat') && p.get('lon') && !isNaN(+p.get('lat')) && !isNaN(+p.get('lon'))) {
  report({ lat: +p.get('lat'), lon: +p.get('lon'), label: p.get('label') || 'Selected point', fromClick: !p.get('label') });
} else if (p.get('q')) {
  input.value = p.get('q'); runSearch(p.get('q'));
}
})();
