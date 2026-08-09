/**
 * IQAI Spatial — shared product/workspace identity metadata.
 * Workspaces import this to keep document titles and labels consistent.
 */

export const IQAI_SPATIAL_PRODUCT = 'IQAI SPATIAL';

/** @type {Record<string, { id: string, label: string, titleCase: string }>} */
export const IQAI_SPATIAL_WORKSPACES = {
  investigation: {
    id: 'investigation',
    label: 'INVESTIGATION',
    titleCase: 'Investigation'
  },
  intelligence: {
    id: 'intelligence',
    label: 'INTELLIGENCE',
    titleCase: 'Intelligence'
  }
};

export function formatSpatialDocumentTitle(workspaceTitleCase) {
  return workspaceTitleCase ? `IQAI Spatial — ${workspaceTitleCase}` : 'IQAI Spatial';
}

export function applySpatialBrandDocumentTitle(workspaceKey) {
  const ws = IQAI_SPATIAL_WORKSPACES[workspaceKey];
  if (!ws) return;
  document.title = formatSpatialDocumentTitle(ws.titleCase);
}
