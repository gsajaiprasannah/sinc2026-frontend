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
  vendor: ['vendor-profile', 'vendor-products', 'vendor-orders'],
  // Stall owners have no role-specific nav group of their own — their only
  // content is the shared "Badge Scanning" section below (My Visitors),
  // same one any other scan_point holder (hotel desk/transport/food counter/
  // inventory staff, regardless of their base role) also sees.
  stall_owner: [],
  // 'scanner' logins (created from the admin panel's "Scanner Logins"
  // section) are the same idea, deliberately kept to just one panel: no
  // delegate data, no finances, no other module — just their station's scan
  // history. Same empty-array pattern as stall_owner above.
  scanner: []
};
const ROLE_DEFAULT_TAB = { host_member: 'host-profile', media: 'media-upload', driver: 'driver-profile', transporter: 'transporter-profile', volunteer: 'host-modules', vendor: 'vendor-profile', stall_owner: 'my-scans', scanner: 'my-scans' };
const ROLE_TITLE = {
  host_member: ['Host Portal', "Your committees, delegates & checklist"],
  media: ['Media Portal', 'Upload the event video reel & posters'],
  driver: ['Driver Portal', 'Your assigned trips'],
  transporter: ['Transporter Portal', "Your fleet's trip requirements"],
  volunteer: ['Volunteer Portal', 'Your granted modules'],
  vendor: ['Vendor Portal', 'Your product catalog & order deliveries'],
  stall_owner: ['Stall Owner Portal', 'Visitors who scanned their badge at your stall'],
  // Subtitle here is a fallback — showApp() below overwrites it with the
  // actual station name (Registration Desk, Transport, ...) once
  // CURRENT_USER.scan_point is known.
  scanner: ['Scanner Login', 'Scan visitor badges for your station']
};
const ALLOWED_ROLES = ['host_member', 'media', 'transporter', 'driver', 'volunteer', 'vendor', 'stall_owner', 'scanner'];
// Display label for a scanner login's station — same scan_point vocabulary
// as SCAN_POINT_STATION_LABEL in admin.js (NOT the same as SCAN_POINT_LABEL_SELF
// below, which labels the ACTION recorded in attendance_log, not the duty).
const SCANNER_STATION_LABEL = {
  hotel_desk: 'Hotel Desk', transport: 'Transport', food_counter: 'Food Counter',
  inventory: 'Goodies / Inventory', registration: 'Registration Desk'
};

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
  // Release the camera the moment the scanner panel isn't visible anymore
  // (switching tabs, navigating away) — leaving it running in the
  // background would keep the device's camera indicator lit for no reason.
  if (tabKey !== 'my-scans' && typeof stopQrScanner === 'function') stopQrScanner();
}

document.getElementById('tabNav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  activateTab(btn.dataset.tab);
  // Sidebar module buttons (see renderHostModules) all share
  // data-tab="host-modules" but carry a unique data-module-key — switch to
  // that specific module's content now that its shared panel is showing.
  if (btn.dataset.moduleKey) selectHostModule(btn.dataset.moduleKey);
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
  // A scanner login's whole reason for existing is one station — show it
  // front and center instead of the generic fallback subtitle above.
  if (role === 'scanner' && CURRENT_USER && CURRENT_USER.scan_point) {
    document.getElementById('portalSubtitle').textContent =
      `Station: ${SCANNER_STATION_LABEL[CURRENT_USER.scan_point] || CURRENT_USER.scan_point}`;
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

  // Badge scanning ("My Scans" / "My Visitors") is orthogonal to role — any
  // login can be handed a scan_point duty (hotel desk/transport/food
  // counter/inventory) independent of their base role, and stall_owner is
  // a role whose ENTIRE portal is this one panel. See server/routes/badge.js
  // GET /my-scans (self-scoped to this login's own checked_in_by_user_id).
  const hasScanDuty = !!(CURRENT_USER && (CURRENT_USER.scan_point || role === 'stall_owner' || role === 'scanner'));
  const scanGroupLabel = document.getElementById('scanDutyGroupLabel');
  const scanNav = document.getElementById('scanDutyNav');
  if (scanGroupLabel) scanGroupLabel.style.display = hasScanDuty ? '' : 'none';
  if (scanNav) scanNav.style.display = hasScanDuty ? '' : 'none';
  const myScansBtn = document.getElementById('navBtnMyScans');
  if (myScansBtn) myScansBtn.firstChild.textContent = role === 'stall_owner' ? 'My Visitors' : 'My Scans';
  if (hasScanDuty) refreshMyScans();

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
  const sizesForm = document.getElementById('hostSizesForm');
  if (sizesForm) {
    if (sizesForm.elements.shirt_size) sizesForm.elements.shirt_size.value = p.shirt_size || '';
    if (sizesForm.elements.tshirt_size) sizesForm.elements.tshirt_size.value = p.tshirt_size || '';
    if (sizesForm.elements.waist_size) sizesForm.elements.waist_size.value = p.waist_size || '';
  }
  renderHostMediaPreview('hostPhotoPreview', p.photo_url, 'photo');
  renderHostMediaPreview('hostCardPreview', p.business_card_url, 'business card');
}

function renderHostMediaPreview(wrapId, url, label) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  wrap.innerHTML = url
    ? `<img src="${mediaUrl(url)}" alt="Your ${label}" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid var(--border,#ddd);display:block;" />`
    : `<p class="hint" style="margin:0;">No ${label} on file yet.</p>`;
}

