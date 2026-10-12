/**
 * Built-in Load Simulator (Pure Node.js)
 * Useful when k6 isn't yet installed on the machine.
 * Generates simultaneous peer and admin loads while tracking RPS & latencies.
 */
const http = require('http');

const TARGET_HOST = 'localhost';
const TARGET_PORT = 3000;
const DURATION_SECONDS = 30;

const agent = new http.Agent({
  keepAlive: true,
  maxSockets: 500,
});

let totalSuccess = 0;
let totalFailed = 0;
let peerCount = 0;
let adminCount = 0;
const latencies = [];

function request(options, postData = null) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const duration = Date.now() - start;
        latencies.push(duration);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          totalSuccess++;
        } else {
          totalFailed++;
        }
        resolve();
      });
    });

    req.on('error', () => {
      totalFailed++;
      resolve();
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function simulatePeer() {
  peerCount++;
  const rand = Math.random();
  let path = '/api/feed?page=1&limit=20';

  if (rand < 0.4) {
    path = `/api/feed?page=${Math.floor(Math.random() * 5) + 1}&limit=20`;
  } else if (rand < 0.75) {
    path = `/api/users/${Math.floor(Math.random() * 7000) + 1}`;
  } else {
    path = `/api/records/${Math.floor(Math.random() * 10000) + 1}`;
  }

  await request({
    host: TARGET_HOST,
    port: TARGET_PORT,
    path,
    method: 'GET',
    agent,
  });
}

async function simulateAdmin() {
  adminCount++;
  const rand = Math.random();

  if (rand < 0.5) {
    // 50-item bulk upload
    const records = [];
    for (let i = 0; i < 50; i++) {
      records.push({ title: `Bulk Entry ${i}`, category: 'Operations' });
    }
    const data = JSON.stringify({ records });
    await request({
      host: TARGET_HOST,
      port: TARGET_PORT,
      path: '/api/admin/bulk-upload',
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, data);
  } else {
    // Heavy report generation
    const data = JSON.stringify({ title: 'System Report', pages: 2 });
    await request({
      host: TARGET_HOST,
      port: TARGET_PORT,
      path: '/api/admin/reports/generate',
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, data);
  }
}

async function run() {
  console.log(`Starting load simulation for ${DURATION_SECONDS}s against http://${TARGET_HOST}:${TARGET_PORT}...`);
  const startTime = Date.now();
  const endTime = startTime + (DURATION_SECONDS * 1000);

  // Target rates per second: Peer ~350 RPS, Admin ~60 RPS
  const PEER_RPS = 350;
  const ADMIN_RPS = 60;

  const interval = setInterval(() => {
    if (Date.now() >= endTime) {
      clearInterval(interval);
      return;
    }

    // Launch batch for this second slice
    for (let i = 0; i < Math.floor(PEER_RPS / 10); i++) simulatePeer();
    for (let i = 0; i < Math.floor(ADMIN_RPS / 10); i++) simulateAdmin();
  }, 100);

  await new Promise((r) => setTimeout(r, (DURATION_SECONDS + 1) * 1000));

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

  console.log('\n================ LOAD TEST RESULTS ================');
  console.log(`Duration:         ${DURATION_SECONDS} seconds`);
  console.log(`Total Requests:   ${totalSuccess + totalFailed}`);
  console.log(`  - Peer Requests:  ${peerCount}`);
  console.log(`  - Admin Requests: ${adminCount}`);
  console.log(`Success Rate:     ${(((totalSuccess) / (totalSuccess + totalFailed || 1)) * 100).toFixed(2)}%`);
  console.log(`Average RPS:      ${((totalSuccess + totalFailed) / DURATION_SECONDS).toFixed(2)} req/sec`);
  console.log(`Latency p50:      ${p50} ms`);
  console.log(`Latency p95:      ${p95} ms`);
  console.log(`Latency p99:      ${p99} ms`);
  console.log('====================================================\n');
}

run();
