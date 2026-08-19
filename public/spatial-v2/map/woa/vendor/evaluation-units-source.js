/**
 * Vendored from EnlightenedAI-Lab/iqai-mtl-uev-data
 * commit 4d9198cfb8c2c528ae6f584f932bda0825aa794f
 * src/runtime/evaluation-units-source.js
 * Do not edit the UEV data repository from this lab.
 *
 * Dual-fabric runtime for the static Montréal evaluation-unit package.
 * Display cells draw the map. Exact cells resolve ID_UEV, geometry, and source attributes.
 * Works in the browser and in Node. Does not load the citywide file.
 */

const OBJECT_CLASS = "evaluation_unit";
const LEGAL_NOTE =
  "Municipal evaluation unit. Not legal cadastre and not proof of ownership.";

function bboxIntersects(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function extentToBbox(extent) {
  if (!extent) throw new Error("extent is required");
  if (Array.isArray(extent) && extent.length >= 4) {
    return [Number(extent[0]), Number(extent[1]), Number(extent[2]), Number(extent[3])];
  }
  const xmin = extent.xmin ?? extent.xMin ?? extent.minX;
  const ymin = extent.ymin ?? extent.yMin ?? extent.minY;
  const xmax = extent.xmax ?? extent.xMax ?? extent.maxX;
  const ymax = extent.ymax ?? extent.yMax ?? extent.maxY;
  if ([xmin, ymin, xmax, ymax].some((v) => v == null || Number.isNaN(Number(v)))) {
    throw new Error("extent must expose xmin,ymin,xmax,ymax");
  }
  return [Number(xmin), Number(ymin), Number(xmax), Number(ymax)];
}

function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}

function walkCoords(value, out = []) {
  if (!value) return out;
  if (typeof value[0] === "number") {
    out.push([value[0], value[1]]);
    return out;
  }
  for (const item of value) walkCoords(item, out);
  return out;
}

