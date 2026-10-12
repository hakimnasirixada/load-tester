/**
 * PostgreSQL Database Layer using @electric-sql/pglite
 * Full in-process PostgreSQL engine with persistent disk storage.
 */
const { PGlite } = require('@electric-sql/pglite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data', 'pgdata');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let dbInstance = null;

async function getDB() {
  if (!dbInstance) {
    dbInstance = new PGlite(dataDir);
    await initSchema(dbInstance);
  }
  return dbInstance;
}

async function initSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scripts (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      author_id INT DEFAULT 1,
      script_content TEXT NOT NULL,
      category VARCHAR(100) DEFAULT 'General',
      status VARCHAR(50) DEFAULT 'draft',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      action VARCHAR(100) NOT NULL,
      endpoint VARCHAR(255) NOT NULL,
      actor VARCHAR(50) DEFAULT 'admin',
      details JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_scripts_author ON scripts(author_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `);
}

/**
 * Admin writes a script to actual PostgreSQL database
 */
async function createScript({ title, script_content, author_id = 1, category = 'General', status = 'active' }) {
  const db = await getDB();
  const res = await db.query(
    `INSERT INTO scripts (title, script_content, author_id, category, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING *`,
    [title, script_content, author_id, category, status]
  );
  return res.rows[0];
}

/**
 * Get scripts from PostgreSQL database
 */
async function getScripts(limit = 50, offset = 0) {
  const db = await getDB();
  const countRes = await db.query('SELECT COUNT(*) as count FROM scripts');
  const total = parseInt(countRes.rows[0].count, 10);

  const res = await db.query(
    `SELECT * FROM scripts ORDER BY id DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return {
    total,
    items: res.rows,
  };
}

/**
 * Get single script by ID
 */
async function getScriptById(id) {
  const db = await getDB();
  const res = await db.query('SELECT * FROM scripts WHERE id = $1', [id]);
  return res.rows[0] || null;
}

/**
 * Delete script
 */
async function deleteScript(id) {
  const db = await getDB();
  const res = await db.query('DELETE FROM scripts WHERE id = $1 RETURNING id', [id]);
  return res.rows.length > 0;
}

/**
 * Log admin action into PostgreSQL
 */
async function logAuditAction(action, endpoint, actor = 'admin', details = {}) {
  const db = await getDB();
  await db.query(
    `INSERT INTO audit_logs (action, endpoint, actor, details, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [action, endpoint, actor, JSON.stringify(details)]
  );
}

/**
 * Get recent audit logs
 */
async function getRecentAuditLogs(limit = 20) {
  const db = await getDB();
  const res = await db.query(
    `SELECT * FROM audit_logs ORDER BY id DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

module.exports = {
  getDB,
  createScript,
  getScripts,
  getScriptById,
  deleteScript,
  logAuditAction,
  getRecentAuditLogs,
};
