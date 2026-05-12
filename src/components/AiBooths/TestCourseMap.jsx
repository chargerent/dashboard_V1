import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MERGIN_COURSE_MAP_DATA } from '../../data/rbcOpenCourseMapData.js';

function createOpenStreetMapStyle() {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      'carto-light-raster': {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors © CARTO',
      },
    },
    layers: [
      {
        id: 'course-background',
        type: 'background',
        paint: {
          'background-color': '#e7f3eb',
        },
      },
      {
        id: 'carto-light-raster',
        type: 'raster',
        source: 'carto-light-raster',
        paint: {
          'raster-opacity': 0.9,
          'raster-saturation': -0.12,
        },
      },
    ],
  };
}
const WALKING_FEET_PER_MINUTE = 275;
const FEET_PER_METER = 3.28084;

const COURSE_NODES = Object.freeze(MERGIN_COURSE_MAP_DATA.nodes);
const COURSE_EDGES = Object.freeze(MERGIN_COURSE_MAP_DATA.edges.map((edge) => [
  edge.fromNodeId,
  edge.toNodeId,
  edge,
]));
const COURSE_BOOTHS = Object.freeze(MERGIN_COURSE_MAP_DATA.booths);
const COURSE_DESTINATIONS = Object.freeze(MERGIN_COURSE_MAP_DATA.destinations);
const COURSE_AREAS = Object.freeze(MERGIN_COURSE_MAP_DATA.areas || []);

function toFeatureCollection(features) {
  return {
    type: 'FeatureCollection',
    features,
  };
}

function getEdgeId(a, b) {
  return [a, b].sort().join('__');
}

function toRadians(value) {
  return value * (Math.PI / 180);
}

function getDistanceInFeet(a, b) {
  const start = COURSE_NODES[a]?.coordinates;
  const end = COURSE_NODES[b]?.coordinates;

  if (!start || !end) {
    return 0;
  }

  const earthRadiusMeters = 6371000;
  const deltaLat = toRadians(end[1] - start[1]);
  const deltaLng = toRadians(end[0] - start[0]);
  const startLat = toRadians(start[1]);
  const endLat = toRadians(end[1]);
  const haversine = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2;
  const meters = 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return Math.round(meters * FEET_PER_METER);
}

function buildGraph() {
  return COURSE_EDGES.reduce((graph, [start, end, edgeData]) => {
    const distance = Number(edgeData?.distanceFeet || getDistanceInFeet(start, end));

    return {
      ...graph,
      [start]: [...(graph[start] || []), { nodeId: end, distance }],
      [end]: [...(graph[end] || []), { nodeId: start, distance }],
    };
  }, {});
}

function findShortestRoute(startNodeId, destinationNodeId) {
  const graph = buildGraph();
  const distances = { [startNodeId]: 0 };
  const previous = {};
  const unvisited = new Set(Object.keys(COURSE_NODES));

  while (unvisited.size > 0) {
    const current = [...unvisited].reduce((best, nodeId) => {
      const currentDistance = distances[nodeId] ?? Infinity;
      const bestDistance = distances[best] ?? Infinity;
      return currentDistance < bestDistance ? nodeId : best;
    }, [...unvisited][0]);

    if (!current || distances[current] === undefined || distances[current] === Infinity) {
      break;
    }

    if (current === destinationNodeId) {
      break;
    }

    unvisited.delete(current);

    (graph[current] || []).forEach((neighbor) => {
      if (!unvisited.has(neighbor.nodeId)) {
        return;
      }

      const candidateDistance = distances[current] + neighbor.distance;

      if (candidateDistance < (distances[neighbor.nodeId] ?? Infinity)) {
        distances[neighbor.nodeId] = candidateDistance;
        previous[neighbor.nodeId] = current;
      }
    });
  }

  const route = [];
  let cursor = destinationNodeId;

  while (cursor) {
    route.unshift(cursor);

    if (cursor === startNodeId) {
      break;
    }

    cursor = previous[cursor];
  }

  if (route[0] !== startNodeId) {
    return { distance: 0, nodeIds: [] };
  }

  return {
    distance: distances[destinationNodeId] || 0,
    nodeIds: route,
  };
}

