// One-time, idempotent setup: create the tables if they are missing and seed
// them only when empty. Existing data on the configured database is left
// untouched. No web framework here either.

const { query } = require('./db');

const SUPERVISORS = `
  CREATE TABLE IF NOT EXISTS supervisors (
    id         VARCHAR(20)  NOT NULL PRIMARY KEY,
    firstName  VARCHAR(100) NOT NULL,
    lastName   VARCHAR(100) NOT NULL,
    email      VARCHAR(150) NOT NULL DEFAULT '',
    status     VARCHAR(20)  NOT NULL DEFAULT 'Active',
    created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const DEPARTMENTS_WITH_FK = `
  CREATE TABLE IF NOT EXISTS departments (
    id           VARCHAR(20)  NOT NULL PRIMARY KEY,
    name         VARCHAR(150) NOT NULL,
    supervisorId VARCHAR(20)  NULL,
    status       VARCHAR(20)  NOT NULL DEFAULT 'Active',
    created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_departments_supervisor (supervisorId),
    CONSTRAINT fk_departments_supervisor
      FOREIGN KEY (supervisorId) REFERENCES supervisors (id)
      ON DELETE SET NULL ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const DEPARTMENTS_NO_FK = `
  CREATE TABLE IF NOT EXISTS departments (
    id           VARCHAR(20)  NOT NULL PRIMARY KEY,
    name         VARCHAR(150) NOT NULL,
    supervisorId VARCHAR(20)  NULL,
    status       VARCHAR(20)  NOT NULL DEFAULT 'Active',
    created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_departments_supervisor (supervisorId)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const SEED_SUPERVISORS = [
  ['SUP-0001', 'Wei Jie', 'Tan', 'weijie.tan@example.com'],
  ['SUP-0002', 'Aisyah', 'Rahman', 'aisyah.rahman@example.com'],
  ['SUP-0003', 'Daniel', 'Lee', 'daniel.lee@example.com'],
  ['SUP-0007', 'Tauedea', 'Gabi', 'gabitautau@gmail.com'],
  ['SUP-0008', 'Krisha', 'Lama', 'krilam@gmail.com']
];

const SEED_DEPARTMENTS = [
  ['DEP-0001', 'Software engineering', 'SUP-0007'],
  ['DEP-0002', 'Human Resources', 'SUP-0008'],
  ['DEP-0003', 'Marketing', 'SUP-0003'],
  ['DEP-0004', 'Business Data & Analysis', 'SUP-0001'],
  ['DEP-0005', 'Product & UX Design', 'SUP-0002']
];

async function seedIfEmpty(table, insertSql, rows) {
  const countRows = await query(`SELECT COUNT(*) AS n FROM \`${table}\``);
  if (Number(countRows[0].n) > 0) return;
  for (const row of rows) {
    try {
      await query(insertSql, row);
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err; // lost the race with another instance
    }
  }
}

async function build() {
  await query(SUPERVISORS);
  try {
    await query(DEPARTMENTS_WITH_FK);
  } catch (err) {
    console.warn(`schema: foreign key unsupported (${err.code || err.message}); using a plain index.`);
    await query(DEPARTMENTS_NO_FK);
  }
  await seedIfEmpty(
    'supervisors',
    'INSERT INTO supervisors (id, firstName, lastName, email) VALUES (?, ?, ?, ?)',
    SEED_SUPERVISORS
  );
  await seedIfEmpty(
    'departments',
    'INSERT INTO departments (id, name, supervisorId) VALUES (?, ?, ?)',
    SEED_DEPARTMENTS
  );
}

let readyPromise = null;

// Runs once per process. Concurrent callers share the in-flight attempt; a
// failure clears the memo so the next caller retries.
function ensureReady() {
  if (!readyPromise) {
    readyPromise = build().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

module.exports = { ensureReady };
