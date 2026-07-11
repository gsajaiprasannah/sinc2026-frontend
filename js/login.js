const API = ((window.SINC_CONFIG && window.SINC_CONFIG.API_BASE_URL) || '/api').replace(/\/$/, '');
const MEDIA_ORIGIN = API.replace(/\/api\/?$/, '');

// One shared token key for every non-admin role now that host member,
// media, transporter, and driver logins all land on this single page.
const TOKEN_KEY = 'sinc_portal_token';
let CURRENT_USER = null;

// One-time migration: if someone was already signed in via the old
// separate host.html/media.html/driver.html/transporter.html pages,
// pick up their still-valid token so this consolidation doesn't log
// anyone out.
(function migrateLegacyTokens() {
  if (localStorage.getItem(TOKEN_KEY)) return;
  ['sinc_host_token', 'sinc_media_token', 'sinc_driver_token', 'sinc_transporter_token'].forEach((k) => {
    if (localStorage.getItem(TOKEN_KEY)) return;
    const v = localStorage.getItem(k);
    if (v) localStorage.setItem(TOKEN_KEY, v);
  });
})();

function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }
function authHeaders(extra) {
  const h = Object.assign({}, extra || {});
  const t = getToken();
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
}
function mediaUrl(p) {
  if (!p) return p;
  if (/^https?:\/\//.test(p)) return p;
  return MEDIA_ORIGIN + p;
}

let toastTimer = null;
function toast(msg, durationMs) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), durationMs || 2200);
}

class UnauthorizedError extends Error {}
function handleUnauthorized() {
  setToken('');
  CURRENT_USER = null;
  showAuthGate();
  toast('Your session expired — please log in again.');
}

async function jget(url) {
  const r = await fetch(url, { headers: authHeaders() });
  if (r.status === 401) { handleUnauthorized(); throw new UnauthorizedError('Please log in again.'); }
  if (!r.ok) {
    const text = await r.text();
    try { throw new Error(JSON.parse(text).error || text); } catch (parseErr) {
      if (parseErr instanceof SyntaxError) throw new Error(text);
      throw parseErr;
    }
  }
  return r.json();
}
async function jput(url, body) {
  const r = await fetch(url, { method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  if (r.status === 401) { handleUnauthorized(); throw new UnauthorizedError('Please log in again.'); }
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch (e) {
    throw new Error(!r.ok
      ? `Server returned HTTP ${r.status} instead of JSON — the backend may not have this endpoint deployed yet.`
      : 'Server returned an unexpected (non-JSON) response.');
  }
  if (!r.ok) { const err = new Error(data.error || `Request failed (HTTP ${r.status})`); err.data = data; err.status = r.status; throw err; }
  return data;
}
async function jpost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  if (r.status === 401) { handleUnauthorized(); throw new UnauthorizedError('Please log in again.'); }
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch (e) {
    throw new Error(!r.ok
      ? `Server returned HTTP ${r.status} instead of JSON — the backend may not have this endpoint deployed yet.`
      : 'Server returned an unexpected (non-JSON) response.');
  }
  if (!r.ok) { const err = new Error(data.error || `Request failed (HTTP ${r.status})`); err.data = data; err.status = r.status; throw err; }
  return data;
}
async function jdel(url) {
  const r = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  if (r.status === 401) { handleUnauthorized(); throw new UnauthorizedError('Please log in again.'); }
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch (e) {
    throw new Error(!r.ok
      ? `Server returned HTTP ${r.status} instead of JSON — the backend may not have this endpoint deployed yet.`
      : 'Server returned an unexpected (non-JSON) response.');
  }
  if (!r.ok) { const err = new Error(data.error || `Request failed (HTTP ${r.status})`); err.data = data; err.status = r.status; throw err; }
  return data;
}
async function uploadFile(url, formEl) {
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: authHeaders(), body: new FormData(formEl) });
  } catch (networkErr) {
    throw new Error('Upload failed — the connection was interrupted. Check your internet connection and try again.');
  }
  if (r.status === 401) { handleUnauthorized(); throw new UnauthorizedError('Please log in again.'); }
  let data;
  try { data = await r.json(); } catch (e) { throw new Error(`Server returned an unexpected response (status ${r.status}). Please try again.`); }
  if (!r.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

async function uploadFileBlob(url, file) {
  const fd = new FormData();
  fd.append('file', file);
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: authHeaders(), body: fd });
  } catch (networkErr) {
    throw new Error('Upload failed — the connection was interrupted. Check your internet connection and try again.');
  }
  if (r.status === 401) { handleUnauthorized(); throw new UnauthorizedError('Please log in again.'); }
  let data;
  try { data = await r.json(); } catch (e) { throw new Error(`Server returned an unexpected response (status ${r.status}). Please try again.`); }
  if (!r.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

// Shared hidden file inputs for a vendor's product photo — re-targeted per
// click via vendorPhotoTargetId, same pattern as admin.js's imgUploadInput.
let vendorPhotoTargetId = null;
async function handleVendorPhotoPicked(e) {
  const file = e.target.files[0];
  const productId = vendorPhotoTargetId;
  e.target.value = '';
  vendorPhotoTargetId = null;
  if (!file || !productId) return;
  try {
    await uploadFileBlob(`${API}/vendor-portal/products/${productId}/photo`, file);
    toast('Product photo updated');
    loadVendorMe();
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) toast(err.message);
  }
}
const vendorProductCameraInput = document.getElementById('vendorProductCameraInput');
const vendorProductFileInput = document.getElementById('vendorProductFileInput');
if (vendorProductCameraInput) vendorProductCameraInput.addEventListener('change', handleVendorPhotoPicked);
if (vendorProductFileInput) vendorProductFileInput.addEventListener('change', handleVendorPhotoPicked);
window.triggerVendorProductCamera = (id) => { vendorPhotoTargetId = id; vendorProductCameraInput.click(); };
window.triggerVendorProductUpload = (id) => { vendorPhotoTargetId = id; vendorProductFileInput.click(); };

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Shared pickup/drop point suggestions (Transport Planning module) ---
// Mirrors admin.js's version of this — same #transportPointsList datalist,
// same "quietly remember whatever gets typed" behavior — but reads/writes
// through the committee's own portal-modules mount, gated behind the
// transport_planning module grant. Only ever called once that module has
// been selected, so a committee without transport_planning access never
// even attempts the request.
let TRANSPORT_POINTS_CACHE = [];
function renderTransportPointsDatalist() {
  const dl = document.getElementById('transportPointsList');
  if (!dl) return;
  dl.innerHTML = '';
  TRANSPORT_POINTS_CACHE.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.name;
    dl.appendChild(opt);
  });
}
async function refreshTransportPoints() {
  try {
    TRANSPORT_POINTS_CACHE = await jget(`${API}/portal-modules/transport-points`);
    renderTransportPointsDatalist();
  } catch (err) { /* datalist keeps its static HTML fallback options */ }
}
async function ensureTransportPoint(name) {
  const value = (name || '').trim();
  if (!value) return;
  if (TRANSPORT_POINTS_CACHE.some((p) => p.name.toLowerCase() === value.toLowerCase())) return;
  try {
    const point = await jpost(`${API}/portal-modules/transport-points`, { name: value });
    if (point && !TRANSPORT_POINTS_CACHE.some((p) => p.id === point.id)) {
      TRANSPORT_POINTS_CACHE.push(point);
      renderTransportPointsDatalist();
    }
  } catch (err) { /* non-critical */ }
}
// Every pickup/drop-point input is marked with data-location-suggest="1"
// (NOT the native `list="..."` datalist attribute — its own popup gave no
// visible affordance and could render detached from the input entirely).
// Mirrors admin.js's version: wraps every such input (once) with a fully
// custom dropdown button + menu that fills the field on click, while the
// input itself stays a free-typing text field for anything not already in
// the list.
function wireLocationDropdowns(root) {
  (root || document).querySelectorAll('input[data-location-suggest="1"]').forEach((input) => {
    if (input.closest('.location-input-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'location-input-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'location-dropdown-btn';
    btn.title = 'Choose from saved pickup/drop points';
    btn.textContent = '▾';
    btn.addEventListener('click', () => toggleLocationDropdown(btn));
    wrap.appendChild(btn);
  });
}
function toggleLocationDropdown(btn) {
  const wrap = btn.closest('.location-input-wrap');
  const input = wrap.querySelector('input');
  const already = wrap.querySelector('.location-dropdown-menu');
  document.querySelectorAll('.location-dropdown-menu').forEach((m) => m.remove());
  if (already) return;
  const menu = document.createElement('div');
  menu.className = 'location-dropdown-menu';
  if (!TRANSPORT_POINTS_CACHE.length) {
    const empty = document.createElement('div');
    empty.className = 'location-dropdown-empty';
    empty.textContent = 'No saved points yet — just type one below.';
    menu.appendChild(empty);
  } else {
    TRANSPORT_POINTS_CACHE.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'location-dropdown-item';
      item.textContent = p.name;
      item.addEventListener('click', () => {
        input.value = p.name;
        menu.remove();
        input.focus();
      });
      menu.appendChild(item);
    });
  }
  wrap.appendChild(menu);
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.location-input-wrap')) {
    document.querySelectorAll('.location-dropdown-menu').forEach((m) => m.remove());
  }
});
function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
// Two-letter avatar initials for the profile-card avatar circle (Profile /
// Driver / Transporter tabs) — same idea as an iOS Contacts monogram.
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}
const STATUS_PILL = { planned: 'not_started', in_progress: 'in_progress', completed: 'completed', cancelled: 'pending' };
const STATUS_LABEL = { planned: 'Planned', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };

// --- Which sidebar tabs + header copy each role gets after logging in.
// 'shared-settings' (Notifications & Password) is appended for every role.
const ROLE_TABS = {
  host_member: ['host-profile', 'host-committees', 'host-lead', 'host-modules', 'host-delegates', 'host-checklist', 'host-delivery', 'host-guestrelations'],
  media: ['media-upload'],
  driver: ['driver-profile', 'driver-trips'],
  transporter: ['transporter-profile', 'transporter-drivers', 'transporter-trips'],
  volunteer: ['host-modules'],
  vendor: ['vendor-profile', 'vendor-products', 'vendor-orders']
};
const ROLE_DEFAULT_TAB = { host_member: 'host-profile', media: 'media-upload', driver: 'driver-profile', transporter: 'transporter-profile', volunteer: 'host-modules', vendor: 'vendor-profile' };
const ROLE_TITLE = {
  host_member: ['Host Portal', "Your committees, delegates & checklist"],
  media: ['Media Portal', 'Upload the event video reel & posters'],
  driver: ['Driver Portal', 'Your assigned trips'],
  transporter: ['Transporter Portal', "Your fleet's trip requirements"],
  volunteer: ['Volunteer Portal', 'Your granted modules'],
  vendor: ['Vendor Portal', 'Your product catalog & order deliveries']
};
const ALLOWED_ROLES = ['host_member', 'media', 'transporter', 'driver', 'volunteer', 'vendor'];

