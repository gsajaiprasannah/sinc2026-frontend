// Shared Web Push helper — included on login.html and admin.html. Exposes
// window.SincPush for that page's own script (login.js / admin.js) to wire
// up an "Enable notifications" button. Assumes the including page already
// defines a getToken() function (both login.js and admin.js do, each with
// their own token key) so the subscribe/unsubscribe calls are authenticated
// as whichever role is currently logged in.
(function () {
  const API = ((window.SINC_CONFIG && window.SINC_CONFIG.API_BASE_URL) || '/api').replace(/\/$/, '');

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const out = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
    return out;
  }

  function authHeaders() {
    const token = (typeof getToken === 'function') ? getToken() : '';
    const h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  function isSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  // Cache the registration promise so we only ever call register() once,
  // and kick it off eagerly (below) rather than waiting for the user's
  // first click — this way a registration already exists by the time
  // anything needs it.
  let swRegistrationPromise = null;
  function registerSW() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    if (!swRegistrationPromise) swRegistrationPromise = navigator.serviceWorker.register('sw.js');
    return swRegistrationPromise;
  }
  if (isSupported()) registerSW().catch((e) => console.error('Service worker registration failed', e));

  async function currentSubscription() {
    if (!isSupported()) return null;
    // Deliberately NOT navigator.serviceWorker.ready — that promise only
    // resolves once a service worker is ACTIVE for this page, and on a
    // brand new visit (nothing registered yet) it never resolves at all,
    // hanging forever with no error and no visible effect whatsoever. That
    // silent hang is exactly what broke "Enable notifications" on every
    // browser on first use. getRegistration() resolves immediately —
    // undefined if nothing's registered yet — so this can never hang.
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    return reg.pushManager.getSubscription();
  }

  async function isSubscribed() {
    const sub = await currentSubscription();
    return !!sub;
  }

  async function enable() {
    if (!isSupported()) throw new Error('Push notifications are not supported in this browser.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission was not granted.');
    const reg = await registerSW();
    const keyRes = await fetch(`${API}/push/public-key`);
    const keyData = await keyRes.json();
    if (!keyData.enabled || !keyData.publicKey) {
      throw new Error('Push notifications aren\'t set up on the server yet — ask an admin to configure them.');
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
    });
    const r = await fetch(`${API}/push/subscribe`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(sub.toJSON()) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Could not save the subscription.'); }
    return true;
  }

  async function disable() {
    const sub = await currentSubscription();
    if (!sub) return true;
    await fetch(`${API}/push/subscribe`, { method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
    return true;
  }

  window.SincPush = { isSupported, registerSW, isSubscribed, enable, disable };
})();
