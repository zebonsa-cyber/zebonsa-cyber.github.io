/* Address Report — map-first redesign.
   The map is the stage; each report section sets a "view" (lens) on it as you scroll.
   Every request goes from the visitor's browser straight to a public source. No keys, no backend. */
import { VectorTile } from 'https://esm.sh/@mapbox/vector-tile@2.0.3';
import Pbf from 'https://esm.sh/pbf@4.0.1';

const maplibregl = window.maplibregl;

// ---------------- endpoints ----------------
const EP = {
  nominatim: 'https://nominatim.openstreetmap.org',
  ofm: 'https://tiles.openfreemap.org/planet',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  aerial: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
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
    conus: ['https://geo.dot.gov/server/rest/services/hosted/NTAD_Noise_2020_CONUS_Aviation_Road_Rail/MapServer', [-125, 24, -66.5, 49.5]],
    alaska: ['https://geo.dot.gov/server/rest/services/hosted/NTAD_Noise_2020_Alaska_Aviation_Road_Rail/MapServer', [-180, 51, -129, 71.5]],
    hawaii: ['https://geo.dot.gov/server/rest/services/hosted/NTAD_Noise_2020_Hawaii_Aviation_Road/MapServer', [-161, 18.5, -154.5, 22.5]],
  },
  epqs: 'https://epqs.nationalmap.gov/v1/json',
  nws: 'https://api.weather.gov',
  aq: 'https://air-quality-api.open-meteo.com/v1/air-quality',
  usgs: 'https://earthquake.usgs.gov/fdsnws/event/1',
};

// ---------------- palette (mirrors style.css) ----------------
const C = { ink: '#17211d', graphite: '#56615b', rule: '#cfd5cc', contour: '#9c6b3e', water: '#2e6ca4', flag: '#ee2f79', film: '#f1f3ef',
  lvl: ['#a9b0aa', '#2f7354', '#8fa64b', '#d4a12e', '#d0612b', '#a42a3c'] };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------- small helpers ----------------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const qs = o => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
const TOPCODES = new Set([2000001, 3501, 250001, 4001]);
const money = n => (n == null || isNaN(n) || n < 0) ? '—' : TOPCODES.has(Math.round(n)) ? '$' + (Math.round(n) - 1).toLocaleString('en-US') + '+' : '$' + Math.round(n).toLocaleString('en-US');
const int = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US');
const pct = n => (n == null || isNaN(n)) ? '—' : (Math.round(n * 10) / 10) + '%';
const mi = d => d < 0.1 ? 'under 0.1 mi' : (Math.round(d * 10) / 10) + ' mi';
const walkMin = d => Math.max(1, Math.round(d * 1.25 / 3 * 60)); // straight line × 1.25 detour, at 3 mph
const titleCase = s => String(s || '').toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(Llc|Inc|Usa|Us|Epa|Dod|Afb|Ii|Iii)\b/g, m => m.toUpperCase());
const listJoin = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
function dist(lat1, lon1, lat2, lon2) {
  const R = 3958.8, t = Math.PI / 180, dLat = (lat2 - lat1) * t, dLon = (lon2 - lon1) * t;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * t) * Math.cos(lat2 * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSONOnce(url, { timeout = 20000, init } = {}) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
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
async function getJSON(url, opts = {}) {
  try { return await getJSONOnce(url, opts); }
  catch (e) {
    if (opts.noRetry || !/too long|reached|HTTP 5/.test(e.message)) throw e;
    await sleep(800);
    return getJSONOnce(url, opts);
  }
}
const arcPoint = (base, lon, lat, extra = {}) => base + '/query?' + qs({ geometry: lon + ',' + lat, geometryType: 'esriGeometryPoint', inSR: 4326,
  spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'false', outFields: '*', f: 'json', ...extra });
async function arcFirst(base, lon, lat, extra) { const j = await getJSON(arcPoint(base, lon, lat, extra)); return j.features?.[0] || null; }
async function arcNear(base, lon, lat, miles, extra = {}) {
  const j = await getJSON(arcPoint(base, lon, lat, { distance: miles, units: 'esriSRUnit_StatuteMile', returnGeometry: 'true', outSR: 4326, ...extra }));
  return (j.features || []).map(f => ({ ...f.attributes, _lat: f.geometry?.y, _lon: f.geometry?.x }));
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k).catch(() => null); } }));
  return out;
}

// geometry helpers
function circle(lat, lon, miles, steps = 96) {
  const pts = [], dLat = miles / 69.0, dLon = miles / (69.17 * Math.cos(lat * Math.PI / 180));
  for (let i = 0; i <= steps; i++) { const a = i / steps * 2 * Math.PI; pts.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]); }
  return pts;
}
function boundsOf(coords) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const [x, y] of coords) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [[w, s], [e, n]];
}
const fc = features => ({ type: 'FeatureCollection', features });
const ptF = (lon, lat, props = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props });
function arcRingsToGeo(geom) { return geom?.rings ? { type: 'Polygon', coordinates: geom.rings } : null; }

// ---------------- vector tiles (buildings, places) ----------------
let tileTemplate = null;
const tileCache = new Map();
async function vtile(z, x, y) {
  if (!tileTemplate) tileTemplate = (await getJSON(EP.ofm)).tiles[0];
  const key = z + '/' + x + '/' + y;
  if (!tileCache.has(key)) tileCache.set(key, (async () => {
    const r = await fetch(tileTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    if (!r.ok) throw new Error('map tile HTTP ' + r.status);
    return new VectorTile(new Pbf(await r.arrayBuffer()));
  })());
  return tileCache.get(key);
}
function tileXY(lat, lon, z) {
  const n = 2 ** z, r = lat * Math.PI / 180;
  return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n];
}
// Read features of one layer from the 3×3 block of z14 tiles around a point, as lon/lat geometry.
async function nearbyFeatures(lat, lon, layerName) {
  const z = 14, n = 2 ** z, [fx, fy] = tileXY(lat, lon, z), tx = Math.floor(fx), ty = Math.floor(fy);
  const out = [];
  const jobs = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) jobs.push([tx + dx, ty + dy]);
  const tiles = await Promise.all(jobs.map(([x, y]) => vtile(z, x, y).then(t => [x, y, t]).catch(() => null)));
  for (const t of tiles) {
    if (!t) continue;
    const [x, y, vt] = t, layer = vt.layers[layerName];
    if (!layer) continue;
    const ext = layer.extent;
    const toLL = p => { const X = (x + p.x / ext) / n, Y = (y + p.y / ext) / n;
      return [X * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))) * 180 / Math.PI]; };
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      out.push({ type: f.type, props: f.properties, rings: f.loadGeometry().map(r => r.map(toLL)) });
    }
  }
  return out;
}

// ---------------- map ----------------
const roadW = k => ['interpolate', ['exponential', 1.6], ['zoom'],
  11, ['*', k, ['match', ['get', 'class'], ['motorway', 'trunk'], 2.4, ['primary', 'secondary'], 1.5, 0.6]],
  18, ['*', k, ['match', ['get', 'class'], ['motorway', 'trunk'], 30, ['primary', 'secondary'], 24, ['tertiary', 'minor'], 17, 9]]];
const ROADS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'];
const noiseSources = Object.fromEntries(Object.entries(EP.noise).map(([k, [u, b]]) => ['noise_' + k,
  { type: 'raster', tiles: [u + '/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 12, bounds: b, attribution: 'Noise: US DOT BTS' }]));
const geo = () => ({ type: 'geojson', data: fc([]) });

const style = {
  version: 8,
  glyphs: EP.glyphs,
  sources: {
    omt: { type: 'vector', url: EP.ofm, attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>' },
    aerial: { type: 'raster', tiles: [EP.aerial], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
    nfhl: { type: 'raster', tileSize: 256, minzoom: 11, attribution: 'Flood zones: FEMA NFHL',
      tiles: [EP.nfhl + '/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&layers=show:28&f=image'] },
    ...noiseSources,
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#e4e8e1' } },
    { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'farmland', 'wetland', 'scrub']]], paint: { 'fill-color': '#d6dfcf', 'fill-opacity': 0.75 } },
    { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': '#cddbc3' } },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#b6ccdb' } },
    { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': '#9dbcd2', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 2.5] } },
    { id: 'road-case', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ROADS]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#c6cdc2', 'line-width': roadW(1) } },
    { id: 'road', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ROADS]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fbfcfa', 'line-width': roadW(0.82) } },
    { id: 'path', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 15, filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]], paint: { 'line-color': '#b7bfb3', 'line-width': 1, 'line-dasharray': [2, 2] } },
    { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]], paint: { 'line-color': '#8e968f', 'line-width': 1.4, 'line-dasharray': [3, 2] } },
    { id: 'bldg', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': '#d2d7ce', 'fill-outline-color': '#bcc4b8' } },
    { id: 'bldg3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14, layout: { visibility: 'none' }, paint: {
      'fill-extrusion-color': '#dfe3db', 'fill-extrusion-opacity': 0.94,
      'fill-extrusion-height': ['case', ['>', ['coalesce', ['get', 'render_height'], 0], 0], ['get', 'render_height'], 7],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] } },
    { id: 'aerial', type: 'raster', source: 'aerial', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 150 } },
    { id: 'nfhl', type: 'raster', source: 'nfhl', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.62 } },
    ...Object.keys(noiseSources).map(id => ({ id, type: 'raster', source: id, layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.62, 'raster-resampling': 'nearest' } })),
  ],
};

