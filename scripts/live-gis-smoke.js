/**
 * Opt-in live GIS smoke checks — not run in normal CI.
 * Usage: node scripts/live-gis-smoke.js
 */
const checks = [];

async function check(name, fn) {
  try {
    const result = await fn();
    checks.push({ name, ok: true, ...result });
    console.log(`✔ ${name}`);
  } catch (err) {
    checks.push({ name, ok: false, error: err.message });
    console.error(`✖ ${name}: ${err.message}`);
  }
}

await check('Copernicus current GetCapabilities', async () => {
  const url = 'https://wmts.marine.copernicus.eu/teroWmts/GLOBAL_ANALYSISFORECAST_PHY_001_024/cmems_mod_glo_phy-cur_anfc_0.083deg_PT6H-i_202406?SERVICE=WMTS&version=1.0.0&REQUEST=GetCapabilities';
  const text = await fetch(url).then((r) => r.text());
  if (!/sea_water_velocity/i.test(text)) throw new Error('sea_water_velocity missing');
  if (!/Dimension/i.test(text)) throw new Error('time dimension missing');
  return { bytes: text.length };
});

await check('Copernicus wave GetCapabilities', async () => {
  const url = 'https://wmts.marine.copernicus.eu/teroWmts/GLOBAL_ANALYSISFORECAST_WAV_001_027/cmems_mod_glo_wav_anfc_0.083deg_PT3H-i_202411?SERVICE=WMTS&version=1.0.0&REQUEST=GetCapabilities';
  const text = await fetch(url).then((r) => r.text());
  if (!/VHM0/i.test(text)) throw new Error('VHM0 missing');
  return { bytes: text.length };
});

await check('GEBCO 2025 GetCapabilities', async () => {
  const text = await fetch('https://wms.gebco.net/2025/mapserv?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0').then((r) => r.text());
  if (!/gebco_2025/i.test(text)) throw new Error('gebco_2025 missing');
  return { bytes: text.length };
});

await check('NASA GIBS capabilities', async () => {
  const text = await fetch('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml').then((r) => r.text());
  if (!/VIIRS_NOAA20_CorrectedReflectance_TrueColor/i.test(text)) throw new Error('VIIRS layer missing');
  return { bytes: text.length };
});

await check('OpenSeaMap tile', async () => {
  const res = await fetch('https://tiles.openseamap.org/seamark/3/4/3.png');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { contentType: res.headers.get('content-type') };
});

await check('WPI CSV', async () => {
  const text = await fetch('https://msi.nga.mil/api/publications/world-port-index?output=csv').then((r) => r.text());
  if (!/portName/i.test(text) || !/latitude/i.test(text)) throw new Error('CSV schema unexpected');
  return { bytes: text.length };
});

console.log('\n' + JSON.stringify({ ranAt: new Date().toISOString(), checks }, null, 2));
process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
