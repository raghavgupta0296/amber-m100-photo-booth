import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJobStore } from './jobStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const uploadDir = path.join(rootDir, 'uploads');
const store = createJobStore({ rootDir });

const PORT = Number(process.env.PORT ?? 3000);
const STATION_TOKEN = process.env.PRINT_STATION_TOKEN ?? 'dev-print-station-token';
const MAX_JSON_BYTES = 32 * 1024 * 1024;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

const NO_STORE_EXTENSIONS = new Set(['.html', '.js', '.css']);

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(body));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

function hasStationAuth(request) {
  const header = request.headers.authorization ?? '';
  return header === `Bearer ${STATION_TOKEN}`;
}

async function readJson(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_JSON_BYTES) {
      throw new Error('Request body is too large.');
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function serveFile(response, absolutePath) {
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    sendError(response, 404, 'Not found.');
    return;
  }

  const extension = path.extname(absolutePath).toLowerCase();
  response.writeHead(200, {
    'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
    'content-length': fileStat.size,
    'cache-control': NO_STORE_EXTENSIONS.has(extension) ? 'no-store' : 'public, max-age=3600'
  });
  createReadStream(absolutePath).pipe(response);
}

function resolveStaticPath(baseDir, urlPath) {
  const decodedPath = decodeURIComponent(urlPath);
  const normalized = path.normalize(decodedPath).replace(/^([/\\])+/, '').replace(/^(\.\.[/\\])+/, '');
  const relativePath = normalized === '' ? 'index.html' : normalized;
  const absolutePath = path.join(baseDir, relativePath);
  if (!absolutePath.startsWith(baseDir)) {
    return null;
  }
  return absolutePath;
}

async function routeApi(request, response, url) {
  if (request.method === 'POST' && url.pathname === '/api/print-jobs') {
    const body = await readJson(request);
    const job = await store.createJob(body);
    sendJson(response, 201, { job });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/print-jobs/next') {
    if (!hasStationAuth(request)) {
      sendError(response, 401, 'Missing or invalid print station token.');
      return true;
    }
    const job = await store.getNextQueuedJob();
    sendJson(response, 200, { job });
    return true;
  }

  const jobMatch = url.pathname.match(/^\/api\/print-jobs\/([^/]+)$/);
  if (jobMatch && request.method === 'GET') {
    const job = await store.getJob(jobMatch[1]);
    if (!job) {
      sendError(response, 404, 'Print job not found.');
      return true;
    }
    sendJson(response, 200, { job });
    return true;
  }

  const statusMatch = url.pathname.match(/^\/api\/print-jobs\/([^/]+)\/status$/);
  if (statusMatch && request.method === 'POST') {
    if (!hasStationAuth(request)) {
      sendError(response, 401, 'Missing or invalid print station token.');
      return true;
    }
    const body = await readJson(request);
    const job = await store.updateJobStatus(
      statusMatch[1],
      body.status,
      body.errorMessage,
      body.statusMessage
    );
    if (!job) {
      sendError(response, 404, 'Print job not found.');
      return true;
    }
    sendJson(response, 200, { job });
    return true;
  }

  return false;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (request.method === 'GET' && url.pathname === '/healthz') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      const handled = await routeApi(request, response, url);
      if (!handled) {
        sendError(response, 404, 'API route not found.');
      }
      return;
    }

    if (url.pathname.startsWith('/uploads/')) {
      const uploadPath = resolveStaticPath(uploadDir, url.pathname.replace('/uploads', ''));
      if (!uploadPath) {
        sendError(response, 404, 'Not found.');
        return;
      }
      await serveFile(response, uploadPath);
      return;
    }

    const staticPath = resolveStaticPath(publicDir, url.pathname);
    if (!staticPath) {
      sendError(response, 404, 'Not found.');
      return;
    }

    try {
      await serveFile(response, staticPath);
    } catch (error) {
      if (url.pathname.startsWith('/print/')) {
        await serveFile(response, path.join(publicDir, 'index.html'));
        return;
      }
      throw error;
    }
  } catch (error) {
    const statusCode = error.message.includes('too large') ? 413 : 500;
    sendError(response, statusCode, error.message);
  }
});

server.listen(PORT, () => {
  console.log(`Wedding photo booth running at http://localhost:${PORT}`);
  if (STATION_TOKEN === 'dev-print-station-token') {
    console.log('Using default PRINT_STATION_TOKEN. Set a private token before deploying.');
  }
});
