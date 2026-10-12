const express = require('express');
const path = require('path');
const cache = require('./src/cache');
const queue = require('./src/queue');
const store = require('./src/store');
const db = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;

// High throughput body parser setup
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Tracking live server metrics & endpoint counters
let totalRequests = 0;
let requestsLastSec = 0;
let currentRPS = 0;
const endpointStats = new Map(); // endpoint -> { count, errors, lastAccess }

setInterval(() => {
  currentRPS = requestsLastSec;
  requestsLastSec = 0;
}, 1000);

// Request tracking middleware
app.use((req, res, next) => {
  totalRequests++;
  requestsLastSec++;

  const rawPath = req.baseUrl + req.path;
  // Normalize path pattern (e.g., /api/users/123 -> /api/users/:id)
  let normalizedPath = rawPath;
  if (/^\/api\/users\/\d+$/.test(rawPath)) normalizedPath = '/api/users/:id';
  else if (/^\/api\/records\/\d+$/.test(rawPath)) normalizedPath = '/api/records/:id';
  else if (/^\/api\/admin\/jobs\/[a-zA-Z0-9_-]+$/.test(rawPath)) normalizedPath = '/api/admin/jobs/:id';
  else if (/^\/api\/scripts\/\d+$/.test(rawPath)) normalizedPath = '/api/scripts/:id';

  const key = `${req.method} ${normalizedPath}`;
  const existing = endpointStats.get(key) || { count: 0, errors: 0, lastAccess: Date.now() };
  existing.count++;
  existing.lastAccess = Date.now();
  endpointStats.set(key, existing);

  res.on('finish', () => {
    if (res.statusCode >= 400) {
      existing.errors++;
    }
  });

  next();
});

// ==========================================
// 1. HEALTH & METRICS ENDPOINTS
// ==========================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/metrics', async (req, res) => {
  const mem = process.memoryUsage();

  // Convert endpointStats map to formatted array
  const endpointsList = [];
  for (const [ep, data] of endpointStats.entries()) {
    endpointsList.push({
      endpoint: ep,
      count: data.count,
      errors: data.errors,
      lastAccess: data.lastAccess,
    });
  }
  endpointsList.sort((a, b) => b.count - a.count);

  let scriptCount = 0;
  try {
    const scriptsData = await db.getScripts(1, 0);
    scriptCount = scriptsData.total;
  } catch (err) {
    // fallback if db is initializing
  }

  res.json({
    rps: currentRPS,
    totalRequests,
    uptimeSeconds: Math.floor(process.uptime()),
    cache: cache.getStats(),
    queue: queue.getStats(),
    memory: {
      rssMB: (mem.rss / 1024 / 1024).toFixed(2),
      heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(2),
      heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(2),
    },
    store: store.getAdminStats(),
    database: {
      type: 'PostgreSQL (Embedded PGlite)',
      scriptsStored: scriptCount,
    },
    endpoints: endpointsList,
  });
});

// ==========================================
// 2. PEER ENDPOINTS (Target: 300 - 500 RPS)
// Read-heavy, cached, fast execution
// ==========================================

// GET /api/feed - Paginated with in-memory caching
app.get('/api/feed', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const category = req.query.category || '';
  const cacheKey = `feed:${page}:${limit}:${category}`;

  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ source: 'cache', data: cached });
  }

  const result = store.getFeed(page, limit, category);
  cache.set(cacheKey, result, 10000); // 10s TTL
  res.json({ source: 'store', data: result });
});

// GET /api/users/:id - Fast user profile lookup with caching
app.get('/api/users/:id', (req, res) => {
  const userId = req.params.id;
  const cacheKey = `user:${userId}`;

  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ source: 'cache', data: cached });
  }

  const user = store.getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  cache.set(cacheKey, user, 30000); // 30s TTL
  res.json({ source: 'store', data: user });
});

// GET /api/records/:id - Individual item lookup
app.get('/api/records/:id', (req, res) => {
  const id = req.params.id;
  const cacheKey = `record:${id}`;

  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ source: 'cache', data: cached });
  }

  const record = store.getRecordById(id);
  if (!record) {
    return res.status(404).json({ error: 'Record not found' });
  }

  cache.set(cacheKey, record, 20000);
  res.json({ source: 'store', data: record });
});

