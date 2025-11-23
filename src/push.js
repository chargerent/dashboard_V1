// src/services/pushService.js (hardened)
const vapidPublicKey =
  'BMOw3aaR4-R1Uu581diixzCs3cAn1rtZSB51SRHqvt7DkjaPP_AfNhJfAzFFfwGCnTAguyednA4KRzfGJxSG2tI';

let isSubscribing = false;

export async function subscribeUserToPush(clientId) {
  if (isSubscribing) {
    console.log('[Push] Subscription process already in progress. Skipping.');
    return;
  }
  isSubscribing = true;

  try {
    console.log('[Push] Attempting to subscribe to push notifications...');

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[Push] Push messaging is not supported.');
      return;
    }

    const deviceId = await getOrCreateDeviceId();
    console.log('[Push] Using deviceId:', deviceId);

    // 1) make sure SW is registered (but don’t re-register if already there)
    const existingRegs = await navigator.serviceWorker.getRegistrations();
    const alreadyRegistered = existingRegs.some(r => r.scope.endsWith('/portal/'));

    if (!alreadyRegistered) {
      await navigator.serviceWorker.register('/portal/firebase-messaging-sw.js', { scope: '/portal/' });
      console.log('[Push] Service Worker registered for /portal/');
    } else {
      console.log('[Push] SW already registered for /portal/');
    }

    const readyRegistration = await navigator.serviceWorker.ready;

    // 2) get or create subscription
    let subscription = await readyRegistration.pushManager.getSubscription();
    if (!subscription) {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('[Push] Notification permission denied:', permission);
        return;
      }
      const convertedKey = urlBase64ToUint8Array(vapidPublicKey);
      subscription = await readyRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey,
      });
      console.log('[Push] New subscription created:', subscription.endpoint);
    } else {
      console.log('[Push] Already subscribed:', subscription.endpoint);
    }

    // 3) SEND TO BACKEND **ONLY IF** endpoint changed
    const subJson = subscription.toJSON();
    const currentEndpoint = subJson?.endpoint;
    const lastSentEndpoint = localStorage.getItem('lastPushEndpoint');
    const lastSentDevice = localStorage.getItem('lastPushDeviceId');

    if (currentEndpoint === lastSentEndpoint && deviceId === lastSentDevice) {
      console.log('[Push] Endpoint already sent to backend — skipping POST.');
      return subscription;
    }

    const apiUrl = 'https://chargerentstations.com/api/push/subscribe';
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: subJson,
        clientId,
        deviceId,
      }),
    });

    if (!res.ok) throw new Error(`Subscription POST failed: ${res.status}`);
    console.log('[Push] Subscription successfully sent to backend.');

    // remember
    localStorage.setItem('lastPushEndpoint', currentEndpoint);
    localStorage.setItem('lastPushDeviceId', deviceId);

    return subscription;
  } catch (err) {
    console.error('[Push] Subscription failed:', err);
  } finally {
    isSubscribing = false;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

export function getOrCreateDeviceId() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('device-id-db', 1);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('device-store')) {
        db.createObjectStore('device-store', { keyPath: 'key' });
      }
    };

    request.onerror = (event) => {
      console.error('[Push] Error opening IndexedDB for deviceId', event);
      reject('Error opening IndexedDB for deviceId');
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      const tx = db.transaction(['device-store'], 'readwrite');
      const store = tx.objectStore('device-store');
      const getReq = store.get('deviceId');

      getReq.onsuccess = () => {
        let id = getReq.result?.value;
        if (!id) {
          id = crypto.randomUUID();
          store.put({ key: 'deviceId', value: id });
          localStorage.setItem('deviceId', id);
        } else {
          localStorage.setItem('deviceId', id);
        }
        resolve(id);
      };
    };
  });
}

window.subscribeUserToPush = subscribeUserToPush;