// ================= SIDEBAR + TABS =================
// Same collapsible-sidebar / tab-panel pattern as admin.js, so the portal
// feels consistent with the admin panel instead of being one long scroll.
const SIDEBAR_HIDDEN_KEY = 'sinc_portal_sidebar_hidden';
const portalShell = document.getElementById('portalShell');
const sidebarToggleBtn = document.getElementById('sidebarToggle');
function applySidebarState() {
  if (!portalShell) return;
  let hidden = localStorage.getItem(SIDEBAR_HIDDEN_KEY);
  if (hidden === null) hidden = window.innerWidth < 860 ? '1' : '0';
  portalShell.classList.toggle('sidebar-hidden', hidden === '1');
}
if (sidebarToggleBtn) {
  sidebarToggleBtn.addEventListener('click', () => {
    const nowHidden = !portalShell.classList.contains('sidebar-hidden');
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, nowHidden ? '1' : '0');
    applySidebarState();
  });
}

function activateTab(tabKey) {
  document.querySelectorAll('.admin-nav button').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  const btn = document.querySelector(`.admin-nav button[data-tab="${tabKey}"]`);
  const panel = document.getElementById('tab-' + tabKey);
  if (btn) btn.classList.add('active');
  if (panel) panel.classList.add('active');
}

document.getElementById('tabNav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  activateTab(btn.dataset.tab);
  // On phone/tablet widths the sidebar overlays the content, so tuck it away
  // again once a section has been picked (matches the admin panel's pattern).
  if (window.innerWidth < 860 && portalShell) {
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, '1');
    applySidebarState();
  }
});

// ================= AUTH GATE =================
function showAuthGate() {
  document.getElementById('authGate').style.display = 'block';
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('logoutLink').style.display = 'none';
  document.getElementById('sidebarToggle').style.display = 'none';
  document.getElementById('whoami').textContent = '';
  document.getElementById('portalTitle').textContent = 'Login';
  document.getElementById('portalSubtitle').textContent = 'Host member, media, transporter, driver, volunteer & vendor logins';
}

function showApp() {
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  document.getElementById('logoutLink').style.display = '';
  document.getElementById('sidebarToggle').style.display = '';
  document.getElementById('whoami').textContent = CURRENT_USER ? CURRENT_USER.username : '';
  applySidebarState();

  const role = CURRENT_USER ? CURRENT_USER.role : null;
  // Show only this role's sidebar nav group; hide the other three.
  Object.keys(ROLE_TABS).forEach((r) => {
    const el = document.getElementById('navGroup-' + r);
    if (el) el.style.display = r === role ? '' : 'none';
  });
  if (ROLE_DEFAULT_TAB[role]) activateTab(ROLE_DEFAULT_TAB[role]);

  const titleInfo = ROLE_TITLE[role];
  if (titleInfo) {
    document.getElementById('portalTitle').textContent = titleInfo[0];
    document.getElementById('portalSubtitle').textContent = titleInfo[1];
  }

  if (role === 'host_member') startHost();
  else if (role === 'media') startMedia();
  else if (role === 'driver') startDriver();
  else if (role === 'transporter') startTransporter();
  else if (role === 'volunteer') startVolunteer();
  else if (role === 'vendor') startVendor();

  // Announcements inbox is shared across every role (see tab-announcements) —
  // unlike the role-specific start*() calls above, this always runs.
  refreshAnnouncements();

  refreshPushButton();
}

// ================= PUSH NOTIFICATIONS ("Enable notifications" button) =================
async function refreshPushButton() {
  const btn = document.getElementById('pushToggleBtn');
  const statusEl = document.getElementById('pushStatusText');
  if (!btn || !window.SincPush) return;
  if (!window.SincPush.isSupported()) {
    btn.disabled = true;
    btn.textContent = 'Not supported in this browser';
    return;
  }
  try {
    const subscribed = await window.SincPush.isSubscribed();
    btn.textContent = subscribed ? 'Disable notifications' : 'Enable notifications';
    btn.classList.toggle('outline', subscribed);
    if (statusEl) statusEl.textContent = subscribed
      ? 'Notifications are on for this device.'
      : "Get a push notification for trip assignments, checklist reminders, and event announcements — even when this tab isn't open.";
  } catch (e) {
    console.error(e);
  }
}

// Safety net: if anything in the push flow ever hangs instead of rejecting
// (as navigator.serviceWorker.ready used to, before a service worker had
// ever been registered — see push.js), this guarantees the button unlocks
// and the person sees SOME message instead of a silent, permanent freeze.
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
}

const pushToggleBtn = document.getElementById('pushToggleBtn');
if (pushToggleBtn) {
  pushToggleBtn.addEventListener('click', async () => {
    pushToggleBtn.disabled = true;
    try {
      const subscribed = await withTimeout(window.SincPush.isSubscribed(), 8000, 'Timed out checking notification status — please try again.');
      if (subscribed) {
        await withTimeout(window.SincPush.disable(), 8000, 'Timed out turning off notifications — please try again.');
        toast('Notifications turned off');
      } else {
        await withTimeout(window.SincPush.enable(), 15000, 'Timed out enabling notifications — please try again.');
        toast('Notifications turned on');
      }
    } catch (err) {
      toast(err.message);
    } finally {
      pushToggleBtn.disabled = false;
      refreshPushButton();
    }
  });
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
    if (!ALLOWED_ROLES.includes(data.user.role)) {
      throw new Error('This is an admin login — use admin.html instead.');
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
    const user = await jget(`${API}/auth/me`);
    if (!ALLOWED_ROLES.includes(user.role)) { handleUnauthorized(); return; }
    CURRENT_USER = user;
    showApp();
  } catch (e) {
    showAuthGate();
  }
}

document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await jput(`${API}/auth/me/password`, Object.fromEntries(fd.entries()));
    e.target.reset();
    toast('Password updated');
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) toast(err.message);
  }
});

// ================= HOST MEMBER =================
let hostStarted = false;
function startHost() { if (hostStarted) return; hostStarted = true; loadHostMe(); }

async function loadHostMe() {
  let data;
  try {
    data = await jget(`${API}/host/me`);
  } catch (err) {
    if (err instanceof UnauthorizedError) return;
    document.getElementById('hostProfileBody').innerHTML = `<p class="hint" style="color:var(--red);">${err.message}</p>`;
    return;
  }
  renderHostProfile(data.profile);
  renderHostPayment(data.profile);
  renderHostCommittees(data.committeeTasks || []);
  renderHostLeadCommittees(data.leadCommittees || [], data.committeeChecklists || []);
  renderHostModules(data.moduleAccess || []);
  renderHostCommitteeChecklists(data.committeeChecklists);
  renderHostCommitteeDeliveries(data.committeeDeliveries);
  renderHostAssignments(data.assignments);
  renderHostTasks(data.tasks);
  renderHostGuestRelations(data.guestRelations);
  renderHostGoodiesChecklist(data.goodiesChecklist);

  // "Committee Delivery" tab covers two independent cards (checklist items +
  // goodies) — only show it in the sidebar if either one actually has
  // anything in it, since most host members aren't on a delivery-owning
  // committee at all.
  const hasDelivery = (data.committeeChecklists && data.committeeChecklists.length) || (data.committeeDeliveries && data.committeeDeliveries.length);
  const navBtnDelivery = document.getElementById('navBtnDelivery');
  if (navBtnDelivery) navBtnDelivery.style.display = hasDelivery ? '' : 'none';

  // Leadership Briefing — only for host members tagged with a leadership_role
  // in the admin panel (President, Secretary, VPs, Congress Chairman, etc.).
  // It's a separate, heavier aggregation call, so only fetch it when the nav
  // button is actually going to be shown.
  const navBtnLeadership = document.getElementById('navBtnLeadership');
  if (navBtnLeadership) {
    if (data.profile && data.profile.leadership_role) {
      navBtnLeadership.style.display = '';
      loadLeadershipBriefing();
    } else {
      navBtnLeadership.style.display = 'none';
    }
  }

  // Approvals — only for the specific office-bearer roles the Finance
  // module can ever route a payment/purchase to (a subset of all leadership
  // roles — e.g. a Vice President never gets asked to approve anything).
  const FINANCE_APPROVER_ROLES = ['President', 'Secretary', 'Treasurer', 'Congress Chairman', 'Congress Treasurer'];
  const navBtnApprovals = document.getElementById('navBtnApprovals');
  if (navBtnApprovals) {
    if (data.profile && FINANCE_APPROVER_ROLES.includes(data.profile.leadership_role)) {
      navBtnApprovals.style.display = '';
      loadFinanceApprovals();
    } else {
      navBtnApprovals.style.display = 'none';
    }
  }
}

function renderHostProfile(p) {
  const avatar = document.getElementById('hostAvatar');
  if (avatar) avatar.textContent = initials(p.name);
  document.getElementById('hostProfileBody').innerHTML = `
    <p style="margin:0;"><strong style="font-size:17px;">${p.name}</strong>${p.designation ? ' — ' + p.designation : ''}</p>
    <p class="hint" style="margin:2px 0 0;">${[p.company, p.category].filter(Boolean).join(' · ') || '-'}</p>
    <p class="hint" style="margin:2px 0 0;">${[p.phone, p.email].filter(Boolean).join(' · ') || '-'}</p>
  `;
}

function renderHostPayment(p) {
  document.getElementById('hostPaymentBody').innerHTML = `
    <p><span class="pill ${p.payment_status}">${p.payment_status}</span> &nbsp; ₹${p.payment_amount}</p>
    <p class="hint">${p.payment_mode ? 'Paid via ' + p.payment_mode : 'No payment mode on file yet'}${p.payment_date ? ' on ' + new Date(p.payment_date).toLocaleDateString() : ''}</p>
    <p class="hint">Contact the admin team if this doesn't look right — payment records are managed from the admin panel.</p>
  `;
}

