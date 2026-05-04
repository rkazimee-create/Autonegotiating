#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      process.env[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
    }
  });
  console.log('✓ Loaded .env');
  console.log('  AUTODEV_API_KEY:', process.env.AUTODEV_API_KEY ? '✓ set' : '✗ missing');
  console.log('  CLAUDE_API_KEY: ', process.env.CLAUDE_API_KEY  ? '✓ set' : '✗ missing');
} else {
  console.warn('⚠ No .env file found at', envPath);
}

const PORT = 8888;
const ROOT = __dirname;
const FUNCTIONS = path.join(ROOT, 'netlify', 'functions');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const API_ROUTES = {
  '/api/inventory':            'inventory',
  '/api/deal-intelligence':    'deal-intelligence',
  '/api/vehicle-intelligence': 'vehicle-intelligence',
  '/api/comparables':          'comparables',
  '/api/trims':               'trims',
  '/api/vin-decode':          'vin-decode',
};

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
  });
}

async function callFunction(name, event) {
  const fnFile = path.join(FUNCTIONS, name + '.js');
  if (!fs.existsSync(fnFile)) {
    console.error('  Function not found:', fnFile);
    return { statusCode: 404, headers: {}, body: JSON.stringify({ error: 'Function not found: ' + name }) };
  }
  Object.keys(require.cache).forEach(k => { if (k === fnFile) delete require.cache[k]; });
  try {
    const mod = require(fnFile);
    return await mod.handler(event);
  } catch (err) {
    console.error('  Function error:', err.message);
    return { statusCode: 500, headers: {}, body: JSON.stringify({ error: err.message }) };
  }
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, 'http://localhost:' + PORT);
  const pathname = urlObj.pathname;
  const body = await readBody(req);

  console.log(new Date().toLocaleTimeString(), req.method, pathname);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end();
    return;
  }

  // API routes
  const fnName = API_ROUTES[pathname];
  if (fnName) {
    const params = {};
    urlObj.searchParams.forEach((v, k) => params[k] = v);
    const event = { httpMethod: req.method, path: pathname, queryStringParameters: params, headers: req.headers, body: body || null };
    const result = await callFunction(fnName, event);
    console.log('  Function', fnName, '→', result.statusCode);
    res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...(result.headers || {}) });
    res.end(result.body || '{}');
    return;
  }

  // Static files
  let filePath = pathname === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, pathname);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    const withHtml = filePath.replace(/\/?$/, '') + '.html';
    if (fs.existsSync(withHtml)) filePath = withHtml;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    console.log('  Not found:', filePath);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found: ' + pathname);
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  AutoNegotiating.com — Local Dev Server');
  console.log('  http://localhost:' + PORT);
  console.log('  Functions dir:', FUNCTIONS);
  if (fs.existsSync(FUNCTIONS)) {
    console.log('  Functions:', fs.readdirSync(FUNCTIONS).join(', '));
  } else {
    console.log('  WARNING: Functions directory not found!');
  }
  console.log('');
});
