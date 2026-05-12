"use strict";

const path = require("node:path");
const {onRequest} = require("firebase-functions/v2/https");
const {createRoutingService} = require("./router");

const service = createRoutingService({
  dataDir: path.join(__dirname, "data"),
  publicBaseUrl: "https://us-central1-node-red-alerts.cloudfunctions.net/rbcOpenApi",
});

function sendJson(res, status, payload) {
  res.status(status)
    .set("Cache-Control", "public, max-age=60")
    .json(payload);
}

function getEndpointPath(req) {
  const pathValue = req.path || req.url || "/";
  return pathValue.split("?")[0].replace(/\/+$/, "") || "/";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function featureCollection(features) {
  return {
    type: "FeatureCollection",
    features: Array.isArray(features) ? features : [],
  };
}

function pointFeature(item, kind, selectedId) {
  return {
    type: "Feature",
    properties: {
      id: item.id,
      label: item.name,
      kind,
      category: item.category || kind,
      selected: item.id === selectedId,
    },
    geometry: {
      type: "Point",
      coordinates: [item.lng, item.lat],
    },
  };
}

function buildRouteMapPayload(route) {
  const destinations = service.locations
    .filter((location) => location.visibleToGuests !== false)
    .map((location) => pointFeature(location, "destination", route.to.id));
  const booths = service.booths
    .filter((booth) => booth.visibleToGuests !== false)
    .map((booth) => pointFeature(booth, "booth", route.from.id));

  return {
    from: route.from,
    to: route.to,
    distanceMeters: route.distanceMeters,
    estimatedWalkMinutes: route.estimatedWalkMinutes,
    steps: route.steps,
    route: featureCollection([route.route]),
    paths: service.walkingPaths || featureCollection([]),
    destinations: featureCollection(destinations),
    booths: featureCollection(booths),
  };
}

function sendRoutePage(res, route) {
  const steps = route.steps
    .map((step, index) => `
          <li>
            <span>${index + 1}</span>
            <p>${escapeHtml(step)}</p>
          </li>`)
    .join("");
  const mapPayload = buildRouteMapPayload(route);
  const mapPayloadJson = escapeJsonForScript(mapPayload);
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(route.to.name)} Walking Directions</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.11.0/dist/maplibre-gl.css">
  <style>
    :root { color-scheme: light; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin: 0; background: #e8f2ec; color: #07120d; }
    main { min-height: 100%; display: grid; grid-template-rows: minmax(0, 1fr) auto; }
    #map { min-height: 56vh; height: calc(100vh - 290px); background: #dcebe1; }
    .top-card {
      position: fixed; z-index: 5; left: 14px; right: 14px; top: max(14px, env(safe-area-inset-top));
      background: rgba(255,255,255,.95); border: 1px solid rgba(207,221,214,.9); border-radius: 8px;
      padding: 14px; box-shadow: 0 12px 26px rgba(15,23,42,.16); backdrop-filter: blur(12px);
    }
    .eyebrow { color: #0e7490; font-size: 11px; font-weight: 900; letter-spacing: .22em; text-transform: uppercase; }
    h1 { margin: 6px 0 12px; font-size: clamp(28px, 7vw, 42px); line-height: 1.02; letter-spacing: 0; }
    .stats { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 8px; }
    .stat { min-width: 0; background: #f1f5f9; border-radius: 8px; padding: 10px; }
    .stat b { display: block; color: #64748b; font-size: 11px; letter-spacing: .18em; text-transform: uppercase; }
    .stat span { display: block; margin-top: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 850; }
    .sheet {
      position: relative; z-index: 4; margin-top: -20px; background: #fff; border-radius: 8px 8px 0 0;
      padding: 18px 16px max(22px, env(safe-area-inset-bottom)); box-shadow: 0 -14px 34px rgba(15,23,42,.18);
    }
    .grabber { width: 54px; height: 5px; margin: 0 auto 16px; border-radius: 999px; background: #cbd5e1; }
    .sheet-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .sheet h2 { margin: 3px 0 0; font-size: 24px; line-height: 1.1; }
    .sub { margin: 8px 0 0; color: #475569; font-weight: 700; }
    button.locate {
      min-height: 48px; border: 0; border-radius: 8px; padding: 0 15px; background: #0f172a; color: #fff;
      font: inherit; font-size: 15px; font-weight: 850;
    }
    .status { margin-top: 10px; color: #64748b; font-size: 13px; font-weight: 700; }
    ol { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 12px; }
    li { display: grid; grid-template-columns: 34px minmax(0,1fr); gap: 12px; align-items: start; }
    li span {
      width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center;
      border-radius: 999px; background: #ffedd5; color: #c2410c; font-weight: 900;
    }
    li p { margin: 3px 0 0; font-size: 16px; line-height: 1.35; font-weight: 800; }
    .maplibregl-ctrl-top-right { top: 165px; }
    .maplibregl-ctrl-attrib { font-size: 10px; }
    @media (min-width: 760px) {
      main { max-width: 460px; min-height: 100vh; margin: 0 auto; overflow: hidden; border-left: 1px solid #d8e2dc; border-right: 1px solid #d8e2dc; }
      #map { height: calc(100vh - 310px); }
      .top-card { left: calc(50% - 216px); right: calc(50% - 216px); }
    }
  </style>
</head>
<body>
  <main>
    <section class="top-card" aria-label="Route summary">
      <div class="eyebrow">RBC Canadian Open</div>
      <h1>${escapeHtml(route.to.name)}</h1>
      <div class="stats">
        <div class="stat"><b>From</b><span>${escapeHtml(route.from.name)}</span></div>
        <div class="stat"><b>Walk</b><span>${escapeHtml(route.estimatedWalkMinutes)} min</span></div>
        <div class="stat"><b>Distance</b><span>${escapeHtml(route.distanceMeters)} m</span></div>
      </div>
    </section>
    <div id="map" aria-label="Walking route map"></div>
    <section class="sheet">
      <div class="grabber"></div>
      <div class="sheet-head">
        <div>
          <div class="eyebrow">${escapeHtml(route.to.category || "Destination")}</div>
          <h2>${escapeHtml(route.to.name)}</h2>
          <p class="sub">${escapeHtml(route.distanceMeters)} m from ${escapeHtml(route.from.name)}</p>
        </div>
        <button class="locate" id="locateButton" type="button">Locate me</button>
      </div>
      <div class="status" id="gpsStatus">Tap Locate me to show your position and follow along.</div>
      <ol>${steps}</ol>
    </section>
  </main>
  <script id="route-data" type="application/json">${mapPayloadJson}</script>
  <script src="https://unpkg.com/maplibre-gl@5.11.0/dist/maplibre-gl.js"></script>
  <script>
    const data = JSON.parse(document.getElementById("route-data").textContent);
    const statusEl = document.getElementById("gpsStatus");
    const locateButton = document.getElementById("locateButton");

    function createStyle() {
      return {
        version: 8,
        glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
        sources: {
          "carto-light-raster": {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
              "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
              "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
              "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
            ],
            tileSize: 256,
            maxzoom: 19,
            attribution: "© OpenStreetMap contributors © CARTO"
          }
        },
        layers: [
          { id: "course-background", type: "background", paint: { "background-color": "#e7f3eb" } },
          {
            id: "carto-light-raster",
            type: "raster",
            source: "carto-light-raster",
            paint: { "raster-opacity": 0.9, "raster-saturation": -0.12 }
          }
        ]
      };
    }

    function addLayerIfMissing(map, layer) {
      if (!map.getLayer(layer.id)) map.addLayer(layer);
    }

    function addOrUpdateSource(map, id, value) {
      const source = map.getSource(id);
      if (source) {
        source.setData(value);
        return;
      }
      map.addSource(id, { type: "geojson", data: value });
    }

    function fitRoute(map) {
      const coords = data.route.features[0]?.geometry?.coordinates || [];
      if (!coords.length) return;
      const bounds = coords.reduce((box, coord) => box.extend(coord), new maplibregl.LngLatBounds(coords[0], coords[0]));
      map.fitBounds(bounds, {
        padding: { top: 185, right: 42, bottom: 280, left: 42 },
        maxZoom: 17.5,
        duration: 0
      });
    }

    function installLayers(map) {
      addOrUpdateSource(map, "course-paths", data.paths);
      addOrUpdateSource(map, "course-route", data.route);
      addOrUpdateSource(map, "course-destinations", data.destinations);
      addOrUpdateSource(map, "course-booths", data.booths);

      addLayerIfMissing(map, {
        id: "course-paths-casing",
        type: "line",
        source: "course-paths",
        paint: {
          "line-color": "#ffffff",
          "line-opacity": 0.92,
          "line-width": ["interpolate", ["linear"], ["zoom"], 14, 6, 17, 14]
        },
        layout: { "line-cap": "round", "line-join": "round" }
      });
      addLayerIfMissing(map, {
        id: "course-paths-line",
        type: "line",
        source: "course-paths",
        paint: {
          "line-color": "#64748b",
          "line-opacity": 0.72,
          "line-width": ["interpolate", ["linear"], ["zoom"], 14, 3, 17, 7]
        },
        layout: { "line-cap": "round", "line-join": "round" }
      });
      addLayerIfMissing(map, {
        id: "course-route-casing",
        type: "line",
        source: "course-route",
        paint: {
          "line-color": "#ffffff",
          "line-opacity": 0.98,
          "line-width": ["interpolate", ["linear"], ["zoom"], 14, 10, 17, 20]
        },
        layout: { "line-cap": "round", "line-join": "round" }
      });
      addLayerIfMissing(map, {
        id: "course-route-line",
        type: "line",
        source: "course-route",
        paint: {
          "line-color": "#f97316",
          "line-width": ["interpolate", ["linear"], ["zoom"], 14, 6, 17, 12]
        },
        layout: { "line-cap": "round", "line-join": "round" }
      });
      addLayerIfMissing(map, {
        id: "course-destination-points",
        type: "circle",
        source: "course-destinations",
        paint: {
          "circle-color": ["case", ["get", "selected"], "#ef4444", "#0f766e"],
          "circle-radius": ["case", ["get", "selected"], 9, 6],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3
        }
      });
      addLayerIfMissing(map, {
        id: "course-booth-points",
        type: "circle",
        source: "course-booths",
        paint: {
          "circle-color": ["case", ["get", "selected"], "#2563eb", "#334155"],
          "circle-radius": ["case", ["get", "selected"], 10, 7],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3
        }
      });
      addLayerIfMissing(map, {
        id: "course-destination-labels",
        type: "symbol",
        source: "course-destinations",
        paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 2 },
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Regular"],
          "text-offset": [0, 1.2],
          "text-size": 12,
          "text-variable-anchor": ["top", "bottom", "left", "right"],
          "text-radial-offset": 0.8,
          "text-optional": true
        }
      });
    }

    if (!window.maplibregl) {
      statusEl.textContent = "Interactive map could not load. Please refresh this page.";
    } else {
      const routeCoords = data.route.features[0]?.geometry?.coordinates || [[data.to.lng, data.to.lat]];
      const map = new maplibregl.Map({
        container: "map",
        style: createStyle(),
        center: routeCoords[0],
        zoom: 15.2,
        maxZoom: 19,
        attributionControl: false,
        pitchWithRotate: false
      });

      map.addControl(new maplibregl.AttributionControl({compact: true}), "bottom-left");
      map.addControl(new maplibregl.NavigationControl({showCompass: false}), "top-right");
      const geolocate = new maplibregl.GeolocateControl({
        fitBoundsOptions: {maxZoom: 18},
        positionOptions: {enableHighAccuracy: true},
        showAccuracyCircle: true,
        showUserLocation: true,
        trackUserLocation: true
      });
      map.addControl(geolocate, "top-right");

      map.on("load", () => {
        installLayers(map);
        fitRoute(map);
      });
      map.on("error", () => {
        statusEl.textContent = "Some map tiles did not load. The highlighted private route is still available.";
      });
      geolocate.on("geolocate", () => {
        statusEl.textContent = "GPS active. Follow the highlighted orange route.";
      });
      geolocate.on("error", () => {
        statusEl.textContent = "GPS permission was not granted. You can still follow the highlighted route.";
      });
      locateButton.addEventListener("click", () => {
        statusEl.textContent = "Requesting GPS location...";
        geolocate.trigger();
      });
    }
  </script>
</body>
</html>`;

  res.status(200)
    .set("Cache-Control", "public, max-age=60")
    .set("Content-Type", "text/html; charset=utf-8")
    .send(html);
}

function handleRequest(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const endpointPath = getEndpointPath(req);
  const query = req.query || {};

  try {
    if (endpointPath === "/" || endpointPath.endsWith("/health")) {
      sendJson(res, 200, {
        ok: true,
        service: "rbc-open-2026-routing",
        defaultBoothId: service.defaultBoothId,
        counts: service.counts,
      });
      return;
    }

    if (endpointPath.endsWith("/locations")) {
      const search = String(query.q || query.query || "").trim();
      const locations = search ?
        service.locations.filter((location) => {
          const haystack = `${location.name} ${location.category} ${location.searchAliases.join(" ")}`.toLowerCase();
          return haystack.includes(search.toLowerCase());
        }) :
        service.locations;
      sendJson(res, 200, {ok: true, count: locations.length, locations});
      return;
    }

    if (endpointPath.endsWith("/booths")) {
      sendJson(res, 200, {ok: true, count: service.booths.length, booths: service.booths});
      return;
    }

    if (endpointPath.endsWith("/directions")) {
      const to = query.to || query.destination || query.name;
      if (!to) throw new Error("Missing required query parameter: to");
      sendJson(res, 200, service.directions(query.from || query.booth, to));
      return;
    }

    if (endpointPath.endsWith("/route")) {
      const to = query.to || query.destination || query.name;
      if (!to) throw new Error("Missing required query parameter: to");
      sendRoutePage(res, service.directions(query.from || query.booth, to));
      return;
    }

    if (endpointPath.endsWith("/closest")) {
      const category = query.category || query.type;
      if (!category) throw new Error("Missing required query parameter: category");
      sendJson(res, 200, service.closest(query.from || query.booth, category));
      return;
    }

    sendJson(res, 404, {
      ok: false,
      error: "Unknown endpoint",
      endpoints: ["/health", "/locations", "/booths", "/directions", "/closest"],
    });
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      error: error.message || "Routing request failed",
    });
  }
}

exports.rbcOpenApi = onRequest(
  {
    region: "us-central1",
    cors: [
      /^https:\/\/([a-z0-9-]+\.)?chargerent\.ca$/,
      /^https:\/\/node-red-alerts\.web\.app$/,
      /^https:\/\/node-red-alerts\.firebaseapp\.com$/,
      /^http:\/\/localhost:\d+$/,
      /^http:\/\/127\.0\.0\.1:\d+$/,
    ],
    timeoutSeconds: 30,
    memory: "512MiB",
    concurrency: 80,
    minInstances: 0,
  },
  handleRequest,
);
