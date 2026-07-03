const API = ((window.SINC_CONFIG && window.SINC_CONFIG.API_BASE_URL) || '/api').replace(/\/$/, '');
const MEDIA_ORIGIN = API.replace(/\/api\/?$/, ''); // '' when API is relative, backend origin when API is absolute

const TOKEN_KEY = 'sinc_admin_token';
let CURRENT_USER = null;

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

// Only a super admin can delete records — everyone else can still create and
// edit, just not permanently remove anything. The backend enforces this too
// (a regular admin's DELETE request gets a 403 either way); this just keeps
// the button from being shown in the first place.
function canDelete() {
  return !!(CURRENT_USER && CURRENT_USER.role === 'super_admin');
}

let toastTimer = null;
function toast(msg, durationMs) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), durationMs || 2200);
}

// Thrown by jget/jpost/etc when the server says the session is no longer valid.
function handleUnauthorized() {
  setToken('');
  CURRENT_USER = null;
  showAuthGate();
}

async function jget(url) {
  const r = await fetch(url, { headers: authHeaders() });
  if (r.status === 401) { handleUnauthorized(); throw new Error('Please log in again.'); }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function jpost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  if (r.status === 401) { handleUnauthorized(); throw new Error('Please log in again.'); }
  const data = await r.json();
  if (!r.ok) { const err = new Error(data.error || 'Request failed'); err.data = data; err.status = r.status; throw err; }
  return data;
}
async function jput(url, body) {
  const r = await fetch(url, { method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  if (r.status === 401) { handleUnauthorized(); throw new Error('Please log in again.'); }
  const data = await r.json();
  if (!r.ok) { const err = new Error(data.error || 'Request failed'); err.data = data; err.status = r.status; throw err; }
  return data;
}
async function jdel(url) {
  const r = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  if (r.status === 401) { handleUnauthorized(); throw new Error('Please log in again.'); }
  return r.json();
}
async function uploadFile(url, formEl) {
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: authHeaders(), body: new FormData(formEl) });
  } catch (networkErr) {
    // fetch() itself rejects on a dropped connection (not just a non-2xx
    // response) — surface that clearly instead of a generic "Upload failed".
    throw new Error('Upload failed — the connection was interrupted. Check your internet connection and try again.');
  }
  if (r.status === 401) { handleUnauthorized(); throw new Error('Please log in again.'); }
  let data;
  try {
    data = await r.json();
  } catch (parseErr) {
    throw new Error(`Server returned an unexpected response (status ${r.status}). Please try again.`);
  }
  if (!r.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

// --- Auth: login / signup / logout ---
function showAuthGate() {
  document.getElementById('authGate').style.display = 'block';
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('logoutLink').style.display = 'none';
  document.getElementById('whoami').textContent = '';
}

function showApp() {
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  document.getElementById('logoutLink').style.display = '';
  document.getElementById('whoami').textContent = CURRENT_USER ? `${CURRENT_USER.username} (${CURRENT_USER.role === 'super_admin' ? 'Super Admin' : 'Admin'})` : '';
  document.getElementById('settingsTabBtn').style.display = (CURRENT_USER && CURRENT_USER.role === 'super_admin') ? '' : 'none';
  loadAllData();
}

document.getElementById('showSignup').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('loginCard').style.display = 'none';
  document.getElementById('signupCard').style.display = 'block';
});
document.getElementById('showLogin').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('signupCard').style.display = 'none';
  document.getElementById('loginCard').style.display = 'block';
});

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
    setToken(data.token);
    CURRENT_USER = data.user;
    e.target.reset();
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
});

