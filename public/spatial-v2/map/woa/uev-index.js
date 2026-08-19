/**
 * Viewport display-fabric index for the remote Montréal UEV source.
 * Does not load the citywide exact dataset.
 */

import { indexCollection } from './index.js';
import { wrapUevFeature } from './adapter.js';

function bboxKey(bbox) {
  return (bbox || []).map((value) => Number(value).toFixed(4)).join(',');
}

export function createRemoteUevIndex({ runtime, source }) {
  let local = indexCollection({ type: 'FeatureCollection', features: [] }, 'evaluation_unit');
  let lastKey = '';
  let lastBytes = 0;
  let cellsFetched = [];
  let cellsCached = [];
  let unitCount = 0;
  let fabricLayer = null;
  let pending = null;
  let lastError = '';

  async function refresh(bbox) {
    if (!bbox || bbox.length < 4) return local;
    const key = bboxKey(bbox);
    if (key === lastKey && local.count > 0) return local;
    if (pending) await pending.catch(() => null);
    pending = (async () => {
      const result = await runtime.queryEvaluationUnits(bbox, { viewport: false });
      if (result.stale) return local;
      const manifest = await runtime.getManifest();
      const provenance = await runtime.getProvenance();
      unitCount = Number(manifest?.counts?.units_kept) || unitCount;
      fabricLayer = result.layer || null;
      lastBytes = Number(result.bytes) || 0;
      cellsFetched = result.cellsFetched || [];
      cellsCached = result.cellsCached || [];
      const features = (result.features || [])
        .filter((feature) => feature?.properties?.selectable && feature.properties.source_id)
        .map((feature) => wrapUevFeature(feature, {
          fabric: 'display',
          provenance,
          manifest,
          source
        }));
      const next = indexCollection({ type: 'FeatureCollection', features }, 'evaluation_unit');
      if (next.count === 0 && local.count > 0) {
        lastError = 'empty viewport kept previous index';
        return local;
      }
      local = next;
      lastKey = key;
      lastError = '';
      return local;
    })();
    try {
      return await pending;
    } catch (error) {
      lastError = String(error?.message || error);
      throw error;
    } finally {
      pending = null;
    }
  }

  return {
    objectClass: 'evaluation_unit',
    get count() {
      return local.count;
    },
    get items() {
      return local.items;
    },
    findBySourceId(sourceId) {
      return local.findBySourceId(sourceId);
    },
    findAt(lat, lng, nearMeters = 6) {
      return local.findAt(lat, lng, nearMeters);
    },
    refresh,
    stats() {
      return {
        fabric: 'display',
        layer: fabricLayer,
        unitCount,
        indexed: local.count,
        count: local.count,
        local: {
          count: local.count,
          bbox: lastKey ? lastKey.split(',').map(Number) : null,
          layer: fabricLayer,
          error: lastError
        },
        error: lastError,
        bytes: lastBytes,
        cellsFetched,
        cellsCached,
        fullDatasetDownloaded: false
      };
    }
  };
}
