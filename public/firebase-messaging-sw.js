// /public/firebase-messaging-sw.js
// ------------------------------------------------------
// Chargerent Unified Service Worker (Pure VAPID Version)
// ------------------------------------------------------

// ✅ Activate immediately and take control of clients
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
  console.log('[SW] Activated and controlling clients.');
});

// ------------------------------------------------------
// 1️⃣ Unified Push Notification Handler
// ------------------------------------------------------
self.addEventListener('push', async (event) => {
  console.log('[SW] Push event received.');

  // --- Optional Hard Filter: ignore stray Firebase or duplicate messages ---
  try {
    const rawText = event.data?.text?.() || '';
    if (rawText.includes('"FCM_MSG"') || rawText.includes('fcmOptions')) {
      console.log('[SW] Ignored Firebase synthetic duplicate push');
      return;
    }
  } catch (e) {
    console.warn('[SW] Hard filter check failed:', e);
  }

  // --- Parse incoming data safely ---
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    console.warn('[SW] Could not parse push data.');
  }

  const title = data?.notification?.title || data?.title || 'Chargerent Dashboard';
  const body = data?.notification?.body || data?.body || 'You have a new notification.';
  const key = `${title}:${body}`;

  // --- Prevent showing duplicates already visible ---
  const alreadyDisplayed = await self.registration.getNotifications().then((n) =>
    n.some((x) => x.title === title && x.body === body)
  );
  if (alreadyDisplayed) {
    console.log('[SW] Notification already displayed — skipping duplicate.');
    return;
  }

  // --- Skip rapid duplicates (within 4 seconds) ---
  if (self.lastPushKey === key && Date.now() - self.lastPushTime < 4000) {
    console.log('[SW] Rapid duplicate — skipping.');
    return;
  }
  self.lastPushKey = key;
  self.lastPushTime = Date.now();

  const icon = data?.notification?.icon || data?.icon || '/portal/logo.png';
  const image = data?.notification?.image;
  const clickUrl =
    data?.notification?.click_action ||
    data?.data?.url ||
    'https://chargerentstations.com/portal/';

  const options = {
    body,
    icon,
    image,
    badge: '/portal/pwa-192x192.png',
    vibrate: [200, 100, 200],
    requireInteraction: false,
    data: { url: clickUrl },
    tag: key, // Helps merge duplicates on Android
  };

  console.log('[SW] Showing notification:', title);
  event.waitUntil(self.registration.showNotification(title, options));
});

// ------------------------------------------------------
// 2️⃣ Notification Click Handler
// ------------------------------------------------------
self.addEventListener('notificationclick', event => {
  console.log('[SW] Notification click detected.');
  event.notification.close();

  const targetUrl = event.notification.data?.url || 'https://chargerentstations.com/portal/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/portal/') && 'focus' in client) {
          client.focus();
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

console.log('[SW] Registered successfully — Firebase-free version loaded.');