function geomBbox(geom) {
  const pts = walkCoords(geom?.coordinates);
  if (!pts.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function centroidOf(geom) {
  const pts = walkCoords(geom?.coordinates);
  if (!pts.length) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  return [sx / pts.length, sy / pts.length];
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonRings(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates[0] || []];
  if (geom.type === "MultiPolygon") return (geom.coordinates || []).map((poly) => poly[0] || []);
  return [];
}

function geometryHitsBbox(geom, bbox) {
  const gb = geomBbox(geom);
  if (!gb || !bboxIntersects(gb, bbox)) return false;
  const pts = walkCoords(geom?.coordinates);
  if (pts.some((p) => p[0] >= bbox[0] && p[0] <= bbox[2] && p[1] >= bbox[1] && p[1] <= bbox[3])) {
    return true;
  }
  const c = centroidOf(geom);
  return Boolean(c && c[0] >= bbox[0] && c[0] <= bbox[2] && c[1] >= bbox[1] && c[1] <= bbox[3]);
}

function geometryHitsPolygon(geom, polygon) {
  const pb = geomBbox(polygon);
  const gb = geomBbox(geom);
  if (!pb || !gb || !bboxIntersects(gb, pb)) return false;
  const rings = polygonRings(polygon);
  const unitRings = polygonRings(geom);
  const pts = walkCoords(geom?.coordinates);
  if (pts.some(([x, y]) => rings.some((ring) => pointInRing(x, y, ring)))) return true;
  const other = walkCoords(polygon?.coordinates);
  if (other.some(([x, y]) => unitRings.some((ring) => pointInRing(x, y, ring)))) return true;
  const c = centroidOf(geom);
  return Boolean(c && rings.some((ring) => pointInRing(c[0], c[1], ring)));
}

function isGzipBuffer(bytes) {
  return bytes?.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function gunzipBytes(bytes) {
  if (typeof DecompressionStream === "function") {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const zlib = await import("node:zlib");
  const { promisify } = await import("node:util");
  return new Uint8Array(await promisify(zlib.gunzip)(bytes));
}

function decodeJsonBytes(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes));
}

function idShard(id) {
  return String(id).slice(-2).padStart(2, "0");
}

function displayLayerForBbox(manifest, bbox) {
  const layers = [...(manifest?.fabrics?.display?.layers || [])].sort(
    (a, b) => Number(b.min_span || 0) - Number(a.min_span || 0),
  );
  if (!layers.length) return null;
  const span = Number(bbox[2]) - Number(bbox[0]);
  return layers.find((layer) => span >= Number(layer.min_span || 0)) || layers[layers.length - 1];
}

export function cellsForBbox(manifestOrCells, bbox) {
  const cells = Array.isArray(manifestOrCells)
    ? manifestOrCells
    : manifestOrCells?.cells ||
      manifestOrCells?.fabrics?.exact?.cells ||
      [];
  return cells.filter((cell) => bboxIntersects(cell.bbox, bbox));
}

function expandExactUnits(cellJson, provenance, objectClass) {
  const features = [];
  for (const rec of cellJson.features || []) {
    const geom = rec.g || rec.geometry;
    const units = rec.u || rec.units || [];
    const ids = rec.ids || units.map((unit) => unit.id || unit.source_id);
    for (const unit of units) {
      const source = unit.src || unit.source || {};
      const sourceId = String(unit.id || unit.source_id || source.ID_UEV || "");
      if (!sourceId) continue;
      features.push({
        type: "Feature",
        geometry: geom,
        properties: {
          object_class: objectClass,
          object_class_label: "EVALUATION UNIT",
          source_id: sourceId,
          source_id_field: "ID_UEV",
          stacked: ids.length > 1,
          stack_count: ids.length,
          stack_source_ids: ids,
          cubf_code: source.CODE_UTILISATION ?? null,
          cubf_label: source.LIBELLE_UTILISATION ?? null,
          category: source.CATEGORIE_UEF ?? null,
          civic_from: source.CIVIQUE_DEBUT ?? null,
          civic_to: source.CIVIQUE_FIN ?? null,
          street: source.NOM_RUE ?? null,
          suite: source.SUITE_DEBUT ?? null,
          source,
          derived: {
            stack_count: ids.length,
            stack_source_ids: ids,
            fabric: "exact",
          },
          fabric: "exact",
          provenance,
        },
      });
    }
  }
  return features;
}

function expandDisplayCell(cellJson, provenance, objectClass, layerId) {
  const features = [];
  if (cellJson.fill) {
    features.push({
      type: "Feature",
      geometry: cellJson.fill,
      properties: {
        object_class: objectClass,
        fabric: "display",
        fill: true,
        selectable: false,
        layer: layerId,
        cell: cellJson.id,
        provenance,
      },
    });
  }
  for (const rec of cellJson.features || []) {
    const geom = rec.g || rec.geometry;
    if (!geom) continue;
    const n = Number(rec.n || 1);
    features.push({
      type: "Feature",
      geometry: geom,
      properties: {
        object_class: objectClass,
        object_class_label: "EVALUATION UNIT",
        source_id: rec.i != null ? String(rec.i) : null,
        source_id_field: "ID_UEV",
        stacked: n > 1,
        stack_count: n,
        exact_cell: rec.c || null,
        fabric: "display",
        fill: false,
        selectable: Boolean(rec.i),
        layer: layerId,
        cell: cellJson.id,
        provenance,
      },
    });
  }
  return features;
}

function cubfRollup(features) {
  const by = new Map();
  for (const feature of features) {
    const code = feature.properties.cubf_code || "UNKNOWN";
    const current = by.get(code) || {
      cubf_code: code,
      cubf_label: feature.properties.cubf_label || null,
      count: 0,
    };
    current.count += 1;
    if (!current.cubf_label && feature.properties.cubf_label) {
      current.cubf_label = feature.properties.cubf_label;
    }
    by.set(code, current);
  }
  return [...by.values()].sort(
    (a, b) => b.count - a.count || String(a.cubf_code).localeCompare(String(b.cubf_code)),
  );
}

export function createEvaluationUnitSource(options = {}) {
  const baseUrl = String(options.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("baseUrl is required");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!fetchImpl) throw new Error("fetch is not available");

  const cache = new Map();
  const inflight = new Map();
  let manifestPromise = null;
  let provenancePromise = null;
  let viewportGen = 0;

  async function loadJson(path, signal) {
    const url = joinUrl(baseUrl, path);
    const res = await fetchImpl(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const headerBytes = Number(res.headers.get("content-length") || 0);
    const buf = new Uint8Array(await res.arrayBuffer());
    const transferBytes = headerBytes || buf.byteLength;
    let json;
    if (isGzipBuffer(buf) || path.endsWith(".gz")) {
      json = decodeJsonBytes(isGzipBuffer(buf) ? await gunzipBytes(buf) : buf);
    } else {
      json = decodeJsonBytes(buf);
    }
    return { json, bytes: transferBytes, url };
  }

  async function cachedJson(key, path, signal) {
    if (cache.has(key)) return { ...cache.get(key), cached: true };
    if (inflight.has(key)) return { ...(await inflight.get(key)), cached: true };
    const pending = loadJson(path, signal)
      .then((loaded) => {
        const row = { id: key, json: loaded.json, bytes: loaded.bytes, url: loaded.url };
        cache.set(key, row);
        inflight.delete(key);
        return row;
      })
      .catch((err) => {
        inflight.delete(key);
        throw err;
      });
    inflight.set(key, pending);
    return { ...(await pending), cached: false };
  }

  async function getManifest() {
    if (!manifestPromise) {
      manifestPromise = cachedJson("manifest.json", "manifest.json").then((row) => row.json);
    }
    return manifestPromise;
  }

  async function getProvenance() {
    if (!provenancePromise) {
      provenancePromise = cachedJson("provenance.json", "provenance.json")
        .then((row) => row.json)
        .catch(() => null);
    }
    return provenancePromise;
  }

  async function loadCells(cells, signal) {
    const loaded = [];
    let bytes = 0;
    let cacheHits = 0;
    for (const cell of cells) {
      const row = await cachedJson(cell.path || cell.id, cell.path, signal);
      loaded.push({ ...row, id: cell.id });
      bytes += row.bytes || 0;
      if (row.cached) cacheHits += 1;
    }
    return { loaded, bytes, cacheHits };
  }

  async function queryDisplay(bbox, signal) {
    const [manifest, provenance] = await Promise.all([getManifest(), getProvenance()]);
    const layer = displayLayerForBbox(manifest, bbox);
    if (!layer) throw new Error("manifest has no display layers");
    const wanted = cellsForBbox(layer.cells || [], bbox);
    const packed = await loadCells(wanted, signal);
    const objectClass = manifest.object_class || OBJECT_CLASS;
    const seen = new Set();
    const features = [];
    for (const row of packed.loaded) {
      for (const feature of expandDisplayCell(row.json, provenance, objectClass, layer.id)) {
        if (!geometryHitsBbox(feature.geometry, bbox)) continue;
        const key = feature.properties.fill
          ? `fill:${row.id}`
          : `u:${feature.properties.source_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        features.push(feature);
      }
    }
    return { manifest, provenance, layer, wanted, ...packed, features };
  }

  async function queryExactCells(bbox, signal) {
    const [manifest, provenance] = await Promise.all([getManifest(), getProvenance()]);
    const wanted = cellsForBbox(manifest.fabrics?.exact?.cells || [], bbox);
    const packed = await loadCells(wanted, signal);
    const objectClass = manifest.object_class || OBJECT_CLASS;
    const seen = new Set();
    const features = [];
    for (const row of packed.loaded) {
      for (const feature of expandExactUnits(row.json, provenance, objectClass)) {
        const id = feature.properties.source_id;
        if (seen.has(id)) continue;
        if (!geometryHitsBbox(feature.geometry, bbox)) continue;
        seen.add(id);
        features.push(feature);
      }
    }
    return { manifest, provenance, wanted, ...packed, features };
  }

  async function getById(id, queryOptions = {}) {
    const sourceId = String(id ?? "");
    if (!sourceId) throw new Error("id is required");
    const [manifest, provenance] = await Promise.all([getManifest(), getProvenance()]);
    const shardPath = `exact/ids/${idShard(sourceId)}.json`;
    const shard = await cachedJson(shardPath, shardPath, queryOptions.signal);
    const cellId = shard.json[sourceId];
    if (!cellId) return null;
    const cell = (manifest.fabrics?.exact?.cells || []).find((row) => row.id === cellId);
    if (!cell) return null;
    const loaded = await cachedJson(cell.path, cell.path, queryOptions.signal);
    const objectClass = manifest.object_class || OBJECT_CLASS;
    const feature = expandExactUnits(loaded.json, provenance, objectClass).find(
      (row) => row.properties.source_id === sourceId,
    );
    if (!feature) return null;
    return {
      feature,
      cellId,
      bytes: (shard.cached ? 0 : shard.bytes) + (loaded.cached ? 0 : loaded.bytes),
      provenance,
      legalNote: manifest.legal_note || LEGAL_NOTE,
    };
  }

  return {
    objectClass: OBJECT_CLASS,
    getManifest,
    getProvenance,
    getById,
    cacheSize() {
      return cache.size;
    },
    displayLayerForBbox,
    async queryEvaluationUnits(extent, queryOptions = {}) {
      const bbox = extentToBbox(extent);
      const gen = ++viewportGen;
      const result = await queryDisplay(bbox, queryOptions.signal);
      if (queryOptions.viewport !== false && gen !== viewportGen) {
        return { stale: true, features: [], count: 0, cellsRequested: result.wanted.map((c) => c.id), bytes: 0 };
      }
      return {
        stale: false,
        fabric: "display",
        layer: result.layer.id,
        objectClass: result.manifest.object_class,
        bbox,
        features: result.features,
        count: result.features.length,
        featuresDecoded: result.features.length,
        cellsRequested: result.wanted.map((c) => c.id),
        cellsFetched: result.loaded.filter((row) => !row.cached).map((row) => row.id),
        cellsCached: result.loaded.filter((row) => row.cached).map((row) => row.id),
        cacheHits: result.cacheHits,
        bytes: result.bytes,
        provenance: result.provenance,
        legalNote: result.manifest.legal_note || LEGAL_NOTE,
        note: "Viewport uses simplified display geometry. Exact source geometry is fetched only on demand.",
      };
    },
    async queryEvaluationUnitsWithinGeometry(geometry, queryOptions = {}) {
      const bbox = geomBbox(geometry);
      if (!bbox) throw new Error("geometry has no coordinates");
      const result = await queryExactCells(bbox, queryOptions.signal);
      const features = result.features.filter((feature) => geometryHitsPolygon(feature.geometry, geometry));
      return {
        fabric: "exact",
        objectClass: result.manifest.object_class,
        geometry,
        bbox,
        features,
        count: features.length,
        sourceIds: features.map((feature) => feature.properties.source_id),
        cubf: cubfRollup(features),
        cellsRequested: result.wanted.map((c) => c.id),
        cellsFetched: result.loaded.filter((row) => !row.cached).map((row) => row.id),
        cellsCached: result.loaded.filter((row) => row.cached).map((row) => row.id),
        bytes: result.bytes,
        provenance: result.provenance,
        legalNote: result.manifest.legal_note || LEGAL_NOTE,
        note: "CUBF aggregation uses official CODE_UTILISATION / LIBELLE_UTILISATION only. No population or socioeconomic estimates.",
      };
    },
  };
}

export function createSelectableObjectSource(options = {}) {
  const source = createEvaluationUnitSource(options);
  return {
    contract: "iqai.selectable-object-source.v1",
    objectClass: OBJECT_CLASS,
    label: "EVALUATION UNIT",
    provider: "Ville de Montréal",
    dataset: "Unités d'évaluation foncière",
    datasetId: "4ad6baea-4d2c-460f-a8bf-5d000db498f7",
    identityField: "source_id",
    overlap: "container",
    selectable: true,
    legalNote: LEGAL_NOTE,
    queryByExtent: (extent, opts) => source.queryEvaluationUnits(extent, opts),
    queryByGeometry: (geometry, opts) => source.queryEvaluationUnitsWithinGeometry(geometry, opts),
    async acquire(sourceId, opts) {
      const resolved = await source.getById(sourceId, opts);
      if (!resolved) return null;
      return this.toAcquiredObject(resolved.feature);
    },
    toAcquiredObject(feature) {
      const props = feature?.properties || {};
      return {
        objectClass: OBJECT_CLASS,
        sourceId: props.source_id,
        provider: "Ville de Montréal",
        dataset: "Unités d'évaluation foncière",
        geometry: feature.geometry,
        sourceAttributes: props.source || {},
        provenance: props.provenance || null,
        legalNote: LEGAL_NOTE,
        fabric: props.fabric || null,
      };
    },
  };
}

export { displayLayerForBbox };