const map = new maplibregl.Map({
  container: 'map', style, center: [-96.5, 38.5], zoom: 3.4, attributionControl: { compact: true },
  maxPitch: 70, cooperativeGestures: false, dragRotate: true,
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
map.scrollZoom.setWheelZoomRate(1 / 300);

const DYNAMIC = ['tract', 'rings', 'envrings', 'profile', 'pois', 'schools', 'env', 'subject', 'vertices', 'dims', 'housenums'];
const mapReady = new Promise(res => map.on('load', () => {
  for (const id of DYNAMIC) map.addSource(id, geo(id));
  const sym = (id, src, layout, paint, extra = {}) => map.addLayer({ id, type: 'symbol', source: src, layout: { 'text-font': ['Noto Sans Regular'], 'text-size': 12, ...layout }, paint: { 'text-color': C.ink, 'text-halo-color': '#fff', 'text-halo-width': 1.4, ...paint }, ...extra });
  map.addLayer({ id: 'tract-fill', type: 'fill', source: 'tract', layout: { visibility: 'none' }, paint: { 'fill-color': C.ink, 'fill-opacity': 0.06 } });
  map.addLayer({ id: 'tract-line', type: 'line', source: 'tract', layout: { visibility: 'none' }, paint: { 'line-color': C.ink, 'line-width': 2, 'line-dasharray': [4, 2] } });
  map.addLayer({ id: 'rings', type: 'line', source: 'rings', layout: { visibility: 'none' }, paint: { 'line-color': C.ink, 'line-width': 1.3, 'line-dasharray': [3, 2.5], 'line-opacity': 0.75 } });
  sym('ring-labels', 'rings', { 'symbol-placement': 'point', 'text-field': ['get', 'label'], 'text-size': 11.5, 'text-font': ['Noto Sans Bold'], visibility: 'none' }, {}, { filter: ['==', ['geometry-type'], 'Point'] });
  map.addLayer({ id: 'envrings', type: 'line', source: 'envrings', layout: { visibility: 'none' }, paint: { 'line-color': C.ink, 'line-width': 1.3, 'line-dasharray': [3, 2.5], 'line-opacity': 0.75 } });
  sym('envring-labels', 'envrings', { 'symbol-placement': 'point', 'text-field': ['get', 'label'], 'text-size': 11.5, 'text-font': ['Noto Sans Bold'], visibility: 'none' }, {}, { filter: ['==', ['geometry-type'], 'Point'] });
  map.addLayer({ id: 'profile', type: 'line', source: 'profile', layout: { visibility: 'none', 'line-cap': 'round' }, paint: { 'line-color': C.contour, 'line-width': 3.5 } });
  sym('profile-labels', 'profile', { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, -1.1], visibility: 'none' }, { 'text-color': C.contour }, { filter: ['==', ['geometry-type'], 'Point'] });
  for (const id of ['pois', 'schools', 'env']) {
    map.addLayer({ id, type: 'circle', source: id, layout: { visibility: 'none' }, paint: {
      'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, id === 'pois' ? 3.2 : 5, 17, id === 'pois' ? 6.5 : 9],
      'circle-stroke-color': '#fff', 'circle-stroke-width': 1.6 } });
    sym(id + '-labels', id, { 'text-field': ['get', 'label'], 'text-size': 11.5, 'text-anchor': 'left', 'text-offset': [0.9, 0], 'text-max-width': 12, 'text-optional': true, visibility: 'none' }, {}, { filter: ['has', 'label'] });
  }
  map.addLayer({ id: 'subject-fill', type: 'fill', source: 'subject', paint: { 'fill-color': C.flag, 'fill-opacity': 0.16 } });
  map.addLayer({ id: 'subject-3d', type: 'fill-extrusion', source: 'subject', layout: { visibility: 'none' }, paint: { 'fill-extrusion-color': C.flag, 'fill-extrusion-opacity': 0.95, 'fill-extrusion-height': ['get', 'h'] } });
  map.addLayer({ id: 'subject-line', type: 'line', source: 'subject', layout: { 'line-join': 'round' }, paint: { 'line-color': C.flag, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.5, 19, 3.2] } });
  map.addLayer({ id: 'vertices', type: 'circle', source: 'vertices', minzoom: 17, paint: { 'circle-color': '#fff', 'circle-radius': 3, 'circle-stroke-color': C.flag, 'circle-stroke-width': 2 } });
  sym('dims', 'dims', { 'text-field': ['get', 't'], 'text-rotate': ['get', 'rot'], 'text-rotation-alignment': 'map', 'text-size': ['interpolate', ['linear'], ['zoom'], 17, 10, 20, 14], 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true, 'text-ignore-placement': true }, { 'text-color': '#fff', 'text-halo-color': 'rgba(23,33,29,.85)', 'text-halo-width': 1.6 }, { minzoom: 17 });
  sym('housenums', 'housenums', { 'text-field': ['get', 'n'], 'text-size': 10.5 }, { 'text-color': C.graphite }, { minzoom: 17 });
  sym('road-labels', 'omt', { 'text-field': ['get', 'name'], 'symbol-placement': 'line', 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 13], 'text-letter-spacing': 0.02 }, { 'text-color': C.graphite }, { 'source-layer': 'transportation_name', minzoom: 13 });
  sym('water-labels', 'omt', { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'], 'text-size': 12.5 }, { 'text-color': C.water }, { 'source-layer': 'water_name' });
  sym('place-labels', 'omt', { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': ['match', ['get', 'class'], 'city', 15, 'town', 13.5, 11.5], 'text-transform': 'none', 'text-max-width': 8 },
    { 'text-color': '#3a4540' }, { 'source-layer': 'place', filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village', 'suburb', 'neighbourhood', 'hamlet']]] });
  res();
}));

// ---------------- lenses ----------------
const LENSES = [
  ['context', '3D view'], ['site', 'Aerial'], ['flood', 'Flooding'], ['hazard', 'Hazards'], ['noise', 'Noise'],
  ['errands', 'Errands'], ['schools', 'Schools'], ['env', 'Pollution'], ['hood', 'Neighborhood'], ['ground', 'Elevation'],
];
const LAYERS_BY_LENS = {
  context: ['bldg3d', 'subject-3d'],
  site: ['aerial', 'vertices', 'dims'],
  flood: ['nfhl'],
  hazard: ['tract-fill', 'tract-line'],
  noise: Object.keys(noiseSources),
  errands: ['rings', 'ring-labels', 'pois', 'pois-labels'],
  schools: ['schools', 'schools-labels'],
  env: ['envrings', 'envring-labels', 'env', 'env-labels'],
  hood: ['tract-fill', 'tract-line'],
  ground: ['profile', 'profile-labels', 'aerial'],
};
const ALL_LENS_LAYERS = [...new Set(Object.values(LAYERS_BY_LENS).flat())];
let ctx = null, currentLens = null, lensLock = 0;

function setLayersFor(lens) {
  const on = new Set(LAYERS_BY_LENS[lens] || []);
  for (const id of ALL_LENS_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on.has(id) ? 'visible' : 'none');
  const aerial = on.has('aerial');
  $('#stage').classList.toggle('is-aerial', aerial);
  map.setPaintProperty('road-labels', 'text-color', aerial ? '#fff' : C.graphite);
  map.setPaintProperty('road-labels', 'text-halo-color', aerial ? 'rgba(23,33,29,.8)' : '#fff');
  map.setPaintProperty('place-labels', 'text-color', aerial ? '#fff' : '#3a4540');
  map.setPaintProperty('place-labels', 'text-halo-color', aerial ? 'rgba(23,33,29,.8)' : '#fff');
  map.setPaintProperty('housenums', 'text-color', aerial ? '#fff' : C.graphite);
  map.setPaintProperty('housenums', 'text-halo-color', aerial ? 'rgba(23,33,29,.8)' : '#fff');
  map.setPaintProperty('subject-fill', 'fill-opacity', aerial ? 0.08 : 0.16);
  // the 2D outline would hover over the 3D block
  map.setLayoutProperty('subject-line', 'visibility', lens === 'context' ? 'none' : 'visible');
  map.setLayoutProperty('subject-fill', 'visibility', lens === 'context' ? 'none' : 'visible');
}
function cameraFor(lens) {
  const { lat, lon } = ctx, c = [lon, lat];
  const b = ctx.bounds[lens];
  if (b) return { bounds: b };
  switch (lens) {
    case 'context': return { center: c, zoom: 16.6, pitch: 60, bearing: -28 };
    case 'site': return { center: ctx.footCenter || c, zoom: ctx.footZoom || 19, pitch: 0, bearing: 0 };
    case 'flood': return { center: c, zoom: 15.6, pitch: 0, bearing: 0 };
    case 'noise': return { center: c, zoom: 15, pitch: 0, bearing: 0 };
    case 'errands': return { bounds: boundsOf(circle(lat, lon, 0.8)) };
    default: return { center: c, zoom: 15, pitch: 0, bearing: 0 };
  }
}
function moveCamera(cam, first) {
  const dur = reduceMotion ? 0 : first ? 2800 : 1000;
  if (cam.bounds) {
    const opts = { padding: innerWidth < 860 ? 30 : 60, pitch: 0, bearing: 0, duration: dur, maxZoom: 17.5 };
    map.fitBounds(cam.bounds, opts);
  } else if (first) {
    map.flyTo({ ...cam, duration: dur, curve: 1.6, essential: false });
  } else {
    map.easeTo({ ...cam, duration: dur });
  }
}
function setLens(lens, { first = false, fromUser = false } = {}) {
  if (!ctx || (lens === currentLens && !first)) return;
  currentLens = lens;
  setLayersFor(lens);
  moveCamera(cameraFor(lens), first);
  renderKey(lens);
  document.querySelectorAll('#lenses button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lens === lens)));
  document.querySelectorAll('.sec').forEach(s => s.classList.toggle('is-active', s.dataset.lens === lens));
  if (fromUser) lensLock = Date.now() + 1200;
}
function buildLensBar() {
  const nav = $('#lenses');
  nav.innerHTML = LENSES.map(([k, label]) => `<button type="button" data-lens="${k}" aria-pressed="false">${label}</button>`).join('');
  nav.hidden = false;
  nav.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    setLens(b.dataset.lens, { fromUser: true });
    const sec = document.querySelector(`.sec[data-lens="${b.dataset.lens}"]`) || (b.dataset.lens === 'context' ? $('.title-block') : null);
    sec?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }));
}
const NOISE_CLASSES = [
  { label: '45–50 dB', lo: 45, hi: 50, rgb: [255, 193, 7], lvl: 1, say: 'about as loud as a quiet suburban street' },
  { label: '50–55 dB', lo: 50, hi: 55, rgb: [255, 128, 0], lvl: 2, say: 'noticeable outdoors, like a quiet conversation' },
  { label: '55–60 dB', lo: 55, hi: 60, rgb: [255, 0, 0], lvl: 3, say: 'around the 55 dB guideline the EPA set for outdoor areas' },
  { label: '60–70 dB', lo: 60, hi: 70, rgb: [255, 51, 153], lvl: 4, say: 'steady traffic noise that can disturb sleep with windows open' },
  { label: '70–80 dB', lo: 70, hi: 80, rgb: [163, 0, 204], lvl: 5, say: 'very loud, typical right beside a highway or busy rail line' },
  { label: '80–90 dB', lo: 80, hi: 90, rgb: [82, 0, 204], lvl: 5, say: 'extremely loud, typical beside a major highway or under a flight path' },
  { label: 'over 90 dB', lo: 90, hi: 95, rgb: [0, 0, 255], lvl: 5, say: 'extremely loud, typical at an airport boundary' },
];
const POI_CATS = {
  grocery: { label: 'Groceries', one: 'Grocery store', color: '#2f7a4f' },
  pharmacy: { label: 'Pharmacies', one: 'Pharmacy', color: '#7b4bc2' },
  park: { label: 'Parks and playgrounds', one: 'Park or playground', color: '#86a63f' },
  health: { label: 'Doctors and clinics', one: 'Doctor or clinic', color: '#c4483b' },
  food: { label: 'Cafés and restaurants', one: 'Café or restaurant', color: '#c98a1d' },
  transit: { label: 'Bus and rail stops', one: 'Transit stop', color: '#2d5f9e' },
  library: { label: 'Libraries', one: 'Library', color: '#8a5a3a' },
};
const ENV_KIND = { sf: ['Superfund site', C.lvl[5]], tri: ['Reports toxic releases', C.lvl[4]], bf: ['Brownfield', C.lvl[3]] };
function renderKey(lens) {
  const k = $('#key');
  const row = (sw, t) => `<div class="row">${sw}<span>${t}</span></div>`;
  const prop = row(`<i style="background:${C.flag}"></i>`, 'This property');
  const html = {
    context: `<b>The block in 3D</b>${prop}${row('<i style="background:#dfe3db;border:1px solid #bcc4b8"></i>', 'Other buildings (heights estimated where unknown)')}`,
    site: `<b>Aerial photo</b>${row(`<i class="line"></i>`, 'Building outline with measured sides')}<div class="row"><span>Imagery dates vary; it may not show recent changes.</span></div>`,
    flood: `<b>FEMA flood zones</b>${row('<i style="background:#6aa6d8"></i>', 'Zones are labeled on the map')}<div class="row"><span>A and V: high risk. Shaded X: moderate. Zoom in for labels.</span></div>`,
    hazard: `<b>Hazard ratings cover this tract</b>${row('<i style="background:transparent;border:2px dashed #17211d"></i>', 'Census tract boundary')}`,
    noise: `<b>Transportation noise, 24-hour average</b>` + NOISE_CLASSES.map(c => row(`<i style="background:rgb(${c.rgb})"></i>`, c.label)).join(''),
    errands: `<b>Within walking distance</b>${row('<i class="ring"></i>', '5, 10 and 15 minute walks')}` + Object.values(POI_CATS).map(c => row(`<i class="dot" style="background:${c.color}"></i>`, c.label)).join(''),
    schools: `<b>Nearest public schools</b>${row(`<i class="dot" style="background:${C.ink}"></i>`, 'Public school')}${prop}`,
    env: `<b>EPA-tracked sites</b>` + Object.values(ENV_KIND).map(([t, c]) => row(`<i class="dot" style="background:${c}"></i>`, t)).join('') + row('<i class="ring"></i>', '1 and 3 mile radius'),
    hood: `<b>The Census tract</b>${row('<i style="background:transparent;border:2px dashed #17211d"></i>', 'Area the neighborhood figures describe')}`,
    ground: `<b>Elevation line</b>${row(`<i style="background:${C.contour}"></i>`, 'Where the ground profile was measured, west to east')}`,
  }[lens] || '';
  k.innerHTML = html;
}

// scroll-driven lenses
const observer = new IntersectionObserver(entries => {
  if (Date.now() < lensLock) return;
  const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
  if (vis[0]) setLens(vis[0].target.dataset.lens);
}, { rootMargin: innerWidth < 860 ? '-50% 0px -40% 0px' : '-30% 0px -60% 0px' });

// ---------------- geocoding & search ----------------
let lastNom = 0;
async function nominatim(path) {
  const wait = Math.max(0, lastNom + 1100 - Date.now()); if (wait) await sleep(wait);
  lastNom = Date.now();
  return getJSON(EP.nominatim + path, { timeout: 15000, noRetry: true });
}
function tidyLabel(r) {
  const a = r.address || {};
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const city = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || '';
  const st = (a['ISO3166-2-lvl4'] || '').replace('US-', '') || a.state || '';
  const name = r.name && !street.includes(r.name) && r.name !== a.road ? r.name : '';
  const parts = [name, street, city, [st, a.postcode].filter(Boolean).join(' ')].filter(Boolean);
  return { line1: street || name || city, line2: [city, [st, a.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    label: parts.filter((p, i) => parts.indexOf(p) === i).join(', ') || r.display_name };
}
async function geocode(q) {
  const res = await nominatim('/search?' + qs({ q, format: 'jsonv2', addressdetails: 1, countrycodes: 'us', limit: 5 }));
  return res.map(r => ({ lat: +r.lat, lon: +r.lon, ...tidyLabel(r) }));
}
async function reverse(lat, lon) {
  try { const r = await nominatim('/reverse?' + qs({ lat, lon, format: 'jsonv2', addressdetails: 1, zoom: 18 })); return r && !r.error ? tidyLabel(r) : null; }
  catch { return null; }
}
const input = $('#q'), msg = $('#search-msg'), choices = $('#choices');
$('#search').addEventListener('submit', e => { e.preventDefault(); const q = input.value.trim(); if (q) runSearch(q); });
async function runSearch(q) {
  choices.hidden = true; msg.textContent = 'Finding the address…'; $('#go').disabled = true;
  try {
    const res = await geocode(q);
    if (!res.length) { msg.textContent = 'No US match. Add the city and state, or click the spot on the map.'; return; }
    const seen = new Set(), uniq = res.filter(r => !seen.has(r.label) && seen.add(r.label));
    const num = (q.match(/^\s*(\d+[A-Za-z]?)\b/) || [])[1];
    const hit = num && (uniq.find(r => r.label.startsWith(num + ' ')) || uniq.find(r => new RegExp('\\b' + num + '\\b').test(r.label)));
    if (hit || uniq.length === 1) { msg.textContent = ''; return report(hit || uniq[0]); }
    msg.textContent = 'Several places match. Pick one:';
    choices.innerHTML = uniq.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.label)}</button></li>`).join('');
    choices.hidden = false;
    choices.querySelectorAll('button').forEach(b => b.onclick = () => { choices.hidden = true; msg.textContent = ''; report(uniq[+b.dataset.i]); });
  } catch (err) { msg.textContent = 'Address lookup failed: ' + err.message + '. Try again, or click the spot on the map.'; }
  finally { $('#go').disabled = false; }
}
let clickPopup = null;
map.on('click', e => {
  if (map.queryRenderedFeatures(e.point, { layers: ['pois', 'schools', 'env'].filter(l => map.getLayer(l)) }).length) return;
  const lat = +e.lngLat.lat.toFixed(6), lon = +e.lngLat.lng.toFixed(6);
  clickPopup?.remove();
  const el = document.createElement('div');
  el.innerHTML = '<button type="button" class="popbtn">Get a report for this spot</button>';
  el.querySelector('button').onclick = () => { clickPopup.remove(); report({ lat, lon, line1: 'Selected point', line2: '', label: '', fromClick: true }); };
  clickPopup = new maplibregl.Popup({ closeButton: true, offset: 6, className: 'clickpop' }).setLngLat([lon, lat]).setDOMContent(el).addTo(map);
});
for (const l of ['pois', 'schools', 'env']) {
  map.on('mouseenter', l, () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', l, () => map.getCanvas().style.cursor = '');
  map.on('click', l, e => {
    const p = e.features[0].properties;
    new maplibregl.Popup({ offset: 8, className: 'clickpop' }).setLngLat(e.lngLat).setHTML(`<b>${esc(p.name || 'Unnamed')}</b><br>${esc(p.kind || '')}${p.d ? ', ' + esc(p.d) : ''}`).addTo(map);
  });
}

// ---------------- report ----------------
const SECTIONS = [
  { key: 'building', lens: 'site', title: 'The building', onmap: 'Aerial photo', load: loadBuilding },
  { key: 'flood', lens: 'flood', title: 'Flooding', onmap: 'Flood zones', load: loadFlood },
  { key: 'hazard', lens: 'hazard', title: 'Natural hazards', onmap: 'Tract boundary', load: loadHazard },
  { key: 'noise', lens: 'noise', title: 'Noise', onmap: 'Noise map', load: loadNoise },
  { key: 'errands', lens: 'errands', title: 'Daily errands', onmap: 'Walking distance', load: loadErrands },
  { key: 'schools', lens: 'schools', title: 'Schools', onmap: 'Nearest schools', load: loadSchools },
  { key: 'env', lens: 'env', title: 'Pollution sites', onmap: 'EPA sites', load: loadEnv },
  { key: 'hood', lens: 'hood', title: 'The neighborhood', onmap: 'Tract boundary', load: loadHood },
  { key: 'ground', lens: 'ground', title: 'Lay of the land', onmap: 'Elevation line', load: loadGround },
  { key: 'today', lens: 'context', title: 'Today', onmap: '3D view', load: loadToday },
];
const SUMMARY = [['flood', 'Flood zone'], ['hazard', 'Hazard risk'], ['noise', 'Noise'], ['errands', 'Walkability'], ['net', 'Home broadband'], ['env', 'Pollution sites']];
let pin = null, runId = 0;

function setSummary(key, value, lvl) {
  const dd = document.querySelector(`#summary [data-k="${key}"] dd`);
  if (!dd) return;
  const segs = [1, 2, 3, 4, 5].map(i => `<i style="background:${lvl && i <= lvl ? C.lvl[lvl] : ''}"></i>`).join('');
  const target = key === 'net' ? 'hood' : key;
  dd.innerHTML = `<button type="button" data-goto="${target}">${lvl ? `<span class="meter" aria-hidden="true">${segs}</span>` : ''}<span>${esc(value)}</span></button>`;
  dd.querySelector('button').onclick = () => document.getElementById('sec-' + target)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}
function sectionEl({ key, lens, title, onmap }) {
  const el = document.createElement('section');
  el.className = 'sec loading'; el.id = 'sec-' + key; el.dataset.lens = lens;
  el.innerHTML = `<div class="sec-head"><h2>${esc(title)}</h2><button type="button" class="onmap" title="Show on the map">${esc(onmap)}</button></div><div class="body"><p class="verdict">Loading<span class="pulse"></span></p></div>`;
  el.querySelector('.onmap').onclick = () => setLens(lens, { fromUser: true });
  return el;
}
const src = html => `<p class="src">Source: ${html}</p>`;

async function report(place) {
  const id = ++runId;
  await mapReady;
  const { lat, lon } = place;
  ctx = { id, lat, lon, bounds: {}, place };
  ctx.elev = getJSON(EP.epqs + '?' + qs({ x: lon, y: lat, units: 'Feet', wkid: 4326 })).then(j => (j && j.value > -1000 ? +j.value : null)).catch(() => null);
  let bfeResolve; ctx.bfe = new Promise(r => bfeResolve = r); ctx.setBfe = bfeResolve;
  currentLens = null;

  $('#welcome').hidden = true; $('#report').hidden = false;
  $('#r-addr').textContent = place.line1 || place.label;
  $('#r-place').textContent = place.line2 || '';
  if (!place.fromClick) input.value = place.label;
  $('#summary').innerHTML = SUMMARY.map(([k, t]) => `<div data-k="${k}"><dt>${t}</dt><dd><span class="pulse"></span></dd></div>`).join('');
  const holder = $('#sections'); holder.innerHTML = '';
  observer.disconnect();
  $('.title-block').dataset.lens = 'context';
  observer.observe($('.title-block'));
  for (const s of SECTIONS) { const el = sectionEl(s); holder.appendChild(el); observer.observe(el); }
  window.scrollTo({ top: 0 });

  for (const id of DYNAMIC) map.getSource(id).setData(fc([]));
  pin?.remove();
  const pe = document.createElement('div'); pe.className = 'pin'; pe.setAttribute('aria-hidden', 'true');
  pin = new maplibregl.Marker({ element: pe }).setLngLat([lon, lat]).addTo(map);
  buildLensBar();
  setLens('context', { first: true });

  const url = new URL(location.href); url.search = '';
  url.searchParams.set('lat', lat.toFixed(6)); url.searchParams.set('lon', lon.toFixed(6));
  if (place.label) url.searchParams.set('label', place.label);
  history.replaceState(null, '', url);
  document.title = (place.label || 'Selected point') + ' | Address Report';

  if (place.fromClick) reverse(lat, lon).then(r => { if (!r || id !== runId) return;
    place.label = r.label; $('#r-addr').textContent = r.line1; $('#r-place').textContent = r.line2; input.value = r.label;
    url.searchParams.set('label', r.label); history.replaceState(null, '', url); document.title = r.label + ' | Address Report'; });

  loadPlace(lat, lon, id);
  for (const s of SECTIONS) {
    const el = document.getElementById('sec-' + s.key);
    const live = fn => (...a) => { if (id === runId) fn(...a); };
    const out = {
      done: live((html) => { el.classList.remove('loading'); el.querySelector('.body').innerHTML = html; }),
      fail: live((err) => { el.classList.remove('loading'); el.querySelector('.body').innerHTML = `<p class="verdict err">This section didn't load: ${esc(err.message || err)}.</p><p class="note">The source may be busy. Reload the page to try again.</p>`; }),
      sum: live(setSummary),
      live: () => id === runId,
    };
    s.load(lat, lon, out).catch(err => out.fail(err));
  }
}

// ---------------- sections ----------------
async function loadPlace(lat, lon, id) {
  const q = (layer) => arcFirst(EP.tiger + '/' + layer, lon, lat, { outFields: 'NAME,BASENAME' }).then(f => f?.attributes).catch(() => null);
  const [state, county, place, cdp] = await Promise.all([q(80), q(82), q(28), q(30)]);
  if (id !== runId || !state) return;
  const town = place ? place.NAME.replace(/ (city|town|village|borough|municipality|CDP)$/i, '') : cdp ? cdp.NAME.replace(/ CDP$/, '') : null;
  const line = [town, county?.NAME, state.NAME].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
  if (ctx.place.fromClick || !$('#r-place').textContent) $('#r-place').textContent = line;
  else $('#r-place').textContent = line + (ctx.place.line2?.match(/\d{5}/) ? ' ' + ctx.place.line2.match(/\d{5}/)[0] : '');
}

// The building: footprint from map tiles, measured like a survey plat
function localXY(lat0, lon0) {
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
  return { to: ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky], from: ([x, y]) => [lon0 + x / kx, lat0 + y / ky] };
}
function ringArea(pts) { let a = 0; for (let i = 0; i < pts.length - 1; i++) a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]; return a / 2; }
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function simplify(pts, tol) { // Douglas–Peucker on a closed ring (local metres)
  if (pts.length < 4) return pts;
  const dp = (a, b) => {
    let maxD = 0, idx = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b], L = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / L; if (d > maxD) { maxD = d; idx = i; } }
    return maxD > tol ? [...dp(a, idx).slice(0, -1), ...dp(idx, b)] : [pts[a], pts[b]];
  };
  const far = pts.reduce((m, p, i) => Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) > Math.hypot(pts[m][0] - pts[0][0], pts[m][1] - pts[0][1]) ? i : m, 0);
  return [...dp(0, far).slice(0, -1), ...dp(far, pts.length - 1)];
}
async function loadBuilding(lat, lon, c) {
  const [blds, nums, elev] = await Promise.all([nearbyFeatures(lat, lon, 'building'), nearbyFeatures(lat, lon, 'housenumber').catch(() => []), ctx.elev]);
  const P = localXY(lat, lon);
  let best = null;
  for (const b of blds) for (const ring of b.rings) {
    if (ring.length < 4) continue;
    const loc = ring.map(P.to), area = Math.abs(ringArea(loc));
    if (area < 12) continue;
    const contains = inRing([0, 0], loc);
    const cen = loc.reduce((s, p) => [s[0] + p[0] / loc.length, s[1] + p[1] / loc.length], [0, 0]);
    const d = contains ? 0 : Math.hypot(cen[0], cen[1]);
    if (d > 35) continue;
    const score = contains ? area : 1e9 + d; // smallest containing ring, else nearest
    if (!best || score < best.score) best = { ring, loc, area, score, props: b.props, contains };
  }
  // nearby house numbers as plat-style labels
  const nf = nums.filter(n => n.type === 1).map(n => ({ n: n.props.housenumber, ll: n.rings[0][0] })).filter(n => dist(lat, lon, n.ll[1], n.ll[0]) < 0.1);
  map.getSource('housenums').setData(fc(nf.map(n => ptF(n.ll[0], n.ll[1], { n: n.n }))));
  const ft = elev == null ? null : Math.round(elev);
  if (!best) {
    c.done(`<p class="verdict">No building outline is mapped at this spot, so there's nothing to measure.</p>
      <p class="note">That's common for new construction, rural lots and some suburbs where OpenStreetMap hasn't traced buildings yet. The aerial photo still shows the site.</p>
      <div class="facts"><div><b>${ft == null ? '—' : int(ft) + ' ft'}</b><span>Ground elevation</span></div></div>`
      + src('Building outlines from OpenStreetMap via OpenMapTiles. Elevation from USGS 3DEP.'));
    return;
  }
  const h = best.props.render_height > 0 ? best.props.render_height : null;
  const height = h || 9;
  const geom = { type: 'Polygon', coordinates: [best.ring] };
  map.getSource('subject').setData(fc([{ type: 'Feature', geometry: geom, properties: { h: height } }]));
  // edges and labels
  const s = simplify(best.loc, 0.7);
  const verts = s.slice(0, -1);
  map.getSource('vertices').setData(fc(verts.map(p => ptF(...P.from(p)))));
  const cen = verts.reduce((a, p) => [a[0] + p[0] / verts.length, a[1] + p[1] / verts.length], [0, 0]);
  const dims = [], sides = [];
  for (let i = 0; i < s.length - 1; i++) {
    const [x1, y1] = s[i], [x2, y2] = s[i + 1], len = Math.hypot(x2 - x1, y2 - y1);
    sides.push(len);
    if (len < 3.5) continue;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    let nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
    if (nx * (mx - cen[0]) + ny * (my - cen[1]) < 0) { nx = -nx; ny = -ny; }
    let rot = -Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    if (rot > 90) rot -= 180; if (rot < -90) rot += 180;
    dims.push(ptF(...P.from([mx + nx * 1.6, my + ny * 1.6]), { t: Math.round(len * 3.28084) + ' ft', rot, len }));
  }
  dims.sort((a, b) => b.properties.len - a.properties.len);
  map.getSource('dims').setData(fc(dims.slice(0, 10)));
  const bb = boundsOf(best.ring);
  ctx.footCenter = [(bb[0][0] + bb[1][0]) / 2, (bb[0][1] + bb[1][1]) / 2];
  const span = Math.max(8, ...best.loc.map(p => Math.hypot(p[0] - cen[0], p[1] - cen[1])));
  const box = map.getContainer(), px = Math.min(box.clientWidth, box.clientHeight) || 600;
  ctx.footZoom = Math.max(16.5, Math.min(20, Math.log2(156543 * Math.cos(lat * Math.PI / 180) * px / (span * 2 * 2.6))));
  if (currentLens === 'site') moveCamera(cameraFor('site'));
  const sqft = best.area * 10.7639;
  const longest = Math.max(...sides) * 3.28084, n = verts.length;
  const shape = n <= 4 ? 'a simple four-sided footprint' : n <= 8 ? `${n} sides` : `an irregular outline with ${n} sides`;
  const big = sqft > 40000 ? 'a large building, likely commercial or multi-unit' : sqft > 6000 ? 'a mid-size building, often multi-unit or commercial' : sqft > 1200 ? 'about the size of a typical detached house' : 'a small structure';
  c.done(`<p class="verdict">The mapped outline covers about <b>${int(Math.round(sqft / 10) * 10)} sq ft</b> of ground, ${big}.</p>
    <div class="facts">
      <div><b>${int(sqft)}</b><span>Footprint, sq ft</span></div>
      <div><b>${int(longest)} ft</b><span>Longest side</span></div>
      <div><b>${h ? int(h * 3.28084) + ' ft' : '—'}</b><span>${h ? 'Mapped height' : 'Height not mapped'}</span></div>
      <div><b>${ft == null ? '—' : int(ft) + ' ft'}</b><span>Ground elevation</span></div>
      <div><b>${n}</b><span>Corners, ${esc(shape.replace(/^a /, ''))}</span></div>
      <div><b>${best.contains ? 'Yes' : 'Nearby'}</b><span>${best.contains ? 'Address falls inside this outline' : 'Closest outline to the address'}</span></div>
    </div>
    <p class="note">Footprint is ground coverage, not floor area. Side lengths are measured from the mapped outline and can be off by a few feet. Scroll back to the top for the block in 3D.</p>`
    + src('Building outlines from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> via OpenMapTiles; aerial imagery from Esri; elevation from <a href="https://apps.nationalmap.gov/epqs/" target="_blank" rel="noopener">USGS 3DEP</a>.'));
}

