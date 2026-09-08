const express = require('express');
const cors = require('cors');
const path = require('path');
const { createPublicKey, verify: cryptoVerify, randomUUID } = require('node:crypto');
require('dotenv').config();

const { initDatabase, getPool, isDbConnected } = require('./db');
const { SERVICE_ID, VERSION, openapiSpec } = require('./openapiSpec');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:4301';
const PUBLIC_URL = process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`;
const CORRELATION_HEADER = 'x-correlation-id';

// Public paths per SS-8 and Microapp Auth specification
const PUBLIC_PATHS = new Set([
  '/health',
  '/openapi.json',
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/auth/login',
  '/auth/callback',
  '/auth/me'
]);

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

// JWKS Cache per SS-25
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

// Token Verification per SS-25
async function verifyToken(token, expectedUse) {
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

// SS-4 Correlation ID & SS-5 Error Envelope Helper
app.use((req, res, next) => {
  const incomingCid = req.headers[CORRELATION_HEADER];
  req.cid = typeof incomingCid === 'string' && incomingCid.trim() ? incomingCid.trim() : randomUUID();
  res.setHeader(CORRELATION_HEADER, req.cid);
  next();
});

// SS-5 Standard Error Helper
function sendError(res, cid, status, code, message, details = null) {
  res.setHeader('content-type', 'application/json');
  return res.status(status).json({
    error: {
      code,
      message,
      correlation_id: cid,
      details
    }
  });
}

app.use(cors());
app.use(express.json());

// Serve Static Frontend Files
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    }
  }
}));

// SS-2: Health Check Endpoint
app.get('/health', async (req, res) => {
  res.setHeader('content-type', 'application/json');
  return res.status(200).json({
    status: 'ok',
    service: SERVICE_ID,
    version: VERSION,
    uptime_seconds: Math.floor(process.uptime()),
    checks: {
      database: isDbConnected()
    }
  });
});

// SS-3: OpenAPI Spec Endpoint
app.get('/openapi.json', (req, res) => {
  res.setHeader('content-type', 'application/json');
  return res.status(200).json(openapiSpec);
});

// Microapp Authentication Endpoints (MICROAPP_AUTH.md)
app.get('/auth/login', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  const redirectUri = `${PUBLIC_URL}/auth/callback`;
  const authUrl = `${GATEWAY_URL}/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  const code = req.query.code;
  if (!code) {
    return sendError(res, req.cid, 400, 'VALIDATION_ERROR', 'Authorization code missing.');
  }

  try {
    const tokenRes = await fetch(`${GATEWAY_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: `${PUBLIC_URL}/auth/callback` })
    });

    if (!tokenRes.ok) {
      return sendError(res, req.cid, 400, 'UNAUTHORIZED', 'Failed to exchange authorization code.');
    }

    const tokenData = await tokenRes.json();
    const claims = await verifyToken(tokenData.id_token || tokenData.access_token, 'identity');
    
    return res.json({ status: 'authenticated', user: claims });
  } catch (err) {
    return sendError(res, req.cid, 401, 'UNAUTHORIZED', err.message || 'Token verification failed.');
  }
});

app.get('/auth/me', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  return res.json({ status: 'ok', service: SERVICE_ID });
});

// Route Matcher Helper
function matchRoutePath(pathname) {
  if (openapiSpec.paths[pathname]) return pathname;
  if (/^\/api\/departments\/[^/]+$/.test(pathname)) return '/api/departments/{id}';
  if (/^\/api\/supervisors\/[^/]+$/.test(pathname)) return '/api/supervisors/{id}';
  return null;
}

// SS-5 & SS-6 Middleware: Handle Method Not Allowed (405) and Authentication (401/403)
app.use('/api/*', async (req, res, next) => {
  const urlPath = req.baseUrl;
  const routeSpecKey = matchRoutePath(urlPath);
  const method = req.method.toLowerCase();

  // SS-5: Unrouted API Path -> 404 Error Envelope
  if (!routeSpecKey) {
    return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No route for ${req.baseUrl}.`);
  }

  const allowedMethods = Object.keys(openapiSpec.paths[routeSpecKey] || {}).map((m) => m.toUpperCase());

  // SS-5: Wrong Method -> 405 Error Envelope + Allow Header
  if (!allowedMethods.includes(req.method.toUpperCase())) {
    res.setHeader('allow', allowedMethods.join(', '));
    return sendError(res, req.cid, 405, 'METHOD_NOT_ALLOWED', `${req.method} is not allowed on ${req.baseUrl}.`);
  }

  // SS-6 Security Check: If Authorization header is provided or required
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const match = /^Bearer\s+(\S+)$/i.exec(authHeader);
    if (!match) {
      return sendError(res, req.cid, 401, 'UNAUTHORIZED', 'A valid Bearer token is required.');
    }

    try {
      const claims = await verifyToken(match[1], 'access');
      req.userClaims = claims;

      // Scope Check
      const reqSecurity = openapiSpec.paths[routeSpecKey][method]?.security || [];
      const requiredScopes = reqSecurity.flatMap((reqObj) => Object.values(reqObj)).flat();
      const grantedScopes = new Set(String(claims.scope || '').split(/\s+/).filter(Boolean));
      const missingScopes = requiredScopes.filter((sc) => !grantedScopes.has(sc));

      if (missingScopes.length > 0) {
        return sendError(res, req.cid, 403, 'FORBIDDEN', `Missing required scope: ${missingScopes.join(', ')}.`, {
          required: requiredScopes,
          granted: [...grantedScopes]
        });
      }
    } catch (err) {
      return sendError(res, req.cid, 401, 'UNAUTHORIZED', String(err.message || err));
    }
  }

  next();
});

