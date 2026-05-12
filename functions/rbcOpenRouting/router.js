"use strict";

const fs = require("node:fs");
const path = require("node:path");

const EARTH_RADIUS_M = 6371008.8;
const DEFAULT_BOOTH_ID = "CA9000";
const DEFAULT_PUBLIC_BASE_URL = "https://chargerent.ca/rbc-open-2026";
const GRAPH_COORD_PRECISION = 7;
const NEARBY_NODE_CONNECT_METERS = 6;
const WALKING_METERS_PER_MINUTE = 80;

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toSlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCategory(value) {
  const slug = toSlug(value);
  const aliases = {
    restroom: "bathroom",
    restrooms: "bathroom",
    bathroom: "bathroom",
    bathrooms: "bathroom",
    washroom: "bathroom",
    washrooms: "bathroom",
    concession: "food_drinks",
    concessions: "food_drinks",
    food: "food_drinks",
    drinks: "food_drinks",
    merch: "merchandise",
    firstaid: "first_aid",
    "first-aid": "first_aid",
    tee: "hole_tee",
    green: "hole_green",
  };
  return aliases[slug] || slug.replace(/-/g, "_");
}

function parseBool(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "y"].includes(normalized);
}

function coordinatesFromPointFeature(feature) {
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {lat, lng};
}

function metersPerDegreeLat() {
  return 111320;
}

function metersPerDegreeLng(lat) {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

function toMeters(point, originLat) {
  return {
    x: point.lng * metersPerDegreeLng(originLat),
    y: point.lat * metersPerDegreeLat(),
  };
}

function haversineMeters(a, b) {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearingDegrees(a, b) {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function cardinalDirection(bearing) {
  const labels = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
  return labels[Math.round(bearing / 45) % 8];
}

function turnDirection(previousBearing, nextBearing) {
  let delta = ((nextBearing - previousBearing + 540) % 360) - 180;
  if (Math.abs(delta) < 30) return "continue";
  if (Math.abs(delta) > 150) return "make a sharp turn";
  return delta > 0 ? "turn right" : "turn left";
}

function coordKey(point) {
  return `${Number(point.lng).toFixed(GRAPH_COORD_PRECISION)},${Number(point.lat).toFixed(GRAPH_COORD_PRECISION)}`;
}

function addEdge(graph, fromKey, toKey, weight) {
  if (!graph.has(fromKey)) graph.set(fromKey, []);
  if (!graph.has(toKey)) graph.set(toKey, []);
  graph.get(fromKey).push({to: toKey, weight});
  graph.get(toKey).push({to: fromKey, weight});
}

function featureLineStrings(feature) {
  const geometry = feature?.geometry || {};
  if (geometry.type === "LineString") return [geometry.coordinates || []];
  if (geometry.type === "MultiLineString") return geometry.coordinates || [];
  return [];
}

function buildBaseGraph(walkingPaths) {
  const graph = new Map();
  const nodes = new Map();
  const segments = [];

  for (const feature of walkingPaths.features || []) {
    const props = feature.properties || {};
    const oneWay = parseBool(props.one_way);
    const lineName = props.name || props.path_id || "Mapped walkway";
    for (const coords of featureLineStrings(feature)) {
      const points = coords
        .map((coord) => ({lng: Number(coord[0]), lat: Number(coord[1])}))
        .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat));
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1];
        const b = points[i];
        const aKey = coordKey(a);
        const bKey = coordKey(b);
        const weight = haversineMeters(a, b);
        if (weight <= 0) continue;
        nodes.set(aKey, a);
        nodes.set(bKey, b);
        if (!graph.has(aKey)) graph.set(aKey, []);
        if (!graph.has(bKey)) graph.set(bKey, []);
        graph.get(aKey).push({to: bKey, weight});
        if (!oneWay) graph.get(bKey).push({to: aKey, weight});
        segments.push({a, b, aKey, bKey, lineName});
      }
    }
  }

  const entries = Array.from(nodes.entries());
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [aKey, a] = entries[i];
      const [bKey, b] = entries[j];
      const distance = haversineMeters(a, b);
      if (distance > 0 && distance <= NEARBY_NODE_CONNECT_METERS) {
        addEdge(graph, aKey, bKey, distance);
      }
    }
  }

  return {graph, nodes, segments};
}

