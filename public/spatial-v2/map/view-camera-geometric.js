/**
 * Compact geometric camera view from SensorPose.
 * Not photographic imagery. Not LOS. Does not claim obstructions.
 */

export const GEOMETRIC_VIEW_TITLE = 'GEOMETRIC CAMERA VIEW';
export const GEOMETRIC_NOT_PHOTOGRAPHIC = 'NOT PHOTOGRAPHIC IMAGERY';
export const GEOMETRIC_NOT_LOS = 'NOT LOS';

export function drawGeometricCameraView(canvas, camera) {
  if (!canvas) return;
  const width = Math.max(canvas.clientWidth || 240, 160);
  const height = Math.max(canvas.clientHeight || 140, 110);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#0c0c0e';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#f4f0ea';
  ctx.font = '600 9px Segoe UI, sans-serif';
  ctx.fillText(GEOMETRIC_VIEW_TITLE, 8, 14);
  ctx.fillStyle = 'rgba(244,240,234,0.72)';
  ctx.fillText(GEOMETRIC_NOT_PHOTOGRAPHIC, 8, 28);
  ctx.fillText(GEOMETRIC_NOT_LOS, 8, 40);

  if (!camera || !Number.isFinite(Number(camera.heading))) {
    ctx.fillStyle = '#f4f0ea';
    ctx.fillText('Select a camera.', 8, 62);
    return;
  }

  const heading = Number(camera.heading);
  const pitch = Number.isFinite(Number(camera.pitch)) ? Number(camera.pitch) : 0;
  const hfovDeg = Number.isFinite(Number(camera.horizontalFov)) ? Number(camera.horizontalFov) : 60;
  const vfovDeg = Number(camera.verticalFov) || hfovDeg * 9 / 16;
  const hfov = hfovDeg * Math.PI / 180;
  const vfov = vfovDeg * Math.PI / 180;
  const headingRad = heading * Math.PI / 180;
  const pitchRad = pitch * Math.PI / 180;
  const heightAgl = Number.isFinite(Number(camera.heightAboveGround))
    ? Number(camera.heightAboveGround)
    : 3;

  const fe = Math.sin(headingRad) * Math.cos(pitchRad);
  const fn = Math.cos(headingRad) * Math.cos(pitchRad);
  const fu = Math.sin(pitchRad);
  const re = Math.cos(headingRad);
  const rn = -Math.sin(headingRad);
  const ru = 0;
  const ue = rn * fu - ru * fn;
  const un = ru * fe - re * fu;
  const uu = re * fn - rn * fe;

  function project(e, n, u) {
    const camX = e * re + n * rn + u * ru;
    const camY = e * ue + n * un + u * uu;
    const camZ = e * fe + n * fn + u * fu;
    if (!(camZ > 0.15)) return null;
    const x = camX / (camZ * Math.tan(hfov / 2));
    const y = camY / (camZ * Math.tan(vfov / 2));
    return {
      x: (x * 0.5 + 0.5) * width,
      y: (-y * 0.5 + 0.5) * height
    };
  }

  const he = Math.sin(headingRad);
  const hn = Math.cos(headingRad);
  function groundPoint(rightM, forwardM) {
    return project(rightM * re + forwardM * he, rightM * rn + forwardM * hn, -heightAgl);
  }

  ctx.fillStyle = '#2a2824';
  const outline = [
    groundPoint(-40, 4),
    groundPoint(40, 4),
    groundPoint(40, 90),
    groundPoint(-40, 90)
  ].filter(Boolean);
  if (outline.length >= 3) {
    ctx.beginPath();
    ctx.moveTo(outline[0].x, outline[0].y);
    for (const point of outline.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(244,240,234,0.28)';
  ctx.lineWidth = 1;
  for (let forward = 10; forward <= 90; forward += 10) {
    const a = groundPoint(-40, forward);
    const b = groundPoint(40, forward);
    if (a && b) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  const horizonA = project(-200, 400, 0);
  const horizonB = project(200, 400, 0);
  if (horizonA && horizonB) {
    ctx.strokeStyle = '#f4f0ea';
    ctx.beginPath();
    ctx.moveTo(horizonA.x, horizonA.y);
    ctx.lineTo(horizonB.x, horizonB.y);
    ctx.stroke();
  }

  const axis = groundPoint(0, 50);
  if (axis) {
    ctx.strokeStyle = '#ffb020';
    ctx.beginPath();
    ctx.moveTo(width / 2, height / 2);
    ctx.lineTo(axis.x, axis.y);
    ctx.stroke();
  }

  ctx.strokeStyle = '#f4f0ea';
  ctx.beginPath();
  ctx.moveTo(width / 2 - 10, height / 2);
  ctx.lineTo(width / 2 + 10, height / 2);
  ctx.moveTo(width / 2, height / 2 - 10);
  ctx.lineTo(width / 2, height / 2 + 10);
  ctx.stroke();

  ctx.fillStyle = '#f4f0ea';
  ctx.fillText(`HDG ${heading.toFixed(0)}°  PITCH ${pitch.toFixed(0)}°  HFOV ${hfovDeg.toFixed(0)}°`, 8, height - 10);
}
