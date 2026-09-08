const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
  connectTimeout: 5000,
};

const dbName = process.env.DB_NAME || 'department_db';
let pool = null;
let isConnected = false;

async function initDatabase() {
  try {
    // 1. Attempt connection to MySQL Server
    const connection = await mysql.createConnection(dbConfig);
    console.log(`Connected to MySQL server at ${dbConfig.host}:${dbConfig.port}.`);

    // 2. Create Database if not exists
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    await connection.end();

    // 3. Create Connection Pool to department_db
    pool = mysql.createPool({
      ...dbConfig,
      database: dbName,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    // 4. Create Tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS supervisors (
        id VARCHAR(20) PRIMARY KEY,
        firstName VARCHAR(100) NOT NULL,
        lastName VARCHAR(100) NOT NULL,
        email VARCHAR(150) NOT NULL,
        status VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id VARCHAR(20) PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        supervisorId VARCHAR(20),
        status VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (supervisorId) REFERENCES supervisors(id) ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 5. Seed Default Supervisors if Empty
    const [supRows] = await pool.query('SELECT COUNT(*) as count FROM supervisors');
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

    // 6. Seed Default Departments if Empty
    const [deptRows] = await pool.query('SELECT COUNT(*) as count FROM departments');
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
    console.log('MySQL Database initialized successfully.');
    return pool;
  } catch (error) {
    console.warn(`MySQL Database connection notice (${error.message}). Will run with in-memory fallback store.`);
    isConnected = false;
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