async function loadFlood(lat, lon, c) {
  const j = await getJSON(arcPoint(EP.nfhl + '/28', lon, lat, { outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE' }));
  const f = j.features?.[0]?.attributes;
  const s = src('FEMA <a href="https://www.fema.gov/flood-maps/national-flood-hazard-layer" target="_blank" rel="noopener">National Flood Hazard Layer</a>. Lenders use the official panel; confirm at the <a href="https://msc.fema.gov/portal/search?AddressQuery=' + encodeURIComponent(ctx.place.label || lat + ',' + lon) + '" target="_blank" rel="noopener">FEMA Map Service Center</a>.');
  if (!f) { ctx.setBfe(null); c.sum('flood', 'Not mapped', 0);
    return c.done('<p class="verdict">FEMA has no digital flood map for this spot.</p><p>Some counties only have older paper maps. No map does not mean no risk: check the river and coastal flooding ratings under natural hazards, and ask about past flooding.</p>' + s); }
  const z = (f.FLD_ZONE || '').trim(), sub = (f.ZONE_SUBTY || '').toUpperCase();
  let lvl, short, verdict, more = '';
  if (/^V/.test(z)) { lvl = 5; short = 'High, coastal'; verdict = `This spot is in a high-risk coastal flood zone, where storm waves add to the damage.`;
    more = 'There is at least a 1% chance of flooding each year, about 26% over a 30-year mortgage. Federally backed mortgages require flood insurance.'; }
  else if (/^A/.test(z)) { lvl = 5; short = 'High risk'; verdict = 'This spot is in a high-risk flood zone.';
    more = 'There is at least a 1% chance of flooding each year, about 26% over a 30-year mortgage. Federally backed mortgages require flood insurance, and renters should get contents coverage.' + (z === 'AO' || z === 'AH' ? ' This zone type means shallow flooding, usually 1 to 3 feet deep.' : ''); }
  else if (z === 'X' && sub.includes('0.2 PCT')) { lvl = 3; short = 'Moderate'; verdict = 'This spot has moderate flood risk.';
    more = 'It floods in roughly a 500-year event (0.2% a year). Insurance isn\'t required but is usually cheap here, and many flood claims come from outside high-risk zones.'; }
  else if (z === 'X' && sub.includes('LEVEE')) { lvl = 3; short = 'Behind a levee'; verdict = 'This spot is protected by a levee.';
    more = 'The levee lowers the mapped risk, but levees can be overtopped or fail, and land behind them is often low. FEMA recommends flood insurance here.'; }
  else if (z === 'X' || z === 'C' || z === 'B') { lvl = 1; short = 'Minimal'; verdict = 'This spot has minimal mapped flood risk.';
    more = 'It\'s outside the 500-year floodplain on FEMA\'s map. Heavy rain and backed-up drains can still flood a basement, and the maps don\'t account for future climate.'; }
  else if (z === 'D') { lvl = 2; short = 'Unstudied'; verdict = 'Flood risk here is possible but has never been studied.'; }
  else { lvl = 2; short = 'Zone ' + z; verdict = `FEMA lists this spot as zone ${esc(z)}.`; }
  const bfe = f.STATIC_BFE != null && f.STATIC_BFE > -9000 ? +f.STATIC_BFE : null;
  ctx.setBfe(bfe);
  c.sum('flood', short, lvl);
  const elev = await ctx.elev;
  let bfeLine = '';
  if (bfe != null && elev != null) {
    const diff = Math.round((elev - bfe) * 10) / 10;
    bfeLine = `<p>The base flood elevation here is <b>${bfe} ft</b>, and the ground is about <b>${elev.toFixed(0)} ft</b>, so a 1%-chance flood would ${diff < 0 ? `stand roughly <b>${Math.abs(diff).toFixed(0)} ft deep</b> at ground level` : `stay about ${diff.toFixed(0)} ft below the ground`}. ${diff < 0 ? 'The lowest floor needs to sit above that line.' : ''}</p><p class="note">Ground elevation is from a national model and can differ from a survey by a few feet. An elevation certificate gives the exact figure.</p>`;
  }
  c.done(`<p class="verdict">${verdict}</p><div class="facts"><div><b class="water">Zone ${esc(z)}</b><span>${esc(titleCase(sub) || 'FEMA flood zone')}</span></div><div><b>${bfe != null ? bfe + ' ft' : '—'}</b><span>Base flood elevation</span></div><div><b><span class="lvl" style="--c:${C.lvl[lvl]}">${esc(short)}</span></b><span>Risk level</span></div></div><p>${more}</p>${bfeLine}` + s);
}

const NRI_LEVEL = { 'Very High': 5, 'Relatively High': 4, 'Relatively Moderate': 3, 'Relatively Low': 2, 'Very Low': 1 };
const NRI_HAZ = { CFLD: 'Coastal flooding', IFLD: 'River flooding', HRCN: 'Hurricane', TRND: 'Tornado', SWND: 'Strong wind', HAIL: 'Hail', LTNG: 'Lightning', WFIR: 'Wildfire', ERQK: 'Earthquake', LNDS: 'Landslide', HWAV: 'Heat wave', CWAV: 'Cold wave', WNTW: 'Winter weather', ISTM: 'Ice storm', DRGT: 'Drought', TSUN: 'Tsunami', VLCN: 'Volcano', AVLN: 'Avalanche' };
const SHORT_RATING = { 'Very High': 'Very high', 'Relatively High': 'High', 'Relatively Moderate': 'Moderate', 'Relatively Low': 'Low', 'Very Low': 'Very low' };
async function loadHazard(lat, lon, c) {
  const [nri, tract] = await Promise.all([arcFirst(EP.nri, lon, lat), tractGeom(lat, lon)]);
  const a = nri?.attributes;
  if (!a) throw new Error('no risk data for this location');
  const comp = a.RISK_RATNG, lvl = NRI_LEVEL[comp] ?? 0;
  const haz = Object.entries(NRI_HAZ).map(([k, name]) => ({ name, r: a[k + '_RISKR'], lvl: NRI_LEVEL[a[k + '_RISKR']] ?? 0 })).sort((x, y) => y.lvl - x.lvl);
  const top = haz.filter(h => h.lvl >= 4).slice(0, 3).map(h => h.name.toLowerCase());
  c.sum('hazard', SHORT_RATING[comp] || comp || 'Not rated', lvl);
  const why = !top.length ? '' : lvl >= 3 ? `, mostly from ${listJoin(top)}` : `, although ${listJoin(top)} ${top.length > 1 ? 'are' : 'is'} rated high`;
  const tiles = haz.map(h => h.lvl ? `<div class="${h.lvl <= 2 ? 'lo' : ''}" style="--c:${h.lvl <= 2 ? (h.lvl === 1 ? '#dbe6dd' : '#e7ecd5') : C.lvl[h.lvl]}"><b>${esc(h.name)}</b><span>${esc(SHORT_RATING[h.r] || h.r)}</span></div>`
    : `<div class="na"><b>${esc(h.name)}</b><span>${esc(h.r === 'Not Applicable' ? 'Doesn\'t apply' : 'Not rated')}</span></div>`).join('');
  c.done(`<p class="verdict">Natural hazard risk in this Census tract is <b>${esc((SHORT_RATING[comp] || 'not rated').toLowerCase())}</b> compared with the rest of the country${esc(why)}.</p>
    <div class="hz">${tiles}</div>
    <p class="note">Each rating weighs how often the hazard strikes, what's in harm's way and how well the community recovers. Community resilience is ${esc((a.RESL_RATNG || 'unrated').toLowerCase())}; social vulnerability is ${esc((a.SOVI_RATNG || 'unrated').toLowerCase())}.</p>`
    + src('FEMA <a href="https://hazards.fema.gov/nri/" target="_blank" rel="noopener">National Risk Index</a>, tract ' + esc(a.TRACTFIPS || '') + '. Property-level wildfire detail: <a href="https://wildfirerisk.org/" target="_blank" rel="noopener">Wildfire Risk to Communities</a>.'));
}
let tractPromise = null, tractFor = null;
function tractGeom(lat, lon) {
  if (tractFor === ctx.id && tractPromise) return tractPromise;
  tractFor = ctx.id;
  tractPromise = arcFirst(EP.tiger + '/8', lon, lat, { outFields: 'NAME,GEOID', returnGeometry: 'true', outSR: 4326, geometryPrecision: 6 }).then(f => {
    const g = arcRingsToGeo(f?.geometry);
    if (g) {
      map.getSource('tract').setData(fc([{ type: 'Feature', geometry: g, properties: {} }]));
      ctx.bounds.hazard = ctx.bounds.hood = boundsOf(g.coordinates.flat());
      if (currentLens === 'hazard' || currentLens === 'hood') moveCamera(cameraFor(currentLens));
    }
    return f?.attributes || null;
  }).catch(() => null);
  return tractPromise;
}

function noiseBase(lat, lon) { return lat > 51 && lon < -129 ? EP.noise.alaska[0] : lat < 23.5 && lon < -154 ? EP.noise.hawaii[0] : EP.noise.conus[0]; }
function classifyNoise(d) {
  let best = null, bd = 1e9;
  NOISE_CLASSES.forEach((cl, i) => { const dd = (d[0] - cl.rgb[0]) ** 2 + (d[1] - cl.rgb[1]) ** 2 + (d[2] - cl.rgb[2]) ** 2; if (dd < bd) { bd = dd; best = i; } });
  return bd < 9000 ? best : null;
}
async function sampleNoise(base, lat, lon, offsets) {
  const z = 12, [fx, fy] = tileXY(lat, lon, z), cache = {}, out = [];
  for (const [dx, dy] of offsets) {
    const gx = fx * 256 + dx, gy = fy * 256 + dy, tx = Math.floor(gx / 256), ty = Math.floor(gy / 256), key = tx + '/' + ty;
    cache[key] ??= (async () => {
      const r = await fetch(`${base}/tile/${z}/${ty}/${tx}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('noise map HTTP ' + r.status);
      const bm = await createImageBitmap(await r.blob());
      const cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bm, 0, 0); return cx;
    })();
    const cx = await cache[key];
    if (!cx) { out.push(null); continue; }
    const d = cx.getImageData(Math.floor(gx - tx * 256), Math.floor(gy - ty * 256), 1, 1).data;
    out.push(d[3] < 60 ? null : classifyNoise(d));
  }
  return out;
}
function noiseRuler(here, near) {
  const W = 440, x = db => 8 + (db - 40) / 55 * (W - 16);
  const bands = NOISE_CLASSES.map(cl => `<rect x="${x(cl.lo)}" y="22" width="${x(cl.hi) - x(cl.lo)}" height="12" fill="rgb(${cl.rgb})" opacity=".85"/>`).join('');
  const refs = [[45, 'Quiet street'], [55, 'EPA outdoor guideline'], [65, 'Busy road'], [80, 'Next to a highway']];
  const ticks = refs.map(([db, t], i) => `<line x1="${x(db)}" x2="${x(db)}" y1="34" y2="${i % 2 ? 58 : 44}" stroke="${C.graphite}" stroke-width="1"/><text x="${x(db)}" y="${i % 2 ? 70 : 56}" font-size="11" fill="${C.graphite}" text-anchor="${db > 75 ? 'end' : 'start'}" dx="${db > 75 ? 4 : -2}">${t}</text>`).join('');
  const mark = (cl, label, y, filled) => {
    const mid = cl == null ? 42.5 : (NOISE_CLASSES[cl].lo + NOISE_CLASSES[cl].hi) / 2, X = x(mid);
    return `<path d="M${X - 6} ${y} L${X + 6} ${y} L${X} ${y + 8} Z" fill="${filled ? C.ink : '#fff'}" stroke="${C.ink}" stroke-width="1.4"/><text x="${X}" y="${y - 4}" font-size="11.5" font-weight="650" text-anchor="middle" fill="${C.ink}">${label}</text>`;
  };
  return `<div class="ruler"><svg viewBox="0 -8 ${W} 84" role="img" aria-label="Noise scale from 40 to 95 decibels with this address marked">
    <rect x="${x(40)}" y="22" width="${x(45) - x(40)}" height="12" fill="#e4e8e1"/>${bands}
    ${[40, 50, 60, 70, 80, 90].map(d => `<text x="${x(d)}" y="18" font-size="10" fill="${C.graphite}" text-anchor="middle">${d}</text>`).join('')}
    ${near != null && near !== here ? mark(near, 'Within 150 m', 6, false) : ''}${mark(here, 'Here', near != null && near !== here && Math.abs((here ?? -1) - near) < 2 ? -8 : 6, true)}
    ${ticks}</svg></div>`;
}
async function loadNoise(lat, lon, c) {
  const offs = [[0, 0]]; for (const r of [2, 4]) for (const [a, b] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) offs.push([a, b]);
  const v = await sampleNoise(noiseBase(lat, lon), lat, lon, offs);
  const here = v[0], nearMax = v.filter(x => x != null).reduce((m, x) => Math.max(m, x), -1), near = nearMax >= 0 ? nearMax : null;
  const cl = here != null ? NOISE_CLASSES[here] : null;
  const lvl = cl ? cl.lvl : 1;
  c.sum('noise', cl ? cl.label : 'Under 45 dB', lvl);
  let verdict = cl ? `Modeled traffic, rail and aircraft noise here averages <b>${cl.label}</b>, ${cl.say}.` : 'Modeled traffic, rail and aircraft noise here is <b>under 45 dB</b>, quieter than a typical suburban street.';
  let more = near != null && near > (here ?? -1) ? `<p>Within about 150 m it reaches <b>${NOISE_CLASSES[near].label}</b>, so the side of the building facing the road will be louder.</p>` : '';
  c.done(`<p class="verdict">${verdict}</p>${noiseRuler(here, near)}${more}<p class="note">This is a 24-hour average. It doesn't include bars, construction, sirens or industry, and the grid is about 35 m across.</p>`
    + src('US DOT Bureau of Transportation Statistics <a href="https://www.bts.gov/geospatial/national-transportation-noise-map" target="_blank" rel="noopener">National Transportation Noise Map</a>, 2020.'));
}

function poiCat(p) {
  const cl = p.class, sc = p.subclass;
  if (cl === 'grocery' && sc !== 'department_store') return 'grocery';
  if (sc === 'greengrocer' || sc === 'supermarket') return 'grocery';
  if (cl === 'pharmacy' || sc === 'chemist' || sc === 'pharmacy') return 'pharmacy';
  if (cl === 'park' || sc === 'playground' || cl === 'playground') return 'park';
  if (cl === 'hospital' || sc === 'doctors' || sc === 'clinic' || sc === 'dentist') return 'health';
  if (['restaurant', 'cafe', 'fast_food', 'bakery', 'ice_cream'].includes(cl)) return 'food';
  if (cl === 'bus' || (cl === 'railway' && ['station', 'halt', 'subway', 'tram_stop', 'light_rail'].includes(sc))) return 'transit';
  if (cl === 'library' && sc === 'library') return 'library';
  return null;
}
async function loadErrands(lat, lon, c) {
  const [feats, w] = await Promise.all([nearbyFeatures(lat, lon, 'poi'), arcFirst(EP.walk, lon, lat, { outFields: 'NatWalkInd' }).catch(() => null)]);
  const rings = [[0.25, '5 min'], [0.5, '10 min'], [0.75, '15 min']];
  map.getSource('rings').setData(fc([
    ...rings.map(([r]) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: circle(lat, lon, r) }, properties: {} })),
    ...rings.map(([r, label]) => ptF(lon, lat + r / 69.0, { label: label + ' walk' })),
  ]));
  ctx.bounds.errands = boundsOf(circle(lat, lon, 0.78));
  const by = {};
  const pts = [];
  for (const f of feats) {
    if (f.type !== 1) continue;
    const k = poiCat(f.props); if (!k) continue;
    const [plon, plat] = f.rings[0][0], d = dist(lat, lon, plat, plon);
    if (d > 0.75) continue;
    (by[k] ||= []).push({ name: f.props.name || f.props['name:en'] || '', d, plon, plat });
  }
  for (const [k, arr] of Object.entries(by)) {
    arr.sort((a, b) => a.d - b.d);
    const seen = new Set();
    arr.forEach((p, i) => {
      if (k === 'transit' && p.name && seen.has(p.name)) return; seen.add(p.name);
      const props = { color: POI_CATS[k].color, name: p.name || 'Unnamed', kind: POI_CATS[k].one, d: `about ${walkMin(p.d)} min walk` };
      if (i === 0 && p.name && k !== 'transit' && k !== 'food') props.label = p.name;
      pts.push(ptF(p.plon, p.plat, props));
    });
  }
  map.getSource('pois').setData(fc(pts));
  const wi = w?.attributes?.NatWalkInd;
  let wl = null, wlvl = 0;
  if (wi != null) { [wl, wlvl] = wi > 15.25 ? ['Most walkable', 1] : wi > 10.5 ? ['Above average', 2] : wi > 5.75 ? ['Below average', 3] : ['Car-dependent', 4]; c.sum('errands', `${wl}, ${wi.toFixed(1)} of 20`, wlvl); }
  else c.sum('errands', 'No index', 0);
  const rows = Object.entries(POI_CATS).map(([k, cat]) => {
    const a = by[k] || [], first = a[0];
    const within10 = a.filter(p => p.d <= 0.5).length;
    return `<li><span class="k"><span class="swatch" style="background:${cat.color}"></span>${cat.label}<small>${a.length ? `${a.length} within a 15-minute walk${within10 !== a.length ? `, ${within10} within 10` : ''}` : 'None within a 15-minute walk'}</small></span>
      <span class="v">${first ? `${walkMin(first.d)} min<small>${esc(first.name || 'unnamed')}</small>` : '—'}</span></li>`;
  }).join('');
  const have = Object.keys(POI_CATS).filter(k => by[k]?.length && ['grocery', 'pharmacy', 'park', 'transit'].includes(k)).length;
  const verdict = have === 4 ? 'Groceries, a pharmacy, a park and transit are all within a 15-minute walk.'
    : have === 0 ? 'None of the basics (groceries, pharmacy, park, transit) are within a 15-minute walk. Plan on driving.'
    : `${have} of the 4 basics (groceries, pharmacy, park, transit) are within a 15-minute walk.`;
  c.done(`<p class="verdict">${verdict}</p>${wi != null ? `<p>The EPA walkability index for this block group is <b>${wi.toFixed(1)} out of 20</b>: ${esc(wl.toLowerCase())}.</p>` : ''}
    <ul class="rows">${rows}</ul>
    <p class="note">Walk times use straight-line distance plus a quarter for street detours, at 3 mph. Places come from OpenStreetMap, which may miss some businesses.</p>`
    + src('<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors via OpenMapTiles; EPA <a href="https://www.epa.gov/smartgrowth/smart-location-mapping" target="_blank" rel="noopener">National Walkability Index</a>.'));
}

const LOCALE = { 11: 'large city', 12: 'midsize city', 13: 'small city', 21: 'large suburb', 22: 'midsize suburb', 23: 'small suburb', 31: 'fringe town', 32: 'distant town', 33: 'remote town', 41: 'fringe rural area', 42: 'distant rural area', 43: 'remote rural area' };
async function loadSchools(lat, lon, c) {
  const f = { outFields: 'NCESSCH,NAME,STREET,CITY,LAT,LON,LOCALE,SCHOOLYEAR' };
  const districtQ = Promise.all([14, 18, 16].map(l => arcFirst(EP.tiger + '/' + l, lon, lat, { outFields: 'NAME' }).then(x => x?.attributes?.NAME).catch(() => null)));
  let list = await arcNear(EP.nces, lon, lat, 2, f);
  if (list.length < 3) list = await arcNear(EP.nces, lon, lat, 10, f);
  if (!list.length) list = await arcNear(EP.nces, lon, lat, 30, f);
  const S = list.map(s => ({ ...s, d: dist(lat, lon, s.LAT, s.LON) })).sort((a, b) => a.d - b.d).slice(0, 7);
  const districts = (await districtQ).filter(Boolean);
  if (!S.length) return c.done('<p class="verdict">No public schools within 30 miles.</p>' + src('NCES EDGE public school locations.'));
  map.getSource('schools').setData(fc(S.map(s => ptF(s.LON, s.LAT, { color: C.ink, name: titleCase(s.NAME), label: titleCase(s.NAME), kind: 'Public school', d: mi(s.d) }))));
  ctx.bounds.schools = boundsOf([[lon, lat], ...S.slice(0, 5).map(s => [s.LON, s.LAT])]);
  if (currentLens === 'schools') moveCamera(cameraFor('schools'));
  c.done(`<p class="verdict">The nearest public school is <b>${esc(titleCase(S[0].NAME))}</b>, ${mi(S[0].d)} away.</p>
    ${districts.length ? `<p>This address is in <b>${districts.map(esc).join('</b> and <b>')}</b>.</p>` : ''}
    <ul class="rows">${S.map(s => `<li><span class="k"><a href="https://nces.ed.gov/ccd/schoolsearch/school_detail.asp?ID=${esc(s.NCESSCH)}" target="_blank" rel="noopener">${esc(titleCase(s.NAME))}</a><small>${esc(titleCase(s.STREET))}, ${esc(titleCase(s.CITY))}</small></span><span class="v">${mi(s.d)}</span></li>`).join('')}</ul>
    <p class="note">Straight-line distance. The nearest school isn't always the assigned one, so confirm attendance zones with the district. NCES classes this area as a ${esc(LOCALE[+S[0].LOCALE] || 'mixed area')}.</p>`
    + src(`National Center for Education Statistics <a href="https://nces.ed.gov/programs/edge/Geographic/SchoolLocations" target="_blank" rel="noopener">EDGE school locations</a>, ${esc(S[0].SCHOOLYEAR || '2024-25')}; districts from Census TIGERweb.`));
}

async function loadEnv(lat, lon, c) {
  const all = { outFields: '*' };
  const [sf, tri, bf] = await Promise.all([arcNear(EP.epa + '/0', lon, lat, 3, all), arcNear(EP.epa + '/1', lon, lat, 1, all), arcNear(EP.epa + '/5', lon, lat, 1, all)]);
  const prep = (arr, kind) => arr.map(x => { const la = x.latitude ?? x._lat, lo = x.longitude ?? x._lon; return { ...x, kind, la, lo, d: dist(lat, lon, la, lo) }; }).sort((a, b) => a.d - b.d);
  const S = prep(sf, 'sf'), T = prep(tri, 'tri'), B = prep(bf, 'bf');
  const all3 = [...S, ...T, ...B];
  map.getSource('env').setData(fc(all3.map((x, i) => ptF(x.lo, x.la, { color: ENV_KIND[x.kind][1], name: titleCase(x.primary_name), kind: ENV_KIND[x.kind][0], d: mi(x.d), ...(i < 6 || x.kind === 'sf' ? { label: titleCase(x.primary_name) } : {}) }))));
  const r = S.length ? 3 : 1;
  map.getSource('envrings').setData(fc([1, 3].filter(m => m <= r).map(m => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: circle(lat, lon, m) }, properties: {} }))
    .concat([1, 3].filter(m => m <= r).map(m => ptF(lon, lat + m / 69, { label: m + ' mi' })))));
  ctx.bounds.env = boundsOf(circle(lat, lon, r * 1.02));
  const close = S.filter(x => x.d <= 1).length;
  const lvl = close ? 4 : S.length ? 3 : T.length > 2 ? 3 : (T.length || B.length) ? 2 : 1;
  c.sum('env', S.length ? `${S.length} Superfund within 3 mi` : T.length || B.length ? `${T.length + B.length} within 1 mi` : 'None nearby', lvl);
  const li = x => `<li><span class="k"><span class="swatch" style="background:${ENV_KIND[x.kind][1]}"></span>${esc(titleCase(x.primary_name))}<small>${ENV_KIND[x.kind][0]}${x.profile_url || x.facility_url ? `, <a href="${esc(x.profile_url || x.facility_url)}" target="_blank" rel="noopener">EPA record</a>` : ''}</small></span><span class="v">${mi(x.d)}</span></li>`;
  const verdict = !all3.length ? 'No Superfund, toxic-release or brownfield sites are on record nearby.'
    : S.length ? `There ${S.length === 1 ? 'is 1 Superfund site' : `are ${S.length} Superfund sites`} within 3 miles${close ? `, ${close} within a mile` : ''}.`
    : `No Superfund sites within 3 miles, but ${T.length + B.length} other EPA-tracked site${T.length + B.length > 1 ? 's are' : ' is'} within a mile.`;
  c.done(`<p class="verdict">${verdict}</p>${all3.length ? `<ul class="rows">${[...S.slice(0, 4), ...T.slice(0, 4), ...B.slice(0, 3)].map(li).join('')}</ul>` : ''}
    <p class="note">Being near a site isn't proof of exposure: groundwater direction and cleanup status matter. Points mark facilities, not the extent of contamination.</p>`
    + src('EPA <a href="https://www.epa.gov/enviro/envirofacts-overview" target="_blank" rel="noopener">Envirofacts</a>: Superfund (SEMS), Toxics Release Inventory and brownfields (ACRES).'));
}

