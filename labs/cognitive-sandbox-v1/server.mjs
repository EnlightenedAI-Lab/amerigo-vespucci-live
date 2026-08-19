/**
 * IQAI Cognitive Sandbox V1 — isolated localhost-only server.
 * It exposes read-only fixtures and advisory reasoning. There are no action,
 * write-back, shell, map-control, camera-control, Portal, email, or GIS-write APIs.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CognitiveBrain } from './lib/brain.mjs';
import { loadSyntheticFixtures } from './lib/fixtures.mjs';
import { createModelAdapter } from './lib/model-adapters.mjs';

const LAB_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.join(LAB_ROOT, 'public');
const MAX_BODY_BYTES = 512 * 1024;
const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
});

function securityHeaders(contentType = 'application/json; charset=utf-8') {
  return {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, securityHeaders());
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new RangeError('Request body exceeds 512 KiB');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function safePublicPath(urlPath) {
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const decoded = decodeURIComponent(requested);
  const resolved = path.resolve(PUBLIC_ROOT, `.${decoded}`);
  const prefix = `${PUBLIC_ROOT}${path.sep}`;
  return resolved.startsWith(prefix) ? resolved : null;
}

function servePublic(request, response, url) {
  if (request.method !== 'GET') return false;
  const filePath = safePublicPath(url.pathname);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const contentType = CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
  response.writeHead(200, securityHeaders(contentType));
  fs.createReadStream(filePath).pipe(response);
  return true;
}

export function createLabServer({
  fixtures = loadSyntheticFixtures(),
  adapterFactory = createModelAdapter
} = {}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    try {
      if (request.method === 'GET' && url.pathname === '/api/fixtures') {
        sendJson(response, 200, {
          synthetic: true,
          readOnly: true,
          snapshots: fixtures
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/health') {
        const provider = url.searchParams.get('provider') ?? 'ollama';
        const adapter = adapterFactory(provider);
        sendJson(response, 200, {
          isolated: true,
          advisoryOnly: true,
          writeBack: false,
          productionTools: [],
          model: await adapter.health()
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/reason') {
        const body = await readJson(request);
        if (!body.snapshot || typeof body.question !== 'string') {
          sendJson(response, 400, { error: 'snapshot and question are required' });
          return;
        }
        const provider = body.provider ?? 'ollama';
        if (!['ollama', 'mock'].includes(provider)) {
          sendJson(response, 400, { error: 'provider must be ollama or mock' });
          return;
        }
        const brain = new CognitiveBrain(adapterFactory(provider));
        const cognitiveResponse = await brain.reason(body.snapshot, body.question, {
          media: body.media ?? []
        });
        sendJson(response, 200, cognitiveResponse);
        return;
      }

      if (servePublic(request, response, url)) return;
      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      const clientError = error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError;
      sendJson(response, clientError ? 400 : 500, {
        error: clientError ? error.message : 'Sandbox request failed safely'
      });
    }
  });
}

export async function startLabServer({
  port = Number(process.env.IQAI_BRAIN_PORT || 8772),
  host = '127.0.0.1'
} = {}) {
  const server = createLabServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const server = await startLabServer();
  const address = server.address();
  console.log(`IQAI Cognitive Sandbox V1: http://localhost:${address.port}/`);
  console.log('Isolation: localhost-only, advisory-only, no write-back or production tools');
}
