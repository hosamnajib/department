const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('node:fs');
const {
  createPublicKey,
  verify: cryptoVerify,
  createHmac,
  timingSafeEqual,
  randomUUID
} = require('node:crypto');
require('dotenv').config();

const { initDatabase, getPool, isDbConnected } = require('./db');
const { SERVICE_ID, VERSION, openapiSpec } = require('./openapiSpec');

const app = express();
app.set('query parser', 'simple');

const PORT = Number(process.env.PORT || 3000);

// SS-8 / MICROAPP_AUTH §8 — strip trailing slashes; never inferred from a request.
const GATEWAY_URL = (process.env.GATEWAY_URL || 'http://127.0.0.1:4301').replace(/\/+$/, '');
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '');

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-insecure-change-me';
const SESSION_COOKIE = 'department_app_session';
const SESSION_TTL_SECONDS = 15 * 60; // MICROAPP_AUTH §6 — backstop, not the mechanism.

const CORRELATION_HEADER = 'x-correlation-id';

// Frontend assets are read once at cold start. Using literal paths here keeps
// them detectable by Vercel's file tracer, so they ship inside the function
// bundle — express.static(__dirname) did not, which is why "/" 404'd in prod.
const FRONTEND = {
  'index.html': { body: fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), type: 'text/html; charset=utf-8' },
  'app.js': { body: fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'), type: 'application/javascript; charset=utf-8' },
  'styles.css': { body: fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8'), type: 'text/css; charset=utf-8' }
};

// SS-8 — the only spec paths that answer without a token.
const PUBLIC_PATHS = new Set(['/health', '/openapi.json']);

// Browser shell — public so the page can load before the user has signed in
// (SS-23 note), but gated by a session in the app's own logic, not by a token.
const BROWSER_PATHS = new Set(['/', '/index.html', '/app.js', '/styles.css', '/favicon.ico']);

// In-Memory Data Store Fallback (used if MySQL DB is unreachable)
let inMemSupervisors = [
  { id: 'SUP-0007', firstName: 'Tauedea', lastName: 'Gabi', email: 'gabitautau@gmail.com', status: 'Active' },
  { id: 'SUP-0008', firstName: 'Krisha', lastName: 'Lama', email: 'krilam@gmail.com', status: 'Active' },
  { id: 'SUP-0003', firstName: 'Daniel', lastName: 'Lee', email: 'daniel.lee@example.com', status: 'Active' },
  { id: 'SUP-0002', firstName: 'Aisyah', lastName: 'Rahman', email: 'aisyah.rahman@example.com', status: 'Active' },
  { id: 'SUP-0001', firstName: 'Wei Jie', lastName: 'Tan', email: 'weijie.tan@example.com', status: 'Active' }
];

let inMemDepartments = [
  { id: 'DEP-0001', name: 'Software engineering', supervisorId: 'SUP-0007', status: 'Active' },
  { id: 'DEP-0002', name: 'Human Resources', supervisorId: 'SUP-0008', status: 'Active' },
  { id: 'DEP-0003', name: 'Marketing', supervisorId: 'SUP-0003', status: 'Active' },
  { id: 'DEP-0004', name: 'Business Data & Analysis', supervisorId: 'SUP-0001', status: 'Active' },
  { id: 'DEP-0005', name: 'Product & UX Design', supervisorId: 'SUP-0002', status: 'Active' }
];

// ---------------------------------------------------------------------------
// Token verification (SS-25 / MICROAPP_AUTH §3)
// ---------------------------------------------------------------------------

let jwksCache = null;

async function getGatewayPublicKey(kid) {
  if (!jwksCache) {
    const response = await fetch(`${GATEWAY_URL}/.well-known/jwks.json`);
    if (!response.ok) throw new Error(`JWKS fetch failed with status ${response.status}`);
    jwksCache = await response.json();
  }
  const jwk = jwksCache.keys.find((key) => key.kid === kid);
  if (!jwk) throw new Error(`No key "${kid}" in gateway JWKS.`);
  return createPublicKey({ key: jwk, format: 'jwk' });
}

function base64UrlDecode(segment) {
  return Buffer.from(segment, 'base64url');
}

async function verifyToken(token, expectedUse) {
  if (typeof token !== 'string' || !token) throw new Error('No token provided.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token.');
  const [headerB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error(`Unexpected algorithm "${header.alg}".`);

  const publicKey = await getGatewayPublicKey(header.kid);
  const signingInput = `${headerB64}.${payloadB64}`;
  const ok = cryptoVerify('RSA-SHA256', Buffer.from(signingInput), publicKey, base64UrlDecode(sigB64));
  if (!ok) throw new Error('Signature does not verify.');

  const claims = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  if (claims.token_use !== expectedUse) {
    throw new Error(`Expected "${expectedUse}" token, got "${claims.token_use}".`);
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) {
    throw new Error('Token has expired.');
  }
  if (claims.iss !== GATEWAY_URL) {
    throw new Error(`Token issuer "${claims.iss}" does not match gateway.`);
  }
  if (claims.aud !== SERVICE_ID) {
    throw new Error(`Token audience "${claims.aud}" was not minted for this service.`);
  }

  return claims;
}

// ---------------------------------------------------------------------------
// App session cookie (MICROAPP_AUTH §6) — HMAC-signed, HttpOnly, short-lived.
// ---------------------------------------------------------------------------

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readSession(value) {
  if (!value || typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  // An expired session is treated as absent (MICROAPP_AUTH §6).
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
  return payload;
}

function getCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function setSessionCookie(res, claims) {
  const payload = {
    sid: claims.sid,
    sub: claims.sub,
    email: claims.email,
    name: claims.name,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  };
  const secure = PUBLIC_URL.startsWith('https://') ? '; Secure' : '';
  res.setHeader(
    'set-cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(signSession(payload))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// MICROAPP_AUTH §5 — ask the gateway on every request, no cache, fail open.
async function gatewaySessionIsLive(session) {
  if (!session || !session.sid) return false;
  try {
    const response = await fetch(`${GATEWAY_URL}/oauth/introspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sid: session.sid, sub: session.sub })
    });
    if (!response.ok) return true; // fail open
    const { active } = await response.json();
    return Boolean(active);
  } catch {
    return true; // fail open — a briefly unreachable gateway must not lock everyone out
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function setNoStore(res) {
  res.setHeader('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('pragma', 'no-cache');
  res.setHeader('expires', '0');
}

// SS-5 — one error path for every non-2xx response.
function sendError(res, cid, status, code, message, details = null) {
  res.setHeader('content-type', 'application/json');
  return res.status(status).json({
    error: { code, message, correlation_id: cid, details }
  });
}

function matchRoutePath(pathname) {
  const cleanPath = pathname.replace(/\/+$/, '') || '/';
  if (openapiSpec.paths[cleanPath]) return cleanPath;
  if (/^\/api\/departments\/[^/]+$/.test(cleanPath)) return '/api/departments/{id}';
  if (/^\/api\/supervisors\/[^/]+$/.test(cleanPath)) return '/api/supervisors/{id}';
  return null;
}

// ---------------------------------------------------------------------------
// Base middleware
// ---------------------------------------------------------------------------

// SS-4 — reuse the caller's correlation id, mint one when absent, echo always.
app.use((req, res, next) => {
  const incoming = req.headers[CORRELATION_HEADER];
  req.cid = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : randomUUID();
  res.setHeader(CORRELATION_HEADER, req.cid);
  next();
});

app.use(cors());
app.use(express.json());

// The gateway resolves a relative app_url ("/") against our base URL and can
// emit "/.", "/./", "/..", "//" etc. Rewrite every root-variant to "/" BEFORE
// routing so the "Open app" button lands on the SPA instead of the 404 branch.
app.use((req, res, next) => {
  const p = req.path;
  if (p !== '/' && (/^\/(?:\.{1,2}\/?)$/.test(p) || /^\/{2,}$/.test(p))) {
    const q = req.originalUrl.indexOf('?');
    req.url = '/' + (q >= 0 ? req.originalUrl.slice(q) : '');
  }
  next();
});

// ---------------------------------------------------------------------------
// Public service documents (SS-2, SS-3)
// ---------------------------------------------------------------------------

app.get('/health', (req, res) => {
  res.setHeader('content-type', 'application/json');
  return res.status(200).json({
    status: 'ok',
    service: SERVICE_ID,
    version: VERSION,
    uptime_seconds: Math.floor(process.uptime()),
    checks: { database: isDbConnected() }
  });
});

app.get('/openapi.json', (req, res) => {
  res.setHeader('content-type', 'application/json');
  return res.status(200).json(openapiSpec);
});

// ---------------------------------------------------------------------------
// Browser shell + human sign-in flow (SS-24 / MICROAPP_AUTH §4)
// ---------------------------------------------------------------------------

function serveIndex(res) {
  setNoStore(res); // SS-7 — every authenticated page and auth redirect.
  res.setHeader('content-type', FRONTEND['index.html'].type);
  return res.status(200).send(FRONTEND['index.html'].body);
}

// "/" doubles as the OAuth redirect target: it is the registered app_url, so it
// is the only redirect_uri the gateway will send a code back to.
app.get('/', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  if (!code) return serveIndex(res);

  setNoStore(res);
  try {
    const tokenRes = await fetch(`${GATEWAY_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: `${PUBLIC_URL}/` })
    });
    if (!tokenRes.ok) return res.redirect('/auth/login');

    const tokenData = await tokenRes.json();
    // MICROAPP_AUTH §4 step 4 — the identity token comes back in `token`.
    const identityToken = tokenData.token || tokenData.id_token || tokenData.access_token;
    const claims = await verifyToken(identityToken, 'identity');

    setSessionCookie(res, claims);
    return res.redirect('/'); // clean URL — the code must not sit in history
  } catch (err) {
    return res.redirect('/auth/login');
  }
});

app.get('/index.html', (req, res) => res.redirect(308, '/'));

app.get('/app.js', (req, res) => {
  res.setHeader('content-type', FRONTEND['app.js'].type);
  return res.status(200).send(FRONTEND['app.js'].body);
});

app.get('/styles.css', (req, res) => {
  res.setHeader('content-type', FRONTEND['styles.css'].type);
  return res.status(200).send(FRONTEND['styles.css'].body);
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get('/auth/login', (req, res) => {
  setNoStore(res);
  const redirectUri = `${PUBLIC_URL}/`;
  return res.redirect(`${GATEWAY_URL}/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`);
});

// Kept for gateways configured with an explicit callback path; "/" is preferred.
app.get('/auth/callback', async (req, res) => {
  setNoStore(res);
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  if (!code) return res.redirect('/auth/login');
  try {
    const tokenRes = await fetch(`${GATEWAY_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: `${PUBLIC_URL}/auth/callback` })
    });
    if (!tokenRes.ok) return res.redirect('/auth/login');
    const tokenData = await tokenRes.json();
    const claims = await verifyToken(tokenData.token || tokenData.id_token || tokenData.access_token, 'identity');
    setSessionCookie(res, claims);
    return res.redirect('/');
  } catch (err) {
    return res.redirect('/auth/login');
  }
});

// Tells the SPA whether it has a live session. No sign-out endpoint — the
// gateway is the only place anyone signs out (SS-24).
app.get('/auth/me', async (req, res) => {
  setNoStore(res);
  const session = readSession(getCookie(req, SESSION_COOKIE));
  if (!session) return res.status(200).json({ authenticated: false });

  const live = await gatewaySessionIsLive(session);
  if (!live) {
    clearSessionCookie(res);
    return res.status(200).json({ authenticated: false });
  }
  return res.status(200).json({
    authenticated: true,
    user: { sub: session.sub, email: session.email, name: session.name },
    service: SERVICE_ID
  });
});

// ---------------------------------------------------------------------------
// API guard: 405 (SS-5) then auth (SS-6) then 404 (SS-5)
// ---------------------------------------------------------------------------

async function authorizeApiRequest(req, res, routeKey) {
  const methodKey = req.method.toLowerCase();
  const security = openapiSpec.paths[routeKey]?.[methodKey]?.security || [];
  const requiredScopes = security.flatMap((obj) => Object.values(obj)).flat();

  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');

  // Machine-to-machine (SS-6 / SS-26): a real access token + declared scopes.
  if (bearer) {
    let claims;
    try {
      claims = await verifyToken(bearer[1], 'access');
    } catch (err) {
      sendError(res, req.cid, 401, 'UNAUTHORIZED', String(err.message || err));
      return false;
    }
    const granted = new Set(String(claims.scope || '').split(/\s+/).filter(Boolean));
    const missing = requiredScopes.filter((sc) => !granted.has(sc));
    if (missing.length > 0) {
      sendError(res, req.cid, 403, 'FORBIDDEN', `This endpoint needs ${missing.join(', ')}.`, {
        required: requiredScopes,
        granted: [...granted]
      });
      return false;
    }
    req.caller = { kind: 'service', sub: claims.sub };
    return true;
  }

  // Human via the browser (SS-24): a signed session whose gateway session is
  // still live. Checked on every request, no cache.
  const session = readSession(getCookie(req, SESSION_COOKIE));
  if (session && (await gatewaySessionIsLive(session))) {
    req.caller = { kind: 'user', sub: session.sub, email: session.email };
    return true;
  }
  if (session) clearSessionCookie(res); // stale session -> lock

  sendError(res, req.cid, 401, 'UNAUTHORIZED', 'A bearer token is required.');
  return false;
}

app.use((req, res, next) => {
  const pathname = req.path.replace(/\/+$/, '') || '/';
  const routeKey = matchRoutePath(pathname);

  // SS-5 — path exists, verb does not. Before auth, so a wrong method is not
  // reported as an auth problem.
  if (routeKey) {
    const allowed = Object.keys(openapiSpec.paths[routeKey] || {}).map((m) => m.toUpperCase());
    if (!allowed.includes(req.method.toUpperCase())) {
      res.setHeader('allow', allowed.join(', '));
      return sendError(res, req.cid, 405, 'METHOD_NOT_ALLOWED', `${req.method} is not allowed on ${pathname}.`);
    }
  }

  if (PUBLIC_PATHS.has(pathname) || BROWSER_PATHS.has(pathname) || pathname.startsWith('/auth/')) {
    return next();
  }

  if (routeKey) {
    return void authorizeApiRequest(req, res, routeKey)
      .then((ok) => {
        if (ok) next();
      })
      .catch(() => sendError(res, req.cid, 500, 'INTERNAL_ERROR', 'Unexpected error.'));
  }

  // SS-5 — genuinely unrouted. The error envelope, never framework HTML.
  return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No route for ${pathname}.`);
});

// ---------------------------------------------------------------------------
// DEPARTMENT API
// ---------------------------------------------------------------------------

app.get('/api/departments', async (req, res) => {
  try {
    if (isDbConnected()) {
      const [rows] = await getPool().query('SELECT * FROM departments ORDER BY id ASC');
      return res.status(200).json(rows);
    }
    return res.status(200).json(inMemDepartments);
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

app.get('/api/departments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (isDbConnected()) {
      const [rows] = await getPool().query('SELECT * FROM departments WHERE id = ?', [id]);
      if (rows.length === 0) {
        return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No department with id '${id}'.`);
      }
      return res.status(200).json(rows[0]);
    }
    const dept = inMemDepartments.find((d) => d.id === id);
    if (!dept) return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No department with id '${id}'.`);
    return res.status(200).json(dept);
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

app.post('/api/departments', async (req, res) => {
  const { id, name, supervisorId, status } = req.body;
  if (!id || !name) {
    return sendError(res, req.cid, 422, 'VALIDATION_ERROR', 'Department ID and Name are required.', {
      fields: ['id', 'name']
    });
  }
  try {
    if (isDbConnected()) {
      await getPool().query('INSERT INTO departments (id, name, supervisorId, status) VALUES (?, ?, ?, ?)', [
        id,
        name,
        supervisorId || null,
        status || 'Active'
      ]);
      return res.status(201).json({ id, name, supervisorId: supervisorId || null, status: status || 'Active' });
    }
    if (inMemDepartments.find((d) => d.id === id)) {
      return sendError(res, req.cid, 409, 'CONFLICT', `Department with id '${id}' already exists.`);
    }
    const newDept = { id, name, supervisorId: supervisorId || null, status: status || 'Active' };
    inMemDepartments.push(newDept);
    return res.status(201).json(newDept);
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

app.put('/api/departments/:id', async (req, res) => {
  const { id } = req.params;
  const { name, supervisorId, status } = req.body;
  if (!name) {
    return sendError(res, req.cid, 422, 'VALIDATION_ERROR', 'Department Name is required.', { fields: ['name'] });
  }
  try {
    if (isDbConnected()) {
      const [result] = await getPool().query(
        'UPDATE departments SET name = ?, supervisorId = ?, status = ? WHERE id = ?',
        [name, supervisorId || null, status || 'Active', id]
      );
      if (result.affectedRows === 0) {
        return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No department with id '${id}'.`);
      }
      return res.status(200).json({ id, name, supervisorId: supervisorId || null, status: status || 'Active' });
    }
    const idx = inMemDepartments.findIndex((d) => d.id === id);
    if (idx === -1) return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No department with id '${id}'.`);
    inMemDepartments[idx] = { id, name, supervisorId: supervisorId || null, status: status || 'Active' };
    return res.status(200).json(inMemDepartments[idx]);
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

app.delete('/api/departments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (isDbConnected()) {
      const [result] = await getPool().query('DELETE FROM departments WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No department with id '${id}'.`);
      }
      return res.status(204).send();
    }
    const idx = inMemDepartments.findIndex((d) => d.id === id);
    if (idx === -1) return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No department with id '${id}'.`);
    inMemDepartments.splice(idx, 1);
    return res.status(204).send();
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

// ---------------------------------------------------------------------------
// SUPERVISOR API
// ---------------------------------------------------------------------------

app.get('/api/supervisors', async (req, res) => {
  try {
    if (isDbConnected()) {
      const [rows] = await getPool().query('SELECT * FROM supervisors ORDER BY id ASC');
      return res.status(200).json(rows);
    }
    return res.status(200).json(inMemSupervisors);
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

app.get('/api/supervisors/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (isDbConnected()) {
      const [rows] = await getPool().query('SELECT * FROM supervisors WHERE id = ?', [id]);
      if (rows.length === 0) {
        return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No supervisor with id '${id}'.`);
      }
      return res.status(200).json(rows[0]);
    }
    const sup = inMemSupervisors.find((s) => s.id === id);
    if (!sup) return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No supervisor with id '${id}'.`);
    return res.status(200).json(sup);
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

app.post('/api/supervisors', async (req, res) => {
  const { id, firstName, lastName, email, status } = req.body;
  if (!id || !firstName || !lastName) {
    return sendError(res, req.cid, 422, 'VALIDATION_ERROR', 'Supervisor ID, First Name, and Last Name are required.', {
      fields: ['id', 'firstName', 'lastName']
    });
  }
  try {
    if (isDbConnected()) {
      await getPool().query('INSERT INTO supervisors (id, firstName, lastName, email, status) VALUES (?, ?, ?, ?, ?)', [
        id,
        firstName,
        lastName,
        email || '',
        status || 'Active'
      ]);
      return res.status(201).json({ id, firstName, lastName, email: email || '', status: status || 'Active' });
    }
    if (inMemSupervisors.find((s) => s.id === id)) {
      return sendError(res, req.cid, 409, 'CONFLICT', `Supervisor with id '${id}' already exists.`);
    }
    const newSup = { id, firstName, lastName, email: email || '', status: status || 'Active' };
    inMemSupervisors.push(newSup);
    return res.status(201).json(newSup);
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

app.put('/api/supervisors/:id', async (req, res) => {
  const { id } = req.params;
  const { firstName, lastName, email, status } = req.body;
  if (!firstName || !lastName) {
    return sendError(res, req.cid, 422, 'VALIDATION_ERROR', 'Supervisor First Name and Last Name are required.', {
      fields: ['firstName', 'lastName']
    });
  }
  try {
    if (isDbConnected()) {
      const [result] = await getPool().query(
        'UPDATE supervisors SET firstName = ?, lastName = ?, email = ?, status = ? WHERE id = ?',
        [firstName, lastName, email || '', status || 'Active', id]
      );
      if (result.affectedRows === 0) {
        return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No supervisor with id '${id}'.`);
      }
      return res.status(200).json({ id, firstName, lastName, email: email || '', status: status || 'Active' });
    }
    const idx = inMemSupervisors.findIndex((s) => s.id === id);
    if (idx === -1) return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No supervisor with id '${id}'.`);
    inMemSupervisors[idx] = { id, firstName, lastName, email: email || '', status: status || 'Active' };
    return res.status(200).json(inMemSupervisors[idx]);
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

app.delete('/api/supervisors/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (isDbConnected()) {
      const [result] = await getPool().query('DELETE FROM supervisors WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No supervisor with id '${id}'.`);
      }
      return res.status(204).send();
    }
    const idx = inMemSupervisors.findIndex((s) => s.id === id);
    if (idx === -1) return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No supervisor with id '${id}'.`);
    inMemSupervisors.splice(idx, 1);
    return res.status(204).send();
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

// SS-5 — final catch-all. Always the envelope, never HTML.
app.use((req, res) => {
  return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No route for ${req.path}.`);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// Kick off the DB connection attempt regardless of how the module is loaded
// (a serverless host requires this file, it does not run it as main).
const dbReady = initDatabase().catch(() => null);

if (require.main === module) {
  dbReady.then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      const endpointCount = Object.keys(openapiSpec.paths).length;
      console.log('==================================================');
      console.log('SERVICE READY\n');
      console.log(`  Base URL     ${PUBLIC_URL}`);
      console.log(`  Service id   ${SERVICE_ID}`);
      console.log('  Domain       Human Resources');
      console.log('  Owner        hr-team');
      console.log(`  Endpoints    ${endpointCount}`);
      console.log(`  Start it     node server.js   (from ${__dirname})\n`);
      console.log('Next: open the gateway console -> Connect a service -> paste the Base URL.');
      console.log('==================================================');
    });
  });
}

module.exports = app;
