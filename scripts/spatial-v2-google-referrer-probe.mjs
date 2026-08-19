async function cfg(port) {
  try {
    const r = await fetch(`http://localhost:${port}/api/spatial/config`, {
      signal: AbortSignal.timeout(4000)
    });
    const j = await r.json();
    const key = String(j?.streetLevelContext?.googleMapsBrowserApiKey || '').trim();
    return {
      port,
      ok: r.ok,
      configured: Boolean(j?.streetLevelContext?.configured),
      keyLen: key.length,
      keyTail: key ? key.slice(-4) : null,
      key
    };
  } catch (error) {
    return { port, ok: false, error: String(error.message || error), key: '' };
  }
}

async function probe(key, referer) {
  const url = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
  const r = await fetch(url, {
    headers: { Referer: referer, 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(12000)
  });
  const text = await r.text();
  const redacted = text
    .replace(/AIza[0-9A-Za-z_-]+/g, 'REDACTED')
    .replace(/key=[^&"']+/g, 'key=REDACTED');
  const kinds = [
    'RefererNotAllowedMapError',
    'InvalidKeyMapError',
    'ApiNotActivatedMapError',
    'BillingNotEnabledMapError'
  ].filter((kind) => redacted.includes(kind));
  return {
    referer,
    status: r.status,
    kinds,
    hasImportLibrary: /importLibrary/.test(text)
  };
}

const a = await cfg(3047);
const b = await cfg(3000);
const report = {
  p3047: { ok: a.ok, configured: a.configured, keyLen: a.keyLen, keyTail: a.keyTail },
  p3000: { ok: b.ok, configured: b.configured, keyLen: b.keyLen, keyTail: b.keyTail, error: b.error || null },
  keysEqual: Boolean(a.key && b.key && a.key === b.key)
};
if (a.key) {
  report.probe3047 = await probe(a.key, 'http://localhost:3047/spatial-v2/');
  report.probe3000 = await probe(a.key, 'http://localhost:3000/spatial-v2/');
}
console.log(JSON.stringify(report, null, 2));