document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('signupError');
  const okEl = document.getElementById('signupSuccess');
  errEl.style.display = 'none';
  okEl.style.display = 'none';
  const fd = new FormData(e.target);
  try {
    const r = await fetch(`${API}/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(fd.entries()))
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Signup failed');
    okEl.textContent = data.message || 'Request submitted — wait for admin approval.';
    okEl.style.display = 'block';
    e.target.reset();
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
    CURRENT_USER = user;
    showApp();
  } catch (e) {
    showAuthGate();
  }
}

// --- Tabs ---
document.getElementById('tabNav').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  document.querySelectorAll('.admin-nav button').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  if (btn.dataset.tab === 'settings') refreshUsersAdmin();
});

// --- Clubs ---
async function refreshClubs() {
  const clubs = await jget(`${API}/clubs`);
  document.getElementById('clubsTableBody').innerHTML = clubs.map((c) => `
    <tr>
      <td>${c.name}</td><td>${c.city || ''}</td><td>${c.state || ''}</td><td>${c.zone || ''}</td><td>${c.members_count}</td>
      <td>${canDelete() ? `<button class="btn danger small" onclick="deleteClub(${c.id})">Delete</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty">No clubs yet</td></tr>';

  const opts = clubs.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  document.getElementById('regClubSelect').innerHTML = '<option value="">-- none --</option>' + opts;
  document.getElementById('partClubSelect').innerHTML = '<option value="">-- none --</option>' + opts;
}
window.deleteClub = async (id) => { await jdel(`${API}/clubs/${id}`); toast('Club deleted'); refreshClubs(); refreshStatsDependents(); };

document.getElementById('clubForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await jpost(`${API}/clubs`, Object.fromEntries(fd.entries()));
  e.target.reset();
  toast('Club saved');
  refreshClubs();
});

document.getElementById('clubCsvForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await uploadFile(`${API}/clubs/bulk-upload`, e.target);
    toast(`Imported ${res.imported} clubs`);
    e.target.reset();
    refreshClubs();
  } catch (err) { toast(err.message); }
});

// --- Registrations ---
const REG_TYPE_LABEL = { single: 'Single', double: 'Double', congress_only: 'Congress Only' };
async function refreshRegs() {
  const regs = await jget(`${API}/registrations`);
  document.getElementById('regsTableBody').innerHTML = regs.map((r) => `
    <tr>
      <td>${r.reg_number}</td>
      <td><span class="pill ${r.reg_type}">${REG_TYPE_LABEL[r.reg_type] || r.reg_type}</span></td>
      <td>${r.club_name || '-'}</td>
      <td>₹${r.amount_paid}</td>
      <td>₹${r.amount_due}</td>
      <td><span class="pill ${r.payment_status}">${r.payment_status}</span></td>
      <td>${r.participant_count}</td>
      <td>${canDelete() ? `<button class="btn danger small" onclick="deleteReg(${r.id})">Delete</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="8" class="empty">No registrations yet</td></tr>';

  const opts = regs.map((r) => `<option value="${r.id}">${r.reg_number} (${r.club_name || '-'})</option>`).join('');
  document.getElementById('partRegSelect').innerHTML = '<option value="">-- none --</option>' + opts;
}
window.deleteReg = async (id) => { await jdel(`${API}/registrations/${id}`); toast('Registration deleted'); refreshRegs(); };

async function loadNextRegNumber() {
  const field = document.getElementById('regNumberField');
  if (!field) return;
  try {
    const res = await jget(`${API}/registrations/next-number`);
    field.value = res.reg_number;
  } catch (err) {
    field.value = '';
    field.placeholder = 'Could not auto-generate — reload page';
  }
}

document.getElementById('regForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await jpost(`${API}/registrations`, Object.fromEntries(fd.entries()));
    e.target.reset();
    toast('Registration saved');
    refreshRegs();
    loadNextRegNumber();
  } catch (err) {
    // Someone else grabbed this number first (rare race) — fetch a fresh one and let the admin retry.
    toast(err.message);
    loadNextRegNumber();
  }
});

document.getElementById('regCsvForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await uploadFile(`${API}/registrations/bulk-upload`, e.target);
    toast(`Imported ${res.imported} registrations`);
    e.target.reset();
    refreshRegs();
  } catch (err) { toast(err.message); }
});

// --- Participants ---
function paymentPill(status) {
  if (!status) return '<span class="hint">-</span>';
  return `<span class="pill ${status}">${status}</span>`;
}

// Prefers the linked host member (real, always-current contact info) over
// the legacy free-text spoc_name/spoc_phone, which only remain as a fallback
// for participants that predate the host-member link.
function spocDisplay(p) {
  if (p.spoc_host_member_name) {
    return `${p.spoc_host_member_name}<br><span class="hint">${p.spoc_host_member_phone || ''} (host member)</span>`;
  }
  return `${p.spoc_name || '-'}${p.spoc_phone ? '<br><span class="hint">' + p.spoc_phone + '</span>' : ''}`;
}

async function refreshParts(query) {
  const url = query ? `${API}/participants?q=${encodeURIComponent(query)}` : `${API}/participants`;
  const rows = await jget(url);
  document.getElementById('partsTableBody').innerHTML = rows.map((p) => `
    <tr>
      <td><strong>${p.participant_code || '-'}</strong></td>
      <td>${p.name}${p.designation ? ' <span class="hint">(' + p.designation + ')</span>' : ''}</td>
      <td>${p.club_name || '-'}</td>
      <td>${p.reg_number || '-'}</td>
      <td>${p.phone || '-'}</td>
      <td>${p.travel_mode ? p.travel_mode + ' ' + (p.travel_number || '') + '<br><span class="hint">' + (p.travel_datetime || '') + '</span>' : '-'}</td>
      <td>${p.pickup_by || '-'}${p.pickup_vehicle ? '<br><span class="hint">' + p.pickup_vehicle + '</span>' : ''}</td>
      <td>${spocDisplay(p)}</td>
      <td>${paymentPill(p.payment_status)}</td>
      <td>
        <button class="btn small" onclick="editPart(${p.id})">Edit</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deletePart(${p.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="10" class="empty">No participants yet</td></tr>';
}
window.deletePart = async (id) => { await jdel(`${API}/participants/${id}`); toast('Participant deleted'); refreshParts(); };

const PART_FORM_FIELDS = [
  'name', 'phone', 'whatsapp', 'email', 'address', 'club_id', 'registration_id', 'designation', 'is_primary',
  'travel_mode', 'travel_number', 'travel_datetime', 'arrival_point',
  'departure_mode', 'departure_number', 'departure_datetime',
  'pickup_by', 'pickup_vehicle', 'pickup_phone', 'spoc_name', 'spoc_phone', 'notes'
];

// Loads an existing participant into the Add Participant form and switches
// it into "update" mode (tracked via form.dataset.editId) so the same form
// is used for both creating and editing — no separate edit screen needed.
window.editPart = async (id) => {
  let p;
  try {
    p = await jget(`${API}/participants/${id}`);
  } catch (err) {
    toast(err.message);
    return;
  }
  const form = document.getElementById('partForm');
  PART_FORM_FIELDS.forEach((f) => {
    const el = form.elements[f];
    if (!el) return;
    el.value = p[f] !== null && p[f] !== undefined ? p[f] : '';
  });
  if (form.elements.spoc_host_member_id) {
    form.elements.spoc_host_member_id.value = p.spoc_host_member_id || '';
  }
  form.dataset.editId = id;
  document.getElementById('partFormTitle').textContent = `Edit participant — ${p.participant_code || p.name}`;
  document.getElementById('partSubmitBtn').textContent = 'Update Participant';
  document.getElementById('partCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.cancelEditPart = () => {
  const form = document.getElementById('partForm');
  form.reset();
  delete form.dataset.editId;
  document.getElementById('partFormTitle').textContent = 'Add participant';
  document.getElementById('partSubmitBtn').textContent = 'Save Participant';
  document.getElementById('partCancelEditBtn').style.display = 'none';
};

async function savePartForm(form, force) {
  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());
  // spoc_host_member_id isn't a participants column — it's saved separately
  // as a delegate_assignments row (role='SPOC') via /api/assignments/spoc/:id.
  const spocHostMemberId = body.spoc_host_member_id || '';
  delete body.spoc_host_member_id;
  if (!body.club_id) delete body.club_id;
  if (!body.registration_id) delete body.registration_id;
  // travel_mode/departure_mode have a DB check constraint allowing only
  // flight/train/road/other or NULL — an empty string (the "-" placeholder
  // option) would violate it, so strip it rather than send "".
  if (!body.travel_mode) delete body.travel_mode;
  if (!body.departure_mode) delete body.departure_mode;
  if (force) body.force = true;
  const editId = form.dataset.editId;
  try {
    let participantId = editId;
    if (editId) {
      await jput(`${API}/participants/${editId}`, body);
      toast('Participant updated');
    } else {
      const res = await jpost(`${API}/participants`, body);
      participantId = res.id;
      toast(`Participant saved${res.participant_code ? ' — Registration ID ' + res.participant_code : ''}`);
    }
    if (participantId) {
      try {
        await jput(`${API}/assignments/spoc/${participantId}`, { host_member_id: spocHostMemberId || null });
      } catch (spocErr) {
        toast('Participant saved, but SPOC link failed: ' + spocErr.message);
      }
    }
    if (editId) window.cancelEditPart();
    else form.reset();
    refreshParts();
  } catch (err) {
    if (err.status === 409 && err.data && err.data.error === 'duplicate') {
      const proceed = confirm(err.data.message + '\n\nClick OK to save anyway, or Cancel to go back and edit.');
      if (proceed) return savePartForm(form, true);
    } else {
      toast(err.message);
    }
  }
}

document.getElementById('partForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await savePartForm(e.target, false);
});

document.getElementById('partCancelEditBtn').addEventListener('click', (e) => {
  e.preventDefault();
  window.cancelEditPart();
});

document.getElementById('partCsvForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await uploadFile(`${API}/participants/bulk-upload`, e.target);
    let msg = `Imported ${res.imported} participants`;
    if (res.skipped) msg += `, skipped ${res.skipped} likely duplicates`;
    toast(msg);
    e.target.reset();
    refreshParts();
  } catch (err) { toast(err.message); }
});

let searchTimer = null;
document.getElementById('partSearch').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => refreshParts(e.target.value), 300);
});

