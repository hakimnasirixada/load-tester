const express = require('express');
const cache = require('./src/cache');
const queue = require('./src/queue');
const store = require('./src/store');

const app = express();
const PORT = process.env.PORT || 3000;

// High throughput body parser setup
app.use(express.json({ limit: '10mb' }));

// Tracking live server metrics for load testing insights
let totalRequests = 0;
let requestsLastSec = 0;
let currentRPS = 0;

setInterval(() => {
  currentRPS = requestsLastSec;
  requestsLastSec = 0;
}, 1000);

app.use((req, res, next) => {
  totalRequests++;
  requestsLastSec++;
  next();
});

// ==========================================
// 1. HEALTH & METRICS ENDPOINTS
// ==========================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/metrics', (req, res) => {
  const mem = process.memoryUsage();
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

// Start Express server
const server = app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(` Load Tester Express Server running on port ${PORT}`);
  console.log(` Health:  http://localhost:${PORT}/health`);
  console.log(` Metrics: http://localhost:${PORT}/metrics`);
  console.log(`===============================================`);
});

// Tune keep-alive timeouts for high concurrent load
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
