const API = ((window.SINC_CONFIG && window.SINC_CONFIG.API_BASE_URL) || '/api').replace(/\/$/, '');
const HAS_BACKEND = !!(window.SINC_CONFIG && window.SINC_CONFIG.API_BASE_URL);

// This dashboard is now admin/super_admin only — see the login gate below.
// Separate token key from admin.js/host.js so all three logins can coexist
// in the same browser (e.g. testing) without clobbering each other.
const TOKEN_KEY = 'sinc_dashboard_token';
let CURRENT_USER = null;

function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }
function authHeaders(extra) {
  const h = Object.assign({}, extra || {});
  const t = getToken();
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
}

let toastTimer = null;
function toast(msg, durationMs) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), durationMs || 2200);
}

function handleUnauthorized() {
  setToken('');
  CURRENT_USER = null;
  showAuthGate();
  toast('Your session expired — please log in again.');
}

let clubChart, stateChart;

// Dashboard data routes now require an admin/super_admin session — send the
// token on every request, and bounce back to the login gate on a 401.
async function jget(url) {
  const r = await fetch(url, { headers: authHeaders() });
  if (r.status === 401) { handleUnauthorized(); throw new Error('Please log in again.'); }
  if (!r.ok) throw new Error('Request failed: ' + url);
  return r.json();
}

function fmtMoney(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN');
}

function renderOverview(s) {
  const cards = [
    { label: 'Total Members (All Clubs)', value: s.totalMembers },
    { label: 'Total Clubs', value: s.totalClubs },
    { label: 'Total Registrations', value: s.totalRegistrations },
    { label: 'Single Registrations', value: s.singleRegs },
    { label: 'Double Registrations', value: s.doubleRegs },
    { label: 'Congress Only Registrations', value: s.congressOnlyRegs || 0 },
    { label: 'Total Delegates (Double = 2)', value: s.totalParticipants }
  ];
  document.getElementById('statCards').innerHTML = cards.map((c) => `
    <div class="stat-card">
      <div class="value">${c.value}</div>
      <div class="label">${c.label}</div>
    </div>
  `).join('');
}

function renderClubComparison(rows) {
  const ctx = document.getElementById('clubChart');
  const labels = rows.map((r) => r.name.replace('Skål ', '').replace('Skal ', ''));
  const members = rows.map((r) => r.members_count);
  const regs = rows.map((r) => r.registrations);

  // Horizontal bar chart, sized to the number of clubs, inside a scrollable
  // wrapper (.chart-scroll) — keeps the card a fixed, page-friendly height
  // no matter how many clubs there are, instead of a giant rotated-label bar chart.
  const inner = document.getElementById('clubChartInner');
  const rowHeight = 26;
  inner.style.height = Math.max(rows.length * rowHeight + 30, 200) + 'px';

  if (clubChart) clubChart.destroy();
  clubChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Members', data: members, backgroundColor: '#314691', borderRadius: 3 },
        { label: 'Registrations', data: regs, backgroundColor: '#65A8DE', borderRadius: 3 }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { font: { size: 10 } } },
        y: { ticks: { autoSkip: false, font: { size: 10.5 } } }
      },
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } }
    }
  });

  document.getElementById('clubTableBody').innerHTML = rows.map((r) => `
    <tr>
      <td>${r.name}</td>
      <td>${r.state || '-'}</td>
      <td>${r.members_count}</td>
      <td>${r.registrations}</td>
      <td>${r.participants != null ? r.participants : '-'}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">No club data yet</td></tr>';
}

function renderNationwide(rows) {
  const ctx = document.getElementById('stateChart');
  if (stateChart) stateChart.destroy();
  stateChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: rows.map((r) => r.state || 'Unspecified'),
      datasets: [{
        data: rows.map((r) => r.members),
        backgroundColor: ['#314691', '#65A8DE', '#60CDD2', '#C65AD8', '#EDD945', '#70DBF3', '#59595B', '#8cc0e8', '#263875', '#dc2626']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 10 } } }
    }
  });
}

function renderDietary(rows) {
  const el = document.getElementById('dietCards');
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = '<div class="empty">No dietary data yet.</div>';
    return;
  }
  const total = rows.reduce((sum, r) => sum + (r.count || 0), 0) || 1;
  const classFor = (label) => (
    label === 'Vegetarian' ? 'diet-veg' : label === 'Non-vegetarian' ? 'diet-nonveg' : 'diet-none'
  );
  el.innerHTML = rows.map((r) => `
    <div class="stat-card ${classFor(r.label)}">
      <div class="value">${r.count}</div>
      <div class="label">${r.label} (${Math.round((r.count / total) * 100)}%)</div>
    </div>
  `).join('');
}

async function refreshStats() {
  if (!HAS_BACKEND) return;
  try {
    const [s, clubRows, nationRows] = await Promise.all([
      jget(`${API}/stats/overview`),
      jget(`${API}/stats/club-comparison`),
      jget(`${API}/stats/nationwide`)
    ]);
    renderOverview(s);
    renderClubComparison(clubRows);
    renderNationwide(nationRows);
    // Dietary breakdown is optional/newer — fetch separately so an older
    // backend without this endpoint doesn't break the rest of the dashboard.
    try {
      renderDietary(await jget(`${API}/stats/dietary`));
    } catch (e) {
      console.error('Dietary stats unavailable', e);
    }
  } catch (e) {
    console.error('Failed to load dashboard stats', e);
  }
}

// --- Auth gate: this dashboard is admin/super_admin only ---
function showAuthGate() {
  document.getElementById('authGate').style.display = 'block';
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('logoutLink').style.display = 'none';
  document.getElementById('whoami').textContent = '';
}

let dashboardStarted = false;
function showApp() {
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  document.getElementById('logoutLink').style.display = '';
  document.getElementById('whoami').textContent = CURRENT_USER ? CURRENT_USER.username : '';
  if (dashboardStarted) return; // don't re-register intervals on repeat logins
  dashboardStarted = true;
  refreshStats();
  setInterval(refreshStats, 30000);
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.style.display = 'none';
  const fd = new FormData(e.target);
  try {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(fd.entries()))
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Login failed');
    if (!['admin', 'super_admin'].includes(data.user.role)) {
      throw new Error('This dashboard is for admin accounts only. Host members should use the Host Member Login link above.');
    }
    setToken(data.token);
    CURRENT_USER = data.user;
    e.target.reset();
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
});

document.getElementById('logoutLink').addEventListener('click', (e) => {
  e.preventDefault();
  setToken('');
  CURRENT_USER = null;
  showAuthGate();
});

async function tryResumeSession() {
  const t = getToken();
  if (!t) { showAuthGate(); return; }
  try {
    const r = await fetch(`${API}/auth/me`, { headers: authHeaders() });
    if (!r.ok) { showAuthGate(); return; }
    const user = await r.json();
    if (!['admin', 'super_admin'].includes(user.role)) { setToken(''); showAuthGate(); return; }
    CURRENT_USER = user;
    showApp();
  } catch (e) {
    showAuthGate();
  }
}

if (HAS_BACKEND) {
  tryResumeSession();
} else {
  // No backend configured — login is impossible either way, so just show
  // the login gate (it'll simply fail if actually submitted).
  showAuthGate();
}
