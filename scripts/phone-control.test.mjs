import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPhoneCommandRequestId,
  formatPhoneRelativeTime,
  getKioskForPhone,
  getPhoneKioskCountryCode,
  getPhoneConnectionState,
  isPhoneWebRtcActive,
  isPhoneAgentUpdateAvailable,
  isPhoneRemoteInputAvailable,
  phoneLocationMapUrls,
  phoneNetworkLabel,
  phoneSignalLevelFromDbm,
  phoneHotspotLabel,
  normalizePhoneDevice,
  normalizeAgentRelease,
  phoneMatchesSearch,
  phoneTimestampToMillis,
} from '../src/utils/phoneControl.js';
import {
  encodeGlobalActionPacket,
  encodePointerPacket,
  normalizePhoneWebRtcIceServers,
} from '../src/utils/phoneWebRtc.js';

test('validates the signed Agent release metadata used for updates', () => {
  const release = normalizeAgentRelease({
    packageName: 'com.chargerent.remoteagent',
    versionName: '1.2.0',
    versionCode: 15,
    apkUrl: 'https://chargerentstations.com/portal/mdm/remote-agent-v1.2.0.apk',
    apkSha256: 'A'.repeat(64),
  });
  assert.equal(release.versionCode, 15);
  assert.equal(release.apkSha256, 'a'.repeat(64));
  assert.throws(() => normalizeAgentRelease({
    ...release,
    packageName: 'com.chargerent.remoteagent',
    apkUrl: 'https://example.com/remote-agent-v1.2.0.apk',
  }), /approved Chargerent download location/);
});

test('detects Agent updates from version codes with semantic fallback', () => {
  assert.equal(isPhoneAgentUpdateAvailable(
    { agentVersion: '1.2.7', agentVersionCode: 22 },
    { versionName: '1.2.8', versionCode: 23 },
  ), true);
  assert.equal(isPhoneAgentUpdateAvailable(
    { agentVersion: '1.2.8', agentVersionCode: 23 },
    { versionName: '1.2.8', versionCode: 23 },
  ), false);
  assert.equal(isPhoneAgentUpdateAvailable(
    { agentVersion: '1.9.9' },
    { versionName: '2.0.0' },
  ), true);
  assert.equal(isPhoneAgentUpdateAvailable(
    { agentVersion: 'unknown' },
    { versionName: '2.0.0' },
  ), false);
});

