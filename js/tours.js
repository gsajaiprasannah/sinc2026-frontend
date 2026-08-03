// Public tour-interest page. No login: a delegate is identified by the mobile
// number on their registration, which also pulls in their co-registrant so
// both can be signed up in one visit.
//
// Selections are held per person and only written on "Save", so someone can
// change their mind freely before committing.

const API = ((window.SINC_CONFIG && window.SINC_CONFIG.API_BASE_URL) || '/api').replace(/\/$/, '');

let TOURS = [];              // every published tour
let PEOPLE = [];             // delegate + co-registrant from the lookup
let activePersonId = null;   // whose selections the tiles currently reflect
let selections = {};         // { participantId: Set(tourId) }
let phone = '';
let modalTourId = null;

const $ = (id) => document.getElementById(id);

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
function toast(msg, ms) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2600);
}

// --- dates -----------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
function dateLabel(t) {
  if (!t.start_date) return 'Dates to be confirmed';
  if (!t.end_date || t.end_date === t.start_date) return `${fmtDate(t.start_date)} ${t.start_date.slice(0, 4)}`;
  return `${fmtDate(t.start_date)} – ${fmtDate(t.end_date)} ${t.end_date.slice(0, 4)}`;
}

// Mirrors rangesOverlap in server/routes/publicTours.js. Kept in both places
// on purpose: the page needs it to grey tiles out instantly, and the server
// re-checks because a stale page must not be able to write a clashing pair.
function overlaps(a, b) {
  const s1 = a.start_date || a.end_date, e1 = a.end_date || a.start_date;
  const s2 = b.start_date || b.end_date, e2 = b.end_date || b.start_date;
  if (!s1 || !s2) return false;
  return s1 <= e2 && s2 <= e1;
}

// Which already-selected tour (if any) blocks this one for the active person.
function blockingTour(tour) {
  const chosen = selections[activePersonId];
  if (!chosen || chosen.has(tour.id)) return null;
  for (const id of chosen) {
    const other = TOURS.find((t) => t.id === id);
    if (other && overlaps(tour, other)) return other;
  }
  return null;
}

// --- rendering -------------------------------------------------------------

function renderPeople() {
  $('whoCard').style.display = PEOPLE.length ? '' : 'none';
  if (!PEOPLE.length) return;
  $('whoHint').textContent = PEOPLE.length > 1
    ? 'Your registration covers more than one person. Choose whose tours you are picking, then select below.'
    : 'We found your registration.';
  $('whoList').innerHTML = PEOPLE.map((p) => {
    const n = (selections[p.id] || new Set()).size;
    return `<label class="who-row">
      <input type="radio" name="activePerson" value="${p.id}" ${p.id === activePersonId ? 'checked' : ''} />
      <span style="flex:1;">
        <strong>${esc(p.name)}</strong>
        <span class="hint">${p.is_primary ? 'Primary registrant' : 'Co-registrant'}${p.company ? ' · ' + esc(p.company) : ''}</span>
      </span>
      <span class="hint">${n ? n + ' tour' + (n === 1 ? '' : 's') + ' selected' : 'none selected'}</span>
    </label>`;
  }).join('');
  $('whoList').querySelectorAll('input[name="activePerson"]').forEach((r) => {
    r.addEventListener('change', () => { activePersonId = Number(r.value); renderPeople(); renderTours(); });
  });
}