// GET /api/search - Query string search
app.get('/api/search', (req, res) => {
  const q = req.query.q || '';
  if (!q) {
    return res.status(400).json({ error: 'Query parameter q is required' });
  }

  const cacheKey = `search:${q.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ source: 'cache', results: cached });
  }

  const results = store.searchRecords(q, 25);
  cache.set(cacheKey, results, 15000);
  res.json({ source: 'store', results });
});

// ==========================================
// 3. ADMIN ENDPOINTS (Target: 50 - 100 RPS)
// Heavy CPU, batch validation, 50-100 table entries
// ==========================================

// POST /api/admin/bulk-upload - 50-100 entries table ingestion
app.post('/api/admin/bulk-upload', (req, res) => {
  const records = req.body.records;
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'Body must contain an array of records' });
  }

  // Invalidate feed cache so new data reflects
  cache.clear();

  const inserted = store.batchInsertRecords(records);
  res.status(201).json({
    message: `Successfully ingested ${inserted.length} records`,
    count: inserted.length,
    sample: inserted.slice(0, 3),
  });
});

// POST /api/admin/reports/generate - Heavy CPU task (simulates multi-page PDF/export)
app.post('/api/admin/reports/generate', (req, res) => {
  const { title = 'Monthly Activity Report', pages = 2, filterCategory } = req.body;

  // Offload heavy computational job to async worker queue
  const jobId = queue.enqueue('REPORT_GENERATION', { title, pages, filterCategory }, async (payload) => {
    // Simulate CPU and formatting work (e.g. iterating records, calculating digests)
    const startTime = Date.now();
    let hashCalc = 0;
    for (let i = 0; i < 20000; i++) {
      hashCalc += Math.sqrt(i) * Math.sin(i);
    }

    return {
      title: payload.title,
      pagesGenerated: payload.pages,
      computedDigest: hashCalc.toFixed(4),
      timeSpentMs: Date.now() - startTime,
      downloadUrl: `/api/admin/reports/download/${jobId}`,
    };
  });

  // Non-blocking 202 Accepted response
  res.status(202).json({
    message: 'Report generation queued in background',
    jobId,
    statusCheckUrl: `/api/admin/jobs/${jobId}`,
  });
});

// GET /api/admin/jobs/:id - Status lookup for async queued jobs
app.get('/api/admin/jobs/:id', (req, res) => {
  const job = queue.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// PUT /api/admin/batch-update - Batch update 50-60 user records
app.put('/api/admin/batch-update', (req, res) => {
  const { updates } = req.body;
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'Body must contain array of updates {id, status, department}' });
  }

  const modifiedCount = store.batchUpdateUsers(updates);

  // Invalidate cached user profiles
  for (const up of updates) {
    cache.del(`user:${up.id}`);
  }

  res.json({
    message: `Batch update completed`,
    updatedCount: modifiedCount,
  });
});

// ==========================================
// 4. POSTGRESQL ADMIN SCRIPTS CRUD
// Admins write and manage load-testing scripts in actual DB
// ==========================================

// GET /api/scripts - List all scripts saved in PostgreSQL
app.get('/api/scripts', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const scripts = await db.getScripts(limit, offset);
    res.json(scripts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch scripts from PostgreSQL', details: err.message });
  }
});

// POST /api/scripts - Admin writes script to PostgreSQL
app.post('/api/scripts', async (req, res) => {
  try {
    const { title, script_content, author_id, category, status } = req.body;
    if (!title || !script_content) {
      return res.status(400).json({ error: 'title and script_content are required' });
    }

    const created = await db.createScript({
      title,
      script_content,
      author_id: author_id || 1,
      category: category || 'General',
      status: status || 'active',
    });

    await db.logAuditAction('CREATE_SCRIPT', '/api/scripts', 'admin', { scriptId: created.id, title });

    res.status(201).json({
      message: 'Script successfully saved to PostgreSQL database',
      script: created,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write script to PostgreSQL', details: err.message });
  }
});

// GET /api/scripts/:id - Get script details
app.get('/api/scripts/:id', async (req, res) => {
  try {
    const script = await db.getScriptById(req.params.id);
    if (!script) {
      return res.status(404).json({ error: 'Script not found' });
    }
    res.json(script);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read script', details: err.message });
  }
});

// DELETE /api/scripts/:id - Admin deletes script
app.delete('/api/scripts/:id', async (req, res) => {
  try {
    const deleted = await db.deleteScript(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Script not found' });
    }
    await db.logAuditAction('DELETE_SCRIPT', `/api/scripts/${req.params.id}`, 'admin', { scriptId: req.params.id });
    res.json({ message: 'Script removed from PostgreSQL', id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete script', details: err.message });
  }
});

// GET /api/admin/audit - Audit trail of admin actions
app.get('/api/admin/audit', async (req, res) => {
  try {
    const logs = await db.getRecentAuditLogs(25);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit logs', details: err.message });
  }
});

// Start Express server
const server = app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(` Load Tester Express Server running on port ${PORT}`);
  console.log(` Dashboard: http://localhost:${PORT}`);
  console.log(` Health:    http://localhost:${PORT}/health`);
  console.log(` Metrics:   http://localhost:${PORT}/metrics`);
  console.log(` Database:  PostgreSQL (PGlite persistence)`);
  console.log(`===============================================`);
});

// Tune keep-alive timeouts for high concurrent load
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

module.exports = app;