function dumbbell(label, sub, here, there, fmt, hereLab = 'This tract', max) {
  if (here == null && there == null) return '';
  const W = 300, m = max ?? (Math.max(here ?? 0, there ?? 0) * 1.15 || 1), x = v => 6 + (Math.min(v, m) / m) * (W - 12);
  const hx = here != null ? x(here) : null, tx = there != null ? x(there) : null;
  const anchor = X => X > W - 60 ? 'end' : X < 40 ? 'start' : 'middle';
  return `<div class="row"><div class="lab">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>
    <svg viewBox="0 0 ${W} 34" role="img" aria-label="${esc(label)}: ${esc(hereLab)} ${esc(fmt(here))}, county ${esc(fmt(there))}">
      <line x1="6" x2="${W - 6}" y1="22" y2="22" stroke="${C.rule}" stroke-width="2"/>
      ${hx != null && tx != null ? `<line x1="${Math.min(hx, tx)}" x2="${Math.max(hx, tx)}" y1="22" y2="22" stroke="${C.graphite}" stroke-width="2"/>` : ''}
      ${tx != null ? `<circle cx="${tx}" cy="22" r="5" fill="#fff" stroke="${C.graphite}" stroke-width="2"/>` : ''}
      ${hx != null ? `<circle cx="${hx}" cy="22" r="6" fill="${C.ink}"/><text x="${hx}" y="10" font-size="12" font-weight="650" text-anchor="${anchor(hx)}" fill="${C.ink}">${esc(fmt(here))}</text>` : ''}
    </svg></div>`;
}
async function loadHood(lat, lon, c) {
  const [t, k, n, nk, hc] = await Promise.all([
    arcFirst(EP.acsBasics + '/2', lon, lat), arcFirst(EP.acsBasics + '/1', lon, lat),
    arcFirst(EP.acsNet + '/2', lon, lat), arcFirst(EP.acsNet + '/1', lon, lat), arcFirst(EP.acsCost + '/2', lon, lat).catch(() => null), tractGeom(lat, lon)]);
  const T = t?.attributes, K = k?.attributes, N = n?.attributes, NK = nk?.attributes, H = hc?.attributes;
  if (!T) throw new Error('no Census data for this tract');
  const bb = a => a && a.B28001_001E ? a.B28002_004E / a.B28001_001E * 100 : null;
  const net = bb(N);
  const nlvl = net == null ? 0 : net >= 90 ? 1 : net >= 80 ? 2 : net >= 70 ? 3 : 4;
  c.sum('net', net == null ? 'No data' : pct(net) + ' of homes', nlvl);
  const inc = T.B19049_001E, kinc = K?.B19049_001E;
  const rel = (e, m) => e && m && m / 1.645 / e > 0.3 ? 'low-reliability estimate' : '';
  const cmp = inc && kinc ? (inc > kinc * 1.15 ? 'higher-income' : inc < kinc * 0.85 ? 'lower-income' : 'middle-income') : null;
  const own = T.B25003_calc_pctOwnE;
  const verdict = `A ${cmp ? cmp + ', ' : ''}${own != null ? (own >= 60 ? 'mostly owner-occupied' : own <= 40 ? 'mostly renter' : 'mixed owner and renter') : ''} area of about ${int(T.B01001_001E)} people${K ? ` compared with the rest of ${esc(K.NAME || 'the county')}` : ''}.`;
  const vac = a => a?.B25002_001E ? a.B25002_003E / a.B25002_001E * 100 : null;
  c.done(`<p class="verdict">${verdict}</p>
    <div class="db">
      ${dumbbell('Household income', rel(inc, T.B19049_001M) || 'median', inc, kinc, money)}
      ${dumbbell('Rent', rel(T.B25058_001E, T.B25058_001M) || 'median contract rent', T.B25058_001E, K?.B25058_001E, money)}
      ${dumbbell('Home value', rel(T.B25077_001E, T.B25077_001M) || 'median, owner-occupied', T.B25077_001E, K?.B25077_001E, money)}
      ${dumbbell('Homeowners', 'share of occupied homes', own, K?.B25003_calc_pctOwnE, pct, undefined, 100)}
      ${dumbbell('Home broadband', 'share of households', net, bb(NK), pct, undefined, 100)}
      ${dumbbell('Vacant homes', 'share of housing units', vac(T), vac(K), pct, undefined, Math.max(25, (vac(T) || 0) * 1.15))}
      ${dumbbell('Median age', '', T.B01002_001E, K?.B01002_001E, v => v == null ? '—' : v.toFixed(0), undefined, 70)}
    </div>
    <div class="legend-inline"><span><i style="background:${C.ink}"></i>This tract</span><span><i style="border:2px solid ${C.graphite};background:#fff"></i>${esc(K?.NAME || 'County')}</span></div>
    ${H?.B25070_calc_pctGE30pctE != null ? `<p>${pct(H.B25070_calc_pctGE30pctE)} of renters here spend 30% or more of their income on rent${H.B25070_calc_pctGE30pctE >= 50 ? ', a sign rents run high for local incomes' : ''}.</p>` : ''}
    <p class="note">Survey estimates for ${esc(T.NAME || 'the tract')}, outlined on the map. For exact internet providers at this address, <a href="https://broadbandmap.fcc.gov/home" target="_blank" rel="noopener">check the FCC map</a>.</p>`
    + src('US Census Bureau American Community Survey 5-year estimates via the <a href="https://livingatlas.arcgis.com/" target="_blank" rel="noopener">ArcGIS Living Atlas</a>.'));
}

