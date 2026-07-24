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

// --- Shared pickup/drop point suggestions ---
// A small master list (Airport, Railway Station, Bus Stand, plus anything an
// admin has typed into a From/To/arrival-point field before) offered as
// autocomplete via the #transportPointsList datalist referenced from the
// Delegates form's arrival point field and every From/To field in Transport
// Planning + Pre Tours. Kept as a simple cache + a "make sure this value is
// in the list" helper (called after every save that includes a location
// field) rather than a heavier live-sync, since points are added rarely
// relative to how often they're read.
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
    TRANSPORT_POINTS_CACHE = await jget(`${API}/transport-points`);
    renderTransportPointsDatalist();
  } catch (err) { /* datalist keeps its static HTML fallback options */ }
  renderTransportPointsChips();
}
// Called (fire-and-forget) after saving anything with a location field, so a
// custom point typed in once is remembered and suggested everywhere else
// from then on. Silently skips if it's already in the cache (case-insensitive)
// and never surfaces errors to the user — this is a background convenience,
// not a required step.
async function ensureTransportPoint(name) {
  const value = (name || '').trim();
  if (!value) return;
  if (TRANSPORT_POINTS_CACHE.some((p) => p.name.toLowerCase() === value.toLowerCase())) return;
  try {
    const point = await jpost(`${API}/transport-points`, { name: value });
    if (point && !TRANSPORT_POINTS_CACHE.some((p) => p.id === point.id)) {
      TRANSPORT_POINTS_CACHE.push(point);
      renderTransportPointsDatalist();
      renderTransportPointsChips();
    }
  } catch (err) { /* non-critical */ }
}
function renderTransportPointsChips() {
  const wrap = document.getElementById('transportPointsChips');
  if (!wrap) return;
  wrap.innerHTML = TRANSPORT_POINTS_CACHE.map((p) => `
    <span class="hint" style="border:1px solid var(--line);border-radius:20px;padding:4px 10px;display:inline-flex;align-items:center;gap:6px;">
      ${p.name}
      ${canDelete() ? `<button type="button" class="btn danger small" style="padding:0 6px;line-height:1.4;" onclick="deleteTransportPoint(${p.id})" title="Remove">&times;</button>` : ''}
    </span>
  `).join('') || '<span class="hint">No custom points added yet.</span>';
}
window.deleteTransportPoint = async (id) => {
  try {
    await jdel(`${API}/transport-points/${id}`);
    toast('Point removed');
    refreshTransportPoints();
  } catch (err) { toast(err.message); }
};

// Every pickup/drop-point input is marked with data-location-suggest="1"
// (NOT the native `list="..."` datalist attribute — that was tried first,
// but the browser's own native datalist popup gives no visible affordance
// on desktop and, worse, was seen rendering in the wrong place on screen
// entirely detached from the input in some layouts). So instead every such
// input gets wrapped (once) with a fully custom dropdown button + menu that
// we position and fill ourselves, while the input itself stays a free-typing
// text field for anything not already in the list. Safe to call repeatedly
// — already-wrapped inputs are skipped — so it can run after every render
// that might introduce new location inputs (page init, the arrivals/
// departures queue refresh).
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

// Parses a fetch Response as JSON, but falls back to a readable error
// instead of letting a non-JSON body (e.g. an HTML 404/500 page from a
// backend that hasn't picked up the latest deploy yet) throw an opaque
// "unexpected token" / "string did not match the expected pattern" parse
// error that gives no clue what actually went wrong.
async function parseJsonResponse(r) {
  const text = await r.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (e) {
    const hint = !r.ok
      ? `Server returned HTTP ${r.status} instead of JSON — the backend may not have this endpoint deployed yet. Try a fresh Render deploy of the latest commit.`
      : 'Server returned an unexpected (non-JSON) response.';
    throw new Error(hint);
  }
}
async function jget(url) {
  const r = await fetch(url, { headers: authHeaders() });
  if (r.status === 401) { handleUnauthorized(); throw new Error('Please log in again.'); }
  const data = await parseJsonResponse(r);
  if (!r.ok) { const err = new Error(data.error || `Request failed (HTTP ${r.status})`); err.data = data; err.status = r.status; throw err; }
  return data;
}
async function jpost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  if (r.status === 401) { handleUnauthorized(); throw new Error('Please log in again.'); }
  const data = await parseJsonResponse(r);
  if (!r.ok) { const err = new Error(data.error || `Request failed (HTTP ${r.status})`); err.data = data; err.status = r.status; throw err; }
  return data;
}
async function jput(url, body) {
  const r = await fetch(url, { method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  if (r.status === 401) { handleUnauthorized(); throw new Error('Please log in again.'); }
  const data = await parseJsonResponse(r);
  if (!r.ok) { const err = new Error(data.error || `Request failed (HTTP ${r.status})`); err.data = data; err.status = r.status; throw err; }
  return data;
}
async function jdel(url) {
  const r = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  if (r.status === 401) { handleUnauthorized(); throw new Error('Please log in again.'); }
  const data = await parseJsonResponse(r);
  if (!r.ok) { const err = new Error(data.error || `Request failed (HTTP ${r.status})`); err.data = data; err.status = r.status; throw err; }
  return data;
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

// Same as uploadFile() but for a single File object rather than a whole
// <form> — used by the sponsor-logo / speaker-photo uploads, which are a
// single-click action on a table row rather than a full form submit.
async function uploadFileBlob(url, file) {
  const fd = new FormData();
  fd.append('file', file);
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: authHeaders(), body: fd });
  } catch (networkErr) {
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

// Shared hidden <input type="file"> (see admin.html) re-targeted per click —
// avoids needing a separate file input in every sponsor/speaker table row.
let imgUploadTarget = null; // { kind: 'sponsor'|'speaker', id }
document.getElementById('imgUploadInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const target = imgUploadTarget;
  e.target.value = ''; // reset so picking the same file again still fires 'change'
  imgUploadTarget = null;
  if (!file || !target) return;
  try {
    if (target.kind === 'sponsor') {
      await uploadFileBlob(`${API}/sponsors/${target.id}/logo`, file);
      toast('Sponsor logo updated');
      refreshSponsors();
    } else if (target.kind === 'speaker') {
      await uploadFileBlob(`${API}/speakers/${target.id}/photo`, file);
      toast('Speaker photo updated');
      refreshSpeakers();
    } else if (target.kind === 'vendor_product') {
      await uploadFileBlob(`${API}/vendors/products/${target.id}/photo`, file);
      toast('Product photo updated');
      if (typeof renderVendorModalBody === 'function') renderVendorModalBody();
    } else if (MEMBER_UPLOAD_KINDS[target.kind]) {
      const { endpoint, field, label, refresh } = MEMBER_UPLOAD_KINDS[target.kind];
      await uploadFileBlob(`${API}/${endpoint}/${target.id}/${field}`, file);
      toast(`${label} updated`);
      refresh();
    }
  } catch (err) {
    toast(err.message);
  }
});
window.triggerSponsorLogoUpload = (id) => { imgUploadTarget = { kind: 'sponsor', id }; document.getElementById('imgUploadInput').click(); };
window.triggerSpeakerPhotoUpload = (id) => { imgUploadTarget = { kind: 'speaker', id }; document.getElementById('imgUploadInput').click(); };
window.triggerVendorProductPhotoUpload = (id) => { imgUploadTarget = { kind: 'vendor_product', id }; document.getElementById('imgUploadInput').click(); };
window.removeSponsorLogo = async (id) => {
  try { await jdel(`${API}/sponsors/${id}/logo`); toast('Logo removed'); refreshSponsors(); }
  catch (err) { toast(err.message); }
};
window.removeSpeakerPhoto = async (id) => {
  try { await jdel(`${API}/speakers/${id}/photo`); toast('Photo removed'); refreshSpeakers(); }
  catch (err) { toast(err.message); }
};

// Shared hidden <input type="file"> (see admin.html) for the vendor/payee's
// actual bill on a finance outward payment or purchase request — kept
// separate from #imgUploadInput above since a bill is often a PDF scan, not
// an image (that input's accept="image/*" would reject it).
let financeBillUploadTarget = null; // finance_transactions.id
document.getElementById('financeBillUploadInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const id = financeBillUploadTarget;
  e.target.value = '';
  financeBillUploadTarget = null;
  if (!file || !id) return;
  try {
    await uploadFileBlob(`${API}/finance/outward/${id}/bill`, file);
    toast('Bill attached');
    refreshFinanceOutward();
    refreshFinancePurchases();
  } catch (err) { toast(err.message); }
});
window.triggerFinanceBillUpload = (id) => { financeBillUploadTarget = id; document.getElementById('financeBillUploadInput').click(); };
window.removeFinanceBill = async (id) => {
  try { await jdel(`${API}/finance/outward/${id}/bill`); toast('Bill removed'); refreshFinanceOutward(); refreshFinancePurchases(); }
  catch (err) { toast(err.message); }
};
// Renders the Bill cell shared by the Outward Payments and Purchase
// Requests tables — a "View" link to the vendor/payee's actual bill file
// (image or PDF, opened in a new tab — no thumbnail assumption since it
// isn't always an image) plus Upload/Replace/Remove, same shape as
// photoCell/cardCell above but for finance_transactions rows.
function financeBillCell(id, billUrl) {
  const view = billUrl ? `<a href="${mediaUrl(billUrl)}" target="_blank" rel="noopener" class="btn small" style="text-decoration:none;">View</a> ` : '';
  return `${view}<button type="button" class="btn small" onclick="triggerFinanceBillUpload(${id})">${billUrl ? 'Replace' : 'Upload'}</button>${billUrl ? ` <button type="button" class="btn small" onclick="removeFinanceBill(${id})">Remove</button>` : ''}`;
}

// Shared hidden <input type="file"> (see admin.html) for a Delegate's
// Aadhaar scan — Aadhaar is government ID data, so this whole feature
// (this input, the endpoint it hits, and the cell renderer below) is only
// ever surfaced when the logged-in admin is a super_admin; refreshParts()
// simply omits the "Aadhaar" field from a regular admin's card list, and
// the backend independently strips aadhaar_number/aadhaar_url from the
// GET /participants response for any non-super_admin caller regardless of
// what the UI does, so there's no way to see this data by inspecting
// network traffic as a plain admin either. Kept separate from
// #imgUploadInput since an Aadhaar scan is often a PDF, not an image.
let aadhaarUploadTarget = null; // participants.id
document.getElementById('aadhaarUploadInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const id = aadhaarUploadTarget;
  e.target.value = '';
  aadhaarUploadTarget = null;
  if (!file || !id) return;
  try {
    await uploadFileBlob(`${API}/participants/${id}/aadhaar`, file);
    toast('Aadhaar document attached');
    refreshParts();
  } catch (err) { toast(err.message); }
});
window.triggerParticipantAadhaarUpload = (id) => { aadhaarUploadTarget = id; document.getElementById('aadhaarUploadInput').click(); };
window.removeParticipantAadhaar = async (id) => {
  try { await jdel(`${API}/participants/${id}/aadhaar`); toast('Aadhaar document removed'); refreshParts(); }
  catch (err) { toast(err.message); }
};
// "View" link (image or PDF, opened in a new tab) + Upload/Replace/Remove,
// same shape as financeBillCell — plus the masked/full Aadhaar number, since
// this cell is only ever rendered for a super_admin viewer in the first
// place (see refreshParts()).
function aadhaarCell(p) {
  const view = p.aadhaar_url ? `<a href="${mediaUrl(p.aadhaar_url)}" target="_blank" rel="noopener" class="btn small" style="text-decoration:none;">View</a> ` : '';
  const numberLine = p.aadhaar_number ? `<div>${p.aadhaar_number}</div>` : '<div class="hint">No number on file</div>';
  return `${numberLine}${view}<button type="button" class="btn small" onclick="triggerParticipantAadhaarUpload(${p.id})">${p.aadhaar_url ? 'Replace' : 'Upload'}</button>${p.aadhaar_url ? ` <button type="button" class="btn small" onclick="removeParticipantAadhaar(${p.id})">Remove</button>` : ''}`;
}

// Passport — the alternate identity document for international Delegates
// who don't hold an Aadhaar (see publicProfile.js's PUT /participant/:id/travel
// for the "at least one of the two" rule). Same super_admin-only visibility
// model and cell shape as Aadhaar above.
let passportUploadTarget = null; // participants.id
document.getElementById('passportUploadInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const id = passportUploadTarget;
  e.target.value = '';
  passportUploadTarget = null;
  if (!file || !id) return;
  try {
    await uploadFileBlob(`${API}/participants/${id}/passport`, file);
    toast('Passport document attached');
    refreshParts();
  } catch (err) { toast(err.message); }
});
window.triggerParticipantPassportUpload = (id) => { passportUploadTarget = id; document.getElementById('passportUploadInput').click(); };
window.removeParticipantPassport = async (id) => {
  try { await jdel(`${API}/participants/${id}/passport`); toast('Passport document removed'); refreshParts(); }
  catch (err) { toast(err.message); }
};
function passportCell(p) {
  const view = p.passport_url ? `<a href="${mediaUrl(p.passport_url)}" target="_blank" rel="noopener" class="btn small" style="text-decoration:none;">View</a> ` : '';
  const numberLine = p.passport_number ? `<div>${p.passport_number}</div>` : '<div class="hint">No number on file</div>';
  return `${numberLine}${view}<button type="button" class="btn small" onclick="triggerParticipantPassportUpload(${p.id})">${p.passport_url ? 'Replace' : 'Upload'}</button>${p.passport_url ? ` <button type="button" class="btn small" onclick="removeParticipantPassport(${p.id})">Remove</button>` : ''}`;
}

// --- Congress-wide member Photo / Business Card uploads (Delegates, Host
// Members, Volunteers) — same shared imgUploadInput mechanism as the
// sponsor logo / speaker photo uploads above, just with 6 more "kinds"
// (photo + business card, times 3 member types). Refresh functions are
// referenced by name rather than called directly here since they're
// function declarations defined later in this file — hoisted, so this is
// safe (the listener only ever runs after the whole script has executed).
const MEMBER_UPLOAD_KINDS = {
  participant_photo: { endpoint: 'participants', field: 'photo', label: 'Photo', refresh: () => refreshParts() },
  participant_card: { endpoint: 'participants', field: 'business-card', label: 'Business card', refresh: () => refreshParts() },
  hostmember_photo: { endpoint: 'hostmembers', field: 'photo', label: 'Photo', refresh: () => refreshHostMembers() },
  hostmember_card: { endpoint: 'hostmembers', field: 'business-card', label: 'Business card', refresh: () => refreshHostMembers() },
  volunteer_photo: { endpoint: 'volunteers', field: 'photo', label: 'Photo', refresh: () => refreshVolunteers() },
  volunteer_card: { endpoint: 'volunteers', field: 'business-card', label: 'Business card', refresh: () => refreshVolunteers() }
};
const MEMBER_UPLOAD_ENDPOINT = { participant: 'participants', host_member: 'hostmembers', volunteer: 'volunteers' };
window.triggerMemberPhotoUpload = (memberType, id) => { imgUploadTarget = { kind: `${memberType === 'host_member' ? 'hostmember' : memberType}_photo`, id }; document.getElementById('imgUploadInput').click(); };
window.triggerMemberCardUpload = (memberType, id) => { imgUploadTarget = { kind: `${memberType === 'host_member' ? 'hostmember' : memberType}_card`, id }; document.getElementById('imgUploadInput').click(); };
window.removeMemberPhoto = async (memberType, id) => {
  try {
    await jdel(`${API}/${MEMBER_UPLOAD_ENDPOINT[memberType]}/${id}/photo`);
    toast('Photo removed');
    MEMBER_UPLOAD_KINDS[`${memberType === 'host_member' ? 'hostmember' : memberType}_photo`].refresh();
  } catch (err) { toast(err.message); }
};
window.removeMemberCard = async (memberType, id) => {
  try {
    await jdel(`${API}/${MEMBER_UPLOAD_ENDPOINT[memberType]}/${id}/business-card`);
    toast('Business card removed');
    MEMBER_UPLOAD_KINDS[`${memberType === 'host_member' ? 'hostmember' : memberType}_card`].refresh();
  } catch (err) { toast(err.message); }
};

// Renders the Photo/Card table cells shared by the Delegates, Host Members,
// and Volunteers tables — a small thumbnail + Replace/Remove once a file is
// on file, or just an Upload button when there's none yet.
function photoCell(memberType, obj) {
  const thumb = obj.photo_url
    ? `<img src="${mediaUrl(obj.photo_url)}" alt="${obj.name} photo" style="width:36px;height:36px;object-fit:cover;border-radius:50%;border:1px solid var(--border,#ddd);cursor:zoom-in;" onclick="openImageLightbox(this.src)" />`
    : '';
  return `${thumb}<button type="button" class="btn small" onclick="triggerMemberPhotoUpload('${memberType}', ${obj.id})">${obj.photo_url ? 'Replace' : 'Upload'}</button>${obj.photo_url ? ` <button type="button" class="btn small" onclick="removeMemberPhoto('${memberType}', ${obj.id})">Remove</button>` : ''}`;
}
function cardCell(memberType, obj) {
  const thumb = obj.business_card_url
    ? `<img src="${mediaUrl(obj.business_card_url)}" alt="${obj.name} business card" style="width:48px;height:32px;object-fit:cover;border-radius:4px;border:1px solid var(--border,#ddd);cursor:zoom-in;" onclick="openImageLightbox(this.src)" />`
    : '';
  return `${thumb}<button type="button" class="btn small" onclick="triggerMemberCardUpload('${memberType}', ${obj.id})">${obj.business_card_url ? 'Replace' : 'Upload'}</button>${obj.business_card_url ? ` <button type="button" class="btn small" onclick="removeMemberCard('${memberType}', ${obj.id})">Remove</button>` : ''}`;
}

// Shared Shirt/Tee/Waist summary shown on the Delegates, Host Members, and
// Volunteers cards — one place so all three stay in sync (previously each
// table rebuilt this string inline and two of the three had drifted out of
// sync with the Waist size field once it was added).
function sizesLabel(obj) {
  const parts = [];
  if (obj.shirt_size) parts.push('Shirt: ' + obj.shirt_size);
  if (obj.tshirt_size) parts.push('Tee: ' + obj.tshirt_size);
  if (obj.waist_size) parts.push('Waist: ' + obj.waist_size);
  return parts.length ? parts.join('<br>') : '-';
}

// Builds one card for the Delegates/Host Members/Volunteers "record card
// list" layout (see .record-card-list in styles.css). Replaces the old
// wide-table row so nothing ever needs horizontal scrolling to reach the
// action buttons. `headerLeftHtml`/`headerRightHtml` sit side-by-side atop
// the card; `fields` is an array of {label, value} pairs (falsy values are
// skipped so blank fields don't leave an empty gap); `actionsHtml` is a
// pre-built string of one or more <button> tags.
function renderRecordCard(headerLeftHtml, headerRightHtml, fields, actionsHtml, cardId) {
  const fieldsHtml = fields
    .filter((f) => f && f.value !== undefined && f.value !== null && f.value !== '')
    .map((f) => `<div class="record-card-field"><label>${f.label}</label><div class="value">${f.value}</div></div>`)
    .join('');
  return `
    <div class="record-card"${cardId ? ` id="${cardId}"` : ''}>
      <div class="record-card-header">
        <div class="record-card-name">${headerLeftHtml}</div>
        ${headerRightHtml ? `<div class="record-card-header-right">${headerRightHtml}</div>` : ''}
      </div>
      <div class="record-card-fields">${fieldsHtml}</div>
      <div class="record-card-actions">${actionsHtml}</div>
    </div>
  `;
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
  document.getElementById('activityLogTabBtn').style.display = (CURRENT_USER && CURRENT_USER.role === 'super_admin') ? '' : 'none';
  loadAllData();
  refreshPushButton();
}

// ================= PUSH NOTIFICATIONS ("Enable notifications" + broadcast) =================
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

const broadcastForm = document.getElementById('broadcastForm');
if (broadcastForm) {
  broadcastForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('broadcastError');
    const okEl = document.getElementById('broadcastSuccess');
    errEl.style.display = 'none';
    okEl.style.display = 'none';
    const fd = new FormData(e.target);
    const roles = Array.from(e.target.querySelector('select[name="roles"]').selectedOptions).map((o) => o.value);
    try {
      const data = await jpost(`${API}/push/broadcast`, { title: fd.get('title'), body: fd.get('body'), roles: roles.length ? roles : ['all'] });
      okEl.textContent = `Sent to ${data.sent} device(s).`;
      okEl.style.display = 'block';
      e.target.reset();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  });
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
    const RESTRICTED_ROLES = ['host_member', 'media', 'transporter', 'driver'];
    if (RESTRICTED_ROLES.includes(data.user.role)) {
      throw new Error(`This login is for the ${data.user.role.replace('_', ' ')} portal — use login.html instead.`);
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
    if (['host_member', 'media', 'transporter', 'driver'].includes(user.role)) { setToken(''); showAuthGate(); return; }
    CURRENT_USER = user;
    showApp();
  } catch (e) {
    showAuthGate();
  }
}

// ================= STATS DASHBOARD (merged in from the old dashboard.html —=
// it used to be a separate page with its own admin login; now it's just the
// first sidebar tab, reusing this same admin session). =====================
let clubChart, stateChart, merchShirtChart, merchTeeChart;
let dashboardStarted = false;

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

function money(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN');
}

function renderHostPay(o) {
  const el = document.getElementById('hostPayCards');
  if (!el || !o) return;
  const hm = o.hostMembers || {};
  el.innerHTML = [
    { label: 'Host Team Members', value: hm.total || 0 },
    { label: 'Payments Received', value: hm.paid || 0, cls: 'diet-veg' },
    { label: 'Partial Payments', value: hm.partial || 0 },
    { label: 'Payments Pending', value: hm.pending || 0, cls: 'diet-nonveg' },
    { label: 'Amount Collected', value: money(hm.collectedAmount), cls: 'diet-veg' },
    { label: 'Amount Pending', value: money(hm.pendingAmount), cls: 'diet-nonveg' }
  ].map((c) => `
    <div class="stat-card ${c.cls || ''}">
      <div class="value">${c.value}</div>
      <div class="label">${c.label}</div>
    </div>
  `).join('');
}

function renderOpsCards(o) {
  const el = document.getElementById('opsCards');
  if (!el || !o) return;
  const cards = [
    { label: 'Transporters', value: o.transporters },
    { label: 'Drivers', value: o.drivers },
    { label: 'Vehicles', value: o.vehicles },
    { label: 'Hotels', value: o.hotels },
    { label: 'Rooms Assigned', value: o.roomsAssigned },
    { label: 'Guests in Rooms', value: o.occupantsAssigned },
    { label: 'Sponsors', value: o.sponsors },
    { label: 'Guest Speakers', value: o.speakers },
    { label: 'Guest Visitors', value: o.guestVisitors },
    { label: 'Committees', value: o.committees },
    { label: 'Transport Trips Planned', value: o.transportTrips },
    { label: 'Pre-Tours', value: o.preTours },
    { label: 'Inventory Items', value: (o.inventory && o.inventory.items) || 0 },
    { label: 'Goodies Delivered', value: (o.inventory && o.inventory.delivered) || 0 }
  ];
  el.innerHTML = cards.map((c) => `
    <div class="stat-card">
      <div class="value">${c.value}</div>
      <div class="label">${c.label}</div>
    </div>
  `).join('');
}

async function refreshDashboardStats() {
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
    // Cross-module ops rollup (host payments, transport, hotels, guest-relation
    // entities) — also fetched defensively so it can't break the core charts.
    try {
      const ops = await jget(`${API}/stats/ops-overview`);
      renderHostPay(ops);
      renderOpsCards(ops);
    } catch (e) {
      console.error('Ops overview stats unavailable', e);
    }
  } catch (e) {
    console.error('Failed to load stats dashboard', e);
  }
  if (!dashboardStarted) {
    dashboardStarted = true;
    setInterval(refreshDashboardStats, 30000);
  }
}

// --- Sidebar hide/expand toggle (state remembered across visits) ---
const SIDEBAR_HIDDEN_KEY = 'sinc_admin_sidebar_hidden';
const adminShell = document.getElementById('adminShell');
const sidebarToggleBtn = document.getElementById('sidebarToggle');
function applySidebarState() {
  if (!adminShell) return;
  let hidden = localStorage.getItem(SIDEBAR_HIDDEN_KEY);
  if (hidden === null) hidden = window.innerWidth < 860 ? '1' : '0'; // sensible default on small screens
  adminShell.classList.toggle('sidebar-hidden', hidden === '1');
}
if (sidebarToggleBtn) {
  sidebarToggleBtn.addEventListener('click', () => {
    const nowHidden = !adminShell.classList.contains('sidebar-hidden');
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, nowHidden ? '1' : '0');
    applySidebarState();
  });
}
applySidebarState();

// --- Tabs ---
// Pulled out of the click handler so other code (e.g. jumping to the Host
// Members tab to edit someone from inside the Committees tab) can switch
// tabs programmatically too, not just via a direct sidebar click.
function switchAdminTab(tab) {
  const btn = document.querySelector(`.admin-nav button[data-tab="${tab}"]`);
  const panel = document.getElementById('tab-' + tab);
  if (!btn || !panel) return;
  document.querySelectorAll('.admin-nav button').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  panel.classList.add('active');
  if (tab === 'settings') refreshUsersAdmin();
  if (tab === 'activitylog') { refreshActivityLog(); refreshScanActivity(); }
  // On phone/tablet widths the sidebar overlays the content, so tuck it away
  // again once a section has been picked (matches the standard mobile pattern).
  if (window.innerWidth < 860 && adminShell) {
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, '1');
    applySidebarState();
  }
}
document.getElementById('tabNav').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  switchAdminTab(btn.dataset.tab);
});

// --- Clubs ---
async function refreshClubs() {
  const clubs = await jget(`${API}/clubs`);
  document.getElementById('clubsTableBody').innerHTML = clubs.map((c) => `
    <tr>
      <td>${c.name}</td><td>${c.city || ''}</td><td>${c.state || ''}</td><td>${c.zone || ''}</td><td>${c.members_count}</td>
      <td><button class="btn small" onclick="downloadClubDetailPdf(${c.id})">PDF</button> ${canDelete() ? `<button class="btn danger small" onclick="deleteClub(${c.id})">Delete</button>` : ''}</td>
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
// Cached so the Delegates form's occupancy hint (which registration already
// has a primary registrant, how many delegates it already holds) can be
// recomputed without another round trip every time the dropdown changes.
let REGS_CACHE = [];
async function refreshRegs() {
  const regs = await jget(`${API}/registrations`);
  REGS_CACHE = regs;
  document.getElementById('regsTableBody').innerHTML = regs.map((r) => `
    <tr>
      <td>${r.reg_number}</td>
      <td><span class="pill ${r.reg_type}">${REG_TYPE_LABEL[r.reg_type] || r.reg_type}</span></td>
      <td>${r.club_name || '-'}</td>
      <td>₹${r.amount_paid}</td>
      <td>₹${r.amount_due}</td>
      <td><span class="pill ${r.payment_status}">${r.payment_status}</span></td>
      <td>${r.participant_count}</td>
      <td><button class="btn small" onclick="downloadReceiptPdf(${r.id})">Receipt</button> ${canDelete() ? `<button class="btn danger small" onclick="deleteReg(${r.id})">Delete</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="8" class="empty">No registrations yet</td></tr>';

  // Each option carries its occupancy in the visible text (so it's obvious
  // at a glance without opening the dropdown twice) and as data attributes
  // (so updatePartRegOccupancyHint() can react instantly on change without
  // re-fetching).
  const opts = regs.map((r) => {
    const max = r.reg_type === 'double' ? 2 : 1;
    const participants = r.participants || [];
    const filled = participants.length;
    const hasPrimary = participants.some((p) => Number(p.is_primary) === 1);
    return `<option value="${r.id}" data-reg-type="${r.reg_type}" data-filled="${filled}" data-max="${max}" data-has-primary="${hasPrimary}">${r.reg_number} (${r.club_name || '-'}) — ${REG_TYPE_LABEL[r.reg_type] || r.reg_type}, ${filled}/${max} filled</option>`;
  }).join('');
  document.getElementById('partRegSelect').innerHTML = '<option value="">-- none --</option>' + opts;
}

// Shows a live hint under the Registration field in the Add/Update Delegate
// form ("this is a Double registration, 1/2 filled, already has a primary")
// and, for a brand-new delegate, auto-suggests Primary vs. Co-registrant
// instead of leaving the admin to remember to flip it themselves — that
// forgetting is exactly how two unlinked "primary" rows happen in the first
// place. `skipAutoSetPrimary` is passed true when loading an existing
// delegate into the form for editing, since that delegate's own is_primary
// value is already correct and shouldn't be silently overwritten.
function updatePartRegOccupancyHint(skipAutoSetPrimary) {
  const sel = document.getElementById('partRegSelect');
  const hintEl = document.getElementById('partRegOccupancyHint');
  const primarySelect = document.getElementById('partIsPrimarySelect');
  if (!sel || !hintEl) return;
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) { hintEl.innerHTML = ''; return; }
  const filled = Number(opt.dataset.filled || 0);
  const max = Number(opt.dataset.max || 1);
  const hasPrimary = opt.dataset.hasPrimary === 'true';
  const typeLabel = REG_TYPE_LABEL[opt.dataset.regType] || opt.dataset.regType;
  if (filled >= max) {
    hintEl.innerHTML = `<strong style="color:var(--red);">This ${typeLabel} registration already has ${filled}/${max} delegate(s) linked — full.</strong> Pick a different registration, or edit one of its existing delegates instead.`;
  } else {
    hintEl.innerHTML = `${typeLabel} registration · ${filled}/${max} delegate(s) linked so far${hasPrimary ? ' · already has a primary registrant, so this one will be saved as the co-registrant' : ' · no primary registrant yet, so this one will be saved as primary'}.`;
  }
  if (!skipAutoSetPrimary && primarySelect) {
    primarySelect.value = hasPrimary ? '0' : '1';
  }
}
document.getElementById('partRegSelect').addEventListener('change', () => updatePartRegOccupancyHint(false));
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

// Sorts the delegate list client-side by whichever option is chosen in the
// "Sort by" dropdown. "Title" here means each delegate's designation
// (President / Secretary / Member / Spouse / ...), the label shown next to
// their name in the table.
function sortParts(rows, sortValue) {
  if (!sortValue) return rows;
  const collator = new Intl.Collator('en', { sensitivity: 'base' });
  const [field, dir] = sortValue.split('_');
  const getters = {
    title: (p) => p.designation || '',
    name: (p) => p.name || '',
    club: (p) => p.club_name || '',
  };
  const get = getters[field];
  if (!get) return rows;
  const sorted = [...rows].sort((a, b) => collator.compare(get(a), get(b)));
  return dir === 'desc' ? sorted.reverse() : sorted;
}

async function refreshParts(query) {
  const url = query ? `${API}/participants?q=${encodeURIComponent(query)}` : `${API}/participants`;
  let rows = await jget(url);
  const sortSelect = document.getElementById('partSortSelect');
  rows = sortParts(rows, sortSelect ? sortSelect.value : '');

  // Group every delegate by registration_id so each card can show who else
  // shares that registration — the primary registrant <-> co-registrant
  // link the congress team wants to keep track of. A registration only ever
  // holds 1 (single/congress_only) or 2 (double) delegates, so "siblings"
  // here is always the other delegate(s) on the same registration.
  const byReg = {};
  rows.forEach((p) => {
    if (!p.registration_id) return;
    (byReg[p.registration_id] = byReg[p.registration_id] || []).push(p);
  });

  document.getElementById('partsTableBody').innerHTML = rows.map((p) => {
    const isPrimary = Number(p.is_primary) === 1;
    const roleBadge = `<span class="pill ${isPrimary ? 'primary-reg' : 'co-reg'}">${isPrimary ? 'Primary' : 'Co-registrant'}</span>`;
    const header = `${p.name} ${roleBadge}${p.designation ? ' <span class="hint">(' + p.designation + ')</span>' : ''}`;
    const siblings = (byReg[p.registration_id] || []).filter((s) => s.id !== p.id);
    const linkedValue = siblings.length
      ? siblings.map((s) => `<a href="javascript:void(0)" onclick="highlightPartCard(${s.id})">${s.name}</a> <span class="hint">(${Number(s.is_primary) === 1 ? 'Primary' : 'Co-registrant'})</span>`).join('<br>')
      : '<span class="hint">— none, registered alone</span>';
    const fields = [
      { label: 'Registration ID', value: `<strong>${p.participant_code || '-'}</strong>` },
      { label: 'Reg #', value: p.reg_number || '-' },
      { label: 'Linked Registrant', value: linkedValue },
      { label: 'Phone', value: p.phone || '-' },
      { label: 'Travel In', value: p.travel_mode ? p.travel_mode + ' ' + (p.travel_number || '') + '<br><span class="hint">' + (p.travel_datetime || '') + '</span>' : '-' },
      { label: 'Pickup', value: (p.pickup_by || '-') + (p.pickup_vehicle ? '<br><span class="hint">' + p.pickup_vehicle + '</span>' : '') },
      { label: 'SPOC', value: spocDisplay(p) },
      { label: 'Payment', value: paymentPill(p.payment_status) },
      { label: 'Sizes', value: sizesLabel(p) },
      { label: 'Business profile', value: p.business_profile || '-' },
      { label: 'Food preference', value: p.dietary_preference || 'No preference' },
      { label: 'Drink preference', value: p.drink_preference || '-' },
      { label: 'Special requests', value: p.special_requests || '-' },
      { label: 'Pre-Tour', value: (() => {
        if (!p.pre_tour_id) return '-';
        const t = PRETOURS_LITE_CACHE.find((r) => r.id === p.pre_tour_id);
        return t ? t.name : `#${p.pre_tour_id}`;
      })() },
      { label: 'Photo', value: photoCell('participant', p) },
      { label: 'Card', value: cardCell('participant', p) },
      ...(CURRENT_USER && CURRENT_USER.role === 'super_admin' ? [{ label: 'Aadhaar', value: aadhaarCell(p) }, { label: 'Passport', value: passportCell(p) }] : []),
    ];
    const actions = `
      <button class="btn small" onclick="editPart(${p.id})">Update</button>
      <button class="btn small" onclick="openGoodiesModal('participant', ${p.id}, '${(p.name || '').replace(/'/g, "\\'")}')">Goodies</button>
      <button class="btn small" onclick="downloadDelegateDetailPdf(${p.id})">PDF</button>
      ${p.badge_token ? `<button class="btn small" onclick="downloadParticipantBadge(${p.id})">Badge</button>
      <button class="btn small" onclick="downloadQrPng('${p.badge_token}', '${(p.name || '').replace(/'/g, "\\'")}')">QR</button>` : ''}
      ${canDelete() ? `<button class="btn danger small" onclick="deletePart(${p.id})">Delete</button>` : ''}
    `;
    return renderRecordCard(header, p.club_name || '-', fields, actions, `part-card-${p.id}`);
  }).join('') || '<p class="empty">No delegates yet</p>';
}
window.deletePart = async (id) => { await jdel(`${API}/participants/${id}`); toast('Delegate deleted'); refreshParts(); };

// Jumps to and briefly highlights a delegate's own card — used by the
// "Linked Registrant" reference on their paired primary/co-registrant's
// card, so switching between the two halves of a double registration is a
// single click instead of scanning the whole list.
window.highlightPartCard = (id) => {
  const el = document.getElementById(`part-card-${id}`);
  if (!el) {
    toast('That delegate is outside the current search/filter — clear the search box to find them.');
    return;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('linked-highlight');
  void el.offsetWidth; // force reflow so the animation restarts on repeat clicks
  el.classList.add('linked-highlight');
};

const PART_FORM_FIELDS = [
  'name', 'phone', 'whatsapp', 'email', 'address', 'club_id', 'registration_id', 'designation', 'is_primary',
  'business_profile', 'dietary_preference', 'special_requests',
  'travel_mode', 'travel_number', 'travel_datetime', 'arrival_point',
  'departure_mode', 'departure_number', 'departure_datetime', 'departure_point',
  'pickup_by', 'pickup_vehicle', 'pickup_phone', 'spoc_name', 'spoc_phone', 'notes',
  'shirt_size', 'tshirt_size', 'waist_size'
  // drink_preference (checkbox group) and pretour_choice (separate
  // pre_tour_participants row) are handled manually below — see editPart's
  // drink-checkbox/pretour-select prefill and savePartForm's collection of
  // both right before the save request.
];

// Same drink-preference mutual-exclusivity as the Delegate's own My Travel
// Details self-fill page (public/js/mytravel.js) — "No Alcohol" clears every
// other checkbox and vice versa. Kept as its own small helper here since
// admin.js and mytravel.js are separate files/pages with no shared module.
function wirePartDrinkPrefExclusivity() {
  const form = document.getElementById('partForm');
  if (!form) return;
  const boxes = Array.from(form.querySelectorAll('.drinkPrefBox'));
  const noAlcohol = form.querySelector('.noAlcoholBox');
  boxes.forEach((box) => {
    box.addEventListener('change', () => {
      if (box === noAlcohol && box.checked) {
        boxes.forEach((b) => { if (b !== noAlcohol) b.checked = false; });
      } else if (box !== noAlcohol && box.checked && noAlcohol) {
        noAlcohol.checked = false;
      }
    });
  });
}
wirePartDrinkPrefExclusivity();

// Pre-Tours list for the Delegates form's Pre-Tour select — mirrors the
// public my-travel.html page's own fetch (there via /api/public/pretours,
// here via the admin-only /api/pretours since the admin is already
// authenticated). Seat counts are shown so an admin can see at a glance
// whether a tour still has room, same reasoning as the public page (pre-tours
// are limited-seat and first-come-first-served) — though unlike the public
// self-service signup, an admin CAN still pick a full tour here (deliberate
// override), so full options aren't disabled, just labeled.
let PRETOURS_LITE_CACHE = [];
async function refreshPartPretourOptions() {
  try {
    const rows = await jget(`${API}/pretours`);
    PRETOURS_LITE_CACHE = rows;
    const sel = document.getElementById('partPretourSelect');
    if (!sel) return;
    const opts = rows.map((t) => {
      const full = t.capacity !== null && t.capacity !== undefined && Number(t.participant_count) >= Number(t.capacity);
      const seats = (t.capacity !== null && t.capacity !== undefined) ? `${t.participant_count}/${t.capacity}` : `${t.participant_count}`;
      return `<option value="${t.id}">${t.name} (${seats} seats)${full ? ' — FULL' : ''}</option>`;
    }).join('');
    sel.innerHTML = '<option value="">-- none --</option>' + opts;
  } catch (err) { /* Pre Tours tab not reachable / no tours yet — leave "-- none --" */ }
}

// Core identity/registration fields — frozen for everyone except super_admin
// once a delegate already exists (mirrors the server-side check in
// PUT /api/participants/:id). New-delegate creation is never restricted.
const PART_FROZEN_FIELDS = ['name', 'phone', 'club_id', 'registration_id'];

// Loads an existing delegate into the Add Delegate form and switches
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
  const drinks = (p.drink_preference || '').split(',').map((s) => s.trim()).filter(Boolean);
  form.querySelectorAll('.drinkPrefBox').forEach((box) => { box.checked = drinks.includes(box.value); });
  if (form.elements.pretour_choice) form.elements.pretour_choice.value = p.pre_tour_id ? String(p.pre_tour_id) : '';
  form.dataset.editId = id;
  // Name, phone, club, and registration are frozen once a delegate exists —
  // only a super admin can change them (server-side enforced too, see
  // PUT /api/participants/:id). Everyone else can still freely edit travel,
  // pickup/SPOC, notes, etc.
  const isSuperAdmin = !!(CURRENT_USER && CURRENT_USER.role === 'super_admin');
  PART_FROZEN_FIELDS.forEach((f) => {
    const el = form.elements[f];
    if (el) el.disabled = !isSuperAdmin;
  });
  const frozenHint = document.getElementById('partFrozenHint');
  if (frozenHint) frozenHint.style.display = isSuperAdmin ? 'none' : '';
  document.getElementById('partFormTitle').textContent = `Update delegate — ${p.participant_code || p.name}`;
  document.getElementById('partSubmitBtn').textContent = 'Update Delegate';
  document.getElementById('partCancelEditBtn').style.display = '';
  // Show the occupancy hint for whichever registration this delegate is
  // already on, but don't let it silently flip is_primary — that value is
  // already correct for an existing delegate.
  updatePartRegOccupancyHint(true);
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.cancelEditPart = () => {
  const form = document.getElementById('partForm');
  form.reset();
  delete form.dataset.editId;
  const occupancyHint = document.getElementById('partRegOccupancyHint');
  if (occupancyHint) occupancyHint.innerHTML = '';
  // Adding a brand-new delegate is never restricted — re-enable the frozen
  // fields in case the form was left disabled from a previous edit.
  PART_FROZEN_FIELDS.forEach((f) => {
    const el = form.elements[f];
    if (el) el.disabled = false;
  });
  const frozenHint = document.getElementById('partFrozenHint');
  if (frozenHint) frozenHint.style.display = 'none';
  document.getElementById('partFormTitle').textContent = 'Add delegate';
  document.getElementById('partSubmitBtn').textContent = 'Save Delegate';
  document.getElementById('partCancelEditBtn').style.display = 'none';
};

async function savePartForm(form, force) {
  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());
  // spoc_host_member_id isn't a participants column — it's saved separately
  // as a delegate_assignments row (role='SPOC') via /api/assignments/spoc/:id.
  const spocHostMemberId = body.spoc_host_member_id || '';
  delete body.spoc_host_member_id;
  // Drink preference is collected manually from the checkbox group (no
  // `name` attribute on the checkboxes, so FormData doesn't touch them —
  // see wirePartDrinkPrefExclusivity's comment). Pre-tour signup is a
  // separate table (pre_tour_participants), saved via its own request below.
  const checkedDrinks = Array.from(form.querySelectorAll('.drinkPrefBox:checked')).map((b) => b.value);
  body.drink_preference = checkedDrinks.join(', ');
  const pretourChoice = body.pretour_choice || '';
  delete body.pretour_choice;
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
      toast('Delegate updated');
    } else {
      const res = await jpost(`${API}/participants`, body);
      participantId = res.id;
      toast(`Delegate saved${res.participant_code ? ' — Registration ID ' + res.participant_code : ''}`);
    }
    if (participantId) {
      try {
        await jput(`${API}/assignments/spoc/${participantId}`, { host_member_id: spocHostMemberId || null });
      } catch (spocErr) {
        toast('Delegate saved, but SPOC link failed: ' + spocErr.message);
      }
      try {
        await jput(`${API}/participants/${participantId}/pretour`, { pre_tour_id: pretourChoice || null });
        refreshPartPretourOptions(); // seat counts changed
      } catch (ptErr) {
        toast('Delegate saved, but Pre-Tour signup failed: ' + ptErr.message);
      }
    }
    if (editId) {
      window.cancelEditPart();
    } else {
      form.reset();
      const occupancyHint = document.getElementById('partRegOccupancyHint');
      if (occupancyHint) occupancyHint.innerHTML = '';
    }
    if (body.arrival_point) ensureTransportPoint(body.arrival_point);
    if (body.departure_point) ensureTransportPoint(body.departure_point);
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
    let msg = `Imported ${res.imported} delegates`;
    if (res.skipped) msg += `, skipped ${res.skipped} likely duplicates`;
    toast(msg);
    e.target.reset();
    refreshParts();
  } catch (err) { toast(err.message); }
});
document.getElementById('partSortSelect').addEventListener('change', () => {
  refreshParts(document.getElementById('partSearch').value);
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
  const documents = await jget(`${API}/media?type=document`);
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
  document.getElementById('documentList').innerHTML = documents.map((m) => `
    <tr>
      <td>${m.title || '-'}</td>
      <td><a href="${API}/media/${m.id}/download" target="_blank" rel="noopener">${m.original_name || 'View / download'}</a></td>
      <td>${m.active ? 'Yes' : 'No'}</td>
      <td>
        <button class="btn ${m.active ? 'outline' : 'gold'} small" onclick="toggleMedia(${m.id}, ${m.active ? 0 : 1})">${m.active ? 'Hide' : 'Show'}</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteMedia(${m.id})">Del</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="empty">None uploaded yet</td></tr>';
}
window.toggleMedia = async (id, active) => { await jput(`${API}/media/${id}`, { active }); refreshMediaAdmin(); };
window.deleteMedia = async (id) => { await jdel(`${API}/media/${id}`); toast('Media removed'); refreshMediaAdmin(); };

// PDFs/documents aren't video/image, so the file picker's accept filter has
// to switch when Type changes — otherwise the browser hides .pdf files from
// the picker when it's still set to "video/*,image/*".
document.getElementById('mediaTypeSelect').addEventListener('change', (e) => {
  const fileInput = document.getElementById('mediaFileInput');
  fileInput.setAttribute('accept', e.target.value === 'document' ? 'application/pdf' : 'video/*,image/*');
});

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
        <button class="btn small" onclick="editItin(${it.id})">Update</button>
        <button class="btn small" onclick="manageAgenda(${it.id})">Agenda</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteItin(${it.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">No itinerary items yet</td></tr>';
  refreshAgendaSlots();
}
window.deleteItin = async (id) => { await jdel(`${API}/itinerary/${id}`); toast('Itinerary item deleted'); refreshItinerary(); };

window.editItin = async (id) => {
  const it = await jget(`${API}/itinerary/${id}`);
  const form = document.getElementById('itinForm');
  ['day_label', 'time_label', 'title', 'description', 'sort_order'].forEach((f) => {
    if (form.elements[f]) form.elements[f].value = it[f] !== null && it[f] !== undefined ? it[f] : '';
  });
  form.dataset.editId = id;
  document.getElementById('itinFormTitle').textContent = 'Update itinerary item';
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

// --- Agenda Builder (event management within an Itinerary slot) ----------
// One itinerary slot (e.g. "Inaugural Ceremony") contains an ordered flow of
// individual events (Prayer Song, National Anthem, dance performances...),
// each with a description, who organised it (committee + free-text detail),
// and who's performing (a hired performer group + free-text detail) — kept
// admin-only, distinct from the public-facing itinerary_items above.
let ALL_ITINERARY_CACHE = [];
let ALL_PERFORMER_GROUPS_CACHE = [];

function itinerarySlotLabel(it) {
  return [it.day_label, it.time_label, it.title].filter(Boolean).join(' · ');
}

async function refreshAgendaSlots() {
  ALL_ITINERARY_CACHE = await jget(`${API}/itinerary`);
  const sel = document.getElementById('agendaSlotSelect');
  const prevValue = sel.value;
  sel.innerHTML = '<option value="">-- select an itinerary slot --</option>' +
    ALL_ITINERARY_CACHE.map((it) => `<option value="${it.id}">${itinerarySlotLabel(it)}</option>`).join('');
  if (prevValue && ALL_ITINERARY_CACHE.some((it) => String(it.id) === prevValue)) {
    sel.value = prevValue;
  }
}
window.manageAgenda = (itineraryItemId) => {
  switchAdminTab('itinerary');
  const sel = document.getElementById('agendaSlotSelect');
  sel.value = itineraryItemId;
  sel.dispatchEvent(new Event('change'));
  document.getElementById('agendaFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

async function refreshAgenda() {
  const slotId = document.getElementById('agendaSlotSelect').value;
  const formCard = document.getElementById('agendaFormCard');
  const tableCard = document.getElementById('agendaTableCard');
  if (!slotId) {
    formCard.style.display = 'none';
    tableCard.style.display = 'none';
    return;
  }
  formCard.style.display = '';
  tableCard.style.display = '';
  const rows = await jget(`${API}/agenda?itinerary_item_id=${slotId}`);
  document.getElementById('agendaTableBody').innerHTML = rows.map((a) => `
    <tr>
      <td>${a.time_label || '-'}</td>
      <td><strong>${a.title}</strong>${a.duration_minutes ? ' <span class="hint">(' + a.duration_minutes + ' min)</span>' : ''}</td>
      <td style="white-space:normal;max-width:220px;">${a.description || '-'}</td>
      <td>${[a.organizing_committee_name, a.organized_by].filter(Boolean).join(' · ') || '-'}</td>
      <td>${[a.performer_group_name, a.performed_by].filter(Boolean).join(' · ') || '-'}</td>
      <td class="sticky-actions">
        <button class="btn small" onclick="editAgendaEvent(${a.id})">Update</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteAgendaEvent(${a.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty">No agenda events yet for this slot</td></tr>';
}
document.getElementById('agendaSlotSelect').addEventListener('change', refreshAgenda);

window.deleteAgendaEvent = async (id) => { await jdel(`${API}/agenda/${id}`); toast('Agenda event removed'); refreshAgenda(); };

const AGENDA_FORM_FIELDS = [
  'time_label', 'title', 'description', 'organizing_committee_id', 'organized_by',
  'performer_group_id', 'performed_by', 'duration_minutes', 'sort_order', 'notes'
];
window.editAgendaEvent = async (id) => {
  const a = await jget(`${API}/agenda/${id}`);
  const form = document.getElementById('agendaForm');
  AGENDA_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = a[f] !== null && a[f] !== undefined ? a[f] : ''; });
  form.dataset.editId = id;
  document.getElementById('agendaFormTitle').textContent = `Update agenda event — ${a.title}`;
  document.getElementById('agendaSubmitBtn').textContent = 'Update Event';
  document.getElementById('agendaCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('agendaCancelEditBtn').addEventListener('click', () => {
  const form = document.getElementById('agendaForm');
  form.reset(); delete form.dataset.editId;
  document.getElementById('agendaFormTitle').textContent = 'Add agenda event';
  document.getElementById('agendaSubmitBtn').textContent = 'Save Event';
  document.getElementById('agendaCancelEditBtn').style.display = 'none';
});
document.getElementById('agendaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const slotId = document.getElementById('agendaSlotSelect').value;
  if (!slotId) { toast('Select an itinerary slot first'); return; }
  const body = Object.fromEntries(new FormData(form).entries());
  body.itinerary_item_id = slotId;
  try {
    if (form.dataset.editId) {
      await jput(`${API}/agenda/${form.dataset.editId}`, body);
      delete form.dataset.editId;
      form.reset();
      document.getElementById('agendaFormTitle').textContent = 'Add agenda event';
      document.getElementById('agendaSubmitBtn').textContent = 'Save Event';
      document.getElementById('agendaCancelEditBtn').style.display = 'none';
      toast('Agenda event updated');
    } else {
      await jpost(`${API}/agenda`, body);
      form.reset();
      toast('Agenda event saved');
    }
    refreshAgenda();
  } catch (err) { toast(err.message); }
});

// --- Performer / Vendor Groups (hired to perform in the program) ---------
async function refreshPerformerGroups() {
  ALL_PERFORMER_GROUPS_CACHE = await jget(`${API}/performer-groups`);
  document.getElementById('performerTableBody').innerHTML = ALL_PERFORMER_GROUPS_CACHE.map((p) => `
    <tr>
      <td><strong>${p.name}</strong></td>
      <td>${p.category || '-'}</td>
      <td>${p.contact_person || '-'}${p.phone ? ' <span class="hint">' + p.phone + '</span>' : ''}</td>
      <td>${Number(p.fee_amount || 0).toLocaleString('en-IN')}</td>
      <td><span class="pill ${p.payment_status}">${p.payment_status === 'paid' ? 'Paid' : 'Pending'}</span></td>
      <td>${p.agenda_event_count || 0}</td>
      <td class="sticky-actions">
        <button class="btn small" onclick="editPerformerGroup(${p.id})">Update</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deletePerformerGroup(${p.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty">No performer/vendor groups yet</td></tr>';

  const opts = ALL_PERFORMER_GROUPS_CACHE.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  const sel = document.getElementById('agendaPerformerSelect');
  if (sel) sel.innerHTML = '<option value="">-- none --</option>' + opts;
}
window.deletePerformerGroup = async (id) => { await jdel(`${API}/performer-groups/${id}`); toast('Performer group removed'); refreshPerformerGroups(); refreshAgenda(); };

const PERFORMER_FORM_FIELDS = ['name', 'category', 'contact_person', 'phone', 'email', 'fee_amount', 'payment_status', 'payment_mode', 'payment_date', 'notes'];
window.editPerformerGroup = async (id) => {
  const rows = await jget(`${API}/performer-groups`);
  const p = rows.find((r) => r.id === id);
  if (!p) return;
  const form = document.getElementById('performerForm');
  PERFORMER_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = p[f] !== null && p[f] !== undefined ? p[f] : ''; });
  form.dataset.editId = id;
  document.getElementById('performerFormTitle').textContent = `Update performer / vendor group — ${p.name}`;
  document.getElementById('performerSubmitBtn').textContent = 'Update Group';
  document.getElementById('performerCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('performerCancelEditBtn').addEventListener('click', () => {
  const form = document.getElementById('performerForm');
  form.reset(); delete form.dataset.editId;
  document.getElementById('performerFormTitle').textContent = 'Add performer / vendor group';
  document.getElementById('performerSubmitBtn').textContent = 'Save Group';
  document.getElementById('performerCancelEditBtn').style.display = 'none';
});
document.getElementById('performerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.editId) {
      await jput(`${API}/performer-groups/${form.dataset.editId}`, body);
      delete form.dataset.editId;
      form.reset();
      document.getElementById('performerFormTitle').textContent = 'Add performer / vendor group';
      document.getElementById('performerSubmitBtn').textContent = 'Save Group';
      document.getElementById('performerCancelEditBtn').style.display = 'none';
      toast('Performer group updated');
    } else {
      await jpost(`${API}/performer-groups`, body);
      form.reset();
      toast('Performer group saved');
    }
    refreshPerformerGroups();
    refreshAgenda();
  } catch (err) { toast(err.message); }
});

// --- Agenda / Performer Groups PDFs ---------------------------------------
window.downloadAgendaPdf = async () => {
  try {
    const slotId = document.getElementById('agendaSlotSelect').value;
    if (!slotId) { toast('Select an itinerary slot first'); return; }
    const slot = ALL_ITINERARY_CACHE.find((it) => String(it.id) === String(slotId));
    if (!slot) { toast('Itinerary slot not found'); return; }
    const rows = await jget(`${API}/agenda?itinerary_item_id=${slotId}`);
    const doc = pdfDoc();
    let y = await pdfLetterhead(doc, `Agenda — ${slot.title}`, itinerarySlotLabel(slot));
    y = pdfTable(doc, y, [
      { label: 'Time', width: 55 },
      { label: 'Event', width: 110 },
      { label: 'Description', width: 145 },
      { label: 'Organized By', width: 95 },
      { label: 'Performed By', width: 95 },
    ], rows.map((a) => [
      a.time_label || '-',
      a.title + (a.duration_minutes ? ` (${a.duration_minutes} min)` : ''),
      a.description || '-',
      [a.organizing_committee_name, a.organized_by].filter(Boolean).join(' · ') || '-',
      [a.performer_group_name, a.performed_by].filter(Boolean).join(' · ') || '-',
    ]));
    pdfFinalize(doc);
    doc.save(`agenda-${slot.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`);
  } catch (err) { toast(err.message); }
};
window.downloadPerformerGroupsListPdf = async () => {
  try {
    const rows = await jget(`${API}/performer-groups`);
    await downloadListReportPdf('Performer / Vendor Groups', `${rows.length} group(s)`, [
      { label: 'Name', width: 140, get: (r) => r.name },
      { label: 'Category', width: 90, get: (r) => r.category },
      { label: 'Contact', width: 100, get: (r) => r.contact_person },
      { label: 'Phone', width: 80, get: (r) => r.phone },
      { label: 'Fee (₹)', width: 70, get: (r) => Number(r.fee_amount || 0).toLocaleString('en-IN'), align: 'right' },
      { label: 'Payment', width: 55, get: (r) => r.payment_status },
    ], rows, 'performer-groups.pdf');
  } catch (err) { toast(err.message); }
};

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
    const header = `${h.name}${h.designation ? ' <span class="hint">(' + h.designation + ')</span>' : ''}`;
    const fields = [
      { label: 'Phone', value: h.phone || '-' },
      { label: 'Leadership Role', value: h.leadership_role ? `<span class="pill paid">${h.leadership_role}</span>` : '-' },
      { label: 'Committees', value: `<span title="${committeeNames.join(', ')}">${committeesLabel}</span>` },
      { label: 'Payment', value: `<span class="pill ${h.payment_status}">${h.payment_status}</span> <span class="hint">₹${h.payment_amount}</span>` },
      { label: 'Sizes', value: sizesLabel(h) },
      { label: 'Photo', value: photoCell('host_member', h) },
      { label: 'Card', value: cardCell('host_member', h) },
      { label: 'Login', value: h.user_id ? '<span class="pill paid">has login</span>' : `<button class="btn small" onclick="createHostLogin(${h.id}, '${(h.name || '').replace(/'/g, '')}')">Create login</button>` },
    ];
    const actions = `
      <button class="btn small" onclick="editHm(${h.id})">Update</button>
      <button class="btn small" onclick="openGoodiesModal('host_member', ${h.id}, '${(h.name || '').replace(/'/g, "\\'")}')">Goodies</button>
      <button class="btn small" onclick="downloadHostMemberDetailPdf(${h.id})">PDF</button>
      <button class="btn small" onclick="downloadHostMemberReceiptPdf(${h.id})">Receipt</button>
      ${h.badge_token ? `<button class="btn small" onclick="downloadHostMemberBadge(${h.id})">Badge</button>
      <button class="btn small" onclick="downloadQrPng('${h.badge_token}', '${(h.name || '').replace(/'/g, "'")}')">QR</button>` : ''}
      ${canDelete() ? `<button class="btn danger small" onclick="deleteHm(${h.id})">Delete</button>` : ''}
    `;
    return renderRecordCard(header, h.company || '-', fields, actions);
  }).join('') || '<p class="empty">No host members yet</p>';

  // Keep every other tab's host-member dropdowns in sync with the latest list.
  const opts = rows.map((h) => `<option value="${h.id}">${h.name}${h.company ? ' (' + h.company + ')' : ''}</option>`).join('');
  ['committeeHmSelect', 'assignHmSelect', 'taskHmSelect', 'createUserHmSelect', 'partSpocHmSelect', 'tripPassengerHmSelect', 'tourPartHmSelect', 'roomHmSelect', 'sponsorHmSelect', 'speakerHmSelect', 'gvHmSelect'].forEach((id) => {
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
    toast(`Login created for ${name}. Share the username/password with them — they log in at login.html.`, 6000);
    refreshHostMembers();
  } catch (err) { toast(err.message); }
};

const HM_FORM_FIELDS = ['name', 'phone', 'email', 'company', 'designation', 'category', 'payment_status', 'payment_amount', 'payment_mode', 'payment_date', 'notes', 'leadership_role', 'shirt_size', 'tshirt_size', 'waist_size'];
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
      <td class="sticky-actions">
        <button class="btn small" onclick="saveHostPayment(${h.id})">Save</button>
        <button class="btn small" onclick="downloadHostMemberReceiptPdf(${h.id})">Receipt</button>
      </td>
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
let MODULE_KEYS_CACHE = null; // lazy-loaded catalog of the 12 assignable modules

async function moduleKeysCache() {
  if (!MODULE_KEYS_CACHE) MODULE_KEYS_CACHE = await jget(`${API}/committees/module-keys`);
  return MODULE_KEYS_CACHE;
}

// Keeps every "which committee is responsible for this?" dropdown in sync
// with the committee list — used by checklist templates and, per-item, by
// the checklist modal (see committeeSelectOptions()).
function populateCommitteeSelects() {
  const opts = ALL_COMMITTEES_CACHE.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  ['checklistTemplateCommitteeSelect', 'bulkAssignCommitteeSelect', 'agendaCommitteeSelect'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = '<option value="">Unassigned</option>' + opts;
    if (cur) el.value = cur;
  });
  if (typeof populateMsgCommitteeSelect === 'function') populateMsgCommitteeSelect();
}

async function refreshCommittees() {
  const rows = await jget(`${API}/committees`);
  ALL_COMMITTEES_CACHE = rows;
  populateCommitteeSelects();
  document.getElementById('committeesList').innerHTML = rows.map((c) => `
    <div class="card" style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
        <strong>${c.name}</strong>
        <div>
          <button class="btn small" onclick="editCommittee(${c.id})">Edit</button>
          <button class="btn small" onclick="downloadCommitteeDetailPdf(${c.id})">PDF</button>
          <button class="btn small" onclick="toggleCommitteeModules(${c.id})">Modules (${(c.module_access || []).length})</button>
          <button class="btn small" onclick="toggleCommitteeTasks(${c.id})">Checklist &amp; Milestones (${c.tasks_completed || 0}/${c.task_count || 0})</button>
          <button class="btn small" onclick="toggleCommitteeChecklist(${c.id})">Committee Checklist (${c.checklist_item_count || 0})</button>
          ${canDelete() ? `<button class="btn danger small" onclick="deleteCommittee(${c.id})">Delete</button>` : ''}
        </div>
      </div>
      ${c.description ? `<p class="hint" style="margin:6px 0 0;white-space:pre-wrap;">${c.description}</p>` : ''}
      <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
        ${(c.members || []).map((m) => `
          <span class="pill ${m.is_lead ? 'lead' : 'single'}" style="display:inline-flex;align-items:center;gap:6px;" title="${m.is_lead ? 'Committee lead — delegates tasks and verifies completions' : 'Click the star to make this person the committee lead'}">
            ${m.is_lead ? '★' : `<a href="#" onclick="makeCommitteeLead(${c.id}, ${m.id});return false;" style="color:inherit;">☆</a>`}
            ${m.name}
            <a href="#" onclick="editCommitteeMemberDetails(${m.id});return false;" style="color:inherit;" title="Update this host member's details">✎</a>
            ${canDelete() ? ` <a href="#" onclick="removeCommitteeMember(${c.id}, ${m.id});return false;" style="color:inherit;">✕</a>` : ''}
          </span>
        `).join('') || '<span class="hint">No members assigned yet</span>'}
      </div>
      <div id="committeeModulesPanel-${c.id}" style="display:none;margin-top:12px;border-top:1px solid var(--line);padding-top:12px;"></div>
      <div id="committeeTasksPanel-${c.id}" style="display:none;margin-top:12px;border-top:1px solid var(--line);padding-top:12px;"></div>
      <div id="committeeChecklistPanel-${c.id}" style="display:none;margin-top:12px;border-top:1px solid var(--line);padding-top:12px;"></div>
    </div>
  `).join('') || '<div class="empty">No committees yet</div>';

  const opts = rows.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  document.getElementById('committeeSelect').innerHTML = opts;

  // Re-render innerHTML wipes any open panels — reopen whichever ones were
  // open before this refresh so admin actions inside them (add/delete/
  // toggle/save) don't visibly close the panel each time.
  for (const id of openCommitteeTaskPanels) {
    const panel = document.getElementById(`committeeTasksPanel-${id}`);
    if (panel) { panel.style.display = ''; renderCommitteeTasksPanel(id); }
  }
  for (const id of openCommitteeModulePanels) {
    const panel = document.getElementById(`committeeModulesPanel-${id}`);
    if (panel) { panel.style.display = ''; renderCommitteeModulesPanel(id); }
  }
  for (const id of openCommitteeChecklistPanels) {
    const panel = document.getElementById(`committeeChecklistPanel-${id}`);
    if (panel) { panel.style.display = ''; renderCommitteeChecklistPanel(id); }
  }
}
let openCommitteeTaskPanels = new Set();
let openCommitteeModulePanels = new Set();
let openCommitteeChecklistPanels = new Set();

window.makeCommitteeLead = async (committeeId, hostMemberId) => {
  try {
    await jput(`${API}/committees/${committeeId}/members/${hostMemberId}/lead`, { is_lead: true });
    toast('Committee lead updated');
    refreshCommittees();
  } catch (err) { toast(err.message); }
};

// Edit a committee member's own details (name/phone/email/company/etc.)
// right from the Committees tab, instead of having to go find them in the
// Host Members tab first — jumps over there and reuses that tab's existing
// edit form (same validation, same PUT /hostmembers/:id, no duplicated logic).
window.editCommitteeMemberDetails = (hostMemberId) => {
  switchAdminTab('hostmembers');
  editHm(hostMemberId);
};

window.toggleCommitteeModules = async (committeeId) => {
  const panel = document.getElementById(`committeeModulesPanel-${committeeId}`);
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  if (isOpen) {
    panel.style.display = 'none';
    openCommitteeModulePanels.delete(committeeId);
  } else {
    panel.style.display = '';
    openCommitteeModulePanels.add(committeeId);
    await renderCommitteeModulesPanel(committeeId);
  }
};

// Lets an admin grant this committee's members direct access to specific
// operational modules from their own host portal (server/routes/
// committeeModuleAccess.js) — a checkbox list saved all at once.
async function renderCommitteeModulesPanel(committeeId) {
  const panel = document.getElementById(`committeeModulesPanel-${committeeId}`);
  if (!panel) return;
  const c = ALL_COMMITTEES_CACHE.find((x) => x.id === committeeId);
  const keys = await moduleKeysCache();
  const granted = new Set(c?.module_access || []);
  panel.innerHTML = `
    <p class="hint" style="margin:0 0 8px;">Members of this committee can manage these modules directly from their own host portal, without going through an admin. Deletes always stay admin-only, regardless of what's granted here.</p>
    <form onsubmit="return submitCommitteeModules(event, ${committeeId})">
      <div class="module-checkbox-grid">
        ${keys.map((k) => `
          <label><input type="checkbox" value="${k.key}" ${granted.has(k.key) ? 'checked' : ''} /> ${k.label}</label>
        `).join('')}
      </div>
      <button class="btn gold small" type="submit">Save module access</button>
    </form>
  `;
}
window.submitCommitteeModules = async (e, committeeId) => {
  e.preventDefault();
  const module_keys = Array.from(e.target.querySelectorAll('input[type=checkbox]:checked')).map((el) => el.value);
  try {
    await jput(`${API}/committees/${committeeId}/modules`, { module_keys });
    toast('Module access saved');
    openCommitteeModulePanels.add(committeeId);
    refreshCommittees();
  } catch (err) { toast(err.message); }
  return false;
};

window.toggleCommitteeTasks = async (committeeId) => {
  const panel = document.getElementById(`committeeTasksPanel-${committeeId}`);
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  if (isOpen) {
    panel.style.display = 'none';
    openCommitteeTaskPanels.delete(committeeId);
  } else {
    panel.style.display = '';
    openCommitteeTaskPanels.add(committeeId);
    await renderCommitteeTasksPanel(committeeId);
  }
};

async function renderCommitteeTasksPanel(committeeId) {
  const panel = document.getElementById(`committeeTasksPanel-${committeeId}`);
  if (!panel) return;
  // This panel is this committee's OWN internal tasks/milestones (tracked
  // per-member below). Checklist items DELEGATED to this committee from
  // Sponsors/Speakers/Guest Visitors/Delegates/Host Members — i.e. what it
  // needs to actually deliver — live in their own dedicated "Committee
  // Delivery" tab (cross-committee follow-up, filtering, reassignment),
  // not duplicated here.
  const tasks = await jget(`${API}/committees/${committeeId}/tasks`);
  const c = ALL_COMMITTEES_CACHE.find((x) => x.id === committeeId);
  const memberOpts = (c?.members || []).map((m) => `<option value="${m.id}">${m.name}</option>`).join('');
  panel.innerHTML = `
    <p class="hint" style="margin:0 0 12px;">Looking for what this committee needs to deliver (checklist items assigned to it from Sponsors/Speakers/Guest Visitors/Delegates/Host Members)? See the <strong>Committee Delivery</strong> tab.</p>
    <form onsubmit="return submitCommitteeTask(event, ${committeeId})" style="margin:10px 0;">
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
          ${memberOpts}
        </select>
      </div>
      <div class="field"><label>Description</label><textarea name="description"></textarea></div>
      <button class="btn gold small" type="submit">Add checklist item / milestone</button>
    </form>
    ${tasks.map((t) => {
      const total = Number(t.total_members) || 0;
      const done = Number(t.done_count) || 0;
      const verified = Number(t.verified_count) || 0;
      const allVerified = total > 0 && verified === total;
      const statusClass = (m) => m.status === 'verified' ? 'verified' : (m.status === 'done' ? 'done' : 'not_started');
      const statusIcon = (m) => m.status === 'verified' ? '✓✓' : (m.status === 'done' ? '✓' : '');
      return `
        <div style="padding:8px 0;border-bottom:1px solid var(--line);">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <div>
              ${Number(t.is_milestone) ? '<span class="pill double">Milestone</span> ' : ''}
              ${t.assigned_to_name ? `<span class="pill single">Assigned: ${t.assigned_to_name}</span> ` : ''}
              <strong>${t.title}</strong>
              ${t.due_date ? ` <span class="hint">due ${t.due_date}</span>` : ''}
              ${t.description ? `<br><span class="hint">${t.description}</span>` : ''}
            </div>
            <div style="text-align:right;white-space:nowrap;">
              <span class="pill ${allVerified ? 'verified' : 'in_progress'}">${verified}/${total} verified</span>
              ${canDelete() ? `<button class="btn danger small" onclick="deleteCommitteeTask(${t.id}, ${committeeId})">Delete</button>` : ''}
            </div>
          </div>
          <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;">
            ${(t.members || []).map((m) => `
              <span class="pill ${statusClass(m)}" style="cursor:pointer;" title="Click to cycle pending → done → verified (admin override)" onclick="toggleCommitteeMemberCompletion(${m.completion_id}, '${m.status}', ${committeeId})">
                ${m.name} ${statusIcon(m)}
              </span>
            `).join('')}
          </div>
        </div>
      `;
    }).join('') || '<p class="hint">No checklist items or milestones yet.</p>'}
  `;
}
window.submitCommitteeTask = async (e, committeeId) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  if (!body.assigned_to_host_member_id) delete body.assigned_to_host_member_id;
  try {
    await jpost(`${API}/committees/${committeeId}/tasks`, body);
    e.target.reset();
    toast('Checklist item added');
    openCommitteeTaskPanels.add(committeeId);
    refreshCommittees();
  } catch (err) { toast(err.message); }
  return false;
};
window.deleteCommitteeTask = async (taskId, committeeId) => {
  await jdel(`${API}/committees/tasks/${taskId}`);
  toast('Removed');
  refreshCommittees();
};
// Admin override: cycles a member's completion pending -> done -> verified
// -> pending, same three states the committee lead works through from their
// own portal (see host.html's committee-tasks + verify actions).
window.toggleCommitteeMemberCompletion = async (completionId, currentStatus, committeeId) => {
  const next = currentStatus === 'pending' ? 'done' : (currentStatus === 'done' ? 'verified' : 'pending');
  try {
    await jput(`${API}/committees/tasks/completions/${completionId}`, { status: next });
    refreshCommittees();
  } catch (err) { toast(err.message); }
};
// --- Volunteers (external / non-club-member data-entry helpers — distinct
// from Host Members, which are paying Skål club members). Modules are
// granted directly per volunteer, no committee membership required. Reuses
// the same MODULE_KEYS catalog + moduleKeysCache() as Committees above.
let ALL_VOLUNTEERS_CACHE = [];

async function refreshVolunteers() {
  const rows = await jget(`${API}/volunteers`);
  ALL_VOLUNTEERS_CACHE = rows;
  document.getElementById('volTableBody').innerHTML = rows.map((v) => {
    const fields = [
      { label: 'Phone', value: v.phone || '-' },
      { label: 'Sizes', value: sizesLabel(v) },
      { label: 'Photo', value: photoCell('volunteer', v) },
      { label: 'Card', value: cardCell('volunteer', v) },
      { label: 'Login', value: v.user_id ? '<span class="pill paid">has login</span>' : `<button class="btn small" onclick="createVolunteerLogin(${v.id}, '${(v.name || '').replace(/'/g, '')}')">Create login</button>` },
    ];
    const actions = `
      <button class="btn small" onclick="toggleVolunteerModules(${v.id})">Modules (${(v.module_access || []).length})</button>
      <button class="btn small" onclick="editVol(${v.id})">Update</button>
      ${canDelete() ? `<button class="btn danger small" onclick="deleteVol(${v.id})">Delete</button>` : ''}
    `;
    return renderRecordCard(v.name, v.organization || '-', fields, actions)
      + `<div id="volModulesRow-${v.id}" class="record-card-subpanel" style="display:none;"><div id="volModulesPanel-${v.id}"></div></div>`;
  }).join('') || '<p class="empty">No volunteers yet</p>';

  const opts = rows.map((v) => `<option value="${v.id}">${v.name}${v.organization ? ' (' + v.organization + ')' : ''}</option>`).join('');
  const createUserVolunteerSelect = document.getElementById('createUserVolunteerSelect');
  if (createUserVolunteerSelect) createUserVolunteerSelect.innerHTML = '<option value="">-- select --</option>' + opts;

  for (const id of openVolunteerModulePanels) {
    const row = document.getElementById(`volModulesRow-${id}`);
    if (row) { row.style.display = ''; renderVolunteerModulesPanel(id); }
  }
}
let openVolunteerModulePanels = new Set();

window.deleteVol = async (id) => { await jdel(`${API}/volunteers/${id}`); toast('Volunteer deleted'); refreshVolunteers(); };

window.createVolunteerLogin = async (id, name) => {
  const username = prompt(`Username for ${name}'s login:`, (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, ''));
  if (!username) return;
  const password = prompt('Temporary password (they can change it after logging in, min 6 characters):');
  if (!password || password.length < 6) { toast('Password must be at least 6 characters'); return; }
  try {
    await jpost(`${API}/auth/users`, { username, password, role: 'volunteer', volunteer_id: id });
    toast(`Login created for ${name}. Share the username/password with them — they log in at login.html.`, 6000);
    refreshVolunteers();
  } catch (err) { toast(err.message); }
};

const VOL_FORM_FIELDS = ['name', 'phone', 'email', 'organization', 'notes', 'shirt_size', 'tshirt_size', 'waist_size'];
window.editVol = async (id) => {
  const v = await jget(`${API}/volunteers/${id}`);
  const form = document.getElementById('volForm');
  VOL_FORM_FIELDS.forEach((f) => {
    if (form.elements[f]) form.elements[f].value = v[f] !== null && v[f] !== undefined ? v[f] : '';
  });
  form.dataset.editId = id;
  document.getElementById('volFormTitle').textContent = `Update volunteer — ${v.name}`;
  document.getElementById('volSubmitBtn').textContent = 'Update Volunteer';
  document.getElementById('volCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
window.cancelEditVol = () => {
  const form = document.getElementById('volForm');
  form.reset();
  delete form.dataset.editId;
  document.getElementById('volFormTitle').textContent = 'Add volunteer';
  document.getElementById('volSubmitBtn').textContent = 'Save Volunteer';
  document.getElementById('volCancelEditBtn').style.display = 'none';
};
document.getElementById('volCancelEditBtn').addEventListener('click', (e) => { e.preventDefault(); window.cancelEditVol(); });
async function saveVolForm(form, force) {
  const body = Object.fromEntries(new FormData(form).entries());
  if (force) body.force = true;
  const editId = form.dataset.editId;
  try {
    if (editId) {
      await jput(`${API}/volunteers/${editId}`, body);
      toast('Volunteer updated');
      window.cancelEditVol();
    } else {
      await jpost(`${API}/volunteers`, body);
      form.reset();
      toast('Volunteer saved');
    }
    refreshVolunteers();
  } catch (err) {
    if (err.status === 409 && err.data && err.data.error === 'duplicate') {
      const proceed = confirm(err.data.message + '\n\nClick OK to save anyway, or Cancel to go back and edit.');
      if (proceed) return saveVolForm(form, true);
    } else {
      toast(err.message);
    }
  }
}
document.getElementById('volForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveVolForm(e.target, false);
});

window.toggleVolunteerModules = async (volunteerId) => {
  const row = document.getElementById(`volModulesRow-${volunteerId}`);
  if (!row) return;
  const isOpen = row.style.display !== 'none';
  if (isOpen) {
    row.style.display = 'none';
    openVolunteerModulePanels.delete(volunteerId);
  } else {
    row.style.display = '';
    openVolunteerModulePanels.add(volunteerId);
    await renderVolunteerModulesPanel(volunteerId);
  }
};

// Lets an admin grant this volunteer direct access to specific operational
// modules from their own volunteer portal — same MODULE_KEYS catalog and
// checkbox-grid-save-all-at-once pattern as Committees' module access.
async function renderVolunteerModulesPanel(volunteerId) {
  const panel = document.getElementById(`volModulesPanel-${volunteerId}`);
  if (!panel) return;
  const v = ALL_VOLUNTEERS_CACHE.find((x) => x.id === volunteerId);
  const keys = await moduleKeysCache();
  const granted = new Set(v?.module_access || []);
  panel.innerHTML = `
    <p class="hint" style="margin:0 0 8px;">This volunteer can manage these modules directly from their own portal. Deletes always stay admin-only, regardless of what's granted here.</p>
    <form onsubmit="return submitVolunteerModules(event, ${volunteerId})">
      <div class="module-checkbox-grid">
        ${keys.map((k) => `
          <label><input type="checkbox" value="${k.key}" ${granted.has(k.key) ? 'checked' : ''} /> ${k.label}</label>
        `).join('')}
      </div>
      <button class="btn gold small" type="submit">Save module access</button>
    </form>
  `;
}
window.submitVolunteerModules = async (e, volunteerId) => {
  e.preventDefault();
  const module_keys = Array.from(e.target.querySelectorAll('input[type=checkbox]:checked')).map((el) => el.value);
  try {
    await jput(`${API}/volunteers/${volunteerId}/modules`, { module_keys });
    toast('Module access saved');
    openVolunteerModulePanels.add(volunteerId);
    refreshVolunteers();
  } catch (err) { toast(err.message); }
  return false;
};

// --- Communications: one-way announcements to a role, a committee, or ---
// hand-picked individuals, with an optional attached action (mirrored into
// a host_member's checklist tab; tracked per-recipient for everyone else).
// Deliberately not a chat — no replies/threads. See server/routes/messages.js.
let ALL_MSG_USERS_CACHE = [];
let openMessageRecipientPanels = new Set();

const msgTargetTypeSelect = document.getElementById('msgTargetType');
const msgRoleField = document.getElementById('msgRoleField');
const msgCommitteeField = document.getElementById('msgCommitteeField');
const msgIndividualField = document.getElementById('msgIndividualField');
function updateMsgTargetFieldVisibility() {
  const t = msgTargetTypeSelect.value;
  msgRoleField.style.display = t === 'role' ? '' : 'none';
  msgCommitteeField.style.display = t === 'committee' ? '' : 'none';
  msgIndividualField.style.display = t === 'individual' ? '' : 'none';
}
if (msgTargetTypeSelect) {
  msgTargetTypeSelect.addEventListener('change', updateMsgTargetFieldVisibility);
  updateMsgTargetFieldVisibility();
}

const msgHasActionCheckbox = document.getElementById('msgHasAction');
const msgActionFields = document.getElementById('msgActionFields');
if (msgHasActionCheckbox) {
  msgHasActionCheckbox.addEventListener('change', () => {
    msgActionFields.style.display = msgHasActionCheckbox.checked ? '' : 'none';
  });
}

function populateMsgCommitteeSelect() {
  const el = document.getElementById('msgCommitteeSelect');
  if (!el) return;
  const cur = el.value;
  el.innerHTML = '<option value="">-- select --</option>' + ALL_COMMITTEES_CACHE.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  if (cur) el.value = cur;
}

function renderMsgIndividualGrid(filter) {
  const grid = document.getElementById('msgIndividualGrid');
  if (!grid) return;
  const q = (filter || '').toLowerCase();
  const checkedIds = new Set(Array.from(grid.querySelectorAll('input[type=checkbox]:checked')).map((el) => el.value));
  const rows = q
    ? ALL_MSG_USERS_CACHE.filter((u) => [u.display_name, u.username].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
    : ALL_MSG_USERS_CACHE;
  grid.innerHTML = rows.map((u) => `
    <label><input type="checkbox" name="msg_individual" value="${u.id}" ${checkedIds.has(String(u.id)) ? 'checked' : ''} /> ${u.display_name || u.username} <span class="hint">(${u.role})</span></label>
  `).join('') || '<span class="hint">No matching users</span>';
}
async function refreshMsgIndividualDirectory() {
  ALL_MSG_USERS_CACHE = await jget(`${API}/messages/recipients-directory`);
  renderMsgIndividualGrid(document.getElementById('msgIndividualSearch')?.value);
}
const msgIndividualSearch = document.getElementById('msgIndividualSearch');
if (msgIndividualSearch) {
  msgIndividualSearch.addEventListener('input', (e) => renderMsgIndividualGrid(e.target.value));
}

const ROLE_LABELS_FOR_TARGET = { all: 'Everyone', host_member: 'Host Members', media: 'Media', transporter: 'Transporters', driver: 'Drivers', volunteer: 'Volunteers', admin: 'Admins', super_admin: 'Super Admins' };
function describeMsgTarget(m) {
  if (m.target_type === 'role') {
    const roles = m.target_roles || [];
    return roles.map((r) => ROLE_LABELS_FOR_TARGET[r] || r).join(', ') || '-';
  }
  if (m.target_type === 'committee') return `Committee: ${m.target_committee_name || '-'}`;
  if (m.target_type === 'individual') return 'Specific people';
  return '-';
}

async function refreshMessageHistory() {
  const rows = await jget(`${API}/messages`);
  document.getElementById('msgHistoryBody').innerHTML = rows.map((m) => `
    <tr>
      <td>${m.title}${m.action_label ? ` <span class="hint">(action: ${m.action_label})</span>` : ''}</td>
      <td>${describeMsgTarget(m)}</td>
      <td>${m.recipient_count}</td>
      <td>${m.read_count}/${m.recipient_count}</td>
      <td>${m.sender_username || '-'}</td>
      <td>${new Date(m.created_at).toLocaleString()}</td>
      <td class="sticky-actions"><button class="btn small" onclick="toggleMessageRecipients(${m.id})">View</button></td>
    </tr>
    <tr id="msgRecipientsRow-${m.id}" style="display:none;"><td colspan="7"><div id="msgRecipientsPanel-${m.id}"></div></td></tr>
  `).join('') || '<tr><td colspan="7" class="empty">No announcements sent yet</td></tr>';

  for (const id of openMessageRecipientPanels) {
    const row = document.getElementById(`msgRecipientsRow-${id}`);
    if (row) { row.style.display = ''; renderMessageRecipientsPanel(id); }
  }
}

window.toggleMessageRecipients = async (messageId) => {
  const row = document.getElementById(`msgRecipientsRow-${messageId}`);
  if (!row) return;
  const isOpen = row.style.display !== 'none';
  if (isOpen) {
    row.style.display = 'none';
    openMessageRecipientPanels.delete(messageId);
  } else {
    row.style.display = '';
    openMessageRecipientPanels.add(messageId);
    await renderMessageRecipientsPanel(messageId);
  }
};
async function renderMessageRecipientsPanel(messageId) {
  const panel = document.getElementById(`msgRecipientsPanel-${messageId}`);
  if (!panel) return;
  panel.innerHTML = '<p class="hint">Loading...</p>';
  const rows = await jget(`${API}/messages/${messageId}/recipients`);
  panel.innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Role</th><th>Read</th><th>Action done</th></tr></thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td>${r.display_name || r.username}</td>
            <td>${r.role}</td>
            <td>${r.read_at ? new Date(r.read_at).toLocaleString() : '<span class="hint">Unread</span>'}</td>
            <td>${r.action_done_at ? new Date(r.action_done_at).toLocaleString() : '<span class="hint">-</span>'}</td>
          </tr>
        `).join('') || '<tr><td colspan="4" class="empty">No recipients</td></tr>'}
      </tbody>
    </table>
  `;
}

document.getElementById('msgForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const title = form.elements['title'].value;
  const body = form.elements['body'].value;
  const target_type = msgTargetTypeSelect.value;
  const payload = { title, body, target_type };

  if (target_type === 'role') {
    payload.target_roles = Array.from(form.querySelectorAll('input[name=msg_role]:checked')).map((el) => el.value);
    if (!payload.target_roles.length) { toast('Pick at least one role (or Everyone).'); return; }
  } else if (target_type === 'committee') {
    const committeeId = document.getElementById('msgCommitteeSelect').value;
    if (!committeeId) { toast('Pick a committee.'); return; }
    payload.target_committee_id = Number(committeeId);
  } else if (target_type === 'individual') {
    payload.target_user_ids = Array.from(form.querySelectorAll('input[name=msg_individual]:checked')).map((el) => Number(el.value));
    if (!payload.target_user_ids.length) { toast('Pick at least one person.'); return; }
  }

  if (msgHasActionCheckbox.checked) {
    payload.action_label = form.elements['action_label'].value;
    payload.action_due_date = form.elements['action_due_date'].value || null;
  }

  try {
    const result = await jpost(`${API}/messages`, payload);
    toast(`Sent to ${result.recipient_count} recipient(s)`);
    form.reset();
    msgHasActionCheckbox.checked = false;
    msgActionFields.style.display = 'none';
    updateMsgTargetFieldVisibility();
    renderMsgIndividualGrid('');
    refreshMessageHistory();
  } catch (err) { toast(err.message); }
});

// --- Email Campaigns: bulk personalized email blasts (via Resend) to any ---
// audience with an email column — Delegates, Host Members, Volunteers,
// Sponsors, Guest Speakers, Guest Visitors. See server/routes/emailCampaigns.js.
// Distinct from Announcements above: reaches people with no login at all.
const AUDIENCE_LABELS = {
  participant: 'Delegates', host_member: 'Host Members', volunteer: 'Volunteers',
  sponsor: 'Sponsors', speaker: 'Guest Speakers', guest_visitor: 'Guest Visitors'
};
let ecDirectoryCache = [];      // [{id, name, email, meta}] for the currently-chosen audience
let ecPickedIds = new Set();    // hand-picked recipient ids (only used when Recipients = "pick")
let ecCurrentAudience = '';
let openEcRecipientPanels = new Set();

const ecAudienceTypeSelect = document.getElementById('ecAudienceType');
const ecRecipientModeSelect = document.getElementById('ecRecipientMode');
const ecIndividualField = document.getElementById('ecIndividualField');

async function refreshEcAudienceCount() {
  const countEl = document.getElementById('ecAudienceCount');
  if (!ecAudienceTypeSelect.value) { countEl.textContent = ''; return; }
  try {
    const audiences = await jget(`${API}/email-campaigns/audiences`);
    const a = audiences[ecAudienceTypeSelect.value];
    countEl.textContent = a ? `${a.with_email} of ${a.total} have an email on file.` : '';
  } catch (err) { countEl.textContent = ''; }
}

function renderEcIndividualGrid(filter) {
  const grid = document.getElementById('ecIndividualGrid');
  if (!grid) return;
  const q = (filter || '').toLowerCase();
  const rows = q ? ecDirectoryCache.filter((p) => p.name.toLowerCase().includes(q)) : ecDirectoryCache;
  grid.innerHTML = rows.map((p) => `
    <label class="${p.email ? '' : 'hint'}" title="${p.email ? '' : 'No email on file — cannot be picked'}">
      <input type="checkbox" data-ec-pick="${p.id}" ${ecPickedIds.has(p.id) ? 'checked' : ''} ${p.email ? '' : 'disabled'} />
      ${p.name} ${p.meta ? `<span class="hint">(${p.meta})</span>` : ''} ${p.email ? '' : '<span class="hint">— no email</span>'}
    </label>
  `).join('') || '<span class="hint">No records in this audience yet.</span>';
  grid.querySelectorAll('input[data-ec-pick]').forEach((box) => {
    box.addEventListener('change', () => {
      const id = Number(box.dataset.ecPick);
      if (box.checked) ecPickedIds.add(id); else ecPickedIds.delete(id);
      updateEcPickedCount();
    });
  });
  updateEcPickedCount();
}
function updateEcPickedCount() {
  const el = document.getElementById('ecPickedCount');
  if (el) el.textContent = `${ecPickedIds.size} selected`;
}

async function loadEcDirectory(audienceType) {
  ecDirectoryCache = await jget(`${API}/email-campaigns/directory/${audienceType}`);
  ecPickedIds = new Set();
  renderEcIndividualGrid(document.getElementById('ecIndividualSearch')?.value);
}

if (ecAudienceTypeSelect) {
  ecAudienceTypeSelect.addEventListener('change', async () => {
    ecCurrentAudience = ecAudienceTypeSelect.value;
    refreshEcAudienceCount();
    if (ecCurrentAudience && ecRecipientModeSelect.value === 'pick') await loadEcDirectory(ecCurrentAudience);
  });
}
if (ecRecipientModeSelect) {
  ecRecipientModeSelect.addEventListener('change', async () => {
    const picking = ecRecipientModeSelect.value === 'pick';
    ecIndividualField.style.display = picking ? '' : 'none';
    if (picking) {
      if (!ecCurrentAudience) { toast('Pick an audience first.'); ecRecipientModeSelect.value = 'all'; ecIndividualField.style.display = 'none'; return; }
      await loadEcDirectory(ecCurrentAudience);
    }
  });
}
const ecIndividualSearch = document.getElementById('ecIndividualSearch');
if (ecIndividualSearch) ecIndividualSearch.addEventListener('input', (e) => renderEcIndividualGrid(e.target.value));
const ecSelectAllBtn = document.getElementById('ecSelectAllBtn');
if (ecSelectAllBtn) ecSelectAllBtn.addEventListener('click', () => {
  ecDirectoryCache.forEach((p) => { if (p.email) ecPickedIds.add(p.id); });
  renderEcIndividualGrid(document.getElementById('ecIndividualSearch')?.value);
});
const ecClearAllBtn = document.getElementById('ecClearAllBtn');
if (ecClearAllBtn) ecClearAllBtn.addEventListener('click', () => {
  ecPickedIds = new Set();
  renderEcIndividualGrid(document.getElementById('ecIndividualSearch')?.value);
});

function ecCurrentRecipientIds() {
  return (ecRecipientModeSelect.value === 'pick') ? Array.from(ecPickedIds) : null;
}

document.getElementById('ecPreviewBtn').addEventListener('click', async () => {
  const audience_type = ecAudienceTypeSelect.value;
  const subject = document.getElementById('ecSubject').value;
  const body_html = document.getElementById('ecBody').value;
  if (!audience_type || !subject || !body_html) { toast('Fill in Audience, Subject and Body first.'); return; }
  try {
    const result = await jpost(`${API}/email-campaigns/preview`, { audience_type, recipient_ids: ecCurrentRecipientIds(), subject, body_html });
    const panel = document.getElementById('ecPreviewPanel');
    panel.style.display = '';
    panel.innerHTML = `
      <p class="hint"><strong>${result.recipient_count}</strong> recipient(s) would receive this send.</p>
      ${result.sample.map((s) => `
        <div class="card" style="margin-bottom:8px;">
          <p class="hint" style="margin:0;">To: ${s.name} &lt;${s.email}&gt;</p>
          <p style="margin:6px 0 4px;"><strong>${s.subject}</strong></p>
          <div style="border-top:1px solid var(--line);padding-top:6px;">${s.body_html}</div>
        </div>
      `).join('') || '<p class="hint">No recipients match yet.</p>'}
    `;
  } catch (err) { toast(err.message); }
});

document.getElementById('ecForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const name = form.elements['name'].value;
  const from_name = form.elements['from_name'].value;
  const audience_type = ecAudienceTypeSelect.value;
  const subject = document.getElementById('ecSubject').value;
  const body_html = document.getElementById('ecBody').value;
  if (!audience_type) { toast('Pick an audience.'); return; }
  const recipient_ids = ecCurrentRecipientIds();
  if (recipient_ids && !recipient_ids.length) { toast('Pick at least one person, or switch Recipients to "Everyone".'); return; }
  try {
    await jpost(`${API}/email-campaigns`, { name, subject, body_html, audience_type, recipient_ids, from_name });
    toast('Campaign saved as a draft — find it below to send.');
    form.reset();
    document.getElementById('ecSubject').value = '';
    document.getElementById('ecBody').value = '';
    document.getElementById('ecPreviewPanel').style.display = 'none';
    ecPickedIds = new Set();
    ecRecipientModeSelect.value = 'all';
    ecIndividualField.style.display = 'none';
    refreshEcHistory();
  } catch (err) { toast(err.message); }
});

function ecStatusPill(status) {
  const cls = status === 'sent' ? 'paid' : status === 'sending' ? 'billed' : status === 'failed' ? 'cancelled' : 'not_started';
  return `<span class="pill ${cls}">${status}</span>`;
}

async function refreshEcHistory() {
  const rows = await jget(`${API}/email-campaigns`);
  document.getElementById('ecHistoryBody').innerHTML = rows.map((c) => `
    <tr>
      <td>${c.name}</td>
      <td>${AUDIENCE_LABELS[c.audience_type] || c.audience_type}${c.recipient_ids ? ' <span class="hint">(hand-picked)</span>' : ''}</td>
      <td>${c.attempted_count}</td>
      <td>${c.sent_count} / ${c.failed_count}</td>
      <td>${ecStatusPill(c.status)}</td>
      <td>${new Date(c.created_at).toLocaleString()}</td>
      <td class="sticky-actions">
        ${c.status === 'draft' ? `<button class="btn small" onclick="ecSendTest(${c.id})">Send test</button> <button class="btn gold small" onclick="ecSendCampaign(${c.id}, ${c.attempted_count || 0})">Send</button>` : ''}
        <button class="btn small" onclick="toggleEcRecipients(${c.id})">View</button>
      </td>
    </tr>
    <tr id="ecRecipientsRow-${c.id}" style="display:none;"><td colspan="7"><div id="ecRecipientsPanel-${c.id}"></div></td></tr>
  `).join('') || '<tr><td colspan="7" class="empty">No email campaigns yet</td></tr>';

  for (const id of openEcRecipientPanels) {
    const row = document.getElementById(`ecRecipientsRow-${id}`);
    if (row) { row.style.display = ''; renderEcRecipientsPanel(id); }
  }
}

window.toggleEcRecipients = async (id) => {
  const row = document.getElementById(`ecRecipientsRow-${id}`);
  if (!row) return;
  const isOpen = row.style.display !== 'none';
  if (isOpen) { row.style.display = 'none'; openEcRecipientPanels.delete(id); }
  else { row.style.display = ''; openEcRecipientPanels.add(id); await renderEcRecipientsPanel(id); }
};
async function renderEcRecipientsPanel(id) {
  const panel = document.getElementById(`ecRecipientsPanel-${id}`);
  if (!panel) return;
  panel.innerHTML = '<p class="hint">Loading...</p>';
  const rows = await jget(`${API}/email-campaigns/${id}/recipients`);
  panel.innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Error</th></tr></thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td>${r.name || '-'}</td>
            <td>${r.email}</td>
            <td>${ecStatusPill(r.status)}</td>
            <td class="hint">${r.error || ''}</td>
          </tr>
        `).join('') || '<tr><td colspan="4" class="empty">No recipients yet — click Send.</td></tr>'}
      </tbody>
    </table>
  `;
}

window.ecSendTest = async (id) => {
  const to = prompt('Send a test email to which address?', CURRENT_USER?.username?.includes('@') ? CURRENT_USER.username : '');
  if (!to) return;
  try {
    await jpost(`${API}/email-campaigns/${id}/send-test`, { to });
    toast(`Test email sent to ${to}`);
  } catch (err) { toast(err.message); }
};
window.ecSendCampaign = async (id, recipientCount) => {
  if (!confirm(`Send this campaign now? This cannot be undone.`)) return;
  try {
    const result = await jpost(`${API}/email-campaigns/${id}/send`, {});
    toast(`Sending to ${result.recipient_count} recipient(s)...`);
    openEcRecipientPanels.add(id);
    refreshEcHistory();
    // Poll a few times so sent/failed counts update live without a manual refresh.
    let polls = 0;
    const timer = setInterval(async () => {
      polls++;
      await refreshEcHistory();
      if (polls >= 10) clearInterval(timer);
    }, 4000);
  } catch (err) { toast(err.message); }
};

// --- Committee's own checklist (separate from per-member task delegation
// above, and from the cross-committee "Committee Delivery" tab which is
// checklist items OTHER entities need this committee to deliver). This is
// a simple shared to-do list that belongs to the committee itself — the
// same host portal Lead tab lets a committee lead add to this one, using
// the generic checklist_items table (owner_type='committee'). ---
window.toggleCommitteeChecklist = async (committeeId) => {
  const panel = document.getElementById(`committeeChecklistPanel-${committeeId}`);
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  if (isOpen) {
    panel.style.display = 'none';
    openCommitteeChecklistPanels.delete(committeeId);
  } else {
    panel.style.display = '';
    openCommitteeChecklistPanels.add(committeeId);
    await renderCommitteeChecklistPanel(committeeId);
  }
};
async function renderCommitteeChecklistPanel(committeeId) {
  const panel = document.getElementById(`committeeChecklistPanel-${committeeId}`);
  if (!panel) return;
  const items = await jget(`${API}/committees/${committeeId}/checklist`);
  panel.innerHTML = `
    <p class="hint" style="margin:0 0 12px;">This committee's own shared to-do list — its lead can add to this from their host portal too. Any member can update the status.</p>
    <form onsubmit="return submitCommitteeChecklistItem(event, ${committeeId})" style="margin:10px 0;">
      <div class="form-grid cols-3">
        <div class="field"><label>Item *</label><input name="label" required /></div>
        <div class="field"><label>Due date</label><input name="due_date" type="date" /></div>
        <div class="field"><label>Category</label><input name="category" /></div>
      </div>
      <button class="btn gold small" type="submit">Add checklist item</button>
    </form>
    ${items.map((it) => `
      <div class="checklist-row status-${it.status}" style="padding:6px 0;border-bottom:1px solid var(--line);">
        <select onchange="updateCommitteeChecklistStatus(${it.id}, this.value, ${committeeId})">
          <option value="pending" ${it.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="in_progress" ${it.status === 'in_progress' ? 'selected' : ''}>In progress</option>
          <option value="done" ${it.status === 'done' ? 'selected' : ''}>Done</option>
        </select>
        <span class="checklist-label">${it.label}${it.due_date ? ` <span class="hint">(due ${String(it.due_date).slice(0, 10)})</span>` : ''}</span>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteCommitteeChecklistItem(${it.id}, ${committeeId})">Delete</button>` : ''}
      </div>
    `).join('') || '<p class="hint">No checklist items yet.</p>'}
  `;
}
window.submitCommitteeChecklistItem = async (e, committeeId) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  try {
    await jpost(`${API}/committees/${committeeId}/checklist`, body);
    toast('Checklist item added');
    openCommitteeChecklistPanels.add(committeeId);
    refreshCommittees();
  } catch (err) { toast(err.message); }
  return false;
};
window.updateCommitteeChecklistStatus = async (itemId, status, committeeId) => {
  try {
    await jput(`${API}/checklist-items/${itemId}`, { status });
    toast('Status updated');
    openCommitteeChecklistPanels.add(committeeId);
    refreshCommittees();
  } catch (err) { toast(err.message); }
};
window.deleteCommitteeChecklistItem = async (itemId, committeeId) => {
  await jdel(`${API}/checklist-items/${itemId}`);
  toast('Removed');
  openCommitteeChecklistPanels.add(committeeId);
  refreshCommittees();
};

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
  form.elements.description.value = c.description || '';
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
  ['assignPartSelect', 'tripPassengerParticipantSelect', 'tourPartParticipantSelect', 'roomParticipantSelect'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = opts;
  });
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
      <td><button class="btn small" onclick="downloadPartnerDetailPdf(${p.id})">PDF</button> ${canDelete() ? `<button class="btn danger small" onclick="deletePartner(${p.id})">Delete</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">No partners yet</td></tr>';

  const opts = rows.map((p) => `<option value="${p.id}">${p.name}${p.category ? ' (' + p.category + ')' : ''}</option>`).join('');
  ['driverPartnerSelect', 'vehiclePartnerSelect', 'tourTripPartnerSelect'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">-- none --</option>' + opts;
  });
  const createUserPartnerSelect = document.getElementById('createUserPartnerSelect');
  if (createUserPartnerSelect) createUserPartnerSelect.innerHTML = '<option value="">-- select --</option>' + opts;
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
      <td>${d.vehicle_code
        ? `${d.vehicle_code} <span class="hint">(${d.vehicle_master_type}, ${d.seating_capacity} seats)</span>`
        : (`${d.vehicle_type || ''} ${d.vehicle_number || ''}`.trim() || '<span class="hint">none</span>')}</td>
      <td>${d.partner_name || '-'}</td>
      <td><button class="btn small" onclick="downloadDriverDetailPdf(${d.id})">PDF</button> ${canDelete() ? `<button class="btn danger small" onclick="deleteDriver(${d.id})">Delete</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">No drivers yet</td></tr>';

  const driverOpts = rows.map((d) => `<option value="${d.id}">${d.name}${d.vehicle_code ? ' — ' + d.vehicle_code : ''}</option>`).join('');
  ['tripDriverSelect', 'tourTripDriverSelect'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">-- none --</option>' + driverOpts;
  });
  const createUserDriverSelect = document.getElementById('createUserDriverSelect');
  if (createUserDriverSelect) createUserDriverSelect.innerHTML = '<option value="">-- select --</option>' + driverOpts;
}
window.deleteDriver = async (id) => { await jdel(`${API}/drivers/${id}`); toast('Driver removed'); refreshDrivers(); };
async function saveDriverForm(form, force) {
  const body = Object.fromEntries(new FormData(form).entries());
  if (!body.partner_id) delete body.partner_id;
  if (!body.vehicle_id) delete body.vehicle_id;
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

// --- Operations: Vehicles (masters) ---
async function refreshVehicles() {
  const rows = await jget(`${API}/vehicles`);
  document.getElementById('vehicleTableBody').innerHTML = rows.map((v) => `
    <tr>
      <td><strong>${v.vehicle_code}</strong></td>
      <td style="text-transform:capitalize;">${v.vehicle_type}</td>
      <td>${v.model || '-'}</td>
      <td>${v.seating_capacity}</td>
      <td>${v.registration_number || '-'}</td>
      <td>${v.partner_name || '-'}</td>
      <td class="sticky-actions">
        <button class="btn small" onclick="editVehicle(${v.id})">Edit</button>
        <button class="btn small" onclick="downloadVehicleDetailPdf(${v.id})">PDF</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteVehicle(${v.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty">No vehicles yet</td></tr>';

  const opts = rows.map((v) => `<option value="${v.id}">${v.vehicle_code} · ${v.vehicle_type} (${v.seating_capacity} seats)${v.model ? ' — ' + v.model : ''}</option>`).join('');
  document.getElementById('driverVehicleSelect').innerHTML = '<option value="">-- none --</option>' + opts;
  ['tripVehicleSelect', 'tourTripVehicleSelect'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">-- select vehicle --</option>' + opts;
  });
}
window.deleteVehicle = async (id) => { await jdel(`${API}/vehicles/${id}`); toast('Vehicle removed'); refreshVehicles(); refreshDrivers(); };

async function loadNextVehicleCode() {
  const form = document.getElementById('vehicleForm');
  if (form.dataset.editId) return; // don't touch the code of an existing vehicle mid-edit
  try {
    const type = document.getElementById('vehicleTypeSelect').value;
    const { vehicle_code } = await jget(`${API}/vehicles/next-code?type=${type}`);
    document.getElementById('vehicleCodeField').value = vehicle_code;
  } catch (e) { /* preview only — ignore failures */ }
}
document.getElementById('vehicleTypeSelect').addEventListener('change', loadNextVehicleCode);

const VEHICLE_FORM_FIELDS = ['vehicle_type', 'vehicle_code', 'model', 'seating_capacity', 'registration_number', 'partner_id', 'notes'];
window.editVehicle = async (id) => {
  const rows = await jget(`${API}/vehicles`);
  const v = rows.find((r) => r.id === id);
  if (!v) return;
  const form = document.getElementById('vehicleForm');
  VEHICLE_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = v[f] !== null && v[f] !== undefined ? v[f] : ''; });
  form.dataset.editId = id;
  // The code's prefix is tied to the type — lock type editing so the two can't drift apart silently.
  document.getElementById('vehicleTypeSelect').disabled = true;
  document.getElementById('vehicleFormTitle').textContent = `Edit vehicle — ${v.vehicle_code}`;
  document.getElementById('vehicleSubmitBtn').textContent = 'Update Vehicle';
  document.getElementById('vehicleCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
window.cancelEditVehicle = () => {
  const form = document.getElementById('vehicleForm');
  form.reset();
  delete form.dataset.editId;
  document.getElementById('vehicleTypeSelect').disabled = false;
  document.getElementById('vehicleFormTitle').textContent = 'Add vehicle';
  document.getElementById('vehicleSubmitBtn').textContent = 'Save Vehicle';
  document.getElementById('vehicleCancelEditBtn').style.display = 'none';
  loadNextVehicleCode();
};
document.getElementById('vehicleCancelEditBtn').addEventListener('click', (e) => { e.preventDefault(); window.cancelEditVehicle(); });
async function saveVehicleForm(form) {
  const body = Object.fromEntries(new FormData(form).entries());
  if (!body.partner_id) delete body.partner_id;
  const editId = form.dataset.editId;
  try {
    if (editId) {
      delete body.vehicle_code;
      await jput(`${API}/vehicles/${editId}`, body);
      toast('Vehicle updated');
      window.cancelEditVehicle();
    } else {
      await jpost(`${API}/vehicles`, body);
      form.reset();
      toast('Vehicle saved');
      loadNextVehicleCode();
    }
    refreshVehicles();
    refreshDrivers();
  } catch (err) {
    if (err.status === 409) toast(err.data && err.data.message || err.message);
    else toast(err.message);
  }
}
document.getElementById('vehicleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveVehicleForm(e.target);
});

// --- Operations: Transport Planning (shuttle/trip manifests) ---
function capacityBadge(count, capacity) {
  if (!capacity) return String(count);
  return `<span class="pill ${count > capacity ? 'pending' : 'paid'}">${count}/${capacity}</span>`;
}
function tripStatusPill(status) {
  const cls = status === 'completed' ? 'completed' : status === 'cancelled' ? 'pending' : status === 'in_progress' ? 'in_progress' : 'not_started';
  return `<span class="pill ${cls}">${(status || '').replace('_', ' ')}</span>`;
}

async function refreshTransportTrips() {
  const rows = await jget(`${API}/transport?pre_tour_id=none`);
  document.getElementById('tripTableBody').innerHTML = rows.map((t) => `
    <tr>
      <td>${t.trip_date || '-'}</td>
      <td>${t.depart_time || '-'}</td>
      <td>${t.from_location} → ${t.to_location}</td>
      <td>${t.purpose || '-'}</td>
      <td>${t.vehicle_code ? `${t.vehicle_code} <span class="hint">(${t.vehicle_type})</span>` : '<span class="hint">unassigned</span>'}</td>
      <td>${t.driver_name || '-'}</td>
      <td>${capacityBadge(Number(t.passenger_count), t.seating_capacity)}</td>
      <td>${tripStatusPill(t.status)}</td>
      <td class="sticky-actions">
        <button class="btn small" onclick="manageTripPassengers(${t.id}, '${(t.from_location + ' → ' + t.to_location).replace(/'/g, '')}')">Passengers</button>
        <button class="btn small" onclick="downloadTripPdf(${t.id})">PDF</button>
        <button class="btn small" onclick="editTrip(${t.id})">Edit</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteTrip(${t.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="9" class="empty">No trips planned yet</td></tr>';
}
// --- Arrivals & Departures to Plan: auto-grouped by flight/train number ---
// Reuses the existing vehicles/drivers lists (already refreshed by
// refreshVehicles()/refreshDrivers() into other selects) rather than a
// second network round trip.
function transportQueueGroupCard(direction, g) {
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
  const vehicleOpts = document.getElementById('tripVehicleSelect')?.innerHTML || '<option value="">-- select vehicle --</option>';
  const driverOpts = document.getElementById('tripDriverSelect')?.innerHTML || '<option value="">-- none --</option>';
  return `
    <div class="card queue-group" style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
        <strong>${modeLabel} ${g.travel_number} — ${g.travel_datetime}</strong>
        <span class="hint">${g.delegate_count} delegate${g.delegate_count === 1 ? '' : 's'}${queuePoint ? ' · ' + queuePoint : ''}${sharedHotel ? ' · all at ' + sharedHotel : ''}</span>
      </div>
      <div style="margin:8px 0;">
        <button type="button" class="btn small" onclick="toggleQueueGroupChecks(this, true)">Select all</button>
        <button type="button" class="btn small" onclick="toggleQueueGroupChecks(this, false)">Select none</button>
      </div>
      <div class="queue-group-delegates" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
        ${delegates.map((d) => `
          <label style="display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:6px 10px;width:100%;">
            <input type="checkbox" class="queue-delegate-cb" value="${d.id}" checked style="width:16px;height:16px;min-width:16px;flex-shrink:0;padding:0;" />
            <span style="line-height:1.35;flex:1;">${d.name}${d.hotel_name ? ` <span class="hint">→ ${d.hotel_name}</span>` : ''}</span>
          </label>
        `).join('')}
      </div>
      <form onsubmit="return submitGroupTrip(event, '${direction}')">
        <div class="form-grid cols-3">
          <div class="field"><label>From *</label><input name="from_location" data-location-suggest="1" required value="${fromDefault}" /></div>
          <div class="field"><label>To *</label><input name="to_location" data-location-suggest="1" required value="${toDefault}" /></div>
          <div class="field"><label>Trip date</label><input name="trip_date" type="date" /></div>
        </div>
        <div class="form-grid cols-3">
          <div class="field"><label>Depart time</label><input name="depart_time" type="time" /></div>
          <div class="field"><label>Vehicle *</label><select name="vehicle_id" required>${vehicleOpts}</select></div>
          <div class="field"><label>Driver</label><select name="driver_id">${driverOpts}</select></div>
        </div>
        <div class="field"><label>Purpose</label><input name="purpose" value="${purposeDefault}" /></div>
        <button class="btn gold small" type="submit">Create trip for this group</button>
      </form>
    </div>
  `;
}
window.toggleQueueGroupChecks = (btn, checked) => {
  btn.closest('.queue-group').querySelectorAll('.queue-delegate-cb').forEach((cb) => { cb.checked = checked; });
};
window.submitGroupTrip = async (e, direction) => {
  e.preventDefault();
  const card = e.target.closest('.queue-group');
  const participant_ids = Array.from(card.querySelectorAll('.queue-delegate-cb:checked')).map((cb) => Number(cb.value));
  if (!participant_ids.length) { toast('Select at least one delegate for this trip'); return false; }
  const body = Object.fromEntries(new FormData(e.target).entries());
  if (!body.driver_id) delete body.driver_id;
  body.direction = direction;
  body.participant_ids = participant_ids;
  try {
    await jpost(`${API}/transport/group-trip`, body);
    toast('Trip created for the group');
    if (body.from_location) ensureTransportPoint(body.from_location);
    if (body.to_location) ensureTransportPoint(body.to_location);
    refreshTransportTrips();
    refreshTransportQueue();
  } catch (err) { toast(err.message); }
  return false;
};
async function refreshTransportQueue() {
  const body = document.getElementById('transportQueueBody');
  if (!body) return;
  try {
    const [arrivals, departures] = await Promise.all([
      jget(`${API}/transport/arrivals-queue`),
      jget(`${API}/transport/departures-queue`),
    ]);
    body.innerHTML = `
      <div class="section-title" style="font-size:14px;">Arrivals (${arrivals.length})</div>
      ${arrivals.map((g) => transportQueueGroupCard('arrival', g)).join('') || '<p class="hint">No unplanned arrivals right now.</p>'}
      <div class="section-title" style="font-size:14px;">Departures (${departures.length})</div>
      ${departures.map((g) => transportQueueGroupCard('departure', g)).join('') || '<p class="hint">No unplanned departures right now.</p>'}
    `;
    wireLocationDropdowns(body);
  } catch (err) {
    body.innerHTML = `<p class="hint" style="color:var(--red);">${err.message}</p>`;
  }
}

document.getElementById('transportPointForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = e.target.elements.name.value.trim();
  if (!name) return;
  try {
    await jpost(`${API}/transport-points`, { name });
    e.target.reset();
    toast('Point added');
    refreshTransportPoints();
  } catch (err) { toast(err.message); }
});

window.deleteTrip = async (id) => {
  await jdel(`${API}/transport/${id}`);
  toast('Trip removed');
  refreshTransportTrips();
  if (currentTripId === id) { currentTripId = null; document.getElementById('tripPassengerCard').style.display = 'none'; }
};

const TRIP_FORM_FIELDS = ['trip_date', 'depart_time', 'from_location', 'to_location', 'purpose', 'vehicle_id', 'driver_id', 'status', 'notes'];
window.editTrip = async (id) => {
  const rows = await jget(`${API}/transport?pre_tour_id=none`);
  const t = rows.find((r) => r.id === id);
  if (!t) return;
  const form = document.getElementById('tripForm');
  TRIP_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = t[f] !== null && t[f] !== undefined ? t[f] : ''; });
  form.dataset.editId = id;
  document.getElementById('tripFormTitle').textContent = 'Edit trip';
  document.getElementById('tripSubmitBtn').textContent = 'Update Trip';
  document.getElementById('tripCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
window.cancelEditTrip = () => {
  const form = document.getElementById('tripForm');
  form.reset();
  delete form.dataset.editId;
  document.getElementById('tripFormTitle').textContent = 'Add trip';
  document.getElementById('tripSubmitBtn').textContent = 'Save Trip';
  document.getElementById('tripCancelEditBtn').style.display = 'none';
};
document.getElementById('tripCancelEditBtn').addEventListener('click', (e) => { e.preventDefault(); window.cancelEditTrip(); });
async function saveTripForm(form) {
  const body = Object.fromEntries(new FormData(form).entries());
  if (!body.driver_id) delete body.driver_id;
  const editId = form.dataset.editId;
  try {
    if (editId) {
      await jput(`${API}/transport/${editId}`, body);
      toast('Trip updated');
      window.cancelEditTrip();
    } else {
      await jpost(`${API}/transport`, body);
      form.reset();
      toast('Trip saved');
    }
    if (body.from_location) ensureTransportPoint(body.from_location);
    if (body.to_location) ensureTransportPoint(body.to_location);
    refreshTransportTrips();
  } catch (err) { toast(err.message); }
}
document.getElementById('tripForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveTripForm(e.target);
});

// Passenger manifest for whichever trip is currently selected for management.
let currentTripId = null;
window.manageTripPassengers = async (id, label) => {
  currentTripId = id;
  document.getElementById('tripPassengerTripLabel').textContent = label;
  document.getElementById('tripPassengerCard').style.display = '';
  await refreshTripPassengers();
  document.getElementById('tripPassengerCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
async function refreshTripPassengers() {
  if (!currentTripId) return;
  const trip = await jget(`${API}/transport/${currentTripId}`);
  document.getElementById('tripPassengerTableBody').innerHTML = (trip.passengers || []).map((p) => `
    <tr>
      <td>${p.participant_name || p.host_member_name}</td>
      <td>${p.participant_id ? 'Delegate' : 'Host member'}</td>
      <td>${p.participant_phone || p.host_member_phone || '-'}</td>
      <td>${p.pickup_point || '-'}</td>
      <td>${canDelete() ? `<button class="btn danger small" onclick="removeTripPassenger(${p.id})">Remove</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">No passengers added yet</td></tr>';
}
window.removeTripPassenger = async (passengerId) => {
  await jdel(`${API}/transport/${currentTripId}/passengers/${passengerId}`);
  toast('Passenger removed');
  refreshTripPassengers();
  refreshTransportTrips();
};
document.getElementById('tripPassengerTypeSelect').addEventListener('change', (e) => {
  const isHm = e.target.value === 'host_member';
  document.getElementById('tripPassengerParticipantSelect').style.display = isHm ? 'none' : '';
  document.getElementById('tripPassengerHmSelect').style.display = isHm ? '' : 'none';
});
document.getElementById('tripPassengerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentTripId) { toast('Select a trip first — click "Passengers" on a row below.'); return; }
  const isHm = document.getElementById('tripPassengerTypeSelect').value === 'host_member';
  const body = {
    participant_id: isHm ? null : (document.getElementById('tripPassengerParticipantSelect').value || null),
    host_member_id: isHm ? (document.getElementById('tripPassengerHmSelect').value || null) : null,
    pickup_point: document.getElementById('tripPassengerPickup').value
  };
  if (!body.participant_id && !body.host_member_id) { toast('Choose a delegate or a host member'); return; }
  try {
    await jpost(`${API}/transport/${currentTripId}/passengers`, body);
    document.getElementById('tripPassengerPickup').value = '';
    toast('Passenger added');
    refreshTripPassengers();
    refreshTransportTrips();
  } catch (err) { toast(err.message); }
});

// --- Operations: Pre Tours ---
async function refreshPreTours() {
  const rows = await jget(`${API}/pretours`);
  document.getElementById('tourTableBody').innerHTML = rows.map((t) => `
    <tr>
      <td><strong>${t.name}</strong></td>
      <td>${t.start_date || '-'}${t.end_date ? ' → ' + t.end_date : ''}</td>
      <td>${t.hotel || '-'}</td>
      <td>${t.capacity ? `${t.participant_count}/${t.capacity}` : t.participant_count}</td>
      <td>${t.trip_count}</td>
      <td><span class="pill ${t.status === 'confirmed' || t.status === 'completed' ? 'paid' : t.status === 'cancelled' ? 'pending' : 'not_started'}">${t.status}</span></td>
      <td class="sticky-actions">
        <button class="btn small" onclick="manageTour(${t.id}, '${(t.name || '').replace(/'/g, '')}')">Manage</button>
        <button class="btn small" onclick="downloadPreTourPdf(${t.id})">PDF</button>
        <button class="btn small" onclick="editTour(${t.id})">Edit</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteTour(${t.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty">No pre tours yet</td></tr>';
}
window.deleteTour = async (id) => {
  await jdel(`${API}/pretours/${id}`);
  toast('Pre tour removed');
  refreshPreTours();
  if (currentTourId === id) { currentTourId = null; document.getElementById('tourManageCard').style.display = 'none'; }
};

const TOUR_FORM_FIELDS = ['name', 'start_date', 'end_date', 'hotel', 'capacity', 'price', 'attractions', 'description', 'status', 'notes'];
window.editTour = async (id) => {
  const rows = await jget(`${API}/pretours`);
  const t = rows.find((r) => r.id === id);
  if (!t) return;
  const form = document.getElementById('tourForm');
  TOUR_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = t[f] !== null && t[f] !== undefined ? t[f] : ''; });
  form.dataset.editId = id;
  document.getElementById('tourFormTitle').textContent = `Edit pre tour — ${t.name}`;
  document.getElementById('tourSubmitBtn').textContent = 'Update Pre Tour';
  document.getElementById('tourCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
window.cancelEditTour = () => {
  const form = document.getElementById('tourForm');
  form.reset();
  delete form.dataset.editId;
  document.getElementById('tourFormTitle').textContent = 'Add pre tour';
  document.getElementById('tourSubmitBtn').textContent = 'Save Pre Tour';
  document.getElementById('tourCancelEditBtn').style.display = 'none';
};
document.getElementById('tourCancelEditBtn').addEventListener('click', (e) => { e.preventDefault(); window.cancelEditTour(); });
async function saveTourForm(form) {
  const body = Object.fromEntries(new FormData(form).entries());
  const editId = form.dataset.editId;
  try {
    if (editId) {
      await jput(`${API}/pretours/${editId}`, body);
      toast('Pre tour updated');
      window.cancelEditTour();
    } else {
      await jpost(`${API}/pretours`, body);
      form.reset();
      toast('Pre tour saved');
    }
    refreshPreTours();
  } catch (err) { toast(err.message); }
}
document.getElementById('tourForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveTourForm(e.target);
});

// Manage panel (itinerary + signups + transport) for whichever tour is selected.
let currentTourId = null;
window.manageTour = async (id, name) => {
  currentTourId = id;
  document.getElementById('tourManageLabel').textContent = name;
  document.getElementById('tourManageCard').style.display = '';
  await Promise.all([refreshTourItinerary(), refreshTourHotelDays(), refreshTourParticipants(), refreshTourTrips()]);
  document.getElementById('tourManageCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// Day-by-day Hotel Plan: which hotel a group sleeps at, plus a hotel for
// each of the day's 5 sittings (breakfast/hi-tea/lunch/hi-tea/dinner), per
// day of a Full Board pre tour. Mirrors refreshTourItinerary's shape.
const HOTEL_DAY_MEAL_FIELDS = ['breakfast_hotel_id', 'hitea1_hotel_id', 'lunch_hotel_id', 'hitea2_hotel_id', 'dinner_hotel_id'];
async function refreshTourHotelDays() {
  if (!currentTourId) return;
  const rows = await jget(`${API}/pretours/${currentTourId}/hotel-days`);
  document.getElementById('tourHotelDayTableBody').innerHTML = rows.map((d) => `
    <tr>
      <td>${d.day_label}</td>
      <td>${d.day_date || '-'}</td>
      <td>${d.stay_hotel_name || '-'}</td>
      <td>${d.breakfast_hotel_name || (d.stay_hotel_name ? 'same as stay' : '-')}</td>
      <td>${d.hitea1_hotel_name || (d.stay_hotel_name ? 'same as stay' : '-')}</td>
      <td>${d.lunch_hotel_name || (d.stay_hotel_name ? 'same as stay' : '-')}</td>
      <td>${d.hitea2_hotel_name || (d.stay_hotel_name ? 'same as stay' : '-')}</td>
      <td>${d.dinner_hotel_name || (d.stay_hotel_name ? 'same as stay' : '-')}</td>
      <td>${d.notes || '-'}</td>
      <td>${canDelete() ? `<button class="btn danger small" onclick="deleteTourHotelDay(${d.id})">Delete</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="10" class="empty">No hotel plan added yet</td></tr>';
}
window.deleteTourHotelDay = async (dayId) => {
  await jdel(`${API}/pretours/hotel-days/${dayId}`);
  toast('Hotel plan day removed');
  refreshTourHotelDays();
};
document.getElementById('tourHotelDayForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentTourId) { toast('Click "Manage" on a tour first'); return; }
  const body = Object.fromEntries(new FormData(e.target).entries());
  if (!body.stay_hotel_id) delete body.stay_hotel_id;
  HOTEL_DAY_MEAL_FIELDS.forEach((f) => { if (!body[f]) delete body[f]; });
  try {
    await jpost(`${API}/pretours/${currentTourId}/hotel-days`, body);
    e.target.reset();
    toast('Hotel plan day added');
    refreshTourHotelDays();
  } catch (err) { toast(err.message); }
});

async function refreshTourItinerary() {
  if (!currentTourId) return;
  const rows = await jget(`${API}/pretours/${currentTourId}/itinerary`);
  document.getElementById('tourItinTableBody').innerHTML = rows.map((i) => `
    <tr>
      <td>${i.day_label}</td><td>${i.time_label || '-'}</td><td>${i.title}</td><td>${i.location || '-'}</td>
      <td>${canDelete() ? `<button class="btn danger small" onclick="deleteTourItinItem(${i.id})">Delete</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">No itinerary items yet</td></tr>';
}
window.deleteTourItinItem = async (itemId) => {
  await jdel(`${API}/pretours/itinerary/${itemId}`);
  toast('Itinerary item removed');
  refreshTourItinerary();
};
document.getElementById('tourItinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentTourId) { toast('Click "Manage" on a tour first'); return; }
  const body = Object.fromEntries(new FormData(e.target).entries());
  try {
    await jpost(`${API}/pretours/${currentTourId}/itinerary`, body);
    e.target.reset();
    toast('Itinerary item added');
    refreshTourItinerary();
  } catch (err) { toast(err.message); }
});

async function refreshTourParticipants() {
  if (!currentTourId) return;
  const rows = await jget(`${API}/pretours/${currentTourId}/participants`);
  document.getElementById('tourPartTableBody').innerHTML = rows.map((r) => `
    <tr>
      <td>${r.participant_name || r.host_member_name}</td>
      <td>${r.participant_id ? 'Delegate' : 'Host member'}</td>
      <td>${r.participant_phone || r.host_member_phone || '-'}</td>
      <td><select onchange="updateTourParticipantPayment(${r.id}, this.value)">
        <option value="pending" ${r.payment_status === 'pending' ? 'selected' : ''}>Pending</option>
        <option value="paid" ${r.payment_status === 'paid' ? 'selected' : ''}>Paid</option>
      </select></td>
      <td>${canDelete() ? `<button class="btn danger small" onclick="deleteTourParticipant(${r.id})">Remove</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">No signups yet</td></tr>';
  refreshPreTours(); // keep the signup counts on the tours table fresh
}
window.updateTourParticipantPayment = async (rowId, payment_status) => {
  try { await jput(`${API}/pretours/participants/${rowId}`, { payment_status }); toast('Payment status updated'); } catch (err) { toast(err.message); }
};
window.deleteTourParticipant = async (rowId) => {
  await jdel(`${API}/pretours/participants/${rowId}`);
  toast('Removed from tour');
  refreshTourParticipants();
};
document.getElementById('tourPartTypeSelect').addEventListener('change', (e) => {
  const isHm = e.target.value === 'host_member';
  document.getElementById('tourPartParticipantSelect').style.display = isHm ? 'none' : '';
  document.getElementById('tourPartHmSelect').style.display = isHm ? '' : 'none';
});
document.getElementById('tourPartForm').addEventListener('submit', async (e) => {
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
    await jpost(`${API}/pretours/${currentTourId}/participants`, body);
    toast('Added to tour');
    refreshTourParticipants();
  } catch (err) { toast(err.message); }
});

async function refreshTourTrips() {
  if (!currentTourId) return;
  const rows = await jget(`${API}/transport?pre_tour_id=${currentTourId}`);
  document.getElementById('tourTripTableBody').innerHTML = rows.map((t) => `
    <tr>
      <td>${t.trip_date || '-'}</td>
      <td>${t.from_location} → ${t.to_location}</td>
      <td>${t.partner_name || '-'}</td>
      <td>${t.vehicle_code || '-'}</td>
      <td>${t.driver_name || '-'}</td>
      <td>${capacityBadge(Number(t.passenger_count), t.seating_capacity)}</td>
      <td class="sticky-actions">
        <button class="btn small" onclick="downloadTripPdf(${t.id})">PDF</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteTourTrip(${t.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty">No transport planned yet</td></tr>';
}
window.deleteTourTrip = async (id) => { await jdel(`${API}/transport/${id}`); toast('Trip removed'); refreshTourTrips(); refreshPreTours(); };
document.getElementById('tourTripForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentTourId) { toast('Click "Manage" on a tour first'); return; }
  const body = Object.fromEntries(new FormData(e.target).entries());
  if (!body.driver_id) delete body.driver_id;
  if (!body.partner_id) delete body.partner_id;
  body.pre_tour_id = currentTourId;
  try {
    await jpost(`${API}/transport`, body);
    e.target.reset();
    toast('Trip added');
    if (body.from_location) ensureTransportPoint(body.from_location);
    if (body.to_location) ensureTransportPoint(body.to_location);
    refreshTourTrips();
    refreshPreTours();
  } catch (err) { toast(err.message); }
});

// --- Shared PDF design kit ---------------------------------------------
// Pure client-side (jsPDF, loaded via CDN in admin.html) — no backend
// involved. Every downloadable PDF in the admin panel (handover manifests,
// payment receipts, and the per-module "Download PDF" list/detail reports)
// is built from these same primitives, so the whole app has one consistent,
// branded look: a letterhead with both Skål logos, the brand navy/lightblue
// palette, styled tables, status badges, and a page-numbered footer.
const PDF_BRAND = {
  navy: [49, 70, 145],
  navyDeep: [32, 47, 94],
  lightblue: [101, 168, 222],
  grey: [89, 89, 91],
  greyLight: [140, 140, 142],
  rowTint: [244, 246, 251],
  border: [222, 226, 236],
  paid: [34, 148, 83],
  pending: [199, 130, 20],
  overdue: [196, 62, 62],
  neutral: [140, 140, 142],
};
const PDF_PAGE_W = 595;
const PDF_MARGIN = 40;
const PDF_CONTENT_RIGHT = PDF_PAGE_W - PDF_MARGIN;
const PDF_CONTENT_BOTTOM = 780;

let PDF_LOGO_CACHE = null;
// R2-hosted photos (person photo_url etc.) live on a different origin than
// this admin panel. Cloudflare's bot-mitigation in front of the public
// r2.dev bucket domain blocks programmatic fetch()/CORS-mode requests for
// these objects with a 503 — a plain <img> tag load still works fine (which
// is why record-card thumbnails look normal even though embedding that same
// photo into a jsPDF badge/PDF silently failed and fell back to a
// placeholder). Rerouting r2.dev URLs through our own backend's
// /media/proxy-image endpoint — which fetches the object server-side via
// the R2 API rather than hitting the public URL — sidesteps this entirely,
// and since the response then comes from our own API's origin (with normal
// CORS headers), the browser can also safely read it into a canvas for
// cropping without a taint error.
function pdfImageToDataUrl(path) {
  const fetchUrl = (/^https?:\/\//.test(path) && path.includes('r2.dev'))
    ? `${API}/media/proxy-image?url=${encodeURIComponent(path)}`
    : path;
  return fetch(fetchUrl)
    .then((res) => res.blob())
    .then((blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }));
}
// Fetches + caches both letterhead logos (Skål International + the Skål
// Coimbatore host club) as base64 data URIs so jsPDF can embed them. Only
// fetched once per page load; every PDF after that reuses the cached copy.
async function getPdfLogos() {
  if (PDF_LOGO_CACHE) return PDF_LOGO_CACHE;
  try {
    const [skal, coimbatore] = await Promise.all([
      pdfImageToDataUrl('img/skal-logo.png'),
      pdfImageToDataUrl('img/skal-coimbatore-logo.png'),
    ]);
    PDF_LOGO_CACHE = {
      skal: { dataUrl: skal, ratio: 480 / 279 },
      coimbatore: { dataUrl: coimbatore, ratio: 938 / 195 },
    };
  } catch (err) {
    PDF_LOGO_CACHE = { skal: null, coimbatore: null };
  }
  return PDF_LOGO_CACHE;
}
// Fits an image into a maxW x maxH box, preserving aspect ratio (like
// object-fit: contain).
function pdfFitImage(ratio, maxW, maxH) {
  let w = maxW, h = w / ratio;
  if (h > maxH) { h = maxH; w = h * ratio; }
  return { w, h };
}

function pdfDoc() {
  const { jsPDF } = window.jspdf;
  return new jsPDF({ unit: 'pt', format: 'a4' });
}
function pdfMaybeNewPage(doc, y, needed) {
  if (y + needed > PDF_CONTENT_BOTTOM) { doc.addPage(); return 44; }
  return y;
}
function pdfSetColor(doc, method, color) { doc[method](color[0], color[1], color[2]); }

// Draws the branded banner (both logos + congress name on a navy field),
// the document title/subtitle beneath it, and returns the y cursor where
// body content should start. Async because the logos are fetched lazily.
async function pdfLetterhead(doc, title, subtitle) {
  const logos = await getPdfLogos();
  const bannerH = 70;
  pdfSetColor(doc, 'setFillColor', PDF_BRAND.navy);
  doc.rect(0, 0, PDF_PAGE_W, bannerH, 'F');
  pdfSetColor(doc, 'setFillColor', PDF_BRAND.lightblue);
  doc.rect(0, bannerH, PDF_PAGE_W, 3, 'F');

  let logoX = PDF_MARGIN;
  if (logos.skal) {
    const { w, h } = pdfFitImage(logos.skal.ratio, 62, 34);
    doc.addImage(logos.skal.dataUrl, 'PNG', logoX, (bannerH - h) / 2, w, h);
    logoX += w + 14;
  }
  if (logos.coimbatore) {
    const { w, h } = pdfFitImage(logos.coimbatore.ratio, 128, 30);
    doc.addImage(logos.coimbatore.dataUrl, 'PNG', logoX, (bannerH - h) / 2, w, h);
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont(undefined, 'bold'); doc.setFontSize(15);
  doc.text('SINC2026', PDF_CONTENT_RIGHT, 30, { align: 'right' });
  doc.setFont(undefined, 'normal'); doc.setFontSize(8.5);
  doc.text('Skål International India National Congress · Coimbatore', PDF_CONTENT_RIGHT, 45, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  let y = bannerH + 34;
  pdfSetColor(doc, 'setTextColor', PDF_BRAND.navy);
  doc.setFont(undefined, 'bold'); doc.setFontSize(16);
  doc.text(title, PDF_MARGIN, y);
  doc.setTextColor(0, 0, 0);
  if (subtitle) {
    y += 16;
    pdfSetColor(doc, 'setTextColor', PDF_BRAND.grey);
    doc.setFont(undefined, 'normal'); doc.setFontSize(9.5);
    doc.text(subtitle, PDF_MARGIN, y);
    doc.setTextColor(0, 0, 0);
  }
  y += 12;
  pdfSetColor(doc, 'setDrawColor', PDF_BRAND.border);
  doc.setLineWidth(0.75);
  doc.line(PDF_MARGIN, y, PDF_CONTENT_RIGHT, y);
  return y + 20;
}

// Adds the "Generated <date> · SINC2026 Admin  ·  Page X of N" footer to
// every page. Must be called last, once the document is fully built, since
// the total page count isn't known until then.
function pdfFinalize(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    pdfSetColor(doc, 'setDrawColor', PDF_BRAND.border);
    doc.setLineWidth(0.75);
    doc.line(PDF_MARGIN, 810, PDF_CONTENT_RIGHT, 810);
    doc.setFont(undefined, 'normal'); doc.setFontSize(8);
    pdfSetColor(doc, 'setTextColor', PDF_BRAND.greyLight);
    doc.text(`Generated ${dateStr} · SINC2026 Admin`, PDF_MARGIN, 823);
    doc.text(`Page ${i} of ${pageCount}`, PDF_CONTENT_RIGHT, 823, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  }
}

function badgeUrlFor(token) {
  return `${window.location.origin}/badge.html?token=${encodeURIComponent(token)}`;
}
async function getQrDataUrl(token, sizePx) {
  return window.QRCode.toDataURL(badgeUrlFor(token), { width: sizePx || 300, margin: 1 });
}
// Badge photos are square headshots, but source photos are almost never
// exactly square — feeding a non-square image straight into jsPDF's
// addImage(w, h) stretches/squashes it to fit the box. This crops a centered
// square out of the source first (like CSS object-fit:cover), so the photo
// on the printed badge looks like a normal portrait, not squeezed.
//
// Important: photos live on a different origin (Cloudflare R2). Loading a
// cross-origin image straight into an <img>/<canvas> "taints" the canvas —
// canvas.toDataURL() then throws a SecurityError, which the caller's
// try/catch swallows, silently falling back to the initial-letter circle
// (this is why photos were disappearing even though photo_url was set).
// Routing through pdfImageToDataUrl() first (a plain fetch+blob, no canvas
// involved) turns it into a same-origin data: URL — THEN drawing that into
// a canvas for cropping is safe and toDataURL() works.
function pdfSquarePhotoDataUrl(path, size) {
  return pdfImageToDataUrl(path).then((rawDataUrl) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        // A dead-center vertical crop chops off the top of the head on most
        // headshots — portrait photos typically have some headroom above the
        // face and noticeably more empty chest/shoulder space below it, so
        // splitting the removed height 50/50 removes too much from the top.
        // Biasing the crop window upward (only 20% of the excess height comes
        // off the top, 80% off the bottom) keeps the whole head in frame and
        // trims the safe-to-lose space below the chin/shoulders instead.
        const excessHeight = img.naturalHeight - side;
        const sy = excessHeight > 0 ? excessHeight * 0.2 : 0;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch (err) { reject(err); }
    };
    img.onerror = reject;
    img.src = rawDataUrl;
  }));
}
// Draws the raw QR code onto a taller canvas with the person's name printed
// underneath in small text — same idea as the tiny caption under the QR on
// the printed badge, but for the standalone QR PNG download so it's still
// identifiable on its own without the rest of the badge around it.
window.downloadQrPng = async (token, name) => {
  try {
    const qrDataUrl = await getQrDataUrl(token, 480);
    const composedDataUrl = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const qrSize = img.naturalWidth;
          const fontSize = 20;
          const lineHeight = fontSize * 1.35;
          const padTop = 18;
          const padBottom = 14;
          const measureCtx = document.createElement('canvas').getContext('2d');
          measureCtx.font = `600 ${fontSize}px Arial, sans-serif`;
          const words = (name || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
          const maxTextWidth = qrSize - 32;
          const lines = [];
          let line = '';
          words.forEach((w) => {
            const test = line ? line + ' ' + w : w;
            if (line && measureCtx.measureText(test).width > maxTextWidth) {
              lines.push(line);
              line = w;
            } else {
              line = test;
            }
          });
          if (line) lines.push(line);
          const captionH = lines.length ? padTop + lines.length * lineHeight + padBottom : 0;
          const canvas = document.createElement('canvas');
          canvas.width = qrSize;
          canvas.height = qrSize + captionH;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, qrSize, qrSize);
          ctx.fillStyle = '#4b5563';
          ctx.font = `600 ${fontSize}px Arial, sans-serif`;
          ctx.textAlign = 'center';
          lines.forEach((ln, i) => {
            ctx.fillText(ln, qrSize / 2, qrSize + padTop + fontSize * 0.85 + i * lineHeight);
          });
          resolve(canvas.toDataURL('image/png'));
        } catch (err) { reject(err); }
      };
      img.onerror = reject;
      img.src = qrDataUrl;
    });
    const a = document.createElement('a');
    a.href = composedDataUrl;
    a.download = `qr-${(name || 'badge').replace(/[^a-z0-9]+/gi, '_')}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) { toast('Could not generate QR code: ' + err.message); }
};
// Simplified badge layout (per Ajai's request): no header banner/logo, no
// photo, no footer/divider — just a bold name, role/org, and a larger QR.
// Kept as its own function (rather than deleting the richer version above)
// so the photo/banner styling is easy to restore later if wanted; this is
// just what buildBadgePdf renders now.
async function buildBadgePdf(person) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: [288, 432] });
  const W = 288;
  let y = 56;
  // Bolder, bigger name than before (was 14pt) — the sample layout wants the
  // name to read clearly from a distance with nothing else competing for
  // attention above it.
  pdfSetColor(doc, 'setTextColor', PDF_BRAND.navy);
  doc.setFont(undefined, 'bold'); doc.setFontSize(20);
  const nameLines = doc.splitTextToSize((person.name || '').toUpperCase(), W - 24);
  doc.text(nameLines, W / 2, y, { align: 'center' });
  y += nameLines.length * 24 + 10;
  doc.setFont(undefined, 'normal'); doc.setFontSize(11);
  pdfSetColor(doc, 'setTextColor', PDF_BRAND.grey);
  if (person.roleLabel) {
    const roleLines = doc.splitTextToSize(person.roleLabel, W - 30);
    doc.text(roleLines, W / 2, y, { align: 'center' });
    y += roleLines.length * 14;
  }
  if (person.orgLabel) {
    const orgLines = doc.splitTextToSize(person.orgLabel, W - 30);
    doc.text(orgLines, W / 2, y, { align: 'center' });
    y += orgLines.length * 14;
  }
  doc.setTextColor(0, 0, 0);
  y += 40;
  // Bigger QR than before (was 104pt) — nothing else on the card now, so it
  // can take up most of the remaining width/height.
  const qrSize = 172;
  try {
    const qrDataUrl = await getQrDataUrl(person.badge_token, 500);
    doc.addImage(qrDataUrl, 'PNG', (W - qrSize) / 2, y, qrSize, qrSize);
  } catch (err) { /* skip QR if generation failed — badge is still usable */ }
  return doc;
};
window.downloadParticipantBadge = async (id) => {
  try {
    const p = await jget(`${API}/participants/${id}`);
    if (!p.badge_token) { toast('This delegate has no QR badge token yet — refresh the page and try again.'); return; }
    const doc = await buildBadgePdf({
      name: p.name, photo_url: p.photo_url, badge_token: p.badge_token,
      roleLabel: 'Delegate' + (p.designation ? ' · ' + p.designation : ''),
      orgLabel: p.club_name || ''
    });
    doc.save(`badge-${(p.name || 'delegate').replace(/[^a-z0-9]+/gi, '_')}.pdf`);
  } catch (err) { toast(err.message); }
};
window.downloadHostMemberBadge = async (id) => {
  try {
    const h = await jget(`${API}/hostmembers/${id}`);
    if (!h.badge_token) { toast('This host member has no QR badge token yet — refresh the page and try again.'); return; }
    const doc = await buildBadgePdf({
      name: h.name, photo_url: h.photo_url, badge_token: h.badge_token,
      roleLabel: h.designation || 'Host Member',
      orgLabel: h.company || ''
    });
    doc.save(`badge-${(h.name || 'host_member').replace(/[^a-z0-9]+/gi, '_')}.pdf`);
  } catch (err) { toast(err.message); }
};

// --- Bulk badge ZIP export ---
// Hands the full set of generated badges (as individual print-ready PDFs,
// one per delegate/host member) to Ajai as a single ZIP, so it can be sent
// straight to an outside print vendor without giving the vendor any login
// or system access. Only records that already have a badge_token are
// included — anyone without one is silently skipped.
async function buildBadgesZip(records, kind, zipNamePrefix) {
  if (typeof JSZip === 'undefined') { toast('ZIP library did not load — refresh the page and try again.'); return; }
  const withToken = records.filter((r) => r.badge_token);
  if (!withToken.length) { toast('No badges have been generated for these records yet.'); return; }
  toast(`Generating ${withToken.length} badge(s) for ZIP — this can take a little while, please wait...`, 6000);
  const zip = new JSZip();
  let ok = 0, failed = 0;
  for (const r of withToken) {
    try {
      const doc = await buildBadgePdf({
        name: r.name, photo_url: r.photo_url, badge_token: r.badge_token,
        roleLabel: kind === 'delegate' ? ('Delegate' + (r.designation ? ' · ' + r.designation : '')) : (r.designation || 'Host Member'),
        orgLabel: kind === 'delegate' ? (r.club_name || '') : (r.company || '')
      });
      const blob = doc.output('blob');
      const safeName = (r.name || 'badge').replace(/[^a-z0-9]+/gi, '_');
      zip.file(`badge-${safeName}-${r.id}.pdf`, blob);
      ok++;
    } catch (err) { failed++; }
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${zipNamePrefix}-badges-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`Done — ${ok} badge(s) zipped${failed ? `, ${failed} failed` : ''}. Check your Downloads folder.`, 6000);
}
window.downloadAllDelegateBadgesZip = async () => {
  try {
    const rows = await jget(`${API}/participants`);
    await buildBadgesZip(rows, 'delegate', 'sinc2026-delegate');
  } catch (err) { toast(err.message); }
};
window.downloadAllHostMemberBadgesZip = async () => {
  try {
    const rows = await jget(`${API}/hostmembers`);
    await buildBadgesZip(rows, 'host-member', 'sinc2026-hostmember');
  } catch (err) { toast(err.message); }
};

function pdfSectionLabel(doc, y, label) {
  y = pdfMaybeNewPage(doc, y, 26);
  pdfSetColor(doc, 'setFillColor', PDF_BRAND.lightblue);
  doc.rect(PDF_MARGIN, y - 9, 3, 12, 'F');
  pdfSetColor(doc, 'setTextColor', PDF_BRAND.navy);
  doc.setFont(undefined, 'bold'); doc.setFontSize(11);
  doc.text(label, PDF_MARGIN + 10, y);
  doc.setTextColor(0, 0, 0);
  return y + 16;
}
function pdfKeyValues(doc, y, pairs) {
  doc.setFontSize(9.5);
  pairs.forEach(([k, v]) => {
    y = pdfMaybeNewPage(doc, y, 14);
    pdfSetColor(doc, 'setTextColor', PDF_BRAND.navy);
    doc.setFont(undefined, 'bold'); doc.text(`${k}:`, PDF_MARGIN, y);
    doc.setTextColor(30, 30, 30);
    doc.setFont(undefined, 'normal'); doc.text(String(v === null || v === undefined || v === '' ? '-' : v), 150, y, { maxWidth: 400 });
    doc.setTextColor(0, 0, 0);
    y += 14;
  });
  return y + 8;
}
// Styled table: navy header with white text, zebra-striped body rows, thin
// borders — re-draws the header after each page break. Row height is
// computed per-row from the actual wrapped line count of each cell (via
// jsPDF's splitTextToSize), so long company names / multi-item lists like
// Committees wrap onto extra lines within their own row instead of
// overflowing into — and visually overlapping — the row below.
function pdfTable(doc, y, columns, rows) {
  const startX = PDF_MARGIN;
  const xs = [];
  let x = startX;
  columns.forEach((c) => { xs.push(x); x += c.width; });
  const tableRight = xs[xs.length - 1] + columns[columns.length - 1].width;
  const headerRowHeight = 17;
  const lineHeight = 10.5; // vertical spacing between wrapped lines within a cell
  const minRowHeight = 17; // same as the old fixed height, for single-line rows
  const rowBottomPad = 6;  // breathing room below the last line before the next row
  function drawHeader() {
    pdfSetColor(doc, 'setFillColor', PDF_BRAND.navy);
    doc.rect(startX, y - 11, tableRight - startX, headerRowHeight, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'bold'); doc.setFontSize(8.5);
    columns.forEach((c, i) => doc.text(c.label, xs[i] + 4, y + 1, c.align === 'right' ? { align: 'right', maxWidth: 0 } : {}));
    doc.setTextColor(0, 0, 0);
    y += headerRowHeight;
    doc.setFont(undefined, 'normal'); doc.setFontSize(8.8);
  }
  function cellWidth(i) {
    return i < columns.length - 1 ? (xs[i + 1] - xs[i] - 8) : (tableRight - xs[i] - 4);
  }
  y = pdfMaybeNewPage(doc, y, 34);
  drawHeader();
  if (!rows.length) {
    pdfSetColor(doc, 'setTextColor', PDF_BRAND.greyLight);
    doc.text('None', startX + 4, y + 2);
    doc.setTextColor(0, 0, 0);
    return y + headerRowHeight;
  }
  rows.forEach((row, ri) => {
    // Wrap every cell's text to its column width first, so we know how many
    // lines the tallest cell in this row needs before drawing anything.
    const cellLines = row.map((cell, i) => {
      const text = String(cell === null || cell === undefined || cell === '' ? '-' : cell);
      return doc.splitTextToSize(text, cellWidth(i));
    });
    const maxLines = Math.max(1, ...cellLines.map((lines) => lines.length));
    const rowHeight = Math.max(minRowHeight, maxLines * lineHeight + rowBottomPad);

    if (y + rowHeight > PDF_CONTENT_BOTTOM) { doc.addPage(); y = 44; drawHeader(); }
    if (ri % 2 === 1) {
      pdfSetColor(doc, 'setFillColor', PDF_BRAND.rowTint);
      doc.rect(startX, y - 11, tableRight - startX, rowHeight, 'F');
    }
    row.forEach((cell, i) => {
      const w = cellWidth(i);
      cellLines[i].forEach((line, li) => {
        const ly = y + 1 + li * lineHeight;
        if (columns[i].align === 'right') doc.text(line, xs[i] + w, ly, { align: 'right', maxWidth: w });
        else doc.text(line, xs[i] + 4, ly, { maxWidth: w });
      });
    });
    y += rowHeight;
  });
  pdfSetColor(doc, 'setDrawColor', PDF_BRAND.border);
  doc.setLineWidth(0.5);
  doc.line(startX, y - 11, tableRight, y - 11);
  return y + 10;
}
// Small rounded status pill (Paid / Pending / Overdue / etc.) — used on
// receipts and in detail sheets wherever a payment/status field appears.
function pdfBadge(doc, x, y, text, kind) {
  const color = PDF_BRAND[kind] || PDF_BRAND.neutral;
  doc.setFont(undefined, 'bold'); doc.setFontSize(9);
  const w = doc.getTextWidth(text) + 16;
  pdfSetColor(doc, 'setFillColor', color);
  doc.roundedRect(x, y - 10, w, 15, 7, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text(text, x + w / 2, y, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  return w;
}
function pdfSignatureBlock(doc, y) {
  y = pdfMaybeNewPage(doc, y, 60);
  y += 14;
  doc.setFontSize(9.5); doc.setFont(undefined, 'normal');
  doc.text('Confirmed by (representative): ______________________________', PDF_MARGIN, y); y += 22;
  doc.text('Signature: __________________________     Date: ______________', PDF_MARGIN, y);
  return y;
}
// Generic "download the full list of a module as a styled PDF report"
// helper, reused by every "Download PDF" button across the admin panel.
async function downloadListReportPdf(title, subtitle, columns, rows, filename) {
  const doc = pdfDoc();
  let y = await pdfLetterhead(doc, title, subtitle);
  y = pdfTable(doc, y, columns, rows.map((r) => columns.map((c) => c.get(r))));
  pdfFinalize(doc);
  doc.save(filename);
}
// Generic "download one record as a styled detail sheet" helper. `sections`
// is an array of { label, pairs } and/or { label, table: { columns, rows } }.
async function downloadDetailPdf(title, subtitle, sections, filename) {
  const doc = pdfDoc();
  let y = await pdfLetterhead(doc, title, subtitle);
  sections.forEach((sec) => {
    if (sec.label) y = pdfSectionLabel(doc, y, sec.label);
    if (sec.pairs) y = pdfKeyValues(doc, y, sec.pairs);
    if (sec.table) y = pdfTable(doc, y, sec.table.columns, sec.table.rows);
    y += 4;
  });
  pdfFinalize(doc);
  doc.save(filename);
}
function pdfAddTripBlock(doc, y, trip) {
  y = pdfMaybeNewPage(doc, y, 90);
  y = pdfKeyValues(doc, y, [
    ['Route', `${trip.from_location} → ${trip.to_location}`],
    ['Date / Time', `${trip.trip_date || '-'} ${trip.depart_time || ''}`.trim()],
    ['Purpose', trip.purpose],
    ['Vehicle', trip.vehicle_code ? `${trip.vehicle_code} — ${trip.vehicle_type}${trip.vehicle_model ? ' (' + trip.vehicle_model + ')' : ''}` : 'Unassigned'],
    ['Driver', trip.driver_name ? `${trip.driver_name} — ${trip.driver_phone || 'no phone on file'}` : 'Unassigned']
  ]);
  const passengerRows = (trip.passengers || []).map((p, i) => [
    i + 1,
    p.participant_name || p.host_member_name,
    p.participant_id ? 'Delegate' : 'Host Member',
    p.participant_phone || p.host_member_phone,
    p.pickup_point
  ]);
  y = pdfTable(doc, y, [
    { label: '#', width: 22 },
    { label: 'Name', width: 150 },
    { label: 'Type', width: 75 },
    { label: 'Mobile', width: 95 },
    { label: 'Pickup point', width: 150 }
  ], passengerRows);
  return y + 6;
}
window.downloadTripPdf = async (tripId) => {
  try {
    const trip = await jget(`${API}/transport/${tripId}`);
    const doc = pdfDoc();
    let y = await pdfLetterhead(doc, 'Transport Trip Manifest', `${trip.from_location} → ${trip.to_location}`);
    y = pdfAddTripBlock(doc, y, trip);
    pdfSignatureBlock(doc, y);
    pdfFinalize(doc);
    doc.save(`trip-manifest-${tripId}.pdf`);
  } catch (err) { toast(err.message); }
};
window.downloadPreTourPdf = async (tourId) => {
  try {
    const tour = await jget(`${API}/pretours/${tourId}`);
    const participants = await jget(`${API}/pretours/${tourId}/participants`);
    const tripsList = await jget(`${API}/transport?pre_tour_id=${tourId}`);
    const trips = await Promise.all(tripsList.map((t) => jget(`${API}/transport/${t.id}`)));

    const doc = pdfDoc();
    let y = await pdfLetterhead(doc, `Pre Tour Manifest — ${tour.name}`,
      [tour.start_date && tour.end_date ? `${tour.start_date} to ${tour.end_date}` : (tour.start_date || ''), tour.hotel].filter(Boolean).join('  ·  '));

    y = pdfSectionLabel(doc, y, 'Signed-up delegates / host members');
    const partRows = participants.map((p, i) => [
      i + 1,
      p.participant_name || p.host_member_name,
      p.participant_id ? 'Delegate' : 'Host Member',
      p.participant_phone || p.host_member_phone,
      p.payment_status
    ]);
    y = pdfTable(doc, y, [
      { label: '#', width: 22 }, { label: 'Name', width: 160 }, { label: 'Type', width: 80 },
      { label: 'Mobile', width: 100 }, { label: 'Payment', width: 80 }
    ], partRows);
    y += 10;

    if (trips.length) {
      y = pdfSectionLabel(doc, y, 'Transport');
      for (const trip of trips) {
        y = pdfAddTripBlock(doc, y, trip);
      }
    }
    pdfSignatureBlock(doc, y);
    pdfFinalize(doc);
    doc.save(`pretour-manifest-${tourId}.pdf`);
  } catch (err) { toast(err.message); }
};

// --- List-report PDFs: Transport Trips + Pre Tours -----------------------
window.downloadTransportTripsListPdf = async () => {
  try {
    const rows = await jget(`${API}/transport?pre_tour_id=none`);
    await downloadListReportPdf('Transport Trips', `${rows.length} trip(s) scheduled`, [
      { label: 'Date', width: 65, get: (r) => r.trip_date },
      { label: 'Time', width: 45, get: (r) => r.depart_time },
      { label: 'From', width: 105, get: (r) => r.from_location },
      { label: 'To', width: 105, get: (r) => r.to_location },
      { label: 'Vehicle', width: 75, get: (r) => r.vehicle_code },
      { label: 'Driver', width: 85, get: (r) => r.driver_name },
      { label: 'Status', width: 55, get: (r) => (r.status || '').replace('_', ' ') },
    ], rows, 'transport-trips.pdf');
  } catch (err) { toast(err.message); }
};
window.downloadPreToursListPdf = async () => {
  try {
    const rows = await jget(`${API}/pretours`);
    await downloadListReportPdf('Pre Tours', `${rows.length} pre tour(s)`, [
      { label: 'Name', width: 150, get: (r) => r.name },
      { label: 'Dates', width: 130, get: (r) => [r.start_date, r.end_date].filter(Boolean).join(' to ') },
      { label: 'Hotel', width: 130, get: (r) => r.hotel },
      { label: 'Signed up', width: 105, get: (r) => r.participant_count },
    ], rows, 'pre-tours.pdf');
  } catch (err) { toast(err.message); }
};

// --- Payment Receipt PDF (Registrations & Payments) -----------------------
// One receipt per registration — covers whichever delegate(s) that
// registration includes (1 for single/congress-only, 2 for double). This is
// a payment receipt, not a formal tax invoice: no GST/tax breakdown, since
// the congress registration fee isn't a taxed line item.
const REG_TYPE_FULL_LABEL = {
  single: 'Single Occupancy Registration',
  double: 'Double Occupancy Registration',
  congress_only: 'Congress Only Registration (no room)'
};
function receiptStatusBadgeKind(status) {
  if (status === 'paid') return 'paid';
  if (status === 'partial') return 'pending';
  if (status === 'refunded') return 'overdue';
  return 'neutral'; // pending
}
function receiptStatusLabel(status) {
  return { paid: 'PAID', partial: 'PARTIALLY PAID', pending: 'PAYMENT PENDING', refunded: 'REFUNDED' }[status] || String(status || '').toUpperCase();
}
// Draws one full receipt (letterhead through totals + delegate list) onto
// `doc`, starting a fresh page first unless `firstPage` is true. Shared by
// both the single-receipt download and the "download all" combined PDF.
async function pdfAddReceiptBody(doc, reg, delegates, firstPage) {
  if (!firstPage) doc.addPage();
  const total = Number(reg.amount_paid || 0) + Number(reg.amount_due || 0);
  let y = await pdfLetterhead(doc, 'Payment Receipt', `Receipt No. ${reg.reg_number}  ·  Issued ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`);

  // Faint diagonal "PAID" watermark for fully settled receipts — a familiar
  // invoice cue that reads as reassuring rather than gimmicky.
  if (reg.payment_status === 'paid') {
    doc.setFont(undefined, 'bold'); doc.setFontSize(70);
    doc.setTextColor(236, 243, 233);
    doc.text('PAID', 300, 430, { align: 'center', angle: 30 });
    doc.setTextColor(0, 0, 0);
  }

  pdfBadge(doc, PDF_CONTENT_RIGHT - 110, y - 14, receiptStatusLabel(reg.payment_status), receiptStatusBadgeKind(reg.payment_status));

  y = pdfSectionLabel(doc, y, 'Billed To');
  y = pdfKeyValues(doc, y, [
    ['Club', reg.club_name || '-'],
    ['Registration Type', REG_TYPE_FULL_LABEL[reg.reg_type] || reg.reg_type],
    ['Delegate(s)', delegates.map((d) => `${d.name} (${Number(d.is_primary) === 1 ? 'Primary' : 'Co-registrant'})`).join(', ') || '-'],
  ]);

  y = pdfSectionLabel(doc, y, 'Payment Details');
  y = pdfTable(doc, y, [
    { label: 'Description', width: 355 },
    { label: 'Amount (₹)', width: 160, align: 'right' },
  ], [[`${REG_TYPE_FULL_LABEL[reg.reg_type] || reg.reg_type} — ${reg.reg_number}`, total.toLocaleString('en-IN')]]);

  y += 4;
  const summaryX = PDF_CONTENT_RIGHT - 220;
  [
    ['Total Amount', total],
    ['Amount Paid', Number(reg.amount_paid || 0)],
    ['Balance Due', Number(reg.amount_due || 0)],
  ].forEach(([label, amt], i) => {
    y = pdfMaybeNewPage(doc, y, 16);
    doc.setFont(undefined, i === 2 ? 'bold' : 'normal'); doc.setFontSize(10);
    pdfSetColor(doc, 'setTextColor', i === 2 ? PDF_BRAND.navy : [30, 30, 30]);
    doc.text(label, summaryX, y);
    doc.text(`₹${amt.toLocaleString('en-IN')}`, PDF_CONTENT_RIGHT, y, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    y += 15;
  });

  y = pdfSectionLabel(doc, y + 8, 'Payment Information');
  y = pdfKeyValues(doc, y, [
    ['Payment Mode', reg.payment_mode || '-'],
    ['Payment Reference', reg.payment_ref || '-'],
  ]);

  const qrDelegates = delegates.filter((d) => d.badge_token);
  if (qrDelegates.length) {
    y = pdfSectionLabel(doc, y + 8, 'Delegate QR Codes');
    y = pdfMaybeNewPage(doc, y, 90);
    const qrSize = 62;
    const gap = 24;
    let qx = PDF_MARGIN;
    for (const d of qrDelegates) {
      try {
        const dataUrl = await getQrDataUrl(d.badge_token, 300);
        doc.addImage(dataUrl, 'PNG', qx, y, qrSize, qrSize);
        doc.setFont(undefined, 'normal'); doc.setFontSize(8);
        pdfSetColor(doc, 'setTextColor', PDF_BRAND.grey);
        doc.text(d.name || '', qx + qrSize / 2, y + qrSize + 11, { align: 'center', maxWidth: qrSize + 20 });
        doc.setTextColor(0, 0, 0);
      } catch (err) { /* skip this delegate's QR if generation failed */ }
      qx += qrSize + gap;
    }
    y += qrSize + 24;
  }

  y = pdfMaybeNewPage(doc, y, 30);
  pdfSetColor(doc, 'setTextColor', PDF_BRAND.greyLight);
  doc.setFont(undefined, 'normal'); doc.setFontSize(8.5);
  doc.text('This receipt confirms the registration payment recorded in the SINC2026 system. For queries, contact the Registration Desk.', PDF_MARGIN, y, { maxWidth: 515 });
  doc.setTextColor(0, 0, 0);
  return y;
}
window.downloadReceiptPdf = async (regId) => {
  try {
    const regs = await jget(`${API}/registrations`);
    const reg = regs.find((r) => r.id === regId);
    if (!reg) { toast('Registration not found'); return; }
    const allParticipants = await jget(`${API}/participants`);
    const delegates = allParticipants.filter((p) => p.registration_id === regId);
    const doc = pdfDoc();
    await pdfAddReceiptBody(doc, reg, delegates, true);
    pdfFinalize(doc);
    doc.save(`receipt-${reg.reg_number}.pdf`);
  } catch (err) { toast(err.message); }
};
window.downloadAllReceiptsPdf = async () => {
  try {
    const regs = await jget(`${API}/registrations`);
    if (!regs.length) { toast('No registrations to generate receipts for'); return; }
    const allParticipants = await jget(`${API}/participants`);
    const doc = pdfDoc();
    for (let i = 0; i < regs.length; i++) {
      const delegates = allParticipants.filter((p) => p.registration_id === regs[i].id);
      await pdfAddReceiptBody(doc, regs[i], delegates, i === 0);
    }
    pdfFinalize(doc);
    doc.save('all-payment-receipts.pdf');
  } catch (err) { toast(err.message); }
};

// --- Per-module "Download PDF" list reports + per-record detail sheets ---
// Every module below follows the same shape: a list export (fetch fresh,
// build a styled table) and, where a single record is meaningful on its
// own, a detail sheet (fetch fresh, find the record, build key/value +
// sub-table sections). All built on the shared kit above, so they share the
// same letterhead, colors, and footer as the receipts and manifests.

// Clubs
window.downloadClubsListPdf = async () => {
  try {
    const rows = await jget(`${API}/clubs`);
    await downloadListReportPdf('Clubs Directory', `${rows.length} club(s) registered`, [
      { label: 'Club Name', width: 190, get: (r) => r.name },
      { label: 'City', width: 100, get: (r) => r.city },
      { label: 'State', width: 90, get: (r) => r.state },
      { label: 'Zone', width: 60, get: (r) => r.zone },
      { label: 'Members', width: 75, get: (r) => r.members_count, align: 'right' },
    ], rows, 'clubs-directory.pdf');
  } catch (err) { toast(err.message); }
};
window.downloadClubDetailPdf = async (id) => {
  try {
    const rows = await jget(`${API}/clubs`);
    const c = rows.find((r) => r.id === id);
    if (!c) { toast('Club not found'); return; }
    await downloadDetailPdf(`Club — ${c.name}`, '', [
      { label: 'Club Details', pairs: [['Name', c.name], ['City', c.city], ['State', c.state], ['Zone', c.zone], ['Members', c.members_count]] },
    ], `club-${c.name}.pdf`);
  } catch (err) { toast(err.message); }
};

// Delegates (Participants)
window.downloadDelegatesListPdf = async () => {
  try {
    const rows = await jget(`${API}/participants`);
    await downloadListReportPdf('Delegates Directory', `${rows.length} delegate(s)`, [
      { label: 'Reg ID', width: 60, get: (r) => r.participant_code },
      { label: 'Name', width: 95, get: (r) => r.name },
      { label: 'Role', width: 55, get: (r) => Number(r.is_primary) === 1 ? 'Primary' : 'Co-reg' },
      { label: 'Club', width: 80, get: (r) => r.club_name },
      { label: 'Reg #', width: 60, get: (r) => r.reg_number },
      { label: 'Phone', width: 65, get: (r) => r.phone },
      { label: 'Shirt', width: 30, get: (r) => r.shirt_size },
      { label: 'Tee', width: 30, get: (r) => r.tshirt_size },
      { label: 'Payment', width: 40, get: (r) => r.payment_status },
    ], rows, 'delegates-directory.pdf');
  } catch (err) { toast(err.message); }
};
window.downloadDelegateDetailPdf = async (id) => {
  try {
    const rows = await jget(`${API}/participants`);
    const p = rows.find((r) => r.id === id);
    if (!p) { toast('Delegate not found'); return; }
    const siblings = rows.filter((r) => r.registration_id && r.registration_id === p.registration_id && r.id !== p.id);
    const roleLabel = Number(p.is_primary) === 1 ? 'Primary registrant' : 'Co-registrant';
    const linkedLabel = siblings.length
      ? siblings.map((s) => `${s.name} (${Number(s.is_primary) === 1 ? 'Primary' : 'Co-registrant'})`).join(', ')
      : '— none, registered alone';
    await downloadDetailPdf(`Delegate — ${p.name}`, p.participant_code ? `Registration ID ${p.participant_code}` : '', [
      { label: 'Delegate Info', pairs: [
        ['Name', p.name], ['Designation', p.designation], ['Club', p.club_name], ['Registration #', p.reg_number],
        ['Registration Role', roleLabel], ['Linked Registrant', linkedLabel],
        ['Phone', p.phone], ['WhatsApp', p.whatsapp], ['Email', p.email], ['Address', p.address],
      ] },
      { label: 'Arrival', pairs: [['Mode', p.travel_mode], ['Number', p.travel_number], ['Date/Time', p.travel_datetime], ['Arrival point', p.arrival_point]] },
      { label: 'Departure', pairs: [['Mode', p.departure_mode], ['Number', p.departure_number], ['Date/Time', p.departure_datetime]] },
      { label: 'Pickup & SPOC', pairs: [
        ['Picked up by', p.pickup_by], ['Vehicle', p.pickup_vehicle], ['Pickup contact', p.pickup_phone],
        ['SPOC', p.spoc_host_member_name || p.spoc_name], ['SPOC phone', p.spoc_host_member_phone || p.spoc_phone],
      ] },
      { label: 'Payment', pairs: [['Status', p.payment_status]] },
    ], `delegate-${p.participant_code || p.name}.pdf`);
  } catch (err) { toast(err.message); }
};

// Host Members
window.downloadHostMembersListPdf = async () => {
  try {
    const rows = await jget(`${API}/hostmembers`);
    await downloadListReportPdf('Host Members Directory', `${rows.length} host member(s)`, [
      { label: 'Name', width: 125, get: (r) => r.name },
      { label: 'Company', width: 110, get: (r) => r.company },
      { label: 'Phone', width: 70, get: (r) => r.phone },
      { label: 'Committees', width: 85, get: (r) => (r.committees || []).map((c) => c.name).join(', ') },
      { label: 'Shirt', width: 35, get: (r) => r.shirt_size },
      { label: 'Tee', width: 35, get: (r) => r.tshirt_size },
      { label: 'Payment', width: 55, get: (r) => r.payment_status },
    ], rows, 'host-members-directory.pdf');
  } catch (err) { toast(err.message); }
};
window.downloadHostMemberDetailPdf = async (id) => {
  try {
    const rows = await jget(`${API}/hostmembers`);
    const h = rows.find((r) => r.id === id);
    if (!h) { toast('Host member not found'); return; }
    await downloadDetailPdf(`Host Member — ${h.name}`, h.designation || '', [
      { label: 'Contact Info', pairs: [['Name', h.name], ['Designation', h.designation], ['Company', h.company], ['Category', h.category], ['Phone', h.phone], ['Email', h.email]] },
      { label: 'Committees', pairs: [['Member of', (h.committees || []).map((c) => c.name).join(', ') || '-']] },
      { label: 'Payment', pairs: [['Status', h.payment_status], ['Amount', `₹${h.payment_amount}`], ['Mode', h.payment_mode], ['Date', h.payment_date]] },
      { label: 'Notes', pairs: [['Notes', h.notes]] },
    ], `host-member-${h.name}.pdf`);
  } catch (err) { toast(err.message); }
};

// Payment Receipt PDF (Host Member's own ₹5,000 host-club contribution) —
// same letterhead/badge/watermark treatment as the delegate Payment Receipt
// above, just for a single host member's own payment instead of a
// registration covering 1-2 delegates. Host members don't have a natural
// receipt number the way registrations have reg_number, so one is
// synthesized as HC-<zero-padded id>.
function hostMemberReceiptNo(h) {
  return `HC-${String(h.id).padStart(6, '0')}`;
}
// Draws one full host-member receipt onto `doc`, starting a fresh page
// first unless `firstPage` is true — shared by the single-receipt download
// and the "download all" combined PDF, same pattern as pdfAddReceiptBody.
async function pdfAddHostMemberReceiptBody(doc, h, firstPage) {
  if (!firstPage) doc.addPage();
  const receiptNo = hostMemberReceiptNo(h);
  let y = await pdfLetterhead(doc, 'Payment Receipt', `Receipt No. ${receiptNo}  ·  Issued ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`);

  if (h.payment_status === 'paid') {
    doc.setFont(undefined, 'bold'); doc.setFontSize(70);
    doc.setTextColor(236, 243, 233);
    doc.text('PAID', 300, 430, { align: 'center', angle: 30 });
    doc.setTextColor(0, 0, 0);
  }

  pdfBadge(doc, PDF_CONTENT_RIGHT - 110, y - 14, h.payment_status === 'paid' ? 'PAID' : 'PAYMENT PENDING', h.payment_status === 'paid' ? 'paid' : 'neutral');

  y = pdfSectionLabel(doc, y, 'Billed To');
  y = pdfKeyValues(doc, y, [
    ['Name', h.name || '-'],
    ['Designation', h.designation || '-'],
    ['Company', h.company || '-'],
  ]);

  y = pdfSectionLabel(doc, y, 'Payment Details');
  y = pdfTable(doc, y, [
    { label: 'Description', width: 355 },
    { label: 'Amount (₹)', width: 160, align: 'right' },
  ], [[`Host Club Contribution — ${receiptNo}`, Number(h.payment_amount || 0).toLocaleString('en-IN')]]);

  y = pdfSectionLabel(doc, y + 8, 'Payment Information');
  y = pdfKeyValues(doc, y, [
    ['Status', receiptStatusLabel(h.payment_status === 'paid' ? 'paid' : 'pending')],
    ['Payment Mode', h.payment_mode || '-'],
    ['Payment Date', h.payment_date ? new Date(h.payment_date).toLocaleDateString('en-IN') : '-'],
  ]);

  if (h.badge_token) {
    y = pdfSectionLabel(doc, y + 8, 'QR Code');
    y = pdfMaybeNewPage(doc, y, 90);
    const qrSize = 62;
    try {
      const dataUrl = await getQrDataUrl(h.badge_token, 300);
      doc.addImage(dataUrl, 'PNG', PDF_MARGIN, y, qrSize, qrSize);
      doc.setFont(undefined, 'normal'); doc.setFontSize(8);
      pdfSetColor(doc, 'setTextColor', PDF_BRAND.grey);
      doc.text(h.name || '', PDF_MARGIN + qrSize / 2, y + qrSize + 11, { align: 'center', maxWidth: qrSize + 20 });
      doc.setTextColor(0, 0, 0);
      y += qrSize + 24;
    } catch (err) { /* skip QR if generation failed — receipt is still valid */ }
  }

  y = pdfMaybeNewPage(doc, y, 30);
  pdfSetColor(doc, 'setTextColor', PDF_BRAND.greyLight);
  doc.setFont(undefined, 'normal'); doc.setFontSize(8.5);
  doc.text('This receipt confirms the host club contribution payment recorded in the SINC2026 system. For queries, contact the Host Club team.', PDF_MARGIN, y, { maxWidth: 515 });
  doc.setTextColor(0, 0, 0);
  return y;
}
window.downloadHostMemberReceiptPdf = async (id) => {
  try {
    const rows = await jget(`${API}/hostmembers`);
    const h = rows.find((r) => r.id === id);
    if (!h) { toast('Host member not found'); return; }
    const doc = pdfDoc();
    await pdfAddHostMemberReceiptBody(doc, h, true);
    pdfFinalize(doc);
    doc.save(`receipt-${hostMemberReceiptNo(h)}.pdf`);
  } catch (err) { toast(err.message); }
};
window.downloadAllHostMemberReceiptsPdf = async () => {
  try {
    const rows = await jget(`${API}/hostmembers`);
    if (!rows.length) { toast('No host members to generate receipts for'); return; }
    const doc = pdfDoc();
    for (let i = 0; i < rows.length; i++) {
      await pdfAddHostMemberReceiptBody(doc, rows[i], i === 0);
    }
    pdfFinalize(doc);
    doc.save('all-host-member-receipts.pdf');
  } catch (err) { toast(err.message); }
};

// Payment Receipt PDF (Sponsorship payment) — same letterhead/badge/
// watermark treatment as the delegate/host-member receipts above, for a
// single sponsor's own sponsorship payment. Sponsors don't have a natural
// receipt number, so one is synthesized as SP-RC-<zero-padded id>
// (distinct from the sponsor's SP-#### pass code).
function sponsorReceiptNo(s) {
  return `SP-RC-${String(s.id).padStart(6, '0')}`;
}
async function pdfAddSponsorReceiptBody(doc, s, firstPage) {
  if (!firstPage) doc.addPage();
  const receiptNo = sponsorReceiptNo(s);
  let y = await pdfLetterhead(doc, 'Payment Receipt', `Receipt No. ${receiptNo}  ·  Issued ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`);

  if (s.payment_status === 'paid') {
    doc.setFont(undefined, 'bold'); doc.setFontSize(70);
    doc.setTextColor(236, 243, 233);
    doc.text('PAID', 300, 430, { align: 'center', angle: 30 });
    doc.setTextColor(0, 0, 0);
  }

  pdfBadge(doc, PDF_CONTENT_RIGHT - 110, y - 14, s.payment_status === 'paid' ? 'PAID' : 'PAYMENT PENDING', s.payment_status === 'paid' ? 'paid' : 'neutral');

  y = pdfSectionLabel(doc, y, 'Billed To');
  y = pdfKeyValues(doc, y, [
    ['Sponsor / Organization', s.name || '-'],
    ['Tier', s.tier || '-'],
    ['Contact Person', s.contact_person || '-'],
  ]);

  y = pdfSectionLabel(doc, y, 'Payment Details');
  y = pdfTable(doc, y, [
    { label: 'Description', width: 355 },
    { label: 'Amount (₹)', width: 160, align: 'right' },
  ], [[`Sponsorship${s.tier ? ' — ' + s.tier : ''} — ${receiptNo}`, Number(s.payment_amount || 0).toLocaleString('en-IN')]]);

  y = pdfSectionLabel(doc, y + 8, 'Payment Information');
  y = pdfKeyValues(doc, y, [
    ['Status', receiptStatusLabel(s.payment_status === 'paid' ? 'paid' : 'pending')],
    ['Payment Mode', s.payment_mode || '-'],
    ['Payment Date', s.payment_date ? new Date(s.payment_date).toLocaleDateString('en-IN') : '-'],
  ]);

  y = pdfMaybeNewPage(doc, y, 30);
  pdfSetColor(doc, 'setTextColor', PDF_BRAND.greyLight);
  doc.setFont(undefined, 'normal'); doc.setFontSize(8.5);
  doc.text('This receipt confirms the sponsorship payment recorded in the SINC2026 system. For queries, contact the Sponsorship team.', PDF_MARGIN, y, { maxWidth: 515 });
  doc.setTextColor(0, 0, 0);
  return y;
}
window.downloadSponsorReceiptPdf = async (id) => {
  try {
    const s = await jget(`${API}/sponsors/${id}`);
    const doc = pdfDoc();
    await pdfAddSponsorReceiptBody(doc, s, true);
    pdfFinalize(doc);
    doc.save(`receipt-${sponsorReceiptNo(s)}.pdf`);
  } catch (err) { toast(err.message); }
};

// Host Registration & Payments (own ₹5,000 contribution report)
window.downloadHostPaymentsListPdf = async () => {
  try {
    const rows = await jget(`${API}/hostmembers`);
    const paidCount = rows.filter((h) => h.payment_status === 'paid').length;
    const totalCollected = rows.filter((h) => h.payment_status === 'paid').reduce((s, h) => s + Number(h.payment_amount || 0), 0);
    const doc = pdfDoc();
    let y = await pdfLetterhead(doc, 'Host Registration & Payments', `${rows.length} host member(s)  ·  ${paidCount} paid  ·  ₹${totalCollected.toLocaleString('en-IN')} collected`);
    y = pdfTable(doc, y, [
      { label: 'Name', width: 130 }, { label: 'Status', width: 55 }, { label: 'Amount (₹)', width: 65, align: 'right' },
      { label: 'Company', width: 100 }, { label: 'Phone', width: 80 }, { label: 'Mode', width: 85 },
    ], rows.map((h) => [h.name, h.payment_status, Number(h.payment_amount || 0).toLocaleString('en-IN'), h.company, h.phone, h.payment_mode]));
    pdfFinalize(doc);
    doc.save('host-payments.pdf');
  } catch (err) { toast(err.message); }
};

// Committees
window.downloadCommitteesListPdf = async () => {
  try {
    await downloadListReportPdf('Committees', `${ALL_COMMITTEES_CACHE.length} committee(s)`, [
      { label: 'Name', width: 140, get: (c) => c.name },
      { label: 'Lead', width: 110, get: (c) => (c.members || []).find((m) => m.is_lead)?.name || '-' },
      { label: 'Members', width: 65, get: (c) => (c.members || []).length, align: 'right' },
      { label: 'Checklist', width: 90, get: (c) => `${c.tasks_completed || 0}/${c.task_count || 0}` },
      { label: 'Description', width: 105, get: (c) => c.description },
    ], ALL_COMMITTEES_CACHE, 'committees.pdf');
  } catch (err) { toast(err.message); }
};
window.downloadCommitteeDetailPdf = async (id) => {
  try {
    const c = ALL_COMMITTEES_CACHE.find((r) => r.id === id);
    if (!c) { toast('Committee not found'); return; }
    await downloadDetailPdf(`Committee — ${c.name}`, c.description || '', [
      { label: 'Members', table: { columns: [{ label: 'Name', width: 250 }, { label: 'Role', width: 100 }], rows: (c.members || []).map((m) => [m.name, m.is_lead ? 'Lead' : 'Member']) } },
    ], `committee-${c.name}.pdf`);
  } catch (err) { toast(err.message); }
};

// Vehicles
window.downloadVehiclesListPdf = async () => {
  try {
    const rows = await jget(`${API}/vehicles`);
    await downloadListReportPdf('Vehicles', `${rows.length} vehicle(s)`, [
      { label: 'Code', width: 65, get: (r) => r.vehicle_code },
      { label: 'Type', width: 75, get: (r) => r.vehicle_type },
      { label: 'Model', width: 110, get: (r) => r.model },
      { label: 'Capacity', width: 60, get: (r) => r.seating_capacity, align: 'right' },
      { label: 'Reg. Number', width: 100, get: (r) => r.registration_number },
      { label: 'Partner', width: 105, get: (r) => r.partner_name },
    ], rows, 'vehicles.pdf');
  } catch (err) { toast(err.message); }
};
window.downloadVehicleDetailPdf = async (id) => {
  try {
    const rows = await jget(`${API}/vehicles`);
    const v = rows.find((r) => r.id === id);
    if (!v) { toast('Vehicle not found'); return; }
    await downloadDetailPdf(`Vehicle — ${v.vehicle_code}`, v.model || '', [
      { label: 'Vehicle Details', pairs: [['Code', v.vehicle_code], ['Type', v.vehicle_type], ['Model', v.model], ['Seating capacity', v.seating_capacity], ['Registration number', v.registration_number], ['Partner', v.partner_name], ['Notes', v.notes]] },
    ], `vehicle-${v.vehicle_code}.pdf`);
  } catch (err) { toast(err.message); }
};

// Transport Partners & Drivers
window.downloadPartnersListPdf = async () => {
  try {
    const rows = await jget(`${API}/partners`);
    await downloadListReportPdf('Transport Partners', `${rows.length} partner(s)`, [
      { label: 'Category', width: 100, get: (r) => r.category },
      { label: 'Name', width: 170, get: (r) => r.name },
      { label: 'Contact Person', width: 130, get: (r) => r.contact_person },
      { label: 'Phone', width: 115, get: (r) => r.phone },
    ], rows, 'transport-partners.pdf');
  } catch (err) { toast(err.message); }
};
window.downloadPartnerDetailPdf = async (id) => {
  try {
    const rows = await jget(`${API}/partners`);
    const p = rows.find((r) => r.id === id);
    if (!p) { toast('Partner not found'); return; }
    await downloadDetailPdf(`Transport Partner — ${p.name}`, p.category || '', [
      { label: 'Partner Details', pairs: [['Category', p.category], ['Name', p.name], ['Contact person', p.contact_person], ['Phone', p.phone]] },
    ], `partner-${p.name}.pdf`);
  } catch (err) { toast(err.message); }
};
window.downloadDriversListPdf = async () => {
  try {
    const rows = await jget(`${API}/drivers`);
    await downloadListReportPdf('Drivers', `${rows.length} driver(s)`, [
      { label: 'Name', width: 140, get: (r) => r.name },
      { label: 'Phone', width: 100, get: (r) => r.phone },
      { label: 'Vehicle', width: 140, get: (r) => r.vehicle_code || [r.vehicle_type, r.vehicle_number].filter(Boolean).join(' ') },
      { label: 'Partner', width: 135, get: (r) => r.partner_name },
    ], rows, 'drivers.pdf');
  } catch (err) { toast(err.message); }
};
window.downloadDriverDetailPdf = async (id) => {
  try {
    const rows = await jget(`${API}/drivers`);
    const d = rows.find((r) => r.id === id);
    if (!d) { toast('Driver not found'); return; }
    await downloadDetailPdf(`Driver — ${d.name}`, '', [
      { label: 'Driver Details', pairs: [['Name', d.name], ['Phone', d.phone], ['Vehicle', d.vehicle_code || [d.vehicle_type, d.vehicle_number].filter(Boolean).join(' ')], ['Partner', d.partner_name]] },
    ], `driver-${d.name}.pdf`);
  } catch (err) { toast(err.message); }
};

// Sponsors
window.downloadSponsorsListPdf = async () => {
  try {
    const rows = await jget(`${API}/sponsors`);
    await downloadListReportPdf('Sponsors', `${rows.length} sponsor(s)`, [
      { label: 'Pass Code', width: 80, get: (r) => r.sponsor_pass_code },
      { label: 'Name', width: 150, get: (r) => r.name },
      { label: 'Tier', width: 80, get: (r) => r.tier },
      { label: 'Guest Relation', width: 100, get: (r) => r.guest_relation_name },
      { label: 'Checklist', width: 60, get: (r) => `${r.checklist_done}/${r.checklist_total}` },
      { label: 'Status', width: 45, get: (r) => r.status },
    ], rows, 'sponsors.pdf');
  } catch (err) { toast(err.message); }
};
window.downloadSponsorDetailPdf = async (id) => {
  try {
    const s = await jget(`${API}/sponsors/${id}`);
    await downloadDetailPdf(`Sponsor — ${s.name}`, s.tier || '', [
      { label: 'Sponsor Details', pairs: [['Pass code', s.sponsor_pass_code], ['Name', s.name], ['Tier', s.tier], ['Contact person', s.contact_person], ['Phone', s.phone], ['Email', s.email], ['Guest Relation', s.guest_relation_name], ['Status', s.status], ['Notes', s.notes]] },
    ], `sponsor-${s.name}.pdf`);
  } catch (err) { toast(err.message); }
};

// Guest Speakers
window.downloadSpeakersListPdf = async () => {
  try {
    const rows = await jget(`${API}/speakers`);
    await downloadListReportPdf('Guest Speakers', `${rows.length} speaker(s)`, [
      { label: 'Name', width: 130, get: (r) => r.name },
      { label: 'Role', width: 85, get: (r) => r.session_type },
      { label: 'Topic', width: 150, get: (r) => r.topic },
      { label: 'Guest Relation', width: 95, get: (r) => r.guest_relation_name },
      { label: 'Status', width: 55, get: (r) => r.status },
    ], rows, 'guest-speakers.pdf');
  } catch (err) { toast(err.message); }
};
window.downloadSpeakerDetailPdf = async (id) => {
  try {
    const s = await jget(`${API}/speakers/${id}`);
    await downloadDetailPdf(`Guest Speaker — ${s.name}`, s.designation || '', [
      { label: 'Speaker Details', pairs: [['Name', s.name], ['Designation', s.designation], ['Organization', s.organization], ['Phone', s.phone], ['Email', s.email], ['Topic', s.topic], ['Session type', s.session_type], ['Guest Relation', s.guest_relation_name], ['Status', s.status], ['Notes', s.notes]] },
    ], `speaker-${s.name}.pdf`);
  } catch (err) { toast(err.message); }
};

// Guest Visitors
window.downloadGuestVisitorsListPdf = async () => {
  try {
    const rows = await jget(`${API}/guestvisitors`);
    await downloadListReportPdf('Guest Visitors', `${rows.length} guest visitor(s)`, [
      { label: 'Name', width: 130, get: (r) => r.name },
      { label: 'Category', width: 90, get: (r) => r.category },
      { label: 'Organization', width: 130, get: (r) => r.organization },
      { label: 'Visit Date', width: 65, get: (r) => r.visit_date },
      { label: 'Guest Relation', width: 100, get: (r) => r.guest_relation_name },
    ], rows, 'guest-visitors.pdf');
  } catch (err) { toast(err.message); }
};
window.downloadGuestVisitorDetailPdf = async (id) => {
  try {
    const g = await jget(`${API}/guestvisitors/${id}`);
    await downloadDetailPdf(`Guest Visitor — ${g.name}`, g.designation || '', [
      { label: 'Guest Visitor Details', pairs: [['Name', g.name], ['Designation', g.designation], ['Organization', g.organization], ['Phone', g.phone], ['Email', g.email], ['Category', g.category], ['Visit date', g.visit_date], ['Guest Relation', g.guest_relation_name], ['Status', g.status], ['Notes', g.notes]] },
    ], `guest-visitor-${g.name}.pdf`);
  } catch (err) { toast(err.message); }
};

// Hotels & Rooms
window.downloadHotelsListPdf = async () => {
  try {
    const rows = await jget(`${API}/hotels`);
    await downloadListReportPdf('Hotels', `${rows.length} hotel(s)`, [
      { label: 'Name', width: 150, get: (r) => r.name },
      { label: 'Address', width: 195, get: (r) => r.address },
      { label: 'Contact', width: 100, get: (r) => r.contact_person },
      { label: 'Occupants / Rooms', width: 70, get: (r) => `${r.occupant_count}/${r.room_count}` },
    ], rows, 'hotels.pdf');
  } catch (err) { toast(err.message); }
};
window.downloadHotelDetailPdf = async (id) => {
  try {
    const rows = await jget(`${API}/hotels`);
    const h = rows.find((r) => r.id === id);
    if (!h) { toast('Hotel not found'); return; }
    const rooms = (await jget(`${API}/rooms`)).filter((r) => r.hotel_name === h.name);
    await downloadDetailPdf(`Hotel — ${h.name}`, h.address || '', [
      { label: 'Hotel Details', pairs: [['Name', h.name], ['Address', h.address], ['Contact person', h.contact_person], ['Phone', h.phone]] },
      { label: 'Room Assignments', table: { columns: [
        { label: 'Room', width: 60 }, { label: 'Type', width: 70 }, { label: 'Occupant', width: 190 }, { label: 'Check-in', width: 80 }, { label: 'Check-out', width: 80 },
      ], rows: rooms.map((r) => [r.room_number, r.room_type, r.participant_name || r.host_member_name, r.check_in, r.check_out]) } },
    ], `hotel-${h.name}.pdf`);
  } catch (err) { toast(err.message); }
};
window.downloadRoomsListPdf = async () => {
  try {
    const rows = await jget(`${API}/rooms`);
    await downloadListReportPdf('Room Assignments', `${rows.length} assignment(s)`, [
      { label: 'Hotel', width: 130, get: (r) => r.hotel_name },
      { label: 'Room', width: 60, get: (r) => r.room_number },
      { label: 'Type', width: 70, get: (r) => r.room_type },
      { label: 'Occupant', width: 145, get: (r) => r.participant_name || r.host_member_name },
      { label: 'Check-in', width: 55, get: (r) => r.check_in },
      { label: 'Check-out', width: 55, get: (r) => r.check_out },
    ], rows, 'room-assignments.pdf');
  } catch (err) { toast(err.message); }
};

// Goodies & Inventory
window.downloadInventoryListPdf = async () => {
  try {
    const rows = await jget(`${API}/inventory`);
    await downloadListReportPdf('Goodies & Inventory', `${rows.length} item(s)`, [
      { label: 'Item', width: 130, get: (r) => r.name },
      { label: 'Category', width: 85, get: (r) => r.category },
      { label: 'Committee', width: 100, get: (r) => r.responsible_committee_name || 'Unassigned' },
      { label: 'Procured', width: 65, get: (r) => `${r.quantity_procured} ${r.unit}` },
      { label: 'Distributed', width: 65, get: (r) => `${r.quantity_distributed} ${r.unit}` },
      { label: 'Remaining', width: 65, get: (r) => `${r.quantity_remaining} ${r.unit}` },
    ], rows, 'inventory.pdf');
  } catch (err) { toast(err.message); }
};
window.downloadInventoryItemDetailPdf = async (id) => {
  try {
    const rows = await jget(`${API}/inventory`);
    const item = rows.find((r) => r.id === id);
    if (!item) { toast('Item not found'); return; }
    const dist = await jget(`${API}/inventory/${id}/distributions`);
    await downloadDetailPdf(`Inventory Item — ${item.name}`, item.category || '', [
      { label: 'Item Details', pairs: [
        ['Name', item.name], ['Category', item.category], ['Committee', item.responsible_committee_name || 'Unassigned'],
        ['Procured', `${item.quantity_procured} ${item.unit}`], ['Distributed', `${item.quantity_distributed} ${item.unit}`], ['Remaining', `${item.quantity_remaining} ${item.unit}`],
        ['Procurement status', item.procurement_status], ['Vendor', item.vendor_name], ['Unit cost', item.unit_cost], ['Notes', item.notes],
      ] },
      { label: 'Deliveries', table: { columns: [
        { label: 'Recipient', width: 200 }, { label: 'Qty', width: 45, align: 'right' }, { label: 'Status', width: 80 }, { label: 'Delivered by', width: 130 },
      ], rows: dist.map((d) => [d.recipient_name, d.quantity, d.status, d.delivered_by_name]) } },
    ], `inventory-${item.name}.pdf`);
  } catch (err) { toast(err.message); }
};

// --- Shared, reusable customizable checklist modal ---
// Used by Sponsors (benefit checklist), Guest Speakers (checklist), Guest
// Visitors (offerings), and the goodies/kit handover checklist on
// Participants + Host Members. Quick-add suggestions are drawn live from the
// master checklist templates (managed on the Checklists & Milestones tab —
// see refreshChecklistTemplates() below), not hardcoded here. Every item can
// carry a responsible committee + due date, and once marked done shows who
// closed it out — see server/routes/checklistHelper.js.
const CHECKLIST_BASE = { sponsor: 'sponsors', speaker: 'speakers', guest_visitor: 'guestvisitors', participant: 'participants', host_member: 'hostmembers' };
const OWNER_TYPE_LABELS = { sponsor: 'Sponsor', speaker: 'Guest Speaker', guest_visitor: 'Guest Visitor', participant: 'Delegate', host_member: 'Host Member' };

function committeeSelectOptions(selectedId) {
  const opts = ALL_COMMITTEES_CACHE.map((c) =>
    `<option value="${c.id}" ${String(selectedId) === String(c.id) ? 'selected' : ''}>${c.name}</option>`
  ).join('');
  return `<option value="">Unassigned</option>${opts}`;
}
function isOverdue(item) {
  if (item.status === 'done' || !item.due_date) return false;
  return item.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

async function fetchChecklistTemplateRows(ownerType) {
  try {
    return await jget(`${API}/checklist-templates?owner_type=${encodeURIComponent(ownerType)}`);
  } catch (e) { return []; }
}

let checklistCtx = { ownerType: null, ownerId: null };

window.openChecklistModal = async (ownerType, ownerId) => {
  checklistCtx = { ownerType, ownerId };
  const base = CHECKLIST_BASE[ownerType];
  let titleLabel = '';
  try {
    const owner = await jget(`${API}/${base}/${ownerId}`);
    titleLabel = owner.name || '';
  } catch (e) { /* title just won't show a name */ }
  document.getElementById('checklistModalTitle').textContent = titleLabel ? `Checklist — ${titleLabel}` : 'Checklist';
  document.getElementById('checklistModal').style.display = '';
  await renderChecklistBody();
};
window.closeChecklistModal = () => {
  document.getElementById('checklistModal').style.display = 'none';
  checklistCtx = { ownerType: null, ownerId: null };
};

async function renderChecklistBody() {
  const { ownerType, ownerId } = checklistCtx;
  if (!ownerType || !ownerId) return;
  const base = CHECKLIST_BASE[ownerType];
  const items = await jget(`${API}/${base}/${ownerId}/checklist`);
  const rowsHtml = items.map((it) => {
    const overdue = isOverdue(it);
    return `
    <div class="checklist-row status-${it.status}${overdue ? ' row-overdue' : ''}">
      <select onchange="updateChecklistItemField(${it.id}, 'status', this.value)">
        <option value="pending" ${it.status === 'pending' ? 'selected' : ''}>Pending</option>
        <option value="in_progress" ${it.status === 'in_progress' ? 'selected' : ''}>In progress</option>
        <option value="done" ${it.status === 'done' ? 'selected' : ''}>Done</option>
      </select>
      <span class="checklist-label">${it.label}</span>
      <select style="max-width:150px;" title="Responsible committee" onchange="updateChecklistItemField(${it.id}, 'responsible_committee_id', this.value || null)">
        ${committeeSelectOptions(it.responsible_committee_id)}
      </select>
      <input type="date" value="${it.due_date ? it.due_date.slice(0, 10) : ''}" style="max-width:135px;" title="Due date" onchange="updateChecklistItemField(${it.id}, 'due_date', this.value || null)" />
      ${overdue ? '<span class="pill overdue">Overdue</span>' : ''}
      ${it.status === 'done' && it.completed_by_username ? `<span class="hint">✓ ${it.completed_by_username}</span>` : ''}
      ${canDelete() ? `<button class="btn danger small" onclick="deleteChecklistItem(${it.id})">Delete</button>` : ''}
    </div>
  `;
  }).join('') || '<p class="empty">No checklist items yet — add one below.</p>';

  const templateRows = await fetchChecklistTemplateRows(ownerType);
  const existingLabels = new Set(items.map((it) => it.label));
  const suggestions = templateRows.filter((t) => !existingLabels.has(t.label));

  document.getElementById('checklistModalBody').innerHTML = `
    ${rowsHtml}
    <form onsubmit="return submitChecklistItem(event)" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
      <input name="label" placeholder="Add a checklist item..." required style="flex:1;min-width:160px;" />
      <select name="responsible_committee_id" style="max-width:170px;">${committeeSelectOptions(null)}</select>
      <input name="due_date" type="date" style="max-width:140px;" />
      <button class="btn gold small" type="submit">Add</button>
    </form>
    ${suggestions.length ? `
      <div style="margin-top:10px;">
        <span class="hint">Quick add suggestions:</span>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
          ${suggestions.map((t) => `<button type="button" class="btn outline small" onclick="quickAddChecklistItem('${t.label.replace(/'/g, "\\'")}', ${t.responsible_committee_id || 'null'})">+ ${t.label}${t.responsible_committee_name ? ` (${t.responsible_committee_name})` : ''}</button>`).join('')}
        </div>
        <button type="button" class="btn small" style="margin-top:8px;" onclick="quickAddAllChecklistItems()">+ Add all suggested items</button>
      </div>
    ` : ''}
  `;
}

window.updateChecklistItemField = async (itemId, field, value) => {
  try { await jput(`${API}/checklist-items/${itemId}`, { [field]: value }); await renderChecklistBody(); refreshOwnerListForChecklist(); }
  catch (err) { toast(err.message); }
};
window.deleteChecklistItem = async (itemId) => {
  await jdel(`${API}/checklist-items/${itemId}`);
  await renderChecklistBody();
  refreshOwnerListForChecklist();
};
window.submitChecklistItem = async (e) => {
  e.preventDefault();
  const { ownerType, ownerId } = checklistCtx;
  const base = CHECKLIST_BASE[ownerType];
  const label = e.target.elements.label.value.trim();
  if (!label) return false;
  const responsible_committee_id = e.target.elements.responsible_committee_id.value || null;
  const due_date = e.target.elements.due_date.value || null;
  try {
    await jpost(`${API}/${base}/${ownerId}/checklist`, { label, responsible_committee_id, due_date });
    e.target.reset();
    await renderChecklistBody();
    refreshOwnerListForChecklist();
  } catch (err) { toast(err.message); }
  return false;
};
window.quickAddChecklistItem = async (label, committeeId) => {
  const { ownerType, ownerId } = checklistCtx;
  const base = CHECKLIST_BASE[ownerType];
  try {
    await jpost(`${API}/${base}/${ownerId}/checklist`, { label, responsible_committee_id: committeeId || null });
    await renderChecklistBody();
    refreshOwnerListForChecklist();
  } catch (err) { toast(err.message); }
};
window.quickAddAllChecklistItems = async () => {
  const { ownerType, ownerId } = checklistCtx;
  const base = CHECKLIST_BASE[ownerType];
  try {
    const templateRows = await fetchChecklistTemplateRows(ownerType);
    if (!templateRows.length) { toast('No master checklist template items defined for this category yet — add some from Checklists & Milestones.'); return; }
    await jpost(`${API}/${base}/${ownerId}/checklist/bulk`, {
      items: templateRows.map((t) => ({ label: t.label, category: t.category, responsible_committee_id: t.responsible_committee_id }))
    });
    await renderChecklistBody();
    refreshOwnerListForChecklist();
  } catch (err) { toast(err.message); }
};

// --- Master checklist templates (per category) ---
async function refreshChecklistTemplates() {
  const filterSel = document.getElementById('checklistTemplateFilterSelect');
  if (!filterSel) return;
  populateCommitteeSelects();
  const ownerType = filterSel.value || 'sponsor';
  try {
    const rows = await jget(`${API}/checklist-templates?owner_type=${encodeURIComponent(ownerType)}`);
    document.getElementById('checklistTemplateTableBody').innerHTML = rows.map((t) => `
      <tr>
        <td>${t.category || '-'}</td>
        <td>${t.label}</td>
        <td>${t.responsible_committee_name || 'Unassigned'}</td>
        <td>${t.sort_order}</td>
        <td class="sticky-actions">
          <button class="btn small" onclick="editChecklistTemplate(${t.id})">Edit</button>
          ${canDelete() ? `<button class="btn danger small" onclick="deleteChecklistTemplate(${t.id})">Delete</button>` : ''}
        </td>
      </tr>
    `).join('') || '<tr><td colspan="5" class="empty">No template items yet for this category — add one above.</td></tr>';
  } catch (err) {
    // Previously a failed fetch here silently left the PREVIOUS category's
    // rows on screen with no indication anything went wrong — looking like
    // switching "Viewing category" did nothing. Surface it instead.
    toast(`Couldn't load templates for this category: ${err.message}`);
    document.getElementById('checklistTemplateTableBody').innerHTML = `<tr><td colspan="5" class="empty">Failed to load — ${err.message}</td></tr>`;
  }
}
document.getElementById('checklistTemplateFilterSelect')?.addEventListener('change', refreshChecklistTemplates);

document.getElementById('checklistTemplateForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = {
    owner_type: form.elements.owner_type.value,
    category: form.elements.category.value,
    sort_order: Number(form.elements.sort_order.value) || 0,
    responsible_committee_id: form.elements.responsible_committee_id.value || null,
    label: form.elements.label.value.trim()
  };
  if (!body.label) return;
  try {
    // Saving a template immediately applies to every existing entity of that
    // category — creating the item where missing and, for items still on no
    // committee of their own, adopting this one — so the committee shows up
    // right away in that committee's own checklist, not just for brand-new
    // items added after this point. syncMsg reports what actually happened.
    let sync;
    if (form.dataset.editId) {
      const r = await jput(`${API}/checklist-templates/${form.dataset.editId}`, body);
      sync = r && r.sync;
      delete form.dataset.editId;
      document.getElementById('checklistTemplateSubmitBtn').textContent = 'Add template item';
      document.getElementById('checklistTemplateCancelEditBtn').style.display = 'none';
    } else {
      const r = await jpost(`${API}/checklist-templates`, body);
      sync = r && r.sync;
    }
    const syncMsg = sync ? ` (${sync.created} item(s) created, ${sync.updated} synced to this committee)` : '';
    toast(`Checklist template item saved.${syncMsg}`);
    const ownerType = body.owner_type;
    form.reset();
    form.elements.owner_type.value = ownerType;
    document.getElementById('checklistTemplateFilterSelect').value = ownerType;
    await refreshChecklistTemplates();
    refreshDeliveryMonitor();
  } catch (err) { toast(err.message); }
});
document.getElementById('checklistTemplateCancelEditBtn')?.addEventListener('click', () => {
  const form = document.getElementById('checklistTemplateForm');
  form.reset(); delete form.dataset.editId;
  document.getElementById('checklistTemplateSubmitBtn').textContent = 'Add template item';
  document.getElementById('checklistTemplateCancelEditBtn').style.display = 'none';
});
window.editChecklistTemplate = async (id) => {
  const ownerType = document.getElementById('checklistTemplateFilterSelect').value;
  const rows = await jget(`${API}/checklist-templates?owner_type=${encodeURIComponent(ownerType)}`);
  const t = rows.find((r) => r.id === id);
  if (!t) return;
  const form = document.getElementById('checklistTemplateForm');
  form.elements.owner_type.value = t.owner_type;
  form.elements.category.value = t.category || '';
  form.elements.sort_order.value = t.sort_order;
  form.elements.responsible_committee_id.value = t.responsible_committee_id || '';
  form.elements.label.value = t.label;
  form.dataset.editId = id;
  document.getElementById('checklistTemplateSubmitBtn').textContent = 'Update template item';
  document.getElementById('checklistTemplateCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
window.deleteChecklistTemplate = async (id) => {
  if (!confirm('Delete this checklist template item? Existing checklists that already used it are unaffected.')) return;
  try {
    await jdel(`${API}/checklist-templates/${id}`);
    await refreshChecklistTemplates();
  } catch (err) { toast(err.message); }
};

// --- Bulk assign a single checklist item to a hand-picked group ---
// One-off action, separate from Master Checklist Templates above: instead of
// opening each Sponsor/Speaker/Guest Visitor/Delegate/Host Member and adding
// the item there, tick the ones who need it and assign in one call. Existing
// per-person "Checklist"/"Kit" editing (openChecklistModal) is untouched.
const BULK_ASSIGN_ENDPOINT = { sponsor: 'sponsors', speaker: 'speakers', guest_visitor: 'guestvisitors', participant: 'participants', host_member: 'hostmembers' };
// Each entry maps a raw list row to { id, primary, secondary } for rendering
// a checkbox label — reuses the same field names each tab's own table uses.
const BULK_ASSIGN_ROW_MAP = {
  participant: (p) => ({ id: p.id, primary: p.name, secondary: p.club_name || p.participant_code || '' }),
  host_member: (h) => ({ id: h.id, primary: h.name, secondary: h.company || h.phone || '' }),
  sponsor: (s) => ({ id: s.id, primary: s.name, secondary: s.tier || '' }),
  speaker: (s) => ({ id: s.id, primary: s.name, secondary: s.session_type || '' }),
  guest_visitor: (g) => ({ id: g.id, primary: g.name, secondary: g.category || g.organization || '' })
};
let BULK_ASSIGN_ROWS = []; // last-fetched, mapped recipients for the currently selected category

async function refreshBulkAssignRecipients() {
  const typeSel = document.getElementById('bulkAssignTypeSelect');
  if (!typeSel) return;
  const ownerType = typeSel.value;
  try {
    const rows = await jget(`${API}/${BULK_ASSIGN_ENDPOINT[ownerType]}`);
    BULK_ASSIGN_ROWS = rows.map(BULK_ASSIGN_ROW_MAP[ownerType]);
    renderBulkAssignRecipients();
  } catch (err) {
    BULK_ASSIGN_ROWS = [];
    const list = document.getElementById('bulkAssignRecipientList');
    if (list) list.innerHTML = `<p class="hint" style="margin:4px 2px;">Failed to load — ${err.message}</p>`;
    toast(`Couldn't load recipients: ${err.message}`);
  }
}
function renderBulkAssignRecipients() {
  const list = document.getElementById('bulkAssignRecipientList');
  const q = (document.getElementById('bulkAssignSearch').value || '').toLowerCase();
  const visible = q
    ? BULK_ASSIGN_ROWS.filter((r) => [r.primary, r.secondary].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
    : BULK_ASSIGN_ROWS;
  list.innerHTML = visible.map((r) => `
    <label style="display:flex;align-items:center;gap:8px;padding:4px 2px;font-size:13.5px;">
      <input type="checkbox" class="bulkAssignRecipientCb" value="${r.id}" style="width:auto;flex:0 0 auto;" />
      <span style="flex:1;min-width:0;">${r.primary}${r.secondary ? ` <span class="hint">(${r.secondary})</span>` : ''}</span>
    </label>
  `).join('') || '<p class="hint" style="margin:4px 2px;">No matches</p>';
  updateBulkAssignCount();
}
function updateBulkAssignCount() {
  const total = document.querySelectorAll('#bulkAssignRecipientList .bulkAssignRecipientCb').length;
  const checked = document.querySelectorAll('#bulkAssignRecipientList .bulkAssignRecipientCb:checked').length;
  document.getElementById('bulkAssignCount').textContent = total ? `(${checked} of ${total} selected)` : '';
}
document.getElementById('bulkAssignTypeSelect')?.addEventListener('change', refreshBulkAssignRecipients);
document.getElementById('bulkAssignSearch')?.addEventListener('input', renderBulkAssignRecipients);
document.getElementById('bulkAssignRecipientList')?.addEventListener('change', (e) => {
  if (e.target.classList.contains('bulkAssignRecipientCb')) updateBulkAssignCount();
});
document.getElementById('bulkAssignSelectAllBtn')?.addEventListener('click', () => {
  document.querySelectorAll('#bulkAssignRecipientList .bulkAssignRecipientCb').forEach((cb) => { cb.checked = true; });
  updateBulkAssignCount();
});
document.getElementById('bulkAssignSelectNoneBtn')?.addEventListener('click', () => {
  document.querySelectorAll('#bulkAssignRecipientList .bulkAssignRecipientCb').forEach((cb) => { cb.checked = false; });
  updateBulkAssignCount();
});
document.getElementById('bulkAssignForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const owner_type = document.getElementById('bulkAssignTypeSelect').value;
  const label = document.getElementById('bulkAssignLabel').value.trim();
  const category = document.getElementById('bulkAssignCategory').value.trim();
  const responsible_committee_id = document.getElementById('bulkAssignCommitteeSelect').value || null;
  const due_date = document.getElementById('bulkAssignDueDate').value || null;
  const owner_ids = Array.from(document.querySelectorAll('#bulkAssignRecipientList .bulkAssignRecipientCb:checked')).map((cb) => Number(cb.value));
  if (!label) { toast('Checklist item label is required'); return; }
  if (!owner_ids.length) { toast('Select at least one person to assign this to'); return; }
  try {
    const res = await jpost(`${API}/checklist-items/bulk-assign`, { owner_type, owner_ids, label, category, responsible_committee_id, due_date });
    toast(`Assigned to ${res.created} — ${res.skipped} already had this item, skipped.`);
    document.getElementById('bulkAssignLabel').value = '';
    document.getElementById('bulkAssignCategory').value = '';
    document.getElementById('bulkAssignDueDate').value = '';
    document.getElementById('bulkAssignCommitteeSelect').value = '';
    // Refresh whichever entity table is showing so its checklist done/total
    // count reflects the newly-assigned items right away.
    ({ participant: refreshParts, host_member: refreshHostMembers, sponsor: refreshSponsors, speaker: refreshSpeakers, guest_visitor: refreshGuestVisitors })[owner_type]?.();
    refreshDeliveryMonitor();
  } catch (err) { toast(err.message); }
});
// Refreshes whichever admin table shows a checklist progress count, after the
// modal makes a change. Harmless no-op for tabs whose table isn't in the DOM.
function refreshOwnerListForChecklist() {
  const t = checklistCtx.ownerType;
  if (t === 'sponsor') refreshSponsors();
  if (t === 'speaker') refreshSpeakers();
  if (t === 'guest_visitor') refreshGuestVisitors();
  refreshDeliveryMonitor();
}

// --- Delivery Monitor: cross-committee rollup + reassignment ---
async function refreshDeliveryMonitorSummary() {
  const rows = await jget(`${API}/checklist-items/monitor/summary`);
  document.getElementById('monitorSummaryBody').innerHTML = rows.map((r) => `
    <tr class="${r.overdue > 0 ? 'row-overdue' : ''}">
      <td>${r.committee_name || 'Unassigned'}</td>
      <td>${r.total}</td>
      <td>${r.done}</td>
      <td>${r.in_progress}</td>
      <td>${r.pending}</td>
      <td>${r.overdue > 0 ? `<span class="pill overdue">${r.overdue}</span>` : '0'}</td>
      <td>${r.completion_pct !== null ? r.completion_pct + '%' : '-'}</td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty">No checklist items yet.</td></tr>';

  // Committee options for reassignment/filtering must include EVERY
  // committee that exists — not just ones that already own a checklist
  // item — otherwise a committee with nothing assigned to it yet (which is
  // most/all of them the first time this is used) could never be picked as
  // a reassignment target.
  let committees = ALL_COMMITTEES_CACHE;
  if (!committees.length) {
    try { committees = await jget(`${API}/committees`); ALL_COMMITTEES_CACHE = committees; } catch (e) { committees = []; }
  }
  const committeeOptions = committees.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  const fromSel = document.getElementById('monitorFromCommitteeSelect');
  const toSel = document.getElementById('monitorToCommitteeSelect');
  if (fromSel) { const cur = fromSel.value; fromSel.innerHTML = '<option value="">Unassigned</option>' + committeeOptions; fromSel.value = cur; }
  if (toSel) { const cur = toSel.value; toSel.innerHTML = '<option value="">Unassigned</option>' + committeeOptions; toSel.value = cur; }
  const filterSel = document.getElementById('monitorFilterCommittee');
  if (filterSel) { const cur = filterSel.value; filterSel.innerHTML = '<option value="">All committees</option><option value="unassigned">Unassigned</option>' + committeeOptions; filterSel.value = cur; }
}

async function refreshDeliveryMonitorDetail() {
  const committee = document.getElementById('monitorFilterCommittee')?.value || '';
  const status = document.getElementById('monitorFilterStatus')?.value || '';
  const ownerType = document.getElementById('monitorFilterOwnerType')?.value || '';
  const params = new URLSearchParams();
  if (committee) params.set('committee_id', committee);
  if (status) params.set('status', status);
  if (ownerType) params.set('owner_type', ownerType);
  const rows = await jget(`${API}/checklist-items/monitor?${params.toString()}`);
  document.getElementById('monitorDetailBody').innerHTML = rows.map((r) => `
    <tr class="${r.is_overdue ? 'row-overdue' : ''}">
      <td>${r.label}</td>
      <td>${OWNER_TYPE_LABELS[r.owner_type] || r.owner_type}</td>
      <td>${r.owner_name || '-'}</td>
      <td>${r.responsible_committee_name || 'Unassigned'}</td>
      <td>${r.due_date ? r.due_date.slice(0, 10) : '-'}${r.is_overdue ? ' <span class="pill overdue">Overdue</span>' : ''}</td>
      <td><span class="pill ${r.status === 'done' ? 'done' : r.status === 'in_progress' ? 'in_progress' : 'pending'}">${r.status}</span></td>
      <td>${r.completed_by_username ? `${r.completed_by_username}${r.completed_at ? ' · ' + new Date(r.completed_at).toLocaleDateString() : ''}` : '-'}</td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty">No checklist items match this filter.</td></tr>';
}

async function refreshDeliveryMonitor() {
  if (!document.getElementById('monitorSummaryBody')) return;
  await refreshDeliveryMonitorSummary();
  await refreshDeliveryMonitorDetail();
}
['monitorFilterCommittee', 'monitorFilterStatus', 'monitorFilterOwnerType'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', refreshDeliveryMonitorDetail);
});
document.getElementById('monitorReassignForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const from_committee_id = document.getElementById('monitorFromCommitteeSelect').value || null;
  const to_committee_id = document.getElementById('monitorToCommitteeSelect').value || null;
  const only_incomplete = document.getElementById('monitorReassignScope').value !== 'all';
  try {
    const res = await jput(`${API}/checklist-items/reassign-committee`, { from_committee_id, to_committee_id, only_incomplete });
    toast(`Reassigned ${res.reassigned} item(s).`);
    await refreshDeliveryMonitor();
  } catch (err) { toast(err.message); }
});

// --- Sponsors ---
async function refreshSponsors() {
  const rows = await jget(`${API}/sponsors`);
  document.getElementById('sponsorTableBody').innerHTML = rows.map((s) => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          ${s.logo_url
            ? `<img src="${mediaUrl(s.logo_url)}" alt="${s.name} logo" style="width:36px;height:36px;object-fit:contain;border-radius:6px;background:#fff;border:1px solid var(--border,#ddd);" />`
            : `<div style="width:36px;height:36px;border-radius:6px;background:var(--bg2,#f2f2f2);"></div>`}
          <div style="display:flex;flex-direction:column;gap:2px;">
            <button type="button" class="btn small" onclick="triggerSponsorLogoUpload(${s.id})">${s.logo_url ? 'Replace' : 'Upload'}</button>
            ${s.logo_url ? `<button type="button" class="btn small" onclick="removeSponsorLogo(${s.id})">Remove</button>` : ''}
          </div>
        </div>
      </td>
      <td><strong>${s.sponsor_pass_code || '-'}</strong></td>
      <td>${s.name}</td>
      <td>${s.tier || '-'}</td>
      <td>${s.guest_relation_name || '-'}</td>
      <td>${s.checklist_done}/${s.checklist_total}</td>
      <td><span class="pill ${s.status === 'confirmed' ? 'paid' : s.status === 'cancelled' ? 'pending' : 'not_started'}">${s.status}</span></td>
      <td><span class="pill ${s.payment_status}">${s.payment_status}</span>${s.payment_amount ? ' <span class="hint">₹' + Number(s.payment_amount).toLocaleString('en-IN') + '</span>' : ''}</td>
      <td class="sticky-actions">
        <button class="btn small" onclick="editSponsor(${s.id})">Edit</button>
        <button class="btn small" onclick="openChecklistModal('sponsor', ${s.id})">Checklist</button>
        <button class="btn small" onclick="downloadSponsorDetailPdf(${s.id})">PDF</button>
        <button class="btn small" onclick="downloadSponsorReceiptPdf(${s.id})">Receipt</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteSponsor(${s.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="9" class="empty">No sponsors yet</td></tr>';
}
window.deleteSponsor = async (id) => { await jdel(`${API}/sponsors/${id}`); toast('Sponsor deleted'); refreshSponsors(); };

const SPONSOR_FORM_FIELDS = ['name', 'tier', 'contact_person', 'phone', 'email', 'guest_relation_host_member_id', 'status', 'notes', 'payment_status', 'payment_amount', 'payment_mode', 'payment_date'];
window.editSponsor = async (id) => {
  const s = await jget(`${API}/sponsors/${id}`);
  const form = document.getElementById('sponsorForm');
  SPONSOR_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = s[f] !== null && s[f] !== undefined ? s[f] : ''; });
  form.dataset.editId = id;
  document.getElementById('sponsorFormTitle').textContent = 'Edit sponsor';
  document.getElementById('sponsorSubmitBtn').textContent = 'Update Sponsor';
  document.getElementById('sponsorCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('sponsorCancelEditBtn').addEventListener('click', () => {
  const form = document.getElementById('sponsorForm');
  form.reset(); delete form.dataset.editId;
  document.getElementById('sponsorFormTitle').textContent = 'Add sponsor';
  document.getElementById('sponsorSubmitBtn').textContent = 'Save Sponsor';
  document.getElementById('sponsorCancelEditBtn').style.display = 'none';
});
document.getElementById('sponsorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.editId) {
      await jput(`${API}/sponsors/${form.dataset.editId}`, body);
      delete form.dataset.editId;
      form.reset();
      document.getElementById('sponsorFormTitle').textContent = 'Add sponsor';
      document.getElementById('sponsorSubmitBtn').textContent = 'Save Sponsor';
      document.getElementById('sponsorCancelEditBtn').style.display = 'none';
      toast('Sponsor updated');
    } else {
      const res = await jpost(`${API}/sponsors`, body);
      form.reset();
      toast(`Sponsor saved — pass code ${res.sponsor_pass_code}`);
    }
    refreshSponsors();
  } catch (err) { toast(err.message); }
});

// --- Guest Speakers ---
async function refreshSpeakers() {
  const rows = await jget(`${API}/speakers`);
  document.getElementById('speakerTableBody').innerHTML = rows.map((s) => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          ${s.photo_url
            ? `<img src="${mediaUrl(s.photo_url)}" alt="${s.name} photo" style="width:36px;height:36px;object-fit:cover;border-radius:50%;border:1px solid var(--border,#ddd);" />`
            : `<div style="width:36px;height:36px;border-radius:50%;background:var(--bg2,#f2f2f2);"></div>`}
          <div style="display:flex;flex-direction:column;gap:2px;">
            <button type="button" class="btn small" onclick="triggerSpeakerPhotoUpload(${s.id})">${s.photo_url ? 'Replace' : 'Upload'}</button>
            ${s.photo_url ? `<button type="button" class="btn small" onclick="removeSpeakerPhoto(${s.id})">Remove</button>` : ''}
          </div>
        </div>
      </td>
      <td>${s.name}${s.designation ? ' <span class="hint">(' + s.designation + ')</span>' : ''}</td>
      <td>${s.session_type}</td>
      <td style="white-space:normal;max-width:260px;">${s.topic || '-'}</td>
      <td>${s.guest_relation_name || '-'}</td>
      <td>${s.checklist_done}/${s.checklist_total}</td>
      <td><span class="pill ${s.status === 'confirmed' ? 'paid' : s.status === 'cancelled' ? 'pending' : 'not_started'}">${s.status}</span></td>
      <td class="sticky-actions">
        <button class="btn small" onclick="editSpeaker(${s.id})">Edit</button>
        <button class="btn small" onclick="openChecklistModal('speaker', ${s.id})">Checklist</button>
        <button class="btn small" onclick="downloadSpeakerDetailPdf(${s.id})">PDF</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteSpeaker(${s.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="8" class="empty">No guest speakers yet</td></tr>';
}
window.deleteSpeaker = async (id) => { await jdel(`${API}/speakers/${id}`); toast('Speaker deleted'); refreshSpeakers(); };

const SPEAKER_FORM_FIELDS = ['name', 'designation', 'organization', 'phone', 'email', 'topic', 'session_type', 'guest_relation_host_member_id', 'status', 'notes'];
window.editSpeaker = async (id) => {
  const s = await jget(`${API}/speakers/${id}`);
  const form = document.getElementById('speakerForm');
  SPEAKER_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = s[f] !== null && s[f] !== undefined ? s[f] : ''; });
  form.dataset.editId = id;
  document.getElementById('speakerFormTitle').textContent = 'Edit guest speaker';
  document.getElementById('speakerSubmitBtn').textContent = 'Update Speaker';
  document.getElementById('speakerCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('speakerCancelEditBtn').addEventListener('click', () => {
  const form = document.getElementById('speakerForm');
  form.reset(); delete form.dataset.editId;
  document.getElementById('speakerFormTitle').textContent = 'Add guest speaker';
  document.getElementById('speakerSubmitBtn').textContent = 'Save Speaker';
  document.getElementById('speakerCancelEditBtn').style.display = 'none';
});
document.getElementById('speakerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.editId) {
      await jput(`${API}/speakers/${form.dataset.editId}`, body);
      delete form.dataset.editId;
      form.reset();
      document.getElementById('speakerFormTitle').textContent = 'Add guest speaker';
      document.getElementById('speakerSubmitBtn').textContent = 'Save Speaker';
      document.getElementById('speakerCancelEditBtn').style.display = 'none';
      toast('Speaker updated');
    } else {
      await jpost(`${API}/speakers`, body);
      form.reset();
      toast('Speaker saved');
    }
    refreshSpeakers();
  } catch (err) { toast(err.message); }
});

// --- Guest Visitors ---
async function refreshGuestVisitors() {
  const rows = await jget(`${API}/guestvisitors`);
  document.getElementById('gvTableBody').innerHTML = rows.map((g) => `
    <tr>
      <td>${g.name}${g.designation ? ' <span class="hint">(' + g.designation + ')</span>' : ''}</td>
      <td>${g.category || '-'}</td>
      <td>${g.organization || '-'}</td>
      <td>${g.visit_date || '-'}</td>
      <td>${g.guest_relation_name || '-'}</td>
      <td>${g.checklist_done}/${g.checklist_total}</td>
      <td><span class="pill ${g.status === 'confirmed' ? 'paid' : g.status === 'cancelled' ? 'pending' : 'not_started'}">${g.status}</span></td>
      <td class="sticky-actions">
        <button class="btn small" onclick="editGv(${g.id})">Edit</button>
        <button class="btn small" onclick="openChecklistModal('guest_visitor', ${g.id})">Offerings</button>
        <button class="btn small" onclick="downloadGuestVisitorDetailPdf(${g.id})">PDF</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteGv(${g.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="8" class="empty">No guest visitors yet</td></tr>';
}
window.deleteGv = async (id) => { await jdel(`${API}/guestvisitors/${id}`); toast('Guest visitor deleted'); refreshGuestVisitors(); };

const GV_FORM_FIELDS = ['name', 'designation', 'organization', 'phone', 'email', 'category', 'visit_date', 'guest_relation_host_member_id', 'status', 'notes'];
window.editGv = async (id) => {
  const g = await jget(`${API}/guestvisitors/${id}`);
  const form = document.getElementById('gvForm');
  GV_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = g[f] !== null && g[f] !== undefined ? g[f] : ''; });
  form.dataset.editId = id;
  document.getElementById('gvFormTitle').textContent = 'Edit guest visitor';
  document.getElementById('gvSubmitBtn').textContent = 'Update Guest Visitor';
  document.getElementById('gvCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('gvCancelEditBtn').addEventListener('click', () => {
  const form = document.getElementById('gvForm');
  form.reset(); delete form.dataset.editId;
  document.getElementById('gvFormTitle').textContent = 'Add guest visitor';
  document.getElementById('gvSubmitBtn').textContent = 'Save Guest Visitor';
  document.getElementById('gvCancelEditBtn').style.display = 'none';
});
document.getElementById('gvForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.editId) {
      await jput(`${API}/guestvisitors/${form.dataset.editId}`, body);
      delete form.dataset.editId;
      form.reset();
      document.getElementById('gvFormTitle').textContent = 'Add guest visitor';
      document.getElementById('gvSubmitBtn').textContent = 'Save Guest Visitor';
      document.getElementById('gvCancelEditBtn').style.display = 'none';
      toast('Guest visitor updated');
    } else {
      await jpost(`${API}/guestvisitors`, body);
      form.reset();
      toast('Guest visitor saved');
    }
    refreshGuestVisitors();
  } catch (err) { toast(err.message); }
});

// --- Accommodation: Hotels + Room Assignments ---
async function refreshHotels() {
  const rows = await jget(`${API}/hotels`);
  document.getElementById('hotelTableBody').innerHTML = rows.map((h) => `
    <tr>
      <td><strong>${h.name}</strong></td>
      <td style="white-space:normal;max-width:220px;">${h.address || '-'}</td>
      <td>${h.contact_person || '-'}${h.phone ? ' <span class="hint">' + h.phone + '</span>' : ''}</td>
      <td>${h.occupant_count} occupant(s) / ${h.room_count} room(s)</td>
      <td class="sticky-actions">
        <button class="btn small" onclick="editHotel(${h.id})">Edit</button>
        <button class="btn small" onclick="downloadHotelDetailPdf(${h.id})">PDF</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteHotel(${h.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">No hotels yet</td></tr>';

  const opts = rows.map((h) => `<option value="${h.id}">${h.name}</option>`).join('');
  const sel = document.getElementById('roomHotelSelect');
  if (sel) sel.innerHTML = '<option value="">-- select hotel --</option>' + opts;

  const stayEl = document.getElementById('tourHotelDayStaySelect');
  if (stayEl) stayEl.innerHTML = '<option value="">-- none --</option>' + opts;
  ['tourHotelDayBreakfastSelect', 'tourHotelDayHitea1Select', 'tourHotelDayLunchSelect', 'tourHotelDayHitea2Select', 'tourHotelDayDinnerSelect'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<option value="">-- same as stay --</option>' + opts;
  });
}
window.deleteHotel = async (id) => { await jdel(`${API}/hotels/${id}`); toast('Hotel removed'); refreshHotels(); refreshRooms(); };

const HOTEL_FORM_FIELDS = ['name', 'address', 'contact_person', 'phone', 'notes'];
window.editHotel = async (id) => {
  const rows = await jget(`${API}/hotels`);
  const h = rows.find((r) => r.id === id);
  if (!h) return;
  const form = document.getElementById('hotelForm');
  HOTEL_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = h[f] !== null && h[f] !== undefined ? h[f] : ''; });
  form.dataset.editId = id;
  document.getElementById('hotelFormTitle').textContent = 'Edit hotel';
  document.getElementById('hotelSubmitBtn').textContent = 'Update Hotel';
  document.getElementById('hotelCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('hotelCancelEditBtn').addEventListener('click', () => {
  const form = document.getElementById('hotelForm');
  form.reset(); delete form.dataset.editId;
  document.getElementById('hotelFormTitle').textContent = 'Add hotel';
  document.getElementById('hotelSubmitBtn').textContent = 'Save Hotel';
  document.getElementById('hotelCancelEditBtn').style.display = 'none';
});
document.getElementById('hotelForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.editId) {
      await jput(`${API}/hotels/${form.dataset.editId}`, body);
      delete form.dataset.editId;
      form.reset();
      document.getElementById('hotelFormTitle').textContent = 'Add hotel';
      document.getElementById('hotelSubmitBtn').textContent = 'Save Hotel';
      document.getElementById('hotelCancelEditBtn').style.display = 'none';
      toast('Hotel updated');
    } else {
      await jpost(`${API}/hotels`, body);
      form.reset();
      toast('Hotel saved');
    }
    refreshHotels();
  } catch (err) { toast(err.message); }
});

async function refreshRooms() {
  const rows = await jget(`${API}/rooms`);
  document.getElementById('roomTableBody').innerHTML = rows.map((r) => `
    <tr>
      <td>${r.hotel_name}</td>
      <td>${r.room_number}</td>
      <td style="text-transform:capitalize;">${r.room_type || '-'}</td>
      <td>${r.participant_name ? r.participant_name + ' <span class="hint">(delegate' + (r.participant_code ? ' · ' + r.participant_code : '') + ')</span>' : (r.host_member_name ? r.host_member_name + ' <span class="hint">(host member)</span>' : '-')}</td>
      <td>${r.check_in || '-'}</td>
      <td>${r.check_out || '-'}</td>
      <td>${canDelete() ? `<button class="btn danger small" onclick="deleteRoom(${r.id})">Delete</button>` : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty">No room assignments yet</td></tr>';
}
window.deleteRoom = async (id) => { await jdel(`${API}/rooms/${id}`); toast('Room assignment removed'); refreshRooms(); refreshHotels(); };

document.getElementById('roomOccupantTypeSelect').addEventListener('change', (e) => {
  const isParticipant = e.target.value === 'participant';
  document.getElementById('roomParticipantSelect').style.display = isParticipant ? '' : 'none';
  document.getElementById('roomHmSelect').style.display = isParticipant ? 'none' : '';
});

document.getElementById('roomForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  const occupantType = document.getElementById('roomOccupantTypeSelect').value;
  if (occupantType === 'participant') {
    body.participant_id = document.getElementById('roomParticipantSelect').value || null;
  } else {
    body.host_member_id = document.getElementById('roomHmSelect').value || null;
  }
  try {
    await jpost(`${API}/rooms`, body);
    form.reset();
    toast('Room assignment saved');
    refreshRooms();
    refreshHotels();
  } catch (err) { toast(err.message); }
});

// --- Goodies & Inventory: procurement stock list + per-recipient delivery ---
// --- tracking (who it went to, who was assigned, who actually delivered). ---
const RECIPIENT_TYPE_LABELS = OWNER_TYPE_LABELS; // same 5 categories, reused

function inventoryCommitteeOptions(selectedId) {
  const opts = ALL_COMMITTEES_CACHE.map((c) =>
    `<option value="${c.id}" ${String(selectedId) === String(c.id) ? 'selected' : ''}>${c.name}</option>`
  ).join('');
  return `<option value="">Unassigned</option>${opts}`;
}

async function fetchHostMemberOptions(selectedId) {
  let rows = [];
  try { rows = await jget(`${API}/hostmembers`); } catch (e) { rows = []; }
  const opts = rows.map((h) =>
    `<option value="${h.id}" ${String(selectedId) === String(h.id) ? 'selected' : ''}>${h.name}</option>`
  ).join('');
  return `<option value="">-- unassigned --</option>${opts}`;
}

async function fetchRecipientOptions(recipientType, selectedId) {
  const base = CHECKLIST_BASE[recipientType];
  if (!base) return '';
  let rows = [];
  try { rows = await jget(`${API}/${base}`); } catch (e) { rows = []; }
  const opts = rows.map((r) =>
    `<option value="${r.id}" ${String(selectedId) === String(r.id) ? 'selected' : ''}>${r.name}</option>`
  ).join('');
  return `<option value="">-- select --</option>${opts}`;
}

async function refreshInventoryItems() {
  const sel = document.getElementById('inventoryCommitteeSelect');
  if (sel) { const cur = sel.value; sel.innerHTML = inventoryCommitteeOptions(null); if (cur) sel.value = cur; }
  const rows = await jget(`${API}/inventory`);
  document.getElementById('inventoryTableBody').innerHTML = rows.map((i) => `
    <tr class="${i.low_stock ? 'row-overdue' : ''}">
      <td><strong>${i.name}</strong>${i.notes ? `<br><span class="hint">${i.notes}</span>` : ''}</td>
      <td>${i.category || '-'}</td>
      <td>${i.vendor_name || '-'}</td>
      <td>${i.responsible_committee_name || 'Unassigned'}</td>
      <td>${i.quantity_procured} ${i.unit}</td>
      <td>${i.quantity_distributed} ${i.unit}</td>
      <td>${i.quantity_remaining} ${i.unit}${i.low_stock ? ' <span class="pill overdue">Low stock</span>' : ''}</td>
      <td>
        <select onchange="updateInventoryDelivery(${i.id}, 'procurement_status', this.value)">
          ${['planned', 'ordered', 'received', 'distributing', 'completed', 'delayed'].map((s) => `<option value="${s}" ${i.procurement_status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
        </select>
        <br><span class="hint">${i.delivered_count}/${i.recipient_count} delivered</span></td>
      <td>
        ${i.expected_delivery_date ? `Exp: ${new Date(i.expected_delivery_date).toLocaleDateString()}` : '-'}
        ${i.actual_delivery_date ? `<br>Actual: ${new Date(i.actual_delivery_date).toLocaleDateString()}` : ''}
      </td>
      <td class="sticky-actions">
        <button class="btn small" onclick="editInventoryItem(${i.id})">Edit</button>
        <button class="btn small" onclick="openInventoryDistModal(${i.id}, '${(i.name || '').replace(/'/g, "\\'")}')">Deliveries</button>
        <button class="btn small" onclick="downloadInventoryItemDetailPdf(${i.id})">PDF</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteInventoryItem(${i.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="10" class="empty">No inventory items yet — add one above.</td></tr>';
}
window.updateInventoryDelivery = async (id, field, value) => {
  try { await jput(`${API}/inventory/${id}/delivery`, { [field]: value }); toast('Delivery updated'); refreshInventoryItems(); refreshInventoryMonitor(); }
  catch (err) { toast(err.message); }
};

const INVENTORY_FORM_FIELDS = ['name', 'category', 'unit', 'quantity_procured', 'reorder_threshold', 'vendor_id', 'vendor_name', 'unit_cost', 'procurement_status', 'responsible_committee_id', 'expected_delivery_date', 'actual_delivery_date', 'notes'];
window.editInventoryItem = async (id) => {
  const rows = await jget(`${API}/inventory`);
  const item = rows.find((r) => r.id === id);
  if (!item) return;
  const form = document.getElementById('inventoryForm');
  INVENTORY_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = item[f] !== null && item[f] !== undefined ? item[f] : ''; });
  form.dataset.editId = id;
  document.getElementById('inventoryFormTitle').textContent = 'Edit inventory item';
  document.getElementById('inventorySubmitBtn').textContent = 'Update item';
  document.getElementById('inventoryCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('inventoryCancelEditBtn').addEventListener('click', () => {
  const form = document.getElementById('inventoryForm');
  form.reset(); delete form.dataset.editId;
  document.getElementById('inventoryFormTitle').textContent = 'Add inventory item';
  document.getElementById('inventorySubmitBtn').textContent = 'Save item';
  document.getElementById('inventoryCancelEditBtn').style.display = 'none';
});
document.getElementById('inventoryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.editId) {
      await jput(`${API}/inventory/${form.dataset.editId}`, body);
      toast('Inventory item updated');
    } else {
      await jpost(`${API}/inventory`, body);
      toast('Inventory item saved');
    }
    delete form.dataset.editId;
    form.reset();
    document.getElementById('inventoryFormTitle').textContent = 'Add inventory item';
    document.getElementById('inventorySubmitBtn').textContent = 'Save item';
    document.getElementById('inventoryCancelEditBtn').style.display = 'none';
    refreshInventoryItems();
    refreshInventoryMonitor();
  } catch (err) { toast(err.message); }
});
window.deleteInventoryItem = async (id) => {
  await jdel(`${API}/inventory/${id}`);
  toast('Inventory item removed');
  refreshInventoryItems();
  refreshInventoryMonitor();
};

// --- Merchandise Requirement charts: accumulated Shirt/Tee size counts, ---
// --- Delegates vs Host Members, from GET /inventory/merchandise-requirement ---
function mergeMerchSizeSeries(delegateBreakdown, hostBreakdown) {
  const order = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
  const sizes = Array.from(new Set([...delegateBreakdown.map((s) => s.size), ...hostBreakdown.map((s) => s.size)]));
  sizes.sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  const delMap = Object.fromEntries(delegateBreakdown.map((s) => [s.size, s.count]));
  const hostMap = Object.fromEntries(hostBreakdown.map((s) => [s.size, s.count]));
  return { labels: sizes, delegates: sizes.map((s) => delMap[s] || 0), hostMembers: sizes.map((s) => hostMap[s] || 0) };
}
function renderMerchChart(canvasId, existingChart, series, title) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return existingChart;
  if (existingChart) existingChart.destroy();
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: series.labels,
      datasets: [
        { label: 'Delegates', data: series.delegates, backgroundColor: '#314691', borderRadius: 3 },
        { label: 'Host Members', data: series.hostMembers, backgroundColor: '#65A8DE', borderRadius: 3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        title: { display: true, text: title, font: { size: 12 } }
      },
      scales: { y: { ticks: { precision: 0 } } }
    }
  });
}
async function refreshMerchandiseRequirement() {
  try {
    const data = await jget(`${API}/inventory/merchandise-requirement`);
    merchShirtChart = renderMerchChart('merchShirtChart', merchShirtChart, mergeMerchSizeSeries(data.delegates.shirt, data.hostMembers.shirt), 'Shirt sizes');
    merchTeeChart = renderMerchChart('merchTeeChart', merchTeeChart, mergeMerchSizeSeries(data.delegates.tshirt, data.hostMembers.tshirt), 'T-shirt sizes');
    const hint = document.getElementById('merchSizesOnFileHint');
    if (hint) {
      hint.textContent = `${data.delegates.sizesOnFile} of ${data.delegates.total} delegate(s) and ${data.hostMembers.sizesOnFile} of ${data.hostMembers.total} host member(s) have sizes on file.`;
    }
  } catch (e) { /* chart is supplementary — fail quietly */ }
}
// Per-person "who chose what size" list — so whoever's packing/handing out
// merchandise doesn't have to open Delegates/Host Members and cross-reference
// every time. Refreshed alongside the chart since it's the same underlying
// data, just at person-level instead of aggregated.
async function refreshMerchSizeList() {
  try {
    const rows = await jget(`${API}/inventory/merchandise-size-list`);
    renderMerchSizeList(rows);
  } catch (e) { /* fail quietly — supplementary panel */ }
}
// Split into one table per category (Delegate / Host Member) rather than one
// combined list with a "Type" column — each category is its own audience for
// whoever's packing/handing out that group's merchandise, and each gets its
// own Download PDF button. Both use the exact same PDF layout (downloadListReportPdf
// with the same column set) so the two exports are visually consistent.
const MERCH_SIZE_CATEGORIES = [
  { type: 'Delegate', bodyId: 'merchSizeListTableBody_Delegate' },
  { type: 'Host Member', bodyId: 'merchSizeListTableBody_HostMember' }
];
function renderMerchSizeList(rows) {
  MERCH_SIZE_CATEGORIES.forEach(({ type, bodyId }) => {
    const body = document.getElementById(bodyId);
    if (!body) return;
    const filtered = rows.filter((r) => r.type === type);
    body.innerHTML = filtered.map((r) => `
      <tr>
        <td>${r.name}</td>
        <td>${r.club_or_company || '-'}</td>
        <td>${r.phone || '-'}</td>
        <td>${r.shirt_size || '-'}</td>
        <td>${r.tshirt_size || '-'}</td>
        <td>${r.waist_size || '-'}</td>
      </tr>
    `).join('') || '<tr><td colspan="6" class="empty">Nobody in this category has a size on file yet.</td></tr>';
  });
}
window.downloadMerchSizeListPdf = async (category) => {
  try {
    const rows = await jget(`${API}/inventory/merchandise-size-list`);
    const filtered = rows.filter((r) => r.type === category);
    if (!filtered.length) { toast(`Nobody in ${category}s has a size on file yet`); return; }
    const fileSlug = category.toLowerCase().replace(/\s+/g, '-');
    await downloadListReportPdf(`Who Chose What Size — ${category}s`, `${filtered.length} with sizes on file`, [
      { label: 'Name', width: 180, get: (r) => r.name },
      { label: 'Club / Company', width: 150, get: (r) => r.club_or_company },
      { label: 'Phone', width: 95, get: (r) => r.phone },
      { label: 'Shirt', width: 45, get: (r) => r.shirt_size },
      { label: 'Tee', width: 45, get: (r) => r.tshirt_size },
      { label: 'Waist', width: 45, get: (r) => r.waist_size },
    ], filtered, `merchandise-size-list-${fileSlug}.pdf`);
  } catch (err) { toast(err.message); }
};
window.syncMerchandiseRequirements = async () => {
  try {
    const r = await jpost(`${API}/inventory/requirements/sync-merchandise`, {});
    toast(`Synced (${r.created} new, ${r.updated} updated${r.skipped ? `, ${r.skipped} already actioned — left as-is` : ''}).`);
    refreshMerchandiseRequirement();
    refreshRequirements();
  } catch (err) { toast(err.message); }
};

// --- Requirements: needs raised for procurement (manual, or auto-synced ---
// --- from the Merchandise sizes above) that the Purchase team turns into ---
// --- a real Finance Purchase Request. ---
const REQUIREMENT_STATUS_LABELS = { open: 'Open', requested: 'Requested', fulfilled: 'Fulfilled', cancelled: 'Cancelled' };
async function refreshRequirements() {
  try {
    const rows = await jget(`${API}/inventory/requirements`);
    renderRequirements(rows);
  } catch (e) { /* fail quietly — supplementary panel */ }
}
function renderRequirements(rows) {
  const body = document.getElementById('requirementsTableBody');
  if (!body) return;
  body.innerHTML = rows.map((r) => `
    <tr>
      <td>${r.item_name}</td>
      <td>${r.category}</td>
      <td>${r.size || '-'}</td>
      <td>${r.quantity_needed} ${r.unit || ''}</td>
      <td>${r.source === 'auto-merchandise' ? 'Merchandise sizes' : 'Manual'}</td>
      <td><span class="pill single">${REQUIREMENT_STATUS_LABELS[r.status] || r.status}</span></td>
      <td>${r.purchase_request_id ? `PR #${r.purchase_request_id} (${r.purchase_request_status || '-'})` : '-'}</td>
      <td>
        ${r.status === 'open' ? `<button class="btn small" onclick="openRequirementPrModal(${r.id})">Raise Purchase Request</button>` : ''}
        ${r.status === 'open' ? ` <button class="btn small outline" onclick="cancelRequirement(${r.id})">Cancel</button>` : ''}
        ${canDelete() ? ` <button class="btn danger small" onclick="deleteRequirement(${r.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="8" class="empty">No requirements raised yet.</td></tr>';
}
document.getElementById('requirementForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    await jpost(`${API}/inventory/requirements`, body);
    toast('Requirement raised');
    form.reset();
    if (form.elements['category']) form.elements['category'].value = 'General';
    refreshRequirements();
  } catch (err) { toast(err.message); }
});
window.cancelRequirement = async (id) => {
  if (!confirm('Cancel this requirement?')) return;
  try {
    await jput(`${API}/inventory/requirements/${id}`, { status: 'cancelled' });
    toast('Requirement cancelled');
    refreshRequirements();
  } catch (err) { toast(err.message); }
};
window.deleteRequirement = async (id) => {
  if (!confirm('Delete this requirement? This cannot be undone.')) return;
  await jdel(`${API}/inventory/requirements/${id}`);
  toast('Requirement removed');
  refreshRequirements();
};

// Small modal to collect the few extra details (unit cost, vendor, expected
// delivery) needed to raise a real Finance Purchase Request from a
// requirement — same shape as finance.js's POST /purchases, just pre-filled
// from the requirement server-side so nothing has to be re-typed here.
let requirementPrCtx = { id: null };
window.openRequirementPrModal = async (id) => {
  requirementPrCtx = { id };
  let vendors = [];
  try { vendors = await jget(`${API}/inventory/vendors-lite`); } catch (e) { vendors = []; }
  const vendorOptions = vendors.map((v) => `<option value="${v.id}">${v.name}${v.category ? ` (${v.category})` : ''}</option>`).join('');
  document.getElementById('requirementPrModalBody').innerHTML = `
    <form onsubmit="return submitRequirementPr(event)">
      <div class="form-grid cols-2">
        <div class="field"><label>Vendor (from master)</label><select name="vendor_id"><option value="">-- none / one-off --</option>${vendorOptions}</select></div>
        <div class="field"><label>Payee / vendor name (one-off, optional)</label><input name="payee_or_payer" placeholder="Only if not in the vendor master" /></div>
      </div>
      <div class="form-grid cols-2">
        <div class="field"><label>Unit cost (₹) *</label><input name="purchase_unit_cost" type="number" min="0" step="0.01" required /></div>
        <div class="field"><label>Expected delivery date</label><input name="expected_delivery_date" type="date" /></div>
      </div>
      <div class="field"><label>Notes</label><textarea name="notes"></textarea></div>
      <button class="btn gold" type="submit">Raise Purchase Request</button>
    </form>
  `;
  document.getElementById('requirementPrModal').style.display = '';
};
window.closeRequirementPrModal = () => {
  document.getElementById('requirementPrModal').style.display = 'none';
  requirementPrCtx = { id: null };
};
window.submitRequirementPr = async (e) => {
  e.preventDefault();
  const { id } = requirementPrCtx;
  const body = Object.fromEntries(new FormData(e.target).entries());
  try {
    await jpost(`${API}/inventory/requirements/${id}/raise-purchase-request`, body);
    toast('Purchase Request raised — now waiting on approval in Finance.');
    closeRequirementPrModal();
    refreshRequirements();
  } catch (err) { toast(err.message); }
  return false;
};

// --- Manage one item's deliveries: bulk-assign, individual add, per-row status ---
let inventoryDistCtx = { itemId: null, itemName: '' };

window.openInventoryDistModal = async (itemId, itemName) => {
  inventoryDistCtx = { itemId, itemName };
  document.getElementById('inventoryDistModalTitle').textContent = itemName ? `Deliveries — ${itemName}` : 'Deliveries';
  document.getElementById('inventoryDistModal').style.display = '';
  await renderInventoryDistBody();
};
window.closeInventoryDistModal = () => {
  document.getElementById('inventoryDistModal').style.display = 'none';
  inventoryDistCtx = { itemId: null, itemName: '' };
};

async function renderInventoryDistBody() {
  const { itemId } = inventoryDistCtx;
  if (!itemId) return;
  const rows = await jget(`${API}/inventory/${itemId}/distributions`);
  // Fetch host members ONCE and reuse for every row's "assigned to" select,
  // rather than re-fetching per row.
  let hostMembers = [];
  try { hostMembers = await jget(`${API}/hostmembers`); } catch (e) { hostMembers = []; }
  const hostMemberOptionsFor = (selectedId) => {
    const opts = hostMembers.map((h) =>
      `<option value="${h.id}" ${String(selectedId) === String(h.id) ? 'selected' : ''}>${h.name}</option>`
    ).join('');
    return `<option value="">-- unassigned --</option>${opts}`;
  };
  const hostMemberOptionsHtml = hostMemberOptionsFor(null);
  const rowsHtml = rows.map((d) => `
    <div class="checklist-row status-${d.status}">
      <span class="checklist-label">
        <span class="pill single" style="margin-right:6px;">${RECIPIENT_TYPE_LABELS[d.recipient_type] || d.recipient_type}</span>
        ${d.recipient_name || 'Unknown'}${d.quantity > 1 ? ` ×${d.quantity}` : ''}
      </span>
      <select style="max-width:160px;" title="Assigned to" onchange="updateInventoryDistField(${d.id}, 'assigned_host_member_id', this.value || null)">
        ${hostMemberOptionsFor(d.assigned_host_member_id)}
      </select>
      <select onchange="updateInventoryDistField(${d.id}, 'status', this.value)">
        <option value="pending" ${d.status === 'pending' ? 'selected' : ''}>Pending</option>
        <option value="delivered" ${d.status === 'delivered' ? 'selected' : ''}>Delivered</option>
        <option value="cancelled" ${d.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
      </select>
      ${d.status === 'delivered' && d.delivered_by_name ? `<span class="hint">✓ ${d.delivered_by_name}${d.delivered_at ? ' on ' + new Date(d.delivered_at).toLocaleDateString() : ''}</span>` : ''}
      ${canDelete() ? `<button class="btn danger small" onclick="deleteInventoryDist(${d.id})">Delete</button>` : ''}
    </div>
  `).join('') || '<p class="empty">No recipients added yet.</p>';

  const recipientTypeOptions = Object.entries(RECIPIENT_TYPE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

  document.getElementById('inventoryDistModalBody').innerHTML = `
    ${rowsHtml}
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line);">
      <strong>Assign to everyone in a category</strong>
      <form onsubmit="return submitInventoryBulkAssign(event)" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <select name="recipient_type" required>${recipientTypeOptions}</select>
        <input name="quantity" type="number" min="1" value="1" style="max-width:80px;" title="Quantity each" />
        <select name="assigned_host_member_id" style="max-width:160px;">${hostMemberOptionsHtml}</select>
        <button class="btn gold small" type="submit">Assign to all</button>
      </form>
    </div>
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line);">
      <strong>Add one recipient</strong>
      <form onsubmit="return submitInventoryAddRecipient(event)" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:flex-start;">
        <select name="recipient_type" id="invAddRecipientType" required onchange="onInvAddRecipientTypeChange()">${recipientTypeOptions}</select>
        <select name="recipient_id" id="invAddRecipientId" required style="min-width:160px;"><option value="">-- select --</option></select>
        <input name="quantity" type="number" min="1" value="1" style="max-width:80px;" title="Quantity" />
        <select name="assigned_host_member_id" style="max-width:160px;">${hostMemberOptionsHtml}</select>
        <button class="btn small" type="submit">Add</button>
      </form>
    </div>
  `;
  await onInvAddRecipientTypeChange();
}

window.onInvAddRecipientTypeChange = async () => {
  const sel = document.getElementById('invAddRecipientType');
  const idSel = document.getElementById('invAddRecipientId');
  if (!sel || !idSel) return;
  idSel.innerHTML = await fetchRecipientOptions(sel.value, null);
};

window.updateInventoryDistField = async (distId, field, value) => {
  try { await jput(`${API}/inventory/distributions/${distId}`, { [field]: value }); await renderInventoryDistBody(); refreshInventoryItems(); refreshInventoryMonitor(); }
  catch (err) { toast(err.message); }
};
window.deleteInventoryDist = async (distId) => {
  await jdel(`${API}/inventory/distributions/${distId}`);
  await renderInventoryDistBody();
  refreshInventoryItems();
  refreshInventoryMonitor();
};
window.submitInventoryBulkAssign = async (e) => {
  e.preventDefault();
  const { itemId } = inventoryDistCtx;
  const body = Object.fromEntries(new FormData(e.target).entries());
  try {
    const r = await jpost(`${API}/inventory/${itemId}/distributions/bulk`, body);
    toast(`Assigned to ${r.created} recipient(s) (already-assigned recipients were skipped).`);
    e.target.reset();
    await renderInventoryDistBody();
    refreshInventoryItems();
    refreshInventoryMonitor();
  } catch (err) { toast(err.message); }
  return false;
};
window.submitInventoryAddRecipient = async (e) => {
  e.preventDefault();
  const { itemId } = inventoryDistCtx;
  const body = Object.fromEntries(new FormData(e.target).entries());
  if (!body.recipient_id) { toast('Choose a recipient'); return false; }
  try {
    await jpost(`${API}/inventory/${itemId}/distributions`, body);
    toast('Recipient added');
    e.target.reset();
    await renderInventoryDistBody();
    refreshInventoryItems();
    refreshInventoryMonitor();
  } catch (err) { toast(err.message); }
  return false;
};

// --- Per-PERSON goodies view — the mirror image of openInventoryDistModal.
// Opened from the "Goodies" button on Delegates/Host Members (replacing the
// old generic "Kit" checklist button), this lists every inventory item
// already assigned to that one recipient with an inline status dropdown so
// the distribution team can mark things delivered without hunting through
// the whole Goodies & Inventory stock list item-by-item. Reuses the same
// GET /inventory/monitor endpoint as the committee-wide Delivery Monitor
// table, just scoped to one recipient_type+recipient_id.
let goodiesCtx = { recipientType: null, recipientId: null, recipientName: '' };

window.openGoodiesModal = async (recipientType, recipientId, recipientName) => {
  goodiesCtx = { recipientType, recipientId, recipientName };
  document.getElementById('goodiesModalTitle').textContent = recipientName ? `Goodies — ${recipientName}` : 'Goodies';
  document.getElementById('goodiesModal').style.display = '';
  await renderGoodiesModalBody();
};
window.closeGoodiesModal = () => {
  document.getElementById('goodiesModal').style.display = 'none';
  goodiesCtx = { recipientType: null, recipientId: null, recipientName: '' };
};

async function renderGoodiesModalBody() {
  const { recipientType, recipientId } = goodiesCtx;
  if (!recipientType || !recipientId) return;
  const rows = await jget(`${API}/inventory/monitor?recipient_type=${recipientType}&recipient_id=${recipientId}`);
  const rowsHtml = rows.map((d) => `
    <div class="checklist-row status-${d.status}">
      <span class="checklist-label">
        ${d.item_name}${d.quantity > 1 ? ` ×${d.quantity}` : ''}
        ${d.item_category ? `<br><span class="hint">${d.item_category}</span>` : ''}
      </span>
      <select onchange="updateInventoryDistField(${d.id}, 'status', this.value)">
        <option value="pending" ${d.status === 'pending' ? 'selected' : ''}>Pending</option>
        <option value="delivered" ${d.status === 'delivered' ? 'selected' : ''}>Delivered</option>
        <option value="cancelled" ${d.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
      </select>
      ${d.status === 'delivered' && d.delivered_by_name ? `<span class="hint">✓ ${d.delivered_by_name}${d.delivered_at ? ' on ' + new Date(d.delivered_at).toLocaleDateString() : ''}</span>` : (d.assigned_host_member_name ? `<span class="hint">Assigned: ${d.assigned_host_member_name}</span>` : '')}
      ${canDelete() ? `<button class="btn danger small" onclick="deleteGoodiesDist(${d.id})">Delete</button>` : ''}
    </div>
  `).join('') || '<p class="empty">Nothing assigned to this person yet — add an item below.</p>';

  let items = [];
  try { items = await jget(`${API}/inventory`); } catch (e) { items = []; }
  const itemOptions = items.map((i) => `<option value="${i.id}">${i.name}${i.category ? ` (${i.category})` : ''} — ${i.quantity_remaining} ${i.unit} left</option>`).join('');

  document.getElementById('goodiesModalBody').innerHTML = `
    ${rowsHtml}
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line);">
      <strong>Assign an item to this person</strong>
      <form onsubmit="return submitGoodiesAssignItem(event)" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <select name="inventory_item_id" required style="min-width:200px;">
          <option value="">-- select item --</option>
          ${itemOptions}
        </select>
        <input name="quantity" type="number" min="1" value="1" style="max-width:80px;" title="Quantity" />
        <button class="btn gold small" type="submit">Assign</button>
      </form>
      ${!items.length ? '<p class="hint">No inventory items exist yet — add one in the Goodies &amp; Inventory tab first.</p>' : ''}
    </div>
  `;
}

window.submitGoodiesAssignItem = async (e) => {
  e.preventDefault();
  const { recipientType, recipientId } = goodiesCtx;
  const form = e.target;
  const itemId = form.elements.inventory_item_id.value;
  if (!itemId) { toast('Choose an item'); return false; }
  const quantity = form.elements.quantity.value || 1;
  try {
    await jpost(`${API}/inventory/${itemId}/distributions`, { recipient_type: recipientType, recipient_id: recipientId, quantity });
    toast('Item assigned');
    await renderGoodiesModalBody();
    refreshInventoryItems();
    refreshInventoryMonitor();
  } catch (err) { toast(err.message); }
  return false;
};
window.deleteGoodiesDist = async (distId) => {
  await jdel(`${API}/inventory/distributions/${distId}`);
  await renderGoodiesModalBody();
  refreshInventoryItems();
  refreshInventoryMonitor();
};

// --- Delivery monitor — by committee (mirrors the checklist Delivery Monitor) ---
async function refreshInventoryMonitorSummary() {
  const rows = await jget(`${API}/inventory/monitor/summary`);
  document.getElementById('inventoryMonitorSummaryBody').innerHTML = rows.map((r) => `
    <tr>
      <td>${r.committee_name || 'Unassigned'}</td>
      <td>${r.total}</td>
      <td>${r.delivered}</td>
      <td>${r.pending}</td>
      <td>${r.completion_pct !== null ? r.completion_pct + '%' : '-'}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">No deliveries assigned yet.</td></tr>';

  // Committee filter options must include every committee, not just ones
  // that already have a delivery recorded — same lesson learned from the
  // checklist Delivery Monitor's reassign-dropdown bug.
  let committees = ALL_COMMITTEES_CACHE;
  if (!committees.length) {
    try { committees = await jget(`${API}/committees`); ALL_COMMITTEES_CACHE = committees; } catch (e) { committees = []; }
  }
  const committeeOptions = committees.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  const filterSel = document.getElementById('inventoryMonitorFilterCommittee');
  if (filterSel) {
    const cur = filterSel.value;
    filterSel.innerHTML = `<option value="">All committees</option><option value="unassigned">Unassigned</option>${committeeOptions}`;
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
  const rows = await jget(`${API}/inventory/monitor?${params.toString()}`);
  document.getElementById('inventoryMonitorDetailBody').innerHTML = rows.map((r) => `
    <tr>
      <td>${r.item_name}${r.quantity > 1 ? ` ×${r.quantity}` : ''}<br><span class="hint">${r.item_category || '-'}</span></td>
      <td>${r.recipient_name || '-'} <span class="hint">(${RECIPIENT_TYPE_LABELS[r.recipient_type] || r.recipient_type})</span></td>
      <td>${r.committee_name || 'Unassigned'}</td>
      <td>${r.assigned_host_member_name || '-'}</td>
      <td><span class="pill ${r.status === 'delivered' ? 'done' : r.status === 'cancelled' ? 'refunded' : 'in_progress'}">${r.status}</span></td>
      <td>${r.delivered_by_name ? r.delivered_by_name + (r.delivered_at ? ' on ' + new Date(r.delivered_at).toLocaleDateString() : '') : '-'}</td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty">No deliveries match this filter.</td></tr>';
}

async function refreshInventoryMonitor() {
  await refreshInventoryMonitorSummary();
  await refreshInventoryMonitorDetail();
}
['inventoryMonitorFilterCommittee', 'inventoryMonitorFilterStatus', 'inventoryMonitorFilterRecipientType'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', refreshInventoryMonitorDetail);
});

// --- Activity Log (super_admin only) ---
// Read-only audit trail over the activity_log table — every logActivity()
// call scattered across the CRUD routes + self-service portal endpoints.
// Filters + pagination are server-side (server/routes/activityLog.js), this
// just tracks the current page/filter state and re-fetches on change.
let alPage = 1;
let alTotalPages = 1;
let alFiltersLoaded = false;

async function loadActivityLogFilters() {
  if (alFiltersLoaded) return;
  try {
    const f = await jget(`${API}/activity-log/filters`);
    const roleSel = document.getElementById('alFilterRole');
    const actionSel = document.getElementById('alFilterAction');
    const entitySel = document.getElementById('alFilterEntityType');
    f.roles.forEach((r) => { roleSel.innerHTML += `<option value="${r}">${r}</option>`; });
    f.actions.forEach((a) => { actionSel.innerHTML += `<option value="${a}">${a}</option>`; });
    f.entity_types.forEach((t) => { entitySel.innerHTML += `<option value="${t}">${t}</option>`; });
    alFiltersLoaded = true;
  } catch (e) {
    console.error('Failed to load activity log filters', e.message);
  }
}

async function refreshActivityLog() {
  if (!document.getElementById('alTableBody')) return;
  await loadActivityLogFilters();
  const params = new URLSearchParams();
  const search = document.getElementById('alFilterSearch').value.trim();
  const role = document.getElementById('alFilterRole').value;
  const action = document.getElementById('alFilterAction').value;
  const entityType = document.getElementById('alFilterEntityType').value;
  const dateFrom = document.getElementById('alFilterDateFrom').value;
  const dateTo = document.getElementById('alFilterDateTo').value;
  if (search) params.set('search', search);
  if (role) params.set('role', role);
  if (action) params.set('action', action);
  if (entityType) params.set('entity_type', entityType);
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);
  params.set('page', alPage);
  params.set('page_size', 50);

  const data = await jget(`${API}/activity-log?${params.toString()}`);
  alTotalPages = data.total_pages;
  document.getElementById('alTableBody').innerHTML = data.rows.map((r) => `
    <tr>
      <td>${new Date(r.created_at).toLocaleString()}</td>
      <td>${r.username || '-'}</td>
      <td>${r.role || '-'}</td>
      <td>${r.action}</td>
      <td>${r.entity_type || '-'}${r.entity_id ? ' #' + r.entity_id : ''}</td>
      <td>${r.label || '-'}</td>
      <td>${r.details || '-'}</td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty">No activity matches this filter.</td></tr>';
  document.getElementById('alPageInfo').textContent = `Page ${data.page} of ${data.total_pages} (${data.total} total)`;
  document.getElementById('alPrevPageBtn').disabled = data.page <= 1;
  document.getElementById('alNextPageBtn').disabled = data.page >= data.total_pages;
}

['alFilterRole', 'alFilterAction', 'alFilterEntityType', 'alFilterDateFrom', 'alFilterDateTo'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', () => { alPage = 1; refreshActivityLog(); });
});
document.getElementById('alFilterSearch')?.addEventListener('input', () => {
  clearTimeout(window._alSearchDebounce);
  window._alSearchDebounce = setTimeout(() => { alPage = 1; refreshActivityLog(); }, 350);
});
document.getElementById('alClearFiltersBtn')?.addEventListener('click', () => {
  document.getElementById('alFilterSearch').value = '';
  document.getElementById('alFilterRole').value = '';
  document.getElementById('alFilterAction').value = '';
  document.getElementById('alFilterEntityType').value = '';
  document.getElementById('alFilterDateFrom').value = '';
  document.getElementById('alFilterDateTo').value = '';
  alPage = 1;
  refreshActivityLog();
});
document.getElementById('alPrevPageBtn')?.addEventListener('click', () => {
  if (alPage > 1) { alPage--; refreshActivityLog(); }
});
document.getElementById('alNextPageBtn')?.addEventListener('click', () => {
  if (alPage < alTotalPages) { alPage++; refreshActivityLog(); }
});

// --- Scan Activity (badge stations — who scanned whom) ---
// Reads server/routes/badge.js's GET /scan-history (admin-only). Separate
// from the general Activity Log above: this is visitor check-ins/deliveries
// at hotel desk/transport/food counter/stalls/goodies, not admin CRUD edits.
const SCAN_POINT_LABEL = {
  gate: 'Gate', hotel_checkin: 'Hotel Check-in', hotel_checkout: 'Hotel Check-out',
  transport: 'Transport', food_counter: 'Food Counter', stall: 'Stall Visit', goodies: 'Goodies Delivery'
};
function scanMetaSummary(row) {
  let meta = row.meta;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch (e) { meta = null; } }
  if (!meta) return '-';
  const parts = [];
  if (meta.meal_slot) parts.push('Meal: ' + meta.meal_slot);
  if (meta.trip_id) parts.push('Trip #' + meta.trip_id);
  if (meta.stall_id) parts.push('Stall #' + meta.stall_id);
  if (meta.distribution_id) parts.push('Item #' + meta.distribution_id);
  return parts.join(', ') || '-';
}
async function refreshScanActivity() {
  if (!document.getElementById('saTableBody')) return;
  const params = new URLSearchParams();
  const scanPoint = document.getElementById('saFilterScanPoint').value;
  const dateFrom = document.getElementById('saFilterDateFrom').value;
  const dateTo = document.getElementById('saFilterDateTo').value;
  if (scanPoint) params.set('scan_point', scanPoint);
  if (dateFrom) params.set('from_date', dateFrom);
  if (dateTo) params.set('to_date', dateTo);
  let rows;
  try {
    rows = await jget(`${API}/badge/scan-history?${params.toString()}`);
  } catch (e) {
    document.getElementById('saTableBody').innerHTML = `<tr><td colspan="5" class="empty">${e.message}</td></tr>`;
    return;
  }
  document.getElementById('saTableBody').innerHTML = rows.map((r) => `
    <tr>
      <td>${new Date(r.checked_in_at).toLocaleString()}</td>
      <td>${SCAN_POINT_LABEL[r.scan_point] || r.scan_point}</td>
      <td>${r.scanner_username || '-'}${r.scanner_role ? ' (' + r.scanner_role + ')' : ''}</td>
      <td>${r.entity_name || '-'}</td>
      <td>${scanMetaSummary(r)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">No scans match this filter.</td></tr>';
}
['saFilterScanPoint', 'saFilterDateFrom', 'saFilterDateTo'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', refreshScanActivity);
});
document.getElementById('saClearFiltersBtn')?.addEventListener('click', () => {
  document.getElementById('saFilterScanPoint').value = '';
  document.getElementById('saFilterDateFrom').value = '';
  document.getElementById('saFilterDateTo').value = '';
  refreshScanActivity();
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

document.getElementById('bulkCreateLoginsBtn').addEventListener('click', async () => {
  if (!confirm('Create a login for every host member with a mobile number on file, using that number as username and "pass123" as password? Members who already have a login are skipped.')) return;
  const btn = document.getElementById('bulkCreateLoginsBtn');
  const out = document.getElementById('bulkCreateLoginsResult');
  btn.disabled = true;
  btn.textContent = 'Creating logins...';
  out.textContent = '';
  try {
    const summary = await jpost(`${API}/auth/users/bulk-create-host-logins`, {});
    const lines = [`Created ${summary.created.length} login(s) with password "${summary.default_password}":`];
    summary.created.forEach((c) => lines.push(`  • ${c.name} — username ${c.username}`));
    if (summary.skipped.length) {
      lines.push(`\nSkipped ${summary.skipped.length}:`);
      summary.skipped.forEach((s) => lines.push(`  • ${s.name} — ${s.reason}`));
    }
    out.textContent = lines.join('\n');
    toast(`${summary.created.length} login(s) created`);
    refreshHostMembers();
    refreshUsersAdmin();
  } catch (err) {
    out.textContent = 'Failed: ' + err.message;
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Logins for All Host Members';
  }
});

document.getElementById('bulkResetHostPasswordsBtn').addEventListener('click', async () => {
  if (!confirm('This resets EVERY host member\'s login password to "pass123" — including anyone who already changed it — and creates a login for anyone who still doesn\'t have one. Only do this right before sending a credentials email. Continue?')) return;
  const btn = document.getElementById('bulkResetHostPasswordsBtn');
  const out = document.getElementById('bulkResetHostPasswordsResult');
  btn.disabled = true;
  btn.textContent = 'Resetting passwords...';
  out.textContent = '';
  try {
    const summary = await jpost(`${API}/auth/users/bulk-reset-host-passwords`, {});
    const lines = [`Password now "${summary.default_password}" for ${summary.created.length} new + ${summary.reset.length} existing login(s).`];
    if (summary.created.length) {
      lines.push(`\nNew logins created (${summary.created.length}):`);
      summary.created.forEach((c) => lines.push(`  • ${c.name} — username ${c.username}`));
    }
    if (summary.reset.length) {
      lines.push(`\nExisting logins reset (${summary.reset.length}):`);
      summary.reset.forEach((r) => lines.push(`  • ${r.name}`));
    }
    if (summary.skipped.length) {
      lines.push(`\nSkipped ${summary.skipped.length}:`);
      summary.skipped.forEach((s) => lines.push(`  • ${s.name} — ${s.reason}`));
    }
    out.textContent = lines.join('\n');
    toast(`${summary.created.length + summary.reset.length} host member login(s) now on pass123`);
    refreshHostMembers();
    refreshUsersAdmin();
  } catch (err) {
    out.textContent = 'Failed: ' + err.message;
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Reset ALL Host Member Passwords to pass123';
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

  const linkedProfile = (u) => u.host_member_name || u.driver_name || u.partner_name || u.volunteer_name || u.vendor_name || '<span class="hint">-</span>';
  document.getElementById('allUsersBody').innerHTML = users.map((u) => `
    <tr>
      <td>${u.username}</td><td>${u.email || '-'}</td><td>${u.role}</td>
      <td>${linkedProfile(u)}</td>
      <td>${userBadge(u.status)}</td>
      <td>${new Date(u.created_at).toLocaleDateString()}</td>
      <td class="sticky-actions">
        <button class="btn small" onclick="openChangeRoleModal(${u.id})">Change role</button>
        <button class="btn small" onclick="resetUserPassword(${u.id}, '${(u.username || '').replace(/'/g, "\\'")}')">Reset password</button>
        ${u.id === CURRENT_USER.id ? '<span class="hint">(you)</span>' : `<button class="btn danger small" onclick="deleteUser(${u.id})">Delete</button>`}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty">No logins yet</td></tr>';

  // Scanner Logins — a filtered slice of the same users list: every
  // dedicated 'scanner' login (Hotel Desk/Transport/Food Counter/Goodies/
  // Registration) plus every 'stall_owner' login (Stalls duty), since from
  // the "which scanning point does this person cover" point of view they're
  // the same category — just two different roles under the hood (stalls
  // needs a specific stall_id, so it keeps its own role/linked column).
  const scannerLogins = users.filter((u) => u.role === 'scanner' || u.role === 'stall_owner');
  const scannerLoginsBody = document.getElementById('scannerLoginsBody');
  if (scannerLoginsBody) {
    scannerLoginsBody.innerHTML = scannerLogins.map((u) => {
      const station = u.role === 'stall_owner'
        ? `Stall: ${u.stall_company_name || '(unassigned)'}`
        : (SCAN_POINT_STATION_LABEL[u.scan_point] || '<span class="hint">(none set)</span>');
      return `
        <tr>
          <td>${u.username}</td>
          <td>${station}</td>
          <td>${new Date(u.created_at).toLocaleDateString()}</td>
          <td class="sticky-actions">
            <button class="btn small" onclick="openChangeRoleModal(${u.id})">Change station</button>
            <button class="btn small" onclick="resetUserPassword(${u.id}, '${(u.username || '').replace(/'/g, "\\'")}')">Reset password</button>
            ${u.id === CURRENT_USER.id ? '<span class="hint">(you)</span>' : `<button class="btn danger small" onclick="deleteUser(${u.id})">Delete</button>`}
          </td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="4" class="empty">No scanner logins yet — create one above.</td></tr>';
  }
}
const SCAN_POINT_STATION_LABEL = {
  hotel_desk: 'Hotel Desk', transport: 'Transport', food_counter: 'Food Counter',
  inventory: 'Goodies / Inventory', registration: 'Registration Desk'
};
window.approveUser = async (id) => { await jput(`${API}/auth/users/${id}/approve`, {}); toast('Approved'); refreshUsersAdmin(); };
window.rejectUser = async (id) => { await jput(`${API}/auth/users/${id}/reject`, {}); toast('Rejected'); refreshUsersAdmin(); };
window.deleteUser = async (id) => { if (!confirm('Delete this login?')) return; await jdel(`${API}/auth/users/${id}`); toast('Login removed'); refreshUsersAdmin(); };

// Change a login's role + linked profile record. Reuses the same
// role -> linked-column mapping as "Generate a Login" (LINKED_FIELD_BY_ROLE
// below) and the same ROLE_LABEL text as createUserRoleSelect, so the two
// forms stay in sync. The backend (PUT /auth/users/:id) always clears every
// OTHER linked column when the role changes, so switching e.g.
// host_member -> media can't leave a stale host_member_id behind.
const ROLE_LABEL = {
  admin: 'Admin', super_admin: 'Super Admin', host_member: 'Host Member',
  media: 'Media (designer — upload video/posters only)',
  transporter: 'Transporter (transport vendor coordinator)', driver: 'Driver',
  volunteer: 'Volunteer (external/non-member data-entry helper)',
  vendor: 'Vendor (goods supplier — manages own products/orders)',
  stall_owner: 'Stall Owner (exhibitor — scans visitor badges, sees own leads list)',
  scanner: 'Scanner (dedicated scan-duty login — no other module access)'
};
const LINKED_FIELD_BY_ROLE = { host_member: 'host_member_id', driver: 'driver_id', transporter: 'partner_id', volunteer: 'volunteer_id', vendor: 'vendor_id', stall_owner: 'stall_id' };
const LINKED_LABEL_BY_ROLE = { host_member: 'host member', driver: 'driver', transporter: 'transport partner', volunteer: 'volunteer', vendor: 'vendor', stall_owner: 'stall' };
const VEHICLE_ASSIGNABLE_ROLES = ['transporter', 'driver'];

function changeRoleToggleFields(role) {
  const map = { host_member: 'changeRoleHmField', driver: 'changeRoleDriverField', transporter: 'changeRolePartnerField', volunteer: 'changeRoleVolunteerField', vendor: 'changeRoleVendorField', stall_owner: 'changeRoleStallField' };
  Object.values(map).forEach((fieldId) => {
    const el = document.getElementById(fieldId);
    if (el) el.style.display = 'none';
  });
  const activeFieldId = map[role];
  if (activeFieldId) {
    const el = document.getElementById(activeFieldId);
    if (el) el.style.display = '';
  }
  const vehicleField = document.getElementById('changeRoleVehicleField');
  if (vehicleField) vehicleField.style.display = VEHICLE_ASSIGNABLE_ROLES.includes(role) ? '' : 'none';
}

window.openChangeRoleModal = async (id) => {
  let users;
  try { users = await jget(`${API}/auth/users`); } catch (e) { toast(e.message); return; }
  const u = users.find((x) => x.id === id);
  if (!u) return;
  let hmRows, driverRows, partnerRows, volRows, vendorRows, stallRows, vehicleRows;
  try {
    [hmRows, driverRows, partnerRows, volRows, vendorRows, stallRows, vehicleRows] = await Promise.all([
      jget(`${API}/hostmembers`).catch(() => []),
      jget(`${API}/drivers`).catch(() => []),
      jget(`${API}/partners`).catch(() => []),
      jget(`${API}/volunteers`).catch(() => []),
      jget(`${API}/vendors`).catch(() => []),
      jget(`${API}/stalls`).catch(() => []),
      jget(`${API}/vehicles`).catch(() => [])
    ]);
  } catch (e) {
    hmRows = driverRows = partnerRows = volRows = vendorRows = stallRows = vehicleRows = [];
  }
  const hmOpts = hmRows.map((h) => `<option value="${h.id}">${h.name}${h.company ? ' (' + h.company + ')' : ''}</option>`).join('');
  const driverOpts = driverRows.map((d) => `<option value="${d.id}">${d.name}${d.vehicle_code ? ' — ' + d.vehicle_code : ''}</option>`).join('');
  const partnerOpts = partnerRows.map((p) => `<option value="${p.id}">${p.name}${p.category ? ' (' + p.category + ')' : ''}</option>`).join('');
  const volOpts = volRows.map((v) => `<option value="${v.id}">${v.name}${v.organization ? ' (' + v.organization + ')' : ''}</option>`).join('');
  const vendorOpts = vendorRows.map((v) => `<option value="${v.id}">${v.name}${v.category ? ' (' + v.category + ')' : ''}</option>`).join('');
  const stallOpts = stallRows.map((s) => `<option value="${s.id}">${s.hall_name} — ${s.stall_number}${s.booked_company_name ? ' (' + s.booked_company_name + ')' : ''}</option>`).join('');
  const vehicleOpts = vehicleRows.map((v) => `<option value="${v.id}">${v.vehicle_code} · ${v.vehicle_type}${v.model ? ' — ' + v.model : ''}</option>`).join('');

  document.getElementById('changeRoleModalTitle').textContent = `Change role — ${u.username}`;
  document.getElementById('changeRoleModalBody').innerHTML = `
    <form id="changeRoleForm" data-user-id="${u.id}">
      <div class="form-grid cols-2">
        <div class="field">
          <label>Role</label>
          <select name="role" id="changeRoleSelect">
            ${Object.entries(ROLE_LABEL).map(([r, label]) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
        <div class="field" id="changeRoleHmField" style="display:none;">
          <label>Host member *</label>
          <select name="host_member_id" id="changeRoleHmSelect"><option value="">-- select --</option>${hmOpts}</select>
        </div>
        <div class="field" id="changeRoleDriverField" style="display:none;">
          <label>Driver *</label>
          <select name="driver_id" id="changeRoleDriverSelect"><option value="">-- select --</option>${driverOpts}</select>
        </div>
        <div class="field" id="changeRolePartnerField" style="display:none;">
          <label>Transport partner (vendor) *</label>
          <select name="partner_id" id="changeRolePartnerSelect"><option value="">-- select --</option>${partnerOpts}</select>
        </div>
        <div class="field" id="changeRoleVolunteerField" style="display:none;">
          <label>Volunteer *</label>
          <select name="volunteer_id" id="changeRoleVolunteerSelect"><option value="">-- select --</option>${volOpts}</select>
        </div>
        <div class="field" id="changeRoleVendorField" style="display:none;">
          <label>Vendor *</label>
          <select name="vendor_id" id="changeRoleVendorSelect"><option value="">-- select --</option>${vendorOpts}</select>
        </div>
        <div class="field" id="changeRoleStallField" style="display:none;">
          <label>Stall *</label>
          <select name="stall_id" id="changeRoleStallSelect"><option value="">-- select --</option>${stallOpts}</select>
        </div>
        <div class="field" id="changeRoleVehicleField" style="display:none;">
          <label>Assigned vehicle</label>
          <select name="vehicle_id" id="changeRoleVehicleSelect"><option value="">-- none --</option>${vehicleOpts}</select>
          <span class="hint">For Transport/Pre-Tours/Airport-Train boarding scans.</span>
        </div>
        <div class="field">
          <label>Scan duty (QR badge station)</label>
          <select name="scan_point" id="changeRoleScanPointSelect">
            <option value="">-- none --</option>
            <option value="hotel_desk" ${u.scan_point === 'hotel_desk' ? 'selected' : ''}>Hotel Desk (check-in/out)</option>
            <option value="transport" ${u.scan_point === 'transport' ? 'selected' : ''}>Transport (boarding)</option>
            <option value="food_counter" ${u.scan_point === 'food_counter' ? 'selected' : ''}>Food Counter</option>
            <option value="inventory" ${u.scan_point === 'inventory' ? 'selected' : ''}>Goodies / Inventory</option>
            <option value="registration" ${u.scan_point === 'registration' ? 'selected' : ''}>Registration Desk</option>
          </select>
          <span class="hint">Optional, independent of role.</span>
        </div>
      </div>
      <button class="btn gold" type="submit">Save role</button>
    </form>
  `;
  // Preselect whichever linked-profile select matches this login's CURRENT
  // role/link, then show only that field (matching the create-login toggle).
  const linkedField = LINKED_FIELD_BY_ROLE[u.role];
  if (linkedField && u[linkedField]) {
    const selectId = { host_member_id: 'changeRoleHmSelect', driver_id: 'changeRoleDriverSelect', partner_id: 'changeRolePartnerSelect', volunteer_id: 'changeRoleVolunteerSelect', vendor_id: 'changeRoleVendorSelect', stall_id: 'changeRoleStallSelect' }[linkedField];
    const sel = document.getElementById(selectId);
    if (sel) sel.value = String(u[linkedField]);
  }
  if (u.vehicle_id) {
    const vsel = document.getElementById('changeRoleVehicleSelect');
    if (vsel) vsel.value = String(u.vehicle_id);
  }
  changeRoleToggleFields(u.role);
  document.getElementById('changeRoleSelect').addEventListener('change', (e) => changeRoleToggleFields(e.target.value));
  document.getElementById('changeRoleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    const vehicleIdToAssign = VEHICLE_ASSIGNABLE_ROLES.includes(body.role) ? (body.vehicle_id || null) : null;
    delete body.vehicle_id;
    for (const field of ['host_member_id', 'driver_id', 'partner_id', 'volunteer_id', 'vendor_id', 'stall_id']) {
      if (LINKED_FIELD_BY_ROLE[body.role] !== field) delete body[field];
    }
    const requiredField = LINKED_FIELD_BY_ROLE[body.role];
    if (requiredField && !body[requiredField]) {
      toast(`Choose which ${LINKED_LABEL_BY_ROLE[body.role]} this login belongs to.`);
      return;
    }
    try {
      const userId = e.target.dataset.userId;
      await jput(`${API}/auth/users/${userId}`, body);
      if (VEHICLE_ASSIGNABLE_ROLES.includes(body.role)) {
        await jput(`${API}/auth/users/${userId}/vehicle`, { vehicle_id: vehicleIdToAssign });
      }
      toast('Role updated');
      closeChangeRoleModal();
      refreshUsersAdmin();
    } catch (err) { toast(err.message); }
  });
  document.getElementById('changeRoleModal').style.display = '';
};
window.closeChangeRoleModal = () => { document.getElementById('changeRoleModal').style.display = 'none'; };
// Forgot-password recovery for any login (regular admin, host member, media,
// transporter, driver) — sets a brand-new password without needing to know
// the old one, unlike the self-service "Change my password" flow elsewhere
// in Settings (which always requires the current password).
window.resetUserPassword = async (id, username) => {
  const password = prompt(`New password for "${username}" (min 6 characters):`);
  if (!password) return;
  if (password.length < 6) { toast('Password must be at least 6 characters'); return; }
  try {
    await jput(`${API}/auth/users/${id}/reset-password`, { new_password: password });
    toast(`Password reset for ${username}. Share the new password with them directly.`, 6000);
  } catch (err) { toast(err.message); }
};

// Show/hide + require the matching linked-profile picker for roles that need
// one (host_member -> host member, driver -> driver, transporter -> partner).
// 'media' has no linked record, so all three stay hidden for it.
const createUserRoleSelect = document.getElementById('createUserRoleSelect');
const createUserHmField = document.getElementById('createUserHmField');
const createUserHmSelect = document.getElementById('createUserHmSelect');
const createUserDriverField = document.getElementById('createUserDriverField');
const createUserDriverSelect = document.getElementById('createUserDriverSelect');
const createUserPartnerField = document.getElementById('createUserPartnerField');
const createUserPartnerSelect = document.getElementById('createUserPartnerSelect');
const createUserVolunteerField = document.getElementById('createUserVolunteerField');
const createUserVolunteerSelect = document.getElementById('createUserVolunteerSelect');
const createUserVendorField = document.getElementById('createUserVendorField');
const createUserVendorSelect = document.getElementById('createUserVendorSelect');
const createUserStallField = document.getElementById('createUserStallField');
const createUserStallSelect = document.getElementById('createUserStallSelect');
const createUserVehicleField = document.getElementById('createUserVehicleField');
const createUserVehicleSelect = document.getElementById('createUserVehicleSelect');
let STALL_OPTS_CACHE = null;
let VEHICLE_OPTS_CACHE = null;
async function ensureStallOptsLoaded() {
  if (STALL_OPTS_CACHE !== null) return;
  try {
    const rows = await jget(`${API}/stalls`);
    STALL_OPTS_CACHE = rows.map((s) => `<option value="${s.id}">${s.hall_name} — ${s.stall_number}${s.booked_company_name ? ' (' + s.booked_company_name + ')' : ''}</option>`).join('');
  } catch (e) { STALL_OPTS_CACHE = ''; }
  if (createUserStallSelect) createUserStallSelect.innerHTML = '<option value="">-- select --</option>' + STALL_OPTS_CACHE;
}
async function ensureVehicleOptsLoaded() {
  if (VEHICLE_OPTS_CACHE !== null) return;
  try {
    const rows = await jget(`${API}/vehicles`);
    VEHICLE_OPTS_CACHE = rows.map((v) => `<option value="${v.id}">${v.vehicle_code} · ${v.vehicle_type}${v.model ? ' — ' + v.model : ''}</option>`).join('');
  } catch (e) { VEHICLE_OPTS_CACHE = ''; }
  if (createUserVehicleSelect) createUserVehicleSelect.innerHTML = '<option value="">-- none yet --</option>' + VEHICLE_OPTS_CACHE;
}
if (createUserRoleSelect) {
  createUserRoleSelect.addEventListener('change', () => {
    const role = createUserRoleSelect.value;
    const isHostMember = role === 'host_member';
    const isDriver = role === 'driver';
    const isTransporter = role === 'transporter';
    const isVolunteer = role === 'volunteer';
    const isVendor = role === 'vendor';
    const isStallOwner = role === 'stall_owner';
    const isVehicleRole = VEHICLE_ASSIGNABLE_ROLES.includes(role);
    createUserHmField.style.display = isHostMember ? '' : 'none';
    if (createUserHmSelect) createUserHmSelect.required = isHostMember;
    createUserDriverField.style.display = isDriver ? '' : 'none';
    if (createUserDriverSelect) createUserDriverSelect.required = isDriver;
    createUserPartnerField.style.display = isTransporter ? '' : 'none';
    if (createUserPartnerSelect) createUserPartnerSelect.required = isTransporter;
    if (createUserVolunteerField) createUserVolunteerField.style.display = isVolunteer ? '' : 'none';
    if (createUserVolunteerSelect) createUserVolunteerSelect.required = isVolunteer;
    if (createUserVendorField) createUserVendorField.style.display = isVendor ? '' : 'none';
    if (createUserVendorSelect) createUserVendorSelect.required = isVendor;
    if (createUserStallField) createUserStallField.style.display = isStallOwner ? '' : 'none';
    if (createUserStallSelect) createUserStallSelect.required = isStallOwner;
    if (isStallOwner) ensureStallOptsLoaded();
    if (createUserVehicleField) createUserVehicleField.style.display = isVehicleRole ? '' : 'none';
    if (isVehicleRole) ensureVehicleOptsLoaded();
  });
}

document.getElementById('createUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  const localLinkedField = { host_member: 'host_member_id', driver: 'driver_id', transporter: 'partner_id', volunteer: 'volunteer_id', vendor: 'vendor_id', stall_owner: 'stall_id' };
  const localLinkedLabel = { host_member: 'host member', driver: 'driver', transporter: 'transport partner', volunteer: 'volunteer', vendor: 'vendor', stall_owner: 'stall' };
  const vehicleIdToAssign = VEHICLE_ASSIGNABLE_ROLES.includes(body.role) ? (body.vehicle_id || null) : null;
  delete body.vehicle_id;
  for (const field of ['host_member_id', 'driver_id', 'partner_id', 'volunteer_id', 'vendor_id', 'stall_id']) {
    if (localLinkedField[body.role] !== field) delete body[field];
  }
  const requiredField = localLinkedField[body.role];
  if (requiredField && !body[requiredField]) {
    toast(`Choose which ${localLinkedLabel[body.role]} this login belongs to.`);
    return;
  }
  try {
    const created = await jpost(`${API}/auth/users`, body);
    if (vehicleIdToAssign && created && created.id) {
      await jput(`${API}/auth/users/${created.id}/vehicle`, { vehicle_id: vehicleIdToAssign });
    }
    e.target.reset();
    createUserHmField.style.display = 'none';
    createUserDriverField.style.display = 'none';
    createUserPartnerField.style.display = 'none';
    if (createUserVolunteerField) createUserVolunteerField.style.display = 'none';
    if (createUserVendorField) createUserVendorField.style.display = 'none';
    if (createUserStallField) createUserStallField.style.display = 'none';
    if (createUserVehicleField) createUserVehicleField.style.display = 'none';
    toast('Login created');
    refreshUsersAdmin();
    refreshHostMembers();
    refreshVolunteers();
    if (typeof refreshVendors === 'function') refreshVendors();
  } catch (err) { toast(err.message); }
});

// --- Scanner Logins: a purpose-built create form for scan-duty-only
// accounts. Internally this is just POST /auth/users with role='scanner' +
// scan_point=<station> (or role='stall_owner' + stall_id=<pick> when
// "Stalls" is chosen) — same endpoint as "Generate a Login" above, just
// packaged as one "Station" picker instead of a separate Role + Scan duty
// pair, since for this form the station IS the whole point of the account.
const scannerStationSelect = document.getElementById('scannerStationSelect');
const scannerStallField = document.getElementById('scannerStallField');
const scannerStallSelect = document.getElementById('scannerStallSelect');
async function ensureScannerStallOptsLoaded() {
  await ensureStallOptsLoaded(); // populates the shared STALL_OPTS_CACHE
  if (scannerStallSelect) scannerStallSelect.innerHTML = '<option value="">-- select --</option>' + (STALL_OPTS_CACHE || '');
}
if (scannerStationSelect) {
  scannerStationSelect.addEventListener('change', () => {
    const isStalls = scannerStationSelect.value === 'stalls';
    if (scannerStallField) scannerStallField.style.display = isStalls ? '' : 'none';
    if (scannerStallSelect) scannerStallSelect.required = isStalls;
    if (isStalls) ensureScannerStallOptsLoaded();
  });
}
const scannerCreateForm = document.getElementById('scannerCreateForm');
if (scannerCreateForm) {
  scannerCreateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    const station = body.station;
    delete body.station;
    if (!station) { toast('Choose which station this login is for.'); return; }
    if (station === 'stalls') {
      if (!body.stall_id) { toast('Choose which stall this login belongs to.'); return; }
      body.role = 'stall_owner';
    } else {
      body.role = 'scanner';
      body.scan_point = station;
      delete body.stall_id;
    }
    try {
      await jpost(`${API}/auth/users`, body);
      e.target.reset();
      if (scannerStallField) scannerStallField.style.display = 'none';
      toast('Scanner login created');
      refreshUsersAdmin();
    } catch (err) { toast(err.message); }
  });
}
const viewScanActivityBtn = document.getElementById('viewScanActivityBtn');
if (viewScanActivityBtn) {
  viewScanActivityBtn.addEventListener('click', () => switchAdminTab('activitylog'));
}

document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await jput(`${API}/auth/me/password`, Object.fromEntries(fd.entries()));
    e.target.reset();
    toast('Password updated');
  } catch (err) { toast(err.message); }
});

// --- Stalls: enquiry -> billed -> allocated workflow -----------------------
// Halls and stalls are simple admin-managed masters (the venue's final
// hall/stall count isn't fixed yet); stall_bookings is the enquiry/company
// side — always an external exhibitor, never a host member.
const STALL_STATUS_LABEL = { enquiry: 'Enquiry', billed: 'Billed', allocated: 'Allocated', cancelled: 'Cancelled' };

// --- Halls ---
async function refreshStallHalls() {
  const rows = await jget(`${API}/stall-halls`);
  document.getElementById('stallHallTableBody').innerHTML = rows.map((h) => `
    <tr>
      <td><strong>${h.name}</strong>${h.notes ? '<div class="hint">' + h.notes + '</div>' : ''}</td>
      <td>${h.capacity != null ? h.capacity : '-'}</td>
      <td>${h.stall_count}</td>
      <td>${h.available_count}</td>
      <td>${h.allocated_count}</td>
      <td class="sticky-actions">
        <button class="btn small" onclick="editStallHall(${h.id})">Update</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteStallHall(${h.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty">No halls yet</td></tr>';

  const opts = rows.map((h) => `<option value="${h.id}">${h.name}</option>`).join('');
  ['stallGenerateHallSelect', 'stallHallSelect'].forEach((id) => {
    const sel = document.getElementById(id);
    if (sel) sel.innerHTML = '<option value="">-- select hall --</option>' + opts;
  });
  const filterSel = document.getElementById('stallFilterHall');
  if (filterSel) filterSel.innerHTML = '<option value="">All halls</option>' + opts;
}
window.deleteStallHall = async (id) => {
  try { await jdel(`${API}/stall-halls/${id}`); toast('Hall removed'); refreshStallHalls(); refreshStalls(); }
  catch (err) { toast(err.message); }
};
const STALL_HALL_FORM_FIELDS = ['name', 'capacity', 'notes'];
window.editStallHall = async (id) => {
  const rows = await jget(`${API}/stall-halls`);
  const h = rows.find((r) => r.id === id);
  if (!h) return;
  const form = document.getElementById('stallHallForm');
  STALL_HALL_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = h[f] !== null && h[f] !== undefined ? h[f] : ''; });
  form.dataset.editId = id;
  document.getElementById('stallHallFormTitle').textContent = 'Update hall';
  document.getElementById('stallHallSubmitBtn').textContent = 'Update Hall';
  document.getElementById('stallHallCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('stallHallCancelEditBtn').addEventListener('click', () => {
  const form = document.getElementById('stallHallForm');
  form.reset(); delete form.dataset.editId;
  document.getElementById('stallHallFormTitle').textContent = 'Add hall';
  document.getElementById('stallHallSubmitBtn').textContent = 'Save Hall';
  document.getElementById('stallHallCancelEditBtn').style.display = 'none';
});
document.getElementById('stallHallForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.editId) {
      await jput(`${API}/stall-halls/${form.dataset.editId}`, body);
      delete form.dataset.editId;
      form.reset();
      document.getElementById('stallHallFormTitle').textContent = 'Add hall';
      document.getElementById('stallHallSubmitBtn').textContent = 'Save Hall';
      document.getElementById('stallHallCancelEditBtn').style.display = 'none';
      toast('Hall updated');
    } else {
      await jpost(`${API}/stall-halls`, body);
      form.reset();
      toast('Hall saved');
    }
    refreshStallHalls();
  } catch (err) { toast(err.message); }
});

// --- Stalls (per hall) ---
async function refreshStalls() {
  const hallId = document.getElementById('stallFilterHall')?.value || '';
  const status = document.getElementById('stallFilterStatus')?.value || '';
  const params = new URLSearchParams();
  if (hallId) params.set('hall_id', hallId);
  if (status) params.set('status', status);
  const qs = params.toString();
  const rows = await jget(`${API}/stalls${qs ? '?' + qs : ''}`);
  document.getElementById('stallTableBody').innerHTML = rows.map((s) => `
    <tr>
      <td>${s.hall_name}</td>
      <td><strong>${s.stall_number}</strong></td>
      <td>${s.size || '-'}</td>
      <td>${Number(s.price || 0).toLocaleString('en-IN')}</td>
      <td><span class="pill ${s.status}">${s.status === 'allocated' ? 'Allocated' : 'Available'}</span></td>
      <td>${s.booked_company_name || '-'}</td>
      <td class="sticky-actions">
        <button class="btn small" onclick="editStall(${s.id})">Update</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteStall(${s.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty">No stalls yet</td></tr>';

  // Refresh the stall picker on the Enquiries & Bookings form too, so a
  // newly generated/edited stall shows up there without a manual reload.
  refreshStallBookingStallOptions();
}
window.deleteStall = async (id) => {
  try { await jdel(`${API}/stalls/${id}`); toast('Stall removed'); refreshStalls(); refreshStallHalls(); }
  catch (err) { toast(err.message); }
};
const STALL_FORM_FIELDS = ['hall_id', 'stall_number', 'size', 'price', 'notes'];
window.editStall = async (id) => {
  const rows = await jget(`${API}/stalls`);
  const s = rows.find((r) => r.id === id);
  if (!s) return;
  const form = document.getElementById('stallForm');
  STALL_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = s[f] !== null && s[f] !== undefined ? s[f] : ''; });
  form.dataset.editId = id;
  document.getElementById('stallFormTitle').textContent = 'Update stall';
  document.getElementById('stallSubmitBtn').textContent = 'Update Stall';
  document.getElementById('stallCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('stallCancelEditBtn').addEventListener('click', () => {
  const form = document.getElementById('stallForm');
  form.reset(); delete form.dataset.editId;
  document.getElementById('stallFormTitle').textContent = 'Add a single stall';
  document.getElementById('stallSubmitBtn').textContent = 'Save Stall';
  document.getElementById('stallCancelEditBtn').style.display = 'none';
});
document.getElementById('stallForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.editId) {
      await jput(`${API}/stalls/${form.dataset.editId}`, body);
      delete form.dataset.editId;
      form.reset();
      document.getElementById('stallFormTitle').textContent = 'Add a single stall';
      document.getElementById('stallSubmitBtn').textContent = 'Save Stall';
      document.getElementById('stallCancelEditBtn').style.display = 'none';
      toast('Stall updated');
    } else {
      await jpost(`${API}/stalls`, body);
      form.reset();
      toast('Stall saved');
    }
    refreshStalls();
    refreshStallHalls();
  } catch (err) { toast(err.message); }
});
document.getElementById('stallGenerateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    const res = await jpost(`${API}/stalls/generate`, body);
    toast(`Generated ${res.created} stall(s)${res.skipped ? `, ${res.skipped} already existed` : ''}`);
    form.reset();
    refreshStalls();
    refreshStallHalls();
  } catch (err) { toast(err.message); }
});
document.getElementById('stallFilterHall').addEventListener('change', refreshStalls);
document.getElementById('stallFilterStatus').addEventListener('change', refreshStalls);

// --- Stall Bookings (enquiry -> billed -> allocated) ---
// The stall picker only ever offers stalls that are available OR are the
// booking currently being edited's own stall — so admins can't accidentally
// pick a stall someone else already holds.
async function refreshStallBookingStallOptions(selectedStallId) {
  const sel = document.getElementById('stallBookingStallSelect');
  if (!sel) return;
  const rows = await jget(`${API}/stalls`);
  const usable = rows.filter((s) => s.status === 'available' || String(s.id) === String(selectedStallId));
  sel.innerHTML = '<option value="">-- none yet --</option>' + usable.map((s) =>
    `<option value="${s.id}" ${String(selectedStallId) === String(s.id) ? 'selected' : ''}>${s.hall_name} — ${s.stall_number} (₹${Number(s.price || 0).toLocaleString('en-IN')})</option>`
  ).join('');
}
// --- Exhibitors Directory (Halls & Stalls tab) — a read-only consolidated
// view over the SAME stall_bookings rows shown in Enquiries & Bookings, just
// filtered/searchable and framed as "who are all our exhibitors" rather than
// the enquiry-workflow view. No new backend endpoint — reuses GET /stall-bookings.
async function refreshExhibitorsDirectory() {
  const rows = await jget(`${API}/stall-bookings`);
  const status = document.getElementById('exhibitorFilterStatus')?.value || '';
  const payment = document.getElementById('exhibitorFilterPayment')?.value || '';
  const q = (document.getElementById('exhibitorSearchInput')?.value || '').toLowerCase();
  const filtered = rows.filter((b) => {
    if (status && b.status !== status) return false;
    if (payment && b.payment_status !== payment) return false;
    if (q && ![b.company_name, b.contact_person, b.phone].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))) return false;
    return true;
  });
  document.getElementById('exhibitorTableBody').innerHTML = filtered.map((b) => `
    <tr>
      <td><strong>${b.company_name}</strong>${b.gstin ? '<div class="hint">GSTIN: ' + b.gstin + '</div>' : ''}</td>
      <td>${b.contact_person || '-'}${b.phone ? '<div class="hint">' + b.phone + (b.email ? ' · ' + b.email : '') + '</div>' : ''}</td>
      <td>${b.stall_number ? b.hall_name + ' — ' + b.stall_number : '-'}</td>
      <td><span class="pill ${b.status}">${STALL_STATUS_LABEL[b.status] || b.status}</span></td>
      <td><span class="pill ${b.payment_status}">${b.payment_status === 'paid' ? 'Paid' : 'Pending'}</span></td>
      <td>${Number(b.amount || 0).toLocaleString('en-IN')}</td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty">No exhibitors match this filter.</td></tr>';
}
['exhibitorFilterStatus', 'exhibitorFilterPayment'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', refreshExhibitorsDirectory);
});
document.getElementById('exhibitorSearchInput')?.addEventListener('input', refreshExhibitorsDirectory);
window.downloadExhibitorsListPdf = async () => {
  const rows = await jget(`${API}/stall-bookings`);
  downloadListReportPdf('Exhibitors Directory', 'All companies who have enquired for a stall', [
    { label: 'Company', width: 90, get: (r) => r.company_name },
    { label: 'Contact', width: 70, get: (r) => r.contact_person || '-' },
    { label: 'Phone', width: 60, get: (r) => r.phone || '-' },
    { label: 'Hall / Stall', width: 60, get: (r) => (r.stall_number ? `${r.hall_name} — ${r.stall_number}` : '-') },
    { label: 'Status', width: 50, get: (r) => STALL_STATUS_LABEL[r.status] || r.status },
    { label: 'Payment', width: 40, get: (r) => (r.payment_status === 'paid' ? 'Paid' : 'Pending') },
    { label: 'Amount (₹)', width: 50, get: (r) => Number(r.amount || 0).toLocaleString('en-IN') }
  ], rows, 'exhibitors-directory.pdf');
};

async function refreshStallBookings() {
  const rows = await jget(`${API}/stall-bookings`);
  document.getElementById('stallBookingTableBody').innerHTML = rows.map((b) => `
    <tr>
      <td><strong>${b.company_name}</strong>${b.gstin ? '<div class="hint">GSTIN: ' + b.gstin + '</div>' : ''}</td>
      <td>${b.contact_person || '-'}${b.phone ? '<div class="hint">' + b.phone + '</div>' : ''}</td>
      <td><span class="pill ${b.status}">${STALL_STATUS_LABEL[b.status] || b.status}</span></td>
      <td>${b.stall_number ? b.hall_name + ' — ' + b.stall_number : '-'}</td>
      <td>${Number(b.amount || 0).toLocaleString('en-IN')}</td>
      <td><span class="pill ${b.payment_status}">${b.payment_status === 'paid' ? 'Paid' : 'Pending'}</span></td>
      <td class="sticky-actions">
        <button class="btn small" onclick="editStallBooking(${b.id})">Update</button>
        <button class="btn small" onclick="downloadStallBookingReceiptPdf(${b.id})">Receipt</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteStallBooking(${b.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty">No enquiries yet</td></tr>';
}
window.deleteStallBooking = async (id) => {
  try { await jdel(`${API}/stall-bookings/${id}`); toast('Enquiry removed'); refreshStallBookings(); refreshStalls(); refreshExhibitorsDirectory(); }
  catch (err) { toast(err.message); }
};
const STALL_BOOKING_FORM_FIELDS = [
  'company_name', 'contact_person', 'phone', 'email', 'gstin', 'requirement_notes',
  'status', 'amount', 'payment_status', 'payment_mode', 'payment_date', 'notes'
];
window.editStallBooking = async (id) => {
  const rows = await jget(`${API}/stall-bookings`);
  const b = rows.find((r) => r.id === id);
  if (!b) return;
  const form = document.getElementById('stallBookingForm');
  STALL_BOOKING_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = b[f] !== null && b[f] !== undefined ? b[f] : ''; });
  await refreshStallBookingStallOptions(b.stall_id);
  form.dataset.editId = id;
  document.getElementById('stallBookingFormTitle').textContent = `Update enquiry — ${b.company_name}`;
  document.getElementById('stallBookingSubmitBtn').textContent = 'Update Enquiry';
  document.getElementById('stallBookingCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('stallBookingCancelEditBtn').addEventListener('click', () => {
  const form = document.getElementById('stallBookingForm');
  form.reset(); delete form.dataset.editId;
  refreshStallBookingStallOptions();
  document.getElementById('stallBookingFormTitle').textContent = 'New stall enquiry';
  document.getElementById('stallBookingSubmitBtn').textContent = 'Save Enquiry';
  document.getElementById('stallBookingCancelEditBtn').style.display = 'none';
});
document.getElementById('stallBookingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.editId) {
      await jput(`${API}/stall-bookings/${form.dataset.editId}`, body);
      delete form.dataset.editId;
      form.reset();
      refreshStallBookingStallOptions();
      document.getElementById('stallBookingFormTitle').textContent = 'New stall enquiry';
      document.getElementById('stallBookingSubmitBtn').textContent = 'Save Enquiry';
      document.getElementById('stallBookingCancelEditBtn').style.display = 'none';
      toast('Enquiry updated');
    } else {
      await jpost(`${API}/stall-bookings`, body);
      form.reset();
      toast('Enquiry saved');
    }
    refreshStallBookings();
    refreshStalls();
    refreshStallHalls();
    refreshExhibitorsDirectory();
  } catch (err) { toast(err.message); }
});

// --- Stalls PDFs: list reports + receipt ---
window.downloadStallsListPdf = async () => {
  try {
    const rows = await jget(`${API}/stalls`);
    await downloadListReportPdf('Stalls', `${rows.length} stall(s)`, [
      { label: 'Hall', width: 110, get: (r) => r.hall_name },
      { label: 'Stall #', width: 70, get: (r) => r.stall_number },
      { label: 'Size', width: 80, get: (r) => r.size },
      { label: 'Price (₹)', width: 75, get: (r) => Number(r.price || 0).toLocaleString('en-IN'), align: 'right' },
      { label: 'Status', width: 65, get: (r) => r.status },
      { label: 'Booked by', width: 115, get: (r) => r.booked_company_name },
    ], rows, 'stalls.pdf');
  } catch (err) { toast(err.message); }
};
window.downloadStallBookingsListPdf = async () => {
  try {
    const rows = await jget(`${API}/stall-bookings`);
    await downloadListReportPdf('Stall Enquiries & Bookings', `${rows.length} enquir${rows.length === 1 ? 'y' : 'ies'}`, [
      { label: 'Company', width: 130, get: (r) => r.company_name },
      { label: 'Contact', width: 90, get: (r) => r.contact_person },
      { label: 'Phone', width: 80, get: (r) => r.phone },
      { label: 'Status', width: 60, get: (r) => STALL_STATUS_LABEL[r.status] || r.status },
      { label: 'Stall', width: 80, get: (r) => r.stall_number ? `${r.hall_name} — ${r.stall_number}` : '-' },
      { label: 'Amount (₹)', width: 60, get: (r) => Number(r.amount || 0).toLocaleString('en-IN'), align: 'right' },
    ], rows, 'stall-bookings.pdf');
  } catch (err) { toast(err.message); }
};

// Receipt for a stall booking's payment — same letterhead/badge/watermark
// treatment as the delegate and host-member receipts. No natural receipt
// number exists for a booking the way registrations have reg_number, so one
// is synthesized as ST-<zero-padded id>, same convention as HC-<id> for host
// members.
function stallBookingReceiptNo(b) {
  return `ST-${String(b.id).padStart(6, '0')}`;
}
async function pdfAddStallBookingReceiptBody(doc, b, firstPage) {
  if (!firstPage) doc.addPage();
  const receiptNo = stallBookingReceiptNo(b);
  let y = await pdfLetterhead(doc, 'Stall Booking Receipt', `Receipt No. ${receiptNo}  ·  Issued ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`);

  if (b.payment_status === 'paid') {
    doc.setFont(undefined, 'bold'); doc.setFontSize(70);
    doc.setTextColor(236, 243, 233);
    doc.text('PAID', 300, 430, { align: 'center', angle: 30 });
    doc.setTextColor(0, 0, 0);
  }

  pdfBadge(doc, PDF_CONTENT_RIGHT - 110, y - 14, b.payment_status === 'paid' ? 'PAID' : 'PAYMENT PENDING', b.payment_status === 'paid' ? 'paid' : 'neutral');

  y = pdfSectionLabel(doc, y, 'Billed To');
  y = pdfKeyValues(doc, y, [
    ['Company', b.company_name || '-'],
    ['Contact Person', b.contact_person || '-'],
    ['Phone', b.phone || '-'],
    ['GSTIN', b.gstin || '-'],
  ]);

  y = pdfSectionLabel(doc, y, 'Stall Details');
  y = pdfKeyValues(doc, y, [
    ['Hall', b.hall_name || '-'],
    ['Stall Number', b.stall_number || '-'],
    ['Status', STALL_STATUS_LABEL[b.status] || b.status],
  ]);

  y = pdfSectionLabel(doc, y, 'Payment Details');
  y = pdfTable(doc, y, [
    { label: 'Description', width: 355 },
    { label: 'Amount (₹)', width: 160, align: 'right' },
  ], [[`Exhibition Stall Booking — ${receiptNo}`, Number(b.amount || 0).toLocaleString('en-IN')]]);

  y = pdfSectionLabel(doc, y + 8, 'Payment Information');
  y = pdfKeyValues(doc, y, [
    ['Status', b.payment_status === 'paid' ? 'PAID' : 'PAYMENT PENDING'],
    ['Payment Mode', b.payment_mode || '-'],
    ['Payment Date', b.payment_date ? new Date(b.payment_date).toLocaleDateString('en-IN') : '-'],
  ]);

  y = pdfMaybeNewPage(doc, y, 30);
  pdfSetColor(doc, 'setTextColor', PDF_BRAND.greyLight);
  doc.setFont(undefined, 'normal'); doc.setFontSize(8.5);
  doc.text('This receipt confirms the exhibition stall booking payment recorded in the SINC2026 system. For queries, contact the Stalls team.', PDF_MARGIN, y, { maxWidth: 515 });
  doc.setTextColor(0, 0, 0);
  return y;
}
window.downloadStallBookingReceiptPdf = async (id) => {
  try {
    const rows = await jget(`${API}/stall-bookings`);
    const b = rows.find((r) => r.id === id);
    if (!b) { toast('Booking not found'); return; }
    const doc = pdfDoc();
    await pdfAddStallBookingReceiptBody(doc, b, true);
    pdfFinalize(doc);
    doc.save(`receipt-${stallBookingReceiptNo(b)}.pdf`);
  } catch (err) { toast(err.message); }
};
window.downloadAllStallBookingReceiptsPdf = async () => {
  try {
    const rows = await jget(`${API}/stall-bookings`);
    if (!rows.length) { toast('No bookings to generate receipts for'); return; }
    const doc = pdfDoc();
    for (let i = 0; i < rows.length; i++) {
      await pdfAddStallBookingReceiptBody(doc, rows[i], i === 0);
    }
    pdfFinalize(doc);
    doc.save('all-stall-booking-receipts.pdf');
  } catch (err) { toast(err.message); }
};

function refreshStatsDependents() { if (dashboardStarted) refreshDashboardStats(); }

// --- Init ---
function loadAllData() {
  refreshDashboardStats();
  refreshClubs();
  refreshRegs();
  loadNextRegNumber();
  refreshPartPretourOptions();
  refreshParts();
  refreshMediaAdmin();
  refreshHappeningsAdmin();
  refreshItinerary();
  refreshHostMembers();
  refreshHostPayments();
  refreshCommittees();
  refreshVolunteers();
  refreshMessageHistory();
  refreshMsgIndividualDirectory();
  refreshEcHistory();
  refreshAssignmentDropdowns();
  refreshAssignments();
  refreshTasks();
  refreshChecklistTemplates();
  refreshBulkAssignRecipients();
  refreshDeliveryMonitor();
  refreshPartners();
  refreshDrivers();
  refreshVehicles();
  loadNextVehicleCode();
  refreshTransportPoints();
  wireLocationDropdowns();
  refreshTransportTrips();
  refreshTransportQueue();
  refreshPreTours();
  refreshHotels();
  refreshRooms();
  refreshVendors();
  refreshVendorProductPicker();
  refreshInventoryItems();
  refreshInventoryMonitor();
  refreshMerchandiseRequirement();
  refreshMerchSizeList();
  refreshRequirements();
  refreshSponsors();
  refreshSpeakers();
  refreshGuestVisitors();
  refreshStallHalls();
  refreshStalls();
  refreshStallBookings();
  refreshExhibitorsDirectory();
  refreshPerformerGroups();
  refreshFinanceSummary();
  refreshFinanceInward();
  refreshFinanceOutward();
  refreshFinancePurchases();
  if (CURRENT_USER && CURRENT_USER.role === 'super_admin') refreshUsersAdmin();
}

// ============================================================
// --- Finance module: inward/outward tracking + approvals ---
// ============================================================
// Outward payments/purchases carry an `approvals` array (from the server's
// JSON-aggregated subquery) — one entry per required role, each already
// including who's currently assigned to that role (or null if nobody is
// tagged with it yet, which would leave that slot stuck forever until an
// admin fixes the Host Members leadership_role tagging).
function financeApprovalChipsHtml(approvals) {
  return (approvals || []).map((a) => {
    if (a.status === 'approved') return `<span class="approval-chip approved">✓ ${a.required_role}${a.approved_by ? ' — ' + a.approved_by : ''}</span>`;
    if (a.status === 'rejected') return `<span class="approval-chip rejected">✗ ${a.required_role}${a.approved_by ? ' — ' + a.approved_by : ''}</span>`;
    if (!a.assigned_to) return `<span class="approval-chip unassigned">${a.required_role}: nobody assigned</span>`;
    return `<span class="approval-chip pending">${a.required_role}: pending (${a.assigned_to})</span>`;
  }).join(' ');
}
const FINANCE_STATUS_LABEL = {
  recorded: 'Recorded', pending_approval: 'Pending Approval', approved: 'Approved', rejected: 'Rejected', paid: 'Paid'
};

async function refreshFinanceSummary() {
  try {
    const s = await jget(`${API}/finance/summary`);
    document.getElementById('finTotalInward').textContent = '₹' + Number(s.total_inward).toLocaleString('en-IN');
    document.getElementById('finTotalOutwardPaid').textContent = '₹' + Number(s.total_outward_paid).toLocaleString('en-IN');
    document.getElementById('finNetBalance').textContent = '₹' + Number(s.net_balance).toLocaleString('en-IN');
    document.getElementById('finPendingApprovalCount').textContent = s.pending_approval_count;
    document.getElementById('finPendingApprovalAmount').textContent = '₹' + Number(s.pending_approval_amount).toLocaleString('en-IN');
    document.getElementById('finApprovedAwaitingCount').textContent = s.approved_awaiting_payment_count;
  } catch (err) { toast(err.message); }
}

// --- Inward ledger ---
const FINANCE_SOURCE_LABEL = {
  registration: 'Registration', host_member: 'Host Member', stall_booking: 'Stall Booking',
  pre_tour: 'Pre-Tour', sponsor: 'Sponsor', manual: 'Manual entry'
};
async function refreshFinanceInward() {
  try {
    const rows = await jget(`${API}/finance/inward`);
    document.getElementById('finInwardTableBody').innerHTML = rows.map((r) => `
      <tr>
        <td>${r.transaction_date ? new Date(r.transaction_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</td>
        <td>${FINANCE_SOURCE_LABEL[r.source] || r.source}</td>
        <td>${r.category || '-'}</td>
        <td>${r.reference || '-'}</td>
        <td>${Number(r.amount || 0).toLocaleString('en-IN')}</td>
        <td>${r.payment_mode || '-'}</td>
        <td class="sticky-actions">
          <button class="btn small" onclick="downloadInwardReceiptPdf('${r.source}', ${r.source_id})">Receipt</button>
          ${r.source === 'manual' ? `
            <button class="btn small" onclick="editFinanceInward(${r.source_id})">Update</button>
            ${canDelete() ? `<button class="btn danger small" onclick="deleteFinanceInward(${r.source_id})">Delete</button>` : ''}
          ` : ''}
        </td>
      </tr>
    `).join('') || '<tr><td colspan="7" class="empty">No inward transactions yet</td></tr>';
  } catch (err) { toast(err.message); }
}
window.deleteFinanceInward = async (id) => {
  try { await jdel(`${API}/finance/inward/${id}`); toast('Entry removed'); refreshFinanceInward(); refreshFinanceSummary(); }
  catch (err) { toast(err.message); }
};
const FINANCE_INWARD_FORM_FIELDS = ['category', 'payee_or_payer', 'amount', 'transaction_date', 'payment_mode', 'description', 'notes'];
window.editFinanceInward = async (id) => {
  const rows = await jget(`${API}/finance/inward`);
  const r = rows.find((x) => x.source === 'manual' && x.source_id === id);
  if (!r) return;
  const form = document.getElementById('finInwardForm');
  form.elements.category.value = r.category || '';
  form.elements.payee_or_payer.value = r.reference || '';
  form.elements.amount.value = r.amount || '';
  form.elements.transaction_date.value = r.transaction_date ? String(r.transaction_date).slice(0, 10) : '';
  form.elements.payment_mode.value = r.payment_mode || '';
  form.elements.notes.value = r.notes || '';
  form.dataset.editId = id;
  document.getElementById('finInwardFormTitle').textContent = 'Update manual inward entry';
  document.getElementById('finInwardSubmitBtn').textContent = 'Update Entry';
  document.getElementById('finInwardCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('finInwardCancelEditBtn').addEventListener('click', () => {
  const form = document.getElementById('finInwardForm');
  form.reset(); delete form.dataset.editId;
  document.getElementById('finInwardFormTitle').textContent = 'Add manual inward entry';
  document.getElementById('finInwardSubmitBtn').textContent = 'Save Entry';
  document.getElementById('finInwardCancelEditBtn').style.display = 'none';
});
document.getElementById('finInwardForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.editId) {
      await jput(`${API}/finance/inward/${form.dataset.editId}`, body);
      delete form.dataset.editId;
      form.reset();
      document.getElementById('finInwardFormTitle').textContent = 'Add manual inward entry';
      document.getElementById('finInwardSubmitBtn').textContent = 'Save Entry';
      document.getElementById('finInwardCancelEditBtn').style.display = 'none';
      toast('Entry updated');
    } else {
      await jpost(`${API}/finance/inward`, body);
      form.reset();
      toast('Entry saved');
    }
    refreshFinanceInward();
    refreshFinanceSummary();
  } catch (err) { toast(err.message); }
});
window.downloadFinanceInwardListPdf = async () => {
  try {
    const rows = await jget(`${API}/finance/inward`);
    await downloadListReportPdf('Inward Ledger', `${rows.length} transaction(s)`, [
      { label: 'Date', width: 65, get: (r) => r.transaction_date ? String(r.transaction_date).slice(0, 10) : '-' },
      { label: 'Source', width: 80, get: (r) => FINANCE_SOURCE_LABEL[r.source] || r.source },
      { label: 'Category', width: 90, get: (r) => r.category },
      { label: 'From', width: 130, get: (r) => r.reference },
      { label: 'Amount (₹)', width: 70, get: (r) => Number(r.amount || 0).toLocaleString('en-IN'), align: 'right' },
      { label: 'Mode', width: 70, get: (r) => r.payment_mode },
    ], rows, 'finance-inward.pdf');
  } catch (err) { toast(err.message); }
};

// Per-row Payment Receipt PDF for the Inward Ledger — works uniformly for
// every source (Registration, Host Member, Stall Booking, Pre-Tour,
// Sponsor, and Manual entries) since every ledger row already carries
// enough fields (category, reference, amount, payment mode, date, notes) to
// build a full receipt, without needing bespoke logic per source module.
// Same letterhead/badge/watermark treatment as the other receipts in this
// file, just labelled "RECEIVED" rather than "PAID" since every row here is,
// by definition, money that has already come in.
const INWARD_RECEIPT_PREFIX = {
  registration: 'REG', host_member: 'HC', stall_booking: 'SB', pre_tour: 'PT', sponsor: 'SP', manual: 'MAN'
};
function inwardReceiptNo(row) {
  return `IN-${INWARD_RECEIPT_PREFIX[row.source] || 'GEN'}-${String(row.source_id).padStart(6, '0')}`;
}
async function pdfAddInwardReceiptBody(doc, row, firstPage) {
  if (!firstPage) doc.addPage();
  const receiptNo = inwardReceiptNo(row);
  let y = await pdfLetterhead(doc, 'Payment Receipt', `Receipt No. ${receiptNo}  ·  Issued ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`);

  doc.setFont(undefined, 'bold'); doc.setFontSize(70);
  doc.setTextColor(236, 243, 233);
  doc.text('RECEIVED', 300, 430, { align: 'center', angle: 30 });
  doc.setTextColor(0, 0, 0);

  pdfBadge(doc, PDF_CONTENT_RIGHT - 110, y - 14, 'RECEIVED', 'paid');

  y = pdfSectionLabel(doc, y, 'Received From');
  y = pdfKeyValues(doc, y, [
    ['Name / Source', row.reference || '-'],
    ['Source Type', FINANCE_SOURCE_LABEL[row.source] || row.source],
  ]);

  y = pdfSectionLabel(doc, y, 'Payment Details');
  y = pdfTable(doc, y, [
    { label: 'Description', width: 355 },
    { label: 'Amount (₹)', width: 160, align: 'right' },
  ], [[`${row.category || FINANCE_SOURCE_LABEL[row.source] || row.source} — ${receiptNo}`, Number(row.amount || 0).toLocaleString('en-IN')]]);

  y = pdfSectionLabel(doc, y + 8, 'Payment Information');
  y = pdfKeyValues(doc, y, [
    ['Payment Mode', row.payment_mode || '-'],
    ['Date', row.transaction_date ? new Date(row.transaction_date).toLocaleDateString('en-IN') : '-'],
    ['Notes', row.notes || '-'],
  ]);

  y = pdfMaybeNewPage(doc, y, 30);
  pdfSetColor(doc, 'setTextColor', PDF_BRAND.greyLight);
  doc.setFont(undefined, 'normal'); doc.setFontSize(8.5);
  doc.text('This receipt confirms an inward payment recorded in the SINC2026 Finance ledger. For queries, contact the Finance team.', PDF_MARGIN, y, { maxWidth: 515 });
  doc.setTextColor(0, 0, 0);
  return y;
}
window.downloadInwardReceiptPdf = async (source, sourceId) => {
  try {
    const rows = await jget(`${API}/finance/inward`);
    const row = rows.find((r) => r.source === source && Number(r.source_id) === Number(sourceId));
    if (!row) { toast('Transaction not found'); return; }
    const doc = pdfDoc();
    await pdfAddInwardReceiptBody(doc, row, true);
    pdfFinalize(doc);
    doc.save(`receipt-${inwardReceiptNo(row)}.pdf`);
  } catch (err) { toast(err.message); }
};
window.downloadAllInwardReceiptsPdf = async () => {
  try {
    const rows = await jget(`${API}/finance/inward`);
    if (!rows.length) { toast('No inward transactions to generate receipts for'); return; }
    const doc = pdfDoc();
    for (let i = 0; i < rows.length; i++) {
      await pdfAddInwardReceiptBody(doc, rows[i], i === 0);
    }
    pdfFinalize(doc);
    doc.save('all-inward-receipts.pdf');
  } catch (err) { toast(err.message); }
};

// --- Outward: plain payments ---
async function refreshFinanceOutward() {
  try {
    const rows = await jget(`${API}/finance/outward?subtype=payment`);
    document.getElementById('finOutwardTableBody').innerHTML = rows.map((r) => `
      <tr>
        <td><strong>${r.payee_or_payer}</strong>${r.description ? '<div class="hint">' + r.description + '</div>' : ''}</td>
        <td>${r.category || '-'}</td>
        <td>${Number(r.amount || 0).toLocaleString('en-IN')}</td>
        <td><span class="pill ${r.status}">${FINANCE_STATUS_LABEL[r.status] || r.status}</span></td>
        <td>${financeApprovalChipsHtml(r.approvals)}</td>
        <td>${financeBillCell(r.id, r.bill_url)}</td>
        <td class="sticky-actions">
          ${r.status === 'pending_approval' ? `<button class="btn small" onclick="editFinanceOutward(${r.id})">Update</button>` : ''}
          ${r.status === 'approved' ? `<button class="btn small" onclick="markFinanceOutwardPaid(${r.id})">Mark Paid</button>` : ''}
          <button class="btn small" onclick="downloadFinanceOutwardVoucherPdf(${r.id})">Voucher</button>
          ${canDelete() ? `<button class="btn danger small" onclick="deleteFinanceOutward(${r.id}, '${r.status}')">Delete</button>` : ''}
        </td>
      </tr>
    `).join('') || '<tr><td colspan="7" class="empty">No payment requests yet</td></tr>';
  } catch (err) { toast(err.message); }
}
// Deleting a request that's already fully paid is a permanent removal from
// the financial record (super_admin only, per the global DELETE gate) — so
// it gets its own, much stronger confirmation before we ever send
// ?confirm=true to the backend. Non-paid requests keep the lighter prompt.
window.deleteFinanceOutward = async (id, status) => {
  const isPaid = status === 'paid';
  const warning = isPaid
    ? 'This request is already marked PAID and is part of your financial record.\n\nDeleting it is PERMANENT, cannot be undone, and will remove it from all totals/reports.\n\nType-check with yourself: are you sure you want to permanently delete this paid transaction?'
    : 'Delete this payment request?';
  if (!confirm(warning)) return;
  try {
    await jdel(`${API}/finance/outward/${id}${isPaid ? '?confirm=true' : ''}`);
    toast('Request removed');
    refreshFinanceOutward();
    refreshFinancePurchases();
    refreshFinanceSummary();
  } catch (err) { toast(err.message); }
};
window.markFinanceOutwardPaid = async (id) => {
  const payment_mode = prompt('Payment mode (UPI / Bank transfer / Cash / Others):', '');
  if (payment_mode === null) return;
  try {
    await jpost(`${API}/finance/outward/${id}/mark-paid`, { payment_mode });
    toast('Marked as paid');
    refreshFinanceOutward();
    refreshFinancePurchases();
    refreshFinanceSummary();
  } catch (err) { toast(err.message); }
};
const FINANCE_OUTWARD_FORM_FIELDS = ['category', 'payee_or_payer', 'amount', 'transaction_date', 'payment_mode', 'description', 'notes'];
window.editFinanceOutward = async (id) => {
  const rows = await jget(`${API}/finance/outward?subtype=payment`);
  const r = rows.find((x) => x.id === id);
  if (!r) return;
  const form = document.getElementById('finOutwardForm');
  FINANCE_OUTWARD_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = r[f] !== null && r[f] !== undefined ? String(r[f]).slice(0, f === 'transaction_date' ? 10 : undefined) : ''; });
  form.dataset.editId = id;
  document.getElementById('finOutwardFormTitle').textContent = `Update payment request — ${r.payee_or_payer}`;
  document.getElementById('finOutwardSubmitBtn').textContent = 'Update Request';
  document.getElementById('finOutwardCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('finOutwardCancelEditBtn').addEventListener('click', () => {
  const form = document.getElementById('finOutwardForm');
  form.reset(); delete form.dataset.editId;
  document.getElementById('finOutwardFormTitle').textContent = 'New payment request';
  document.getElementById('finOutwardSubmitBtn').textContent = 'Save Payment Request';
  document.getElementById('finOutwardCancelEditBtn').style.display = 'none';
});
document.getElementById('finOutwardForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.editId) {
      await jput(`${API}/finance/outward/${form.dataset.editId}`, body);
      delete form.dataset.editId;
      form.reset();
      document.getElementById('finOutwardFormTitle').textContent = 'New payment request';
      document.getElementById('finOutwardSubmitBtn').textContent = 'Save Payment Request';
      document.getElementById('finOutwardCancelEditBtn').style.display = 'none';
      toast('Request updated');
    } else {
      await jpost(`${API}/finance/outward`, body);
      form.reset();
      toast('Payment request submitted for approval');
    }
    refreshFinanceOutward();
    refreshFinanceSummary();
  } catch (err) { toast(err.message); }
});
window.downloadFinanceOutwardListPdf = async () => {
  try {
    const rows = await jget(`${API}/finance/outward?subtype=payment`);
    await downloadListReportPdf('Outward Payments', `${rows.length} request(s)`, [
      { label: 'Payee', width: 120, get: (r) => r.payee_or_payer },
      { label: 'Category', width: 90, get: (r) => r.category },
      { label: 'Amount (₹)', width: 70, get: (r) => Number(r.amount || 0).toLocaleString('en-IN'), align: 'right' },
      { label: 'Status', width: 90, get: (r) => FINANCE_STATUS_LABEL[r.status] || r.status },
      { label: 'Date', width: 65, get: (r) => r.transaction_date ? String(r.transaction_date).slice(0, 10) : '-' },
    ], rows, 'finance-outward-payments.pdf');
  } catch (err) { toast(err.message); }
};
window.downloadFinanceOutwardVoucherPdf = async (id) => {
  try {
    const r = await jget(`${API}/finance/outward/${id}`);
    const receiptNo = `PV-${String(r.id).padStart(6, '0')}`;
    await downloadDetailPdf(
      r.subtype === 'purchase' ? 'Purchase Voucher' : 'Payment Voucher',
      `Voucher No. ${receiptNo}  ·  Issued ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
      [
        {
          label: 'Details', pairs: r.subtype === 'purchase' ? [
            ['Item', r.purchase_item_name], ['Category', r.purchase_category],
            ['Quantity', `${r.purchase_quantity} ${r.purchase_unit || ''}`],
            ['Unit Cost (₹)', Number(r.purchase_unit_cost || 0).toLocaleString('en-IN')],
            ['Vendor', r.payee_or_payer], ['Amount (₹)', Number(r.amount || 0).toLocaleString('en-IN')],
            ['Status', FINANCE_STATUS_LABEL[r.status] || r.status],
            ['Date', r.transaction_date ? String(r.transaction_date).slice(0, 10) : '-']
          ] : [
            ['Payee', r.payee_or_payer], ['Category', r.category],
            ['Amount (₹)', Number(r.amount || 0).toLocaleString('en-IN')],
            ['Status', FINANCE_STATUS_LABEL[r.status] || r.status],
            ['Payment Mode', r.payment_mode], ['Date', r.transaction_date ? String(r.transaction_date).slice(0, 10) : '-'],
            ['Description', r.description]
          ]
        },
        { label: 'Approvals', table: { columns: [
          { label: 'Role', width: 150 }, { label: 'Status', width: 90 }, { label: 'By', width: 130 }, { label: 'Remarks', width: 130 }
        ], rows: (r.approvals || []).map((a) => [a.required_role, a.status, a.approved_by || '-', a.remarks || '-']) } }
      ],
      `${r.subtype || 'payment'}-${receiptNo}.pdf`
    );
  } catch (err) { toast(err.message); }
};

// --- Outward: purchase requests (goodies/inventory procurement) ---
async function refreshFinancePurchases() {
  try {
    const rows = await jget(`${API}/finance/outward?subtype=purchase`);
    document.getElementById('finPurchaseTableBody').innerHTML = rows.map((r) => `
      <tr>
        <td><strong>${r.purchase_item_name}</strong>${r.purchase_category ? '<div class="hint">' + r.purchase_category + '</div>' : ''}${r.payee_or_payer ? `<div class="hint">Vendor: ${r.payee_or_payer}</div>` : ''}</td>
        <td>${r.purchase_quantity} ${r.purchase_unit || ''} × ₹${Number(r.purchase_unit_cost || 0).toLocaleString('en-IN')}</td>
        <td>${Number(r.amount || 0).toLocaleString('en-IN')}</td>
        <td><span class="pill ${r.status}">${FINANCE_STATUS_LABEL[r.status] || r.status}</span></td>
        <td>${financeApprovalChipsHtml(r.approvals)}</td>
        <td>
          <select onchange="updateFinancePurchaseDelivery(${r.id}, this.value)">
            ${['ordered', 'in_transit', 'delivered', 'delayed', 'cancelled'].map((s) => `<option value="${s}" ${r.delivery_status === s ? 'selected' : ''}>${s.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())}</option>`).join('')}
          </select>
          ${r.expected_delivery_date ? `<div class="hint">Exp: ${new Date(r.expected_delivery_date).toLocaleDateString()}</div>` : ''}
          ${r.actual_delivery_date ? `<div class="hint">Actual: ${new Date(r.actual_delivery_date).toLocaleDateString()}</div>` : ''}
        </td>
        <td>${r.inventory_item_id ? `Linked (item #${r.inventory_item_id})` : '-'}</td>
        <td>${financeBillCell(r.id, r.bill_url)}</td>
        <td class="sticky-actions">
          ${r.status === 'pending_approval' ? `<button class="btn small" onclick="editFinancePurchase(${r.id})">Update</button>` : ''}
          ${r.status === 'approved' ? `<button class="btn small" onclick="markFinanceOutwardPaid(${r.id})">Mark Paid</button>` : ''}
          <button class="btn small" onclick="downloadFinanceOutwardVoucherPdf(${r.id})">Voucher</button>
          ${canDelete() ? `<button class="btn danger small" onclick="deleteFinanceOutward(${r.id}, '${r.status}')">Delete</button>` : ''}
        </td>
      </tr>
    `).join('') || '<tr><td colspan="9" class="empty">No purchase requests yet</td></tr>';
  } catch (err) { toast(err.message); }
}
window.updateFinancePurchaseDelivery = async (id, delivery_status) => {
  try { await jput(`${API}/finance/outward/${id}/delivery`, { delivery_status }); toast('Delivery status updated'); refreshFinancePurchases(); }
  catch (err) { toast(err.message); }
};
// Purchase Request "quick pick from vendor catalogs" — lets the item field
// be filled from any vendor's product catalog instead of typed fresh every
// time, and auto-populates which vendor supplies it. "+ Add new item" either
// saves the item to whichever vendor is currently selected below (so it's
// pickable next time too) or, if no vendor is selected, just fills the name
// in as a one-off — matching how the form already supports vendor-less
// one-off purchases via the "Vendor (one-off name)" field.
let ALL_VENDOR_PRODUCTS = [];
async function refreshVendorProductPicker() {
  const sel = document.getElementById('finPurchaseItemPicker');
  if (!sel) return;
  try {
    ALL_VENDOR_PRODUCTS = await jget(`${API}/vendors/products/all`);
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- Select an item from a vendor\'s catalog --</option>'
      + '<option value="__new__">+ Add new item…</option>'
      + ALL_VENDOR_PRODUCTS.map((p) => `<option value="${p.id}">${p.name} — ${p.vendor_name}${p.processing_time_days ? ` (${p.processing_time_days}d)` : ''}</option>`).join('');
    if (cur && sel.querySelector(`option[value="${cur}"]`)) sel.value = cur;
  } catch (err) { /* quiet — this is a convenience picker, not core data */ }
}
window.onFinPurchaseItemPickerChange = () => {
  const sel = document.getElementById('finPurchaseItemPicker');
  const wrap = document.getElementById('finPurchaseNewItemWrap');
  if (!sel) return;
  if (sel.value === '__new__') {
    if (wrap) wrap.style.display = 'flex';
    const input = document.getElementById('finPurchaseNewItemName');
    if (input) { input.value = ''; input.focus(); }
    return;
  }
  if (wrap) wrap.style.display = 'none';
  if (!sel.value) return;
  const product = ALL_VENDOR_PRODUCTS.find((p) => String(p.id) === sel.value);
  if (!product) return;
  const form = document.getElementById('finPurchaseForm');
  if (form.elements['purchase_item_name']) form.elements['purchase_item_name'].value = product.name;
  if (form.elements['purchase_category']) form.elements['purchase_category'].value = product.category || '';
  if (form.elements['purchase_unit']) form.elements['purchase_unit'].value = product.unit || 'pcs';
  // Always set unit cost (blank it out if this item has no catalog price) so
  // switching between items never leaves a stale price from a previous pick.
  if (form.elements['purchase_unit_cost']) form.elements['purchase_unit_cost'].value = product.unit_price || '';
  // Description is left alone if the admin has already typed one — only
  // filled in from the catalog when the field is still empty.
  if (form.elements['description'] && product.description && !form.elements['description'].value) {
    form.elements['description'].value = product.description;
  }
  const vendorSelect = document.getElementById('finPurchaseVendorSelect');
  if (vendorSelect) vendorSelect.value = product.vendor_id;
  // If this vendor has told us their processing time for this item, use it to
  // suggest an expected delivery date (today + processing days) — only when
  // the field is still empty, so it never overwrites a date already chosen.
  if (product.processing_time_days && form.elements['expected_delivery_date'] && !form.elements['expected_delivery_date'].value) {
    const d = new Date();
    d.setDate(d.getDate() + Number(product.processing_time_days));
    form.elements['expected_delivery_date'].value = d.toISOString().slice(0, 10);
  }
};
window.cancelFinPurchaseNewItem = () => {
  const sel = document.getElementById('finPurchaseItemPicker');
  const wrap = document.getElementById('finPurchaseNewItemWrap');
  if (wrap) wrap.style.display = 'none';
  if (sel) sel.value = '';
};
window.submitFinPurchaseNewItem = async () => {
  const input = document.getElementById('finPurchaseNewItemName');
  const name = ((input && input.value) || '').trim();
  if (!name) { toast('Enter an item name'); return; }
  const form = document.getElementById('finPurchaseForm');
  const vendorSelect = document.getElementById('finPurchaseVendorSelect');
  const vendorId = vendorSelect ? vendorSelect.value : '';
  if (vendorId) {
    try {
      await jpost(`${API}/vendors/${vendorId}/products`, { name });
      toast('Item added to vendor catalog');
      await refreshVendorProductPicker();
    } catch (err) { toast(err.message); return; }
  } else {
    toast('Item name filled in — pick a vendor above first if this item should be saved to their catalog');
  }
  if (form.elements['purchase_item_name']) form.elements['purchase_item_name'].value = name;
  window.cancelFinPurchaseNewItem();
};

const FINANCE_PURCHASE_FORM_FIELDS = ['purchase_item_name', 'purchase_category', 'purchase_unit', 'purchase_quantity', 'purchase_unit_cost', 'vendor_id', 'payee_or_payer', 'transaction_date', 'expected_delivery_date', 'description', 'notes'];
window.editFinancePurchase = async (id) => {
  const rows = await jget(`${API}/finance/outward?subtype=purchase`);
  const r = rows.find((x) => x.id === id);
  if (!r) return;
  const form = document.getElementById('finPurchaseForm');
  FINANCE_PURCHASE_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = r[f] !== null && r[f] !== undefined ? String(r[f]).slice(0, f === 'transaction_date' ? 10 : undefined) : ''; });
  form.dataset.editId = id;
  document.getElementById('finPurchaseFormTitle').textContent = `Update purchase request — ${r.purchase_item_name}`;
  document.getElementById('finPurchaseSubmitBtn').textContent = 'Update Request';
  document.getElementById('finPurchaseCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('finPurchaseCancelEditBtn').addEventListener('click', () => {
  const form = document.getElementById('finPurchaseForm');
  form.reset(); delete form.dataset.editId;
  document.getElementById('finPurchaseFormTitle').textContent = 'New purchase request';
  document.getElementById('finPurchaseSubmitBtn').textContent = 'Save Purchase Request';
  document.getElementById('finPurchaseCancelEditBtn').style.display = 'none';
});
document.getElementById('finPurchaseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.editId) {
      await jput(`${API}/finance/outward/${form.dataset.editId}`, body);
      delete form.dataset.editId;
      form.reset();
      document.getElementById('finPurchaseFormTitle').textContent = 'New purchase request';
      document.getElementById('finPurchaseSubmitBtn').textContent = 'Save Purchase Request';
      document.getElementById('finPurchaseCancelEditBtn').style.display = 'none';
      toast('Request updated');
    } else {
      await jpost(`${API}/finance/purchases`, body);
      form.reset();
      toast('Purchase request submitted for approval');
    }
    refreshFinancePurchases();
    refreshFinanceSummary();
  } catch (err) { toast(err.message); }
});
window.downloadFinancePurchasesListPdf = async () => {
  try {
    const rows = await jget(`${API}/finance/outward?subtype=purchase`);
    await downloadListReportPdf('Purchase Requests', `${rows.length} request(s)`, [
      { label: 'Item', width: 120, get: (r) => r.purchase_item_name },
      { label: 'Category', width: 80, get: (r) => r.purchase_category },
      { label: 'Qty', width: 40, get: (r) => r.purchase_quantity, align: 'right' },
      { label: 'Amount (₹)', width: 70, get: (r) => Number(r.amount || 0).toLocaleString('en-IN'), align: 'right' },
      { label: 'Status', width: 90, get: (r) => FINANCE_STATUS_LABEL[r.status] || r.status },
    ], rows, 'finance-purchase-requests.pdf');
  } catch (err) { toast(err.message); }
};

// --- Vendor Management: the master list of outside suppliers, connected to
// Purchase Requests (Finance) and Inventory Items (Goodies & Inventory).
// A vendor with their own login sees this exact same catalog + order list —
// scoped to themselves — inside their own portal (vendorPortal.js).
async function refreshVendors() {
  const rows = await jget(`${API}/vendors`);
  document.getElementById('vendorTableBody').innerHTML = rows.map((v) => `
    <tr>
      <td><strong>${v.name}</strong>${v.contact_person ? `<div class="hint">${v.contact_person}</div>` : ''}</td>
      <td>${v.category || '-'}</td>
      <td>${v.phone || v.email || '-'}</td>
      <td>${v.product_count}</td>
      <td>${v.purchase_count}</td>
      <td>${v.inventory_item_count}</td>
      <td>${v.user_id ? '<span class="pill paid">Has login</span>' : '<span class="hint">None yet</span>'}</td>
      <td><span class="pill ${v.status === 'active' ? 'paid' : 'pending'}">${v.status}</span></td>
      <td class="sticky-actions">
        <button class="btn small" onclick="openVendorModal(${v.id})">Details</button>
        <button class="btn small" onclick="editVendor(${v.id})">Edit</button>
        ${canDelete() ? `<button class="btn danger small" onclick="deleteVendor(${v.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="9" class="empty">No vendors yet — add one above.</td></tr>';

  const opts = rows.map((v) => `<option value="${v.id}">${v.name}${v.category ? ' (' + v.category + ')' : ''}</option>`).join('');
  ['finPurchaseVendorSelect', 'inventoryVendorSelect'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) { const cur = el.value; el.innerHTML = '<option value="">-- none / one-off --</option>' + opts; if (cur) el.value = cur; }
  });
  const createUserVendorSelect = document.getElementById('createUserVendorSelect');
  if (createUserVendorSelect) createUserVendorSelect.innerHTML = '<option value="">-- select --</option>' + rows.filter((v) => !v.user_id).map((v) => `<option value="${v.id}">${v.name}</option>`).join('');
}

const VENDOR_FORM_FIELDS = ['name', 'category', 'status', 'contact_person', 'phone', 'email', 'address', 'gst_number', 'notes'];
window.editVendor = async (id) => {
  const rows = await jget(`${API}/vendors`);
  const v = rows.find((r) => r.id === id);
  if (!v) return;
  const form = document.getElementById('vendorForm');
  VENDOR_FORM_FIELDS.forEach((f) => { if (form.elements[f]) form.elements[f].value = v[f] !== null && v[f] !== undefined ? v[f] : ''; });
  form.dataset.editId = id;
  document.getElementById('vendorFormTitle').textContent = `Edit vendor — ${v.name}`;
  document.getElementById('vendorSubmitBtn').textContent = 'Update vendor';
  document.getElementById('vendorCancelEditBtn').style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('vendorCancelEditBtn').addEventListener('click', () => {
  const form = document.getElementById('vendorForm');
  form.reset(); delete form.dataset.editId;
  document.getElementById('vendorFormTitle').textContent = 'Add vendor';
  document.getElementById('vendorSubmitBtn').textContent = 'Save vendor';
  document.getElementById('vendorCancelEditBtn').style.display = 'none';
});
document.getElementById('vendorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.editId) {
      await jput(`${API}/vendors/${form.dataset.editId}`, body);
      toast('Vendor updated');
    } else {
      await jpost(`${API}/vendors`, body);
      toast('Vendor saved');
    }
    delete form.dataset.editId;
    form.reset();
    document.getElementById('vendorFormTitle').textContent = 'Add vendor';
    document.getElementById('vendorSubmitBtn').textContent = 'Save vendor';
    document.getElementById('vendorCancelEditBtn').style.display = 'none';
    refreshVendors();
  } catch (err) { toast(err.message); }
});
window.deleteVendor = async (id) => {
  try { await jdel(`${API}/vendors/${id}`); toast('Vendor removed'); refreshVendors(); refreshFinancePurchases(); refreshInventoryItems(); }
  catch (err) { toast(err.message); }
};

// Vendor detail modal — product catalog (with photos, add/edit/delete) plus
// everything ordered from this vendor across Purchase Requests and Inventory
// Items, each with the same inline delivery-status control used in the
// main tables. This is the "what is this vendor supplying, and what's the
// order/delivery status of each" view the module exists to answer.
let vendorModalCtx = { vendorId: null };
const VENDOR_DELIVERY_OPTS_PURCHASE = ['ordered', 'in_transit', 'delivered', 'delayed', 'cancelled'];
const VENDOR_DELIVERY_OPTS_INVENTORY = ['planned', 'ordered', 'received', 'distributing', 'completed', 'delayed'];
function capitalizeWords(s) { return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

window.openVendorModal = async (vendorId) => {
  vendorModalCtx = { vendorId };
  document.getElementById('vendorModal').style.display = '';
  await renderVendorModalBody();
};
window.closeVendorModal = () => {
  document.getElementById('vendorModal').style.display = 'none';
  vendorModalCtx = { vendorId: null };
};

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

async function renderVendorModalBody() {
  const { vendorId } = vendorModalCtx;
  if (!vendorId) return;
  const data = await jget(`${API}/vendors/${vendorId}`);
  const { vendor, products, purchases, inventoryItems, loginUser } = data;
  document.getElementById('vendorModalTitle').textContent = vendor.name;

  const productsHtml = products.map((p) => `
    <div class="checklist-row">
      <span class="checklist-label" style="display:flex;align-items:center;gap:8px;">
        ${p.photo_url
          ? `<img src="${mediaUrl(p.photo_url)}" alt="${p.name}" style="width:36px;height:36px;object-fit:cover;border-radius:6px;border:1px solid var(--border,#ddd);cursor:zoom-in;" onclick="openImageLightbox(this.src)" />`
          : `<div style="width:36px;height:36px;border-radius:6px;background:var(--bg2,#f2f2f2);"></div>`}
        <span>
          <strong>${p.name}</strong>${p.category ? ` <span class="hint">(${p.category})</span>` : ''}
          ${p.unit_price ? `<br><span class="hint">₹${Number(p.unit_price).toLocaleString('en-IN')} / ${p.unit}</span>` : ''}
          ${p.processing_time_days ? `<br><span class="hint">Processing time: ${p.processing_time_days} day${Number(p.processing_time_days) === 1 ? '' : 's'}</span>` : ''}
        </span>
      </span>
      <button type="button" class="btn small" onclick="triggerVendorProductPhotoUpload(${p.id})">${p.photo_url ? 'Replace photo' : 'Upload photo'}</button>
      <button type="button" class="btn small" onclick="editVendorProduct(${p.id}, ${vendorId})">Edit</button>
      ${canDelete() ? `<button type="button" class="btn danger small" onclick="deleteVendorProduct(${p.id})">Delete</button>` : ''}
    </div>
  `).join('') || '<p class="empty">No products in this vendor\'s catalog yet.</p>';

  const purchasesHtml = purchases.map((r) => `
    <div class="checklist-row">
      <span class="checklist-label">
        <strong>${r.purchase_item_name}</strong> — ${r.purchase_quantity} ${r.purchase_unit || ''} × ₹${Number(r.purchase_unit_cost || 0).toLocaleString('en-IN')}
        <br><span class="hint">Payment: ${FINANCE_STATUS_LABEL[r.approval_status] || r.approval_status}${r.expected_delivery_date ? ` · Exp: ${new Date(r.expected_delivery_date).toLocaleDateString()}` : ''}</span>
      </span>
      <select onchange="updateFinancePurchaseDelivery(${r.id}, this.value); setTimeout(renderVendorModalBody, 300)">
        ${VENDOR_DELIVERY_OPTS_PURCHASE.map((s) => `<option value="${s}" ${r.delivery_status === s ? 'selected' : ''}>${capitalizeWords(s)}</option>`).join('')}
      </select>
    </div>
  `).join('') || '<p class="empty">No purchase requests linked to this vendor yet.</p>';

  const inventoryHtml = inventoryItems.map((i) => `
    <div class="checklist-row">
      <span class="checklist-label">
        <strong>${i.name}</strong> — ${i.quantity_procured} ${i.unit}
        <br><span class="hint">${i.expected_delivery_date ? `Exp: ${new Date(i.expected_delivery_date).toLocaleDateString()}` : ''}</span>
      </span>
      <select onchange="updateInventoryDelivery(${i.id}, 'procurement_status', this.value); setTimeout(renderVendorModalBody, 300)">
        ${VENDOR_DELIVERY_OPTS_INVENTORY.map((s) => `<option value="${s}" ${i.procurement_status === s ? 'selected' : ''}>${capitalizeWords(s)}</option>`).join('')}
      </select>
    </div>
  `).join('') || '<p class="empty">No inventory items linked to this vendor yet.</p>';

  document.getElementById('vendorModalBody').innerHTML = `
    <div class="hint" style="margin-bottom:10px;">
      ${vendor.category ? vendor.category + ' · ' : ''}${vendor.contact_person || ''} ${vendor.phone ? '· ' + vendor.phone : ''} ${vendor.email ? '· ' + vendor.email : ''}
      <br>Login: ${loginUser ? `${loginUser.username} (${loginUser.status})` : 'No login created yet — use Settings → Create Login → role Vendor.'}
    </div>
    <div class="section-title" style="margin-top:0;">Product catalog</div>
    ${productsHtml}
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line);">
      <label class="hint" style="display:block;margin-bottom:6px;">Products this vendor is responsible for</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <select id="vendorProductQuickSelect" onchange="onVendorProductQuickSelectChange(${vendorId})" style="min-width:200px;">
          <option value="">${products.length ? "-- This vendor's products --" : 'No products yet'}</option>
          ${products.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}
          <option value="__new__">+ Add new product…</option>
        </select>
        <span id="vendorProductNewWrap" style="display:none;gap:8px;flex-wrap:wrap;">
          <input type="text" id="vendorProductNewName" placeholder="New product name" style="min-width:160px;" onkeydown="if(event.key==='Enter'){event.preventDefault();submitVendorQuickAddProduct(${vendorId});}" />
          <input type="text" id="vendorProductNewCategory" placeholder="Category (optional)" style="min-width:140px;" onkeydown="if(event.key==='Enter'){event.preventDefault();submitVendorQuickAddProduct(${vendorId});}" />
          <button type="button" class="btn gold small" onclick="submitVendorQuickAddProduct(${vendorId})">Add</button>
          <button type="button" class="btn small" onclick="cancelVendorProductQuickAdd()">Cancel</button>
        </span>
      </div>
    </div>

    <div class="section-title">Purchase requests from this vendor</div>
    ${purchasesHtml}

    <div class="section-title">Inventory items from this vendor</div>
    ${inventoryHtml}
  `;
}

// Dropdown-based "add product" control on the vendor Details modal: the
// dropdown lists this vendor's own already-added products (for reference),
// plus a "+ Add new product…" option that reveals a one-field input so new
// products can be added one at a time without a big form each time.
window.onVendorProductQuickSelectChange = (vendorId) => {
  const sel = document.getElementById('vendorProductQuickSelect');
  const wrap = document.getElementById('vendorProductNewWrap');
  if (!sel || !wrap) return;
  if (sel.value === '__new__') {
    wrap.style.display = 'flex';
    const input = document.getElementById('vendorProductNewName');
    if (input) { input.value = ''; input.focus(); }
  } else {
    wrap.style.display = 'none';
  }
};
window.cancelVendorProductQuickAdd = () => {
  const sel = document.getElementById('vendorProductQuickSelect');
  const wrap = document.getElementById('vendorProductNewWrap');
  const categoryInput = document.getElementById('vendorProductNewCategory');
  if (wrap) wrap.style.display = 'none';
  if (sel) sel.value = '';
  if (categoryInput) categoryInput.value = '';
};
window.submitVendorQuickAddProduct = async (vendorId) => {
  const input = document.getElementById('vendorProductNewName');
  const categoryInput = document.getElementById('vendorProductNewCategory');
  const name = ((input && input.value) || '').trim();
  const category = ((categoryInput && categoryInput.value) || '').trim();
  if (!name) { toast('Enter a product name'); return; }
  try {
    await jpost(`${API}/vendors/${vendorId}/products`, { name, category });
    toast('Product added');
    await renderVendorModalBody();
    // Keep the "add new" input open right after re-render so the next
    // product can be added immediately — one by one, no re-clicking needed.
    const sel = document.getElementById('vendorProductQuickSelect');
    const wrap = document.getElementById('vendorProductNewWrap');
    if (sel) sel.value = '__new__';
    if (wrap) wrap.style.display = 'flex';
    const freshInput = document.getElementById('vendorProductNewName');
    if (freshInput) freshInput.focus();
  } catch (err) { toast(err.message); }
};
window.editVendorProduct = async (productId, vendorId) => {
  const data = await jget(`${API}/vendors/${vendorId}`);
  const p = data.products.find((x) => x.id === productId);
  if (!p) return;
  const name = prompt('Product name:', p.name);
  if (name === null) return;
  const category = prompt('Category (blank for none):', p.category || '');
  if (category === null) return;
  const unit_price = prompt('Unit price (₹, blank for none):', p.unit_price || '');
  if (unit_price === null) return;
  const processing_time_days = prompt('Processing time (days, blank for none):', p.processing_time_days || '');
  if (processing_time_days === null) return;
  try {
    await jput(`${API}/vendors/products/${productId}`, { name, category, unit_price, processing_time_days });
    await renderVendorModalBody();
  } catch (err) { toast(err.message); }
};
window.deleteVendorProduct = async (productId) => {
  try { await jdel(`${API}/vendors/products/${productId}`); toast('Product removed'); await renderVendorModalBody(); }
  catch (err) { toast(err.message); }
};

tryResumeSession();