const hostSizesFormEl = document.getElementById('hostSizesForm');
if (hostSizesFormEl) {
  hostSizesFormEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      await jput(`${API}/host/me/sizes`, body);
      toast('Sizes saved');
    } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
  });
}
const hostPhotoUploadBtn = document.getElementById('hostPhotoUploadBtn');
if (hostPhotoUploadBtn) {
  hostPhotoUploadBtn.addEventListener('click', () => document.getElementById('hostPhotoInput').click());
  document.getElementById('hostPhotoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = await uploadFileBlob(`${API}/host/me/photo`, file);
      toast('Photo uploaded');
      renderHostMediaPreview('hostPhotoPreview', data.photo_url, 'photo');
    } catch (err) { toast(err.message); }
  });
}
const hostCardUploadBtn = document.getElementById('hostCardUploadBtn');
if (hostCardUploadBtn) {
  hostCardUploadBtn.addEventListener('click', () => document.getElementById('hostCardInput').click());
  document.getElementById('hostCardInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = await uploadFileBlob(`${API}/host/me/business-card`, file);
      toast('Business card uploaded');
      renderHostMediaPreview('hostCardPreview', data.business_card_url, 'business card');
    } catch (err) { toast(err.message); }
  });
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
//
// A section (or a flat, non-sectioned module) opts into row-level Edit by
// setting `editable: true` — this adds an Actions column with an Edit
// button per row (see renderHostModuleSection/editHostModuleRow below),
// re-using the same PUT :id routes admin.js's per-tab edit forms call.
// Left off for Partners/Drivers, Rooms, Happenings, Clubs, and
// Registrations — admin.js itself has no per-row edit for any of these
// either, so there's no gap to close there.
//
// `optionsFrom` on a 'select' field can point either at another section of
// the SAME module (e.g. 'clubs') or at a narrow "-lite" sub-route living
// inside another module's own router (e.g. 'transport/vehicles-lite') —
// either way it's fetched as `${API}/portal-modules/${optionsFrom}`, which
// only ever succeeds if the committee's module grant already covers that
// mount (see server/routes/committeeModuleAccess.js + server/index.js).
const MODULE_CONFIG = {
  transport_partners: { label: 'Partners & Drivers', sections: [
    { path: 'partners', label: 'Transport Partners',
      columns: [['name', 'Name'], ['category', 'Category'], ['contact_person', 'Contact'], ['phone', 'Phone']],
      fields: [
        { name: 'name', label: 'Name', required: true },
        { name: 'category', label: 'Category', type: 'select',
          options: [['transport', 'Transport'], ['hotel', 'Hotel / Accommodation'], ['catering', 'Catering'], ['other', 'Other']] },
        { name: 'contact_person', label: 'Contact person' }, { name: 'phone', label: 'Phone' },
        { name: 'email', label: 'Email' }, { name: 'notes', label: 'Notes', type: 'textarea' },
      ] },
    { path: 'drivers', label: 'Drivers',
      columns: [['name', 'Name'], ['phone', 'Phone'], ['partner_id', 'Partner ID'], ['vehicle_id', 'Vehicle ID']],
      fields: [
        { name: 'name', label: 'Name', required: true }, { name: 'phone', label: 'Phone' },
        { name: 'partner_id', label: 'Transport partner', type: 'select', optionsFrom: 'partners',
          optionLabel: (p) => `${p.name}${p.category ? ' (' + p.category + ')' : ''}` },
        { name: 'vehicle_id', label: 'Assigned vehicle', type: 'select', optionsFrom: 'drivers/vehicles-lite',
          optionLabel: (v) => `${v.vehicle_code} · ${v.vehicle_type} (${v.seating_capacity} seats)${v.model ? ' — ' + v.model : ''}` },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ] },
  ] },
  vehicles: { label: 'Vehicles', path: 'vehicles', editable: true,
    columns: [['vehicle_code', 'Code'], ['vehicle_type', 'Type'], ['model', 'Model'], ['seating_capacity', 'Seats']],
    fields: [
      { name: 'vehicle_type', label: 'Type (van/car/bus)', required: true }, { name: 'model', label: 'Model' },
      { name: 'seating_capacity', label: 'Seating capacity', type: 'number' }, { name: 'registration_number', label: 'Registration number' },
      { name: 'partner_id', label: 'Transport partner', type: 'select', optionsFrom: 'vehicles/partners-lite',
        optionLabel: (p) => `${p.name}${p.category ? ' (' + p.category + ')' : ''}` },
      { name: '_vehicle_code_note', type: 'note', label: 'Vehicle code is auto-assigned when saved — S=van, C=car, A=bus, plus a sequence number.' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ] },
  transport_planning: { label: 'Transport Planning', path: 'transport', hasArrivalsQueue: true, editable: true,
    columns: [['trip_date', 'Date'], ['from_location', 'From'], ['to_location', 'To'], ['partner_name', 'Transporter'], ['passenger_count', 'Passengers'], ['status', 'Status']],
    // Per-row "Passengers" button (mirrors admin.js's manageTripPassengers)
    // opening the manifest panel below the table — see #tripPassengerCard
    // markup in tripPassengerCardHtml()/manageTripPassengers/
    // refreshTripPassengers further down this file.
    extraRowAction: (r) => `<button type="button" class="btn small" onclick="manageTripPassengers(${r.id}, '${(r.from_location + ' → ' + r.to_location).replace(/'/g, '')}')">Passengers</button>`,
    extraPanelHtml: tripPassengerCardHtml, extraPanelWire: wireTripPassengerForm,
    fields: [
      { name: 'from_location', label: 'From', required: true }, { name: 'to_location', label: 'To', required: true },
      { name: 'trip_date', label: 'Trip date', type: 'date' }, { name: 'depart_time', label: 'Depart time' },
      { name: 'purpose', label: 'Purpose' },
      { name: 'partner_id', label: 'Transport partner', type: 'select', optionsFrom: 'transport/partners-lite',
        optionLabel: (p) => `${p.name}${p.category ? ' (' + p.category + ')' : ''}` },
      // filterBy narrows this select's own option list to only rows whose
      // partner_id matches whatever's currently chosen in the 'partner_id'
      // field above — see wireSelectFiltering() in renderHostModuleSection.
      // Picking no partner (or a vehicle/driver with no partner_id set)
      // falls back to showing the full fleet, so this never blocks entry
      // for data that predates the Transport partner field.
      { name: 'vehicle_id', label: 'Vehicle', type: 'select', required: true, optionsFrom: 'transport/vehicles-lite',
        optionLabel: (v) => `${v.vehicle_code} · ${v.vehicle_type} (${v.seating_capacity} seats)${v.model ? ' — ' + v.model : ''}`,
        filterBy: { field: 'partner_id', match: 'partner_id' } },
      { name: 'driver_id', label: 'Driver', type: 'select', optionsFrom: 'transport/drivers-lite',
        optionLabel: (d) => `${d.name}${d.vehicle_code ? ' — ' + d.vehicle_code : ''}`,
        filterBy: { field: 'partner_id', match: 'partner_id' } },
      { name: 'status', label: 'Status', type: 'select',
        options: [['planned', 'Planned'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled']] },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ] },
  pretours: { label: 'Pre Tours', path: 'pretours', editable: true,
    columns: [['name', 'Name'], ['start_date', 'Start'], ['end_date', 'End'], ['participant_count', 'Signed up'], ['trip_count', 'Trips'], ['status', 'Status']],
    // Per-row "Manage" button (mirrors admin.js's manageTour) opening the
    // day-wise itinerary / signups / transport sub-panels below the table —
    // see tourManageCardHtml()/manageTour/refreshTourItinerary/
    // refreshTourParticipants/refreshTourTrips further down this file.
    extraRowAction: (r) => `<button type="button" class="btn small" onclick="manageTour(${r.id}, '${(r.name || '').replace(/'/g, '')}')">Manage</button>`,
    extraPanelHtml: tourManageCardHtml, extraPanelWire: wireTourManageForms,
    fields: [
      { name: 'name', label: 'Name', required: true }, { name: 'start_date', label: 'Start date', type: 'date' },
      { name: 'end_date', label: 'End date', type: 'date' }, { name: 'hotel', label: 'Hotel' },
      { name: 'attractions', label: 'Attractions' }, { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'capacity', label: 'Capacity', type: 'number' }, { name: 'price', label: 'Price', type: 'number' },
      { name: 'status', label: 'Status', type: 'select',
        options: [['planned', 'Planned'], ['confirmed', 'Confirmed'], ['completed', 'Completed'], ['cancelled', 'Cancelled']] },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ] },
  accommodation: { label: 'Accommodation & Rooms', sections: [
    { path: 'hotels', label: 'Hotels', editable: true,
      columns: [['name', 'Name'], ['address', 'Address'], ['contact_person', 'Contact'], ['phone', 'Phone']],
      fields: [
        { name: 'name', label: 'Name', required: true }, { name: 'address', label: 'Address' },
        { name: 'contact_person', label: 'Contact person' }, { name: 'phone', label: 'Phone' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ] },
    { path: 'rooms', label: 'Room Assignments',
      columns: [['room_number', 'Room #'], ['room_type', 'Type'], ['hotel_id', 'Hotel ID'], ['check_in', 'Check-in']],
      fields: [
        { name: 'hotel_id', label: 'Hotel', required: true, type: 'select', optionsFrom: 'hotels', optionLabel: (h) => h.name },
        { name: 'room_number', label: 'Room number' },
        { name: 'room_type', label: 'Room type', type: 'select',
          options: [['single', 'Single'], ['double', 'Double'], ['twin', 'Twin'], ['suite', 'Suite'], ['other', 'Other']] },
        // Occupant type toggle — same idea as admin.html's roomOccupantTypeSelect
        // / roomParticipantSelect / roomHmSelect: swap between a Delegate and a
        // Host member select (with real names) instead of two raw id inputs.
        { name: 'occupant', type: 'occupant_toggle', label: 'Occupant',
          participantField: 'participant_id', hostMemberField: 'host_member_id',
          participantOptionsFrom: 'rooms/participants-lite', hostMemberOptionsFrom: 'rooms/host-members-lite',
          participantOptionLabel: (p) => `${p.name} — ${p.participant_code || ''} (${p.club_name || 'no club'})`,
          hostMemberOptionLabel: (h) => `${h.name}${h.company ? ' (' + h.company + ')' : ''}` },
        { name: 'check_in', label: 'Check-in', type: 'date' }, { name: 'check_out', label: 'Check-out', type: 'date' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ] },
  ] },
  inventory: { label: 'Goodies & Inventory', path: 'inventory', editable: true, hasDeliveryMonitor: true,
    columns: [['name', 'Item'], ['category', 'Category'], ['quantity_procured', 'Procured'], ['procurement_status', 'Status'], ['delivered_count', 'Delivered']],
    // Per-row "Deliveries" button (mirrors admin.js's openInventoryDistModal)
    // opening the recipient list/add/bulk-assign panel below the table —
    // see inventoryDistCardHtml()/openInventoryDist/refreshInventoryDist
    // further down this file.
    extraRowAction: (r) => `<button type="button" class="btn small" onclick="openInventoryDist(${r.id}, '${(r.name || '').replace(/'/g, '')}')">Deliveries</button>`,
    extraPanelHtml: inventoryDistCardHtml, extraPanelWire: wireInventoryDistForms,
    fields: [
      { name: 'name', label: 'Item name', required: true }, { name: 'category', label: 'Category' },
      { name: 'unit', label: 'Unit' }, { name: 'quantity_procured', label: 'Quantity procured', type: 'number' },
      { name: 'unit_cost', label: 'Unit cost', type: 'number' }, { name: 'reorder_threshold', label: 'Reorder threshold', type: 'number' },
      { name: 'vendor_id', label: 'Vendor (from master)', type: 'select', optionsFrom: 'inventory/vendors-lite',
        optionLabel: (v) => `${v.name}${v.category ? ' (' + v.category + ')' : ''}` },
      { name: 'vendor_name', label: 'Vendor (one-off name, optional)' },
      { name: 'procurement_status', label: 'Procurement status', type: 'select',
        options: [['planned', 'Planned'], ['ordered', 'Ordered'], ['received', 'Received'], ['distributing', 'Distributing'], ['completed', 'Completed'], ['delayed', 'Delayed']] },
      { name: 'responsible_committee_id', label: 'Responsible committee', type: 'select', optionsFrom: 'inventory/committees-lite', optionLabel: (c) => c.name },
      { name: 'expected_delivery_date', label: 'Expected delivery date', type: 'date' },
      { name: 'actual_delivery_date', label: 'Actual delivery date', type: 'date' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ] },
  sponsors: { label: 'Sponsors', path: 'sponsors', editable: true,
    columns: [['name', 'Name'], ['tier', 'Tier'], ['contact_person', 'Contact'], ['status', 'Status']],
    fields: [
      { name: 'name', label: 'Name', required: true }, { name: 'tier', label: 'Tier' },
      { name: 'contact_person', label: 'Contact person' }, { name: 'phone', label: 'Phone' },
      { name: 'email', label: 'Email' },
      { name: 'status', label: 'Status', type: 'select', options: [['lead', 'Lead'], ['confirmed', 'Confirmed'], ['cancelled', 'Cancelled']] },
      { name: 'guest_relation_host_member_id', label: 'Guest Relation member (host member liaison)', type: 'select',
        optionsFrom: 'sponsors/host-members-lite', optionLabel: (h) => `${h.name}${h.company ? ' (' + h.company + ')' : ''}` },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ] },
  speakers: { label: 'Guest Speakers', path: 'speakers', editable: true,
    columns: [['name', 'Name'], ['topic', 'Topic'], ['session_type', 'Session type'], ['status', 'Status']],
    fields: [
      { name: 'name', label: 'Name', required: true }, { name: 'designation', label: 'Designation' },
      { name: 'organization', label: 'Organization' }, { name: 'topic', label: 'Topic' },
      { name: 'session_type', label: 'Role', type: 'select',
        options: [['Speaker', 'Speaker'], ['Moderator', 'Moderator'], ['Panelist', 'Panelist'], ['Other', 'Other']] },
      { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email' },
      { name: 'guest_relation_host_member_id', label: 'Guest Relation member (host member liaison)', type: 'select',
        optionsFrom: 'speakers/host-members-lite', optionLabel: (h) => `${h.name}${h.company ? ' (' + h.company + ')' : ''}` },
      { name: 'status', label: 'Status', type: 'select', options: [['invited', 'Invited'], ['confirmed', 'Confirmed'], ['cancelled', 'Cancelled']] },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ] },
  guestvisitors: { label: 'Guest Visitors', path: 'guestvisitors', editable: true,
    columns: [['name', 'Name'], ['category', 'Category'], ['visit_date', 'Visit date'], ['status', 'Status']],
    fields: [
      { name: 'name', label: 'Name', required: true }, { name: 'designation', label: 'Designation' },
      { name: 'organization', label: 'Organization' }, { name: 'category', label: 'Category' },
      { name: 'visit_date', label: 'Visit date', type: 'date' }, { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email' },
      { name: 'guest_relation_host_member_id', label: 'Guest Relation member (host member liaison)', type: 'select',
        optionsFrom: 'guestvisitors/host-members-lite', optionLabel: (h) => `${h.name}${h.company ? ' (' + h.company + ')' : ''}` },
      { name: 'status', label: 'Status', type: 'select', options: [['invited', 'Invited'], ['confirmed', 'Confirmed'], ['cancelled', 'Cancelled']] },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ] },
  // Was previously readOnly with no way to view/upload/hide anything from
  // the host portal — extraRowAction adds a per-row View link + Hide/Show
  // toggle (mirrors admin.js's toggleMedia), and extraPanelHtml adds the
  // real upload form below the table (needs multipart handling, which the
  // generic JSON submitHostModuleForm doesn't support, so this is bespoke —
  // see mediaUploadCardHtml()/wireMediaUploadForm() further down this file).
  media: { label: 'Media (Video/Poster/Print materials)', path: 'media',
    columns: [['title', 'Title'], ['type', 'Type'], ['active', 'Active']],
    extraRowAction: (r) => `
      <a class="btn small" href="${API}/media/${r.id}/download" target="_blank" rel="noopener">View</a>
      <button type="button" class="btn small ${r.active ? 'outline' : 'gold'}" onclick="toggleHostMedia(${r.id}, ${r.active ? 0 : 1})">${r.active ? 'Hide' : 'Show'}</button>
    `,
    extraPanelHtml: mediaUploadCardHtml, extraPanelWire: wireMediaUploadForm,
    fields: [] },
  happenings: { label: 'Live Happenings', path: 'happenings',
    columns: [['title', 'Title'], ['category', 'Category'], ['posted_by', 'Posted by']],
    fields: [
      { name: 'title', label: 'Title', required: true }, { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'category', label: 'Category', type: 'select',
        options: [['general', 'General'], ['logistics', 'Logistics'], ['session', 'Session'], ['social', 'Social event'], ['alert', 'Alert']] },
      { name: 'posted_by', label: 'Posted by' },
    ] },
  // Two sections: the public-facing Itinerary Slots list (day/time/title —
  // what the congress dashboard shows), and the admin-only Performer/Vendor
  // Groups master used by the slot-level Agenda Builder's "Performing group"
  // dropdown. Each Itinerary Slot row also gets an "Agenda" button (mirrors
  // admin.js's manageAgenda) opening the detailed per-slot event flow below
  // the table — see agendaCardHtml()/openAgenda/refreshAgenda further down
  // this file.
  itinerary: { label: 'Itinerary', sections: [
    { path: 'itinerary', label: 'Itinerary Slots', editable: true,
      columns: [['day_label', 'Day'], ['time_label', 'Time'], ['title', 'Title']],
      extraRowAction: (r) => `<button type="button" class="btn small" onclick="openAgenda(${r.id}, '${(itinerarySlotLabelHost(r)).replace(/'/g, '')}')">Agenda</button>`,
      extraPanelHtml: agendaCardHtml, extraPanelWire: wireAgendaForm,
      fields: [
        { name: 'day_label', label: 'Day label', required: true }, { name: 'time_label', label: 'Time label' },
        { name: 'title', label: 'Title', required: true }, { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'sort_order', label: 'Sort order', type: 'number' },
      ] },
    { path: 'performer-groups', label: 'Performer / Vendor Groups', editable: true,
      columns: [['name', 'Name'], ['category', 'Category'], ['contact_person', 'Contact'], ['fee_amount', 'Fee'], ['payment_status', 'Payment']],
      fields: [
        { name: 'name', label: 'Name', required: true }, { name: 'category', label: 'Category' },
        { name: 'contact_person', label: 'Contact person' }, { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email' },
        { name: 'fee_amount', label: 'Fee amount', type: 'number' },
        { name: 'payment_status', label: 'Payment status', type: 'select', options: [['pending', 'Pending'], ['paid', 'Paid']] },
        { name: 'payment_mode', label: 'Payment mode' },
        { name: 'payment_date', label: 'Payment date', type: 'date' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ] },
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
        { name: 'members_count', label: 'Members count', type: 'number', required: true },
      ] },
    { path: 'registrations', label: 'Registrations',
      columns: [['reg_number', 'Reg #'], ['reg_type', 'Type'], ['club_name', 'Club']],
      fields: [
        { name: 'reg_type', label: 'Registration type', type: 'select', required: true,
          options: [['single', 'Single'], ['double', 'Double'], ['congress_only', 'Congress Only (no room)']] },
        { name: 'club_id', label: 'Club', type: 'select', optionsFrom: 'clubs', optionLabel: (c) => c.name },
      ] },
    { path: 'participants', label: 'Delegates', editable: true,
      // Core identity/registration fields are frozen once a delegate exists —
      // only a super admin can change them (server-enforced too, see
      // PUT /api/participants/:id's FROZEN_FIELDS check). Mirrors admin.js's
      // PART_FROZEN_FIELDS/editPart.
      frozenFields: ['name', 'phone', 'club_id', 'registration_id'],
      columns: [['name', 'Name'], ['phone', 'Phone'], ['club_name', 'Club'], ['reg_number', 'Reg #']],
      fields: [
        { name: 'registration_id', label: 'Registration', type: 'select', required: true,
          optionsFrom: 'registrations', optionLabel: (r) => `${r.reg_number}${r.reg_type ? ' — ' + r.reg_type : ''}${r.club_name ? ' (' + r.club_name + ')' : ''}` },
        { name: 'name', label: 'Name', required: true }, { name: 'phone', label: 'Phone' },
        { name: 'whatsapp', label: 'WhatsApp' }, { name: 'email', label: 'Email' },
        { name: 'address', label: 'Address', type: 'textarea' },
        { name: 'club_id', label: 'Club', type: 'select', optionsFrom: 'clubs', optionLabel: (c) => c.name },
        { name: 'designation', label: 'Designation' }, { name: 'dietary_preference', label: 'Dietary preference' },
        { name: 'is_primary', label: 'Primary registrant', type: 'select', options: [['1', 'Yes'], ['0', 'No (co-registrant)']] },
        { name: 'travel_mode', label: 'Travel mode', type: 'select', options: [['flight', 'Flight'], ['train', 'Train'], ['road', 'Road'], ['other', 'Other']] },
        { name: 'travel_number', label: 'Travel number' },
        { name: 'travel_datetime', label: 'Travel date/time' }, { name: 'arrival_point', label: 'Arrival point' },
        // Travel — departure
        { name: 'departure_mode', label: 'Departure mode', type: 'select', options: [['flight', 'Flight'], ['train', 'Train'], ['road', 'Road'], ['other', 'Other']] },
        { name: 'departure_number', label: 'Departure number' },
        { name: 'departure_datetime', label: 'Departure date/time' }, { name: 'departure_point', label: 'Departure point' },
        // Pickup & SPOC
        { name: 'pickup_by', label: 'Pickup by' }, { name: 'pickup_vehicle', label: 'Pickup vehicle' }, { name: 'pickup_phone', label: 'Pickup phone' },
        { name: 'spoc_host_member_id', label: 'SPOC (host member)', type: 'select',
          optionsFrom: 'participants/host-members-lite', optionLabel: (h) => `${h.name}${h.company ? ' (' + h.company + ')' : ''}` },
        { name: 'spoc_name', label: 'SPOC name (if not a host member)' }, { name: 'spoc_phone', label: 'SPOC phone' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ] },
  ] },
};
let currentModuleKey = null, currentModuleSectionPath = null;
// The most recently fetched row list for the current section — reused by
// editHostModuleRow() so entering edit mode doesn't need a second fetch,
// same idea as admin.js's editVehicle/editTrip (which re-use their tab's
// already-fetched list rather than adding a per-row GET).
let currentModuleRows = [];

// Renders one sidebar button per granted module — directly in the actual
// left sidebar (under a "My Modules" group label), the same way the admin
// panel lists each module as its own item under its sidebar groups (e.g.
// "Operations ›" -> Vehicles, Transport Planning, ...). Every module button
// shares data-tab="host-modules" (they all open the same content panel;
// see tab-host-modules in login.html) plus a unique data-module-key so the
// #tabNav click handler below knows which module to actually render.
// host_member and volunteer are two separate (mutually exclusive) sidebar
// groups, so both containers are populated identically — only the one
// matching the logged-in role is ever visible.
function renderHostModules(moduleAccess) {
  const card = document.getElementById('hostModulesCard');
  const validKeys = (moduleAccess || []).filter((k) => MODULE_CONFIG[k]);
  const groupLabelHost = document.getElementById('myModulesGroupLabel-host_member');
  const navHost = document.getElementById('myModulesSidebarNav-host_member');
  const groupLabelVol = document.getElementById('myModulesGroupLabel-volunteer');
  const navVol = document.getElementById('myModulesSidebarNav-volunteer');
  if (!validKeys.length) {
    if (card) card.style.display = 'none';
    if (groupLabelHost) groupLabelHost.style.display = 'none';
    if (navHost) { navHost.style.display = 'none'; navHost.innerHTML = ''; }
    if (groupLabelVol) groupLabelVol.style.display = 'none';
    if (navVol) { navVol.style.display = 'none'; navVol.innerHTML = ''; }
    return;
  }
  if (card) card.style.display = '';
  const btnsHtml = validKeys.map((k) => `
    <button type="button" data-tab="host-modules" data-module-key="${k}">${MODULE_CONFIG[k].label}</button>
  `).join('');
  if (groupLabelHost) groupLabelHost.style.display = '';
  if (navHost) { navHost.style.display = ''; navHost.innerHTML = btnsHtml; }
  if (groupLabelVol) groupLabelVol.style.display = '';
  if (navVol) { navVol.style.display = ''; navVol.innerHTML = btnsHtml; }
  if (!currentModuleKey && validKeys.length) currentModuleKey = validKeys[0];
  if (currentModuleKey) selectHostModule(currentModuleKey, currentModuleSectionPath);
}
window.selectHostModule = async (key, sectionPath) => {
  currentModuleKey = key;
  const cfg = MODULE_CONFIG[key];
  if (!cfg) return;
  const section = cfg.sections ? (cfg.sections.find((s) => s.path === sectionPath) || cfg.sections[0]) : cfg;
  currentModuleSectionPath = section.path;
  document.querySelectorAll('[data-module-key]').forEach((b) => b.classList.toggle('active', b.dataset.moduleKey === key));
  const titleEl = document.getElementById('hostModuleSectionTitle');
  if (titleEl) titleEl.textContent = cfg.sections ? `${cfg.label} — ${section.label}` : cfg.label;
  await renderHostModuleSection(cfg, section);
};
// Every input whose name is one of these gets the shared pickup/drop-point
// dropdown button (see wireLocationDropdowns near the top of this file) —
// same fields admin.js treats as location pickers.
const LOCATION_SUGGEST_FIELDS = ['from_location', 'to_location', 'arrival_point', 'departure_point'];

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
  currentModuleRows = rows;
  // Fields of type 'select' with optionsFrom (e.g. a Delegate form's
  // "Registration" dropdown) pull their option list from ANOTHER section's
  // own endpoint in the same module, or from a narrow "-lite" sub-route
  // living inside another already-gated module's router (e.g.
  // 'transport/vehicles-lite') — fetched fresh on every render so a
  // club/registration/vehicle added a moment ago shows up immediately.
  // 'occupant_toggle' fields (Accommodation & Rooms) need two option lists
  // (participant + host member) instead of one.
  const optionPaths = new Set();
  section.fields.forEach((f) => {
    if (f.type === 'select' && f.optionsFrom) optionPaths.add(f.optionsFrom);
    if (f.type === 'occupant_toggle') { optionPaths.add(f.participantOptionsFrom); optionPaths.add(f.hostMemberOptionsFrom); }
  });
  const optionRows = {};
  for (const path of optionPaths) {
    try { optionRows[path] = await jget(`${API}/portal-modules/${path}`); }
    catch (err) { optionRows[path] = []; }
  }
  const sectionTabs = cfg.sections ? `
    <div style="display:flex;gap:6px;margin-bottom:10px;">
      ${cfg.sections.map((s) => `<button type="button" class="btn small ${s.path === section.path ? 'gold' : ''}" onclick="selectHostModule('${Object.keys(MODULE_CONFIG).find((k) => MODULE_CONFIG[k] === cfg)}', '${s.path}')">${s.label}</button>`).join('')}
    </div>` : '';
  // extraRowAction (e.g. transport_planning's "Passengers" button) shares the
  // same trailing actions column as the generic per-row Edit button — both
  // render into the same <td> when present, same pattern as admin.js's
  // sticky-actions cell holding several buttons side by side.
  const hasActionsCol = section.editable || section.extraRowAction;
  const actionsCol = hasActionsCol ? 1 : 0;
  body.innerHTML = `
    ${sectionTabs}
    <div class="table-scroll">
      <table>
        <thead><tr>${section.columns.map((c) => `<th>${c[1]}</th>`).join('')}${hasActionsCol ? '<th></th>' : ''}</tr></thead>
        <tbody>
          ${rows.map((r) => `<tr>${section.columns.map((c) => `<td>${escapeHtml(r[c[0]] == null ? '-' : r[c[0]])}</td>`).join('')}${hasActionsCol ? `<td>${section.editable ? `<button type="button" class="btn small" onclick="editHostModuleRow(${r.id})">Edit</button> ` : ''}${section.extraRowAction ? section.extraRowAction(r) : ''}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${section.columns.length + actionsCol}" class="empty">Nothing here yet</td></tr>`}
        </tbody>
      </table>
    </div>
    ${section.fields.length ? `
      <div class="section-title" style="font-size:14px;" id="hostModuleFormTitle">Add new</div>
      ${section.frozenFields ? '<p class="hint" id="hostModuleFrozenHint" style="display:none;color:var(--red);">Name, phone, club, and registration are locked once a delegate exists — only a super admin can change them.</p>' : ''}
      <form id="hostModuleForm" onsubmit="return submitHostModuleForm(event)">
        <div class="form-grid cols-2">
          ${section.fields.map((f) => {
            if (f.type === 'note') return `<div class="field" style="grid-column:1/-1;"><p class="hint" style="margin:0;">${f.label}</p></div>`;
            if (f.type === 'occupant_toggle') return `
              <div class="field"><label>Occupant type</label>
                <select data-occupant-type-select="${f.name}">
                  <option value="participant">Delegate</option>
                  <option value="host_member">Host member</option>
                </select>
              </div>
              <div class="field" data-occupant-wrap="participant:${f.name}"><label>Delegate</label>
                <select name="${f.participantField}">
                  <option value="">-- choose --</option>
                  ${(optionRows[f.participantOptionsFrom] || []).map((r) => `<option value="${r.id}">${escapeHtml(f.participantOptionLabel(r))}</option>`).join('')}
                </select>
              </div>
              <div class="field" data-occupant-wrap="host_member:${f.name}" style="display:none;"><label>Host member</label>
                <select name="${f.hostMemberField}">
                  <option value="">-- choose --</option>
                  ${(optionRows[f.hostMemberOptionsFrom] || []).map((r) => `<option value="${r.id}">${escapeHtml(f.hostMemberOptionLabel(r))}</option>`).join('')}
                </select>
              </div>
            `;
            return `
            <div class="field"><label>${f.label}${f.required ? ' *' : ''}</label>
              ${f.type === 'select' ? `
                <select name="${f.name}"${f.required ? ' required' : ''}>
                  <option value="">-- choose --</option>
                  ${f.optionsFrom
                    ? (optionRows[f.optionsFrom] || []).map((r) => `<option value="${r.id}">${escapeHtml(f.optionLabel(r))}</option>`).join('')
                    : (f.options || []).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                </select>
              ` : (f.type === 'textarea' ? `<textarea name="${f.name}"${f.required ? ' required' : ''}></textarea>` : `<input name="${f.name}" type="${f.type || 'text'}"${LOCATION_SUGGEST_FIELDS.includes(f.name) ? ' data-location-suggest="1"' : ''}${f.required ? ' required' : ''} />`)}
            </div>
          `;
          }).join('')}
        </div>
        <button class="btn gold small" type="submit" id="hostModuleSubmitBtn">Add</button>
        ${section.editable ? '<button type="button" class="btn small outline" id="hostModuleCancelEditBtn" style="display:none;" onclick="cancelEditHostModuleForm()">Cancel edit</button>' : ''}
      </form>
    ` : (cfg.readOnly ? '<p class="hint">This module is view-only from the host portal.</p>' : '')}
    ${section.extraPanelHtml ? section.extraPanelHtml() : ''}
    ${cfg.hasArrivalsQueue ? '<div id="transportQueueBody" style="margin-top:16px;"><p class="hint">Loading arrivals/departures…</p></div>' : ''}
    ${cfg.hasDeliveryMonitor ? inventoryMonitorCardHtml() : ''}
  `;
  wireLocationDropdowns(body);
  wireOccupantToggle(body);
  wireSelectFiltering(body, section, optionRows);
  if (section.extraPanelWire) section.extraPanelWire(body);
  if (cfg.hasArrivalsQueue) { refreshTransportPoints(); renderTransportQueue(); }
  if (cfg.hasDeliveryMonitor) { wireInventoryMonitorFilters(); refreshInventoryMonitor(); }
}

// Wires the "Occupant type" toggle select (Accommodation & Rooms' room-
// assignment form) to show/hide the matching Delegate/Host member select —
// mirrors admin.html/admin.js's roomOccupantTypeSelect behavior.
function wireOccupantToggle(root) {
  (root || document).querySelectorAll('[data-occupant-type-select]').forEach((sel) => {
    if (sel.dataset.wired) return;
    sel.dataset.wired = '1';
    const key = sel.dataset.occupantTypeSelect;
    const form = sel.closest('form');
    const apply = () => {
      const pWrap = form.querySelector(`[data-occupant-wrap="participant:${key}"]`);
      const hWrap = form.querySelector(`[data-occupant-wrap="host_member:${key}"]`);
      if (pWrap) pWrap.style.display = sel.value === 'participant' ? '' : 'none';
      if (hWrap) hWrap.style.display = sel.value === 'host_member' ? '' : 'none';
    };
    sel.addEventListener('change', apply);
    apply();
  });
}

// Wires up 'select' fields that declare `filterBy: { field, match }` (e.g.
// Transport Planning's Vehicle/Driver selects, filtered by whichever
// Transport partner is picked): narrows the target select's own option list
// down to only the fetched rows whose [match] property equals the current
// value of the [field] select, re-running whenever that trigger select
// changes. Falls back to the full unfiltered list whenever no trigger value
// is set (or the trigger field isn't present in this section at all), so
// older vehicles/drivers saved without a partner_id are never hidden.
function wireSelectFiltering(root, section, optionRows) {
  section.fields.forEach((f) => {
    if (f.type !== 'select' || !f.filterBy || !f.optionsFrom) return;
    const target = (root || document).querySelector(`select[name="${f.name}"]`);
    const trigger = (root || document).querySelector(`select[name="${f.filterBy.field}"]`);
    if (!target || !trigger) return;
    const allRows = optionRows[f.optionsFrom] || [];
    const apply = () => {
      const triggerVal = trigger.value;
      const keepVal = target.value;
      const rows = triggerVal ? allRows.filter((r) => String(r[f.filterBy.match] ?? '') === String(triggerVal)) : allRows;
      target.innerHTML = '<option value="">-- choose --</option>' +
        rows.map((r) => `<option value="${r.id}">${escapeHtml(f.optionLabel(r))}</option>`).join('');
      if (rows.some((r) => String(r.id) === String(keepVal))) target.value = keepVal;
    };
    trigger.addEventListener('change', apply);
    apply();
  });
}

// --- Generic row Edit (mirrors admin.js's editVehicle/cancelEditVehicle and
// editTrip/cancelEditTrip): populates the same "Add new" form with the
// row's current values and switches it into "update" mode via
// form.dataset.editId, tracked back to a real PUT :id call in
// submitHostModuleForm below. Only ever wired up for sections with
// `editable: true` in MODULE_CONFIG. ---
window.editHostModuleRow = (id) => {
  const cfg = MODULE_CONFIG[currentModuleKey];
  if (!cfg) return;
  const section = cfg.sections ? cfg.sections.find((s) => s.path === currentModuleSectionPath) : cfg;
  if (!section || !section.editable) return;
  const row = currentModuleRows.find((r) => String(r.id) === String(id));
  if (!row) return;
  const form = document.getElementById('hostModuleForm');
  if (!form) return;
  section.fields.forEach((f) => {
    if (f.type === 'note' || f.type === 'occupant_toggle') return;
    const el = form.elements[f.name];
    if (!el) return;
    el.value = row[f.name] !== null && row[f.name] !== undefined ? row[f.name] : '';
  });
  const isSuperAdmin = !!(CURRENT_USER && CURRENT_USER.role === 'super_admin');
  if (section.frozenFields) {
    section.frozenFields.forEach((f) => {
      const el = form.elements[f];
      if (el) el.disabled = !isSuperAdmin;
    });
    const hint = document.getElementById('hostModuleFrozenHint');
    if (hint) hint.style.display = isSuperAdmin ? 'none' : '';
  }
  form.dataset.editId = id;
  const label = row.name || row.title || row.vehicle_code || (row.from_location && row.to_location ? `${row.from_location} → ${row.to_location}` : `#${id}`);
  const titleEl = document.getElementById('hostModuleFormTitle');
  if (titleEl) titleEl.textContent = `Edit — ${label}`;
  const submitBtn = document.getElementById('hostModuleSubmitBtn');
  if (submitBtn) submitBtn.textContent = 'Update';
  const cancelBtn = document.getElementById('hostModuleCancelEditBtn');
  if (cancelBtn) cancelBtn.style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
window.cancelEditHostModuleForm = () => {
  const form = document.getElementById('hostModuleForm');
  if (!form) return;
  const cfg = MODULE_CONFIG[currentModuleKey];
  const section = cfg.sections ? cfg.sections.find((s) => s.path === currentModuleSectionPath) : cfg;
  form.reset();
  delete form.dataset.editId;
  // A brand-new row is never restricted — re-enable any fields left
  // disabled from a previous edit.
  if (section && section.frozenFields) {
    section.frozenFields.forEach((f) => { const el = form.elements[f]; if (el) el.disabled = false; });
    const hint = document.getElementById('hostModuleFrozenHint');
    if (hint) hint.style.display = 'none';
  }
  const titleEl = document.getElementById('hostModuleFormTitle');
  if (titleEl) titleEl.textContent = 'Add new';
  const submitBtn = document.getElementById('hostModuleSubmitBtn');
  if (submitBtn) submitBtn.textContent = 'Add';
  const cancelBtn = document.getElementById('hostModuleCancelEditBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
};

// --- Trip Passengers manifest (Transport Planning module) ---
// Mirrors admin.js's manageTripPassengers/refreshTripPassengers: clicking
// "Passengers" on a trip row opens this panel (appended below the Add/Edit
// form by renderHostModuleSection whenever cfg.extraRowAction is set) to
// add/view the delegates and host members riding that trip, each with an
// optional pickup point. No Remove button here — removing a passenger is a
// DELETE, and the server's global "DELETE requires super_admin" gate
// (server/index.js) means a committee member's token can never call it
// successfully, same reason every other section in this file has no delete
// UI. (admin.js's own Remove button is gated behind canDelete() for the
// exact same reason — a non-super-admin staff login can't use it either.)
let currentTripPassengerId = null;
let currentTripPassengerLabel = '';
function tripPassengerCardHtml() {
  return `
    <div class="card" id="tripPassengerCard" style="margin-top:14px; display:none;">
      <div class="section-title" style="margin-top:0">Manage passengers — <span id="tripPassengerTripLabel"></span></div>
      <form id="tripPassengerForm">
        <div class="form-grid cols-3">
          <div class="field"><label>Passenger type</label>
            <select id="tripPassengerTypeSelect">
              <option value="participant">Delegate</option>
              <option value="host_member">Host member</option>
            </select>
          </div>
          <div class="field"><label>Delegate</label><select id="tripPassengerParticipantSelect"></select></div>
          <div class="field"><label>Host member</label><select id="tripPassengerHmSelect" style="display:none;"></select></div>
        </div>
        <div class="field"><label>Pickup point</label><input id="tripPassengerPickup" data-location-suggest="1" placeholder="Lobby / Room 204 / ..." /></div>
        <button class="btn gold small" type="submit">Add passenger</button>
      </form>
      <div class="table-scroll" style="margin-top:12px;">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Phone</th><th>Pickup point</th></tr></thead>
          <tbody id="tripPassengerTableBody"></tbody>
        </table>
      </div>
    </div>
  `;
}
window.manageTripPassengers = async (id, label) => {
  currentTripPassengerId = id;
  currentTripPassengerLabel = label;
  const card = document.getElementById('tripPassengerCard');
  if (!card) return;
  document.getElementById('tripPassengerTripLabel').textContent = label;
  card.style.display = '';
  await refreshTripPassengerOptions();
  await refreshTripPassengers();
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
async function refreshTripPassengerOptions() {
  try {
    const [participants, hostMembers] = await Promise.all([
      jget(`${API}/portal-modules/transport/participants-lite`),
      jget(`${API}/portal-modules/transport/host-members-lite`),
    ]);
    const pSelect = document.getElementById('tripPassengerParticipantSelect');
    const hSelect = document.getElementById('tripPassengerHmSelect');
    if (pSelect) pSelect.innerHTML = participants.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} — ${escapeHtml(p.participant_code || '')} (${escapeHtml(p.club_name || 'no club')})</option>`).join('');
    if (hSelect) hSelect.innerHTML = hostMembers.map((h) => `<option value="${h.id}">${escapeHtml(h.name)}${h.company ? ' (' + escapeHtml(h.company) + ')' : ''}</option>`).join('');
  } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
}
async function refreshTripPassengers() {
  if (!currentTripPassengerId) return;
  let trip;
  try {
    trip = await jget(`${API}/portal-modules/transport/${currentTripPassengerId}`);
  } catch (err) {
    if (err instanceof UnauthorizedError) return;
    toast(err.message);
    return;
  }
  document.getElementById('tripPassengerTableBody').innerHTML = (trip.passengers || []).map((p) => `
    <tr>
      <td>${escapeHtml(p.participant_name || p.host_member_name || '-')}</td>
      <td>${p.participant_id ? 'Delegate' : 'Host member'}</td>
      <td>${escapeHtml(p.participant_phone || p.host_member_phone || '-')}</td>
      <td>${escapeHtml(p.pickup_point || '-')}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="empty">No passengers added yet</td></tr>';
}
function wireTripPassengerForm() {
  const sel = document.getElementById('tripPassengerTypeSelect');
  if (sel && !sel.dataset.wired) {
    sel.dataset.wired = '1';
    sel.addEventListener('change', (e) => {
      const isHm = e.target.value === 'host_member';
      document.getElementById('tripPassengerParticipantSelect').style.display = isHm ? 'none' : '';
      document.getElementById('tripPassengerHmSelect').style.display = isHm ? '' : 'none';
    });
  }
  const form = document.getElementById('tripPassengerForm');
  if (form && !form.dataset.wired) {
    form.dataset.wired = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentTripPassengerId) { toast('Select a trip first — click "Passengers" on a row above.'); return; }
      const isHm = document.getElementById('tripPassengerTypeSelect').value === 'host_member';
      const body = {
        participant_id: isHm ? null : (document.getElementById('tripPassengerParticipantSelect').value || null),
        host_member_id: isHm ? (document.getElementById('tripPassengerHmSelect').value || null) : null,
        pickup_point: document.getElementById('tripPassengerPickup').value
      };
      if (!body.participant_id && !body.host_member_id) { toast('Choose a delegate or a host member'); return; }
      try {
        await jpost(`${API}/portal-modules/transport/${currentTripPassengerId}/passengers`, body);
        if (body.pickup_point) ensureTransportPoint(body.pickup_point);
        document.getElementById('tripPassengerPickup').value = '';
        toast('Passenger added');
        await refreshTripPassengers();
        // Re-render the trip table so the Passengers count badge stays in
        // sync, then re-open this same panel (renderHostModuleSection wipes
        // and rebuilds #hostModuleBody, including this card).
        const cfg = MODULE_CONFIG.transport_planning;
        await renderHostModuleSection(cfg, cfg);
        await window.manageTripPassengers(currentTripPassengerId, currentTripPassengerLabel);
      } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
    });
  }
}

// --- Pre Tour "Manage" panel: day-wise itinerary, delegate/host-member
// signups (with payment status), and tour-scoped transport. Mirrors
// admin.js's manageTour/refreshTourItinerary/refreshTourParticipants/
// refreshTourTrips, wired to this committee's own portal-modules/pretours
// mount — including /pretours/:id/trips, a tour-scoped mirror of the shared
// transport_trips table (see server/routes/pretours.js) added so a
// committee only granted the Pre Tours module can plan this tour's
// transport without also needing the separate Transport Planning module
// grant. No delete UI on any of the three sub-tables, same reasoning as
// the Trip Passengers manifest above — DELETE always 403s for a non-
// super-admin token, so admin.js's own Remove/Delete buttons here are
// gated behind canDelete() too.
let currentTourId = null;
let currentTourLabel = '';
function tourManageCardHtml() {
  return `
    <div class="card" id="tourManageCard" style="margin-top:14px; display:none;">
      <div class="section-title" style="margin-top:0">Manage — <span id="tourManageLabel"></span></div>

      <div class="section-title" style="font-size:12px;">Day-wise itinerary</div>
      <form id="tourItinForm">
        <div class="form-grid cols-3">
          <div class="field"><label>Day label *</label><input name="day_label" required placeholder="Day 1 · 10 Aug" /></div>
          <div class="field"><label>Time</label><input name="time_label" placeholder="9:00 AM" /></div>
          <div class="field"><label>Sort order</label><input name="sort_order" type="number" value="0" /></div>
        </div>
        <div class="field"><label>Title *</label><input name="title" required /></div>
        <div class="field"><label>Location</label><input name="location" /></div>
        <div class="field"><label>Description</label><textarea name="description"></textarea></div>
        <button class="btn gold small" type="submit">Add itinerary item</button>
      </form>
      <div class="table-scroll" style="margin-top:8px;">
        <table>
          <thead><tr><th>Day</th><th>Time</th><th>Title</th><th>Location</th></tr></thead>
          <tbody id="tourItinTableBody"></tbody>
        </table>
      </div>

      <div class="section-title" style="font-size:12px;margin-top:20px;">Hotel Plan (day-by-day) — stay + each meal sitting</div>
      <p class="hint" style="margin-top:-4px;">Full Board tours: define the stay hotel plus a hotel for each of the day's 5 sittings (breakfast, hi-tea, lunch, hi-tea, dinner) — any of them can be a different hotel than where the group sleeps. Leave a hotel blank if it's not yet decided.</p>
      <form id="tourHotelDayForm">
        <div class="form-grid cols-3">
          <div class="field"><label>Day label *</label><input name="day_label" required placeholder="Day 1 · 10 Aug" /></div>
          <div class="field"><label>Date</label><input name="day_date" type="date" /></div>
          <div class="field"><label>Sort order</label><input name="sort_order" type="number" value="0" /></div>
        </div>
        <div class="field"><label>Stay hotel</label><select name="stay_hotel_id" id="tourHotelDayStaySelect"><option value="">-- none --</option></select></div>
        <div class="form-grid cols-3">
          <div class="field"><label>Breakfast hotel</label><select name="breakfast_hotel_id" id="tourHotelDayBreakfastSelect"><option value="">-- same as stay --</option></select></div>
          <div class="field"><label>Hi-Tea 1 hotel</label><select name="hitea1_hotel_id" id="tourHotelDayHitea1Select"><option value="">-- same as stay --</option></select></div>
          <div class="field"><label>Lunch hotel</label><select name="lunch_hotel_id" id="tourHotelDayLunchSelect"><option value="">-- same as stay --</option></select></div>
        </div>
        <div class="form-grid cols-2">
          <div class="field"><label>Hi-Tea 2 hotel</label><select name="hitea2_hotel_id" id="tourHotelDayHitea2Select"><option value="">-- same as stay --</option></select></div>
          <div class="field"><label>Dinner hotel</label><select name="dinner_hotel_id" id="tourHotelDayDinnerSelect"><option value="">-- same as stay --</option></select></div>
        </div>
        <div class="field"><label>Notes</label><input name="notes" /></div>
        <button class="btn gold small" type="submit">Add day</button>
      </form>
      <div class="table-scroll" style="margin-top:8px;">
        <table>
          <thead><tr><th>Day</th><th>Date</th><th>Stay</th><th>Breakfast</th><th>Hi-Tea 1</th><th>Lunch</th><th>Hi-Tea 2</th><th>Dinner</th><th>Notes</th></tr></thead>
          <tbody id="tourHotelDayTableBody"></tbody>
        </table>
      </div>

      <div class="section-title" style="font-size:12px;margin-top:20px;">Delegates / host members signed up</div>
      <form id="tourPartForm">
        <div class="form-grid cols-3">
          <div class="field"><label>Type</label>
            <select id="tourPartTypeSelect">
              <option value="participant">Delegate</option>
              <option value="host_member">Host member</option>
            </select>
          </div>
          <div class="field"><label>Delegate</label><select id="tourPartParticipantSelect"></select></div>
          <div class="field"><label>Host member</label><select id="tourPartHmSelect" style="display:none;"></select></div>
        </div>
        <div class="field"><label>Payment status</label>
          <select id="tourPartPaymentSelect"><option value="pending">Pending</option><option value="paid">Paid</option></select>
        </div>
        <button class="btn gold small" type="submit">Add to tour</button>
      </form>
      <div class="table-scroll" style="margin-top:8px;">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Phone</th><th>Payment</th></tr></thead>
          <tbody id="tourPartTableBody"></tbody>
        </table>
      </div>

      <div class="section-title" style="font-size:12px;margin-top:20px;">Transport for this tour</div>
      <form id="tourTripForm">
        <div class="form-grid cols-3">
          <div class="field"><label>From *</label><input name="from_location" data-location-suggest="1" required /></div>
          <div class="field"><label>To *</label><input name="to_location" data-location-suggest="1" required /></div>
          <div class="field"><label>Purpose</label><input name="purpose" /></div>
        </div>
        <div class="form-grid cols-3">
          <div class="field"><label>Date</label><input name="trip_date" type="date" /></div>
          <div class="field"><label>Depart time</label><input name="depart_time" type="time" /></div>
          <div class="field"><label>Transporter</label><select name="partner_id" id="tourTripPartnerSelect"><option value="">-- any --</option></select></div>
        </div>
        <div class="form-grid cols-2">
          <div class="field"><label>Vehicle *</label><select name="vehicle_id" id="tourTripVehicleSelect" required></select></div>
          <div class="field"><label>Driver</label><select name="driver_id" id="tourTripDriverSelect"><option value="">-- none --</option></select></div>
        </div>
        <button class="btn gold small" type="submit">Add trip</button>
      </form>
      <div class="table-scroll" style="margin-top:8px;">
        <table>
          <thead><tr><th>Date</th><th>Route</th><th>Transporter</th><th>Vehicle</th><th>Driver</th><th>Passengers</th></tr></thead>
          <tbody id="tourTripTableBody"></tbody>
        </table>
      </div>
    </div>
  `;
}
window.manageTour = async (id, name) => {
  currentTourId = id;
  currentTourLabel = name;
  const card = document.getElementById('tourManageCard');
  if (!card) return;
  document.getElementById('tourManageLabel').textContent = name;
  card.style.display = '';
  await Promise.all([refreshTourPartOptions(), refreshTourTripOptions(), refreshTourHotelDayOptions()]);
  await Promise.all([refreshTourItinerary(), refreshTourParticipants(), refreshTourTrips(), refreshTourHotelDays()]);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
// Day-by-day Hotel Plan: which hotel a group sleeps at, plus a hotel for
// each of the day's 5 sittings (breakfast/hi-tea/lunch/hi-tea/dinner),
// per day of a Full Board pre tour — see pre_tour_days on the backend.
const HOTEL_DAY_MEAL_FIELDS = ['breakfast_hotel_id', 'hitea1_hotel_id', 'lunch_hotel_id', 'hitea2_hotel_id', 'dinner_hotel_id'];
async function refreshTourHotelDayOptions() {
  try {
    const hotels = await jget(`${API}/portal-modules/pretours/hotels-lite`);
    const opts = hotels.map((h) => `<option value="${h.id}">${escapeHtml(h.name)}</option>`).join('');
    const stayEl = document.getElementById('tourHotelDayStaySelect');
    if (stayEl) stayEl.innerHTML = '<option value="">-- none --</option>' + opts;
    ['tourHotelDayBreakfastSelect', 'tourHotelDayHitea1Select', 'tourHotelDayLunchSelect', 'tourHotelDayHitea2Select', 'tourHotelDayDinnerSelect'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<option value="">-- same as stay --</option>' + opts;
    });
  } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
}
async function refreshTourHotelDays() {
  if (!currentTourId) return;
  let rows = [];
  try { rows = await jget(`${API}/portal-modules/pretours/${currentTourId}/hotel-days`); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); return; }
  document.getElementById('tourHotelDayTableBody').innerHTML = rows.map((d) => `
    <tr>
      <td>${escapeHtml(d.day_label)}</td>
      <td>${d.day_date || '-'}</td>
      <td>${escapeHtml(d.stay_hotel_name || '-')}</td>
      <td>${escapeHtml(d.breakfast_hotel_name || (d.stay_hotel_name ? 'same as stay' : '-'))}</td>
      <td>${escapeHtml(d.hitea1_hotel_name || (d.stay_hotel_name ? 'same as stay' : '-'))}</td>
      <td>${escapeHtml(d.lunch_hotel_name || (d.stay_hotel_name ? 'same as stay' : '-'))}</td>
      <td>${escapeHtml(d.hitea2_hotel_name || (d.stay_hotel_name ? 'same as stay' : '-'))}</td>
      <td>${escapeHtml(d.dinner_hotel_name || (d.stay_hotel_name ? 'same as stay' : '-'))}</td>
      <td>${escapeHtml(d.notes || '-')}</td>
    </tr>
  `).join('') || '<tr><td colspan="9" class="empty">No hotel plan added yet</td></tr>';
}
async function refreshTourItinerary() {
  if (!currentTourId) return;
  let rows = [];
  try { rows = await jget(`${API}/portal-modules/pretours/${currentTourId}/itinerary`); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); return; }
  document.getElementById('tourItinTableBody').innerHTML = rows.map((i) => `
    <tr>
      <td>${escapeHtml(i.day_label)}</td><td>${escapeHtml(i.time_label || '-')}</td><td>${escapeHtml(i.title)}</td><td>${escapeHtml(i.location || '-')}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="empty">No itinerary items yet</td></tr>';
}
async function refreshTourPartOptions() {
  try {
    const [participants, hostMembers] = await Promise.all([
      jget(`${API}/portal-modules/pretours/participants-lite`),
      jget(`${API}/portal-modules/pretours/host-members-lite`),
    ]);
    const pSelect = document.getElementById('tourPartParticipantSelect');
    const hSelect = document.getElementById('tourPartHmSelect');
    if (pSelect) pSelect.innerHTML = participants.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} — ${escapeHtml(p.participant_code || '')} (${escapeHtml(p.club_name || 'no club')})</option>`).join('');
    if (hSelect) hSelect.innerHTML = hostMembers.map((h) => `<option value="${h.id}">${escapeHtml(h.name)}${h.company ? ' (' + escapeHtml(h.company) + ')' : ''}</option>`).join('');
  } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
}
async function refreshTourParticipants() {
  if (!currentTourId) return;
  let rows = [];
  try { rows = await jget(`${API}/portal-modules/pretours/${currentTourId}/participants`); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); return; }
  document.getElementById('tourPartTableBody').innerHTML = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.participant_name || r.host_member_name || '-')}</td>
      <td>${r.participant_id ? 'Delegate' : 'Host member'}</td>
      <td>${escapeHtml(r.participant_phone || r.host_member_phone || '-')}</td>
      <td><select onchange="updateTourParticipantPayment(${r.id}, this.value)">
        <option value="pending" ${r.payment_status === 'pending' ? 'selected' : ''}>Pending</option>
        <option value="paid" ${r.payment_status === 'paid' ? 'selected' : ''}>Paid</option>
      </select></td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="empty">No signups yet</td></tr>';
}
window.updateTourParticipantPayment = async (rowId, payment_status) => {
  try { await jput(`${API}/portal-modules/pretours/participants/${rowId}`, { payment_status }); toast('Payment status updated'); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
};
let tourTripVehicles = [];
let tourTripDrivers = [];
async function refreshTourTripOptions() {
  try {
    const [vehicles, drivers, partners] = await Promise.all([
      jget(`${API}/portal-modules/pretours/vehicles-lite`),
      jget(`${API}/portal-modules/pretours/drivers-lite`),
      jget(`${API}/portal-modules/pretours/partners-lite`),
    ]);
    tourTripVehicles = vehicles;
    tourTripDrivers = drivers;
    const pSelect = document.getElementById('tourTripPartnerSelect');
    if (pSelect) pSelect.innerHTML = '<option value="">-- any --</option>' + partners.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}${p.category ? ' (' + escapeHtml(p.category) + ')' : ''}</option>`).join('');
    applyTourTripPartnerFilter();
  } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
}
// Narrows the Vehicle/Driver selects to only the fleet belonging to
// whichever Transporter was picked, re-run whenever that select changes —
// mirrors MODULE_CONFIG.transport_planning's filterBy behavior, hand-rolled
// here since this is a custom form rather than the generic field renderer.
// Falls back to the full fleet when no Transporter is picked (or a
// vehicle/driver predates the partner_id field), so nothing is ever hidden.
function applyTourTripPartnerFilter() {
  const pSelect = document.getElementById('tourTripPartnerSelect');
  const vSelect = document.getElementById('tourTripVehicleSelect');
  const dSelect = document.getElementById('tourTripDriverSelect');
  if (!vSelect || !dSelect) return;
  const partnerVal = pSelect ? pSelect.value : '';
  const keepV = vSelect.value, keepD = dSelect.value;
  const vRows = partnerVal ? tourTripVehicles.filter((v) => String(v.partner_id ?? '') === String(partnerVal)) : tourTripVehicles;
  const dRows = partnerVal ? tourTripDrivers.filter((d) => String(d.partner_id ?? '') === String(partnerVal)) : tourTripDrivers;
  vSelect.innerHTML = '<option value="">-- select vehicle --</option>' + vRows.map((v) => `<option value="${v.id}">${v.vehicle_code} · ${v.vehicle_type} (${v.seating_capacity} seats)${v.model ? ' — ' + v.model : ''}</option>`).join('');
  dSelect.innerHTML = '<option value="">-- none --</option>' + dRows.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}${d.vehicle_code ? ' — ' + d.vehicle_code : ''}</option>`).join('');
  if (vRows.some((v) => String(v.id) === String(keepV))) vSelect.value = keepV;
  if (dRows.some((d) => String(d.id) === String(keepD))) dSelect.value = keepD;
}
async function refreshTourTrips() {
  if (!currentTourId) return;
  let rows = [];
  try { rows = await jget(`${API}/portal-modules/pretours/${currentTourId}/trips`); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); return; }
  document.getElementById('tourTripTableBody').innerHTML = rows.map((t) => `
    <tr>
      <td>${t.trip_date || '-'}</td>
      <td>${escapeHtml(t.from_location)} → ${escapeHtml(t.to_location)}</td>
      <td>${escapeHtml(t.partner_name || '-')}</td>
      <td>${t.vehicle_code || '-'}</td>
      <td>${escapeHtml(t.driver_name || '-')}</td>
      <td>${t.passenger_count || 0}</td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty">No transport planned yet</td></tr>';
}
// Re-renders the whole Pre Tours section (so the "Signed up"/"Trips" count
// badges on the main table stay in sync) and then re-opens this same
// tour's Manage panel — renderHostModuleSection wipes and rebuilds
// #hostModuleBody, including this card, on every call.
async function refreshPreTourCountsAndReopen() {
  const cfg = MODULE_CONFIG.pretours;
  await renderHostModuleSection(cfg, cfg);
  await window.manageTour(currentTourId, currentTourLabel);
}
function wireTourManageForms() {
  const itinForm = document.getElementById('tourItinForm');
  if (itinForm && !itinForm.dataset.wired) {
    itinForm.dataset.wired = '1';
    itinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentTourId) { toast('Click "Manage" on a tour first'); return; }
      const body = Object.fromEntries(new FormData(e.target).entries());
      try {
        await jpost(`${API}/portal-modules/pretours/${currentTourId}/itinerary`, body);
        e.target.reset();
        toast('Itinerary item added');
        refreshTourItinerary();
      } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
    });
  }
  const hotelDayForm = document.getElementById('tourHotelDayForm');
  if (hotelDayForm && !hotelDayForm.dataset.wired) {
    hotelDayForm.dataset.wired = '1';
    hotelDayForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentTourId) { toast('Click "Manage" on a tour first'); return; }
      const body = Object.fromEntries(new FormData(e.target).entries());
      if (!body.stay_hotel_id) delete body.stay_hotel_id;
      HOTEL_DAY_MEAL_FIELDS.forEach((f) => { if (!body[f]) delete body[f]; });
      try {
        await jpost(`${API}/portal-modules/pretours/${currentTourId}/hotel-days`, body);
        e.target.reset();
        toast('Hotel plan day added');
        refreshTourHotelDays();
      } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
    });
  }
  const typeSel = document.getElementById('tourPartTypeSelect');
  if (typeSel && !typeSel.dataset.wired) {
    typeSel.dataset.wired = '1';
    typeSel.addEventListener('change', (e) => {
      const isHm = e.target.value === 'host_member';
      document.getElementById('tourPartParticipantSelect').style.display = isHm ? 'none' : '';
      document.getElementById('tourPartHmSelect').style.display = isHm ? '' : 'none';
    });
  }
  const partForm = document.getElementById('tourPartForm');
  if (partForm && !partForm.dataset.wired) {
    partForm.dataset.wired = '1';
    partForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentTourId) { toast('Click "Manage" on a tour first'); return; }
      const isHm = document.getElementById('tourPartTypeSelect').value === 'host_member';
      const body = {
        participant_id: isHm ? null : (document.getElementById('tourPartParticipantSelect').value || null),
        host_member_id: isHm ? (document.getElementById('tourPartHmSelect').value || null) : null,
        payment_status: document.getElementById('tourPartPaymentSelect').value
      };
      if (!body.participant_id && !body.host_member_id) { toast('Choose a delegate or a host member'); return; }
      try {
        await jpost(`${API}/portal-modules/pretours/${currentTourId}/participants`, body);
        toast('Added to tour');
        await refreshPreTourCountsAndReopen();
      } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
    });
  }
  const tripForm = document.getElementById('tourTripForm');
  if (tripForm && !tripForm.dataset.wired) {
    tripForm.dataset.wired = '1';
    const partnerSelect = document.getElementById('tourTripPartnerSelect');
    if (partnerSelect) partnerSelect.addEventListener('change', applyTourTripPartnerFilter);
    tripForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentTourId) { toast('Click "Manage" on a tour first'); return; }
      const body = Object.fromEntries(new FormData(e.target).entries());
      if (!body.driver_id) delete body.driver_id;
      if (!body.partner_id) delete body.partner_id;
      try {
        await jpost(`${API}/portal-modules/pretours/${currentTourId}/trips`, body);
        e.target.reset();
        toast('Trip added');
        if (body.from_location) ensureTransportPoint(body.from_location);
        if (body.to_location) ensureTransportPoint(body.to_location);
        await refreshPreTourCountsAndReopen();
      } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
    });
  }
}

// --- Media (Video/Poster/Print materials): upload + hide/show from the ---
// --- host portal. Previously this section was entirely read-only — the ---
// --- table above (with its View link + Hide/Show button via extraRowAction) ---
// --- plus this upload form below is what makes it usable. Mirrors admin.js's ---
// --- refreshMediaAdmin()/mediaForm, but posts multipart form data directly ---
// --- (jpost only sends JSON) and re-renders via renderHostModuleSection ---
// --- afterward so the table picks up the new/changed row. ---
function mediaUploadCardHtml() {
  return `
    <div class="card" style="margin-top:14px;">
      <div class="section-title" style="margin-top:0">Upload video, poster, or print material</div>
      <form id="hostMediaUploadForm">
        <div class="form-grid cols-2">
          <div class="field"><label>Type</label>
            <select name="type" id="hostMediaTypeSelect">
              <option value="video">Video (loop reel)</option>
              <option value="poster">Poster / material</option>
              <option value="document">Print materials &amp; more (PDF)</option>
            </select>
          </div>
          <div class="field"><label>Title / caption</label><input name="title" /></div>
        </div>
        <div class="field"><label>File *</label><input name="file" id="hostMediaFileInput" type="file" accept="video/*,image/*" required /></div>
        <button class="btn gold small" type="submit">Upload</button>
      </form>
      <p class="hint">Uploads appear on the public dashboard loop automatically (up to 500MB). Use Hide/Show on a row above to include/exclude it without deleting.</p>
    </div>
  `;
}
window.toggleHostMedia = async (id, active) => {
  try {
    await jput(`${API}/portal-modules/media/${id}`, { active });
    toast(active ? 'Now visible' : 'Hidden');
    await renderHostModuleSection(MODULE_CONFIG.media, MODULE_CONFIG.media);
  } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
};
function wireMediaUploadForm() {
  const typeSel = document.getElementById('hostMediaTypeSelect');
  if (typeSel && !typeSel.dataset.wired) {
    typeSel.dataset.wired = '1';
    typeSel.addEventListener('change', (e) => {
      document.getElementById('hostMediaFileInput').setAttribute('accept', e.target.value === 'document' ? 'application/pdf' : 'video/*,image/*');
    });
  }
  const form = document.getElementById('hostMediaUploadForm');
  if (form && !form.dataset.wired) {
    form.dataset.wired = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      const fileInput = document.getElementById('hostMediaFileInput');
      if (!fileInput.files.length) { toast('Choose a file first'); return; }
      const originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Uploading… do not close this tab';
      toast(`Uploading ${fileInput.files[0].name} — this can take a while for large videos`, 6000);
      try {
        const r = await fetch(`${API}/portal-modules/media/upload`, { method: 'POST', headers: authHeaders(), body: new FormData(form) });
        if (r.status === 401) { handleUnauthorized(); throw new UnauthorizedError('Please log in again.'); }
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Upload failed (HTTP ${r.status})`);
        toast('Upload complete', 3000);
        await renderHostModuleSection(MODULE_CONFIG.media, MODULE_CONFIG.media);
      } catch (err) {
        if (!(err instanceof UnauthorizedError)) toast(err.message, 8000);
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });
  }
}

// --- Goodies & Inventory: per-item deliveries panel + Delivery Monitor ---
// Mirrors admin.js's openInventoryDistModal (recipient list, bulk-assign,
// individual add, per-recipient assigned/status) and its separate
// "Delivery monitor" dashboard (filterable by committee/status/recipient
// type). Recipient names (sponsors/speakers/guest visitors/delegates/host
// members) come from the *-lite lookups added to server/routes/inventory.js
// specifically for this — a committee only granted Goodies & Inventory has
// no other route that would give it those names. No bulk delivered-by
// override or delete here — the core ask is seeing + updating delivery
// status, not every admin power-tool; and deletes 403 for a non-super-admin
// token regardless, same reasoning as every other panel in this file.
const INV_RECIPIENT_TYPE_LABELS = { sponsor: 'Sponsor', speaker: 'Guest Speaker', guest_visitor: 'Guest Visitor', participant: 'Delegate', host_member: 'Host Member' };
const INV_RECIPIENT_LITE_PATH = { sponsor: 'inventory/sponsors-lite', speaker: 'inventory/speakers-lite', guest_visitor: 'inventory/guestvisitors-lite', participant: 'inventory/participants-lite', host_member: 'inventory/host-members-lite' };
let inventoryDistCtx = { itemId: null, itemName: '' };
function inventoryDistCardHtml() {
  return `
    <div class="card" id="inventoryDistCard" style="margin-top:14px; display:none;">
      <div class="section-title" style="margin-top:0">Deliveries — <span id="inventoryDistItemLabel"></span></div>
      <div id="inventoryDistRows"></div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line);">
        <strong>Assign to everyone in a category</strong>
        <form id="inventoryBulkAssignForm" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
          <select name="recipient_type" required>${Object.entries(INV_RECIPIENT_TYPE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <input name="quantity" type="number" min="1" value="1" style="max-width:80px;" title="Quantity each" />
          <select name="assigned_host_member_id" id="inventoryBulkAssignHmSelect" style="max-width:160px;"></select>
          <button class="btn gold small" type="submit">Assign to all</button>
        </form>
      </div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line);">
        <strong>Add one recipient</strong>
        <form id="inventoryAddRecipientForm" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:flex-start;">
          <select name="recipient_type" id="invAddRecipientType" required>${Object.entries(INV_RECIPIENT_TYPE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <select name="recipient_id" id="invAddRecipientId" required style="min-width:160px;"><option value="">-- select --</option></select>
          <input name="quantity" type="number" min="1" value="1" style="max-width:80px;" title="Quantity" />
          <select name="assigned_host_member_id" id="inventoryAddRecipientHmSelect" style="max-width:160px;"></select>
          <button class="btn small" type="submit">Add</button>
        </form>
      </div>
    </div>
  `;
}
window.openInventoryDist = async (itemId, itemName) => {
  inventoryDistCtx = { itemId, itemName };
  const card = document.getElementById('inventoryDistCard');
  if (!card) return;
  document.getElementById('inventoryDistItemLabel').textContent = itemName;
  card.style.display = '';
  await refreshInventoryDistHmOptions();
  await onInvAddRecipientTypeChange();
  await refreshInventoryDist();
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
async function refreshInventoryDistHmOptions() {
  let hostMembers = [];
  try { hostMembers = await jget(`${API}/portal-modules/inventory/host-members-lite`); } catch (e) { hostMembers = []; }
  const opts = '<option value="">-- unassigned --</option>' + hostMembers.map((h) => `<option value="${h.id}">${escapeHtml(h.name)}</option>`).join('');
  const a = document.getElementById('inventoryBulkAssignHmSelect');
  const b = document.getElementById('inventoryAddRecipientHmSelect');
  if (a) a.innerHTML = opts;
  if (b) b.innerHTML = opts;
}
window.onInvAddRecipientTypeChange = async () => {
  const sel = document.getElementById('invAddRecipientType');
  const idSel = document.getElementById('invAddRecipientId');
  if (!sel || !idSel) return;
  let rows = [];
  try { rows = await jget(`${API}/portal-modules/${INV_RECIPIENT_LITE_PATH[sel.value]}`); } catch (e) { rows = []; }
  idSel.innerHTML = '<option value="">-- select --</option>' + rows.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
};
async function refreshInventoryDist() {
  const { itemId } = inventoryDistCtx;
  if (!itemId) return;
  let rows = [];
  try { rows = await jget(`${API}/portal-modules/inventory/${itemId}/distributions`); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); return; }
  let hostMembers = [];
  try { hostMembers = await jget(`${API}/portal-modules/inventory/host-members-lite`); } catch (e) { hostMembers = []; }
  const hmOptionsFor = (selectedId) => '<option value="">-- unassigned --</option>' + hostMembers.map((h) =>
    `<option value="${h.id}" ${String(selectedId) === String(h.id) ? 'selected' : ''}>${escapeHtml(h.name)}</option>`).join('');
  document.getElementById('inventoryDistRows').innerHTML = rows.map((d) => `
    <div class="checklist-row status-${d.status}">
      <span class="checklist-label">
        <span class="pill single" style="margin-right:6px;">${INV_RECIPIENT_TYPE_LABELS[d.recipient_type] || d.recipient_type}</span>
        ${escapeHtml(d.recipient_name || 'Unknown')}${d.quantity > 1 ? ` ×${d.quantity}` : ''}
      </span>
      <select style="max-width:160px;" title="Assigned to" onchange="updateInventoryDistField(${d.id}, 'assigned_host_member_id', this.value || null)">
        ${hmOptionsFor(d.assigned_host_member_id)}
      </select>
      <select onchange="updateInventoryDistField(${d.id}, 'status', this.value)">
        <option value="pending" ${d.status === 'pending' ? 'selected' : ''}>Pending</option>
        <option value="delivered" ${d.status === 'delivered' ? 'selected' : ''}>Delivered</option>
        <option value="cancelled" ${d.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
      </select>
      ${d.status === 'delivered' && d.delivered_by_name ? `<span class="hint">✓ ${escapeHtml(d.delivered_by_name)}${d.delivered_at ? ' on ' + new Date(d.delivered_at).toLocaleDateString() : ''}</span>` : ''}
    </div>
  `).join('') || '<p class="empty">No recipients added yet.</p>';
}
window.updateInventoryDistField = async (distId, field, value) => {
  try {
    await jput(`${API}/portal-modules/inventory/distributions/${distId}`, { [field]: value });
    toast('Updated');
    await refreshInventoryDist();
    refreshInventoryMonitor();
    const cfg = MODULE_CONFIG.inventory;
    if (currentModuleKey === 'inventory') renderHostModuleSection(cfg, cfg).then(() => window.openInventoryDist(inventoryDistCtx.itemId, inventoryDistCtx.itemName));
  } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
};
function wireInventoryDistForms() {
  const bulkForm = document.getElementById('inventoryBulkAssignForm');
  if (bulkForm && !bulkForm.dataset.wired) {
    bulkForm.dataset.wired = '1';
    bulkForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { itemId } = inventoryDistCtx;
      if (!itemId) { toast('Click "Deliveries" on an item first'); return; }
      const body = Object.fromEntries(new FormData(e.target).entries());
      try {
        const r = await jpost(`${API}/portal-modules/inventory/${itemId}/distributions/bulk`, body);
        toast(`Assigned to ${r.created} recipient(s) (already-assigned recipients were skipped).`);
        e.target.reset();
        await refreshInventoryDist();
        refreshInventoryMonitor();
      } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
    });
  }
  const typeSel = document.getElementById('invAddRecipientType');
  if (typeSel && !typeSel.dataset.wired) {
    typeSel.dataset.wired = '1';
    typeSel.addEventListener('change', () => window.onInvAddRecipientTypeChange());
  }
  const addForm = document.getElementById('inventoryAddRecipientForm');
  if (addForm && !addForm.dataset.wired) {
    addForm.dataset.wired = '1';
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { itemId } = inventoryDistCtx;
      if (!itemId) { toast('Click "Deliveries" on an item first'); return; }
      const body = Object.fromEntries(new FormData(e.target).entries());
      if (!body.recipient_id) { toast('Choose a recipient'); return; }
      try {
        await jpost(`${API}/portal-modules/inventory/${itemId}/distributions`, body);
        toast('Recipient added');
        e.target.reset();
        await onInvAddRecipientTypeChange();
        await refreshInventoryDist();
        refreshInventoryMonitor();
      } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
    });
  }
}

