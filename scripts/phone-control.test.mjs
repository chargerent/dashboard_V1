import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPhoneCommandRequestId,
  formatPhoneRelativeTime,
  getKioskForPhone,
  getPhoneKioskCountryCode,
  getPhoneConnectionState,
  phoneLocationMapUrls,
  phoneNetworkLabel,
  normalizePhoneDevice,
  phoneMatchesSearch,
  phoneTimestampToMillis,
} from '../src/utils/phoneControl.js';
import {
  encodeGlobalActionPacket,
  encodePointerPacket,
} from '../src/utils/phoneWebRtc.js';

test('normalizes kiosk assignment and Android inventory', () => {
  const device = normalizePhoneDevice({
    stationid: 'us0118',
    lastSeenAt: { seconds: 1_000, nanoseconds: 500_000_000 },
    inventory: {
      manufacturer: 'Google',
      model: 'Pixel 6a',
      batteryPercent: 84,
      isDeviceOwner: true,
      network: 'wifi',
      wifiSsid: 'OurHome',
    },
    location: {
      latitude: 45.5019,
      longitude: -73.5674,
      accuracyMeters: 18,
      capturedAt: 1234,
    },
  }, 'phone-1');

  assert.equal(device.id, 'phone-1');
  assert.equal(device.stationId, 'US0118');
  assert.equal(device.lastSeenAtMs, 1_000_500);
  assert.equal(device.inventory.model, 'Pixel 6a');
  assert.equal(device.inventory.isDeviceOwner, true);
  assert.equal(device.inventory.wifiSsid, 'OurHome');
  assert.equal(device.location.latitude, 45.5019);
  assert.equal(device.location.capturedAtMs, 1234);
});

test('formats Wi-Fi names and safe OpenStreetMap links', () => {
  assert.equal(phoneNetworkLabel({ network: 'wifi', wifiSsid: 'OurHome' }), 'Wi-Fi · OurHome');
  assert.equal(phoneNetworkLabel({ network: 'cellular' }), 'Cellular');
  const urls = phoneLocationMapUrls({
    latitude: 45.5019,
    longitude: -73.5674,
    accuracyMeters: 20,
  });
  assert.match(urls.embed, /^https:\/\/www\.openstreetmap\.org\/export\/embed\.html\?/);
  assert.match(urls.external, /mlat=45\.5019/);
  assert.equal(phoneLocationMapUrls({ latitude: 200, longitude: 0 }), null);
  assert.equal(phoneLocationMapUrls({ latitude: null, longitude: null }), null);
  assert.equal(phoneLocationMapUrls({ latitude: '', longitude: '' }), null);
});

test('keeps live screen session metadata in the normalized phone', () => {
  const device = normalizePhoneDevice({
    stationId: 'CA0042',
    screen: {
      dataUrl: 'data:image/jpeg;base64,frame',
      live: { active: true, expiresAt: 12345 },
    },
  }, 'phone-live');

  assert.equal(device.screen.live.active, true);
  assert.equal(device.screen.live.expiresAt, 12345);
});

test('computes connection status and relative time', () => {
  const now = 1_000_000;
  assert.equal(getPhoneConnectionState({ lastSeenAtMs: now - 20_000 }, now), 'online');
  assert.equal(getPhoneConnectionState({ lastSeenAtMs: now - 120_000 }, now), 'offline');
  assert.equal(formatPhoneRelativeTime(now - 65_000, now), '1m ago');
  assert.equal(formatPhoneRelativeTime(0, now), 'Never connected');
});

test('joins and searches using kiosk context', () => {
  const device = normalizePhoneDevice({ stationId: 'CA0042', inventory: { model: 'Pixel 6a' } }, 'phone-2');
  const kiosks = [{ stationid: 'CA0042', info: { location: 'Convention Center', client: 'Example' } }];
  const kiosk = getKioskForPhone(device, kiosks);

  assert.equal(kiosk.info.location, 'Convention Center');
  assert.equal(phoneMatchesSearch(device, kiosk, 'example'), true);
  assert.equal(phoneMatchesSearch(device, kiosk, 'pixel'), true);
  assert.equal(phoneMatchesSearch(device, kiosk, 'missing'), false);
});

test('creates scoped request ids and accepts Firestore timestamp shapes', () => {
  const requestId = createPhoneCommandRequestId('GET_INVENTORY', 'Device 123', 42);
  assert.match(requestId, /^phone-get-inventory-device-123-42-[a-z0-9]+$/);
  assert.equal(phoneTimestampToMillis({ toMillis: () => 1234 }), 1234);
});

test('resolves enrollment kiosk countries from explicit data and station prefixes', () => {
  assert.equal(getPhoneKioskCountryCode({ stationid: 'CA0042', info: {} }), 'CA');
  assert.equal(getPhoneKioskCountryCode({ stationid: 'OTHER', info: { country: 'France' } }), 'FR');
  assert.equal(getPhoneKioskCountryCode({ stationId: 'US0118', country: 'USA' }), 'US');
  assert.equal(getPhoneKioskCountryCode({ stationid: 'XX0001' }), '');
});

test('encodes the versioned binary WebRTC control protocol', () => {
  const pointer = new DataView(encodePointerPacket('move', 0.5, 0.25, 32));
  assert.equal(pointer.byteLength, 9);
  assert.equal(pointer.getUint8(0), 1);
  assert.equal(pointer.getUint8(1), 1);
  assert.equal(pointer.getUint8(2), 1);
  assert.equal(pointer.getUint16(3), 32768);
  assert.equal(pointer.getUint16(5), 16384);
  assert.equal(pointer.getUint16(7), 32);

  assert.deepEqual(
    [...new Uint8Array(encodeGlobalActionPacket('HOME'))],
    [1, 2, 2],
  );
});