function createRouteInstructions(nodeIds) {
  if (nodeIds.length < 2) {
    return [];
  }

  if (nodeIds.length > 8) {
    const destination = COURSE_NODES[nodeIds[nodeIds.length - 1]];
    const totalDistance = nodeIds.slice(1).reduce((total, nodeId, index) => (
      total + getDistanceInFeet(nodeIds[index], nodeId)
    ), 0);

    return [
      {
        id: 'follow-highlighted-route',
        label: `Follow the highlighted guest path toward ${destination.label}`,
        distance: totalDistance,
      },
      {
        id: `arrive-${destination.id}`,
        label: `Arrive at ${destination.label}`,
        distance: 0,
      },
    ];
  }

  return nodeIds.slice(1).map((nodeId, index) => {
    const node = COURSE_NODES[nodeId];
    const isFinal = index === nodeIds.length - 2;
    const previousNodeId = nodeIds[index];
    const distance = getDistanceInFeet(previousNodeId, nodeId);

    return {
      id: `${previousNodeId}-${nodeId}`,
      label: isFinal ? `Arrive at ${node.label}` : `Continue toward ${node.label}`,
      distance,
    };
  });
}

function formatDistance(distance) {
  if (distance >= 528) {
    return `${(distance / 5280).toFixed(2)} mi`;
  }

  return `${distance} ft`;
}

function formatDuration(distance) {
  return `${Math.max(1, Math.round(distance / WALKING_FEET_PER_MINUTE))} min`;
}

function getRouteCoordinates(nodeIds) {
  return nodeIds
    .map((nodeId) => COURSE_NODES[nodeId]?.coordinates)
    .filter(Boolean);
}

function createPathFeatures(routeEdgeIds) {
  return COURSE_EDGES.filter(([start, end, edgeData]) => (
    edgeData?.visibleToGuests !== false || routeEdgeIds.has(getEdgeId(start, end))
  )).map(([start, end, edgeData]) => ({
    type: 'Feature',
    properties: {
      id: getEdgeId(start, end),
      route: routeEdgeIds.has(getEdgeId(start, end)),
      pathType: edgeData?.pathType || 'guest_path',
    },
    geometry: {
      type: 'LineString',
      coordinates: edgeData?.coordinates || [
        COURSE_NODES[start].coordinates,
        COURSE_NODES[end].coordinates,
      ],
    },
  }));
}

function createDestinationFeatures(selectedDestinationId) {
  return COURSE_DESTINATIONS.map((destination) => ({
    type: 'Feature',
    properties: {
      id: destination.id,
      label: destination.label,
      category: destination.category,
      selected: destination.id === selectedDestinationId,
    },
    geometry: {
      type: 'Point',
      coordinates: COURSE_NODES[destination.nodeId].coordinates,
    },
  }));
}

function createBoothFeatures(selectedBoothId) {
  return COURSE_BOOTHS.map((booth) => ({
    type: 'Feature',
    properties: {
      id: booth.id,
      label: booth.label,
      selected: booth.id === selectedBoothId,
    },
    geometry: {
      type: 'Point',
      coordinates: COURSE_NODES[booth.nodeId].coordinates,
    },
  }));
}

function createAreaFeatures() {
  return COURSE_AREAS.map((area) => ({
    type: 'Feature',
    properties: {
      id: area.id,
      kind: area.kind,
    },
    geometry: {
      type: 'Polygon',
      coordinates: area.coordinates,
    },
  }));
}

function createRouteFeature(routeCoordinates) {
  return toFeatureCollection(routeCoordinates.length > 1 ? [{
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: routeCoordinates,
    },
  }] : []);
}

function projectFallbackCoordinate(coordinates) {
  const allCoordinates = Object.values(COURSE_NODES).map((node) => node.coordinates);
  const longitudes = allCoordinates.map((coordinate) => coordinate[0]);
  const latitudes = allCoordinates.map((coordinate) => coordinate[1]);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const padding = 48;
  const width = 430;
  const height = 760;
  const x = padding + ((coordinates[0] - minLongitude) / (maxLongitude - minLongitude)) * (width - padding * 2);
  const y = padding + ((maxLatitude - coordinates[1]) / (maxLatitude - minLatitude)) * (height - padding * 2);

  return [x, y];
}

function getFallbackRoutePoints(routeCoordinates) {
  return routeCoordinates
    .map((coordinates) => projectFallbackCoordinate(coordinates).join(','))
    .join(' ');
}