function projectPointToSegment(point, a, b) {
  const originLat = (point.lat + a.lat + b.lat) / 3;
  const p = toMeters(point, originLat);
  const am = toMeters(a, originLat);
  const bm = toMeters(b, originLat);
  const dx = bm.x - am.x;
  const dy = bm.y - am.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - am.x) * dx + (p.y - am.y) * dy) / lengthSq));
  const projectedMeters = {
    x: am.x + t * dx,
    y: am.y + t * dy,
  };
  const projected = {
    lng: projectedMeters.x / metersPerDegreeLng(originLat),
    lat: projectedMeters.y / metersPerDegreeLat(),
  };
  return {
    point: projected,
    t,
    distanceMeters: haversineMeters(point, projected),
    distanceToA: haversineMeters(projected, a),
    distanceToB: haversineMeters(projected, b),
  };
}

function snapToNetwork(point, segments) {
  let best = null;
  for (const segment of segments) {
    const projection = projectPointToSegment(point, segment.a, segment.b);
    if (!best || projection.distanceMeters < best.distanceMeters) {
      best = {...projection, segment};
    }
  }
  if (!best) throw new Error("No walking path segments are available.");
  return best;
}

class PriorityQueue {
  constructor() {
    this.items = [];
  }

  push(key, priority) {
    this.items.push({key, priority});
    this.items.sort((a, b) => a.priority - b.priority);
  }

  shift() {
    return this.items.shift();
  }

  get length() {
    return this.items.length;
  }
}

function dijkstra(graph, startKey, endKey) {
  const distances = new Map([[startKey, 0]]);
  const previous = new Map();
  const queue = new PriorityQueue();
  queue.push(startKey, 0);

  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    if (current.priority !== distances.get(current.key)) continue;
    if (current.key === endKey) break;
    for (const edge of graph.get(current.key) || []) {
      const nextDistance = current.priority + edge.weight;
      if (nextDistance < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, nextDistance);
        previous.set(edge.to, current.key);
        queue.push(edge.to, nextDistance);
      }
    }
  }

  if (!distances.has(endKey)) {
    return null;
  }

  const keys = [];
  let cursor = endKey;
  while (cursor) {
    keys.push(cursor);
    if (cursor === startKey) break;
    cursor = previous.get(cursor);
  }
  keys.reverse();
  return {distanceMeters: distances.get(endKey), keys};
}

function cloneGraph(baseGraph) {
  const graph = new Map();
  for (const [key, edges] of baseGraph.entries()) {
    graph.set(key, edges.map((edge) => ({...edge})));
  }
  return graph;
}

function routeOnNetwork(baseNetwork, origin, destination) {
  const graph = cloneGraph(baseNetwork.graph);
  const nodes = new Map(baseNetwork.nodes);
  const originSnap = snapToNetwork(origin, baseNetwork.segments);
  const destinationSnap = snapToNetwork(destination, baseNetwork.segments);
  const originKey = "__origin__";
  const destinationKey = "__destination__";

  nodes.set(originKey, originSnap.point);
  nodes.set(destinationKey, destinationSnap.point);
  graph.set(originKey, []);
  graph.set(destinationKey, []);

  addEdge(graph, originKey, originSnap.segment.aKey, originSnap.distanceToA);
  addEdge(graph, originKey, originSnap.segment.bKey, originSnap.distanceToB);
  addEdge(graph, destinationKey, destinationSnap.segment.aKey, destinationSnap.distanceToA);
  addEdge(graph, destinationKey, destinationSnap.segment.bKey, destinationSnap.distanceToB);

  const route = dijkstra(graph, originKey, destinationKey);
  if (!route) {
    throw new Error("No route found on the mapped walking path network.");
  }

  const coordinates = route.keys
    .map((key) => nodes.get(key))
    .filter(Boolean)
    .map((point) => [point.lng, point.lat]);

  return {
    distanceMeters: route.distanceMeters,
    coordinates,
    originSnapDistanceMeters: originSnap.distanceMeters,
    destinationSnapDistanceMeters: destinationSnap.distanceMeters,
  };
}