// --- Media ---
async function refreshMediaAdmin() {
  const videos = await jget(`${API}/media?type=video`);
  const posters = await jget(`${API}/media?type=poster`);
  const render = (items, kind) => items.map((m) => `
    <div class="thumb">
      ${kind === 'video' ? `<video src="${mediaUrl(m.filename)}" muted></video>` : `<img src="${mediaUrl(m.filename)}" />`}
      <div class="meta">
        <span>${m.title || ''}</span>
        <div>
          <button class="btn ${m.active ? 'outline' : 'gold'} small" onclick="toggleMedia(${m.id}, ${m.active ? 0 : 1})">${m.active ? 'Hide' : 'Show'}</button>
          ${canDelete() ? `<button class="btn danger small" onclick="deleteMedia(${m.id})">Del</button>` : ''}
        </div>
      </div>
    </div>
  `).join('') || '<div class="empty">None uploaded yet</div>';
  document.getElementById('videoThumbs').innerHTML = render(videos, 'video');
  document.getElementById('posterThumbs').innerHTML = render(posters, 'poster');
}
window.toggleMedia = async (id, active) => { await jput(`${API}/media/${id}`, { active }); refreshMediaAdmin(); };
window.deleteMedia = async (id) => { await jdel(`${API}/media/${id}`); toast('Media removed'); refreshMediaAdmin(); };

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
    const res = await uploadFile(`${API}/media/upload`, form);
    form.reset();
    toast('Upload complete and verified on the server', 3000);
    refreshMediaAdmin();
  } catch (err) {
    toast(err.message, 8000);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
});

