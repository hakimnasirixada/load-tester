// Dashboard Frontend Controller
let refreshTimer = null;

// DOM Elements
const statRps = document.getElementById('stat-rps');
const statTotalRequests = document.getElementById('stat-total-requests');
const statUptime = document.getElementById('stat-uptime');
const statCacheHitrate = document.getElementById('stat-cache-hitrate');
const statCacheDetail = document.getElementById('stat-cache-detail');
const statQueueActive = document.getElementById('stat-queue-active');
const statQueueCompleted = document.getElementById('stat-queue-completed');
const statPgScripts = document.getElementById('stat-pg-scripts');
const endpointsTbody = document.getElementById('endpoints-tbody');
const totalEndpointsCount = document.getElementById('total-endpoints-count');
const refreshSelect = document.getElementById('refresh-interval-select');
const btnManualRefresh = document.getElementById('btn-manual-refresh');

// Tab Navigation
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    tabButtons.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const target = document.getElementById(`tab-${btn.dataset.tab}`);
    if (target) target.classList.add('active');

    if (btn.dataset.tab === 'database') loadScripts();
    if (btn.dataset.tab === 'system') loadAuditLogs();
  });
});

// Toast Notifications
function showToast(message, type = 'success') {
  const root = document.getElementById('toast-root');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : '⚠'}</span> <span>${message}</span>`;
  root.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Fetch and update metrics
async function fetchMetrics() {
  try {
    const res = await fetch('/metrics');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    renderMetrics(data);
  } catch (err) {
    const badge = document.getElementById('server-status-badge');
    const badgeText = document.getElementById('server-status-text');
    if (badge && badgeText) {
      badge.style.background = 'rgba(244, 63, 94, 0.15)';
      badge.style.borderColor = 'rgba(244, 63, 94, 0.4)';
      badge.style.color = 'var(--accent-rose)';
      badgeText.textContent = 'CONNECTING...';
    }
  }
}

function renderMetrics(data) {
  // Top KPIs
  statRps.innerHTML = `${data.rps} <span style="font-size:1rem;color:var(--text-dim)">RPS</span>`;
  statTotalRequests.textContent = Number(data.totalRequests).toLocaleString();

  const mins = Math.floor(data.uptimeSeconds / 60);
  const secs = data.uptimeSeconds % 60;
  statUptime.textContent = `Uptime: ${mins}m ${secs}s`;

  if (data.cache) {
    statCacheHitrate.textContent = `${data.cache.hitRate || '0.0%'}`;
    statCacheDetail.textContent = `${data.cache.hits || 0} hits / ${data.cache.misses || 0} misses (size: ${data.cache.size || 0})`;
  }

  if (data.queue) {
    statQueueActive.innerHTML = `${data.queue.queuedJobs} <span style="font-size:1rem;color:var(--text-dim)">queued</span>`;
    statQueueCompleted.textContent = `Completed: ${data.queue.completedJobs} (Active: ${data.queue.activeWorkers})`;
  }

  if (data.database) {
    statPgScripts.textContent = data.database.scriptsStored || 0;
  }

  // System Tab Details
  const memRss = document.getElementById('sys-mem-rss');
  const memHeap = document.getElementById('sys-mem-heap');
  if (memRss && data.memory) memRss.textContent = `${data.memory.rssMB} MB`;
  if (memHeap && data.memory) memHeap.textContent = `${data.memory.heapUsedMB} MB / ${data.memory.heapTotalMB} MB`;

  // Render Endpoint breakdown
  if (data.endpoints && Array.isArray(data.endpoints)) {
    totalEndpointsCount.textContent = `${data.endpoints.length} Routes Monitored`;

    if (data.endpoints.length === 0) {
      endpointsTbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:24px;">No requests captured yet. Trigger requests or run the traffic generator below!</td></tr>`;
      return;
    }

    const totalCalls = data.endpoints.reduce((sum, e) => sum + e.count, 0) || 1;

    endpointsTbody.innerHTML = data.endpoints.map(ep => {
      const parts = ep.endpoint.split(' ');
      const method = parts[0] || 'GET';
      const route = parts.slice(1).join(' ') || ep.endpoint;
      const percentage = ((ep.count / totalCalls) * 100).toFixed(1);
      const timeAgo = formatTimeAgo(ep.lastAccess);

      return `
        <tr>
          <td>
            <span class="method-tag method-${method}">${method}</span>
            <span style="font-weight:600; margin-left: 8px;">${route}</span>
          </td>
          <td>
            <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text-dim); margin-bottom:4px;">
              <span>${percentage}%</span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${percentage}%"></div>
            </div>
          </td>
          <td style="font-family:'JetBrains Mono'; font-weight:700;">${ep.count.toLocaleString()}</td>
          <td style="font-family:'JetBrains Mono'; color:${ep.errors > 0 ? 'var(--accent-rose)' : 'var(--text-dim)'};">${ep.errors}</td>
          <td style="color:var(--text-muted); font-size:0.8rem;">${timeAgo}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="testEndpoint('${method}', '${route}')">Send 1x</button>
          </td>
        </tr>
      `;
    }).join('');
  }
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '-';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  return `${diffMin}m ago`;
}

