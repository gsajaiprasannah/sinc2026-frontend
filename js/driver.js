const API = ((window.SINC_CONFIG && window.SINC_CONFIG.API_BASE_URL) || '/api').replace(/\/$/, '');

// Separate token key so a driver login, host-member login, and admin login
// can all coexist in the same browser without clobbering each other.
const TOKEN_KEY = 'sinc_driver_token';
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

async function jget(url) {
  const r = await fetch(url, { headers: authHeaders() });
  if (r.status === 401) { handleUnauthorized(); throw new Error('Please log in again.'); }
  if (!r.ok) { const data = await r.json().catch(() => ({})); throw new Error(data.error || 'Request failed'); }
  return r.json();
}
async function jput(url, body) {
  const r = await fetch(url, { method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  if (r.status === 401) { handleUnauthorized(); throw new Error('Please log in again.'); }
  if (!r.ok) { const data = await r.json().catch(() => ({})); throw new Error(data.error || 'Request failed'); }
  return r.json();
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
// planned/in_progress/completed/cancelled -> reuse the closest existing pill colors
const STATUS_PILL = { planned: 'not_started', in_progress: 'in_progress', completed: 'completed', cancelled: 'pending' };
const STATUS_LABEL = { planned: 'Planned', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };

function renderProfile(p) {
  const el = document.getElementById('profileBody');
  if (!p) { el.innerHTML = '<div class="empty">Profile not found.</div>'; return; }
  el.innerHTML = `
    <div class="form-grid cols-3">
      <div><strong>${escapeHtml(p.name)}</strong><div class="hint">Name</div></div>
      <div>${escapeHtml(p.phone || '-')}<div class="hint">Phone</div></div>
      <div>${p.vehicle_code ? `${escapeHtml(p.vehicle_code)} <span class="hint">(${escapeHtml(p.vehicle_master_type || '')}, ${p.seating_capacity || 0} seats)</span>` : escapeHtml(`${p.vehicle_type || ''} ${p.vehicle_number || ''}`.trim() || 'No vehicle on file')}<div class="hint">Vehicle</div></div>
    </div>
    ${p.partner_name ? `<p class="hint" style="margin:8px 0 0;">Transport partner: ${escapeHtml(p.partner_name)}</p>` : ''}
  `;
}

function renderTrips(trips) {
  const el = document.getElementById('tripsBody');
  if (!trips.length) { el.innerHTML = '<div class="card"><div class="empty">No trips assigned to you yet.</div></div>'; return; }
  el.innerHTML = trips.map((t) => `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div>
          <strong>${escapeHtml(t.from_location)} → ${escapeHtml(t.to_location)}</strong>
          <div class="hint">${fmtDate(t.trip_date)}${t.depart_time ? ' · ' + escapeHtml(t.depart_time) : ''}${t.purpose ? ' · ' + escapeHtml(t.purpose) : ''}</div>
        </div>
        <span class="pill ${STATUS_PILL[t.status] || 'not_started'}">${STATUS_LABEL[t.status] || t.status}</span>
      </div>
      <p class="hint" style="margin:8px 0 4px;">Vehicle: ${t.vehicle_code ? escapeHtml(t.vehicle_code) + ` (${escapeHtml(t.vehicle_type || '')}, ${t.seating_capacity || 0} seats)` : 'Not set'} &middot; ${t.passenger_count} passenger(s)</p>
      ${t.passengers && t.passengers.length ? `
        <table>
          <thead><tr><th>Passenger</th><th>Phone</th><th>Pickup point</th></tr></thead>
          <tbody>
            ${t.passengers.map((p) => `
              <tr>
                <td>${escapeHtml(p.participant_name || p.host_member_name || '-')}${p.participant_code ? ' <span class="hint">(' + escapeHtml(p.participant_code) + ')</span>' : ''}</td>
                <td>${escapeHtml(p.participant_phone || p.host_member_phone || '-')}</td>
                <td>${escapeHtml(p.pickup_point || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p class="hint">No passengers listed for this trip.</p>'}
      <div class="field" style="margin-top:10px;max-width:220px;">
        <label>Update status</label>
        <select onchange="updateTripStatus(${t.id}, this.value)">
          ${['planned', 'in_progress', 'completed', 'cancelled'].map((s) => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
        </select>
      </div>
    </div>
  `).join('');
}

window.updateTripStatus = async (tripId, status) => {
  try {
    await jput(`${API}/driver-portal/trips/${tripId}`, { status });
    toast('Trip status updated');
    refreshMe();
  } catch (err) {
    toast(err.message);
  }
};

async function refreshMe() {
  try {
    const data = await jget(`${API}/driver-portal/me`);
    renderProfile(data.profile);
    renderTrips(data.trips || []);
  } catch (e) {
    console.error(e);
  }
}

// --- Auth gate ---
function showAuthGate() {
  document.getElementById('authGate').style.display = 'block';
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('logoutLink').style.display = 'none';
  document.getElementById('whoami').textContent = '';
}
let driverStarted = false;
function showApp() {
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  document.getElementById('logoutLink').style.display = '';
  document.getElementById('whoami').textContent = CURRENT_USER ? CURRENT_USER.username : '';
  if (driverStarted) return;
  driverStarted = true;
  refreshMe();
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
    if (data.user.role !== 'driver') {
      throw new Error('This login is not a driver account. Admins should use admin.html instead.');
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
    if (user.role !== 'driver') { setToken(''); showAuthGate(); return; }
    CURRENT_USER = user;
    showApp();
  } catch (e) {
    showAuthGate();
  }
}

tryResumeSession();