// --- Happenings ---
async function refreshHappeningsAdmin() {
  const rows = await jget(`${API}/happenings?limit=50`);
  document.getElementById('happeningsList').innerHTML = rows.map((h) => `
    <div class="feed-item">
      <div class="time">${new Date(h.happened_at.replace(' ', 'T') + 'Z').toLocaleString()} · ${h.category} · ${h.posted_by || ''}</div>
      <div class="title">${h.title}</div>
      <div class="desc">${h.description || ''}</div>
      ${canDelete() ? `<button class="btn danger small" style="margin-top:6px;" onclick="deleteHappening(${h.id})">Delete</button>` : ''}
    </div>
  `).join('') || '<div class="empty">No updates yet</div>';
}
window.deleteHappening = async (id) => { await jdel(`${API}/happenings/${id}`); toast('Removed'); refreshHappeningsAdmin(); };

document.getElementById('happeningForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await jpost(`${API}/happenings`, Object.fromEntries(fd.entries()));
  e.target.reset();
  toast('Posted');
  refreshHappeningsAdmin();
});

// --- Itinerary (congress agenda, editable — shown on public dashboard) ---
async function refreshItinerary() {
  const rows = await jget(`${API}/itinerary`);
  document.getElementById('itinTableBody').innerHTML = rows.map((it) => `
    <tr>
      <td>${it.day_label}</td>
      <td>${it.time_label || '-'}</td>
      <td>${it.title}</td>
      <td>${it.description || '-'}</td>
      <td>
        <button class="btn small" onclick="editItin(${it.id})">Edit</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteItin(${it.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">No itinerary items yet</td></tr>';
}
window.deleteItin = async (id) => { await jdel(`${API}/itinerary/${id}`); toast('Itinerary item deleted'); refreshItinerary(); };

window.editItin = async (id) => {
  const it = await jget(`${API}/itinerary/${id}`);
  const form = document.getElementById('itinForm');
  ['day_label', 'time_label', 'title', 'description', 'sort_order'].forEach((f) => {
    if (form.elements[f]) form.elements[f].value = it[f] !== null && it[f] !== undefined ? it[f] : '';
  });
  form.dataset.editId = id;
  document.getElementById('itinFormTitle').textContent = 'Edit itinerary item';
  document.getElementById('itinSubmitBtn').textContent = 'Update Item';
  document.getElementById('itinCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
window.cancelEditItin = () => {
  const form = document.getElementById('itinForm');
  form.reset();
  delete form.dataset.editId;
  document.getElementById('itinFormTitle').textContent = 'Add itinerary item';
  document.getElementById('itinSubmitBtn').textContent = 'Save Item';
  document.getElementById('itinCancelEditBtn').style.display = 'none';
};
document.getElementById('itinCancelEditBtn').addEventListener('click', (e) => { e.preventDefault(); window.cancelEditItin(); });
document.getElementById('itinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  const editId = form.dataset.editId;
  try {
    if (editId) {
      await jput(`${API}/itinerary/${editId}`, body);
      toast('Itinerary item updated');
      window.cancelEditItin();
    } else {
      await jpost(`${API}/itinerary`, body);
      form.reset();
      toast('Itinerary item saved');
    }
    refreshItinerary();
  } catch (err) { toast(err.message); }
});

// --- Host Members ---
async function refreshHostMembers(query) {
  const rows = await jget(`${API}/hostmembers`);
  const q = (query || '').toLowerCase();
  const filtered = q
    ? rows.filter((h) => [h.name, h.phone, h.company].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
    : rows;
  document.getElementById('hmTableBody').innerHTML = filtered.map((h) => {
    const committeeNames = (h.committees || []).map((c) => c.name);
    const committeesLabel = committeeNames.length > 2
      ? committeeNames.slice(0, 2).join(', ') + ` +${committeeNames.length - 2} more`
      : (committeeNames.join(', ') || '-');
    return `
    <tr>
      <td class="sticky-col">${h.name}${h.designation ? ' <span class="hint">(' + h.designation + ')</span>' : ''}</td>
      <td>${h.company || '-'}</td>
      <td>${h.phone || '-'}</td>
      <td style="white-space:normal;max-width:220px;" title="${committeeNames.join(', ')}">${committeesLabel}</td>
      <td><span class="pill ${h.payment_status}">${h.payment_status}</span> <span class="hint">₹${h.payment_amount}</span></td>
      <td>${h.user_id ? '<span class="pill paid">has login</span>' : `<button class="btn small" onclick="createHostLogin(${h.id}, '${(h.name || '').replace(/'/g, '')}')">Create login</button>`}</td>
      <td class="sticky-actions">
        <button class="btn small" onclick="editHm(${h.id})">Edit</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteHm(${h.id})">Delete</button>` : ''}
      </td>
    </tr>
  `;
  }).join('') || '<tr><td colspan="7" class="empty">No host members yet</td></tr>';

  // Keep every other tab's host-member dropdowns in sync with the latest list.
  const opts = rows.map((h) => `<option value="${h.id}">${h.name}${h.company ? ' (' + h.company + ')' : ''}</option>`).join('');
  ['committeeHmSelect', 'assignHmSelect', 'taskHmSelect', 'createUserHmSelect', 'partSpocHmSelect'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">-- select --</option>' + opts;
  });
}
window.deleteHm = async (id) => { await jdel(`${API}/hostmembers/${id}`); toast('Host member deleted'); refreshHostMembers(); };

window.createHostLogin = async (id, name) => {
  const username = prompt(`Username for ${name}'s login:`, (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, ''));
  if (!username) return;
  const password = prompt('Temporary password (they can change it after logging in, min 6 characters):');
  if (!password || password.length < 6) { toast('Password must be at least 6 characters'); return; }
  try {
    await jpost(`${API}/auth/users`, { username, password, role: 'host_member', host_member_id: id });
    toast(`Login created for ${name}. Share the username/password with them — they log in at host.html.`, 6000);
    refreshHostMembers();
  } catch (err) { toast(err.message); }
};

const HM_FORM_FIELDS = ['name', 'phone', 'email', 'company', 'designation', 'category', 'payment_status', 'payment_amount', 'payment_mode', 'payment_date', 'notes'];
window.editHm = async (id) => {
  const h = await jget(`${API}/hostmembers/${id}`);
  const form = document.getElementById('hmForm');
  HM_FORM_FIELDS.forEach((f) => {
    if (form.elements[f]) form.elements[f].value = h[f] !== null && h[f] !== undefined ? h[f] : '';
  });
  form.dataset.editId = id;
  document.getElementById('hmFormTitle').textContent = `Edit host member — ${h.name}`;
  document.getElementById('hmSubmitBtn').textContent = 'Update Host Member';
  document.getElementById('hmCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
window.cancelEditHm = () => {
  const form = document.getElementById('hmForm');
  form.reset();
  delete form.dataset.editId;
  document.getElementById('hmFormTitle').textContent = 'Add host member';
  document.getElementById('hmSubmitBtn').textContent = 'Save Host Member';
  document.getElementById('hmCancelEditBtn').style.display = 'none';
};
document.getElementById('hmCancelEditBtn').addEventListener('click', (e) => { e.preventDefault(); window.cancelEditHm(); });
async function saveHmForm(form, force) {
  const body = Object.fromEntries(new FormData(form).entries());
  if (force) body.force = true;
  const editId = form.dataset.editId;
  try {
    if (editId) {
      await jput(`${API}/hostmembers/${editId}`, body);
      toast('Host member updated');
      window.cancelEditHm();
    } else {
      await jpost(`${API}/hostmembers`, body);
      form.reset();
      toast('Host member saved');
    }
    refreshHostMembers();
  } catch (err) {
    if (err.status === 409 && err.data && err.data.error === 'duplicate') {
      const proceed = confirm(err.data.message + '\n\nClick OK to save anyway, or Cancel to go back and edit.');
      if (proceed) return saveHmForm(form, true);
    } else {
      toast(err.message);
    }
  }
}
document.getElementById('hmForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveHmForm(e.target, false);
});
document.getElementById('hmCsvForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await uploadFile(`${API}/hostmembers/bulk-upload`, e.target);
    toast(`Imported ${res.imported} host members`);
    e.target.reset();
    refreshHostMembers();
  } catch (err) { toast(err.message); }
});
let hmSearchTimer = null;
document.getElementById('hmSearch').addEventListener('input', (e) => {
  clearTimeout(hmSearchTimer);
  hmSearchTimer = setTimeout(() => refreshHostMembers(e.target.value), 300);
});

