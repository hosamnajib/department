// Connection layer only. No web framework, no schema, no seed data — so this
// module is equally usable from a worker or a CLI (SS-15). Everything that
// touches the database goes through query(), and it is parameterised only.

const mysql = require('mysql2/promise');
require('dotenv').config();

// --- Configuration (SS-20): environment only. Accept a single connection
// string (what managed hosts / platform integrations inject) or discrete
// DB_* variables. Never inferred from a request. ---

const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  process.env.MYSQL_URL ||
  process.env.MYSQL_PUBLIC_URL ||
  process.env.DB_URL ||
  null;

function fromConnectionString(str) {
  const u = new URL(str);
  return {
    host: decodeURIComponent(u.hostname),
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username || 'root'),
    password: decodeURIComponent(u.password || ''),
    database: u.pathname && u.pathname !== '/' ? decodeURIComponent(u.pathname.slice(1)) : undefined,
    wantsSsl:
      u.protocol === 'mysqls:' ||
      u.searchParams.has('sslaccept') ||
      u.searchParams.get('sslmode') === 'require' ||
      /^(true|require|required|1|verify.*)$/i.test(u.searchParams.get('ssl') || '')
  };
}

function resolveSsl(wantsSsl) {
  const mode = String(process.env.DB_SSL || '').toLowerCase();
  if (['false', 'disable', 'off', '0'].includes(mode)) return undefined;
  if (['strict', 'verify'].includes(mode)) return { rejectUnauthorized: true, minVersion: 'TLSv1.2' };
  if (['true', 'require', 'required', '1'].includes(mode) || wantsSsl) {
    return { rejectUnauthorized: false, minVersion: 'TLSv1.2' };
  }
  return undefined;
}

const parsed = CONNECTION_STRING ? fromConnectionString(CONNECTION_STRING) : {};

const CONFIG = {
  host: parsed.host || process.env.DB_HOST || 'localhost',
  port: parsed.port || parseInt(process.env.DB_PORT, 10) || 3306,
  user: parsed.user || process.env.DB_USER || 'root',
  password: parsed.password ?? (process.env.DB_PASSWORD || process.env.DB_PASS || ''),
  database: parsed.database || process.env.DB_NAME || 'department_db',
  ssl: resolveSsl(parsed.wantsSsl)
};

// --- Pool: one per process, created lazily, rebuilt on demand after a fault.
// A small limit keeps a fleet of serverless instances from exhausting the
// database's own connection cap. ---

const POOL_LIMIT = Number(process.env.DB_POOL_LIMIT || 4);
let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: CONFIG.host,
      port: CONFIG.port,
      user: CONFIG.user,
      password: CONFIG.password,
      database: CONFIG.database,
      ssl: CONFIG.ssl,
      waitForConnections: true,
      connectionLimit: POOL_LIMIT,
      maxIdle: POOL_LIMIT,
      idleTimeout: 60000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      connectTimeout: 10000,
      multipleStatements: false,
      dateStrings: true
    });
  }
  return pool;
}

// The single entry point for SQL. Values are always bound, never interpolated.
async function query(sql, params = []) {
  const [result] = await getPool().query(sql, params);
  return result;
}

// Cheap liveness probe. Throws if the database cannot be reached.
async function ping() {
  await query('SELECT 1');
}

// Drop a faulted pool so the next getPool() builds a fresh one.
async function reset() {
  const dead = pool;
  pool = null;
  if (dead) {
    try {
      await dead.end();
    } catch {
      /* already broken */
    }
  }
}

// Non-secret summary for /health diagnostics.
function describe() {
  return {
    host: CONFIG.host,
    port: CONFIG.port,
    database: CONFIG.database,
    ssl: Boolean(CONFIG.ssl),
    source: CONNECTION_STRING ? 'connection-string' : 'DB_* vars'
  };
}

module.exports = { query, ping, reset, describe };
