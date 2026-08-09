/**
 * Extract official Ville de Montréal arrondissement boundaries for intelligence lab.
 * Source: https://donnees.montreal.ca/dataset/limites-administratives-agglomeration
 * Licence: CC BY 4.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'public', 'spatial', 'intelligence-lab', 'data');
const SOURCE_URL =
  'https://donnees.montreal.ca/dataset/9797a946-9da8-41ec-8815-f6b276dec7e9/resource/e18bfd07-edc8-4ce8-8a5a-3b617662a794/download/limites-administratives-agglomeration.geojson';

const META = {
  source: 'Ville de Montréal — Limites administratives de l\'agglomération (WGS 84)',
  sourceUrl: 'https://donnees.montreal.ca/dataset/limites-administratives-agglomeration',
  licence: 'CC BY 4.0',
  vintage: '2026-01-31',
  geometryCrs: 'EPSG:4326',
  filter: 'TYPE = Arrondissement'
};

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const rawPath = path.join(DATA_DIR, 'limites-administratives-agglomeration.geojson');
  if (!fs.existsSync(rawPath)) {
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    fs.writeFileSync(rawPath, Buffer.from(await res.arrayBuffer()));
  }

  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const features = raw.features
    .filter((f) => f.properties?.TYPE === 'Arrondissement')
    .map((f, idx) => ({
      type: 'Feature',
      properties: {
        arrondissement_id: String(f.properties.CODEID || f.properties.NUM || idx + 1),
        name: f.properties.NOM,
        code: f.properties.CODEMAMH || f.properties.ABREV || '',
        type: 'arrondissement'
      },
      geometry: f.geometry
    }));

  const out = {
    type: 'FeatureCollection',
    meta: META,
    features
  };

  const outPath = path.join(DATA_DIR, 'arrondissements-v1.geojson');
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`Wrote ${features.length} arrondissements → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
