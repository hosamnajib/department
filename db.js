const mysql = require('mysql2/promise');
require('dotenv').config();

// Managed hosts (and Vercel's database integrations) usually inject a single
// connection string, not discrete DB_* vars. Accept the common names.
const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  process.env.MYSQL_URL ||
  process.env.MYSQL_PUBLIC_URL ||
  process.env.DB_URL ||
  null;

function parseConnectionString(str) {
  const u = new URL(str);
  return {
    host: decodeURIComponent(u.hostname),
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username || 'root'),
    password: decodeURIComponent(u.password || ''),
    database: u.pathname && u.pathname !== '/' ? decodeURIComponent(u.pathname.slice(1)) : undefined,
    // Providers flag TLS in the query string in a few different ways.
    sslFromUrl:
      u.protocol === 'mysqls:' ||
      u.searchParams.has('sslaccept') ||
      u.searchParams.get('sslmode') === 'require' ||
      /^(true|require|required|1|verify.*)$/i.test(u.searchParams.get('ssl') || '')
  };
}

function resolveSsl(sslFromUrl) {
  const mode = String(process.env.DB_SSL || '').toLowerCase();
  if (['false', 'disable', 'off', '0'].includes(mode)) return undefined;
  if (['strict', 'verify'].includes(mode)) return { rejectUnauthorized: true, minVersion: 'TLSv1.2' };
  if (['true', 'require', 'required', '1'].includes(mode) || sslFromUrl) {
    // Encrypt in transit without pinning the provider's CA chain.
    return { rejectUnauthorized: false, minVersion: 'TLSv1.2' };
  }
  return undefined;
}

let fromUrl = {};
if (CONNECTION_STRING) {
  try {
    fromUrl = parseConnectionString(CONNECTION_STRING);
  } catch (err) {
    console.warn(`Could not parse DB connection string (${err.message}); falling back to DB_* vars.`);
  }
}

const dbConfig = {
  host: fromUrl.host || process.env.DB_HOST || 'localhost',
  port: fromUrl.port || parseInt(process.env.DB_PORT, 10) || 3306,
  user: fromUrl.user || process.env.DB_USER || 'root',
  password: fromUrl.password ?? (process.env.DB_PASSWORD || process.env.DB_PASS || ''),
  connectTimeout: 10000
};

const ssl = resolveSsl(fromUrl.sslFromUrl);
if (ssl) dbConfig.ssl = ssl;

const dbName = fromUrl.database || process.env.DB_NAME || 'department_db';

let pool = null;
let isConnected = false;

const SUPERVISORS_TABLE = `
  CREATE TABLE IF NOT EXISTS supervisors (
    id VARCHAR(20) PRIMARY KEY,
    firstName VARCHAR(100) NOT NULL,
    lastName VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    status VARCHAR(20) DEFAULT 'Active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

const DEPARTMENTS_TABLE_FK = `
  CREATE TABLE IF NOT EXISTS departments (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    supervisorId VARCHAR(20),
    status VARCHAR(20) DEFAULT 'Active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (supervisorId) REFERENCES supervisors(id) ON DELETE SET NULL ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

const DEPARTMENTS_TABLE_NO_FK = `
  CREATE TABLE IF NOT EXISTS departments (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    supervisorId VARCHAR(20),
    status VARCHAR(20) DEFAULT 'Active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_supervisor_id (supervisorId)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

async function initDatabase() {
  console.log(`DB target ${dbConfig.host}:${dbConfig.port} db=${dbName} ssl=${Boolean(dbConfig.ssl)} source=${CONNECTION_STRING ? 'connection-string' : 'DB_* vars'}`);

  try {
    // 1. Connect to the server. Try to create the database, but do not treat a
    //    missing CREATE privilege (common on managed instances) as fatal.
    const bootstrap = await mysql.createConnection(dbConfig);
    try {
      await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    } catch (err) {
      console.warn(`Skipping CREATE DATABASE (${err.message}); assuming "${dbName}" already exists.`);
    }
    await bootstrap.end();

    // 2. Pool bound to the target database.
    pool = mysql.createPool({
      ...dbConfig,
      database: dbName,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    // 3. Tables. Fall back to a plain index if the host rejects foreign keys.
    await pool.query(SUPERVISORS_TABLE);
    try {
      await pool.query(DEPARTMENTS_TABLE_FK);
    } catch (err) {
      console.warn(`departments foreign key not supported (${err.message}); creating without it.`);
      await pool.query(DEPARTMENTS_TABLE_NO_FK);
    }

    // 4. Seed defaults only when empty.
    const [supRows] = await pool.query('SELECT COUNT(*) AS count FROM supervisors');
    if (supRows[0].count === 0) {
      await pool.query(`
        INSERT INTO supervisors (id, firstName, lastName, email, status) VALUES
        ('SUP-0007', 'Tauedea', 'Gabi', 'gabitautau@gmail.com', 'Active'),
        ('SUP-0008', 'Krisha', 'Lama', 'krilam@gmail.com', 'Active'),
        ('SUP-0003', 'Daniel', 'Lee', 'daniel.lee@example.com', 'Active'),
        ('SUP-0002', 'Aisyah', 'Rahman', 'aisyah.rahman@example.com', 'Active'),
        ('SUP-0001', 'Wei Jie', 'Tan', 'weijie.tan@example.com', 'Active');
      `);
    }

    const [deptRows] = await pool.query('SELECT COUNT(*) AS count FROM departments');
    if (deptRows[0].count === 0) {
      await pool.query(`
        INSERT INTO departments (id, name, supervisorId, status) VALUES
        ('DEP-0001', 'Software engineering', 'SUP-0007', 'Active'),
        ('DEP-0002', 'Human Resources', 'SUP-0008', 'Active'),
        ('DEP-0003', 'Marketing', 'SUP-0003', 'Active'),
        ('DEP-0004', 'Business Data & Analysis', 'SUP-0001', 'Active'),
        ('DEP-0005', 'Product & UX Design', 'SUP-0002', 'Active');
      `);
    }

    isConnected = true;
    console.log('MySQL database initialized successfully.');
    return pool;
  } catch (error) {
    console.warn(`MySQL connection failed (${error.code || 'ERR'}: ${error.message}). Running with in-memory fallback store.`);
    isConnected = false;
    pool = null;
    return null;
  }
}

function getPool() {
  return pool;
}

function isDbConnected() {
  return isConnected;
}

module.exports = {
  initDatabase,
  getPool,
  isDbConnected
};