async function loadGround(lat, lon, c) {
  const N = 29, half = 0.55; // miles each side
  const dLon = half / (69.17 * Math.cos(lat * Math.PI / 180));
  const pts = Array.from({ length: N }, (_, i) => [lon - dLon + (2 * dLon) * i / (N - 1), lat]);
  map.getSource('profile').setData(fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} }, ptF(pts[0][0], lat, { label: 'W' }), ptF(pts[N - 1][0], lat, { label: 'E' })]));
  ctx.bounds.ground = boundsOf([[pts[0][0], lat - dLon * 0.25], [pts[N - 1][0], lat + dLon * 0.25]]);
  const [vals, eq, big, bfe] = await Promise.all([
    pool(pts, 6, ([x, y]) => getJSON(EP.epqs + '?' + qs({ x, y, units: 'Feet', wkid: 4326 }), { timeout: 15000 }).then(j => j.value > -1000 ? +j.value : null)),
    getJSON(EP.usgs + '/count?' + qs({ format: 'geojson', latitude: lat, longitude: lon, maxradiuskm: 100, minmagnitude: 4, starttime: '1976-01-01' })).catch(() => null),
    getJSON(EP.usgs + '/query?' + qs({ format: 'geojson', latitude: lat, longitude: lon, maxradiuskm: 100, minmagnitude: 4, starttime: '1976-01-01', orderby: 'magnitude', limit: 1 })).catch(() => null),
    ctx.bfe,
  ]);
  const good = vals.filter(v => v != null);
  const top = big?.features?.[0]?.properties, n = eq?.count;
  const quake = `<div class="facts"><div><b>${n == null ? '—' : int(n)}</b><span>Magnitude 4+ quakes within 100 km since 1976</span></div><div><b>${top ? 'M' + top.mag.toFixed(1) : '—'}</b><span>Largest of those${top ? ', ' + new Date(top.time).getFullYear() : ''}</span></div>`;
  const s = src('USGS <a href="https://apps.nationalmap.gov/epqs/" target="_blank" rel="noopener">3DEP elevation</a>, sampled every 200 ft along a 1.1-mile line; USGS <a href="https://earthquake.usgs.gov/earthquakes/search/" target="_blank" rel="noopener">earthquake catalog</a>.');
  if (good.length < N * 0.6) return c.done(`<p class="verdict">The elevation service didn't return enough points to draw the ground profile.</p>${quake}</div>` + s);
  const mid = vals[(N - 1) / 2] ?? good[Math.floor(good.length / 2)];
  let lo = Math.min(...good), hi = Math.max(...good);
  if (bfe != null) { lo = Math.min(lo, bfe); hi = Math.max(hi, bfe); }
  const range = Math.max(hi - lo, 12), pad = range * 0.18, y0 = lo - pad, y1 = lo + range + pad;
  const W = 440, H = 170, L = 34, B = 22, X = i => L + i / (N - 1) * (W - L - 6), Y = v => 8 + (1 - (v - y0) / (y1 - y0)) * (H - B - 8);
  let d = '', area = '', started = false;
  vals.forEach((v, i) => { if (v == null) return; d += (started ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); started = true; });
  const firstI = vals.findIndex(v => v != null), lastI = vals.length - 1 - [...vals].reverse().findIndex(v => v != null);
  area = d + `L${X(lastI)} ${H - B}L${X(firstI)} ${H - B}Z`;
  const yt = [y0 + pad, y0 + pad + range / 2, y0 + pad + range].map(v => Math.round(v));
  const rel = mid - (good.reduce((a, b) => a + b, 0) / good.length);
  const verdict = Math.abs(rel) < 3 ? 'The property sits about level with the ground around it.'
    : rel < 0 ? `The property sits <b>about ${Math.abs(rel).toFixed(0)} ft lower</b> than the surrounding half mile on average, so water drains toward it.`
    : `The property sits <b>about ${rel.toFixed(0)} ft higher</b> than the surrounding half mile on average, so water drains away from it.`;
  c.done(`<p class="verdict">${verdict}</p>
    <div class="profile"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ground elevation profile west to east through the property">
      <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${C.contour}" stroke-width="1" opacity=".35"/></pattern></defs>
      ${yt.map(v => `<line x1="${L}" x2="${W - 6}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.rule}" stroke-width="1"/><text x="${L - 6}" y="${Y(v) + 4}" font-size="10.5" text-anchor="end" fill="${C.graphite}">${int(v)}</text>`).join('')}
      <path d="${area}" fill="url(#hatch)"/><path d="${d}" fill="none" stroke="${C.contour}" stroke-width="2.2" stroke-linejoin="round"/>
      ${bfe != null ? `<line x1="${L}" x2="${W - 6}" y1="${Y(bfe)}" y2="${Y(bfe)}" stroke="${C.water}" stroke-width="1.6" stroke-dasharray="5 3"/><text x="${W - 8}" y="${Y(bfe) - 5}" font-size="11.5" text-anchor="end" fill="${C.water}" font-family="Source Serif 4, Georgia, serif" font-style="italic">Base flood elevation ${bfe} ft</text>` : ''}
      <line x1="${X((N - 1) / 2)}" x2="${X((N - 1) / 2)}" y1="${Y(mid) - 22}" y2="${Y(mid)}" stroke="${C.flag}" stroke-width="2"/><circle cx="${X((N - 1) / 2)}" cy="${Y(mid)}" r="4.5" fill="${C.flag}" stroke="#fff" stroke-width="1.5"/>
      <text x="${X((N - 1) / 2)}" y="${Y(mid) - 27}" font-size="11.5" font-weight="650" text-anchor="middle" fill="${C.ink}">This property, ${int(mid)} ft</text>
      <text x="${L}" y="${H - 5}" font-size="10.5" fill="${C.graphite}">West, 0.55 mi</text><text x="${W - 6}" y="${H - 5}" font-size="10.5" text-anchor="end" fill="${C.graphite}">East, 0.55 mi</text>
      <text x="4" y="12" font-size="10.5" fill="${C.graphite}">ft</text>
    </svg></div>
    <p class="note">Vertical scale is exaggerated so small changes show. Ground ranges from ${int(Math.min(...good))} to ${int(Math.max(...good))} ft along this line.</p>${quake}</div>` + s);
}