function splitAliasText(text) {
  return String(text || "")
    .split(/[;,|]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function addAlias(map, alias, id) {
  const key = toSlug(alias);
  if (key && !map.has(key)) map.set(key, id);
}

function ordinalSuffix(number) {
  const value = Math.abs(Number(number));
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return "th";
  const last = value % 10;
  if (last === 1) return "st";
  if (last === 2) return "nd";
  if (last === 3) return "rd";
  return "th";
}

function holeNumberWords(number) {
  const words = {
    1: ["first", "one"],
    2: ["second", "two"],
    3: ["third", "three"],
    4: ["fourth", "four"],
    5: ["fifth", "five"],
    6: ["sixth", "six"],
    7: ["seventh", "seven"],
    8: ["eighth", "eight"],
    9: ["ninth", "nine"],
    10: ["tenth", "ten"],
    11: ["eleventh", "eleven"],
    12: ["twelfth", "twelve"],
    13: ["thirteenth", "thirteen"],
    14: ["fourteenth", "fourteen"],
    15: ["fifteenth", "fifteen"],
    16: ["sixteenth", "sixteen"],
    17: ["seventeenth", "seventeen"],
    18: ["eighteenth", "eighteen"],
  };
  return words[number] || [];
}

function holeAliases(location) {
  const aliases = [];
  const hole = Number(location.holeNumber);
  if (!Number.isFinite(hole)) return aliases;
  const ordinal = `${hole}${ordinalSuffix(hole)}`;
  const spokenNumbers = holeNumberWords(hole);
  if (location.category === "hole_tee") {
    aliases.push(
      `Hole ${hole} Tee`,
      `${hole} Tee`,
      `Tee ${hole}`,
      `${ordinal} Tee`,
    );
    for (const word of spokenNumbers) {
      aliases.push(`${word} Tee`, `Tee ${word}`, `Hole ${word} Tee`);
    }
  }
  if (location.category === "hole_green") {
    aliases.push(
      `Hole ${hole} Green`,
      `${hole} Green`,
      `Green ${hole}`,
      `${ordinal} Green`,
    );
    for (const word of spokenNumbers) {
      aliases.push(`${word} Green`, `Green ${word}`, `Hole ${word} Green`);
    }
  }
  return aliases;
}

function normalizeLocationFeature(feature) {
  const props = feature.properties || {};
  const coords = coordinatesFromPointFeature(feature);
  if (!coords || !props.name) return null;
  const category = normalizeCategory(props.category);
  const id = toSlug(props.qr_slug || props.name);
  return {
    id,
    name: String(props.name).trim(),
    category,
    status: props.status || "",
    holeNumber: props.hole_number ?? null,
    searchAliases: splitAliasText(props.search_aliases),
    arrivalNotes: props.arrival_notes || "",
    visibleToGuests: props.visible_to_guests === undefined ? true : parseBool(props.visible_to_guests),
    priority: Number(props.priority || 0),
    lat: coords.lat,
    lng: coords.lng,
  };
}

function normalizeBoothFeature(feature) {
  const props = feature.properties || {};
  const coords = coordinatesFromPointFeature(feature);
  if (!coords) return null;
  const id = String(props.booth_id || props.name || DEFAULT_BOOTH_ID).trim();
  return {
    id,
    slug: toSlug(id),
    name: String(props.name || id).trim(),
    status: props.status || "",
    qrBaseUrl: props.qr_base_url || "",
    visibleToGuests: props.visible_to_guests === undefined ? true : parseBool(props.visible_to_guests),
    lat: coords.lat,
    lng: coords.lng,
  };
}

function buildIndexes(locations, booths) {
  const locationById = new Map();
  const locationAliasToId = new Map();
  for (const location of locations) {
    locationById.set(location.id, location);
    addAlias(locationAliasToId, location.id, location.id);
    addAlias(locationAliasToId, location.name, location.id);
    for (const alias of location.searchAliases) addAlias(locationAliasToId, alias, location.id);
    for (const alias of holeAliases(location)) addAlias(locationAliasToId, alias, location.id);
  }

  const boothById = new Map();
  const boothAliasToId = new Map();
  for (const booth of booths) {
    boothById.set(booth.id, booth);
    addAlias(boothAliasToId, booth.id, booth.id);
    addAlias(boothAliasToId, booth.slug, booth.id);
    addAlias(boothAliasToId, booth.name, booth.id);
  }

  return {locationById, locationAliasToId, boothById, boothAliasToId};
}

function findByAlias(aliasMap, byIdMap, query) {
  const direct = aliasMap.get(toSlug(query));
  if (direct) return byIdMap.get(direct);
  const needle = toSlug(query);
  if (!needle) return null;
  for (const [alias, id] of aliasMap.entries()) {
    if (alias.includes(needle) || needle.includes(alias)) return byIdMap.get(id);
  }
  return null;
}

function buildPublicRouteUrl(publicBaseUrl, fromId, destinationId) {
  const params = new URLSearchParams({from: fromId, to: destinationId});
  return `${publicBaseUrl.replace(/\/$/, "")}/route?${params.toString()}`;
}

function totalDistance(points) {
  let distance = 0;
  for (let i = 1; i < points.length; i += 1) {
    distance += haversineMeters(points[i - 1], points[i]);
  }
  return distance;
}

function perpendicularDistanceMeters(point, lineStart, lineEnd) {
  const projection = projectPointToSegment(point, lineStart, lineEnd);
  return projection.distanceMeters;
}

function simplifyPoints(points, toleranceMeters = 8) {
  if (points.length <= 2) return points;

  let maxDistance = 0;
  let splitIndex = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistanceMeters(points[i], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = i;
    }
  }

  if (maxDistance <= toleranceMeters) {
    return [first, last];
  }

  const left = simplifyPoints(points.slice(0, splitIndex + 1), toleranceMeters);
  const right = simplifyPoints(points.slice(splitIndex), toleranceMeters);
  return left.slice(0, -1).concat(right);
}

function buildSteps(routeCoordinates, destinationName) {
  const points = simplifyPoints(routeCoordinates.map(([lng, lat]) => ({lat, lng})));
  if (points.length < 2) {
    return [`Arrive at ${destinationName}.`];
  }

  const steps = [];
  let segmentStartIndex = 0;
  let previousBearing = bearingDegrees(points[0], points[1]);
  steps.push(`Head ${cardinalDirection(previousBearing)} on the mapped walkway.`);

  for (let i = 2; i < points.length; i += 1) {
    const nextBearing = bearingDegrees(points[i - 1], points[i]);
    const turn = turnDirection(previousBearing, nextBearing);
    if (turn !== "continue") {
      const distance = Math.round(totalDistance(points.slice(segmentStartIndex, i)));
      if (distance >= 60) {
        steps.push(`Continue about ${distance} m, then ${turn}.`);
        segmentStartIndex = i - 1;
      }
    }
    previousBearing = nextBearing;
  }

  const finalDistance = Math.round(totalDistance(points.slice(segmentStartIndex)));
  if (finalDistance >= 8) {
    steps.push(`Continue about ${finalDistance} m.`);
  }
  steps.push(`Arrive at ${destinationName}.`);
  return steps;
}

function createRoutingService(options = {}) {
  const dataDir = options.dataDir || path.join(__dirname, "..", "data");
  const publicBaseUrl = options.publicBaseUrl || DEFAULT_PUBLIC_BASE_URL;
  const walkingPaths = loadJson(path.join(dataDir, "walking_paths.geojson"));
  const courseLocations = loadJson(path.join(dataDir, "course_locations.geojson"));
  const boothsGeojson = loadJson(path.join(dataDir, "booths.geojson"));
  const locations = (courseLocations.features || []).map(normalizeLocationFeature).filter(Boolean);
  const booths = (boothsGeojson.features || []).map(normalizeBoothFeature).filter(Boolean);
  const indexes = buildIndexes(locations, booths);
  const network = buildBaseGraph(walkingPaths);

  function resolveBooth(query = DEFAULT_BOOTH_ID) {
    return findByAlias(indexes.boothAliasToId, indexes.boothById, query) ||
      indexes.boothById.get(DEFAULT_BOOTH_ID) ||
      booths[0] ||
      null;
  }

  function resolveLocation(query) {
    return findByAlias(indexes.locationAliasToId, indexes.locationById, query);
  }

  function directions(fromQuery, toQuery) {
    const from = resolveBooth(fromQuery || DEFAULT_BOOTH_ID);
    if (!from) throw new Error(`Unknown booth: ${fromQuery || DEFAULT_BOOTH_ID}`);
    const to = resolveLocation(toQuery);
    if (!to) throw new Error(`Unknown destination: ${toQuery}`);
    const route = routeOnNetwork(network, from, to);
    const distanceMeters = Math.round(route.distanceMeters);
    return {
      ok: true,
      from,
      to,
      distanceMeters,
      estimatedWalkMinutes: Math.max(1, Math.round(distanceMeters / WALKING_METERS_PER_MINUTE)),
      snap: {
        originMetersFromPath: Math.round(route.originSnapDistanceMeters),
        destinationMetersFromPath: Math.round(route.destinationSnapDistanceMeters),
      },
      route: {
        type: "Feature",
        properties: {
          from: from.id,
          to: to.id,
          distanceMeters,
        },
        geometry: {
          type: "LineString",
          coordinates: route.coordinates,
        },
      },
      steps: buildSteps(route.coordinates, to.name),
      url: buildPublicRouteUrl(publicBaseUrl, from.id, to.id),
    };
  }

  function closest(fromQuery, categoryQuery) {
    const from = resolveBooth(fromQuery || DEFAULT_BOOTH_ID);
    if (!from) throw new Error(`Unknown booth: ${fromQuery || DEFAULT_BOOTH_ID}`);
    const category = normalizeCategory(categoryQuery);
    const candidates = locations.filter((location) => location.visibleToGuests && location.category === category);
    if (!candidates.length) throw new Error(`No mapped locations found for category: ${categoryQuery}`);
    let best = null;
    for (const candidate of candidates) {
      try {
        const result = directions(from.id, candidate.name);
        if (!best || result.distanceMeters < best.distanceMeters) best = result;
      } catch (error) {
        // Keep evaluating other candidates if one point cannot route.
      }
    }
    if (!best) throw new Error(`No route found for category: ${categoryQuery}`);
    return {...best, category};
  }

  return {
    defaultBoothId: DEFAULT_BOOTH_ID,
    publicBaseUrl,
    counts: {
      booths: booths.length,
      locations: locations.length,
      pathSegments: network.segments.length,
      graphNodes: network.nodes.size,
    },
    booths,
    locations,
    walkingPaths,
    resolveBooth,
    resolveLocation,
    directions,
    closest,
  };
}

module.exports = {
  DEFAULT_BOOTH_ID,
  createRoutingService,
  normalizeCategory,
  toSlug,
};