test('normalizes kiosk assignment and Android inventory', () => {
  const device = normalizePhoneDevice({
    stationid: 'us0118',
    terminal: {
      enabled: true,
      state: 'ready',
      stationId: 'US0118',
      provisionId: 'provision-1',
      moduleId: 'module-1',
      stripeLocationId: 'tml_test',
      lockdownEnabled: true,
      lockdownState: 'locked',
    },
    lastSeenAt: { seconds: 1_000, nanoseconds: 500_000_000 },
    inventory: {
      manufacturer: 'Google',
      model: 'Pixel 6a',
      agentVersionCode: 15,
      batteryPercent: 84,
      isDeviceOwner: true,
      network: 'wifi',
      networkStatus: 'online',
      phoneNumber: '+33612345678',
      wifiSsid: 'OurHome',
      wifiSignalLevel: 4,
      wifiRssiDbm: -48,
      cellularCarrier: 'Example Mobile',
      cellularTechnology: '5G',
      cellularSignalLevel: 3,
      cellularSignalDbm: -92,
      commandEncryptionPublicKey: 'public-key',
      terminalPackageInstalled: true,
      terminalLockdownDesired: true,
      terminalLockdownPermitted: true,
      terminalLockdownActive: true,
      availableWifiNetworks: [{
        ssid: 'OurHome',
        security: 'wpa2_wpa3',
        signalLevel: 4,
        signalDbm: -48,
        band: '5 GHz',
        connected: true,
        joinSupported: true,
      }],
      hotspotSupported: true,
      hotspotControlGranted: true,
      hotspotAlwaysOn: true,
      hotspotActive: true,
      hotspotState: 'on',
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
  assert.equal(device.terminal.enabled, true);
  assert.equal(device.terminal.state, 'ready');
  assert.equal(device.terminal.provisionId, 'provision-1');
  assert.equal(device.terminal.lockdownState, 'locked');
  assert.equal(device.lastSeenAtMs, 1_000_500);
  assert.equal(device.inventory.model, 'Pixel 6a');
  assert.equal(device.inventory.agentVersionCode, 15);
  assert.equal(device.inventory.isDeviceOwner, true);
  assert.equal(device.inventory.wifiSsid, 'OurHome');
  assert.equal(device.inventory.phoneNumber, '+33612345678');
  assert.equal(device.inventory.networkStatus, 'online');
  assert.equal(device.inventory.wifiSignalLevel, 4);
  assert.equal(device.inventory.cellularTechnology, '5G');
  assert.equal(device.inventory.commandEncryptionReady, true);
  assert.equal(device.inventory.terminalPackageInstalled, true);
  assert.equal(device.inventory.terminalLockdownActive, true);
  assert.equal(device.inventory.availableWifiNetworks[0].security, 'wpa2_wpa3');
  assert.equal(device.inventory.hotspotActive, true);
  assert.equal(device.location.latitude, 45.5019);
  assert.equal(device.location.capturedAtMs, 1234);
});

test('uses the connected scan entry when Android redacts the Wi-Fi summary', () => {
  const device = normalizePhoneDevice({
    inventory: {
      network: 'wifi',
      networkStatus: 'online',
      networkValidated: true,
      wifiEnabled: true,
      wifiConnected: false,
      wifiSsid: '',
      availableWifiNetworks: [{
        ssid: 'OurHome',
        security: 'wpa2',
        signalLevel: 4,
        signalDbm: -37,
        frequencyMhz: 2452,
        band: '2.4 GHz',
        connected: true,
        joinSupported: true,
      }],
    },
  }, 'phone-redacted-wifi');

  assert.equal(device.inventory.wifiConnected, true);
  assert.equal(device.inventory.wifiValidated, true);
  assert.equal(device.inventory.wifiSsid, 'OurHome');
  assert.equal(device.inventory.wifiSignalLevel, 4);
  assert.equal(device.inventory.wifiRssiDbm, -37);
  assert.equal(device.inventory.wifiFrequencyMhz, 2452);
  assert.equal(device.inventory.wifiBand, '2.4 GHz');
  assert.equal(device.inventory.wifiSecurity, 'wpa2');
});

test('formats Wi-Fi names and safe OpenStreetMap links', () => {
  assert.equal(phoneNetworkLabel({ network: 'wifi', wifiSsid: 'OurHome' }), 'Wi-Fi · OurHome');
  assert.equal(phoneNetworkLabel({ network: 'cellular' }), 'Cellular');
  assert.equal(phoneHotspotLabel({
    hotspotSupported: true,
    hotspotControlGranted: true,
    hotspotAlwaysOn: true,
    hotspotActive: true,
  }), 'On · Always-on');
  assert.equal(phoneHotspotLabel({
    hotspotSupported: true,
    hotspotControlGranted: false,
    hotspotAlwaysOn: true,
  }), 'Permission needed');
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

test('derives signal bars from the displayed dBm value', () => {
  assert.equal(phoneSignalLevelFromDbm(-45, 'wifi'), 4);
  assert.equal(phoneSignalLevelFromDbm(-65, 'wifi'), 2);
  assert.equal(phoneSignalLevelFromDbm(-82, 'wifi'), 0);
  assert.equal(phoneSignalLevelFromDbm(-92, 'cellular'), 3);
  assert.equal(phoneSignalLevelFromDbm(null, 'cellular'), null);
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

test('expires stale WebRTC permission waits instead of leaving live screen starting', () => {
  const now = 50_000;
  assert.equal(isPhoneWebRtcActive({ state: 'awaiting_permission', expiresAt: now + 1_000 }, now), true);
  assert.equal(isPhoneWebRtcActive({ state: 'awaiting_permission', expiresAt: now - 1 }, now), false);
  assert.equal(isPhoneWebRtcActive({ state: 'stopped', expiresAt: now + 1_000 }, now), false);
});

test('uses current WebRTC input availability while heartbeat inventory catches up', () => {
  const now = 2_000_000;
  assert.equal(isPhoneRemoteInputAvailable({
    inventory: { remoteUiInputEnabled: false },
    screen: { webrtc: { state: 'connected', expiresAt: now + 60_000, inputAvailable: true } },
  }, now), true);
  assert.equal(isPhoneRemoteInputAvailable({
    inventory: { remoteUiInputEnabled: false },
    screen: { webrtc: { state: 'stopped', expiresAt: now + 60_000, inputAvailable: true } },
  }, now), false);
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

test('accepts only short-lived ICE configuration from the Chargerent relay', () => {
  const servers = normalizePhoneWebRtcIceServers({
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302'] },
      {
        urls: ['turns:turn.chargerentstations.com:5349?transport=tcp'],
        username: '1700000600:operator:nonce',
        credential: 'short-lived-credential',
      },
    ],
  });
  assert.equal(servers.length, 2);
  assert.equal(servers[1].username, '1700000600:operator:nonce');
  assert.throws(
    () => normalizePhoneWebRtcIceServers({
      iceServers: [{ urls: ['turns:example.com:5349'], username: 'u', credential: 'p' }],
    }),
    /Secure live connection is unavailable/,
  );
});