// Configurable Polling Interval
function updatePolling() {
  if (refreshTimer) clearInterval(refreshTimer);
  const intervalMs = parseInt(refreshSelect.value, 10);
  if (intervalMs > 0) {
    refreshTimer = setInterval(fetchMetrics, intervalMs);
  }
}

refreshSelect.addEventListener('change', () => {
  updatePolling();
  fetchMetrics();
});

btnManualRefresh.addEventListener('click', () => {
  fetchMetrics();
  loadScripts();
});

// Trigger Single Endpoint Test
window.testEndpoint = async function(method, route) {
  let targetUrl = route;
  if (targetUrl.includes(':id')) targetUrl = targetUrl.replace(':id', '1');
  try {
    const res = await fetch(targetUrl, { method });
    showToast(`${method} ${targetUrl} → Status ${res.status}`);
    fetchMetrics();
  } catch (err) {
    showToast(`Failed calling ${route}: ${err.message}`, 'error');
  }
};

// ==========================================
// PostgreSQL Script Management
// ==========================================
const scriptForm = document.getElementById('create-script-form');
const scriptsListContainer = document.getElementById('scripts-list-container');
const btnRefreshScripts = document.getElementById('btn-refresh-scripts');
const btnLoadTemplate = document.getElementById('btn-load-template');

if (btnLoadTemplate) {
  btnLoadTemplate.addEventListener('click', () => {
    document.getElementById('script-title').value = 'High Throughput Peer Benchmark';
    document.getElementById('script-category').value = 'Peer Load';
    document.getElementById('script-content').value = `import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 200 },
    { duration: '30s', target: 500 },
    { duration: '10s', target: 0 },
  ],
};

export default function () {
  const res = http.get('http://localhost:3000/api/feed?page=1&limit=20');
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(0.05);
}`;
  });
}

if (scriptForm) {
  scriptForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSave = document.getElementById('btn-save-script');
    btnSave.disabled = true;
    btnSave.textContent = 'Saving to PostgreSQL...';

    const payload = {
      title: document.getElementById('script-title').value.trim(),
      category: document.getElementById('script-category').value,
      status: document.getElementById('script-status').value,
      script_content: document.getElementById('script-content').value.trim(),
      author_id: 1,
    };

    try {
      const res = await fetch('/api/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed saving script');
      }

      showToast(`Script written to PostgreSQL database!`);
      scriptForm.reset();
      loadScripts();
      fetchMetrics();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = '💾 Write Script to PostgreSQL';
    }
  });
}

if (btnRefreshScripts) {
  btnRefreshScripts.addEventListener('click', loadScripts);
}