// --- Delivery Monitor: cross-item, cross-committee view (mirrors admin.js's
// refreshInventoryMonitorSummary/refreshInventoryMonitorDetail). Read-only,
// same as admin's own detail table — status is updated from the per-item
// Deliveries panel above, not inline here. Always rendered below the
// inventory list (cfg.hasDeliveryMonitor), independent of any row selection.
function inventoryMonitorCardHtml() {
  return `
    <div class="card" style="margin-top:16px;">
      <div class="section-title" style="margin-top:0;font-size:14px;">Delivery monitor</div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Committee</th><th>Total</th><th>Delivered</th><th>Pending</th><th>%</th></tr></thead>
          <tbody id="inventoryMonitorSummaryBody"></tbody>
        </table>
      </div>
      <div class="form-grid cols-3" style="margin-top:10px;">
        <div class="field"><label>Committee</label>
          <select id="inventoryMonitorFilterCommittee"><option value="">All committees</option><option value="unassigned">Unassigned</option></select>
        </div>
        <div class="field"><label>Status</label>
          <select id="inventoryMonitorFilterStatus">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div class="field"><label>Recipient type</label>
          <select id="inventoryMonitorFilterRecipientType">
            <option value="">All types</option>
            ${Object.entries(INV_RECIPIENT_TYPE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="table-scroll" style="margin-top:8px;">
        <table>
          <thead><tr><th>Item</th><th>Recipient</th><th>Committee</th><th>Assigned to</th><th>Status</th><th>Delivered by</th></tr></thead>
          <tbody id="inventoryMonitorDetailBody"></tbody>
        </table>
      </div>
    </div>
  `;
}
async function refreshInventoryMonitorSummary() {
  let rows = [];
  try { rows = await jget(`${API}/portal-modules/inventory/monitor/summary`); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); return; }
  document.getElementById('inventoryMonitorSummaryBody').innerHTML = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.committee_name || 'Unassigned')}</td>
      <td>${r.total}</td>
      <td>${r.delivered}</td>
      <td>${r.pending}</td>
      <td>${r.completion_pct !== null ? r.completion_pct + '%' : '-'}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">No deliveries assigned yet.</td></tr>';

  let committees = [];
  try { committees = await jget(`${API}/portal-modules/inventory/committees-lite`); } catch (e) { committees = []; }
  const filterSel = document.getElementById('inventoryMonitorFilterCommittee');
  if (filterSel) {
    const cur = filterSel.value;
    filterSel.innerHTML = `<option value="">All committees</option><option value="unassigned">Unassigned</option>${committees.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}`;
    filterSel.value = cur;
  }
}
async function refreshInventoryMonitorDetail() {
  const committee = document.getElementById('inventoryMonitorFilterCommittee')?.value || '';
  const status = document.getElementById('inventoryMonitorFilterStatus')?.value || '';
  const recipientType = document.getElementById('inventoryMonitorFilterRecipientType')?.value || '';
  const params = new URLSearchParams();
  if (committee) params.set('committee_id', committee);
  if (status) params.set('status', status);
  if (recipientType) params.set('recipient_type', recipientType);
  let rows = [];
  try { rows = await jget(`${API}/portal-modules/inventory/monitor?${params.toString()}`); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); return; }
  document.getElementById('inventoryMonitorDetailBody').innerHTML = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.item_name)}${r.quantity > 1 ? ` ×${r.quantity}` : ''}<br><span class="hint">${escapeHtml(r.item_category || '-')}</span></td>
      <td>${escapeHtml(r.recipient_name || '-')} <span class="hint">(${INV_RECIPIENT_TYPE_LABELS[r.recipient_type] || r.recipient_type})</span></td>
      <td>${escapeHtml(r.committee_name || 'Unassigned')}</td>
      <td>${escapeHtml(r.assigned_host_member_name || '-')}</td>
      <td><span class="pill ${r.status === 'delivered' ? 'done' : r.status === 'cancelled' ? 'refunded' : 'in_progress'}">${r.status}</span></td>
      <td>${r.delivered_by_name ? escapeHtml(r.delivered_by_name) + (r.delivered_at ? ' on ' + new Date(r.delivered_at).toLocaleDateString() : '') : '-'}</td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty">No deliveries match this filter.</td></tr>';
}
async function refreshInventoryMonitor() {
  if (currentModuleKey !== 'inventory') return;
  await refreshInventoryMonitorSummary();
  await refreshInventoryMonitorDetail();
}
function wireInventoryMonitorFilters() {
  ['inventoryMonitorFilterCommittee', 'inventoryMonitorFilterStatus', 'inventoryMonitorFilterRecipientType'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.dataset.wired) { el.dataset.wired = '1'; el.addEventListener('change', refreshInventoryMonitorDetail); }
  });
}

