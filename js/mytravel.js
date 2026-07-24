// Public, no-login "update my own travel details" page — Delegates only.
// Hits /api/public-profile (server/routes/publicProfile.js), same
// unauthenticated name+phone re-verification pattern as my-profile.html
// (see that file's server-side header comment). Kept as its own page/file
// rather than folded into my-profile.html because it's a completely
// different set of fields (address + arrival/departure travel) that only
// exists on the `participants` table — Host Members and Volunteers don't
// have these columns at all.
//
// Also carries Shirt/Tee size, photo and business card for Delegates so
// there's one page where a Delegate can fill in everything relevant to
// them. These map onto the exact same columns/upload endpoints used by
// my-profile.html and the admin's Delegates tab (shirt_size, tshirt_size,
// photo_url, business_card_url on `participants`) — nothing new on the
// backend, just surfaced here too for convenience.
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

// The Delegate record currently being edited: { id, name, phone }. `name`/
// `phone` are kept exactly as typed so every follow-up call can re-send them
// for server-side re-verification.
let current = null;

// Photo/business-card files picked but not yet uploaded — staged here and
// only actually sent to the server when "Save changes" is clicked, same
// pattern as my-profile.html, so one button saves everything on the page.
let pendingPhoto = null;
let pendingCard = null;
let pendingAadhaar = null;
let currentAadhaarUrl = null; // Aadhaar is mandatory — tracks whether a document is already on file

