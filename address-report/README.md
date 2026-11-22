# Address Report

A free, plain-language report for any US address: flood zone, natural hazard risk, transportation noise, nearby contamination, neighborhood figures, home internet, nearest public schools, walkability, current weather alerts and air quality, elevation and earthquake history.

Live at https://zebonsa-cyber.github.io/address-report/

## How it works

It's a static page (`index.html`, `style.css`, `app.js`). The visitor's browser calls each public data service directly. There's no backend, no API keys and nothing stored. Reports are shareable: the URL carries `lat`, `lon` and `label`.

## Data sources

| Section | Source | Endpoint |
|---|---|---|
| Geocoding | Nominatim (OpenStreetMap) | nominatim.openstreetmap.org |
| Boundaries, school districts | Census TIGERweb | tigerweb.geo.census.gov |
| Flood zone | FEMA National Flood Hazard Layer, layer 28 | hazards.fema.gov |
| Hazard risk | FEMA National Risk Index, census tracts | services.arcgis.com (FEMA_NationalRiskIndex) |
| Noise | US DOT/BTS National Transportation Noise Map 2020 (tile pixels matched to the legend) | geo.dot.gov |
| Contamination | EPA Envirofacts points: Superfund (0), TRI (1), brownfields (5) | geopub.epa.gov |
| Neighborhood, internet | ACS 5-year via Esri Living Atlas (tract layer 2, county layer 1) | P3ePLMYs2RVChkJx.svcs.arcgis.com |
| Schools | NCES EDGE public school locations 2024-25 | nces.ed.gov/opengis |
| Walkability | EPA National Walkability Index | geodata.epa.gov |
| Nearby places | OpenStreetMap via Overpass (two mirrors raced) | overpass-api.de, overpass.private.coffee |
| Alerts | National Weather Service | api.weather.gov |
| Air quality | Open-Meteo (CAMS model) | air-quality-api.open-meteo.com |
| Elevation | USGS EPQS | epqs.nationalmap.gov |
| Earthquakes | USGS catalog | earthquake.usgs.gov |

The Census Bureau's own geocoder and data API (api.census.gov) send no CORS headers, so the page uses TIGERweb and Living Atlas copies of the same data instead.

## Known limits

- Noise tiles are only cached to zoom 12 (roughly 30 to 40 m pixels).
- Nominatim's usage policy allows about 1 request a second and no autocomplete. Heavy traffic would need a keyed geocoder.
- No crime data, no FCC address-level broadband (it needs a key) and no assigned-school lookup.
