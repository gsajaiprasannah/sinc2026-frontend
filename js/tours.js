// Public tour-interest page — a shopping flow, not a login flow.
//
//   1. Land straight on the tours. Browse and add to a cart. No identity yet.
//   2. "Continue" asks for the mobile number on the registration.
//   3. Assign each cart item to the delegate, their co-registrant, or both.
//   4. Confirm — everything is written in one request.
//
// The cart survives a reload (sessionStorage), so scanning the QR, wandering
// off and coming back doesn't lose the selection.
//
// Clash handling differs from the earlier version on purpose. Two tours on
// overlapping dates cannot be assigned to the SAME person, but they can sit in
// one cart for DIFFERENT people — a delegate on the Ooty pre-tour while their
// spouse takes Kodaikanal is perfectly valid. So the cart is unrestricted and
// the rule is enforced per person at the assignment step, which is where it
// actually means something.

const API = ((window.SINC_CONFIG && window.SINC_CONFIG.API_BASE_URL) || '/api').replace(/\/$/, '');
const CART_KEY = 'sinc_tour_cart';

let TOURS = [];
let cart = [];                 // tour ids, in the order added
let PEOPLE = [];               // from the mobile lookup
let assign = {};               // { tourId: Set(participantId) }
let phone = '';
let modalTourId = null;

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? '' : v)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer = null;
function toast(msg, ms) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2600);
}

// --- cart persistence ------------------------------------------------------