function showLookup() {
  current = null;
  pendingPhoto = null;
  pendingCard = null;
  pendingAadhaar = null;
  currentAadhaarUrl = null;
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
    <button type="button" class="btn" style="display:block;width:100%;text-align:left;margin-bottom:8px;" data-idx="${i}">${m.name}</button>
  `).join('');
  Array.from(list.querySelectorAll('button')).forEach((btn, i) => {
    btn.addEventListener('click', () => openRecord({ ...matches[i], phone }));
  });
}

// travel_datetime/departure_datetime are stored as free-form TEXT (not a
// real timestamp column), so a value entered on this page ("YYYY-MM-DDTHH:mm"
// — exactly what <input type="datetime-local"> produces) round-trips
// cleanly. If the value on file came from somewhere else in some other
// shape, don't force it into the field looking garbled — just leave it
// blank and let the person re-enter it.
function toLocalInputValue(v) {
  if (!v) return '';
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v.slice(0, 16) : '';
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

// Aadhaar accepts an image OR a PDF scan (unlike the photo/business-card
// fields, which are image-only) — an <img> tag can't render a PDF, so this
// checks the file extension on the stored URL and falls back to a plain
// "View document" link, the same approach admin.js uses for finance bills.
function isPdfUrl(url) {
  return /\.pdf($|\?)/i.test(url || '');
}
function renderDocPreview(wrapId, url, label) {
  const wrap = document.getElementById(wrapId);
  if (!url) {
    wrap.innerHTML = `<p class="hint" style="margin:0;">No ${label} on file yet.</p>`;
    return;
  }
  wrap.innerHTML = isPdfUrl(url)
    ? `<a href="${mediaUrl(url)}" target="_blank" rel="noopener" class="btn outline" style="display:inline-block;">View ${label} (PDF)</a>`
    : `<img src="${mediaUrl(url)}" alt="Your ${label}" style="max-width:100%;max-height:220px;border-radius:8px;border:1px solid var(--border,#ddd);display:block;" />`;
}
function renderPendingDocPreview(wrapId, file, label) {
  const wrap = document.getElementById(wrapId);
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (isPdf) {
    wrap.innerHTML = `
      <p class="hint" style="margin:0;">PDF selected: ${file.name}</p>
      <p class="hint" style="margin:6px 0 0;color:var(--gold,#b8860b);">New ${label} selected — not saved yet. Click "Save changes" below.</p>
    `;
    return;
  }
  const url = URL.createObjectURL(file);
  wrap.innerHTML = `
    <img src="${url}" alt="Selected ${label}" style="max-width:100%;max-height:220px;border-radius:8px;border:1px solid var(--border,#ddd);display:block;" />
    <p class="hint" style="margin:6px 0 0;color:var(--gold,#b8860b);">New ${label} selected — not saved yet. Click "Save changes" below.</p>
  `;
}

// Drink preference is stored as one comma-separated TEXT column, but shown as
// a group of checkboxes (nicer UX than a multi-select, and avoids the
// same-name-collision problem a <select multiple> would hit against this
// codebase's `Object.fromEntries(new FormData(form).entries())` serialization
// pattern, which only keeps the last value for a repeated field name). The
// checkboxes deliberately carry no `name` attribute so FormData ignores them
// automatically — the checked values are collected manually into
// body.drink_preference right before the save request goes out. "No Alcohol"
// is mutually exclusive with every other option since picking both makes no
// sense.
function wireDrinkPrefExclusivity(scope) {
  const boxes = Array.from(scope.querySelectorAll('.drinkPrefBox'));
  const noAlcohol = scope.querySelector('.noAlcoholBox');
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
wireDrinkPrefExclusivity(document.getElementById('editForm'));

// Pre-Tours are limited-seat and first-come-first-served (see the hint text
// on the page, and the server-side capacity check in publicProfile.js's PUT
// /participant/:id/pretour) — the dropdown shows live seat counts and
// disables tours that are already full so a delegate can see availability
// before picking, instead of only finding out after hitting Save.
let PRETOURS = [];
async function loadPretourOptions() {
  try {
    const rows = await fetch(`${API}/public/pretours`).then((r) => r.json());
    PRETOURS = Array.isArray(rows) ? rows : [];
    const sel = document.getElementById('pretourSelect');
    if (!sel) return;
    const opts = PRETOURS.map((t) => {
      const full = t.capacity !== null && t.capacity !== undefined && Number(t.participant_count) >= Number(t.capacity);
      const seats = (t.capacity !== null && t.capacity !== undefined) ? `${t.participant_count}/${t.capacity} seats` : `${t.participant_count} signed up`;
      const dates = t.start_date ? ` (${t.start_date}${t.end_date ? ' – ' + t.end_date : ''})` : '';
      return `<option value="${t.id}"${full ? ' disabled' : ''}>${t.name}${dates} — ${seats}${full ? ' — FULL' : ''}</option>`;
    }).join('');
    sel.innerHTML = '<option value="">No, thank you — not attending a pre-tour</option>' + opts;
  } catch (e) {
    // Non-fatal — the dropdown just stays with only the "No thanks" option.
  }
}
loadPretourOptions();

function openRecord(match) {
  current = { id: match.id, name: match.name, phone: match.phone };
  pendingPhoto = null;
  pendingCard = null;
  pendingAadhaar = null;
  currentAadhaarUrl = match.aadhaar_url || null;
  document.getElementById('lookupCard').style.display = 'none';
  document.getElementById('pickCard').style.display = 'none';
  document.getElementById('editCard').style.display = '';
  document.getElementById('editTitle').textContent = `Update your travel details — ${match.name}`;
  const form = document.getElementById('editForm');
  form.elements.email.value = match.email || '';
  form.elements.address.value = match.address || '';
  form.elements.travel_mode.value = match.travel_mode || '';
  form.elements.travel_number.value = match.travel_number || '';
  form.elements.travel_datetime.value = toLocalInputValue(match.travel_datetime);
  form.elements.arrival_point.value = match.arrival_point || '';
  form.elements.departure_mode.value = match.departure_mode || '';
  form.elements.departure_number.value = match.departure_number || '';
  form.elements.departure_datetime.value = toLocalInputValue(match.departure_datetime);
  form.elements.departure_point.value = match.departure_point || '';
  form.elements.shirt_size.value = match.shirt_size || '';
  form.elements.tshirt_size.value = match.tshirt_size || '';
  form.elements.waist_size.value = match.waist_size || '';
  if (form.elements.business_profile) form.elements.business_profile.value = match.business_profile || '';
  form.elements.dietary_preference.value = match.dietary_preference || '';
  const drinks = (match.drink_preference || '').split(',').map((s) => s.trim()).filter(Boolean);
  form.querySelectorAll('.drinkPrefBox').forEach((box) => { box.checked = drinks.includes(box.value); });
  form.elements.special_requests.value = match.special_requests || '';
  if (form.elements.aadhaar_number) form.elements.aadhaar_number.value = match.aadhaar_number || '';
  const pretourSel = document.getElementById('pretourSelect');
  if (pretourSel) pretourSel.value = match.pre_tour_id ? String(match.pre_tour_id) : '';
  renderPreview('photoPreviewWrap', match.photo_url, 'photo');
  renderPreview('cardPreviewWrap', match.business_card_url, 'business card');
  renderDocPreview('aadhaarPreviewWrap', match.aadhaar_url, 'Aadhaar scan');
  updateAadhaarDocHint();
}

// Aadhaar number + document are both mandatory (see publicProfile.js's
// PUT /participant/:id/travel, which enforces this server-side too) — this
// just keeps the person informed of what's still missing before they hit
// Save, rather than only finding out after a failed submit.
function updateAadhaarDocHint() {
  const el = document.getElementById('aadhaarDocHint');
  if (!el) return;
  if (currentAadhaarUrl || pendingAadhaar) {
    el.textContent = '';
  } else {
    el.textContent = 'Required — please upload a photo or PDF scan of your Aadhaar.';
    el.style.color = 'var(--red)';
  }
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
    // /lookup searches Delegates, Host Members and Volunteers together —
    // this page only handles Delegates (participants), so filter down to
    // that before deciding single-match vs picker vs "not found".
    const delegateMatches = data.matches.filter((m) => m.type === 'participant');
    if (!delegateMatches.length) {
      throw new Error('This page is for Delegates only. We found a record under a different role — please contact the organizers if you need help.');
    }
    if (delegateMatches.length === 1) {
      openRecord({ ...delegateMatches[0], phone: body.phone });
    } else {
      showPicker(delegateMatches, body.phone);
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = '';
  }
});

async function uploadImage(field, file) {
  if (!current) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('name', current.name);
  fd.append('phone', current.phone);
  const r = await fetch(`${API}/public-profile/participant/${current.id}/${field}`, { method: 'POST', body: fd });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

// One button, one action — every field on this page (address, travel,
// merch sizes, photo, business card) saves together, so there's never a
// question of whether the last edit actually stuck.
document.getElementById('editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!current) return;

  // Aadhaar (number + document) is mandatory — checked client-side first so
  // people get an immediate, specific message instead of a generic failed
  // save. The server enforces the exact same two conditions independently
  // (see publicProfile.js), since this is a public unauthenticated route.
  const aadhaarNumberVal = (e.target.elements.aadhaar_number.value || '').replace(/\D/g, '');
  if (aadhaarNumberVal.length !== 12) {
    toast('Please enter your 12-digit Aadhaar number.', 4000);
    e.target.elements.aadhaar_number.focus();
    return;
  }
  if (!currentAadhaarUrl && !pendingAadhaar) {
    toast('Please upload your Aadhaar document (photo or PDF scan).', 4000);
    updateAadhaarDocHint();
    return;
  }

  const btn = document.getElementById('saveAllBtn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    // Upload the Aadhaar document BEFORE saving the travel/JSON fields below
    // — the server's travel PUT checks that aadhaar_url is already set on
    // the row, so the document has to land first for that check to pass on
    // this same "Save changes" click (see publicProfile.js for why).
    if (pendingAadhaar) {
      const ad = await uploadImage('aadhaar', pendingAadhaar);
      renderDocPreview('aadhaarPreviewWrap', ad.aadhaar_url, 'Aadhaar scan');
      currentAadhaarUrl = ad.aadhaar_url;
      pendingAadhaar = null;
      updateAadhaarDocHint();
    }

    const body = Object.fromEntries(new FormData(e.target).entries());
    body.name = current.name;
    body.phone = current.phone;
    // Drink preference is collected manually from the checkbox group (see
    // wireDrinkPrefExclusivity's comment above) rather than via FormData,
    // since the checkboxes have no `name` attribute.
    const checkedDrinks = Array.from(e.target.querySelectorAll('.drinkPrefBox:checked')).map((b) => b.value);
    body.drink_preference = checkedDrinks.join(', ');
    // Pre-tour signup is a separate table (pre_tour_participants), not a
    // participants column — saved via its own request right after this one.
    const pretourChoice = body.pretour_choice || '';
    delete body.pretour_choice;

    const r = await fetch(`${API}/public-profile/participant/${current.id}/travel`, {
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

    // Pre-tour signup can fail on its own (e.g. the tour filled up between
    // page load and Save) without the rest of this page's changes being
    // lost — everything above already saved, so surface that specific
    // problem instead of a generic failure.
    let pretourError = null;
    try {
      const ptRes = await fetch(`${API}/public-profile/participant/${current.id}/pretour`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: current.name, phone: current.phone, pre_tour_id: pretourChoice || null })
      });
      const ptData = await ptRes.json();
      if (!ptRes.ok) pretourError = ptData.error || 'Pre-tour signup failed';
      else loadPretourOptions(); // refresh seat counts now that this signup has changed them
    } catch (ptErr) {
      pretourError = ptErr.message;
    }

    if (pretourError) {
      toast(pretourError, 6000);
      btn.textContent = originalLabel;
    } else {
      btn.textContent = '✓ Saved';
      toast('All changes saved — thank you!', 3000);
      setTimeout(() => { btn.textContent = originalLabel; }, 2000);
    }
  } catch (err) {
    toast(err.message, 4000);
    btn.textContent = originalLabel;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('photoUploadBtn').addEventListener('click', () => document.getElementById('photoInput').click());
document.getElementById('photoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  pendingPhoto = file;
  renderPendingPreview('photoPreviewWrap', file, 'photo');
});

document.getElementById('cardUploadBtn').addEventListener('click', () => document.getElementById('cardInput').click());
document.getElementById('cardInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  pendingCard = file;
  renderPendingPreview('cardPreviewWrap', file, 'business card');
});

document.getElementById('aadhaarUploadBtn').addEventListener('click', () => document.getElementById('aadhaarInput').click());
document.getElementById('aadhaarInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  pendingAadhaar = file;
  renderPendingDocPreview('aadhaarPreviewWrap', file, 'Aadhaar scan');
  updateAadhaarDocHint();
});

document.getElementById('startOverBtn').addEventListener('click', showLookup);
