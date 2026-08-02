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

// Photo/business-card files the person has picked but not yet saved — chosen
// via the file inputs, held here, and only actually uploaded when "Save
// changes" is clicked. This (plus the sizes) is what makes "Save changes" a
// single, unambiguous action instead of some fields auto-saving on selection
// and others needing a separate click.
let pendingPhoto = null;
let pendingCard = null;
let pendingLogo = null;

// Tracks whether a photo/card/logo exists (already-saved or freshly picked),
// since those live outside the form's own inputs and need to feed the
// completion bar too. Reset per-record in openRecord(), flipped true the
// moment a file is picked or an existing upload is confirmed.
let fileState = { photo: false, card: false, logo: false };

function showLookup() {
  current = null;
  pendingPhoto = null;
  pendingCard = null;
  pendingLogo = null;
  document.getElementById('lookupCard').style.display = '';
  document.getElementById('pickCard').style.display = 'none';
  document.getElementById('editCard').style.display = 'none';
  document.getElementById('lookupError').style.display = 'none';
}

// What counts as "filled" on this page, scoped to what's actually shown —
// Delegates don't get a logo section here, so their checklist is shorter.
// Mirrors the same idea as the admin panel's profile-completion checklist,
// just computed live from the form in front of the person instead of from
// a saved database row.
function profileChecklist() {
  const form = document.getElementById('editForm');
  const items = [
    { label: 'Email', has: () => !!form.elements.email.value.trim() },
    { label: 'Food preference', has: () => !!(form.elements.dietary_preference && form.elements.dietary_preference.value) },
    { label: 'Shirt/T-shirt size', has: () => !!(form.elements.shirt_size.value || form.elements.tshirt_size.value) },
    { label: 'Photo', has: () => fileState.photo },
    { label: 'Business card', has: () => fileState.card },
  ];
  const canHaveLogo = current && (current.type === 'host_member' || current.type === 'volunteer');
  if (canHaveLogo) items.push({ label: 'Company logo', has: () => fileState.logo });
  return items;
}

function updateCompletion() {
  if (!current) return;
  const items = profileChecklist();
  const missing = items.filter((f) => !f.has());
  const pct = items.length ? Math.round(((items.length - missing.length) / items.length) * 100) : 100;
  document.getElementById('profileCompletionPct').textContent = pct + '%';
  const bar = document.getElementById('profileCompletionBar');
  bar.style.width = pct + '%';
  bar.style.background = pct === 100 ? 'var(--green)' : (pct === 0 ? 'var(--red)' : 'var(--gold)');
  const missEl = document.getElementById('profileCompletionMissing');
  missEl.textContent = missing.length
    ? `Still to fill: ${missing.map((f) => f.label).join(', ')}`
    : 'All set — thank you for completing your details!';
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
  pendingPhoto = null;
  pendingCard = null;
  pendingLogo = null;
  document.getElementById('lookupCard').style.display = 'none';
  document.getElementById('pickCard').style.display = 'none';
  document.getElementById('editCard').style.display = '';
  document.getElementById('editTitle').textContent = `Update your details — ${match.name} (${match.label})`;
  const form = document.getElementById('editForm');
  form.elements.email.value = match.email || '';
  form.elements.shirt_size.value = match.shirt_size || '';
  form.elements.tshirt_size.value = match.tshirt_size || '';
  form.elements.waist_size.value = match.waist_size || '';

  // Catering + accommodation. A Delegate who lands here (the lookup searches
  // all three tables) sees the same inputs, prefilled from whatever they
  // already answered on my-travel.html.
  if (form.elements.dietary_preference) form.elements.dietary_preference.value = match.dietary_preference || '';
  const drinks = (match.drink_preference || '').split(',').map((s) => s.trim()).filter(Boolean);
  form.querySelectorAll('.drinkPrefBox').forEach((box) => { box.checked = drinks.includes(box.value); });
  if (form.elements.special_requests) form.elements.special_requests.value = match.special_requests || '';
  const hotelBox = document.getElementById('hotelStayRequired');
  if (hotelBox) {
    hotelBox.checked = match.hotel_stay_required === true || match.hotel_stay_required === 'true';
    if (form.elements.hotel_stay_notes) form.elements.hotel_stay_notes.value = match.hotel_stay_notes || '';
    applyHotelStayVisibility();
  }

  renderPreview('photoPreviewWrap', match.photo_url, 'photo');
  renderPreview('cardPreviewWrap', match.business_card_url, 'business card');

  // Delegates have no logo_url column (see publicProfile.js), so the whole
  // section is hidden rather than offering an upload that would be rejected.
  const logoSection = document.getElementById('logoSection');
  const canHaveLogo = match.type === 'host_member' || match.type === 'volunteer';
  if (logoSection) {
    logoSection.style.display = canHaveLogo ? '' : 'none';
    if (canHaveLogo) renderPreview('logoPreviewWrap', match.logo_url, 'company logo');
  }

  // Spouse dinners + goodies are host-member-only columns, so the block is
  // hidden entirely for Delegates and Volunteers — showing it would offer
  // questions whose answers the server would refuse to store.
  const spouseSection = document.getElementById('spouseSection');
  if (spouseSection) {
    const isHostMember = match.type === 'host_member';
    spouseSection.style.display = isHostMember ? '' : 'none';
    if (isHostMember) {
      if (form.elements.spouse_name) form.elements.spouse_name.value = match.spouse_name || '';
      document.getElementById('spouseAug12').checked = isTrue(match.spouse_dinner_aug12);
      document.getElementById('spouseAug13').checked = isTrue(match.spouse_dinner_aug13);
      document.getElementById('spouseAug14').checked = isTrue(match.spouse_dinner_aug14);
      document.getElementById('goodiesOffer').checked = isTrue(match.goodies_offer);
      if (form.elements.goodies_details) form.elements.goodies_details.value = match.goodies_details || '';
      applyGoodiesVisibility();
      applySpouseNameWarning();
    }
  }

  fileState = {
    photo: !!match.photo_url,
    card: !!match.business_card_url,
    logo: canHaveLogo && !!match.logo_url,
  };
  updateCompletion();
}

