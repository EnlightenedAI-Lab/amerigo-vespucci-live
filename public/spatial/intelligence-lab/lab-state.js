/**
 * Unified intelligence lab filter + layer + GIS display state.
 */

export const GIS_DISPLAY_MODES = [
  { id: 'pdqAnalytics', label: 'PDQ analytics' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'clusters', label: 'Clusters' },
  { id: 'heatmap', label: 'Heatmap' },
  { id: 'grid', label: 'Grid / hex' }
];

export const TIME_WINDOWS = [
  { id: 'off', label: 'Off (historical week only)' },
  { id: '24h', label: 'Last 24 hours' },
  { id: '72h', label: 'Last 72 hours' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' }
];

export const SHIFT_FILTERS = [
  { id: 'all', label: 'All shifts' },
  { id: 'day', label: 'Day' },
  { id: 'evening', label: 'Evening' },
  { id: 'night', label: 'Night' }
];

export const AREA_TYPES = [
  { id: 'all', label: 'All Montréal' },
  { id: 'pdq', label: 'PDQ' },
  { id: 'arrondissement', label: 'Arrondissement' }
];

export const GRID_RESOLUTIONS = [
  { id: 250, label: '250 m' },
  { id: 500, label: '500 m' },
  { id: 1000, label: '1 km' }
];

export const CHART_HORIZONS = [
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: '12m', label: '12M' },
  { id: 'eoy2027', label: 'END 2027' }
];

export const DEFAULT_LAYERS = {
  pdqShading: true,
  pdqBoundaries: true,
  pdqLabels: true,
  arrondBoundaries: false,
  arrondLabels: false,
  recentReports: true,
  heatmap: false,
  grid: false
};

export function createInitialLabState(overrides = {}) {
  return {
    crimeCategory: '',
    week: '',
    visualMode: 'deviation',
    baselineMode: 'B2',
    selectedPdqIds: [],
    chartScope: 'pdq',
    timeMapMetric: 'observed',
    timeWindow: 'off',
    reportDate: null,
    calendarMonth: null,
    shift: 'all',
    areaType: 'all',
    areaId: null,
    areaName: null,
    gisDisplayMode: 'pdqAnalytics',
    gridResolution: 500,
    chartHorizon: 'eoy2027',
    layers: { ...DEFAULT_LAYERS },
    selectedRecordKey: null,
    selectedRecord: null,
    recordsDrawerOpen: false,
    rawFieldsOpen: false,
    ...overrides
  };
}

export function recentLayerActive(state) {
  return (state.timeWindow !== 'off' || !!state.reportDate) && state.layers.recentReports !== false;
}

export function operationalDataActive(state) {
  return state.timeWindow !== 'off' || !!state.reportDate;
}

export function showPdqAnalytics(state) {
  return state.gisDisplayMode === 'pdqAnalytics' || state.layers.pdqShading;
}