const AQI = v => v <= 50 ? ['Good', 1] : v <= 100 ? ['Moderate', 2] : v <= 150 ? ['Unhealthy for sensitive groups', 3] : v <= 200 ? ['Unhealthy', 4] : ['Very unhealthy', 5];
async function loadToday(lat, lon, c) {
  const [alerts, aq] = await Promise.all([
    getJSON(`${EP.nws}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { init: { headers: { Accept: 'application/geo+json' } } }).catch(e => ({ _err: e })),
    getJSON(EP.aq + '?' + qs({ latitude: lat, longitude: lon, current: 'us_aqi,pm2_5', timezone: 'auto' })).catch(e => ({ _err: e })),
  ]);
  const fa = alerts.features || [];
  let html = alerts._err ? `<p class="verdict">Weather alerts are unavailable right now.</p>`
    : !fa.length ? '<p class="verdict">No active weather alerts for this spot.</p>'
    : `<p class="verdict">${fa.length === 1 ? 'One weather alert is' : fa.length + ' weather alerts are'} active here.</p><ul class="rows">${fa.slice(0, 5).map(f => `<li><span class="k">${esc(f.properties.event)}<small>${esc(f.properties.headline || '')}</small></span><span class="v">${f.properties.ends || f.properties.expires ? 'until<small>' + esc(new Date(f.properties.ends || f.properties.expires).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })) + '</small>' : ''}</span></li>`).join('')}</ul>`;
  if (!aq._err && aq.current?.us_aqi != null) {
    const [lab, lv] = AQI(aq.current.us_aqi);
    html += `<p>Air quality right now: <span class="lvl" style="--c:${C.lvl[lv]}">${lab}, AQI ${Math.round(aq.current.us_aqi)}</span> <span class="note">(modeled estimate)</span></p>`;
  }
  c.done(html + src('<a href="https://www.weather.gov/" target="_blank" rel="noopener">National Weather Service</a>; air quality modeled by <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noopener">Open-Meteo</a>. Official readings at <a href="https://www.airnow.gov/" target="_blank" rel="noopener">AirNow</a>.'));
}

// ---------------- buttons & start ----------------
$('#share').addEventListener('click', async () => {
  const b = $('#share');
  try { await navigator.clipboard.writeText(location.href); b.textContent = 'Link copied'; } catch { b.textContent = 'Copy the address bar'; }
  setTimeout(() => b.textContent = 'Copy link', 2200);
});
$('#print').addEventListener('click', () => window.print());

const p = new URLSearchParams(location.search);
if (p.get('lat') && p.get('lon') && !isNaN(+p.get('lat')) && !isNaN(+p.get('lon'))) {
  const label = p.get('label') || '';
  const [l1, ...rest] = label.split(', ');
  report({ lat: +p.get('lat'), lon: +p.get('lon'), label, line1: l1 || 'Selected point', line2: rest.join(', '), fromClick: !label });
} else if (p.get('q')) { input.value = p.get('q'); runSearch(p.get('q')); }
else {
  // welcome view: a 3D block as a backdrop, no data loaded
  mapReady.then(() => {
    map.setLayoutProperty('bldg3d', 'visibility', 'visible');
    map.jumpTo({ center: [-90.0652, 29.9547], zoom: 15.6, pitch: 58, bearing: -20 });
  });
}
