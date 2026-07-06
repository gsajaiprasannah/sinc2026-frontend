// Public homepage — media reel/posters, live happenings, and the congress
// itinerary. No login involved: these are public-facing promotional/
// informational endpoints (see server/index.js — only clubs/stats stayed
// admin-gated when the dashboard was split out to dashboard.html).
const API = ((window.SINC_CONFIG && window.SINC_CONFIG.API_BASE_URL) || '/api').replace(/\/$/, '');
const MEDIA_ORIGIN = API.replace(/\/api\/?$/, ''); // '' when API is relative, backend origin when API is absolute
const HAS_BACKEND = !!(window.SINC_CONFIG && window.SINC_CONFIG.API_BASE_URL);

function mediaUrl(p) {
  if (!p) return p;
  if (/^https?:\/\//.test(p)) return p;
  return MEDIA_ORIGIN + p;
}

// Routes downloads through our own backend (so the file always saves with a
// friendly name and a forced download, regardless of the media host's CORS
// setup).
function mediaDownloadUrl(item) {
  if (HAS_BACKEND && item && item.id) return `${API}/media/${item.id}/download`;
  return mediaUrl(item.filename);
}

let videoIndex = 0, posterIndex = 0;
let videoTimer = null, posterTimer = null;

async function jget(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Request failed: ' + url);
  return r.json();
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderHappenings(rows) {
  const el = document.getElementById('happeningsFeed');
  if (!rows.length) {
    el.innerHTML = '<div class="empty">No updates posted yet.</div>';
    return;
  }
  el.innerHTML = rows.map((h) => `
    <div class="feed-item">
      <div class="time">${new Date(h.happened_at.replace(' ', 'T') + 'Z').toLocaleString()}</div>
      <div class="title">${h.title}</div>
      <div class="desc">${h.description || ''}</div>
    </div>
  `).join('');
}

function setupLoop(containerId, items, kind) {
  const el = document.getElementById(containerId);
  if (videoTimer && kind === 'video') clearTimeout(videoTimer);
  if (posterTimer && kind === 'poster') clearTimeout(posterTimer);

  if (!items || items.length === 0) {
    el.innerHTML = `<div class="empty" style="padding:40px 0;${kind === 'video' ? 'color:#fff;' : ''}">No ${kind}s uploaded yet — add some from Admin → Media.</div>`;
    return;
  }

  let idx = kind === 'video' ? videoIndex % items.length : posterIndex % items.length;
  // Videos start muted so the browser allows autoplay; the mute/volume
  // controls carry over as you move between items in the loop.
  let muted = true;
  let volume = 1;

  function render() {
    const item = items[idx];
    const url = mediaUrl(item.filename);
    const dlUrl = mediaDownloadUrl(item);
    const mediaTag = kind === 'video'
      ? `<video src="${url}" autoplay muted playsinline></video>`
      : `<img src="${url}" alt="${item.title || ''}" />`;

    const controlsHtml = kind === 'video'
      ? `
        <div class="media-controls">
          <button type="button" class="media-btn" data-act="prev" title="Previous video" aria-label="Previous video">⏮</button>
          <button type="button" class="media-btn" data-act="playpause" title="Pause" aria-label="Play or pause">⏸</button>
          <button type="button" class="media-btn" data-act="next" title="Next video" aria-label="Next video">⏭</button>
          <button type="button" class="media-btn" data-act="mute" title="Unmute" aria-label="Mute or unmute">🔇</button>
          <input class="media-volume" data-act="volume" type="range" min="0" max="1" step="0.05" value="${volume}" aria-label="Volume" />
          <a class="media-btn media-download" data-act="download" href="${dlUrl}" download title="Download video" aria-label="Download video">⬇ Download</a>
        </div>`
      : `
        <div class="media-controls poster-controls">
          <button type="button" class="media-btn" data-act="prev" title="Previous poster" aria-label="Previous poster">⏮</button>
          <button type="button" class="media-btn" data-act="next" title="Next poster" aria-label="Next poster">⏭</button>
          <a class="media-btn media-download" data-act="download" href="${dlUrl}" download title="Download poster" aria-label="Download poster">⬇ Download</a>
        </div>`;

    el.innerHTML = `
      ${mediaTag}
      <div class="media-caption">${item.title || ''}</div>
      <div class="media-dots">${items.map((_, i) => `<span class="${i === idx ? 'active' : ''}"></span>`).join('')}</div>
      ${controlsHtml}
    `;

    el.querySelector('[data-act="prev"]').addEventListener('click', goPrev);
    el.querySelector('[data-act="next"]').addEventListener('click', goNext);

    if (kind === 'video') {
      const v = el.querySelector('video');
      const playBtn = el.querySelector('[data-act="playpause"]');
      const muteBtn = el.querySelector('[data-act="mute"]');
      const volSlider = el.querySelector('[data-act="volume"]');

      v.muted = muted;
      v.volume = volume;
      muteBtn.textContent = muted ? '🔇' : '🔊';
      muteBtn.title = muted ? 'Unmute' : 'Mute';

      v.onended = advance;
      v.onplay = () => { playBtn.textContent = '⏸'; playBtn.title = 'Pause'; };
      v.onpause = () => { playBtn.textContent = '⏵'; playBtn.title = 'Play'; };

      playBtn.addEventListener('click', () => {
        if (v.paused) v.play(); else v.pause();
      });
      muteBtn.addEventListener('click', () => {
        muted = !muted;
        v.muted = muted;
        muteBtn.textContent = muted ? '🔇' : '🔊';
        muteBtn.title = muted ? 'Unmute' : 'Mute';
      });
      volSlider.addEventListener('input', (e) => {
        volume = parseFloat(e.target.value);
        v.volume = volume;
        if (volume > 0 && muted) {
          muted = false;
          v.muted = false;
          muteBtn.textContent = '🔊';
          muteBtn.title = 'Mute';
        }
      });
    } else {
      posterTimer = setTimeout(advance, 6000);
    }
  }

  function advance() {
    idx = (idx + 1) % items.length;
    if (kind === 'video') videoIndex = idx; else posterIndex = idx;
    render();
  }

  function goNext() {
    if (kind === 'poster') clearTimeout(posterTimer);
    advance();
  }

  function goPrev() {
    if (kind === 'poster') clearTimeout(posterTimer);
    idx = (idx - 1 + items.length) % items.length;
    if (kind === 'video') videoIndex = idx; else posterIndex = idx;
    render();
  }

  render();
}

async function refreshMedia() {
  if (!HAS_BACKEND) {
    setupLoop('videoLoop', [], 'video');
    setupLoop('posterLoop', [], 'poster');
    return;
  }
  try {
    const videos = await jget(`${API}/media?type=video`);
    const posters = await jget(`${API}/media?type=poster`);
    setupLoop('videoLoop', videos.filter((v) => v.active), 'video');
    setupLoop('posterLoop', posters.filter((p) => p.active), 'poster');
  } catch (e) {
    console.error(e);
  }
}

async function refreshHappenings() {
  const el = document.getElementById('happeningsFeed');
  if (!el || !HAS_BACKEND) return;
  try {
    renderHappenings(await jget(`${API}/happenings?limit=30`));
  } catch (e) {
    console.error(e);
  }
}

// Renders the congress agenda from the admin-editable itinerary_items table
// — grouped into one card per day, in the same order the admin panel's
// Itinerary tab lists them (sort_order, then id).
async function refreshItinerary() {
  const grid = document.getElementById('itineraryGrid');
  if (!grid) return;
  let items = [];
  try {
    if (!HAS_BACKEND) { grid.innerHTML = '<div class="empty">Itinerary is not available right now.</div>'; return; }
    items = await jget(`${API}/itinerary`);
  } catch (e) {
    console.error(e);
    grid.innerHTML = '<div class="empty">Itinerary is not available right now.</div>';
    return;
  }
  if (!items.length) {
    grid.innerHTML = '<div class="empty">Itinerary coming soon.</div>';
    return;
  }
  const days = [];
  const dayIndex = {};
  items.forEach((it) => {
    if (!(it.day_label in dayIndex)) {
      dayIndex[it.day_label] = days.length;
      days.push({ label: it.day_label, items: [] });
    }
    days[dayIndex[it.day_label]].items.push(it);
  });
  grid.innerHTML = days.map((day) => `
    <div class="card itin-day">
      <div class="itin-day-label">${escapeHtml(day.label)}</div>
      ${day.items.map((it) => `
        <div class="feed-item">
          <div class="time">${escapeHtml(it.time_label || '')}</div>
          <div class="title">${escapeHtml(it.title)}</div>
          ${it.description ? `<div class="desc">${escapeHtml(it.description)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `).join('');
}

function initials(name) {
  return String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
}

// Guest speakers — photo (or initials placeholder), name, role/org, topic.
// Uses /api/public/speakers (name/topic/photo only — no phone/email/notes;
// see server/routes/publicDirectory.js) so no login is required. Shows "TBA"
// when nothing's been added yet, rather than an empty section.
async function refreshSpeakersPublic() {
  const grid = document.getElementById('speakersGrid');
  if (!grid) return;
  let rows = [];
  try {
    if (!HAS_BACKEND) { grid.innerHTML = '<div class="empty">Speakers to be announced (TBA).</div>'; return; }
    rows = await jget(`${API}/public/speakers`);
  } catch (e) {
    console.error(e);
    grid.innerHTML = '<div class="empty">Speakers to be announced (TBA).</div>';
    return;
  }
  if (!rows.length) {
    grid.innerHTML = '<div class="empty">Speakers to be announced (TBA).</div>';
    return;
  }
  grid.innerHTML = rows.map((s) => {
    const roleLine = [s.designation, s.organization].filter(Boolean).map(escapeHtml).join(', ');
    return `
      <div class="card speaker-card">
        ${s.photo_url
          ? `<img class="avatar" src="${mediaUrl(s.photo_url)}" alt="${escapeHtml(s.name)}" />`
          : `<div class="avatar-placeholder">${escapeHtml(initials(s.name))}</div>`}
        <div class="name">${escapeHtml(s.name)}</div>
        ${roleLine ? `<div class="role">${roleLine}</div>` : ''}
        ${s.topic ? `<div class="topic">${escapeHtml(s.topic)}</div>` : ''}
      </div>
    `;
  }).join('');
}

// Sponsors — logo (or initials placeholder), name, tier. Uses
// /api/public/sponsors (name/tier/logo only) so no login is required. Shows
// "TBA" when nothing's been added yet.
async function refreshSponsorsPublic() {
  const grid = document.getElementById('sponsorsGrid');
  if (!grid) return;
  let rows = [];
  try {
    if (!HAS_BACKEND) { grid.innerHTML = '<div class="empty">Sponsors to be announced (TBA).</div>'; return; }
    rows = await jget(`${API}/public/sponsors`);
  } catch (e) {
    console.error(e);
    grid.innerHTML = '<div class="empty">Sponsors to be announced (TBA).</div>';
    return;
  }
  if (!rows.length) {
    grid.innerHTML = '<div class="empty">Sponsors to be announced (TBA).</div>';
    return;
  }
  grid.innerHTML = rows.map((s) => `
    <div class="card sponsor-card">
      ${s.logo_url
        ? `<img class="logo" src="${mediaUrl(s.logo_url)}" alt="${escapeHtml(s.name)}" />`
        : `<div class="logo-placeholder">${escapeHtml(s.name)}</div>`}
      <div class="name">${escapeHtml(s.name)}</div>
      ${s.tier ? `<div class="tier">${escapeHtml(s.tier)}</div>` : ''}
    </div>
  `).join('');
}

refreshMedia();
refreshHappenings();
refreshItinerary();
refreshSpeakersPublic();
refreshSponsorsPublic();
setInterval(refreshMedia, 5 * 60000); // re-check for newly uploaded media every 5 min without disrupting playback
setInterval(refreshHappenings, 30000);
setInterval(refreshItinerary, 5 * 60000);
setInterval(refreshSpeakersPublic, 5 * 60000);
setInterval(refreshSponsorsPublic, 5 * 60000);
