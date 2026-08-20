const COMMANDS = Object.freeze({
  NDVI: 'EO.NDVI',
  HEAT: 'EO.SURFACE_TEMPERATURE',
  RADAR: 'EO.SAR_CHANGE'
});

export { COMMANDS };

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({
    status: 'FAILED',
    error: 'Earth Observation returned a non-JSON body.'
  }));
  return { ok: response.ok, status: response.status, payload };
}

export async function runEo({ command, bbox, compare = false }) {
  return postJson('/api/eo/run', {
    command,
    aoi: { bbox },
    compare
  });
}

export async function probeEo({ lat, lon, receiptId }) {
  return postJson('/api/eo/probe', { lat, lon, receiptId });
}

export async function askEoBrain({ question, eoReceiptId, probeId }) {
  return postJson('/api/eo/brain/ask', { question, eoReceiptId, probeId });
}

export function overlayFromReceipt(receipt) {
  const overlay = receipt?.overlay || {};
  const dataUrl = overlay.dataUrl || overlay.png || overlay.image || null;
  const bounds = overlay.bounds || overlay.bbox || receipt?.aoi?.bbox || null;
  return { dataUrl, bounds, legend: overlay.legend || receipt?.legend || null };
}