// --- Host Registration & Payments ---
// A view dedicated to the host club members' own ₹5,000 personal
// contribution. This reads/writes the SAME host_members rows as the Host
// Members tab (just the payment_* columns) — it never touches the
// `registrations` table used by the delegate "Registrations & Payments" tab,
// so the two payment streams can never mix up.
async function refreshHostPayments() {
  const rows = await jget(`${API}/hostmembers`);
  const paidCount = rows.filter((h) => h.payment_status === 'paid').length;
  const pendingCount = rows.length - paidCount;
  const totalCollected = rows
    .filter((h) => h.payment_status === 'paid')
    .reduce((sum, h) => sum + Number(h.payment_amount || 0), 0);
  document.getElementById('hostPaymentStats').innerHTML = `
    <div class="stat-card"><div class="value">${rows.length}</div><div class="label">Host Members</div></div>
    <div class="stat-card"><div class="value">${paidCount}</div><div class="label">Paid</div></div>
    <div class="stat-card"><div class="value">${pendingCount}</div><div class="label">Pending</div></div>
    <div class="stat-card"><div class="value">₹${totalCollected.toLocaleString('en-IN')}</div><div class="label">Total Collected</div></div>
  `;
  document.getElementById('hostPaymentsTableBody').innerHTML = rows.map((h) => `
    <tr>
      <td class="sticky-col-left"><strong>${h.name}</strong></td>
      <td>
        <select id="hp-status-${h.id}" class="hp-status-select ${h.payment_status}">
          <option value="pending" ${h.payment_status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="paid" ${h.payment_status === 'paid' ? 'selected' : ''}>Paid</option>
        </select>
      </td>
      <td><input id="hp-amount-${h.id}" type="number" value="${h.payment_amount}" style="width:100px;" /></td>
      <td>${h.company || '-'}</td>
      <td>${h.phone || '-'}</td>
      <td><input id="hp-mode-${h.id}" type="text" value="${(h.payment_mode || '').replace(/"/g, '&quot;')}" style="width:120px;" placeholder="UPI / Bank / Others" /></td>
      <td><input id="hp-date-${h.id}" type="date" value="${h.payment_date ? new Date(h.payment_date).toISOString().slice(0, 10) : ''}" /></td>
      <td><input id="hp-notes-${h.id}" type="text" value="${(h.notes || '').replace(/"/g, '&quot;')}" style="width:150px;" /></td>
      <td class="sticky-actions"><button class="btn small" onclick="saveHostPayment(${h.id})">Save</button></td>
    </tr>
  `).join('') || '<tr><td colspan="9" class="empty">No host members yet</td></tr>';
}
window.saveHostPayment = async (id) => {
  const body = {
    payment_status: document.getElementById(`hp-status-${id}`).value,
    payment_amount: document.getElementById(`hp-amount-${id}`).value,
    payment_mode: document.getElementById(`hp-mode-${id}`).value,
    payment_date: document.getElementById(`hp-date-${id}`).value || null,
    notes: document.getElementById(`hp-notes-${id}`).value
  };
  try {
    await jput(`${API}/hostmembers/${id}`, body);
    toast('Payment updated');
    refreshHostPayments();
    refreshHostMembers();
  } catch (err) { toast(err.message); }
};