// Postgres booleans arrive as real booleans over JSON, but a value that has
// been through a form round-trip can come back as the string "true".
function isTrue(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

// The "what are you offering" box only makes sense once they've said yes.
function applyGoodiesVisibility() {
  const wrap = document.getElementById('goodiesDetailsWrap');
  const box = document.getElementById('goodiesOffer');
  if (!wrap || !box) return;
  wrap.style.display = box.checked ? '' : 'none';
}

// Nudge rather than block: a spouse ticked for a dinner but left unnamed
// means the badge desk has nothing to print. Saving is still allowed, since
// a member may genuinely not know yet.
function applySpouseNameWarning() {
  const warn = document.getElementById('spouseNameWarning');
  const form = document.getElementById('editForm');
  if (!warn || !form) return;
  const anyNight = ['spouseAug12', 'spouseAug13', 'spouseAug14']
    .some((id) => { const el = document.getElementById(id); return el && el.checked; });
  const named = form.elements.spouse_name && form.elements.spouse_name.value.trim() !== '';
  warn.style.display = anyNight && !named ? '' : 'none';
}

// The "which nights / why" box is only meaningful once a room is actually
// being requested, so it stays hidden until the checkbox is ticked.
function applyHotelStayVisibility() {
  const wrap = document.getElementById('hotelStayNotesWrap');
  const box = document.getElementById('hotelStayRequired');
  if (!wrap || !box) return;
  wrap.style.display = box.checked ? '' : 'none';
}

// "No Alcohol" is mutually exclusive with every other drink option, since
// picking both makes no sense. Mirrors my-travel.html's wireDrinkPrefExclusivity.
function wireDrinkPrefExclusivity() {
  const boxes = Array.from(document.querySelectorAll('.drinkPrefBox'));
  const noAlcohol = document.querySelector('.noAlcoholBox');
  if (!noAlcohol) return;
  boxes.forEach((box) => {
    box.addEventListener('change', () => {
      if (box === noAlcohol) {
        if (box.checked) boxes.forEach((b) => { if (b !== noAlcohol) b.checked = false; });
      } else if (box.checked) {
        noAlcohol.checked = false;
      }
    });
  });
}

function renderPreview(wrapId, url, label) {
  const wrap = document.getElementById(wrapId);
  wrap.innerHTML = url
    ? `<img src="${mediaUrl(url)}" alt="Your ${label}" style="max-width:100%;max-height:220px;border-radius:8px;border:1px solid var(--border,#ddd);display:block;" />`
    : `<p class="hint" style="margin:0;">No ${label} on file yet.</p>`;
}

// Shows the just-picked file immediately (from local disk, via an object
// URL) so the person can see what they selected, with a note that it's not
// saved to the server yet — that only happens when "Save changes" is hit.
function renderPendingPreview(wrapId, file, label) {
  const wrap = document.getElementById(wrapId);
  const url = URL.createObjectURL(file);
  wrap.innerHTML = `
    <img src="${url}" alt="Selected ${label}" style="max-width:100%;max-height:220px;border-radius:8px;border:1px solid var(--border,#ddd);display:block;" />
    <p class="hint" style="margin:6px 0 0;color:var(--gold,#b8860b);">New ${label} selected — not saved yet. Click "Save changes" below.</p>
  `;
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

// One button, one action: saves the sizes plus whichever of photo/business
// card were picked (staged in pendingPhoto/pendingCard), so there's never a
// question of "did that last thing I did actually get saved" — either this
// click succeeds and everything on the page is saved, or it fails and
// nothing silently half-saves.
document.getElementById('editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!current) return;
  const btn = document.getElementById('saveAllBtn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const body = Object.fromEntries(new FormData(e.target).entries());
    body.name = current.name;
    body.phone = current.phone;
    // The drink checkboxes carry no `name` attribute (FormData would only
    // keep the last one), so they're collected manually — same approach as
    // my-travel.html.
    body.drink_preference = Array.from(e.target.querySelectorAll('.drinkPrefBox:checked')).map((b) => b.value).join(', ');
    const hotelBox = document.getElementById('hotelStayRequired');
    if (hotelBox) {
      body.hotel_stay_required = hotelBox.checked;
      // Don't keep stale "which nights" text against an unticked request.
      if (!hotelBox.checked) body.hotel_stay_notes = '';
    }
    // Spouse dinners + goodies — host members only. Sent only for that type so
    // the server never sees columns a Delegate's or Volunteer's table lacks;
    // publicProfile.js ignores unsent keys rather than blanking them.
    if (current.type === 'host_member') {
      const aug12 = document.getElementById('spouseAug12').checked;
      const aug13 = document.getElementById('spouseAug13').checked;
      const aug14 = document.getElementById('spouseAug14').checked;
      body.spouse_dinner_aug12 = aug12;
      body.spouse_dinner_aug13 = aug13;
      body.spouse_dinner_aug14 = aug14;
      // No nights ticked means no spouse attending — drop a leftover name so
      // the catering list can't show a guest nobody booked.
      if (!aug12 && !aug13 && !aug14) body.spouse_name = '';
      const goodies = document.getElementById('goodiesOffer').checked;
      body.goodies_offer = goodies;
      if (!goodies) body.goodies_details = '';
    } else {
      // FormData picks these up from the hidden block; strip them so a
      // Delegate's save doesn't carry host-member-only keys.
      delete body.spouse_name;
      delete body.goodies_details;
    }
    const r = await fetch(`${API}/public-profile/${current.type}/${current.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Save failed');

    if (pendingPhoto) {
      const pd = await uploadImage('photo', pendingPhoto);
      renderPreview('photoPreviewWrap', pd.photo_url, 'photo');
      pendingPhoto = null;
    }
    if (pendingCard) {
      const cd = await uploadImage('business-card', pendingCard);
      renderPreview('cardPreviewWrap', cd.business_card_url, 'business card');
      pendingCard = null;
    }
    if (pendingLogo) {
      const ld = await uploadImage('logo', pendingLogo);
      renderPreview('logoPreviewWrap', ld.logo_url, 'company logo');
      pendingLogo = null;
    }

    btn.textContent = '✓ Saved';
    toast('All changes saved — thank you!', 3000);
    updateCompletion();
    setTimeout(() => { btn.textContent = originalLabel; }, 2000);
  } catch (err) {
    toast(err.message, 4000);
    btn.textContent = originalLabel;
  } finally {
    btn.disabled = false;
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
document.getElementById('photoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  pendingPhoto = file;
  renderPendingPreview('photoPreviewWrap', file, 'photo');
  fileState.photo = true;
  updateCompletion();
});

document.getElementById('cardUploadBtn').addEventListener('click', () => document.getElementById('cardInput').click());
document.getElementById('cardInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  pendingCard = file;
  renderPendingPreview('cardPreviewWrap', file, 'business card');
  fileState.card = true;
  updateCompletion();
});

document.getElementById('logoUploadBtn').addEventListener('click', () => document.getElementById('logoInput').click());
document.getElementById('logoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  pendingLogo = file;
  renderPendingPreview('logoPreviewWrap', file, 'company logo');
  fileState.logo = true;
  updateCompletion();
});

document.getElementById('startOverBtn').addEventListener('click', showLookup);

const hotelStayBox = document.getElementById('hotelStayRequired');
if (hotelStayBox) hotelStayBox.addEventListener('change', applyHotelStayVisibility);
wireDrinkPrefExclusivity();

const goodiesBox = document.getElementById('goodiesOffer');
if (goodiesBox) goodiesBox.addEventListener('change', applyGoodiesVisibility);
['spouseAug12', 'spouseAug13', 'spouseAug14'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', applySpouseNameWarning);
});
const spouseNameInput = document.querySelector('#editForm [name="spouse_name"]');
if (spouseNameInput) spouseNameInput.addEventListener('input', applySpouseNameWarning);

// Live-update the completion bar as the person types/selects — this is
// meant to feel instant, not wait for a save.
const editFormEl = document.getElementById('editForm');
editFormEl.addEventListener('input', updateCompletion);
editFormEl.addEventListener('change', updateCompletion);