function loadCart() {
  try {
    const raw = sessionStorage.getItem(CART_KEY);
    cart = raw ? JSON.parse(raw).filter((n) => Number.isInteger(n)) : [];
  } catch (_) { cart = []; }
}
function saveCart() {
  try { sessionStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (_) { /* private mode */ }
}

// --- dates -----------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
function dateLabel(t) {
  if (!t.start_date) return 'Dates to be confirmed';
  if (!t.end_date || t.end_date === t.start_date) return `${fmtDate(t.start_date)} ${t.start_date.slice(0, 4)}`;
  return `${fmtDate(t.start_date)} – ${fmtDate(t.end_date)} ${t.end_date.slice(0, 4)}`;
}

// Mirrors rangesOverlap in server/routes/publicTours.js. Duplicated so the UI
// can respond instantly; the server re-checks because a stale page must not be
// able to write a clashing pair.
function overlaps(a, b) {
  const s1 = a.start_date || a.end_date, e1 = a.end_date || a.start_date;
  const s2 = b.start_date || b.end_date, e2 = b.end_date || b.start_date;
  if (!s1 || !s2) return false;
  return s1 <= e2 && s2 <= e1;
}

const tourById = (id) => TOURS.find((t) => t.id === id);

// Which other cart tour, already assigned to this person, blocks this one.
function clashFor(tourId, personId) {
  const t = tourById(tourId);
  if (!t) return null;
  for (const otherId of cart) {
    if (otherId === tourId) continue;
    if (!(assign[otherId] || new Set()).has(personId)) continue;
    const other = tourById(otherId);
    if (other && overlaps(t, other)) return other;
  }
  return null;
}

// --- browsing --------------------------------------------------------------

function renderTours() {
  const groups = [];
  const pre = TOURS.filter((t) => t.tour_type === 'pre');
  if (pre.length) {
    const byBand = {};
    pre.forEach((t) => { (byBand[dateLabel(t)] = byBand[dateLabel(t)] || []).push(t); });
    Object.entries(byBand).forEach(([band, list]) => groups.push({ heading: `Pre-Tours · ${band}`, list }));
  }
  const byCat = {};
  TOURS.filter((t) => t.tour_type === 'day')
    .forEach((t) => { (byCat[t.category || 'Day Visits'] = byCat[t.category || 'Day Visits'] || []).push(t); });
  Object.entries(byCat).forEach(([cat, list]) => groups.push({ heading: `Day Visit · ${cat}`, list }));

  $('tourSections').innerHTML = groups.map((g) => `
    <div class="card">
      <div class="section-title" style="margin-top:0">${esc(g.heading)}</div>
      <div class="tour-grid">
        ${g.list.map((t) => `
          <div class="tour-tile ${cart.includes(t.id) ? 'in-cart' : ''}" data-tour="${t.id}">
            <div class="t-name">${esc(t.name)}</div>
            <div class="t-meta">${esc(dateLabel(t))}${t.tour_type === 'day' ? ' · Complimentary' : ''}</div>
          </div>`).join('')}
      </div>
    </div>`).join('');

  $('tourSections').querySelectorAll('.tour-tile').forEach((el) => {
    el.addEventListener('click', () => openTour(Number(el.dataset.tour)));
  });
  renderCartBar();
}

function renderCartBar() {
  const bar = $('cartBar');
  bar.classList.toggle('show', cart.length > 0);
  if (!cart.length) return;
  const names = cart.map((id) => (tourById(id) || {}).name).filter(Boolean);
  $('cartCount').innerHTML =
    `<strong>${cart.length} tour${cart.length === 1 ? '' : 's'} selected</strong><br>` +
    `<span style="opacity:.8;font-size:12.5px;">${esc(names.join(' · '))}</span>`;
}

// --- tour detail -----------------------------------------------------------

function openTour(id) {
  const t = tourById(id);
  if (!t) return;
  modalTourId = id;
  $('tmName').textContent = t.name;
  $('tmDates').textContent = dateLabel(t) + (t.category ? ' · ' + t.category : '');
  $('tmDescription').textContent = t.description || '';
  $('tmInclusionsWrap').style.display = (t.inclusions || []).length ? '' : 'none';
  $('tmInclusions').innerHTML = (t.inclusions || []).map((i) => `<li>${esc(i)}</li>`).join('');
  $('tmPrice').textContent = t.tour_type === 'day'
    ? 'This day visit is complimentary for delegates.'
    : 'Pre-tour pricing will be confirmed by the Registration Desk. Adding it here places you under no obligation.';
  $('tmToggleBtn').textContent = cart.includes(id) ? 'Remove from my tours' : 'Add to my tours';
  $('tourModal').classList.add('open');
}
const closeTour = () => { $('tourModal').classList.remove('open'); modalTourId = null; };

$('tmCloseBtn').addEventListener('click', closeTour);
$('tourModal').addEventListener('click', (e) => { if (e.target === $('tourModal')) closeTour(); });
$('tmToggleBtn').addEventListener('click', () => {
  if (!modalTourId) return;
  const i = cart.indexOf(modalTourId);
  if (i >= 0) cart.splice(i, 1); else cart.push(modalTourId);
  saveCart();
  closeTour();
  renderTours();
});

// --- checkout --------------------------------------------------------------

function showCheckoutStep(which) {
  ['coStepPhone', 'coStepAssign', 'coStepDone'].forEach((id) => {
    $(id).style.display = id === which ? '' : 'none';
  });
  $('checkoutModal').classList.add('open');
}
const closeCheckout = () => $('checkoutModal').classList.remove('open');

$('checkoutBtn').addEventListener('click', () => {
  if (!cart.length) { toast('Add at least one tour first.'); return; }
  showCheckoutStep(PEOPLE.length ? 'coStepAssign' : 'coStepPhone');
  if (PEOPLE.length) renderAssign();
});
$('coBackBtn1').addEventListener('click', closeCheckout);
$('coBackBtn2').addEventListener('click', closeCheckout);
$('coDoneBtn').addEventListener('click', closeCheckout);
$('checkoutModal').addEventListener('click', (e) => { if (e.target === $('checkoutModal')) closeCheckout(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeTour(); closeCheckout(); } });

$('coPhoneForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('coError');
  err.style.display = 'none';
  const value = e.target.elements.phone.value;
  try {
    const r = await fetch(`${API}/public-tours/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: value })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Lookup failed.');
    phone = value;
    PEOPLE = d.people || [];
    // Default: assign the cart to the primary registrant, since most people
    // are booking for themselves — but skip any tour that would clash with
    // one already defaulted to them. Blindly ticking everything would build a
    // state the server rejects at Confirm, which is a confusing place to
    // discover it. Skipped tours are left unticked for the user to place.
    const primary = (PEOPLE.find((p) => p.is_primary) || PEOPLE[0] || {}).id;
    assign = {};
    cart.forEach((id) => { assign[id] = new Set(); });
    if (primary) {
      cart.forEach((id) => {
        if (!clashFor(id, primary)) assign[id].add(primary);
      });
    }
    renderAssign();
    showCheckoutStep('coStepAssign');
  } catch (ex) {
    err.textContent = ex.message;
    err.style.display = '';
  }
});

function renderAssign() {
  $('coWhoHint').textContent = PEOPLE.length > 1
    ? 'Tick who is joining each tour. Both of you can go on the same tour, or take different ones.'
    : 'Confirm the tours you would like to join.';

  $('coCartList').innerHTML = cart.map((id) => {
    const t = tourById(id);
    if (!t) return '';
    const chosen = assign[id] || new Set();
    return `<div class="cart-line">
      <div style="display:flex;gap:8px;align-items:flex-start;">
        <div style="flex:1;">
          <strong>${esc(t.name)}</strong><br>
          <span class="hint">${esc(dateLabel(t))}${t.tour_type === 'day' ? ' · Complimentary' : ''}</span>
        </div>
        <button class="btn small" type="button" data-remove="${id}">Remove</button>
      </div>
      <div class="who-chips">
        ${PEOPLE.map((p) => {
          const blocker = clashFor(id, p.id);
          const on = chosen.has(p.id);
          const cls = ['who-chip', on ? 'on' : '', (blocker && !on) ? 'clash' : ''].filter(Boolean).join(' ');
          const title = blocker && !on ? ` title="Clashes with ${esc(blocker.name)}"` : '';
          return `<span class="${cls}" data-tour="${id}" data-person="${p.id}"${title}>
            ${on ? '✓ ' : ''}${esc(p.name)}${p.is_primary ? '' : ' (co-registrant)'}
          </span>`;
        }).join('')}
      </div>
    </div>`;
  }).join('') || '<p class="hint">Your selection is empty.</p>';

  $('coCartList').querySelectorAll('[data-remove]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = Number(b.dataset.remove);
      cart = cart.filter((x) => x !== id);
      delete assign[id];
      saveCart();
      renderTours();
      if (!cart.length) { closeCheckout(); toast('Your selection is now empty.'); return; }
      renderAssign();
    });
  });

  $('coCartList').querySelectorAll('.who-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const tid = Number(chip.dataset.tour);
      const pid = Number(chip.dataset.person);
      const set = assign[tid] || (assign[tid] = new Set());
      if (set.has(pid)) {
        set.delete(pid);
      } else {
        const blocker = clashFor(tid, pid);
        if (blocker) {
          const note = $('coClashNote');
          note.textContent = `${(PEOPLE.find((p) => p.id === pid) || {}).name} is already down for "${blocker.name}", which runs on overlapping dates. Remove that one first.`;
          note.style.display = '';
          setTimeout(() => { note.style.display = 'none'; }, 6000);
          return;
        }
        set.add(pid);
      }
      renderAssign();
    });
  });
}

$('coConfirmBtn').addEventListener('click', async () => {
  const btn = $('coConfirmBtn');
  const chosenAny = cart.some((id) => (assign[id] || new Set()).size);
  if (!chosenAny) { toast('Tick at least one person against a tour.'); return; }

  // Invert { tour -> people } into { person -> tours }, which is what the API
  // takes, and include people with an empty list so deselecting clears them.
  const byPerson = new Map(PEOPLE.map((p) => [p.id, []]));
  cart.forEach((tid) => (assign[tid] || new Set()).forEach((pid) => {
    if (byPerson.has(pid)) byPerson.get(pid).push(tid);
  }));

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Confirming…';
  try {
    const r = await fetch(`${API}/public-tours/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone,
        selections: [...byPerson.entries()].map(([participant_id, tour_ids]) => ({ participant_id, tour_ids }))
      })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not save your tours.');

    const lines = [...byPerson.entries()]
      .filter(([, ids]) => ids.length)
      .map(([pid, ids]) => {
        const who = (PEOPLE.find((p) => p.id === pid) || {}).name;
        return `${who}: ${ids.map((i) => (tourById(i) || {}).name).join(', ')}`;
      });
    $('coDoneMsg').innerHTML = lines.map((l) => esc(l)).join('<br>');
    cart = [];
    saveCart();
    renderTours();
    showCheckoutStep('coStepDone');
  } catch (ex) {
    toast(ex.message, 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

// --- boot ------------------------------------------------------------------

(async function init() {
  loadCart();
  try {
    const r = await fetch(`${API}/public-tours`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not load the tour programme.');
    TOURS = d.tours || [];
    // Drop anything cached from a previous visit that has since been unpublished.
    cart = cart.filter((id) => TOURS.some((t) => t.id === id));
    saveCart();
    renderTours();
  } catch (e) {
    $('tourSections').innerHTML =
      `<div class="card"><p class="hint" style="margin:0;color:var(--red);">${esc(e.message)}</p></div>`;
  }
})();
