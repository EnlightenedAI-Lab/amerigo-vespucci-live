/** CSV parser reused from amerigo-vespucci-live montreal-road-obstructions.js. */

export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const vals = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? '';
    });
    return row;
  });
}

export function decodeCsvBuffer(buffer, contentType = '') {
  const ct = String(contentType).toLowerCase();
  if (
    ct.includes('charset=windows-1252')
    || ct.includes('charset=cp1252')
    || ct.includes('charset=iso-8859-1')
    || ct.includes('charset=latin1')
  ) {
    return buffer.toString('latin1');
  }
  const utf8 = buffer.toString('utf8');
  if (utf8.includes('\uFFFD')) {
    const latin1 = buffer.toString('latin1');
    if (!latin1.includes('\uFFFD')) return latin1;
  }
  return utf8;
}