function renderTours() {
  // Pre-tours first, then day tours grouped by the programme's own categories.
  const groups = [];
  const pre = TOURS.filter((t) => t.tour_type === 'pre');
  if (pre.length) {
    const byBand = {};
    pre.forEach((t) => { (byBand[dateLabel(t)] = byBand[dateLabel(t)] || []).push(t); });
    Object.entries(byBand).forEach(([band, list]) => groups.push({ heading: `Pre-Tours · ${band}`, list }));
  }
  const day = TOURS.filter((t) => t.tour_type === 'day');
  const byCat = {};
  day.forEach((t) => { (byCat[t.category || 'Day Visits'] = byCat[t.category || 'Day Visits'] || []).push(t); });
  Object.entries(byCat).forEach(([cat, list]) => groups.push({ heading: `Day Visit · ${cat}`, list }));

  $('tourSections').innerHTML = groups.map((g) => `
    <div class="card">
      <div class="section-title" style="margin-top:0">${esc(g.heading)}</div>
      <div class="tour-grid">
        ${g.list.map((t) => {
          const chosen = (selections[activePersonId] || new Set()).has(t.id);
          const blocker = activePersonId ? blockingTour(t) : null;
          const cls = ['tour-tile', chosen ? 'selected' : '', blocker ? 'blocked' : ''].filter(Boolean).join(' ');
          return `<div class="${cls}" data-tour="${t.id}">
            <div class="t-name">${esc(t.name)}</div>
            <div class="t-meta">${esc(dateLabel(t))}${t.tour_type === 'day' ? ' · Complimentary' : ''}</div>
            ${blocker ? `<div class="t-clash">Clashes with ${esc(blocker.name)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');

  $('tourSections').querySelectorAll('.tour-tile').forEach((el) => {
    el.addEventListener('click', () => openModal(Number(el.dataset.tour)));
  });
  renderSaveBar();
}

function renderSaveBar() {
  const any = PEOPLE.length > 0;
  $('saveBar').style.display = any ? '' : 'none';
  if (!any) return;
  const parts = PEOPLE.map((p) => {
    const n = (selections[p.id] || new Set()).size;
    return `${esc(p.name)}: ${n ? n + ' tour' + (n === 1 ? '' : 's') : 'none'}`;
  });
  $('saveSummary').innerHTML = parts.join(' &nbsp;·&nbsp; ');
}

// --- modal -----------------------------------------------------------------

function openModal(tourId) {
  const t = TOURS.find((x) => x.id === tourId);
  if (!t) return;
  modalTourId = tourId;
  $('tmName').textContent = t.name;
  $('tmDates').textContent = dateLabel(t) + (t.category ? ' · ' + t.category : '');
  $('tmDescription').textContent = t.description || '';
  $('tmInclusionsWrap').style.display = t.inclusions && t.inclusions.length ? '' : 'none';
  $('tmInclusions').innerHTML = (t.inclusions || []).map((i) => `<li>${esc(i)}</li>`).join('');

  $('tmPrice').textContent = t.tour_type === 'day'
    ? 'This day visit is complimentary for delegates.'
    : 'Pre-tour pricing will be confirmed by the Registration Desk — registering here places no obligation to pay.';

  const chosen = (selections[activePersonId] || new Set()).has(tourId);
  const blocker = activePersonId ? blockingTour(t) : null;
  const btn = $('tmToggleBtn');

  if (!PEOPLE.length) {
    btn.textContent = 'Enter your mobile number first';
    btn.disabled = true;
    $('tmClash').style.display = 'none';
  } else if (blocker) {
    btn.textContent = 'Unavailable — dates clash';
    btn.disabled = true;
    $('tmClash').style.display = '';
    $('tmClash').textContent = `These dates overlap "${blocker.name}", which is already selected. Deselect that one first if you'd prefer this tour.`;
  } else {
    btn.textContent = chosen ? 'Remove this tour' : 'Select this tour';
    btn.disabled = false;
    $('tmClash').style.display = 'none';
  }
  $('tourModalBackdrop').classList.add('open');
}

function closeModal() {
  $('tourModalBackdrop').classList.remove('open');
  modalTourId = null;
}

$('tmCloseBtn').addEventListener('click', closeModal);
$('tourModalBackdrop').addEventListener('click', (e) => { if (e.target === $('tourModalBackdrop')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

$('tmToggleBtn').addEventListener('click', () => {
  if (!activePersonId || !modalTourId) return;
  const set = selections[activePersonId] || (selections[activePersonId] = new Set());
  if (set.has(modalTourId)) set.delete(modalTourId); else set.add(modalTourId);
  closeModal();
  renderPeople();
  renderTours();
});

// --- data ------------------------------------------------------------------

async function loadTours() {
  try {
    const r = await fetch(`${API}/public-tours`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not load the tour programme.');
    TOURS = d.tours || [];
    renderTours();
  } catch (e) {
    $('tourSections').innerHTML = `<div class="card"><p class="hint" style="margin:0;color:var(--red);">${esc(e.message)}</p></div>`;
  }
}

$('lookupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('lookupError');
  err.style.display = 'none';
  const input = e.target.elements.phone.value;
  try {
    const r = await fetch(`${API}/public-tours/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: input })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Lookup failed.');
    phone = input;
    PEOPLE = d.people || [];
    selections = {};
    PEOPLE.forEach((p) => { selections[p.id] = new Set(p.tour_ids || []); });
    activePersonId = PEOPLE.length ? PEOPLE[0].id : null;
    $('lookupCard').style.display = 'none';
    renderPeople();
    renderTours();
    toast(`Found ${PEOPLE.length} person(s) on ${d.reg_number || 'your registration'}.`, 3200);
  } catch (ex) {
    err.textContent = ex.message;
    err.style.display = '';
  }
});

$('saveBtn').addEventListener('click', async () => {
  const btn = $('saveBtn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Saving…';
  try {
    const payload = {
      phone,
      selections: PEOPLE.map((p) => ({ participant_id: p.id, tour_ids: [...(selections[p.id] || [])] }))
    };
    const r = await fetch(`${API}/public-tours/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not save your selections.');
    toast('Thank you — your tour interest has been recorded. The Registration Desk will be in touch.', 5000);
  } catch (ex) {
    toast(ex.message, 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

loadTours();