function isCanvasLikelyBlank(map) {
  const canvas = map.getCanvas();

  if (!canvas?.width || !canvas?.height) {
    return true;
  }

  try {
    const gl = canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');

    if (!gl) {
      return true;
    }

    const samples = [
      [Math.floor(canvas.width * 0.5), Math.floor(canvas.height * 0.5)],
      [Math.floor(canvas.width * 0.35), Math.floor(canvas.height * 0.35)],
      [Math.floor(canvas.width * 0.65), Math.floor(canvas.height * 0.65)],
    ];

    return samples.every(([x, y]) => {
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return pixel[3] === 0 || (pixel[0] < 12 && pixel[1] < 12 && pixel[2] < 12);
    });
  } catch {
    return true;
  }
}

function StaticCourseFallbackMap({ routeCoordinates, selectedBooth, selectedDestination }) {
  const routePoints = getFallbackRoutePoints(routeCoordinates);
  const boothPoint = projectFallbackCoordinate(COURSE_NODES[selectedBooth.nodeId].coordinates);
  const destinationPoint = projectFallbackCoordinate(COURSE_NODES[selectedDestination.nodeId].coordinates);

  return (
    <div className="absolute inset-0 bg-[#e7f3eb]">
      <svg viewBox="0 0 430 760" role="img" aria-label="Static course route preview" className="h-full w-full">
        <rect width="430" height="760" fill="#e7f3eb" />
        <path d="M16 684 C78 610 108 518 166 442 C220 370 270 292 358 194 C390 158 410 114 420 76" fill="none" stroke="#c8e6b8" strokeWidth="92" strokeLinecap="round" opacity="0.78" />
        <path d="M22 710 C112 640 192 594 288 536 C352 498 388 432 416 346" fill="none" stroke="#bfe5ad" strokeWidth="78" strokeLinecap="round" opacity="0.66" />
        <ellipse cx="326" cy="362" rx="62" ry="34" fill="#93c5fd" opacity="0.78" />
        <ellipse cx="104" cy="260" rx="56" ry="32" fill="#86efac" opacity="0.74" />
        {COURSE_EDGES.map(([start, end, edgeData]) => {
          const [x1, y1] = projectFallbackCoordinate(COURSE_NODES[start].coordinates);
          const [x2, y2] = projectFallbackCoordinate(COURSE_NODES[end].coordinates);

          if (edgeData?.pathType === 'connector') {
            return null;
          }

          return (
            <g key={getEdgeId(start, end)}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffffff" strokeWidth="12" strokeLinecap="round" opacity="0.92" />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#64748b" strokeWidth="5" strokeLinecap="round" opacity="0.7" />
            </g>
          );
        })}
        {routePoints && (
          <>
            <polyline points={routePoints} fill="none" stroke="#ffffff" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" opacity="0.98" />
            <polyline points={routePoints} fill="none" stroke="#f97316" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
        <circle cx={boothPoint[0]} cy={boothPoint[1]} r="12" fill="#2563eb" stroke="#ffffff" strokeWidth="4" />
        <circle cx={destinationPoint[0]} cy={destinationPoint[1]} r="14" fill="#ef4444" stroke="#ffffff" strokeWidth="4" />
      </svg>
    </div>
  );
}

function addOrUpdateSource(map, id, data) {
  const source = map.getSource(id);

  if (source) {
    source.setData(data);
    return;
  }

  map.addSource(id, {
    type: 'geojson',
    data,
  });
}

function addLayerIfMissing(map, layer) {
  if (!map.getLayer(layer.id)) {
    map.addLayer(layer);
  }
}

function fitRoute(map, routeCoordinates) {
  if (!routeCoordinates.length) {
    return;
  }

  const routeMidpoint = routeCoordinates[Math.floor(routeCoordinates.length / 2)];
  map.easeTo({
    center: routeMidpoint,
    duration: 450,
    zoom: 15.85,
  });
}

function installCourseLayers(map, mapData) {
  addOrUpdateSource(map, 'course-areas', mapData.areas);
  addOrUpdateSource(map, 'course-paths', mapData.paths);
  addOrUpdateSource(map, 'course-route', mapData.route);
  addOrUpdateSource(map, 'course-destinations', mapData.destinations);
  addOrUpdateSource(map, 'course-booths', mapData.booths);

  addLayerIfMissing(map, {
    id: 'course-areas-fill',
    type: 'fill',
    source: 'course-areas',
    paint: {
      'fill-color': [
        'match',
        ['get', 'kind'],
        'water',
        '#7dd3fc',
        'green',
        '#86efac',
        '#bbf7d0',
      ],
      'fill-opacity': [
        'match',
        ['get', 'kind'],
        'water',
        0.72,
        0.52,
      ],
    },
  });

  addLayerIfMissing(map, {
    id: 'course-paths-casing',
    type: 'line',
    source: 'course-paths',
    paint: {
      'line-color': '#ffffff',
      'line-opacity': 0.92,
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        14,
        6,
        17,
        14,
      ],
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  });

  addLayerIfMissing(map, {
    id: 'course-paths-line',
    type: 'line',
    source: 'course-paths',
    paint: {
      'line-color': '#64748b',
      'line-opacity': 0.72,
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        14,
        3,
        17,
        7,
      ],
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  });

  addLayerIfMissing(map, {
    id: 'course-route-casing',
    type: 'line',
    source: 'course-route',
    paint: {
      'line-color': '#ffffff',
      'line-opacity': 0.98,
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        14,
        10,
        17,
        20,
      ],
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  });

  addLayerIfMissing(map, {
    id: 'course-route-line',
    type: 'line',
    source: 'course-route',
    paint: {
      'line-color': '#f97316',
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        14,
        6,
        17,
        12,
      ],
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  });

  addLayerIfMissing(map, {
    id: 'course-destination-points',
    type: 'circle',
    source: 'course-destinations',
    paint: {
      'circle-color': ['case', ['get', 'selected'], '#ef4444', '#0f766e'],
      'circle-radius': ['case', ['get', 'selected'], 9, 6],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  });

  addLayerIfMissing(map, {
    id: 'course-destination-labels',
    type: 'symbol',
    source: 'course-destinations',
    paint: {
      'text-color': '#0f172a',
      'text-halo-color': '#ffffff',
      'text-halo-width': 2,
    },
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Regular'],
      'text-offset': [0, 1.2],
      'text-size': 12,
      'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
      'text-radial-offset': 0.8,
      'text-optional': true,
    },
  });

  addLayerIfMissing(map, {
    id: 'course-booth-points',
    type: 'circle',
    source: 'course-booths',
    paint: {
      'circle-color': ['case', ['get', 'selected'], '#2563eb', '#334155'],
      'circle-radius': ['case', ['get', 'selected'], 10, 7],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  });

  addLayerIfMissing(map, {
    id: 'course-booth-labels',
    type: 'symbol',
    source: 'course-booths',
    paint: {
      'text-color': '#0f172a',
      'text-halo-color': '#ffffff',
      'text-halo-width': 2,
    },
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Regular'],
      'text-offset': [0, 1.25],
      'text-size': 12,
      'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
      'text-radial-offset': 0.8,
      'text-optional': true,
    },
  });
}

function GuestMapView({
  eventLabel,
  mapData,
  route,
  routeCoordinates,
  routeInstructions,
  selectedBooth,
  selectedDestination,
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const geolocateControlRef = useRef(null);
  const latestMapDataRef = useRef(mapData);
  const latestRouteCoordinatesRef = useRef(routeCoordinates);
  const [mapReady, setMapReady] = useState(false);
  const [mapIssue, setMapIssue] = useState('');
  const [showStaticFallback, setShowStaticFallback] = useState(true);
  const [mapPainted, setMapPainted] = useState(false);

  useEffect(() => {
    latestMapDataRef.current = mapData;
    latestRouteCoordinatesRef.current = routeCoordinates;
  }, [mapData, routeCoordinates]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return undefined;
    }

    const mapContainer = mapContainerRef.current;
    const map = new maplibregl.Map({
      container: mapContainer,
      style: createOpenStreetMapStyle(),
      center: [-79.9554, 43.74905],
      zoom: 15.15,
      maxZoom: 18.5,
      attributionControl: false,
      pitchWithRotate: false,
    });

    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    const geolocate = new maplibregl.GeolocateControl({
      fitBoundsOptions: { maxZoom: 17.5 },
      positionOptions: { enableHighAccuracy: true },
      showAccuracyCircle: true,
      showUserLocation: true,
      trackUserLocation: true,
    });

    geolocateControlRef.current = geolocate;
    map.addControl(geolocate, 'top-right');

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(mapContainer);

    map.on('load', () => {
      requestAnimationFrame(() => {
        map.resize();
        installCourseLayers(map, latestMapDataRef.current);
        fitRoute(map, latestRouteCoordinatesRef.current);
        setMapReady(true);

        window.setTimeout(() => {
        if (isCanvasLikelyBlank(map)) {
          setMapIssue('MapLibre is not painting in this browser, so this preview is using the course fallback.');
          setShowStaticFallback(true);
          setMapPainted(false);
          return;
        }

        setMapIssue('');
        setShowStaticFallback(false);
        setMapPainted(true);
      }, 900);
      });
    });

    map.on('error', (event) => {
      const message = String(event?.error?.message || '');
      const isTileFetchError = message.includes('Failed to fetch') ||
        message.includes('net::ERR_FAILED') ||
        message.includes('Could not load image');

      if (message && !isTileFetchError) {
        setMapIssue('MapLibre reported a map rendering issue.');
        setShowStaticFallback(true);
        setMapPainted(false);
      }
    });

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      geolocateControlRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapReady || !map.isStyleLoaded()) {
      return;
    }

    map.resize();
    installCourseLayers(map, mapData);
    fitRoute(map, routeCoordinates);
  }, [mapData, mapReady, routeCoordinates]);

  const handleUseLocation = () => {
    if (geolocateControlRef.current) {
      geolocateControlRef.current.trigger();
    }
  };

  return (
    <div className="relative h-[760px] overflow-hidden bg-slate-950 md:h-[820px]">
      {showStaticFallback && (
        <div className="pointer-events-none absolute inset-0" style={{ zIndex: 1 }}>
          <StaticCourseFallbackMap
            routeCoordinates={routeCoordinates}
            selectedBooth={selectedBooth}
            selectedDestination={selectedDestination}
          />
        </div>
      )}
      <div
        ref={mapContainerRef}
        className="absolute inset-0 bg-transparent transition-opacity duration-300"
        style={{
          minHeight: 760,
          opacity: mapPainted ? 1 : 0,
          zIndex: 2,
        }}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-slate-950/35 to-transparent p-3">
        <div className="pointer-events-auto rounded-md bg-white/95 p-4 shadow-lg backdrop-blur">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700">
            {eventLabel}
          </p>
          <h1 className="mt-1 text-2xl font-semibold leading-tight text-slate-950">
            {selectedDestination.label}
          </h1>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-md bg-slate-100 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">From</p>
              <p className="mt-1 truncate text-xs font-semibold text-slate-900">{selectedBooth.label}</p>
            </div>
            <div className="rounded-md bg-slate-100 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Walk</p>
              <p className="mt-1 text-xs font-semibold text-slate-900">{formatDuration(route.distance)}</p>
            </div>
            <div className="rounded-md bg-slate-100 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Distance</p>
              <p className="mt-1 text-xs font-semibold text-slate-900">{formatDistance(route.distance)}</p>
            </div>
          </div>
        </div>
      </div>

      {mapIssue && (
        <div className="absolute left-3 right-3 top-40 z-20 rounded-md bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 shadow">
          {mapIssue}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-10 rounded-t-md bg-white p-4 shadow-[0_-18px_42px_rgba(15,23,42,0.22)]">
        <div className="mx-auto h-1 w-12 rounded-full bg-slate-300" />
        <div className="mt-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-700">
              {selectedDestination.category}
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold text-slate-950">{selectedDestination.label}</h2>
            <p className="mt-1 text-sm font-medium text-slate-600">
              {formatDistance(route.distance)} from {selectedBooth.label}
            </p>
          </div>
          <button
            type="button"
            onClick={handleUseLocation}
            className="shrink-0 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700"
          >
            Locate me
          </button>
        </div>

        <ol className="mt-4 max-h-52 space-y-3 overflow-y-auto pr-1">
          {routeInstructions.map((instruction, index) => (
            <li key={instruction.id} className="grid grid-cols-[30px_minmax(0,1fr)] gap-3">
              <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-700">
                {index + 1}
              </span>
              <span>
                <span className="block text-sm font-semibold leading-5 text-slate-950">{instruction.label}</span>
                <span className="mt-0.5 block text-xs font-medium text-slate-500">
                  {formatDistance(instruction.distance)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default function TestCourseMap({ eventLabel = 'Unsaved event' }) {
  const [selectedBoothId, setSelectedBoothId] = useState(COURSE_BOOTHS[0].id);
  const [selectedDestinationId, setSelectedDestinationId] = useState(COURSE_DESTINATIONS[0].id);

  const selectedBooth = COURSE_BOOTHS.find((booth) => booth.id === selectedBoothId) || COURSE_BOOTHS[0];
  const selectedDestination = COURSE_DESTINATIONS.find((destination) => (
    destination.id === selectedDestinationId
  )) || COURSE_DESTINATIONS[0];

  const route = useMemo(() => (
    findShortestRoute(selectedBooth.nodeId, selectedDestination.nodeId)
  ), [selectedBooth.nodeId, selectedDestination.nodeId]);
  const routeInstructions = useMemo(() => createRouteInstructions(route.nodeIds), [route.nodeIds]);
  const routeCoordinates = useMemo(() => getRouteCoordinates(route.nodeIds), [route.nodeIds]);
  const routeEdgeIds = useMemo(() => new Set(route.nodeIds.slice(1).map((nodeId, index) => (
    getEdgeId(route.nodeIds[index], nodeId)
  ))), [route.nodeIds]);
  const mapData = useMemo(() => ({
    areas: toFeatureCollection(createAreaFeatures()),
    booths: toFeatureCollection(createBoothFeatures(selectedBooth.id)),
    destinations: toFeatureCollection(createDestinationFeatures(selectedDestination.id)),
    paths: toFeatureCollection(createPathFeatures(routeEdgeIds)),
    route: createRouteFeature(routeCoordinates),
  }), [routeCoordinates, routeEdgeIds, selectedBooth.id, selectedDestination.id]);
  const guestPath = `/map?from=${encodeURIComponent(selectedBooth.id)}&to=${encodeURIComponent(selectedDestination.id)}`;

  return (
    <section className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(280px,0.42fr)_minmax(360px,0.58fr)]">
        <div className="space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-md sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Course Map</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Guest map test</h2>

            <div className="mt-6 grid gap-4">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700">QR Start</span>
                <select
                  value={selectedBoothId}
                  onChange={(event) => setSelectedBoothId(event.target.value)}
                  className="mt-2 w-full rounded-md border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                >
                  {COURSE_BOOTHS.map((booth) => (
                    <option key={booth.id} value={booth.id}>
                      {booth.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700">Destination</span>
                <select
                  value={selectedDestinationId}
                  onChange={(event) => setSelectedDestinationId(event.target.value)}
                  className="mt-2 w-full rounded-md border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                >
                  {COURSE_DESTINATIONS.map((destination) => (
                    <option key={destination.id} value={destination.id}>
                      {destination.label} - {destination.category}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                <div className="rounded-md bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Distance</p>
                  <p className="mt-2 text-xl font-semibold text-slate-900">{formatDistance(route.distance)}</p>
                </div>
                <div className="rounded-md bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Walk Time</p>
                  <p className="mt-2 text-xl font-semibold text-slate-900">{formatDuration(route.distance)}</p>
                </div>
                <div className="rounded-md bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Steps</p>
                  <p className="mt-2 text-xl font-semibold text-slate-900">{routeInstructions.length}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-md sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">QR Link</p>
            <p className="mt-4 break-all rounded-md bg-slate-950 px-4 py-3 font-mono text-sm font-semibold text-cyan-100">
              {guestPath}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <div className="rounded-md bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Start zone</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">{selectedBooth.zone}</p>
              </div>
              <div className="rounded-md bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Destination type</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">{selectedDestination.category}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[430px] overflow-hidden rounded-[34px] border-[10px] border-slate-950 bg-slate-950 shadow-2xl">
          <GuestMapView
            eventLabel={eventLabel}
            mapData={mapData}
            route={route}
            routeCoordinates={routeCoordinates}
            routeInstructions={routeInstructions}
            selectedBooth={selectedBooth}
            selectedDestination={selectedDestination}
          />
        </div>
      </div>
    </section>
  );
}
