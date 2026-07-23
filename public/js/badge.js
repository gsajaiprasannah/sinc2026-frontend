// Adaptive QR badge page — see server/routes/badge.js header for the full
// design. Always shows the public vCard section (no login needed); if this
// browser already carries a staff/admin login (same localStorage key
// admin.html uses), it also fetches and shows the staff-only section with
// room/vehicle/payment details and a Mark Attendance button.
const API = ((window.SINC_CONFIG && window.SINC_CONFIG.API_BASE_URL) || '/api').replace(/\/$/, '');
const MEDIA_ORIGIN = API.replace(/\/api\/?$/, '');
const TOKEN_KEY = 'sinc_admin_token'; // same key admin.html uses — a staff member logged into the admin panel on this device is automatically recognized here too

function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }
function mediaUrl(p) {
  if (!p) return p;
  if (/^https?:\/\//.test(p)) return p;
  return MEDIA_ORIGIN + p;
}

function getBadgeToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get('token') || '';
}

function show(id, display) { document.getElementById(id).style.display = display === undefined ? 'block' : display; }
function hide(id) { document.getElementById(id).style.display = 'none'; }
function setText(id, text) { document.getElementById(id).textContent = text || ''; }

let PUBLIC_DATA = null;

// --- vCard "Save to Contacts" ------------------------------------------
// Standard vCard 3.0 text, downloaded as a .vcf blob. Tapping the resulting
// file (or, on many mobile browsers, the download itself) offers "Add to
// Contacts" — the same mechanic as a shared digital visiting card.
function buildVCard(d) {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${d.name || ''}`,
    d.org ? `ORG:${d.org}` : '',
    d.role_label ? `TITLE:${d.role_label}` : '',
    d.phone ? `TEL;TYPE=CELL:${d.phone}` : '',
    d.email ? `EMAIL:${d.email}` : '',
    'NOTE:SINC2026 — Skål International National Congress, Coimbatore',
    'END:VCARD'
  ].filter(Boolean);
  return lines.join('\r\n');
}
function triggerSaveContact(d) {
  const vcard = buildVCard(d);
  const blob = new Blob([vcard], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(d.name || 'Contact').replace(/[^a-z0-9]+/gi, '_')}.vcf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function renderPublic(d) {
  PUBLIC_DATA = d;
  setText('pcName', d.name);
  setText('pcRole', d.role_label);
  setText('pcOrg', d.org);
  if (d.photo_url) {
    const img = document.getElementById('pcPhoto');
    img.src = mediaUrl(d.photo_url);
    img.style.display = 'block';
  } else {
    const initialEl = document.getElementById('pcInitial');
    initialEl.textContent = (d.name || '?').trim().charAt(0).toUpperCase();
    initialEl.style.display = 'flex';
  }
  if (d.phone) {
    const el = document.getElementById('pcPhone');
    el.innerHTML = `<label>Phone</label>${d.phone}`;
    el.style.display = 'block';
  }
  if (d.email) {
    const el = document.getElementById('pcEmail');
    el.innerHTML = `<label>Email</label>${d.email}`;
    el.style.display = 'block';
  }
  show('publicCard');
}

function tripLine(t) {
  const vehicle = [t.vehicle_code, t.vehicle_type, t.vehicle_model].filter(Boolean).join(' · ') || 'Vehicle TBD';
  const driver = t.driver_name ? ` · Driver: ${t.driver_name}${t.driver_phone ? ' (' + t.driver_phone + ')' : ''}` : '';
  const when = [t.trip_date, t.depart_time].filter(Boolean).join(' ');
  return `<div style="padding:8px 0;border-bottom:1px solid var(--line);font-size:13px;">
    <strong>${(t.trip_type || '').toUpperCase()}</strong> ${when ? '· ' + when : ''}<br/>
    ${t.from_location || '?'} → ${t.to_location || '?'}${t.pickup_point ? ' (pickup: ' + t.pickup_point + ')' : ''}<br/>
    ${vehicle}${driver}
  </div>`;
}

function renderStaff(d) {
  if (d.registration) {
    const r = d.registration;
    const bits = [r.reg_number, r.reg_type, r.payment_status ? `Payment: ${String(r.payment_status).toUpperCase()}` : (r.payment_amount ? `₹${r.payment_amount}` : null)].filter(Boolean);
    setText('staffReg', bits.join(' · ') || '—');
    show('staffRegBlock');
  }
  if (d.room) {
    setText('staffRoom', `${d.room.hotel_name} · Room ${d.room.room_number}${d.room.room_type ? ' (' + d.room.room_type + ')' : ''}`);
    show('staffRoomBlock');
  }
  if (d.trips && d.trips.length) {
    document.getElementById('staffTrips').innerHTML = d.trips.map(tripLine).join('');
    show('staffTripsBlock');
  }
  if (d.last_checked_in_at) {
    const el = document.getElementById('staffLastCheckin');
    el.textContent = `Last checked in: ${new Date(d.last_checked_in_at).toLocaleString('en-IN')}`;
    el.style.display = 'block';
  }
  hide('staffLoginPrompt');
  show('staffCard');
}

async function loadPublic(token) {
  const r = await fetch(`${API}/badge/public/${encodeURIComponent(token)}`);
  if (!r.ok) throw new Error('not found');
  return r.json();
}
async function loadStaff(token) {
  const r = await fetch(`${API}/badge/staff/${encodeURIComponent(token)}`, { headers: { Authorization: 'Bearer ' + getToken() } });
  if (!r.ok) return null; // 401/403/404 — just skip the staff section, no error shown to the general scanner
  return r.json();
}

async function boot() {
  const token = getBadgeToken();
  if (!token) { hide('loadingState'); show('errorState'); return; }
  try {
    const pub = await loadPublic(token);
    hide('loadingState');
    renderPublic(pub);
  } catch (e) {
    hide('loadingState');
    show('errorState');
    return;
  }
  if (getToken()) {
    const staff = await loadStaff(token);
    if (staff) renderStaff(staff);
    else show('staffLoginPrompt');
  } else {
    show('staffLoginPrompt');
  }
}

document.getElementById('saveContactBtn').addEventListener('click', () => {
  if (PUBLIC_DATA) triggerSaveContact(PUBLIC_DATA);
});

document.getElementById('showStaffLogin').addEventListener('click', (e) => {
  e.preventDefault();
  hide('staffLoginPrompt');
  show('staffLoginCard');
});

document.getElementById('staffLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('staffLoginError');
  errEl.style.display = 'none';
  const fd = new FormData(e.target);
  try {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(fd.entries()))
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Login failed');
    const RESTRICTED_ROLES = ['host_member', 'media', 'transporter', 'driver', 'volunteer', 'vendor'];
    if (RESTRICTED_ROLES.includes(data.user.role)) {
      throw new Error('This login does not have staff/admin access to badge details.');
    }
    setToken(data.token);
    hide('staffLoginCard');
    const staff = await loadStaff(getBadgeToken());
    if (staff) renderStaff(staff);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
});

document.getElementById('markAttendanceBtn').addEventListener('click', async () => {
  const btn = document.getElementById('markAttendanceBtn');
  btn.disabled = true;
  try {
    const r = await fetch(`${API}/badge/staff/${encodeURIComponent(getBadgeToken())}/checkin`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + getToken() }
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Could not mark attendance');
    const el = document.getElementById('staffLastCheckin');
    el.textContent = `Checked in: ${new Date(data.checked_in_at).toLocaleString('en-IN')}`;
    el.style.display = 'block';
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

boot();
