import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metric tracking
const peerReqDuration = new Trend('peer_req_duration');
const adminReqDuration = new Trend('admin_req_duration');
const dbScriptReqDuration = new Trend('db_script_req_duration');
const errorRate = new Rate('error_rate');

// Target Configuration:
// - Peer Load: 500 - 700 RPS (Read-heavy, cached queries)
// - Admin Load: 100 - 200 RPS (Batch ingest, CPU reports, PostgreSQL script writes & reads)
export const options = {
  scenarios: {
    // -------------------------------------------------------------
    // Scenario 1: Peer Users (Read-heavy, 500 - 700 RPS)
    // -------------------------------------------------------------
    peer_traffic: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 500,
      maxVUs: 1400,
      stages: [
        { target: 500, duration: '2m' },  // Ramp-up to 500 RPS
        { target: 700, duration: '11m' }, // Sustained peer load (500-700 RPS)
        { target: 0, duration: '2m' },    // Ramp-down
      ],
      exec: 'peerScenario',
    },

    // -------------------------------------------------------------
    // Scenario 2: Admin Users (Batch writes & PostgreSQL DB writes: 100 - 200 RPS)
    // -------------------------------------------------------------
    admin_traffic: {
      executor: 'ramping-arrival-rate',
      startRate: 20,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 400,
      stages: [
        { target: 100, duration: '2m' },  // Ramp-up to 100 RPS
        { target: 200, duration: '11m' }, // Sustained admin load (100-200 RPS)
        { target: 0, duration: '2m' },    // Ramp-down
      ],
      exec: 'adminScenario',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<350'],
    'peer_req_duration': ['p(95)<150'],
    'admin_req_duration': ['p(95)<450'],
    'error_rate': ['rate<0.02'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';

// ==========================================
// PEER USER FLOW (500 - 700 RPS)
// ==========================================
export function peerScenario() {
  const rand = Math.random();
  let res;

  if (rand < 0.45) {
    // 45% Feed requests (paginated, cache-aside)
    const page = Math.floor(Math.random() * 5) + 1;
    res = http.get(`${BASE_URL}/api/feed?page=${page}&limit=20`);
  } else if (rand < 0.75) {
    // 30% User profile queries (7,000 user pool)
    const userId = Math.floor(Math.random() * 7000) + 1;
    res = http.get(`${BASE_URL}/api/users/${userId}`);
  } else if (rand < 0.90) {
    // 15% Record item lookup
    const recordId = Math.floor(Math.random() * 10000) + 1;
    res = http.get(`${BASE_URL}/api/records/${recordId}`);
  } else {
    // 10% Search queries
    const terms = ['Engineering', 'Finance', 'System', 'metric', 'tag-3'];
    const q = terms[Math.floor(Math.random() * terms.length)];
    res = http.get(`${BASE_URL}/api/search?q=${q}`);
  }

  peerReqDuration.add(res.timings.duration);
  const ok = check(res, {
    'peer status is 200': (r) => r.status === 200,
  });
  if (!ok) errorRate.add(1);
}

// ==========================================
// ADMIN USER FLOW (100 - 200 RPS: includes PostgreSQL DB writes)
// ==========================================
export function adminScenario() {
  const rand = Math.random();
  let res;

  if (rand < 0.35) {
    // 35% ACTUAL POSTGRESQL DATABASE WRITE (Scripts table)
    const categories = ['Peer Load', 'Admin Heavy', 'Spike Test', 'Soak Test'];
    const scriptPayload = {
      title: `k6 Generated Script ${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      author_id: Math.floor(Math.random() * 700) + 1,
      category: categories[Math.floor(Math.random() * categories.length)],
      status: 'active',
      script_content: `// Automated benchmark scenario\nexport default function() { http.get("${BASE_URL}/api/feed"); }`,
    };

    res = http.post(
      `${BASE_URL}/api/scripts`,
      JSON.stringify(scriptPayload),
      { headers: { 'Content-Type': 'application/json' } }
    );
    dbScriptReqDuration.add(res.timings.duration);

  } else if (rand < 0.60) {
    // 25% Heavy bulk upload: 50 entries
    const batch = [];
    for (let i = 1; i <= 50; i++) {
      batch.push({
        title: `Batch Entry ${i} - ${Date.now()}`,
        category: 'Operations',
        authorId: Math.floor(Math.random() * 700) + 1,
        tags: ['bulk-test', 'load-testing'],
      });
    }

    res = http.post(
      `${BASE_URL}/api/admin/bulk-upload`,
      JSON.stringify({ records: batch }),
      { headers: { 'Content-Type': 'application/json' } }
    );

  } else if (rand < 0.85) {
    // 25% Heavy Report CPU digest generation
    res = http.post(
      `${BASE_URL}/api/admin/reports/generate`,
      JSON.stringify({
        title: `Comprehensive Audit Report - Batch ${Math.floor(Math.random() * 1000)}`,
        pages: 2,
        filterCategory: 'Engineering',
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );

  } else {
    // 15% Query PostgreSQL saved scripts or audit logs
    if (Math.random() < 0.5) {
      res = http.get(`${BASE_URL}/api/scripts?limit=20`);
    } else {
      res = http.get(`${BASE_URL}/api/admin/audit`);
    }
  }

  adminReqDuration.add(res.timings.duration);
  const ok = check(res, {
    'admin status is 200, 201 or 202': (r) => [200, 201, 202].includes(r.status),
  });
  if (!ok) errorRate.add(1);
}
