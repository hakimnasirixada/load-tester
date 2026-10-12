# Load Tester & Benchmark Project

A self-contained Node.js Express server designed to test and benchmark high-throughput peer traffic against heavy administrative loads with zero external dependencies (no Nginx or external Redis needed).

## Traffic & Architectural Profile

- **Total Users**: 7,000 registered accounts (pre-seeded).
- **Target Concurrency**: ~1,000 active concurrent users.
- **Peer Ratio (90%)**: ~300 – 500 requests/sec (read-heavy, low latency, cached).
- **Admin Ratio (10%)**: ~50 – 100 requests/sec (heavy batch inserts, CPU report computations, batch updates).

---

## Project Structure

```
load taster/
├── k6/
│   └── test-script.js       # k6 multi-scenario load test suite
├── src/
│   ├── cache.js             # High-performance in-memory LRU cache with TTL
│   ├── queue.js             # Non-blocking async queue for CPU-heavy tasks
│   ├── store.js             # In-memory indexed datastore (pre-seeded with 7,000 users)
│   └── simulator.js         # Built-in zero-dependency load generator
├── package.json
├── server.js                # Express web server & endpoints
└── README.md
```

---

## Getting Started

### 1. Start the Server
```bash
npm start
```
- **Web UI & Dashboard**: [http://localhost:3000](http://localhost:3000) (Live endpoint counters, traffic simulator, and PostgreSQL script manager)
- **Metrics Telemetry**: [http://localhost:3000/metrics](http://localhost:3000/metrics)
- **Health Check**: [http://localhost:3000/health](http://localhost:3000/health)

### 2. Available Endpoints

#### Peer Endpoints (Read-Heavy)
- `GET /api/feed?page=1&limit=20` (Paginated list with cache-aside)
- `GET /api/users/:id` (User profile lookup)
- `GET /api/records/:id` (Record item lookup)
- `GET /api/search?q=Engineering` (Search records)

#### Admin Endpoints (Heavy Tasks)
- `POST /api/admin/bulk-upload` (Batch inserts 50–100 records into feed)
- `POST /api/admin/reports/generate` (Enqueues heavy CPU digest & report generation)
- `GET /api/admin/jobs/:jobId` (Polls async queued job status)
- `PUT /api/admin/batch-update` (Batch updates 50+ users)

#### Telemetry & Metrics
- `GET /health` (Server status)
- `GET /metrics` (Live RPS, cache hit rate, queue status, memory consumption)

---

## Running the Load Tests

### Option A: Using Grafana k6
1. Install k6 on Windows:
   ```powershell
   winget install k6 --source winget
   # or with Chocolatey:
   choco install k6
   ```
2. Run the load test:
   ```bash
   k6 run k6/test-script.js
   ```

### Option B: Using the Built-In Node.js Simulator (No extra installations needed)
Run the native simulator while the server is running:
```bash
node src/simulator.js
```