// --- Agenda Builder (per-Itinerary-Slot event flow) ---
// Mirrors admin.js's manageAgenda/refreshAgenda: one Itinerary Slot (e.g.
// "Inaugural Ceremony") contains an ordered flow of individual events
// (Prayer Song, National Anthem, dance performances...), each with a
// description, who organised it (committee + free-text detail), and who's
// performing (a Performer/Vendor Group + free-text detail). Organizing
// committee names come from agenda.js's committees-lite lookup (added
// specifically for this — the Itinerary module doesn't otherwise grant
// access to the internal Committees admin data); performer group options
// come straight from this same module's own "Performer / Vendor Groups"
// section. No Update/Delete on agenda events here — same minimal scope as
// the Trip Passengers manifest and Pre Tour sub-panels above.
function itinerarySlotLabelHost(it) {
  return [it.day_label, it.time_label, it.title].filter(Boolean).join(' · ');
}
let currentAgendaSlotId = null;
let currentAgendaSlotLabel = '';
function agendaCardHtml() {
  return `
    <div class="card" id="agendaCard" style="margin-top:14px; display:none;">
      <div class="section-title" style="margin-top:0">Agenda — <span id="agendaSlotLabel"></span></div>
      <form id="agendaForm">
        <div class="form-grid cols-3">
          <div class="field"><label>Time</label><input name="time_label" placeholder="9:15 AM" /></div>
          <div class="field"><label>Duration (min)</label><input name="duration_minutes" type="number" min="0" /></div>
          <div class="field"><label>Sort order</label><input name="sort_order" type="number" value="0" /></div>
        </div>
        <div class="field"><label>Title *</label><input name="title" required /></div>
        <div class="field"><label>Description</label><textarea name="description"></textarea></div>
        <div class="form-grid cols-2">
          <div class="field"><label>Organizing committee</label><select name="organizing_committee_id" id="agendaCommitteeSelect"></select></div>
          <div class="field"><label>Organized by (detail)</label><input name="organized_by" placeholder="e.g. Cultural Committee volunteers" /></div>
        </div>
        <div class="form-grid cols-2">
          <div class="field"><label>Performing group</label><select name="performer_group_id" id="agendaPerformerSelect"></select></div>
          <div class="field"><label>Performed by (detail)</label><input name="performed_by" placeholder="e.g. lead vocalist name" /></div>
        </div>
        <div class="field"><label>Notes</label><textarea name="notes"></textarea></div>
        <button class="btn gold small" type="submit">Add agenda event</button>
      </form>
      <div class="table-scroll" style="margin-top:12px;">
        <table>
          <thead><tr><th>Time</th><th>Title</th><th>Description</th><th>Organizing</th><th>Performing</th></tr></thead>
          <tbody id="agendaTableBody"></tbody>
        </table>
      </div>
    </div>
  `;
}
window.openAgenda = async (itineraryItemId, label) => {
  currentAgendaSlotId = itineraryItemId;
  currentAgendaSlotLabel = label;
  const card = document.getElementById('agendaCard');
  if (!card) return;
  document.getElementById('agendaSlotLabel').textContent = label;
  card.style.display = '';
  await refreshAgendaOptions();
  await refreshAgenda();
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
async function refreshAgendaOptions() {
  try {
    const [committees, performerGroups] = await Promise.all([
      jget(`${API}/portal-modules/agenda/committees-lite`),
      jget(`${API}/portal-modules/performer-groups`),
    ]);
    const cSelect = document.getElementById('agendaCommitteeSelect');
    const pSelect = document.getElementById('agendaPerformerSelect');
    if (cSelect) cSelect.innerHTML = '<option value="">Unassigned</option>' + committees.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    if (pSelect) pSelect.innerHTML = '<option value="">-- none --</option>' + performerGroups.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
}
async function refreshAgenda() {
  if (!currentAgendaSlotId) return;
  let rows = [];
  try { rows = await jget(`${API}/portal-modules/agenda?itinerary_item_id=${currentAgendaSlotId}`); }
  catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); return; }
  document.getElementById('agendaTableBody').innerHTML = rows.map((a) => `
    <tr>
      <td>${escapeHtml(a.time_label || '-')}</td>
      <td><strong>${escapeHtml(a.title)}</strong>${a.duration_minutes ? ' <span class="hint">(' + a.duration_minutes + ' min)</span>' : ''}</td>
      <td style="white-space:normal;max-width:220px;">${escapeHtml(a.description || '-')}</td>
      <td>${escapeHtml([a.organizing_committee_name, a.organized_by].filter(Boolean).join(' · ') || '-')}</td>
      <td>${escapeHtml([a.performer_group_name, a.performed_by].filter(Boolean).join(' · ') || '-')}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">No agenda events yet for this slot</td></tr>';
}
function wireAgendaForm() {
  const form = document.getElementById('agendaForm');
  if (form && !form.dataset.wired) {
    form.dataset.wired = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentAgendaSlotId) { toast('Click "Agenda" on an itinerary slot first'); return; }
      const body = Object.fromEntries(new FormData(e.target).entries());
      body.itinerary_item_id = currentAgendaSlotId;
      try {
        await jpost(`${API}/portal-modules/agenda`, body);
        e.target.reset();
        toast('Agenda event added');
        await refreshAgenda();
      } catch (err) { if (!(err instanceof UnauthorizedError)) toast(err.message); }
    });
  }
}

// --- Arrivals & Departures to Plan (Transport Planning module only) ---
// Delegates who gave flight/train details, auto-grouped by matching travel
// number + date/time, so the transport committee assigns one vehicle to the
// whole cluster instead of planning each delegate one at a time. Mirrors the
// admin panel's version of this panel (admin.js's transportQueueGroupCard),
// hitting the same /transport/arrivals-queue, /departures-queue, and
// /group-trip endpoints via the committee's portal-modules mount instead of
// the admin-only one.
function transportQueueGroupCardHost(direction, g, vehicleOpts, driverOpts) {
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
          <div class="field"><label>Vehicle *</label><select name="vehicle_id" class="queue-vehicle-select" required>${vehicleOpts || '<option value="">-- select vehicle --</option>'}</select></div>
          <div class="field"><label>Driver</label><select name="driver_id" class="queue-driver-select" onchange="onQueueDriverChangeHost(this)">${driverOpts || '<option value="">-- none --</option>'}</select></div>
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
// Picking a driver auto-fills their usually-assigned vehicle (drivers carry a
// vehicle_id in the Vehicles master) so the committee member doesn't have to
// separately look up and re-select the matching vehicle. Still overridable.
window.onQueueDriverChangeHost = (selectEl) => {
  const driverId = selectEl.value;
  const vehicleId = driverId && window.hostDriverVehicleMap ? window.hostDriverVehicleMap[driverId] : null;
  if (!vehicleId) return;
  const vehicleSelect = selectEl.closest('.queue-group')?.querySelector('.queue-vehicle-select');
  if (vehicleSelect && vehicleSelect.querySelector(`option[value="${vehicleId}"]`)) vehicleSelect.value = String(vehicleId);
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
    const [arrivals, departures, vehicles, drivers] = await Promise.all([
      jget(`${API}/portal-modules/transport/arrivals-queue`),
      jget(`${API}/portal-modules/transport/departures-queue`),
      jget(`${API}/portal-modules/transport/vehicles-lite`).catch(() => []),
      jget(`${API}/portal-modules/transport/drivers-lite`).catch(() => []),
    ]);
    const vehicleOpts = '<option value="">-- select vehicle --</option>' + vehicles.map((v) => `<option value="${v.id}">${v.vehicle_code} · ${v.vehicle_type} (${v.seating_capacity} seats)${v.model ? ' — ' + v.model : ''}</option>`).join('');
    const driverOpts = '<option value="">-- none --</option>' + drivers.map((d) => `<option value="${d.id}">${d.name}${d.vehicle_code ? ' — ' + d.vehicle_code : ''}</option>`).join('');
    window.hostDriverVehicleMap = Object.fromEntries(drivers.filter((d) => d.vehicle_id).map((d) => [String(d.id), d.vehicle_id]));
    el.innerHTML = `
      <div class="section-title" style="font-size:14px;">Arrivals to plan (${arrivals.length})</div>
      ${arrivals.map((g) => transportQueueGroupCardHost('arrival', g, vehicleOpts, driverOpts)).join('') || '<p class="hint">No unplanned arrivals right now.</p>'}
      <div class="section-title" style="font-size:14px;">Departures to plan (${departures.length})</div>
      ${departures.map((g) => transportQueueGroupCardHost('departure', g, vehicleOpts, driverOpts)).join('') || '<p class="hint">No unplanned departures right now.</p>'}
    `;
    wireLocationDropdowns(el);
  } catch (err) {
    if (err instanceof UnauthorizedError) return;
    el.innerHTML = `<p class="hint" style="color:var(--red);">${err.message}</p>`;
  }
}
window.submitHostModuleForm = async (e) => {
  e.preventDefault();
  const form = e.target;
  const cfg = MODULE_CONFIG[currentModuleKey];
  const section = cfg.sections ? cfg.sections.find((s) => s.path === currentModuleSectionPath) : cfg;
  const body = Object.fromEntries(new FormData(form).entries());
  Object.keys(body).forEach((k) => { if (body[k] === '') delete body[k]; });

  // Occupant-type toggle (Accommodation & Rooms): only the visible one of
  // participant_id/host_member_id should ever be sent — the backend rejects
  // a row that's both or neither.
  (section.fields || []).forEach((f) => {
    if (f.type !== 'occupant_toggle') return;
    const toggle = form.querySelector(`[data-occupant-type-select="${f.name}"]`);
    if (!toggle) return;
    if (toggle.value === 'participant') delete body[f.hostMemberField];
    else delete body[f.participantField];
  });

  // spoc_host_member_id isn't a participants column — it's saved separately
  // as a delegate_assignments row (role='SPOC') via
  // PUT /portal-modules/participants/:id/spoc, same split admin.js's
  // savePartForm does against /api/assignments/spoc/:id.
  const hasSpocField = (section.fields || []).some((f) => f.name === 'spoc_host_member_id');
  let spocHostMemberId;
  if (hasSpocField) {
    spocHostMemberId = body.spoc_host_member_id || '';
    delete body.spoc_host_member_id;
  }

  const editId = form.dataset.editId;
  try {
    let rowId = editId;
    if (editId) {
      await jput(`${API}/portal-modules/${section.path}/${editId}`, body);
      toast('Updated');
    } else {
      const res = await jpost(`${API}/portal-modules/${section.path}`, body);
      rowId = res && res.id;
      toast('Saved');
    }
    if (hasSpocField && rowId) {
      try { await jput(`${API}/portal-modules/participants/${rowId}/spoc`, { host_member_id: spocHostMemberId || null }); }
      catch (spocErr) { toast('Saved, but SPOC link failed: ' + spocErr.message); }
    }
    LOCATION_SUGGEST_FIELDS.forEach((k) => { if (body[k]) ensureTransportPoint(body[k]); });
    if (editId) window.cancelEditHostModuleForm();
    else form.reset();
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

// ================= IN-PAGE CAMERA QR SCANNER =================
// Lets any scan-duty login (scanner/stall_owner, or host_member/volunteer/
// driver/transporter deputised for a scan_point, or admin/super_admin) scan
// a badge's QR code with the device camera right here in the portal —
// no more handing off to the phone's own camera app to open badge.html.
// Decodes the QR (or a manually pasted link/token), looks the person up via
// the same GET /badge/staff/:token badge.html uses, and renders the same
// cap-gated action buttons (Mark Attendance, Hotel Check-in/out, Transport
// Scan, Food Counter Scan, Stall Visit, Goodies Delivery) inline — nothing
// here duplicates server logic, it's just badgeclient.js's rendering ported
// into one panel of this portal. Uses the html5-qrcode library (loaded via
// CDN in login.html) for the actual camera decode.
let qrScannerInstance = null;
let qrScannerRunning = false;

function extractBadgeToken(raw) {
  const text = (raw || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    const t = url.searchParams.get('token');
    if (t) return t;
  } catch (e) { /* not a full URL — fall through to the patterns below */ }
  const m = text.match(/token=([a-zA-Z0-9]+)/);
  if (m) return m[1];
  // Looks like a bare token (no spaces, a reasonably long alphanumeric string)
  if (/^[a-zA-Z0-9]{8,}$/.test(text)) return text;
  return '';
}

async function stopQrScanner() {
  if (qrScannerInstance && qrScannerRunning) {
    try { await qrScannerInstance.stop(); } catch (e) { /* already stopped/torn down */ }
    qrScannerRunning = false;
  }
  const startBtn = document.getElementById('startScanBtn');
  const stopBtn = document.getElementById('stopScanBtn');
  if (startBtn) startBtn.style.display = '';
  if (stopBtn) stopBtn.style.display = 'none';
}

async function startQrScanner() {
  const errEl = document.getElementById('qrCameraError');
  if (errEl) errEl.style.display = 'none';
  if (typeof Html5Qrcode === 'undefined') {
    if (errEl) { errEl.textContent = 'Camera scanner failed to load — use the paste-a-link box below instead.'; errEl.style.display = 'block'; }
    return;
  }
  try {
    if (!qrScannerInstance) qrScannerInstance = new Html5Qrcode('qrReader');
    await qrScannerInstance.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 250 },
      async (decodedText) => {
        const token = extractBadgeToken(decodedText);
        if (!token) return; // not a badge QR — keep scanning
        await stopQrScanner();
        loadScanResult(token);
      },
      () => { /* per-frame "no QR found yet" noise — ignore */ }
    );
    qrScannerRunning = true;
    document.getElementById('startScanBtn').style.display = 'none';
    document.getElementById('stopScanBtn').style.display = '';
  } catch (err) {
    if (errEl) { errEl.textContent = 'Could not access the camera (' + (err.message || err) + '). Use the paste-a-link box below instead.'; errEl.style.display = 'block'; }
  }
}

document.getElementById('startScanBtn')?.addEventListener('click', startQrScanner);
document.getElementById('stopScanBtn')?.addEventListener('click', stopQrScanner);

document.getElementById('manualTokenForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('manualTokenInput');
  const token = extractBadgeToken(input.value);
  if (!token) { toast('Could not find a badge token in that text.'); return; }
  loadScanResult(token);
});

async function loadScanResult(token) {
  const resultCard = document.getElementById('scanResultCard');
  const body = document.getElementById('scanResultBody');
  if (!resultCard || !body) return;
  body.innerHTML = '<p class="hint">Looking up badge…</p>';
  resultCard.style.display = 'block';
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  let d;
  try {
    d = await jget(`${API}/badge/staff/${encodeURIComponent(token)}`);
  } catch (e) {
    if (e instanceof UnauthorizedError) return;
    body.innerHTML = `<p class="hint" style="color:var(--red);">${e.message}</p>`;
    return;
  }
  renderScanResult(d, token);
}

function renderScanResult(d, token) {
  const body = document.getElementById('scanResultBody');
  const caps = d.caps || {};
  const initial = (d.name || '?').trim().charAt(0).toUpperCase();
  let html = `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:10px;">
      ${d.photo_url
        ? `<img src="${mediaUrl(d.photo_url)}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;" />`
        : `<div style="width:56px;height:56px;border-radius:50%;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:600;">${initial}</div>`}
      <div>
        <strong style="font-size:16px;">${d.name || 'Unknown'}</strong>
        <div class="hint" style="margin:0;">${d.role_label || ''}${d.org ? ' · ' + d.org : ''}</div>
      </div>
    </div>
  `;
  if (d.registration) {
    const r = d.registration;
    const bits = [r.reg_number, r.reg_type, r.payment_status ? `Payment: ${String(r.payment_status).toUpperCase()}` : (r.payment_amount ? `₹${r.payment_amount}` : null)].filter(Boolean);
    if (bits.length) html += `<p class="hint">${bits.join(' · ')}</p>`;
  }
  if (d.room) {
    html += `<p class="hint">${d.room.hotel_name} · Room ${d.room.room_number}${d.room.room_type ? ' (' + d.room.room_type + ')' : ''}</p>`;
  }
  if (d.last_checked_in_at) {
    html += `<p class="hint">Last checked in: ${new Date(d.last_checked_in_at).toLocaleString('en-IN')}</p>`;
  }
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;" id="scanActionButtons"></div>';
  html += '<div id="scanActionResult" class="hint" style="margin-top:8px;display:none;"></div>';
  html += '<div id="scanGoodiesList"></div>';
  html += '<button class="btn secondary small" id="scanAnotherBtn" type="button" style="margin-top:12px;">Scan another</button>';
  body.innerHTML = html;

  const actionsEl = document.getElementById('scanActionButtons');
  const resultEl = document.getElementById('scanActionResult');

  function addButton(label, onClick) {
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    actionsEl.appendChild(btn);
    return btn;
  }
  function showResult(text, isError) {
    resultEl.textContent = text;
    resultEl.style.color = isError ? 'var(--red)' : 'var(--navy)';
    resultEl.style.display = 'block';
  }
  async function postAction(path, body2) {
    return jpost(`${API}/badge/staff/${encodeURIComponent(token)}${path}`, body2 || {});
  }

  if (Object.values(caps).some(Boolean)) {
    addButton('Mark Attendance', async (e) => {
      e.target.disabled = true;
      try {
        const r = await postAction('/checkin');
        showResult(`Checked in: ${new Date(r.checked_in_at).toLocaleString('en-IN')}`);
      } catch (err) { if (!(err instanceof UnauthorizedError)) showResult(err.message, true); }
      finally { e.target.disabled = false; }
    });
  }
  if (caps.hotel_desk) {
    addButton('Hotel Check-in', async (e) => {
      e.target.disabled = true;
      try { const r = await postAction('/hotel-checkin'); showResult(`Checked in: ${new Date(r.checked_in_at).toLocaleString('en-IN')}`); }
      catch (err) { if (!(err instanceof UnauthorizedError)) showResult(err.message, true); }
      finally { e.target.disabled = false; }
    });
    addButton('Hotel Check-out', async (e) => {
      e.target.disabled = true;
      try { const r = await postAction('/hotel-checkout'); showResult(`Checked out: ${new Date(r.checked_in_at).toLocaleString('en-IN')}`); }
      catch (err) { if (!(err instanceof UnauthorizedError)) showResult(err.message, true); }
      finally { e.target.disabled = false; }
    });
  }
  if (caps.transport) {
    addButton('Transport Scan', async (e) => {
      e.target.disabled = true;
      try {
        const r = await postAction('/transport-scan');
        if (r.match) showResult(`✅ Correct vehicle. ${r.trip.from_location} → ${r.trip.to_location}${r.trip.depart_time ? ' · ' + r.trip.depart_time : ''}`);
        else if (r.assigned === false) showResult(r.message || 'No transport assignment found for this person today.', true);
        else {
          const t = r.correctTrip;
          showResult(`⚠️ Wrong vehicle. Should board ${t.vehicle_code || '?'}${t.driver_name ? ' (driver: ' + t.driver_name + ')' : ''} — ${t.from_location} → ${t.to_location}`, true);
        }
      } catch (err) { if (!(err instanceof UnauthorizedError)) showResult(err.message, true); }
      finally { e.target.disabled = false; }
    });
  }
  if (caps.food_counter) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:6px;align-items:center;';
    wrap.innerHTML = `<select id="scanFoodMealSelect" style="max-width:160px;">
      <option value="breakfast">Breakfast</option><option value="lunch">Lunch</option>
      <option value="hi-tea">Hi-Tea</option><option value="dinner">Dinner</option><option value="snacks">Snacks</option>
    </select>`;
    const btn = document.createElement('button');
    btn.className = 'btn small'; btn.type = 'button'; btn.textContent = 'Food Counter Scan';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const mealSlot = document.getElementById('scanFoodMealSelect').value;
        const r = await postAction('/food-scan', { meal_slot: mealSlot });
        showResult(r.already ? `Already counted for ${mealSlot} today.` : `Counted for ${mealSlot} — ${r.todayCount} people so far today.`);
      } catch (err) { if (!(err instanceof UnauthorizedError)) showResult(err.message, true); }
      finally { btn.disabled = false; }
    });
    wrap.appendChild(btn);
    actionsEl.appendChild(wrap);
  }
  if (caps.stall_owner) {
    addButton('Log Stall Visit', async (e) => {
      e.target.disabled = true;
      try { await postAction('/stall-visit'); showResult("✅ Visit logged — this contact is now in your stall's visitor list."); }
      catch (err) { if (!(err instanceof UnauthorizedError)) showResult(err.message, true); }
      finally { e.target.disabled = false; }
    });
  }
  if (caps.inventory && d.pending_goodies && d.pending_goodies.length) {
    const list = document.getElementById('scanGoodiesList');
    list.style.marginTop = '10px';
    list.innerHTML = d.pending_goodies.map((g) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line);">
        <span>${g.name}${g.quantity > 1 ? ' × ' + g.quantity : ''}</span>
        <button class="btn small" data-dist-id="${g.distribution_id}" type="button">Mark Delivered</button>
      </div>
    `).join('');
    list.querySelectorAll('button[data-dist-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await jpost(`${API}/badge/staff/${encodeURIComponent(token)}/goodies/${btn.dataset.distId}/deliver`, {});
          btn.closest('div').remove();
        } catch (err) { if (!(err instanceof UnauthorizedError)) { toast(err.message); btn.disabled = false; } }
      });
    });
  }

  document.getElementById('scanAnotherBtn').addEventListener('click', () => {
    document.getElementById('scanResultCard').style.display = 'none';
    refreshMyScans();
  });
}

