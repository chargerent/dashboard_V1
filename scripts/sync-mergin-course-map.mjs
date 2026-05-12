import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PROJECT_DIR = '/Users/georgegazelian/Projects/Mergin Template/RBC Open 2026';
const PROJECT_DIR = process.env.MERGIN_PROJECT_DIR || DEFAULT_PROJECT_DIR;
const GPKG_PATH = process.env.MERGIN_GPKG_PATH || path.join(PROJECT_DIR, 'data', 'rbc_open_2026.gpkg');
const MODULE_OUTPUT_PATH = path.resolve('src/data/rbcOpenCourseMapData.js');
const PUBLIC_OUTPUT_PATH = path.resolve('public/course-map/rbc-open-2026/course-map.json');
const FUNCTION_ROUTING_DATA_DIR = path.resolve('functions/rbcOpenRouting/data');
const FEET_PER_METER = 3.28084;
const PATH_VERTEX_SNAP_FEET = 55;
const JUNCTION_SNAP_FEET = 85;

function sqliteJson(query) {
  const output = execFileSync('sqlite3', ['-json', GPKG_PATH, query], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  return output.trim() ? JSON.parse(output) : [];
}

function readUInt32(buffer, offset, littleEndian) {
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function readDouble(buffer, offset, littleEndian) {
  return littleEndian ? buffer.readDoubleLE(offset) : buffer.readDoubleBE(offset);
}

function parseGpkgGeometry(hex) {
  if (!hex) {
    return null;
  }

  const buffer = Buffer.from(hex, 'hex');

  if (buffer.toString('ascii', 0, 2) !== 'GP') {
    throw new Error('Invalid GeoPackage geometry header.');
  }

  const flags = buffer[3];
  const envelopeCode = (flags >> 1) & 7;
  const envelopeLengths = [0, 32, 48, 48, 64];
  let offset = 8 + (envelopeLengths[envelopeCode] || 0);
  const wkbLittleEndian = buffer[offset] === 1;
  const rawType = readUInt32(buffer, offset + 1, wkbLittleEndian);
  const geometryType = rawType % 1000;

  offset += 5;

  if (geometryType === 1) {
    return {
      type: 'Point',
      coordinates: [
        readDouble(buffer, offset, wkbLittleEndian),
        readDouble(buffer, offset + 8, wkbLittleEndian),
      ],
    };
  }

  if (geometryType === 2) {
    const count = readUInt32(buffer, offset, wkbLittleEndian);
    offset += 4;

    const coordinates = [];
    for (let index = 0; index < count; index += 1) {
      coordinates.push([
        readDouble(buffer, offset, wkbLittleEndian),
        readDouble(buffer, offset + 8, wkbLittleEndian),
      ]);
      offset += 16;
    }

    return {
      type: 'LineString',
      coordinates,
    };
  }

  throw new Error(`Unsupported GeoPackage geometry type ${rawType}.`);
}

function createFeatureCollection(name, rows) {
  return {
    type: 'FeatureCollection',
    name,
    crs: {
      type: 'name',
      properties: {
        name: 'urn:ogc:def:crs:OGC:1.3:CRS84',
      },
    },
    features: rows
      .map((row) => {
        const geometry = parseGpkgGeometry(row.geom_hex);
        if (!geometry) {
          return null;
        }

        const properties = { ...row };
        delete properties.geom_hex;

        return {
          type: 'Feature',
          properties,
          geometry,
        };
      })
      .filter(Boolean),
  };
}

function slugify(value, fallback) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return slug || fallback;
}

function toBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  return Number(value) !== 0;
}

function toRadians(value) {
  return value * (Math.PI / 180);
}

