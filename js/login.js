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

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
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
  transporter: ['transporter-profile', 'transporter-drivers', 'transporter-trips']
};
const ROLE_DEFAULT_TAB = { host_member: 'host-profile', media: 'media-upload', driver: 'driver-profile', transporter: 'transporter-profile' };
const ROLE_TITLE = {
  host_member: ['Host Portal', "Your committees, delegates & checklist"],
  media: ['Media Portal', 'Upload the event video reel & posters'],
  driver: ['Driver Portal', 'Your assigned trips'],
  transporter: ['Transporter Portal', "Your fleet's trip requirements"]
};
const ALLOWED_ROLES = ['host_member', 'media', 'transporter', 'driver'];

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
  document.getElementById('portalSubtitle').textContent = 'Host member, media, transporter & driver logins';
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
  transport_planning: { label: 'Transport Planning', path: 'transport',
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
              ${f.type === 'textarea' ? `<textarea name="${f.name}"${f.required ? ' required' : ''}></textarea>` : `<input name="${f.name}" type="${f.type || 'text'}"${f.required ? ' required' : ''} />`}
            </div>
          `).join('')}
        </div>
        <button class="btn gold small" type="submit">Add</button>
      </form>
    ` : (cfg.readOnly ? '<p class="hint">This module is view-only from the host portal.</p>' : '')}
  `;
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

// ================= BOOT =================
tryResumeSession();
