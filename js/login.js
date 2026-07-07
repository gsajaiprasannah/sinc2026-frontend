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
const STATUS_PILL = { planned: 'not_started', in_progress: 'in_progress', completed: 'completed', cancelled: 'pending' };
const STATUS_LABEL = { planned: 'Planned', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };

// --- Which section + header copy each role gets after logging in ---
const ROLE_SECTION = { host_member: 'hostSection', media: 'mediaSection', driver: 'driverSection', transporter: 'transporterSection' };
const ROLE_TITLE = {
  host_member: ['Host Portal', "Your committees, delegates & checklist"],
  media: ['Media Portal', 'Upload the event video reel & posters'],
  driver: ['Driver Portal', 'Your assigned trips'],
  transporter: ['Transporter Portal', "Your fleet's trip requirements"]
};
const ALLOWED_ROLES = ['host_member', 'media', 'transporter', 'driver'];

// ================= AUTH GATE =================
function showAuthGate() {
  document.getElementById('authGate').style.display = 'block';
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('logoutLink').style.display = 'none';
  document.getElementById('whoami').textContent = '';
  document.getElementById('portalTitle').textContent = 'Login';
  document.getElementById('portalSubtitle').textContent = 'Host member, media, transporter & driver logins';
}

function showApp() {
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  document.getElementById('logoutLink').style.display = '';
  document.getElementById('whoami').textContent = CURRENT_USER ? CURRENT_USER.username : '';

  const role = CURRENT_USER ? CURRENT_USER.role : null;
  Object.values(ROLE_SECTION).forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const sectionId = ROLE_SECTION[role];
  if (sectionId) {
    const el = document.getElementById(sectionId);
    if (el) el.style.display = '';
  }
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

const pushToggleBtn = document.getElementById('pushToggleBtn');
if (pushToggleBtn) {
  pushToggleBtn.addEventListener('click', async () => {
    pushToggleBtn.disabled = true;
    try {
      const subscribed = await window.SincPush.isSubscribed();
      if (subscribed) {
        await window.SincPush.disable();
        toast('Notifications turned off');
      } else {
        await window.SincPush.enable();
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
  renderHostCommitteeChecklists(data.committeeChecklists);
  renderHostCommitteeDeliveries(data.committeeDeliveries);
  renderHostAssignments(data.assignments);
  renderHostTasks(data.tasks);
  renderHostGuestRelations(data.guestRelations);
  renderHostGoodiesChecklist(data.goodiesChecklist);
}

function renderHostProfile(p) {
  document.getElementById('hostProfileBody').innerHTML = `
    <p><strong>${p.name}</strong>${p.designation ? ' — ' + p.designation : ''}</p>
    <p class="hint">${[p.company, p.category].filter(Boolean).join(' · ') || '-'}</p>
    <p class="hint">${[p.phone, p.email].filter(Boolean).join(' · ') || '-'}</p>
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
      <p style="margin:0 0 4px;"><strong>${c.name}</strong></p>
      ${c.description ? `<p class="hint" style="margin:0 0 8px;white-space:pre-wrap;">${c.description}</p>` : ''}
      ${(c.tasks && c.tasks.length) ? c.tasks.map((t) => `
        <div class="checklist-row status-${t.my_status || 'pending'}">
          <select onchange="updateMyCommitteeTaskStatus(${t.completion_id}, this.value)">
            <option value="pending" ${t.my_status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="done" ${t.my_status === 'done' ? 'selected' : ''}>Done</option>
          </select>
          <span class="checklist-label">
            ${Number(t.is_milestone) ? '<span class="pill double" style="margin-right:4px;">Milestone</span>' : ''}${t.title}${t.due_date ? ' <span class="hint">(due ' + t.due_date + ')</span>' : ''}
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
  if (!relations || !relations.length) { card.style.display = 'none'; return; }
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
  try { await jput(`${API}/host/checklist/${id}`, { status }); toast('Status updated'); }
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
  if (!p) { el.innerHTML = '<div class="empty">Company profile not found.</div>'; return; }
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