async function loadScripts() {
  if (!scriptsListContainer) return;
  scriptsListContainer.innerHTML = `<p style="color:var(--text-dim);font-size:0.85rem;">Querying PostgreSQL database...</p>`;

  try {
    const res = await fetch('/api/scripts');
    const data = await res.json();

    if (!data.items || data.items.length === 0) {
      scriptsListContainer.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-dim); background: rgba(255,255,255,0.02); border-radius: var(--radius-sm);">
          No scripts saved in PostgreSQL yet.<br>Create your first benchmark script using the form on the left!
        </div>
      `;
      return;
    }

    scriptsListContainer.innerHTML = data.items.map(s => `
      <div style="background:var(--bg-surface-elevated); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:16px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
          <div>
            <div style="font-weight:700; font-size:0.95rem; color:var(--text-main);">${escapeHtml(s.title)}</div>
            <div style="font-size:0.75rem; color:var(--text-dim); margin-top:2px;">
              <span class="card-badge" style="background:rgba(59,130,246,0.15); color:var(--accent-cyan);">${escapeHtml(s.category)}</span>
              <span style="margin-left:6px;">ID #${s.id}</span> • <span>${new Date(s.created_at).toLocaleString()}</span>
            </div>
          </div>
          <button class="btn btn-danger btn-sm" onclick="deleteScript(${s.id})">Delete</button>
        </div>
        <pre style="background:#0a0e17; padding:10px; border-radius:6px; font-family:'JetBrains Mono',monospace; font-size:0.78rem; color:#93c5fd; overflow-x:auto; max-height:100px;">${escapeHtml(s.script_content)}</pre>
      </div>
    `).join('');
  } catch (err) {
    scriptsListContainer.innerHTML = `<p style="color:var(--accent-rose);">Error querying PostgreSQL: ${err.message}</p>`;
  }
}

window.deleteScript = async function(id) {
  if (!confirm(`Delete script #${id} from PostgreSQL database?`)) return;
  try {
    const res = await fetch(`/api/scripts/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    showToast(`Script #${id} deleted from PostgreSQL`);
    loadScripts();
    fetchMetrics();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

async function loadAuditLogs() {
  const container = document.getElementById('audit-log-container');
  if (!container) return;
  try {
    const res = await fetch('/api/admin/audit');
    const logs = await res.json();
    if (!logs || logs.length === 0) {
      container.innerHTML = '<p style="color:var(--text-dim);padding:10px;">No audit records found in PostgreSQL.</p>';
      return;
    }
    container.innerHTML = logs.map(l => `
      <div style="padding:8px 12px; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between;">
        <div>
          <span style="font-weight:600; color:var(--accent-cyan); font-family:'JetBrains Mono';">${escapeHtml(l.action)}</span>
          <span style="color:var(--text-dim); margin-left:6px;">${escapeHtml(l.endpoint)}</span>
        </div>
        <div style="color:var(--text-dim); font-size:0.75rem;">${new Date(l.created_at).toLocaleTimeString()}</div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p style="color:var(--accent-rose);">Failed to load audit logs: ${err.message}</p>`;
  }
}

// ==========================================
// Traffic Burst Generators
// ==========================================
document.getElementById('btn-burst-peer')?.addEventListener('click', async () => {
  showToast('Firing 100 concurrent peer requests...');
  const promises = [];
  for (let i = 0; i < 100; i++) {
    const target = i % 3 === 0 ? '/api/feed?page=1&limit=20' : (i % 3 === 1 ? `/api/users/${(i % 50) + 1}` : `/api/records/${(i % 100) + 1}`);
    promises.push(fetch(target).catch(() => {}));
  }
  await Promise.all(promises);
  fetchMetrics();
});

document.getElementById('btn-burst-admin')?.addEventListener('click', async () => {
  showToast('Ingesting 50 batch records via admin endpoint...');
  const records = [];
  for (let i = 1; i <= 50; i++) {
    records.push({ title: `UI Ingested Record ${Date.now()}-${i}`, category: 'Engineering' });
  }
  try {
    const res = await fetch('/api/admin/bulk-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records }),
    });
    const data = await res.json();
    showToast(data.message || 'Bulk upload complete');
    fetchMetrics();
  } catch (err) {
    showToast(`Bulk upload failed: ${err.message}`, 'error');
  }
});

document.getElementById('btn-burst-report')?.addEventListener('click', async () => {
  showToast('Enqueuing background CPU report generation...');
  try {
    const res = await fetch('/api/admin/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Performance Executive Report', pages: 3 }),
    });
    const data = await res.json();
    showToast(`Job queued! ID: ${data.jobId}`);
    fetchMetrics();
  } catch (err) {
    showToast(`Report queue failed: ${err.message}`, 'error');
  }
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Initial bootstrap
fetchMetrics();
updatePolling();
loadScripts();
