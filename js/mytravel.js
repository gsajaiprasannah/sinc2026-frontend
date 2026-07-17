// Public, no-login "update my own travel details" page — Delegates only.
// Hits /api/public-profile (server/routes/publicProfile.js), same
// unauthenticated name+phone re-verification pattern as my-profile.html
// (see that file's server-side header comment). Kept as its own page/file
// rather than folded into my-profile.html because it's a completely
// different set of fields (address + arrival/departure travel) that only
// exists on the `participants` table — Host Members and Volunteers don't
// have these columns at all.
const API = ((window.SINC_CONFIG && window.SINC_CONFIG.API_BASE_URL) || '/api').replace(/\/$/, '');

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

function openRecord(match) {
  current = { id: match.id, name: match.name, phone: match.phone };
  document.getElementById('lookupCard').style.display = 'none';
  document.getElementById('pickCard').style.display = 'none';
  document.getElementById('editCard').style.display = '';
  document.getElementById('editTitle').textContent = `Update your travel details — ${match.name}`;
  const form = document.getElementById('editForm');
  form.elements.address.value = match.address || '';
  form.elements.travel_mode.value = match.travel_mode || '';
  form.elements.travel_number.value = match.travel_number || '';
  form.elements.travel_datetime.value = toLocalInputValue(match.travel_datetime);
  form.elements.arrival_point.value = match.arrival_point || '';
  form.elements.departure_mode.value = match.departure_mode || '';
  form.elements.departure_number.value = match.departure_number || '';
  form.elements.departure_datetime.value = toLocalInputValue(match.departure_datetime);
  form.elements.departure_point.value = match.departure_point || '';
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

// One button, one action — every field on this page saves together, so
// there's never a question of whether the last edit actually stuck.
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
    const r = await fetch(`${API}/public-profile/participant/${current.id}/travel`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Save failed');
    btn.textContent = '✓ Saved';
    toast('Travel details saved — thank you!', 3000);
    setTimeout(() => { btn.textContent = originalLabel; }, 2000);
  } catch (err) {
    toast(err.message, 4000);
    btn.textContent = originalLabel;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('startOverBtn').addEventListener('click', showLookup);