// --- DEPARTMENT API ENDPOINTS ---

// GET /api/departments
app.get('/api/departments', async (req, res) => {
  try {
    if (isDbConnected()) {
      const db = getPool();
      const [rows] = await db.query('SELECT * FROM departments ORDER BY id ASC');
      return res.status(200).json(rows);
    }
    return res.status(200).json(inMemDepartments);
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

// GET /api/departments/:id
app.get('/api/departments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (isDbConnected()) {
      const db = getPool();
      const [rows] = await db.query('SELECT * FROM departments WHERE id = ?', [id]);
      if (rows.length === 0) {
        return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No department with id '${id}'.`);
      }
      return res.status(200).json(rows[0]);
    }

    const dept = inMemDepartments.find((d) => d.id === id);
    if (!dept) {
      return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No department with id '${id}'.`);
    }
    return res.status(200).json(dept);
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

// POST /api/departments
app.post('/api/departments', async (req, res) => {
  const { id, name, supervisorId, status } = req.body;
  if (!id || !name) {
    return sendError(res, req.cid, 422, 'VALIDATION_ERROR', 'Department ID and Name are required.', {
      fields: ['id', 'name']
    });
  }

  try {
    if (isDbConnected()) {
      const db = getPool();
      await db.query('INSERT INTO departments (id, name, supervisorId, status) VALUES (?, ?, ?, ?)', [
        id,
        name,
        supervisorId || null,
        status || 'Active'
      ]);
      return res.status(201).json({ id, name, supervisorId: supervisorId || null, status: status || 'Active' });
    }

    const existing = inMemDepartments.find((d) => d.id === id);
    if (existing) {
      return sendError(res, req.cid, 409, 'CONFLICT', `Department with id '${id}' already exists.`);
    }

    const newDept = { id, name, supervisorId: supervisorId || null, status: status || 'Active' };
    inMemDepartments.push(newDept);
    return res.status(201).json(newDept);
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

// PUT /api/departments/:id
app.put('/api/departments/:id', async (req, res) => {
  const { id } = req.params;
  const { name, supervisorId, status } = req.body;

  if (!name) {
    return sendError(res, req.cid, 422, 'VALIDATION_ERROR', 'Department Name is required.', { fields: ['name'] });
  }

  try {
    if (isDbConnected()) {
      const db = getPool();
      const [result] = await db.query(
        'UPDATE departments SET name = ?, supervisorId = ?, status = ? WHERE id = ?',
        [name, supervisorId || null, status || 'Active', id]
      );
      if (result.affectedRows === 0) {
        return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No department with id '${id}'.`);
      }
      return res.status(200).json({ id, name, supervisorId: supervisorId || null, status: status || 'Active' });
    }

    const idx = inMemDepartments.findIndex((d) => d.id === id);
    if (idx === -1) {
      return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No department with id '${id}'.`);
    }

    inMemDepartments[idx] = { id, name, supervisorId: supervisorId || null, status: status || 'Active' };
    return res.status(200).json(inMemDepartments[idx]);
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

// DELETE /api/departments/:id (SS-10: missing ID is 404, never silent 204)
app.delete('/api/departments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (isDbConnected()) {
      const db = getPool();
      const [result] = await db.query('DELETE FROM departments WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No department with id '${id}'.`);
      }
      return res.status(204).send();
    }

    const idx = inMemDepartments.findIndex((d) => d.id === id);
    if (idx === -1) {
      return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No department with id '${id}'.`);
    }

    inMemDepartments.splice(idx, 1);
    return res.status(204).send();
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

// --- SUPERVISOR API ENDPOINTS ---

// GET /api/supervisors
app.get('/api/supervisors', async (req, res) => {
  try {
    if (isDbConnected()) {
      const db = getPool();
      const [rows] = await db.query('SELECT * FROM supervisors ORDER BY id ASC');
      return res.status(200).json(rows);
    }
    return res.status(200).json(inMemSupervisors);
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

// GET /api/supervisors/:id
app.get('/api/supervisors/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (isDbConnected()) {
      const db = getPool();
      const [rows] = await db.query('SELECT * FROM supervisors WHERE id = ?', [id]);
      if (rows.length === 0) {
        return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No supervisor with id '${id}'.`);
      }
      return res.status(200).json(rows[0]);
    }

    const sup = inMemSupervisors.find((s) => s.id === id);
    if (!sup) {
      return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No supervisor with id '${id}'.`);
    }
    return res.status(200).json(sup);
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

// POST /api/supervisors
app.post('/api/supervisors', async (req, res) => {
  const { id, firstName, lastName, email, status } = req.body;
  if (!id || !firstName || !lastName) {
    return sendError(res, req.cid, 422, 'VALIDATION_ERROR', 'Supervisor ID, First Name, and Last Name are required.', {
      fields: ['id', 'firstName', 'lastName']
    });
  }

  try {
    if (isDbConnected()) {
      const db = getPool();
      await db.query('INSERT INTO supervisors (id, firstName, lastName, email, status) VALUES (?, ?, ?, ?, ?)', [
        id,
        firstName,
        lastName,
        email || '',
        status || 'Active'
      ]);
      return res.status(201).json({ id, firstName, lastName, email: email || '', status: status || 'Active' });
    }

    const existing = inMemSupervisors.find((s) => s.id === id);
    if (existing) {
      return sendError(res, req.cid, 409, 'CONFLICT', `Supervisor with id '${id}' already exists.`);
    }

    const newSup = { id, firstName, lastName, email: email || '', status: status || 'Active' };
    inMemSupervisors.push(newSup);
    return res.status(201).json(newSup);
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

// PUT /api/supervisors/:id
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
      const db = getPool();
      const [result] = await db.query(
        'UPDATE supervisors SET firstName = ?, lastName = ?, email = ?, status = ? WHERE id = ?',
        [firstName, lastName, email || '', status || 'Active', id]
      );
      if (result.affectedRows === 0) {
        return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No supervisor with id '${id}'.`);
      }
      return res.status(200).json({ id, firstName, lastName, email: email || '', status: status || 'Active' });
    }

    const idx = inMemSupervisors.findIndex((s) => s.id === id);
    if (idx === -1) {
      return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No supervisor with id '${id}'.`);
    }

    inMemSupervisors[idx] = { id, firstName, lastName, email: email || '', status: status || 'Active' };
    return res.status(200).json(inMemSupervisors[idx]);
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

// DELETE /api/supervisors/:id (SS-10: missing ID is 404, never silent 204)
app.delete('/api/supervisors/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (isDbConnected()) {
      const db = getPool();
      const [result] = await db.query('DELETE FROM supervisors WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No supervisor with id '${id}'.`);
      }
      return res.status(204).send();
    }

    const idx = inMemSupervisors.findIndex((s) => s.id === id);
    if (idx === -1) {
      return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No supervisor with id '${id}'.`);
    }

    inMemSupervisors.splice(idx, 1);
    return res.status(204).send();
  } catch (err) {
    return sendError(res, req.cid, 500, 'INTERNAL_ERROR', err.message);
  }
});

// SS-5 Fallback 404 Handler for Unrouted Paths (Never HTML!)
app.use((req, res) => {
  return sendError(res, req.cid, 404, 'RESOURCE_NOT_FOUND', `No route for ${req.originalUrl}.`);
});

// Start Server and Print Section 5 Output Block
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    const endpointCount = Object.keys(openapiSpec.paths).length;
    console.log(`==================================================`);
    console.log(`SERVICE READY\n`);
    console.log(`  Base URL     ${PUBLIC_URL}`);
    console.log(`  Service id   ${SERVICE_ID}`);
    console.log(`  Domain       Human Resources`);
    console.log(`  Owner        hr-team`);
    console.log(`  Endpoints    ${endpointCount}`);
    console.log(`  Start it     node server.js   (from c:\\Users\\User\\Downloads\\department)\n`);
    console.log(`Next: open the gateway console -> Connect a service -> paste the Base URL.`);
    console.log(`==================================================`);
  });
});
