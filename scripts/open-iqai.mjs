import { exec } from 'node:child_process';
import { startPreviewServer } from '../src/preview.js';

const PORT = Number(process.env.PORT || process.env.PREVIEW_PORT || 3000);
const URL = `http://localhost:${PORT}/iqai.html`;

async function isServerUp() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

let server;
if (!(await isServerUp())) {
  console.log(`Starting preview server on port ${PORT}…`);
  server = startPreviewServer(PORT);
  await new Promise((r) => setTimeout(r, 2000));
}

const openCmd = process.platform === 'win32'
  ? `start "" "${URL}"`
  : process.platform === 'darwin'
    ? `open "${URL}"`
    : `xdg-open "${URL}"`;

exec(openCmd, (err) => {
  if (err) {
    console.error('Could not open browser. Open this URL manually:\n', URL);
    process.exit(1);
  }
  console.log('Opened IQAI Spatial in your browser:\n', URL);
  if (server) {
    console.log('Preview server running — press Ctrl+C to stop.');
  }
});