// --- Committees ---
let ALL_COMMITTEES_CACHE = [];
async function refreshCommittees() {
  const rows = await jget(`${API}/committees`);
  ALL_COMMITTEES_CACHE = rows;
  document.getElementById('committeesList').innerHTML = rows.map((c) => `
    <div class="card" style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>${c.name}</strong>
        <div>
          <button class="btn small" onclick="editCommittee(${c.id})">Edit</button>
          ${canDelete() ? `<button class="btn danger small" onclick="deleteCommittee(${c.id})">Delete</button>` : ''}
        </div>
      </div>
      <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
        ${(c.members || []).map((m) => `
          <span class="pill single" style="display:inline-flex;align-items:center;gap:6px;">
            ${m.name}${canDelete() ? ` <a href="#" onclick="removeCommitteeMember(${c.id}, ${m.id});return false;" style="color:inherit;">✕</a>` : ''}
          </span>
        `).join('') || '<span class="hint">No members assigned yet</span>'}
      </div>
    </div>
  `).join('') || '<div class="empty">No committees yet</div>';

  const opts = rows.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  document.getElementById('committeeSelect').innerHTML = opts;
}
window.removeCommitteeMember = async (committeeId, hostMemberId) => {
  await jdel(`${API}/committees/${committeeId}/members/${hostMemberId}`);
  toast('Removed from committee');
  refreshCommittees();
};
window.deleteCommittee = async (id) => {
  if (!confirm('Delete this committee? Members will be unassigned from it, but not deleted themselves.')) return;
  try {
    await jdel(`${API}/committees/${id}`);
    toast('Committee deleted');
    refreshCommittees();
  } catch (err) { toast(err.message); }
};
window.editCommittee = (id) => {
  const c = ALL_COMMITTEES_CACHE.find((x) => x.id === id);
  if (!c) return;
  const form = document.getElementById('committeeForm');
  form.elements.name.value = c.name;
  form.elements.sort_order.value = c.sort_order;
  form.dataset.editId = id;
  document.getElementById('committeeFormTitle').textContent = `Edit committee — ${c.name}`;
  document.getElementById('committeeSubmitBtn').textContent = 'Update Committee';
  document.getElementById('committeeCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
window.cancelEditCommittee = () => {
  const form = document.getElementById('committeeForm');
  form.reset();
  delete form.dataset.editId;
  document.getElementById('committeeFormTitle').textContent = 'Add committee';
  document.getElementById('committeeSubmitBtn').textContent = 'Save Committee';
  document.getElementById('committeeCancelEditBtn').style.display = 'none';
};
document.getElementById('committeeCancelEditBtn').addEventListener('click', (e) => { e.preventDefault(); window.cancelEditCommittee(); });
document.getElementById('committeeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  const editId = form.dataset.editId;
  try {
    if (editId) {
      await jput(`${API}/committees/${editId}`, body);
      toast('Committee updated');
      window.cancelEditCommittee();
    } else {
      await jpost(`${API}/committees`, body);
      form.reset();
      toast('Committee saved');
    }
    refreshCommittees();
  } catch (err) { toast(err.message); }
});
document.getElementById('committeeAssignForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const committeeId = fd.get('committee_id');
  const hostMemberId = fd.get('host_member_id');
  if (!hostMemberId) { toast('Choose a host member'); return; }
  try {
    await jpost(`${API}/committees/${committeeId}/members`, { host_member_id: hostMemberId });
    toast('Added to committee');
    refreshCommittees();
  } catch (err) { toast(err.message); }
});