function renderHostCommittees(committees) {
  document.getElementById('hostMyCommitteesBody').innerHTML = (committees || []).map((c) => `
    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--line);">
      <p style="margin:0 0 4px;"><strong>${c.name}</strong> ${c.is_lead ? '<span class="pill lead">★ You lead this committee</span>' : ''}</p>
      ${c.description ? `<p class="hint" style="margin:0 0 8px;white-space:pre-wrap;">${c.description}</p>` : ''}
      ${(c.tasks && c.tasks.length) ? c.tasks.map((t) => `
        <div class="checklist-row status-${t.my_status || 'pending'}">
          ${t.my_status === 'verified'
            ? '<span class="pill verified">✓✓ Verified</span>'
            : `<select onchange="updateMyCommitteeTaskStatus(${t.completion_id}, this.value)">
                <option value="pending" ${t.my_status === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="done" ${t.my_status === 'done' ? 'selected' : ''}>Done</option>
              </select>`}
          <span class="checklist-label">
            ${Number(t.is_milestone) ? '<span class="pill double" style="margin-right:4px;">Milestone</span>' : ''}
            ${t.is_individually_assigned ? '<span class="pill single" style="margin-right:4px;">Assigned to you</span>' : ''}
            ${t.title}${t.due_date ? ' <span class="hint">(due ' + t.due_date + ')</span>' : ''}
          </span>
          <span class="hint">${t.done_count}/${t.total_members} members done</span>
        </div>
      `).join('') : '<p class="hint">No checklist items or milestones posted for this committee yet.</p>'}
    </div>
  `).join('') || '<p class="hint">You are not yet assigned to a committee.</p>';
}
window.updateMyCommitteeTaskStatus = async (completionId, status) => {
  try { await jput(`${API}/host/committee-tasks/${completionId}`, { status }); toast('Status updated'); loadHostMe(); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
};

// --- Committee lead: delegate individual checklist items + verify completions ---
function renderHostLeadCommittees(leadCommittees, committeeChecklists) {
  const card = document.getElementById('hostLeadCard');
  const navBtn = document.getElementById('navBtnLead');
  if (!leadCommittees || !leadCommittees.length) {
    card.style.display = 'none';
    if (navBtn) navBtn.style.display = 'none';
    return;
  }
  card.style.display = '';
  if (navBtn) navBtn.style.display = '';
  const memberOpts = (roster) => roster.map((m) => `<option value="${m.id}">${m.name}</option>`).join('');
  // Only the committee's OWN items here (owner_type='committee') — items
  // delegated to this committee from Sponsors/Speakers/Guest Visitors/
  // Delegates/Host Members already have their own "Committee Delivery" tab,
  // so we don't want to show them twice.
  const checklistFor = (committeeId) => {
    const group = (committeeChecklists || []).find((g) => g.committee_id === committeeId);
    if (!group) return null;
    return { ...group, items: (group.items || []).filter((it) => it.is_committee_own_item) };
  };
  document.getElementById('hostLeadBody').innerHTML = leadCommittees.map((c) => `
    <div style="margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--line);">
      <p style="margin:0 0 8px;"><strong>${c.name}</strong> <span class="hint">— ${c.roster.length} member${c.roster.length === 1 ? '' : 's'}</span></p>
      <form onsubmit="return submitLeadTask(event, ${c.id})" style="margin:10px 0;">
        <div class="form-grid cols-3">
          <div class="field"><label>Title *</label><input name="title" required /></div>
          <div class="field"><label>Due date</label><input name="due_date" type="date" /></div>
          <div class="field"><label>Type</label>
            <select name="is_milestone"><option value="0">Checklist item</option><option value="1">Milestone</option></select>
          </div>
        </div>
        <div class="field"><label>Assign to</label>
          <select name="assigned_to_host_member_id">
            <option value="">Whole committee (broadcast)</option>
            ${memberOpts(c.roster)}
          </select>
        </div>
        <div class="field"><label>Description</label><textarea name="description"></textarea></div>
        <button class="btn gold small" type="submit">Assign checklist item / milestone</button>
      </form>
      <div style="margin:14px 0;padding:12px;border:1px solid var(--line);border-radius:10px;">
        <p style="margin:0 0 8px;"><strong>Committee checklist</strong> <span class="hint">— a shared to-do list for the committee itself; any member can mark items done</span></p>
        <form onsubmit="return submitCommitteeChecklistItemLead(event, ${c.id})" style="margin:0 0 10px;">
          <div class="form-grid cols-2">
            <div class="field"><label>Item *</label><input name="label" required /></div>
            <div class="field"><label>Due date</label><input name="due_date" type="date" /></div>
          </div>
          <button class="btn gold small" type="submit">Add checklist item</button>
        </form>
        ${hostChecklistRowsHtml((checklistFor(c.id) || {}).items, { showOwner: false })}
      </div>
      ${(c.tasks && c.tasks.length) ? c.tasks.map((t) => `
        <div style="padding:8px 0;border-bottom:1px solid var(--line);">
          <div>
            ${Number(t.is_milestone) ? '<span class="pill double">Milestone</span> ' : ''}
            ${t.assigned_to_host_member_id ? '<span class="pill single">Individually assigned</span> ' : ''}
            <strong>${t.title}</strong>${t.due_date ? ` <span class="hint">due ${t.due_date}</span>` : ''}
            ${t.description ? `<br><span class="hint">${t.description}</span>` : ''}
          </div>
          <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;">
            ${(t.members || []).map((m) => `
              <span class="pill ${m.status === 'verified' ? 'verified' : (m.status === 'done' ? 'done' : 'not_started')}" style="display:inline-flex;align-items:center;gap:6px;">
                ${m.name} ${m.status === 'verified' ? '✓✓' : (m.status === 'done' ? '✓' : '')}
                ${m.status === 'done' ? `<a href="#" onclick="verifyCompletion(${m.completion_id});return false;" style="color:inherit;text-decoration:underline;">Verify</a>` : ''}
                ${m.status === 'verified' ? `<a href="#" onclick="unverifyCompletion(${m.completion_id});return false;" style="color:inherit;text-decoration:underline;">Un-verify</a>` : ''}
              </span>
            `).join('')}
          </div>
        </div>
      `).join('') : '<p class="hint">No checklist items assigned in this committee yet.</p>'}
    </div>
  `).join('');
}
window.submitLeadTask = async (e, committeeId) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  if (!body.assigned_to_host_member_id) delete body.assigned_to_host_member_id;
  try {
    await jpost(`${API}/host/committees/${committeeId}/tasks`, body);
    toast('Checklist item assigned');
    loadHostMe();
  } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
  return false;
};
window.submitCommitteeChecklistItemLead = async (e, committeeId) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  try {
    await jpost(`${API}/host/committees/${committeeId}/checklist-items`, body);
    toast('Checklist item added');
    loadHostMe();
  } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
  return false;
};
window.verifyCompletion = async (completionId) => {
  try { await jput(`${API}/host/committee-task-completions/${completionId}/verify`, { status: 'verified' }); toast('Marked as verified'); loadHostMe(); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
};
window.unverifyCompletion = async (completionId) => {
  try { await jput(`${API}/host/committee-task-completions/${completionId}/verify`, { status: 'done' }); toast('Un-verified'); loadHostMe(); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
};

// --- My Modules: generic list/add/edit manager for committee-granted modules ---
// Field configs are intentionally minimal (mirrors what each admin form
// actually sends — see server/routes/*.js POST handlers) so a committee
// member can contribute directly without needing every admin-only field.
// No delete UI anywhere here — deletes stay super_admin-only server-side
// regardless (server/index.js's global DELETE-block covers these routes too).
const MODULE_CONFIG = {
  transport_partners: { label: 'Partners & Drivers', sections: [
    { path: 'partners', label: 'Transport Partners',
      columns: [['name', 'Name'], ['category', 'Category'], ['contact_person', 'Contact'], ['phone', 'Phone']],
      fields: [
        { name: 'name', label: 'Name', required: true }, { name: 'category', label: 'Category' },
        { name: 'contact_person', label: 'Contact person' }, { name: 'phone', label: 'Phone' },
        { name: 'email', label: 'Email' }, { name: 'notes', label: 'Notes', type: 'textarea' },
      ] },
    { path: 'drivers', label: 'Drivers',
      columns: [['name', 'Name'], ['phone', 'Phone'], ['partner_id', 'Partner ID'], ['vehicle_id', 'Vehicle ID']],
      fields: [
        { name: 'name', label: 'Name', required: true }, { name: 'phone', label: 'Phone' },
        { name: 'partner_id', label: 'Partner ID (number)', type: 'number' }, { name: 'vehicle_id', label: 'Vehicle ID (number)', type: 'number' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ] },
  ] },
  vehicles: { label: 'Vehicles', path: 'vehicles',
    columns: [['vehicle_code', 'Code'], ['vehicle_type', 'Type'], ['model', 'Model'], ['seating_capacity', 'Seats']],
    fields: [
      { name: 'vehicle_type', label: 'Type (van/car/bus)', required: true }, { name: 'model', label: 'Model' },
      { name: 'seating_capacity', label: 'Seating capacity', type: 'number' }, { name: 'registration_number', label: 'Registration number' },
      { name: 'partner_id', label: 'Partner ID (number)', type: 'number' }, { name: 'notes', label: 'Notes', type: 'textarea' },
    ] },
  transport_planning: { label: 'Transport Planning', path: 'transport', hasArrivalsQueue: true,
    columns: [['trip_date', 'Date'], ['from_location', 'From'], ['to_location', 'To'], ['status', 'Status']],
    fields: [
      { name: 'from_location', label: 'From', required: true }, { name: 'to_location', label: 'To', required: true },
      { name: 'trip_date', label: 'Trip date', type: 'date' }, { name: 'depart_time', label: 'Depart time' },
      { name: 'purpose', label: 'Purpose' }, { name: 'vehicle_id', label: 'Vehicle ID (number)', type: 'number' },
      { name: 'driver_id', label: 'Driver ID (number)', type: 'number' }, { name: 'status', label: 'Status (planned/in_progress/completed)' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ] },
  pretours: { label: 'Pre Tours', path: 'pretours',
    columns: [['name', 'Name'], ['start_date', 'Start'], ['end_date', 'End'], ['status', 'Status']],
    fields: [
      { name: 'name', label: 'Name', required: true }, { name: 'start_date', label: 'Start date', type: 'date' },
      { name: 'end_date', label: 'End date', type: 'date' }, { name: 'hotel', label: 'Hotel' },
      { name: 'attractions', label: 'Attractions' }, { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'capacity', label: 'Capacity', type: 'number' }, { name: 'price', label: 'Price', type: 'number' },
      { name: 'status', label: 'Status (planned/confirmed/cancelled)' }, { name: 'notes', label: 'Notes', type: 'textarea' },
    ] },
  accommodation: { label: 'Accommodation & Rooms', sections: [
    { path: 'hotels', label: 'Hotels',
      columns: [['name', 'Name'], ['address', 'Address'], ['contact_person', 'Contact'], ['phone', 'Phone']],
      fields: [
        { name: 'name', label: 'Name', required: true }, { name: 'address', label: 'Address' },
        { name: 'contact_person', label: 'Contact person' }, { name: 'phone', label: 'Phone' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ] },
    { path: 'rooms', label: 'Room Assignments',
      columns: [['room_number', 'Room #'], ['room_type', 'Type'], ['hotel_id', 'Hotel ID'], ['check_in', 'Check-in']],
      fields: [
        { name: 'hotel_id', label: 'Hotel ID (number)', required: true, type: 'number' }, { name: 'room_number', label: 'Room number' },
        { name: 'room_type', label: 'Room type' }, { name: 'participant_id', label: 'Delegate ID (number)', type: 'number' },
        { name: 'host_member_id', label: 'Host member ID (number)', type: 'number' },
        { name: 'check_in', label: 'Check-in', type: 'date' }, { name: 'check_out', label: 'Check-out', type: 'date' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ] },
  ] },
  inventory: { label: 'Goodies & Inventory', path: 'inventory',
    columns: [['name', 'Item'], ['category', 'Category'], ['quantity_procured', 'Procured'], ['procurement_status', 'Status']],
    fields: [
      { name: 'name', label: 'Item name', required: true }, { name: 'category', label: 'Category' },
      { name: 'unit', label: 'Unit' }, { name: 'quantity_procured', label: 'Quantity procured', type: 'number' },
      { name: 'unit_cost', label: 'Unit cost', type: 'number' }, { name: 'reorder_threshold', label: 'Reorder threshold', type: 'number' },
      { name: 'vendor_name', label: 'Vendor name' }, { name: 'procurement_status', label: 'Procurement status' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ] },
  sponsors: { label: 'Sponsors', path: 'sponsors',
    columns: [['name', 'Name'], ['tier', 'Tier'], ['contact_person', 'Contact'], ['status', 'Status']],
    fields: [
      { name: 'name', label: 'Name', required: true }, { name: 'tier', label: 'Tier' },
      { name: 'contact_person', label: 'Contact person' }, { name: 'phone', label: 'Phone' },
      { name: 'email', label: 'Email' }, { name: 'status', label: 'Status' }, { name: 'notes', label: 'Notes', type: 'textarea' },
    ] },
  speakers: { label: 'Guest Speakers', path: 'speakers',
    columns: [['name', 'Name'], ['topic', 'Topic'], ['session_type', 'Session type'], ['status', 'Status']],
    fields: [
      { name: 'name', label: 'Name', required: true }, { name: 'designation', label: 'Designation' },
      { name: 'organization', label: 'Organization' }, { name: 'topic', label: 'Topic' }, { name: 'session_type', label: 'Session type' },
      { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email' }, { name: 'status', label: 'Status' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ] },
  guestvisitors: { label: 'Guest Visitors', path: 'guestvisitors',
    columns: [['name', 'Name'], ['category', 'Category'], ['visit_date', 'Visit date'], ['status', 'Status']],
    fields: [
      { name: 'name', label: 'Name', required: true }, { name: 'designation', label: 'Designation' },
      { name: 'organization', label: 'Organization' }, { name: 'category', label: 'Category' },
      { name: 'visit_date', label: 'Visit date', type: 'date' }, { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email' },
      { name: 'status', label: 'Status' }, { name: 'notes', label: 'Notes', type: 'textarea' },
    ] },
  media: { label: 'Media (Video/Poster)', path: 'media', readOnly: true,
    columns: [['title', 'Title'], ['type', 'Type'], ['active', 'Active']], fields: [] },
  happenings: { label: 'Live Happenings', path: 'happenings',
    columns: [['title', 'Title'], ['category', 'Category'], ['posted_by', 'Posted by']],
    fields: [
      { name: 'title', label: 'Title', required: true }, { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'category', label: 'Category' }, { name: 'posted_by', label: 'Posted by' },
    ] },
  itinerary: { label: 'Itinerary', path: 'itinerary',
    columns: [['day_label', 'Day'], ['time_label', 'Time'], ['title', 'Title']],
    fields: [
      { name: 'day_label', label: 'Day label', required: true }, { name: 'time_label', label: 'Time label' },
      { name: 'title', label: 'Title', required: true }, { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'sort_order', label: 'Sort order', type: 'number' },
    ] },
  // Delegate registration data entry — for volunteers helping process
  // registrations/delegates. Three sections: Clubs (so there's always
  // somewhere to pick/add a club from), Registrations (one per booking —
  // single/double/congress-only), and Delegates (the actual attendees,
  // each linked to a registration). Payment fields are intentionally left
  // off this form — those stay admin-only, same reasoning as every other
  // module here (minimal fields, not the full admin set).
  participants: { label: 'Delegate Registrations', sections: [
    { path: 'clubs', label: 'Clubs',
      columns: [['name', 'Name'], ['city', 'City'], ['state', 'State'], ['zone', 'Zone']],
      fields: [
        { name: 'name', label: 'Club name', required: true }, { name: 'city', label: 'City' },
        { name: 'state', label: 'State' }, { name: 'zone', label: 'Zone' },
      ] },
    { path: 'registrations', label: 'Registrations',
      columns: [['reg_number', 'Reg #'], ['reg_type', 'Type'], ['club_name', 'Club']],
      fields: [
        { name: 'reg_type', label: 'Registration type', type: 'select', required: true,
          options: [['single', 'Single'], ['double', 'Double'], ['congress_only', 'Congress Only (no room)']] },
        { name: 'club_id', label: 'Club', type: 'select', optionsFrom: 'clubs', optionLabel: (c) => c.name },
      ] },
    { path: 'participants', label: 'Delegates',
      columns: [['name', 'Name'], ['phone', 'Phone'], ['club_name', 'Club'], ['reg_number', 'Reg #']],
      fields: [
        { name: 'registration_id', label: 'Registration', type: 'select', required: true,
          optionsFrom: 'registrations', optionLabel: (r) => `${r.reg_number}${r.reg_type ? ' — ' + r.reg_type : ''}${r.club_name ? ' (' + r.club_name + ')' : ''}` },
        { name: 'name', label: 'Name', required: true }, { name: 'phone', label: 'Phone' },
        { name: 'whatsapp', label: 'WhatsApp' }, { name: 'email', label: 'Email' },
        { name: 'club_id', label: 'Club', type: 'select', optionsFrom: 'clubs', optionLabel: (c) => c.name },
        { name: 'designation', label: 'Designation' }, { name: 'dietary_preference', label: 'Dietary preference' },
        { name: 'travel_mode', label: 'Travel mode' }, { name: 'travel_number', label: 'Travel number' },
        { name: 'travel_datetime', label: 'Travel date/time' }, { name: 'arrival_point', label: 'Arrival point' },
      ] },
  ] },
};
let currentModuleKey = null, currentModuleSectionPath = null;

function renderHostModules(moduleAccess) {
  const card = document.getElementById('hostModulesCard');
  const navBtn = document.getElementById('navBtnModules');
  if (!moduleAccess || !moduleAccess.length) {
    card.style.display = 'none';
    if (navBtn) navBtn.style.display = 'none';
    return;
  }
  card.style.display = '';
  if (navBtn) navBtn.style.display = '';
  const nav = document.getElementById('hostModuleNav');
  nav.innerHTML = moduleAccess.filter((k) => MODULE_CONFIG[k]).map((k) => `
    <button type="button" class="btn small ${k === currentModuleKey ? 'gold' : ''}" onclick="selectHostModule('${k}')">${MODULE_CONFIG[k].label}</button>
  `).join('');
  if (!currentModuleKey && moduleAccess.length) currentModuleKey = moduleAccess.find((k) => MODULE_CONFIG[k]) || null;
  if (currentModuleKey) selectHostModule(currentModuleKey, currentModuleSectionPath);
}
window.selectHostModule = async (key, sectionPath) => {
  currentModuleKey = key;
  const cfg = MODULE_CONFIG[key];
  if (!cfg) return;
  const section = cfg.sections ? (cfg.sections.find((s) => s.path === sectionPath) || cfg.sections[0]) : cfg;
  currentModuleSectionPath = section.path;
  document.querySelectorAll('#hostModuleNav .btn').forEach((b) => b.classList.remove('gold'));
  const btns = document.querySelectorAll('#hostModuleNav .btn');
  for (const b of btns) { if (b.textContent.trim() === cfg.label) b.classList.add('gold'); }
  await renderHostModuleSection(cfg, section);
};
async function renderHostModuleSection(cfg, section) {
  const body = document.getElementById('hostModuleBody');
  body.innerHTML = '<p class="hint">Loading…</p>';
  let rows = [];
  try {
    rows = await jget(`${API}/portal-modules/${section.path}`);
  } catch (err) {
    if (err instanceof UnauthorizedError) return;
    body.innerHTML = `<p class="hint" style="color:var(--red);">${err.message}</p>`;
    return;
  }
  // Fields of type 'select' with optionsFrom (e.g. a Delegate form's
  // "Registration" dropdown) pull their option list from ANOTHER section's
  // own endpoint in the same module — fetched fresh on every render so a
  // club/registration added a moment ago shows up immediately.
  const selectFields = section.fields.filter((f) => f.type === 'select' && f.optionsFrom);
  const optionRows = {};
  for (const f of selectFields) {
    try { optionRows[f.optionsFrom] = await jget(`${API}/portal-modules/${f.optionsFrom}`); }
    catch (err) { optionRows[f.optionsFrom] = []; }
  }
  const sectionTabs = cfg.sections ? `
    <div style="display:flex;gap:6px;margin-bottom:10px;">
      ${cfg.sections.map((s) => `<button type="button" class="btn small ${s.path === section.path ? 'gold' : ''}" onclick="selectHostModule('${Object.keys(MODULE_CONFIG).find((k) => MODULE_CONFIG[k] === cfg)}', '${s.path}')">${s.label}</button>`).join('')}
    </div>` : '';
  body.innerHTML = `
    ${sectionTabs}
    <div class="table-scroll">
      <table>
        <thead><tr>${section.columns.map((c) => `<th>${c[1]}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows.map((r) => `<tr>${section.columns.map((c) => `<td>${escapeHtml(r[c[0]] == null ? '-' : r[c[0]])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${section.columns.length}" class="empty">Nothing here yet</td></tr>`}
        </tbody>
      </table>
    </div>
    ${section.fields.length ? `
      <div class="section-title" style="font-size:14px;">Add new</div>
      <form onsubmit="return submitHostModuleForm(event)">
        <div class="form-grid cols-2">
          ${section.fields.map((f) => `
            <div class="field"><label>${f.label}${f.required ? ' *' : ''}</label>
              ${f.type === 'select' ? `
                <select name="${f.name}"${f.required ? ' required' : ''}>
                  <option value="">-- choose --</option>
                  ${f.optionsFrom
                    ? (optionRows[f.optionsFrom] || []).map((r) => `<option value="${r.id}">${escapeHtml(f.optionLabel(r))}</option>`).join('')
                    : (f.options || []).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                </select>
              ` : (f.type === 'textarea' ? `<textarea name="${f.name}"${f.required ? ' required' : ''}></textarea>` : `<input name="${f.name}" type="${f.type || 'text'}"${['from_location', 'to_location', 'arrival_point'].includes(f.name) ? ' data-location-suggest="1"' : ''}${f.required ? ' required' : ''} />`)}
            </div>
          `).join('')}
        </div>
        <button class="btn gold small" type="submit">Add</button>
      </form>
    ` : (cfg.readOnly ? '<p class="hint">This module is view-only from the host portal.</p>' : '')}
    ${cfg.hasArrivalsQueue ? '<div id="transportQueueBody" style="margin-top:16px;"><p class="hint">Loading arrivals/departures…</p></div>' : ''}
  `;
  wireLocationDropdowns(body);
  if (cfg.hasArrivalsQueue) { refreshTransportPoints(); renderTransportQueue(); }
}

// --- Arrivals & Departures to Plan (Transport Planning module only) ---
// Delegates who gave flight/train details, auto-grouped by matching travel
// number + date/time, so the transport committee assigns one vehicle to the
// whole cluster instead of planning each delegate one at a time. Mirrors the
// admin panel's version of this panel (admin.js's transportQueueGroupCard),
// hitting the same /transport/arrivals-queue, /departures-queue, and
// /group-trip endpoints via the committee's portal-modules mount instead of
// the admin-only one.
function transportQueueGroupCardHost(direction, g) {
  const delegates = g.delegates || [];
  const hotelIds = new Set(delegates.map((d) => d.hotel_id).filter((x) => x !== null && x !== undefined));
  const sharedHotel = hotelIds.size === 1 ? delegates.find((d) => d.hotel_id !== null && d.hotel_id !== undefined)?.hotel_name : null;
  const modeLabel = g.travel_mode === 'flight' ? 'Flight' : 'Train';
  // Arrivals use the delegate's arrival_point; departures use their own
  // departure_point (falls back to arrival_point server-side for older rows
  // saved before that field existed).
  const queuePoint = direction === 'arrival' ? g.arrival_point : g.departure_point;
  const fromDefault = direction === 'arrival' ? (queuePoint || '') : (sharedHotel || '');
  const toDefault = direction === 'arrival' ? (sharedHotel || '') : (queuePoint || '');
  const purposeDefault = direction === 'arrival' ? 'Airport/station pickup' : 'Airport/station drop-off';
  return `
    <div class="card queue-group" style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
        <strong>${modeLabel} ${g.travel_number} — ${g.travel_datetime}</strong>
        <span class="hint">${g.delegate_count} delegate${g.delegate_count === 1 ? '' : 's'}${queuePoint ? ' · ' + queuePoint : ''}${sharedHotel ? ' · all at ' + sharedHotel : ''}</span>
      </div>
      <div style="margin:8px 0;">
        <button type="button" class="btn small" onclick="toggleQueueGroupChecksHost(this, true)">Select all</button>
        <button type="button" class="btn small" onclick="toggleQueueGroupChecksHost(this, false)">Select none</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
        ${delegates.map((d) => `
          <label style="display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:6px 10px;width:100%;">
            <input type="checkbox" class="queue-delegate-cb" value="${d.id}" checked style="width:16px;height:16px;min-width:16px;flex-shrink:0;padding:0;" />
            <span style="line-height:1.35;flex:1;">${d.name}${d.hotel_name ? ` <span class="hint">→ ${d.hotel_name}</span>` : ''}</span>
          </label>
        `).join('')}
      </div>
      <form onsubmit="return submitGroupTripHost(event, '${direction}')">
        <div class="form-grid cols-2">
          <div class="field"><label>From *</label><input name="from_location" data-location-suggest="1" required value="${escapeHtml(fromDefault)}" /></div>
          <div class="field"><label>To *</label><input name="to_location" data-location-suggest="1" required value="${escapeHtml(toDefault)}" /></div>
        </div>
        <div class="form-grid cols-2">
          <div class="field"><label>Trip date</label><input name="trip_date" type="date" /></div>
          <div class="field"><label>Depart time</label><input name="depart_time" type="time" /></div>
        </div>
        <div class="form-grid cols-2">
          <div class="field"><label>Vehicle ID (number)</label><input name="vehicle_id" type="number" /></div>
          <div class="field"><label>Driver ID (number)</label><input name="driver_id" type="number" /></div>
        </div>
        <div class="field"><label>Purpose</label><input name="purpose" value="${escapeHtml(purposeDefault)}" /></div>
        <button class="btn gold small" type="submit">Create trip for this group</button>
      </form>
    </div>
  `;
}
window.toggleQueueGroupChecksHost = (btn, checked) => {
  btn.closest('.queue-group').querySelectorAll('.queue-delegate-cb').forEach((cb) => { cb.checked = checked; });
};
window.submitGroupTripHost = async (e, direction) => {
  e.preventDefault();
  const card = e.target.closest('.queue-group');
  const participant_ids = Array.from(card.querySelectorAll('.queue-delegate-cb:checked')).map((cb) => Number(cb.value));
  if (!participant_ids.length) { toast('Select at least one delegate for this trip'); return false; }
  const body = Object.fromEntries(new FormData(e.target).entries());
  Object.keys(body).forEach((k) => { if (body[k] === '') delete body[k]; });
  body.direction = direction;
  body.participant_ids = participant_ids;
  try {
    await jpost(`${API}/portal-modules/transport/group-trip`, body);
    toast('Trip created for the group');
    if (body.from_location) ensureTransportPoint(body.from_location);
    if (body.to_location) ensureTransportPoint(body.to_location);
    renderTransportQueue();
    if (currentModuleKey === 'transport_planning') renderHostModuleSection(MODULE_CONFIG.transport_planning, MODULE_CONFIG.transport_planning);
  } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
  return false;
};
async function renderTransportQueue() {
  const el = document.getElementById('transportQueueBody');
  if (!el) return;
  try {
    const [arrivals, departures] = await Promise.all([
      jget(`${API}/portal-modules/transport/arrivals-queue`),
      jget(`${API}/portal-modules/transport/departures-queue`),
    ]);
    el.innerHTML = `
      <div class="section-title" style="font-size:14px;">Arrivals to plan (${arrivals.length})</div>
      ${arrivals.map((g) => transportQueueGroupCardHost('arrival', g)).join('') || '<p class="hint">No unplanned arrivals right now.</p>'}
      <div class="section-title" style="font-size:14px;">Departures to plan (${departures.length})</div>
      ${departures.map((g) => transportQueueGroupCardHost('departure', g)).join('') || '<p class="hint">No unplanned departures right now.</p>'}
    `;
    wireLocationDropdowns(el);
  } catch (err) {
    if (err instanceof UnauthorizedError) return;
    el.innerHTML = `<p class="hint" style="color:var(--red);">${err.message}</p>`;
  }
}
window.submitHostModuleForm = async (e) => {
  e.preventDefault();
  const cfg = MODULE_CONFIG[currentModuleKey];
  const section = cfg.sections ? cfg.sections.find((s) => s.path === currentModuleSectionPath) : cfg;
  const body = Object.fromEntries(new FormData(e.target).entries());
  Object.keys(body).forEach((k) => { if (body[k] === '') delete body[k]; });
  try {
    await jpost(`${API}/portal-modules/${section.path}`, body);
    toast('Saved');
    e.target.reset();
    ['from_location', 'to_location', 'arrival_point'].forEach((k) => { if (body[k]) ensureTransportPoint(body[k]); });
    renderHostModuleSection(cfg, section);
  } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
  return false;
};

function renderHostAssignments(rows) {
  document.getElementById('hostMyAssignmentsBody').innerHTML = (rows || []).map((a) => `
    <tr>
      <td>${a.participant_name}<br><span class="hint">${a.participant_code || ''}</span></td>
      <td>${a.club_name || '-'}<br><span class="hint">${a.reg_number || ''}</span></td>
      <td>${a.role ? `<span class="pill ${String(a.role).toLowerCase() === 'spoc' ? 'double' : 'single'}">${a.role}</span>` : '<span class="hint">-</span>'}</td>
      <td>${a.travel_mode ? a.travel_mode + (a.travel_number ? ' · ' + a.travel_number : '') : '-'}${a.arrival_point ? '<br><span class="hint">' + a.arrival_point + '</span>' : ''}</td>
      <td>
        <select onchange="updateAssignmentStatus(${a.id}, this.value)">
          <option value="not_started" ${a.status === 'not_started' ? 'selected' : ''}>Not started</option>
          <option value="in_progress" ${a.status === 'in_progress' ? 'selected' : ''}>In progress</option>
          <option value="completed" ${a.status === 'completed' ? 'selected' : ''}>Completed</option>
        </select>
      </td>
      <td><input type="text" value="${(a.notes || '').replace(/"/g, '&quot;')}" onchange="updateAssignmentNotes(${a.id}, this.value)" placeholder="Add a note..." /></td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty">No delegates assigned to you yet</td></tr>';
}
window.updateAssignmentStatus = async (id, status) => {
  try { await jput(`${API}/host/assignments/${id}`, { status }); toast('Status updated'); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
};
window.updateAssignmentNotes = async (id, notes) => {
  try { await jput(`${API}/host/assignments/${id}`, { notes }); toast('Note saved'); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
};

function renderHostTasks(rows) {
  document.getElementById('hostMyTasksBody').innerHTML = (rows || []).map((t) => `
    <tr>
      <td>${t.title}${t.description ? '<br><span class="hint">' + t.description + '</span>' : ''}</td>
      <td>${Number(t.is_milestone) ? '<span class="pill double">Milestone</span>' : '<span class="hint">Checklist</span>'}</td>
      <td>${t.due_date ? new Date(t.due_date).toLocaleDateString() : '-'}</td>
      <td>
        <select onchange="updateTaskStatus(${t.id}, this.value)">
          <option value="pending" ${t.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>In progress</option>
          <option value="done" ${t.status === 'done' ? 'selected' : ''}>Done</option>
        </select>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="empty">No checklist items yet</td></tr>';
}
window.updateTaskStatus = async (id, status) => {
  try { await jput(`${API}/host/tasks/${id}`, { status }); toast('Status updated'); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
};

function hostChecklistRowsHtml(items, opts) {
  opts = opts || {};
  return (items || []).map((it) => {
    const overdue = it.status !== 'done' && it.due_date && it.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10);
    return `
    <div class="checklist-row status-${it.status}${overdue ? ' row-overdue' : ''}">
      <select onchange="updateHostChecklistStatus(${it.id}, this.value)">
        <option value="pending" ${it.status === 'pending' ? 'selected' : ''}>Pending</option>
        <option value="in_progress" ${it.status === 'in_progress' ? 'selected' : ''}>In progress</option>
        <option value="done" ${it.status === 'done' ? 'selected' : ''}>Done</option>
      </select>
      <span class="checklist-label">
        ${opts.showOwner && it.owner_name ? `<span class="pill single" style="margin-right:6px;">${it.owner_name}</span>` : ''}${it.label}${it.due_date ? ` <span class="hint">(due ${it.due_date.slice(0, 10)})</span>` : ''}
      </span>
      ${overdue ? '<span class="pill overdue">Overdue</span>' : ''}
    </div>
  `;
  }).join('') || '<p class="hint">Nothing on this checklist yet.</p>';
}

function renderHostCommitteeChecklists(groups) {
  const card = document.getElementById('hostCommitteeChecklistCard');
  if (!groups || !groups.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  document.getElementById('hostCommitteeChecklistBody').innerHTML = groups.map((g) => `
    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--line);">
      <p style="margin:0 0 6px;"><strong>${g.committee_name}</strong></p>
      ${hostChecklistRowsHtml(g.items, { showOwner: true })}
    </div>
  `).join('');
}

function renderHostCommitteeDeliveries(groups) {
  const card = document.getElementById('hostCommitteeDeliveryCard');
  if (!card) return;
  if (!groups || !groups.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  document.getElementById('hostCommitteeDeliveryBody').innerHTML = groups.map((g) => `
    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--line);">
      <p style="margin:0 0 6px;"><strong>${g.committee_name}</strong></p>
      ${(g.items && g.items.length) ? g.items.map((d) => `
        <div class="checklist-row status-${d.status}">
          <select onchange="updateMyDeliveryStatus(${d.id}, this.value)">
            <option value="pending" ${d.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="delivered" ${d.status === 'delivered' ? 'selected' : ''}>Delivered</option>
          </select>
          <span class="checklist-label">
            ${d.is_assigned_to_me ? '<span class="pill single" style="margin-right:6px;">Assigned to me</span>' : ''}
            ${d.item_name}${d.quantity > 1 ? ` ×${d.quantity}` : ''} <span class="hint">→ ${d.recipient_name || 'Unknown recipient'}</span>
          </span>
        </div>
      `).join('') : '<p class="hint">Nothing to deliver for this committee yet.</p>'}
    </div>
  `).join('');
}
window.updateMyDeliveryStatus = async (id, status) => {
  try { await jput(`${API}/host/deliveries/${id}`, { status }); toast('Delivery status updated'); loadHostMe(); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
};

function renderHostGuestRelations(relations) {
  const card = document.getElementById('hostSponsorRelationsCard');
  const navBtn = document.getElementById('navBtnGuestRel');
  if (!relations || !relations.length) {
    card.style.display = 'none';
    if (navBtn) navBtn.style.display = 'none';
    return;
  }
  if (navBtn) navBtn.style.display = '';
  card.style.display = '';
  document.getElementById('hostSponsorRelationsBody').innerHTML = relations.map((r) => `
    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--line);">
      <p style="margin:0 0 6px;">
        <span class="pill single" style="margin-right:6px;">${r.kindLabel}</span>
        <strong>${r.name}</strong>${r.subtitle ? ' <span class="hint">(' + r.subtitle + ')</span>' : ''}
      </p>
      ${r.topic ? `<p class="hint" style="margin:0 0 4px;">Topic: ${r.topic}</p>` : ''}
      <p class="hint" style="margin:0 0 8px;">${[r.contact_person, r.phone, r.email].filter(Boolean).join(' · ') || 'No contact details on file'}</p>
      ${hostChecklistRowsHtml(r.checklist)}
    </div>
  `).join('');
}

function renderHostGoodiesChecklist(items) {
  document.getElementById('hostGoodiesBody').innerHTML = hostChecklistRowsHtml(items);
}

window.updateHostChecklistStatus = async (id, status) => {
  try { await jput(`${API}/host/checklist/${id}`, { status }); toast('Status updated'); loadHostMe(); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
};

// ================= LEADERSHIP BRIEFING =================
// One-screen "state of the congress" view for tagged leadership roles
// (President, Secretary, VPs, Congress Chairman/Secretary/Joint
// Secretary/Treasurer/Sponsor Chairman) — read-only aggregation across
// delegates/payments, sponsors, checklist delivery, goodies/inventory, and a
// plain-language recent activity feed. See GET /api/host/leadership-briefing.
async function loadLeadershipBriefing() {
  let data;
  try {
    data = await jget(`${API}/host/leadership-briefing`);
  } catch (err) {
    if (err instanceof UnauthorizedError) return;
    const el = document.getElementById('leadershipKpis');
    if (el) el.innerHTML = `<p class="hint" style="color:var(--red);">${err.message}</p>`;
    return;
  }
  renderLeadershipBriefing(data);
}

function leadershipBar(label, done, total, extraHint) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return `
    <div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
        <span><strong>${label}</strong>${extraHint ? ' <span class="hint">' + extraHint + '</span>' : ''}</span>
        <span class="hint">${done}/${total} (${pct}%)</span>
      </div>
      <div style="background:var(--line);border-radius:6px;height:8px;overflow:hidden;">
        <div style="background:var(--grad-brand, #314691);width:${pct}%;height:100%;"></div>
      </div>
    </div>
  `;
}

function renderLeadershipBriefing(data) {
  const roleHint = document.getElementById('leadershipRoleHint');
  if (roleHint) roleHint.textContent = `Viewing as: ${data.role || 'Leadership'}. Read-only — figures update automatically as the team works.`;

  const k = data.kpis || {};
  document.getElementById('leadershipKpis').innerHTML = `
    <div class="stat-card"><div class="value">${k.totalDelegates ?? '-'}</div><div class="label">Delegates registered</div></div>
    <div class="stat-card"><div class="value">${k.totalClubs ?? '-'}</div><div class="label">Clubs represented</div></div>
    <div class="stat-card"><div class="value">${k.paymentCollectionPct != null ? k.paymentCollectionPct + '%' : '-'}</div><div class="label">Payments collected (₹${(k.paymentsCollected || 0).toLocaleString('en-IN')} of ₹${((k.paymentsCollected || 0) + (k.paymentsDue || 0)).toLocaleString('en-IN')})</div></div>
    <div class="stat-card"><div class="value">${k.sponsorsConfirmed ?? '-'}/${k.sponsorsTotal ?? '-'}</div><div class="label">Sponsors confirmed</div></div>
    <div class="stat-card"><div class="value">${k.hostTeamPaid ?? '-'}/${k.hostTeamTotal ?? '-'}</div><div class="label">Host team paid up</div></div>
    <div class="stat-card"><div class="value">${data.checklist && data.checklist.overallPct != null ? data.checklist.overallPct + '%' : '-'}</div><div class="label">Overall checklist complete</div></div>
  `;

  const checklistRows = (data.checklist && data.checklist.byCommittee) || [];
  document.getElementById('leadershipChecklistBars').innerHTML = checklistRows.length
    ? checklistRows.map((c) => leadershipBar(c.committee_name, c.done, c.total, c.overdue ? `⚠ ${c.overdue} overdue` : '')).join('')
    : '<p class="hint">No checklist items yet.</p>';

  const invRows = (data.inventory && data.inventory.byCommittee) || [];
  document.getElementById('leadershipInventoryBars').innerHTML = invRows.length
    ? invRows.map((c) => leadershipBar(c.committee_name, c.delivered, c.total, c.pending ? `${c.pending} pending` : '')).join('')
    : '<p class="hint">No goodies/inventory distributions tracked yet.</p>';

  const na = data.needsAttention || {};
  const overdue = na.overdueChecklist || [];
  const unconfirmedSponsors = na.unconfirmedSponsors || [];
  const undelivered = na.undeliveredInventory || [];
  document.getElementById('leadershipNeedsAttention').innerHTML = `
    ${overdue.length ? `
      <p style="margin:0 0 6px;"><strong>Overdue checklist items (${overdue.length})</strong></p>
      ${overdue.map((o) => `<p class="hint" style="margin:0 0 4px;">⚠ ${o.label} — ${o.owner_name || 'Unknown'} <span class="hint">(${o.committee_name || 'Unassigned'}, due ${o.due_date ? new Date(o.due_date).toLocaleDateString() : '-'})</span></p>`).join('')}
    ` : ''}
    ${unconfirmedSponsors.length ? `
      <p style="margin:12px 0 6px;"><strong>Sponsors not yet confirmed (${unconfirmedSponsors.length})</strong></p>
      ${unconfirmedSponsors.map((s) => `<p class="hint" style="margin:0 0 4px;">${s.name}${s.tier ? ' (' + s.tier + ')' : ''} — <span class="pill ${s.status}">${s.status}</span></p>`).join('')}
    ` : ''}
    ${undelivered.length ? `
      <p style="margin:12px 0 6px;"><strong>Goodies still pending delivery (${undelivered.length})</strong></p>
      ${undelivered.map((d) => `<p class="hint" style="margin:0 0 4px;">${d.item_name} → ${d.recipient_name || 'Unknown'} <span class="hint">(${d.committee_name || 'Unassigned'})</span></p>`).join('')}
    ` : ''}
    ${(!overdue.length && !unconfirmedSponsors.length && !undelivered.length) ? '<p class="hint">Nothing needs attention right now — everything is on track.</p>' : ''}
  `;

  const activity = data.activity || [];
  document.getElementById('leadershipActivityFeed').innerHTML = activity.length
    ? activity.map((a) => `<p class="hint" style="margin:0 0 6px;">${a.sentence} <span class="hint">— ${new Date(a.created_at).toLocaleString()}</span></p>`).join('')
    : '<p class="hint">No recent activity logged yet.</p>';
}

// ================= MEDIA =================
let mediaStarted = false;
function startMedia() { if (mediaStarted) return; mediaStarted = true; refreshMedia(); }

async function refreshMedia() {
  try {
    const videos = await jget(`${API}/media?type=video`);
    const posters = await jget(`${API}/media?type=poster`);
    const render = (items, kind) => items.map((m) => `
      <div class="thumb">
        ${kind === 'video' ? `<video src="${mediaUrl(m.filename)}" muted></video>` : `<img src="${mediaUrl(m.filename)}" />`}
        <div class="meta">
          <span>${m.title || ''}</span>
          <div>
            <button class="btn ${m.active ? 'outline' : 'gold'} small" onclick="toggleMedia(${m.id}, ${m.active ? 0 : 1})">${m.active ? 'Hide' : 'Show'}</button>
          </div>
        </div>
      </div>
    `).join('') || '<div class="empty">None uploaded yet</div>';
    document.getElementById('videoThumbs').innerHTML = render(videos, 'video');
    document.getElementById('posterThumbs').innerHTML = render(posters, 'poster');
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) console.error(e);
  }
}
window.toggleMedia = async (id, active) => {
  try { await jput(`${API}/media/${id}`, { active }); refreshMedia(); }
  catch (err) { toast(err.message); }
};

document.getElementById('mediaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  const fileInput = form.querySelector('input[type="file"]');
  if (!fileInput.files.length) { toast('Choose a file first'); return; }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Uploading… do not close this tab';
  toast(`Uploading ${fileInput.files[0].name} — this can take a while for large videos`, 6000);
  try {
    await uploadFile(`${API}/media/upload`, form);
    form.reset();
    toast('Upload complete and verified on the server', 3000);
    refreshMedia();
  } catch (err) {
    toast(err.message, 8000);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
});

// ================= DRIVER =================
let driverStarted = false;
function startDriver() { if (driverStarted) return; driverStarted = true; loadDriverMe(); }

function renderDriverProfile(p) {
  const el = document.getElementById('driverProfileBody');
  const avatar = document.getElementById('driverAvatar');
  if (!p) { el.innerHTML = '<div class="empty">Profile not found.</div>'; return; }
  if (avatar) avatar.textContent = initials(p.name);
  el.innerHTML = `
    <div class="form-grid cols-3">
      <div><strong>${escapeHtml(p.name)}</strong><div class="hint">Name</div></div>
      <div>${escapeHtml(p.phone || '-')}<div class="hint">Phone</div></div>
      <div>${p.vehicle_code ? `${escapeHtml(p.vehicle_code)} <span class="hint">(${escapeHtml(p.vehicle_master_type || '')}, ${p.seating_capacity || 0} seats)</span>` : escapeHtml(`${p.vehicle_type || ''} ${p.vehicle_number || ''}`.trim() || 'No vehicle on file')}<div class="hint">Vehicle</div></div>
    </div>
    ${p.partner_name ? `<p class="hint" style="margin:8px 0 0;">Transport partner: ${escapeHtml(p.partner_name)}</p>` : ''}
  `;
}

function renderDriverTrips(trips) {
  const el = document.getElementById('driverTripsBody');
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
        <select onchange="updateDriverTripStatus(${t.id}, this.value)">
          ${['planned', 'in_progress', 'completed', 'cancelled'].map((s) => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
        </select>
      </div>
    </div>
  `).join('');
}

window.updateDriverTripStatus = async (tripId, status) => {
  try {
    await jput(`${API}/driver-portal/trips/${tripId}`, { status });
    toast('Trip status updated');
    loadDriverMe();
  } catch (err) {
    toast(err.message);
  }
};

async function loadDriverMe() {
  try {
    const data = await jget(`${API}/driver-portal/me`);
    renderDriverProfile(data.profile);
    renderDriverTrips(data.trips || []);
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) console.error(e);
  }
}

// ================= TRANSPORTER =================
let transporterStarted = false;
let LAST_DRIVERS = [];
function startTransporter() { if (transporterStarted) return; transporterStarted = true; loadTransporterMe(); }

function renderTransporterProfile(p) {
  const el = document.getElementById('transporterProfileBody');
  const avatar = document.getElementById('transporterAvatar');
  if (!p) { el.innerHTML = '<div class="empty">Company profile not found.</div>'; return; }
  if (avatar) avatar.textContent = initials(p.name);
  el.innerHTML = `
    <div class="form-grid cols-3">
      <div><strong>${escapeHtml(p.name)}</strong><div class="hint">Company</div></div>
      <div>${escapeHtml(p.contact_person || '-')}<div class="hint">Contact person</div></div>
      <div>${escapeHtml(p.phone || '-')}<div class="hint">Phone</div></div>
    </div>
  `;
}

function renderTransporterDrivers(drivers) {
  document.getElementById('transporterDriversBody').innerHTML = drivers.map((d) => `
    <tr>
      <td>${escapeHtml(d.name)}</td>
      <td>${escapeHtml(d.phone || '-')}</td>
      <td>${d.vehicle_code ? escapeHtml(d.vehicle_code) + ` (${escapeHtml(d.vehicle_master_type || '')})` : escapeHtml(`${d.vehicle_type || ''} ${d.vehicle_number || ''}`.trim() || '-')}</td>
    </tr>
  `).join('') || '<tr><td colspan="3" class="empty">No drivers linked to your company yet — ask the admin team to add them.</td></tr>';
}

function driverOptionsHtml(currentDriverId) {
  const opts = LAST_DRIVERS.map((d) => `<option value="${d.id}" ${String(d.id) === String(currentDriverId) ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('');
  return `<option value="">-- unassigned --</option>${opts}`;
}

function renderTransporterTrips(trips) {
  const el = document.getElementById('transporterTripsBody');
  if (!trips.length) { el.innerHTML = '<div class="card"><div class="empty">No trips assigned to your fleet yet.</div></div>'; return; }
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
      <div class="form-grid cols-2" style="margin-top:10px;">
        <div class="field">
          <label>Assigned driver</label>
          <select onchange="assignDriver(${t.id}, this.value)">${driverOptionsHtml(t.driver_id)}</select>
        </div>
        <div class="field">
          <label>Status</label>
          <select onchange="updateTransporterTripStatus(${t.id}, this.value)">
            ${['planned', 'in_progress', 'completed', 'cancelled'].map((s) => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
  `).join('');
}

window.assignDriver = async (tripId, driverId) => {
  try {
    await jput(`${API}/transporter-portal/trips/${tripId}/assign-driver`, { driver_id: driverId || null });
    toast('Driver assignment updated');
    loadTransporterMe();
  } catch (err) {
    toast(err.message);
  }
};
window.updateTransporterTripStatus = async (tripId, status) => {
  try {
    await jput(`${API}/transporter-portal/trips/${tripId}/status`, { status });
    toast('Trip status updated');
    loadTransporterMe();
  } catch (err) {
    toast(err.message);
  }
};

async function loadTransporterMe() {
  try {
    const data = await jget(`${API}/transporter-portal/me`);
    LAST_DRIVERS = data.drivers || [];
    renderTransporterProfile(data.profile);
    renderTransporterDrivers(LAST_DRIVERS);
    renderTransporterTrips(data.trips || []);
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) console.error(e);
  }
}

// ================= VOLUNTEER =================
// A volunteer has none of a host member's committee/checklist/guest-relation
// baggage — just their granted modules, rendered by the SAME renderHostModules()
// used by host_member above (it's role-agnostic: it just needs a moduleAccess
// array and hits the shared /portal-modules/* endpoints under the hood).
let volunteerStarted = false;
function startVolunteer() { if (volunteerStarted) return; volunteerStarted = true; loadVolunteerMe(); }

async function loadVolunteerMe() {
  try {
    const data = await jget(`${API}/volunteer/me`);
    renderHostModules(data.moduleAccess || []);
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) toast(err.message);
  }
}

// ================= VENDOR =================
// An outside supplier — maintains their own product catalog (with photos)
// and updates the delivery status of what's been ordered from them, scoped
// entirely to their own vendor_id (see requireVendorRole in vendorPortal.js).
// They never see any other vendor's data, or anything about payment/approval
// amounts — only the delivery side of their own orders.
let vendorStarted = false;
function startVendor() { if (vendorStarted) return; vendorStarted = true; loadVendorMe(); }

const VENDOR_DELIVERY_LABEL = { ordered: 'Ordered', in_transit: 'In transit', delivered: 'Delivered', delayed: 'Delayed', cancelled: 'Cancelled' };
const VENDOR_PROC_LABEL = { planned: 'Planned (not yet ordered)', ordered: 'Ordered', received: 'Received', distributing: 'Distributing', completed: 'Completed', delayed: 'Delayed' };

function renderVendorProfile(p) {
  const el = document.getElementById('vendorProfileBody');
  const avatar = document.getElementById('vendorAvatar');
  if (!p) { el.innerHTML = '<div class="empty">Vendor profile not found.</div>'; return; }
  if (avatar) avatar.textContent = initials(p.name);
  el.innerHTML = `
    <div class="form-grid cols-3">
      <div><strong>${escapeHtml(p.name)}</strong><div class="hint">Company</div></div>
      <div>${escapeHtml(p.category || '-')}<div class="hint">Category</div></div>
      <div>${escapeHtml(p.contact_person || '-')}<div class="hint">Contact person</div></div>
    </div>
    <div class="form-grid cols-3" style="margin-top:10px;">
      <div>${escapeHtml(p.phone || '-')}<div class="hint">Phone</div></div>
      <div>${escapeHtml(p.email || '-')}<div class="hint">Email</div></div>
      <div><span class="pill ${p.status === 'active' ? 'paid' : 'pending'}">${escapeHtml(p.status)}</span><div class="hint">Status</div></div>
    </div>
  `;
}

// Image lightbox — click any wired thumbnail (product photos, etc.) to see
// it enlarged. Reusable: any <img onclick="openImageLightbox(this.src)">
// works with this without further wiring.
window.openImageLightbox = (src, alt) => {
  const overlay = document.getElementById('imageLightbox');
  const img = document.getElementById('imageLightboxImg');
  if (!overlay || !img || !src) return;
  img.src = src;
  img.alt = alt || '';
  overlay.style.display = '';
};
window.closeImageLightbox = () => {
  const overlay = document.getElementById('imageLightbox');
  const img = document.getElementById('imageLightboxImg');
  if (overlay) overlay.style.display = 'none';
  if (img) img.src = '';
};

let LAST_VENDOR_PRODUCTS = [];
function renderVendorProducts(products) {
  LAST_VENDOR_PRODUCTS = products;
  document.getElementById('vendorProductsBody').innerHTML = products.map((p) => `
    <div class="card" style="margin-bottom:10px;">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        ${p.photo_url
          ? `<img src="${mediaUrl(p.photo_url)}" alt="${escapeHtml(p.name)}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--border,#ddd);cursor:zoom-in;" onclick="openImageLightbox(this.src)" />`
          : `<div style="width:56px;height:56px;border-radius:8px;background:var(--bg2,#f2f2f2);"></div>`}
        <div style="flex:1;min-width:160px;">
          <strong>${escapeHtml(p.name)}</strong>${p.category ? ` <span class="hint">(${escapeHtml(p.category)})</span>` : ''}
          ${p.unit_price ? `<div class="hint">₹${Number(p.unit_price).toLocaleString('en-IN')} / ${escapeHtml(p.unit)}</div>` : ''}
          ${p.processing_time_days ? `<div class="hint">Processing time: ${p.processing_time_days} day${Number(p.processing_time_days) === 1 ? '' : 's'}</div>` : ''}
          <div><span class="pill ${p.status === 'active' ? 'paid' : 'pending'}">${escapeHtml(p.status)}</span></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button type="button" class="btn small" onclick="triggerVendorProductCamera(${p.id})">Take photo</button>
          <button type="button" class="btn small" onclick="triggerVendorProductUpload(${p.id})">${p.photo_url ? 'Replace image' : 'Upload image'}</button>
          <button type="button" class="btn small" onclick="editVendorProductPortal(${p.id})">Edit</button>
        </div>
      </div>
    </div>
  `).join('') || '<div class="card"><div class="empty">No products yet — add your first one above.</div></div>';
}

const VENDOR_PRODUCT_FORM_FIELDS = ['name', 'category', 'unit', 'unit_price', 'processing_time_days', 'status', 'description'];
window.editVendorProductPortal = (id) => {
  const p = LAST_VENDOR_PRODUCTS.find((x) => x.id === id);
  if (!p) return;
  const form = document.getElementById('vendorProductForm');
  VENDOR_PRODUCT_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = p[f] !== null && p[f] !== undefined ? p[f] : ''; });
  form.dataset.editId = id;
  document.getElementById('vendorProductFormTitle').textContent = `Edit product — ${p.name}`;
  document.getElementById('vendorProductSubmitBtn').textContent = 'Update product';
  document.getElementById('vendorProductCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('vendorProductCancelEditBtn').addEventListener('click', () => {
  const form = document.getElementById('vendorProductForm');
  form.reset(); delete form.dataset.editId;
  document.getElementById('vendorProductFormTitle').textContent = 'Add product';
  document.getElementById('vendorProductSubmitBtn').textContent = 'Save product';
  document.getElementById('vendorProductCancelEditBtn').style.display = 'none';
});
document.getElementById('vendorProductForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.editId) {
      await jput(`${API}/vendor-portal/products/${form.dataset.editId}`, body);
      toast('Product updated');
    } else {
      await jpost(`${API}/vendor-portal/products`, body);
      toast('Product added');
    }
    delete form.dataset.editId;
    form.reset();
    document.getElementById('vendorProductFormTitle').textContent = 'Add product';
    document.getElementById('vendorProductSubmitBtn').textContent = 'Save product';
    document.getElementById('vendorProductCancelEditBtn').style.display = 'none';
    loadVendorMe();
  } catch (err) { toast(err.message); }
});
// No delete button here by design — permanent deletion is super_admin-only
// everywhere in this system (see the global DELETE gate in server/index.js),
// and a vendor login never has that role. To retire a product, edit it and
// set Status to Inactive instead.

function renderVendorOrders(purchases, inventoryItems) {
  document.getElementById('vendorOrdersPurchasesBody').innerHTML = purchases.map((r) => `
    <div class="card" style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div>
          <strong>${escapeHtml(r.purchase_item_name)}</strong>
          <div class="hint">${r.purchase_quantity} ${escapeHtml(r.purchase_unit || '')} × ₹${Number(r.purchase_unit_cost || 0).toLocaleString('en-IN')}${r.expected_delivery_date ? ` · Expected: ${new Date(r.expected_delivery_date).toLocaleDateString()}` : ''}</div>
        </div>
        <select onchange="updateVendorPurchaseDelivery(${r.id}, this.value)">
          ${Object.keys(VENDOR_DELIVERY_LABEL).map((s) => `<option value="${s}" ${r.delivery_status === s ? 'selected' : ''}>${VENDOR_DELIVERY_LABEL[s]}</option>`).join('')}
        </select>
      </div>
    </div>
  `).join('') || '<div class="card"><div class="empty">Nothing ordered yet.</div></div>';

  document.getElementById('vendorOrdersInventoryBody').innerHTML = inventoryItems.map((i) => `
    <div class="card" style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div>
          <strong>${escapeHtml(i.name)}</strong>
          <div class="hint">${i.quantity_procured} ${escapeHtml(i.unit)}${i.expected_delivery_date ? ` · Expected: ${new Date(i.expected_delivery_date).toLocaleDateString()}` : ''}</div>
          <div class="hint">Current: ${VENDOR_PROC_LABEL[i.procurement_status] || i.procurement_status}</div>
        </div>
        <select onchange="updateVendorInventoryDelivery(${i.id}, this.value)">
          <option value="">-- set status --</option>
          <option value="ordered" ${i.procurement_status === 'ordered' ? 'selected' : ''}>Ordered</option>
          <option value="received" ${i.procurement_status === 'received' ? 'selected' : ''}>Received</option>
          <option value="delayed" ${i.procurement_status === 'delayed' ? 'selected' : ''}>Delayed</option>
        </select>
      </div>
    </div>
  `).join('') || '<div class="card"><div class="empty">Nothing ordered yet.</div></div>';
}
window.updateVendorPurchaseDelivery = async (id, delivery_status) => {
  try { await jput(`${API}/vendor-portal/orders/purchase/${id}/delivery`, { delivery_status }); toast('Delivery status updated'); loadVendorMe(); }
  catch (err) { toast(err.message); }
};
window.updateVendorInventoryDelivery = async (id, procurement_status) => {
  if (!procurement_status) return;
  try { await jput(`${API}/vendor-portal/orders/inventory/${id}/delivery`, { procurement_status }); toast('Delivery status updated'); loadVendorMe(); }
  catch (err) { toast(err.message); }
};

async function loadVendorMe() {
  try {
    const data = await jget(`${API}/vendor-portal/me`);
    renderVendorProfile(data.profile);
    renderVendorProducts(data.products || []);
    renderVendorOrders(data.purchases || [], data.inventoryItems || []);
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) toast(err.message);
  }
}

// ================= ANNOUNCEMENTS (shared across every role) =================
// One-way messages from the admin team — see server/routes/messages.js.
// No replies/threads: just a read state and, if the message carried one, a
// per-recipient action to mark done. Same shared tab for every role, same
// idea as host_member/volunteer sharing tab-host-modules.
async function loadAnnouncements() {
  try {
    const rows = await jget(`${API}/messages/inbox`);
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) console.error(err);
    return [];
  }
}
async function refreshAnnouncements() {
  const rows = await loadAnnouncements();
  const role = CURRENT_USER ? CURRENT_USER.role : null;
  const unreadCount = rows.filter((m) => !m.read_at).length;
  const badge = document.getElementById(`unreadBadge-${role}`);
  if (badge) {
    badge.textContent = unreadCount;
    badge.style.display = unreadCount ? '' : 'none';
  }
  document.getElementById('announcementsBody').innerHTML = rows.map((m) => `
    <div class="checklist-row status-${m.read_at ? 'completed' : 'pending'}" style="align-items:flex-start;flex-direction:column;gap:6px;">
      <div style="display:flex;justify-content:space-between;width:100%;gap:8px;">
        <strong>${m.title}${!m.read_at ? ' <span class="pill pending">New</span>' : ''}</strong>
        <span class="hint">${new Date(m.created_at).toLocaleString()}</span>
      </div>
      ${m.body ? `<p style="margin:0;white-space:pre-wrap;">${m.body}</p>` : ''}
      <p class="hint" style="margin:0;">From ${m.sender_username || 'the admin team'}</p>
      ${m.action_label ? `
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="pill ${m.action_done_at ? 'completed' : 'in_progress'}">${m.action_done_at ? '✓ Done' : 'Action needed'}: ${m.action_label}${m.action_due_date ? ' (due ' + m.action_due_date + ')' : ''}</span>
          ${!m.action_done_at ? `<button type="button" class="btn small" onclick="markAnnouncementActionDone(${m.message_id})">Mark done</button>` : ''}
        </div>
      ` : ''}
      ${!m.read_at ? `<button type="button" class="btn small outline" onclick="markAnnouncementRead(${m.message_id})">Mark read</button>` : ''}
    </div>
  `).join('') || '<p class="hint">No announcements yet.</p>';
}
window.markAnnouncementRead = async (messageId) => {
  try { await jput(`${API}/messages/${messageId}/read`, {}); refreshAnnouncements(); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
};
window.markAnnouncementActionDone = async (messageId) => {
  try { await jput(`${API}/messages/${messageId}/action-done`, {}); toast('Marked done'); refreshAnnouncements(); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
};

// ================= FINANCE APPROVALS =================
// For the small set of office-bearers the Finance module can route a
// payment/purchase request to (President, Secretary, Treasurer, Congress
// Chairman, Congress Treasurer) — a plain payment needs all five, a goodies
// purchase needs just President+Treasurer, but either way this person only
// ever sees requests waiting on THEIR OWN role. See GET
// /api/host/finance/approvals and POST .../approvals/:id/decide.
async function loadFinanceApprovals() {
  let pendingData, historyData;
  try {
    pendingData = await jget(`${API}/host/finance/approvals`);
  } catch (err) {
    if (err instanceof UnauthorizedError) return;
    const el = document.getElementById('approvalsPendingList');
    if (el) el.innerHTML = `<p class="hint" style="color:var(--red);">${err.message}</p>`;
    return;
  }
  try {
    historyData = await jget(`${API}/host/finance/approvals/history`);
  } catch (err) {
    historyData = [];
  }
  renderFinanceApprovals(pendingData, historyData);
}

function financeApprovalRowSummary(r) {
  if (r.subtype === 'purchase') {
    return `<strong>${r.purchase_item_name}</strong> — ${r.purchase_quantity} ${r.purchase_unit || ''} × ₹${Number(r.purchase_unit_cost || 0).toLocaleString('en-IN')} = ₹${Number(r.amount || 0).toLocaleString('en-IN')}${r.payee_or_payer ? ' from ' + r.payee_or_payer : ''}`;
  }
  return `<strong>₹${Number(r.amount || 0).toLocaleString('en-IN')}</strong> to ${r.payee_or_payer}${r.category ? ' (' + r.category + ')' : ''}`;
}

function renderFinanceApprovals(pendingData, historyRows) {
  const roleHint = document.getElementById('approvalsRoleHint');
  if (roleHint) roleHint.textContent = `Viewing as: ${pendingData.role || 'Approver'}.`;

  const pending = pendingData.pending || [];
  const badge = document.getElementById('approvalsBadge');
  if (badge) {
    if (pending.length) { badge.textContent = pending.length; badge.style.display = ''; }
    else { badge.style.display = 'none'; }
  }

  document.getElementById('approvalsPendingList').innerHTML = pending.length ? pending.map((r) => `
    <div class="card" style="margin-bottom:10px;">
      <p style="margin:0 0 4px;">${financeApprovalRowSummary(r)}</p>
      ${r.description ? `<p class="hint" style="margin:0 0 8px;">${r.description}</p>` : ''}
      <div style="display:flex;gap:8px;">
        <button type="button" class="btn small" onclick="decideFinanceApproval(${r.approval_id}, 'approved')">Approve</button>
        <button type="button" class="btn small outline" onclick="decideFinanceApproval(${r.approval_id}, 'rejected')">Reject</button>
      </div>
    </div>
  `).join('') : '<p class="hint">Nothing waiting on your approval right now.</p>';

  document.getElementById('approvalsHistoryList').innerHTML = (historyRows || []).length ? historyRows.map((r) => `
    <p class="hint" style="margin:0 0 6px;">
      <span class="pill ${r.my_status}">${r.my_status}</span>
      ${financeApprovalRowSummary(r)}
      ${r.decided_at ? ' — ' + new Date(r.decided_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
      ${r.remarks ? ' · "' + r.remarks + '"' : ''}
    </p>
  `).join('') : '<p class="hint">No decisions yet.</p>';
}

window.decideFinanceApproval = async (approvalId, decision) => {
  let remarks = '';
  if (decision === 'rejected') {
    remarks = prompt('Optional: reason for rejecting (visible to admins):', '') || '';
  }
  try {
    await jpost(`${API}/host/finance/approvals/${approvalId}/decide`, { decision, remarks });
    toast(decision === 'approved' ? 'Approved' : 'Rejected');
    loadFinanceApprovals();
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) toast(err.message);
  }
};

// ================= BOOT =================
tryResumeSession();