// ================= BADGE SCANNING: "My Scans" / "My Visitors" =================
// Any login can be handed a scan_point duty (hotel_desk/transport/food_counter/
// inventory) independent of its base role, and stall_owner is a role whose
// entire portal is this one panel. This reads server/routes/badge.js's
// GET /my-scans — self-scoped to this login's own checked_in_by_user_id, so
// one scanner never sees another's activity. The actual scanning itself
// happens on the badge page (open a delegate/host member's badge_token URL,
// e.g. by scanning their printed/QR badge) — this panel is just the history
// of who's already been scanned.
const SCAN_POINT_LABEL_SELF = {
  gate: 'Gate', hotel_checkin: 'Hotel Check-in', hotel_checkout: 'Hotel Check-out',
  transport: 'Transport', food_counter: 'Food Counter', stall: 'Stall Visit', goodies: 'Goodies Delivery'
};
async function refreshMyScans() {
  const body = document.getElementById('myScansBody');
  if (!body) return;
  const params = new URLSearchParams();
  const filterSel = document.getElementById('myScansFilter');
  if (filterSel && filterSel.value) params.set('scan_point', filterSel.value);
  let rows;
  try {
    rows = await jget(`${API}/badge/my-scans?${params.toString()}`);
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) body.innerHTML = `<p class="hint">${e.message}</p>`;
    return;
  }
  body.innerHTML = rows.map((r) => `
    <div class="card" style="margin-bottom:8px;padding:10px 14px;">
      <strong>${r.entity_name || 'Unknown'}</strong>
      <span class="pill">${SCAN_POINT_LABEL_SELF[r.scan_point] || r.scan_point}</span>
      <div class="hint" style="margin-top:2px;">
        ${new Date(r.checked_in_at).toLocaleString()}
        ${r.entity_phone ? ' · ' + r.entity_phone : ''}
        ${r.entity_email ? ' · ' + r.entity_email : ''}
      </div>
    </div>
  `).join('') || '<p class="hint">No one scanned yet.</p>';
}
document.getElementById('myScansFilter')?.addEventListener('change', refreshMyScans);

// ================= BOOT =================
tryResumeSession();