// --- Delegate assistance assignments ---
async function refreshAssignments() {
  const rows = await jget(`${API}/assignments`);
  document.getElementById('assignTableBody').innerHTML = rows.map((a) => `
    <tr>
      <td>${a.host_member_name}<br><span class="hint">${a.host_member_phone || ''}</span></td>
      <td>${a.participant_name}<br><span class="hint">${a.participant_code || ''}</span></td>
      <td>${a.club_name || '-'}</td>
      <td>${a.reg_number || '-'}</td>
      <td>
        <select onchange="updateAssignmentStatus(${a.id}, this.value)">
          <option value="not_started" ${a.status === 'not_started' ? 'selected' : ''}>Not started</option>
          <option value="in_progress" ${a.status === 'in_progress' ? 'selected' : ''}>In progress</option>
          <option value="completed" ${a.status === 'completed' ? 'selected' : ''}>Completed</option>
        </select>
      </td>
      <td>${a.notes || '-'}</td>
      <td>${canDelete() ? `<button class="btn danger small" onclick="deleteAssignment(${a.id})">Delete</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty">No assignments yet</td></tr>';
}
window.deleteAssignment = async (id) => { await jdel(`${API}/assignments/${id}`); toast('Assignment removed'); refreshAssignments(); };
window.updateAssignmentStatus = async (id, status) => {
  try {
    await jput(`${API}/assignments/${id}`, { status });
    toast('Status updated');
  } catch (err) { toast(err.message); }
};

async function refreshAssignmentDropdowns() {
  const parts = await jget(`${API}/participants`);
  const opts = parts.map((p) => `<option value="${p.id}">${p.name} — ${p.participant_code || ''} (${p.club_name || 'no club'})</option>`).join('');
  const el = document.getElementById('assignPartSelect');
  if (el) el.innerHTML = opts;
}

document.getElementById('assignForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  try {
    await jpost(`${API}/assignments`, body);
    e.target.reset();
    toast('Assignment created');
    refreshAssignments();
  } catch (err) { toast(err.message); }
});

// --- Checklists & milestones (host_tasks) ---
async function refreshTasks() {
  const rows = await jget(`${API}/tasks`);
  document.getElementById('taskTableBody').innerHTML = rows.map((t) => `
    <tr>
      <td>${t.host_member_name}</td>
      <td>${t.title}${t.description ? '<br><span class="hint">' + t.description + '</span>' : ''}</td>
      <td>${Number(t.is_milestone) ? '<span class="pill double">Milestone</span>' : '<span class="hint">Checklist</span>'}</td>
      <td>
        <select onchange="updateTaskStatus(${t.id}, this.value)">
          <option value="pending" ${t.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>In progress</option>
          <option value="done" ${t.status === 'done' ? 'selected' : ''}>Done</option>
        </select>
      </td>
      <td>${t.due_date ? new Date(t.due_date).toLocaleDateString() : '-'}</td>
      <td>${canDelete() ? `<button class="btn danger small" onclick="deleteTask(${t.id})">Delete</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty">No tasks yet</td></tr>';
}
window.deleteTask = async (id) => { await jdel(`${API}/tasks/${id}`); toast('Task removed'); refreshTasks(); };
window.updateTaskStatus = async (id, status) => {
  try {
    await jput(`${API}/tasks/${id}`, { status });
    toast('Status updated');
  } catch (err) { toast(err.message); }
};
document.getElementById('taskForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  try {
    await jpost(`${API}/tasks`, body);
    e.target.reset();
    toast('Task saved');
    refreshTasks();
  } catch (err) { toast(err.message); }
});

// --- Partners & Drivers (masters) ---
async function refreshPartners() {
  const rows = await jget(`${API}/partners`);
  document.getElementById('partnerTableBody').innerHTML = rows.map((p) => `
    <tr>
      <td>${p.category}</td>
      <td>${p.name}</td>
      <td>${p.contact_person || '-'}</td>
      <td>${p.phone || '-'}</td>
      <td>${canDelete() ? `<button class="btn danger small" onclick="deletePartner(${p.id})">Delete</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">No partners yet</td></tr>';

  const opts = rows.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  document.getElementById('driverPartnerSelect').innerHTML = '<option value="">-- none --</option>' + opts;
}
window.deletePartner = async (id) => { await jdel(`${API}/partners/${id}`); toast('Partner removed'); refreshPartners(); };
async function savePartnerForm(form, force) {
  const body = Object.fromEntries(new FormData(form).entries());
  if (force) body.force = true;
  try {
    await jpost(`${API}/partners`, body);
    form.reset();
    toast('Partner saved');
    refreshPartners();
  } catch (err) {
    if (err.status === 409) {
      const proceed = confirm(err.message + '\n\nClick OK to save anyway, or Cancel to go back and edit.');
      if (proceed) return savePartnerForm(form, true);
    } else {
      toast(err.message);
    }
  }
}
document.getElementById('partnerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await savePartnerForm(e.target, false);
});

async function refreshDrivers() {
  const rows = await jget(`${API}/drivers`);
  document.getElementById('driverTableBody').innerHTML = rows.map((d) => `
    <tr>
      <td>${d.name}</td>
      <td>${d.phone || '-'}</td>
      <td>${d.vehicle_type || ''} ${d.vehicle_number || ''}</td>
      <td>${d.partner_name || '-'}</td>
      <td>${canDelete() ? `<button class="btn danger small" onclick="deleteDriver(${d.id})">Delete</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">No drivers yet</td></tr>';
}
window.deleteDriver = async (id) => { await jdel(`${API}/drivers/${id}`); toast('Driver removed'); refreshDrivers(); };
async function saveDriverForm(form, force) {
  const body = Object.fromEntries(new FormData(form).entries());
  if (!body.partner_id) delete body.partner_id;
  if (force) body.force = true;
  try {
    await jpost(`${API}/drivers`, body);
    form.reset();
    toast('Driver saved');
    refreshDrivers();
  } catch (err) {
    if (err.status === 409) {
      const proceed = confirm(err.message + '\n\nClick OK to save anyway, or Cancel to go back and edit.');
      if (proceed) return saveDriverForm(form, true);
    } else {
      toast(err.message);
    }
  }
}
document.getElementById('driverForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveDriverForm(e.target, false);
});

