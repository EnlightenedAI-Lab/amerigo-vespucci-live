/**
 * Production World Object adapter.
 * Maps acquired features onto production ObjectRef + operator inspector fields.
 * UEV is an evaluation-unit fabric. Not cadastre. Not ownership.
 */

import {
  featureArea,
  featureBBox,
  featureCentroid,
  featurePerimeter,
  featurePoint
} from '../focus/objects.js';
import { objectRefFromNrcanFeature } from '../focus/nrcan-object-ref.js';
import { createObjectRef } from '../../foundation/contracts/index.js';

export const UEV_LEGAL_BANNER = 'NOT CADASTRE  ·  NOT PROOF OF OWNERSHIP';

export const CLASS_META = Object.freeze({
  building: { id: 'building', label: 'BUILDING', namespace: 'nrcan' },
  park: { id: 'park', label: 'PARK / PUBLIC SPACE', namespace: 'ville-montreal' },
  sidewalk: { id: 'sidewalk', label: 'SIDEWALK', namespace: 'ville-montreal' },
  evaluation_unit: { id: 'evaluation_unit', label: 'EVALUATION UNIT', namespace: 'ville-montreal' },
  hydrant: { id: 'hydrant', label: 'HYDRANT', namespace: 'ville-montreal' },
  traffic_signal: { id: 'traffic_signal', label: 'TRAFFIC SIGNAL', namespace: 'ville-montreal' }
});

export function classLabel(objectClass) {
  return CLASS_META[objectClass]?.label || String(objectClass || '').toUpperCase();
}

function asText(value) {
  if (value == null || value === '') return null;
  return String(value);
}

export function sourceAttributes(feature) {
  const raw = feature?.properties?.source;
  if (raw && typeof raw === 'object') return { ...raw };
  const props = { ...(feature?.properties || {}) };
  delete props.lab;
  delete props.source;
  return props;
}

export function labMeta(feature) {
  return feature?.properties?.lab || {};
}

export function objectKey(feature) {
  const lab = labMeta(feature);
  return `${lab.providerKey || 'unknown'}:${lab.objectClass || 'object'}:${lab.sourceId || 'none'}`;
}

export function derivedValues(feature) {
  const point = featurePoint(feature);
  const area = featureArea(feature);
  const perimeter = featurePerimeter(feature);
  const centroid = featureCentroid(feature) || point;
  const bbox = featureBBox(feature);
  return {
    area_m2: Number.isFinite(area) && area > 0 ? area : null,
    perimeter_m: Number.isFinite(perimeter) && perimeter > 0 ? perimeter : null,
    centroid,
    bbox
  };
}

export function wrapNrcanBuilding(feature) {
  const props = feature?.properties || {};
  const source = props.source && typeof props.source === 'object' && props.lab
    ? { ...props.source }
    : { ...props };
  const sourceId = String(props.lab?.sourceId || source.feature_id || props.feature_id || '');
  return {
    type: 'Feature',
    id: feature.id || `nrcan/building/${sourceId}`,
    geometry: feature.geometry,
    properties: {
      source,
      lab: props.lab && props.lab.objectClass === 'building'
        ? { ...props.lab, sourceId }
        : {
          objectClass: 'building',
          label: 'BUILDING',
          sourceId,
          provider: 'Natural Resources Canada',
          providerKey: 'nrcan',
          dataset: 'Automatically Extracted Buildings — Optimized Buildings Layer',
          datasetId: source.sourceUuid || '7a5cda52-c7df-427f-9ced-26f19a8a64d6',
          identityField: 'feature_id',
          sourceName: source.name || null,
          license: 'Open Government Licence – Canada',
          geometryType: feature.geometry?.type || null
        }
    }
  };
}

