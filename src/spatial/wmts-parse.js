/**
 * Parse WMTS GetCapabilities for time dimension values.
 * @param {string} xml
 * @param {string} [layerIdSubstring]
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

/**
 * Pick newest GIBS day with up to `fallbackDays` prior attempts.
 * @param {string[]} isoDays YYYY-MM-DD or ISO strings
 * @param {number} fallbackDays
 */
export function selectGibsDay(isoDays, fallbackDays = 3) {
  const days = (isoDays || [])
    .map((d) => d.slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (!days.length) return null;
  const newest = days[days.length - 1];
  const candidates = [newest];
  const base = new Date(`${newest}T00:00:00Z`);
  for (let i = 1; i <= fallbackDays; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    candidates.push(d.toISOString().slice(0, 10));
  }
  return candidates;
}
