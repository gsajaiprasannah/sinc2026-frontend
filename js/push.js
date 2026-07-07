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

  async function registerSW() {
    if (!('serviceWorker' in navigator)) return null;
    return navigator.serviceWorker.register('sw.js');
  }

  async function currentSubscription() {
    if (!isSupported()) return null;
    const reg = await navigator.serviceWorker.ready;
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
    await registerSW();
    const keyRes = await fetch(`${API}/push/public-key`);
    const keyData = await keyRes.json();
    if (!keyData.enabled || !keyData.publicKey) {
      throw new Error('Push notifications aren\'t set up on the server yet — ask an admin to configure them.');
    }
    const reg = await navigator.serviceWorker.ready;
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