export function wrapUevFeature(feature, {
  fabric = 'display',
  provenance = null,
  manifest = null,
  source = null
} = {}) {
  const props = feature?.properties || {};
  const raw = props.source && typeof props.source === 'object' ? { ...props.source } : {};
  const sourceId = String(props.source_id || raw.ID_UEV || '');
  const civic = raw.CIVIQUE_DEBUT || props.civic_from;
  const street = raw.NOM_RUE || props.street;
  const name = civic && street ? `${String(civic).trim()} ${String(street).trim()}` : null;
  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      source: raw,
      lab: {
        objectClass: 'evaluation_unit',
        label: (source?.label || 'EVALUATION UNIT'),
        sourceId,
        provider: source?.provider || 'Ville de Montréal',
        providerKey: 'ville-montreal',
        dataset: source?.dataset || "Unités d'évaluation foncière",
        datasetId: source?.datasetId || manifest?.dataset_id || '4ad6baea-4d2c-460f-a8bf-5d000db498f7',
        identityField: 'ID_UEV',
        sourceName: name,
        license: 'CC BY 4.0',
        retrievedAt: provenance?.retrieved_at || null,
        sourceUrl: provenance?.official_resource_url || manifest?.catalog_url || null,
        updateDate: provenance?.resource_last_modified || null,
        legalNote: `${UEV_LEGAL_BANNER}. Municipal evaluation unit (unité d'évaluation foncière).`,
        fabric,
        geometryType: feature.geometry?.type || null
      }
    }
  };
}

function datasetVersionOf(lab) {
  return asText(lab.updateDate) || asText(lab.retrievedAt)?.slice(0, 10) || '1.0.0';
}

export function objectRefFromFeature(feature, { label = null } = {}) {
  const lab = labMeta(feature);
  const sourceId = asText(lab.sourceId);
  if (!sourceId) return null;
  if (lab.objectClass === 'building') {
    return objectRefFromNrcanFeature({
      ...feature,
      properties: {
        ...(feature.properties || {}),
        feature_id: sourceId,
        sourceUuid: lab.datasetId
      }
    }, { label: label || lab.sourceName || 'Building' });
  }
  const meta = CLASS_META[lab.objectClass];
  if (!meta) return null;
  return createObjectRef({
    namespace: meta.namespace,
    kind: lab.objectClass,
    id: sourceId,
    datasetRef: lab.datasetId || lab.dataset || lab.objectClass,
    datasetVersion: datasetVersionOf(lab),
    sourceRef: `${meta.namespace}:${lab.objectClass}`,
    identityStability: 'DATASET_VERSIONED',
    label: label || lab.sourceName || classLabel(lab.objectClass),
    geometryRef: `${meta.namespace}:${lab.objectClass}:${sourceId}`
  });
}

export function toAcquiredObject(feature, catalogName = null) {
  const lab = labMeta(feature);
  const source = sourceAttributes(feature);
  const derived = derivedValues(feature);
  const name = catalogName || lab.sourceName || null;
  const objectRef = objectRefFromFeature(feature, { label: name });
  return {
    objectClass: lab.objectClass,
    sourceId: asText(lab.sourceId),
    provider: lab.provider || null,
    dataset: lab.dataset || null,
    datasetId: lab.datasetId || null,
    identityField: lab.identityField || null,
    geometry: feature.geometry,
    feature,
    objectRef,
    anchor: derived.centroid,
    attributes: { source, derived },
    provenance: {
      method: 'vector-selection',
      inference: false,
      license: lab.license || null,
      retrievedAt: lab.retrievedAt || null,
      sourceUrl: lab.sourceUrl || null,
      updateDate: lab.updateDate || null,
      legalNote: lab.legalNote || null,
      geometryType: lab.geometryType || feature.geometry?.type || null,
      fabric: lab.fabric || null
    },
    overlay: {
      name,
      label: lab.label || classLabel(lab.objectClass)
    }
  };
}

export function displayName(acquired) {
  if (acquired?.overlay?.name) return acquired.overlay.name;
  if (acquired?.objectClass === 'evaluation_unit') {
    const src = acquired.attributes?.source || {};
    const civic = src.CIVIQUE_DEBUT;
    const street = src.NOM_RUE;
    if (civic && street) return `${civic} ${street}`;
  }
  return acquired?.overlay?.label || classLabel(acquired?.objectClass);
}

export function sourceNumber(source, keys) {
  for (const key of keys) {
    const n = Number(source?.[key]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