// --- Export ---
document.getElementById('exportBtn').addEventListener('click', async () => {
  const data = await jget(`${API}/export/voice-agent`);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'voice-agent-data.json';
  a.click();
  URL.revokeObjectURL(url);
});

// --- Settings: one-click host club data import (super_admin only) ---
document.getElementById('seedHostDataBtn').addEventListener('click', async () => {
  const btn = document.getElementById('seedHostDataBtn');
  const out = document.getElementById('seedHostDataResult');
  btn.disabled = true;
  btn.textContent = 'Importing...';
  out.textContent = '';
  try {
    const summary = await jpost(`${API}/admin/seed-host-data`, {});
    out.innerHTML = `Host members: ${summary.membersInserted} added, ${summary.membersUpdated} updated.<br>` +
      `Committees: ${summary.committeesCreated} created, ${summary.membershipsCreated} memberships added.<br>` +
      `Itinerary: ${summary.itineraryResult}.`;
    toast('Import complete');
    refreshHostMembers();
    refreshCommittees();
    refreshItinerary();
  } catch (err) {
    out.textContent = 'Import failed: ' + err.message;
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import Host Members & Committees Now';
  }
});

// --- Settings: user management (super_admin only) ---
function userBadge(status) {
  const cls = status === 'approved' ? 'paid' : status === 'pending' ? 'partial' : 'pending';
  return `<span class="pill ${cls}">${status}</span>`;
}

async function refreshUsersAdmin() {
  if (!CURRENT_USER || CURRENT_USER.role !== 'super_admin') return;
  let users;
  try {
    users = await jget(`${API}/auth/users`);
  } catch (e) {
    return;
  }
  const pending = users.filter((u) => u.status === 'pending');
  document.getElementById('pendingUsersBody').innerHTML = pending.map((u) => `
    <tr>
      <td>${u.username}</td><td>${u.email || '-'}</td>
      <td>${new Date(u.created_at).toLocaleString()}</td>
      <td>
        <button class="btn gold small" onclick="approveUser(${u.id})">Approve</button>
        <button class="btn danger small" onclick="rejectUser(${u.id})">Reject</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="empty">No pending requests</td></tr>';

  document.getElementById('allUsersBody').innerHTML = users.map((u) => `
    <tr>
      <td>${u.username}</td><td>${u.email || '-'}</td><td>${u.role}</td>
      <td>${u.host_member_name || '<span class="hint">-</span>'}</td>
      <td>${userBadge(u.status)}</td>
      <td>${new Date(u.created_at).toLocaleDateString()}</td>
      <td>${u.id === CURRENT_USER.id ? '<span class="hint">(you)</span>' : `<button class="btn danger small" onclick="deleteUser(${u.id})">Delete</button>`}</td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty">No logins yet</td></tr>';
}
window.approveUser = async (id) => { await jput(`${API}/auth/users/${id}/approve`, {}); toast('Approved'); refreshUsersAdmin(); };
window.rejectUser = async (id) => { await jput(`${API}/auth/users/${id}/reject`, {}); toast('Rejected'); refreshUsersAdmin(); };
window.deleteUser = async (id) => { if (!confirm('Delete this login?')) return; await jdel(`${API}/auth/users/${id}`); toast('Login removed'); refreshUsersAdmin(); };

// Show/hide + require the host-member picker only when creating a host_member login.
const createUserRoleSelect = document.getElementById('createUserRoleSelect');
const createUserHmField = document.getElementById('createUserHmField');
const createUserHmSelect = document.getElementById('createUserHmSelect');
if (createUserRoleSelect) {
  createUserRoleSelect.addEventListener('change', () => {
    const isHostMember = createUserRoleSelect.value === 'host_member';
    createUserHmField.style.display = isHostMember ? '' : 'none';
    if (createUserHmSelect) createUserHmSelect.required = isHostMember;
  });
}

document.getElementById('createUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  if (body.role !== 'host_member') delete body.host_member_id;
  else if (!body.host_member_id) { toast('Choose which host member this login belongs to.'); return; }
  try {
    await jpost(`${API}/auth/users`, body);
    e.target.reset();
    createUserHmField.style.display = 'none';
    toast('Login created');
    refreshUsersAdmin();
    refreshHostMembers();
  } catch (err) { toast(err.message); }
});

document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await jput(`${API}/auth/me/password`, Object.fromEntries(fd.entries()));
    e.target.reset();
    toast('Password updated');
  } catch (err) { toast(err.message); }
});

function refreshStatsDependents() { /* hook for cross-tab refresh if needed */ }

// --- Init ---
function loadAllData() {
  refreshClubs();
  refreshRegs();
  loadNextRegNumber();
  refreshParts();
  refreshMediaAdmin();
  refreshHappeningsAdmin();
  refreshItinerary();
  refreshHostMembers();
  refreshHostPayments();
  refreshCommittees();
  refreshAssignmentDropdowns();
  refreshAssignments();
  refreshTasks();
  refreshPartners();
  refreshDrivers();
  if (CURRENT_USER && CURRENT_USER.role === 'super_admin') refreshUsersAdmin();
}

tryResumeSession();
