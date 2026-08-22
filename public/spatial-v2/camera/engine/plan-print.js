/**
 * Printable planned-camera sheet. Not LOS. Not a live camera feed.
 */

import { listAuthoredCameras } from '../../map/authored-cameras.js';
import { getLastCoveragePlan } from '../engine/coverage-plan.js';
import { captureTimeLabel } from '../provider/provider-representation.js';
import { DATE_SEARCH_HONESTY } from '../provider/capture-catalog.js';
import { getSlotRepresentationSnapshot } from '../provider/slot-representations.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function cameraPlanPrintModel() {
  const plan = getLastCoveragePlan();
  const cameras = listAuthoredCameras();
  const slots = getSlotRepresentationSnapshot().slots || [];
  return Object.freeze({
    generatedAt: new Date().toISOString().slice(0, 10),
    planId: plan?.planId || 'NONE',
    pattern: plan?.coverageIntent?.pattern || plan?.coverageIntent?.targetGeometry || 'UNPLANNED',
    honesty: plan?.honesty || '2D PLAN GEOMETRY · NOT LOS · NOT INSTALLED',
    dateHonesty: DATE_SEARCH_HONESTY,
    cameras: Object.freeze(cameras.map((camera, index) => {
      const pack = slots.find((slot) => slot.cameraRef === camera.cameraId);
      const capture = pack?.representation || pack?.mapillary || pack?.google || null;
      return Object.freeze({
        ordinal: `CAMERA ${String(index + 1).padStart(2, '0')}`,
        cameraId: camera.cameraId,
        longitude: camera.longitude,
        latitude: camera.latitude,
        heading: camera.heading,
        horizontalFov: camera.horizontalFov,
        captureDate: capture ? captureTimeLabel(capture) : 'CAPTURE TIME UNKNOWN',
        provider: capture?.provider || 'NONE',
        offset: Number.isFinite(Number(capture?.distanceMeters))
          ? `${Math.round(capture.distanceMeters)} m`
          : 'UNKNOWN'
      });
    }))
  });
}

export function renderCameraPlanPrintHtml(model = cameraPlanPrintModel()) {
  const rows = (model.cameras || []).map((camera) => `
    <tr>
      <td>${escapeHtml(camera.ordinal)}</td>
      <td>${escapeHtml(camera.cameraId)}</td>
      <td>${Number(camera.longitude).toFixed(6)}, ${Number(camera.latitude).toFixed(6)}</td>
      <td>${Math.round(Number(camera.heading) || 0)}°</td>
      <td>${Math.round(Number(camera.horizontalFov) || 0)}°</td>
      <td>${escapeHtml(camera.provider)}</td>
      <td>${escapeHtml(camera.captureDate)}</td>
      <td>${escapeHtml(camera.offset)}</td>
    </tr>
  `).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>IQAI Camera Plan</title>
  <style>
    body { font: 12px/1.4 ui-sans-serif, system-ui, sans-serif; color: #111; margin: 24px; }
    h1 { font-size: 16px; letter-spacing: 0.12em; }
    p, td, th { font-size: 11px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; }
    th { letter-spacing: 0.08em; }
    .meta { color: #444; }
  </style>
</head>
<body>
  <h1>IQAI CAMERA PLAN</h1>
  <p class="meta">${escapeHtml(model.pattern)} · ${escapeHtml(model.planId)} · ${escapeHtml(model.generatedAt)}</p>
  <p class="meta">${escapeHtml(model.honesty)}</p>
  <p class="meta">${escapeHtml(model.dateHonesty)}</p>
  <table>
    <thead>
      <tr>
        <th>CAMERA</th><th>ID</th><th>POSITION</th><th>HDG</th><th>HFOV</th><th>PROVIDER</th><th>PHOTO DATE</th><th>OFFSET</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="8">NO CAMERAS</td></tr>'}</tbody>
  </table>
</body>
</html>`;
}

export function printCameraPlan() {
  const html = renderCameraPlanPrintHtml();
  const popup = window.open('', 'iqai-camera-plan-print', 'width=900,height=700');
  if (!popup) return false;
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
  return true;
}
