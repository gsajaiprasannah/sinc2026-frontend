// Public, no-login "update my own details" page. Hits /api/public-profile
// (server/routes/publicProfile.js) — no auth token involved anywhere on
// this page. Every request that changes data carries the same name+phone
// the person typed in, which the backend re-verifies against the row before
// writing anything (see that file's header comment).
const API = ((window.SINC_CONFIG && window.SINC_CONFIG.API_BASE_URL) || '/api').replace(/\/$/, '');
const MEDIA_ORIGIN = API.replace(/\/api\/?$/, '');

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
  toastTimer = setTimeout(() => t.classList.remove('show'), durationMs || 2500);
}

// The record currently being edited: { type, id, name, phone }. `name`/
// `phone` are kept exactly as typed so every follow-up call can re-send them
// for server-side re-verification.
let current = null;

function showLookup() {
  current = null;
  document.getElementById('lookupCard').style.display = '';
  document.getElementById('pickCard').style.display = 'none';
  document.getElementById('editCard').style.display = 'none';
  document.getElementById('lookupError').style.display = 'none';
}

function showPicker(matches, phone) {
  document.getElementById('lookupCard').style.display = 'none';
  document.getElementById('pickCard').style.display = '';
  document.getElementById('editCard').style.display = 'none';
  const list = document.getElementById('pickList');
  list.innerHTML = matches.map((m, i) => `
    <button type="button" class="btn" style="display:block;width:100%;text-align:left;margin-bottom:8px;" data-idx="${i}">
      ${m.name} — <span class="hint">${m.label}</span>
    </button>
  `).join('');
  Array.from(list.querySelectorAll('button')).forEach((btn, i) => {
    btn.addEventListener('click', () => openRecord({ ...matches[i], phone }));
  });
}

function openRecord(match) {
  current = { type: match.type, id: match.id, name: match.name, phone: match.phone };
  document.getElementById('lookupCard').style.display = 'none';
  document.getElementById('pickCard').style.display = 'none';
  document.getElementById('editCard').style.display = '';
  document.getElementById('editTitle').textContent = `Update your details — ${match.name} (${match.label})`;
  const form = document.getElementById('editForm');
  form.elements.shirt_size.value = match.shirt_size || '';
  form.elements.tshirt_size.value = match.tshirt_size || '';
  renderPreview('photoPreviewWrap', match.photo_url, 'photo');
  renderPreview('cardPreviewWrap', match.business_card_url, 'business card');
}

function renderPreview(wrapId, url, label) {
  const wrap = document.getElementById(wrapId);
  wrap.innerHTML = url
    ? `<img src="${mediaUrl(url)}" alt="Your ${label}" style="max-width:100%;max-height:220px;border-radius:8px;border:1px solid var(--border,#ddd);display:block;" />`
    : `<p class="hint" style="margin:0;">No ${label} on file yet.</p>`;
}

document.getElementById('lookupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  const errEl = document.getElementById('lookupError');
  errEl.style.display = 'none';
  try {
    const r = await fetch(`${API}/public-profile/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Lookup failed');
    if (data.matches.length === 1) {
      openRecord({ ...data.matches[0], phone: body.phone });
    } else {
      showPicker(data.matches, body.phone);
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = '';
  }
});

document.getElementById('editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!current) return;
  const body = Object.fromEntries(new FormData(e.target).entries());
  body.name = current.name;
  body.phone = current.phone;
  try {
    const r = await fetch(`${API}/public-profile/${current.type}/${current.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Save failed');
    toast('Saved — thank you!');
  } catch (err) {
    toast(err.message);
  }
});

async function uploadImage(field, file) {
  if (!current) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('name', current.name);
  fd.append('phone', current.phone);
  const r = await fetch(`${API}/public-profile/${current.type}/${current.id}/${field}`, { method: 'POST', body: fd });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

document.getElementById('photoUploadBtn').addEventListener('click', () => document.getElementById('photoInput').click());
document.getElementById('photoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = await uploadImage('photo', file);
    toast('Photo uploaded');
    renderPreview('photoPreviewWrap', data.photo_url, 'photo');
  } catch (err) { toast(err.message); }
});

document.getElementById('cardUploadBtn').addEventListener('click', () => document.getElementById('cardInput').click());
document.getElementById('cardInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = await uploadImage('business-card', file);
    toast('Business card uploaded');
    renderPreview('cardPreviewWrap', data.business_card_url, 'business card');
  } catch (err) { toast(err.message); }
});

document.getElementById('startOverBtn').addEventListener('click', showLookup);
