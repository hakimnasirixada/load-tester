import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metric tracking
const peerReqDuration = new Trend('peer_req_duration');
const adminReqDuration = new Trend('admin_req_duration');
const errorRate = new Rate('error_rate');

// Target Configuration:
// - ~1000 Total Active Concurrency
// - 90% Peers (300 - 500 RPS)
// - 10% Admins (50 - 100 RPS)
export const options = {
  scenarios: {
    // -------------------------------------------------------------
    // Scenario 1: Peer Users (Read-heavy, high frequency)
    // -------------------------------------------------------------
    peer_traffic: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 300,
      maxVUs: 900,
      stages: [
        { target: 300, duration: '2m' },  // Ramp-up to 300 RPS
        { target: 500, duration: '11m' }, // Sustained peer load (300-500 RPS)
        { target: 0, duration: '2m' },    // Ramp-down (Total: 15m)
      ],
      exec: 'peerScenario',
    },

    // -------------------------------------------------------------
    // Scenario 2: Admin Users (Heavy batch write & processing)
    // -------------------------------------------------------------
    admin_traffic: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 150,
      stages: [
        { target: 50, duration: '2m' },   // Ramp-up to 50 RPS
        { target: 100, duration: '11m' }, // Sustained admin load (50-100 RPS)
        { target: 0, duration: '2m' },    // Ramp-down (Total: 15m)
      ],
      exec: 'adminScenario',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<300'], // 95% of requests should be under 300ms
    'peer_req_duration': ['p(95)<150'],  // Peer reads should be fast (<150ms)
    'admin_req_duration': ['p(95)<400'], // Admin heavy requests (<400ms)
    'error_rate': ['rate<0.02'],         // Error rate below 2%
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';

// ==========================================
// PEER USER FLOW (Reads)
// ==========================================
export function peerScenario() {
  const rand = Math.random();

  let res;
  if (rand < 0.45) {
    // 45% Feed requests (paginated)
    const page = Math.floor(Math.random() * 5) + 1;
    res = http.get(`${BASE_URL}/api/feed?page=${page}&limit=20`);
  } else if (rand < 0.75) {
    // 30% User profile queries (7000 users pool)
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
// ADMIN USER FLOW (Heavy Writes / CPU)
// ==========================================
export function adminScenario() {
  const rand = Math.random();
  let res;

  if (rand < 0.40) {
    // 40% Heavy bulk upload: 50 entries
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
  } else if (rand < 0.75) {
    // 35% Heavy Report / PDF generation (CPU heavy, async job)
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
    // 25% Batch user update (50 users status changed)
    const updates = [];
    const statuses = ['active', 'idle', 'suspended'];
    for (let i = 1; i <= 50; i++) {
      updates.push({
        id: Math.floor(Math.random() * 7000) + 1,
        status: statuses[Math.floor(Math.random() * statuses.length)],
      });
    }

    res = http.put(
      `${BASE_URL}/api/admin/batch-update`,
      JSON.stringify({ updates }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  adminReqDuration.add(res.timings.duration);
  const ok = check(res, {
    'admin status is 200, 201 or 202': (r) => [200, 201, 202].includes(r.status),
  });
  if (!ok) errorRate.add(1);
}