function getDistanceInFeet(start, end) {
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

function findNearestNode(coordinates, nodes, filter = () => true) {
  return Object.values(nodes)
    .filter((node) => filter(node))
    .reduce((best, node) => {
      const distance = getDistanceInFeet(coordinates, node.coordinates);
      return !best || distance < best.distance ? { node, distance } : best;
    }, null);
}

function createRoutingGeojson() {
  const locationRows = sqliteJson(`
    select *, hex(geom) as geom_hex
    from course_locations
    where geom is not null
      and coalesce(visible_to_guests, 1) != 0
      and coalesce(status, '') != 'retired'
    order by fid
  `);
  const boothRows = sqliteJson(`
    select *, hex(geom) as geom_hex
    from booths
    where geom is not null
      and coalesce(visible_to_guests, 1) != 0
      and coalesce(status, '') != 'retired'
    order by fid
  `);
  const pathRows = sqliteJson(`
    select *, hex(geom) as geom_hex
    from walking_paths
    where geom is not null
      and coalesce(visible_to_guests, 1) != 0
      and coalesce(status, '') != 'retired'
    order by fid
  `);

  return {
    course_locations: createFeatureCollection('course_locations', locationRows),
    booths: createFeatureCollection('booths', boothRows),
    walking_paths: createFeatureCollection('walking_paths', pathRows),
  };
}

function addNode(nodes, id, label, coordinates, extra = {}) {
  nodes[id] = {
    id,
    label,
    coordinates,
    ...extra,
  };
}

function createCourseData() {
  const locationRows = sqliteJson(`
    select *, hex(geom) as geom_hex
    from course_locations
    where geom is not null
      and coalesce(visible_to_guests, 1) != 0
      and coalesce(status, '') != 'retired'
    order by fid
  `);
  const boothRows = sqliteJson(`
    select *, hex(geom) as geom_hex
    from booths
    where geom is not null
      and coalesce(visible_to_guests, 1) != 0
      and coalesce(status, '') != 'retired'
    order by fid
  `);
  const junctionRows = sqliteJson(`
    select *, hex(geom) as geom_hex
    from path_junctions
    where geom is not null
      and coalesce(status, '') != 'retired'
    order by fid
  `);
  const pathRows = sqliteJson(`
    select *, hex(geom) as geom_hex
    from walking_paths
    where geom is not null
      and coalesce(visible_to_guests, 1) != 0
      and coalesce(status, '') != 'retired'
    order by fid
  `);

  const nodes = {};
  const edges = [];
  const pathVertexNodeIds = new Set();
  const existingEdgeIds = new Set();

  function addEdge(edge) {
    const edgeKey = [edge.fromNodeId, edge.toNodeId].sort().join('__');

    if (existingEdgeIds.has(edgeKey)) {
      return;
    }

    existingEdgeIds.add(edgeKey);
    edges.push(edge);
  }

  for (const row of junctionRows) {
    const geometry = parseGpkgGeometry(row.geom_hex);
    if (geometry?.type !== 'Point') {
      continue;
    }

    addNode(
      nodes,
      `junction-${row.fid}`,
      row.name || `Junction ${row.fid}`,
      geometry.coordinates,
      {
        kind: 'junction',
        sourceId: row.junction_id || String(row.fid),
        status: row.status || '',
        accessible: toBoolean(row.accessible, true),
      }
    );
  }

  for (const row of pathRows) {
    const geometry = parseGpkgGeometry(row.geom_hex);
    if (geometry?.type !== 'LineString' || geometry.coordinates.length < 2) {
      continue;
    }

    const vertexNodeIds = geometry.coordinates.map((coordinate, index) => {
      const id = `path-${row.fid}-v${index}`;
      addNode(nodes, id, row.name || `Path ${row.fid}`, coordinate, {
        kind: 'path_vertex',
        pathId: row.path_id || String(row.fid),
      });
      pathVertexNodeIds.add(id);
      return id;
    });

    for (let index = 1; index < vertexNodeIds.length; index += 1) {
      const fromNodeId = vertexNodeIds[index - 1];
      const toNodeId = vertexNodeIds[index];
      const from = nodes[fromNodeId].coordinates;
      const to = nodes[toNodeId].coordinates;

      addEdge({
        id: `path-${row.fid}-segment-${index}`,
        label: row.name || `Path ${row.fid}`,
        fromNodeId,
        toNodeId,
        coordinates: [from, to],
        distanceFeet: getDistanceInFeet(from, to),
        pathType: row.path_type || 'guest_path',
        status: row.status || '',
        accessible: toBoolean(row.accessible, true),
        visibleToGuests: toBoolean(row.visible_to_guests, true),
        oneWay: toBoolean(row.one_way, false),
        sourcePathId: row.path_id || String(row.fid),
      });
    }
  }

  const pathVertexIds = [...pathVertexNodeIds];
  for (let leftIndex = 0; leftIndex < pathVertexIds.length; leftIndex += 1) {
    const leftNode = nodes[pathVertexIds[leftIndex]];
    let best = null;

    for (let rightIndex = 0; rightIndex < pathVertexIds.length; rightIndex += 1) {
      if (leftIndex === rightIndex) {
        continue;
      }

      const rightNode = nodes[pathVertexIds[rightIndex]];
      if (leftNode.pathId === rightNode.pathId) {
        continue;
      }

      const distance = getDistanceInFeet(leftNode.coordinates, rightNode.coordinates);
      if (distance > 0 && distance <= PATH_VERTEX_SNAP_FEET && (!best || distance < best.distance)) {
        best = { node: rightNode, distance };
      }
    }

    if (best) {
      addEdge({
        id: `snap-${leftNode.id}-${best.node.id}`,
        label: 'Auto-snapped path connector',
        fromNodeId: leftNode.id,
        toNodeId: best.node.id,
        coordinates: [leftNode.coordinates, best.node.coordinates],
        distanceFeet: best.distance,
        pathType: 'snap_connector',
        status: 'derived',
        accessible: true,
        visibleToGuests: false,
        oneWay: false,
      });
    }
  }

  for (const node of Object.values(nodes).filter((item) => item.kind === 'junction')) {
    const nearest = findNearestNode(node.coordinates, nodes, (candidate) => pathVertexNodeIds.has(candidate.id));
    if (nearest && nearest.distance <= JUNCTION_SNAP_FEET) {
      addEdge({
        id: `junction-${node.id}-connector`,
        label: `${node.label} connector`,
        fromNodeId: node.id,
        toNodeId: nearest.node.id,
        coordinates: [node.coordinates, nearest.node.coordinates],
        distanceFeet: nearest.distance,
        pathType: 'junction_connector',
        status: 'derived',
        accessible: true,
        visibleToGuests: false,
        oneWay: false,
      });
    }
  }

  const pathNodeFilter = (node) => pathVertexNodeIds.has(node.id);
  const booths = boothRows
    .map((row) => {
      const geometry = parseGpkgGeometry(row.geom_hex);
      if (geometry?.type !== 'Point') {
        return null;
      }

      const id = slugify(row.booth_id || row.name, `booth-${row.fid}`);
      const nodeId = `booth-${row.fid}`;
      addNode(nodes, nodeId, row.name || `Booth ${row.fid}`, geometry.coordinates, {
        kind: 'booth',
        sourceId: row.booth_id || String(row.fid),
      });

      const nearest = findNearestNode(geometry.coordinates, nodes, pathNodeFilter);
      if (nearest) {
        addEdge({
          id: `booth-${row.fid}-connector`,
          label: `${row.name || `Booth ${row.fid}`} connector`,
          fromNodeId: nodeId,
          toNodeId: nearest.node.id,
          coordinates: [geometry.coordinates, nearest.node.coordinates],
          distanceFeet: nearest.distance,
          pathType: 'connector',
          status: row.status || '',
          accessible: toBoolean(row.accessible, true),
          visibleToGuests: true,
          oneWay: false,
        });
      }

      return {
        id,
        label: row.name || `Booth ${row.fid}`,
        nodeId,
        zone: row.notes || 'Mapped booth',
        coordinates: geometry.coordinates,
        status: row.status || '',
      };
    })
    .filter(Boolean);

  const destinations = locationRows
    .map((row) => {
      const geometry = parseGpkgGeometry(row.geom_hex);
      if (geometry?.type !== 'Point') {
        return null;
      }

      const id = slugify(row.qr_slug || row.location_id || row.name, `location-${row.fid}`);
      const nodeId = `location-${row.fid}`;
      addNode(nodes, nodeId, row.name || `Location ${row.fid}`, geometry.coordinates, {
        kind: 'destination',
        sourceId: row.location_id || String(row.fid),
      });

      const nearest = findNearestNode(geometry.coordinates, nodes, pathNodeFilter);
      if (nearest) {
        addEdge({
          id: `location-${row.fid}-connector`,
          label: `${row.name || `Location ${row.fid}`} connector`,
          fromNodeId: nodeId,
          toNodeId: nearest.node.id,
          coordinates: [geometry.coordinates, nearest.node.coordinates],
          distanceFeet: nearest.distance,
          pathType: 'connector',
          status: row.status || '',
          accessible: toBoolean(row.accessible, true),
          visibleToGuests: true,
          oneWay: false,
        });
      }

      return {
        id,
        label: row.name || `Location ${row.fid}`,
        nodeId,
        category: row.category || 'Location',
        coordinates: geometry.coordinates,
        status: row.status || '',
        aliases: row.search_aliases || '',
        arrivalNotes: row.arrival_notes || '',
      };
    })
    .filter(Boolean);

  return {
    source: {
      projectDir: PROJECT_DIR,
      gpkgPath: GPKG_PATH,
    },
    counts: {
      booths: booths.length,
      destinations: destinations.length,
      junctions: junctionRows.length,
      walkingPaths: pathRows.length,
      nodes: Object.keys(nodes).length,
      edges: edges.length,
    },
    nodes,
    edges,
    booths,
    destinations,
    areas: [],
  };
}

async function main() {
  const courseData = createCourseData();
  const routingGeojson = createRoutingGeojson();
  const moduleContents = `// Generated by scripts/sync-mergin-course-map.mjs from the RBC Open Mergin GeoPackage.\n` +
    `// Re-run npm run sync:mergin-map after syncing the Mergin project.\n` +
    `export const MERGIN_COURSE_MAP_DATA = ${JSON.stringify(courseData, null, 2)};\n`;

  await fs.mkdir(path.dirname(MODULE_OUTPUT_PATH), { recursive: true });
  await fs.mkdir(path.dirname(PUBLIC_OUTPUT_PATH), { recursive: true });
  await fs.mkdir(FUNCTION_ROUTING_DATA_DIR, { recursive: true });
  await fs.writeFile(MODULE_OUTPUT_PATH, moduleContents, 'utf8');
  await fs.writeFile(PUBLIC_OUTPUT_PATH, `${JSON.stringify(courseData, null, 2)}\n`, 'utf8');
  await fs.writeFile(
    path.join(FUNCTION_ROUTING_DATA_DIR, 'course_locations.geojson'),
    `${JSON.stringify(routingGeojson.course_locations, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(FUNCTION_ROUTING_DATA_DIR, 'booths.geojson'),
    `${JSON.stringify(routingGeojson.booths, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(FUNCTION_ROUTING_DATA_DIR, 'walking_paths.geojson'),
    `${JSON.stringify(routingGeojson.walking_paths, null, 2)}\n`,
    'utf8',
  );

  console.log(`Synced ${courseData.counts.walkingPaths} paths, ${courseData.counts.destinations} destinations, and ${courseData.counts.booths} booths.`);
  console.log(`Wrote ${path.relative(process.cwd(), MODULE_OUTPUT_PATH)}`);
  console.log(`Wrote ${path.relative(process.cwd(), PUBLIC_OUTPUT_PATH)}`);
  console.log(`Wrote ${path.relative(process.cwd(), FUNCTION_ROUTING_DATA_DIR)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
