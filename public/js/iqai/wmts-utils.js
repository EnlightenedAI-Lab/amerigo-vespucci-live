/**
 * Client-side WMTS capabilities helpers for IQAI Spatial V2.
 */

export function parseWmtsTimeFrames(xml, layerIdSubstring) {
  if (!xml) return [];
  const blocks = xml.split(/<Layer[\s>]/i).slice(1);
  let target = blocks[0] || xml;
  if (layerIdSubstring) {
    const hit = blocks.find((b) => b.includes(layerIdSubstring));
    if (hit) target = hit;
  }
  const dimMatch = target.match(/<Dimension[^>]*>([^<]+)<\/Dimension>/i)
    || target.match(/<Dimension[^>]*>\s*<Default>([^<]+)<\/Default>/i);
  if (!dimMatch) return [];
  return dimMatch[1]
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    })
    .filter(Boolean);
}

export function selectGibsDayCandidates(fallbackDays = 3) {
  const candidates = [];
  const now = new Date();
  for (let i = 0; i <= fallbackDays; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    candidates.push(d.toISOString().slice(0, 10));
  }
  return candidates;
}

export async function fetchCapabilitiesText(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`GetCapabilities HTTP ${res.status}`);
  return res.text();
}
