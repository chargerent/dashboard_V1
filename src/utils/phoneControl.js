const PHONE_ONLINE_WINDOW_MS = 90 * 1000;
const ACTIVE_PHONE_WEBRTC_STATES = new Set([
  'awaiting_permission',
  'starting',
  'connecting',
  'connected',
  'disconnected',
]);

export const PHONE_KIOSK_COUNTRIES = [
  { code: 'CA', label: 'Canada' },
  { code: 'FR', label: 'France' },
  { code: 'US', label: 'US' },
];

export function getPhoneStationCountryCode(stationId) {
  return String(stationId || '').trim().toUpperCase().match(/^(CA|FR|US)/)?.[1] || '';
}

export const HIGH_IMPACT_PHONE_OPERATIONS = new Set([
  'REBOOT',
  'POWER_OFF',
  'REQUEST_BUGREPORT',
  'SET_UPDATE_POLICY',
  'INSTALL_SYSTEM_UPDATE',
  'INSTALL_APP_UPDATE',
  'INSTALL_PAYMENT_APP',
  'WIPE_DEVICE',
]);

export function phoneSignalLevelFromDbm(value, type = 'wifi') {
  if (value === null || value === undefined || value === '') return null;
  const dbm = Number(value);
  if (!Number.isFinite(dbm)) return null;
  const thresholds = String(type).toLowerCase() === 'cellular'
    ? [-115, -105, -95, -85]
    : [-80, -70, -60, -50];
  return thresholds.reduce((level, threshold) => (dbm >= threshold ? level + 1 : level), 0);
}

const AGENT_RELEASE_ORIGIN = 'https://chargerentstations.com';

export function normalizeAgentRelease(metadata = {}) {
  let apkUrl;
  try {
    apkUrl = new URL(String(metadata.apkUrl || '').trim());
  } catch {
    throw new Error('The Agent release URL is invalid.');
  }
  if (apkUrl.origin !== AGENT_RELEASE_ORIGIN || apkUrl.search || apkUrl.hash ||
      !/^\/portal\/mdm\/remote-agent-v\d+\.\d+\.\d+\.apk$/.test(apkUrl.pathname)) {
    throw new Error('The Agent release is not from the approved Chargerent download location.');
  }

  const versionName = String(metadata.versionName || '').trim();
  const versionCode = Number(metadata.versionCode);
  const apkSha256 = String(metadata.apkSha256 || '').trim().toLowerCase();
  if (String(metadata.packageName || '') !== 'com.chargerent.remoteagent' ||
      !/^\d+\.\d+\.\d+$/.test(versionName) ||
      !Number.isSafeInteger(versionCode) || versionCode < 1 ||
      !/^[0-9a-f]{64}$/.test(apkSha256)) {
    throw new Error('The Agent release information is incomplete.');
  }
  return {
    versionName,
    versionCode,
    apkUrl: apkUrl.toString(),
    apkSha256,
  };
}

export function normalizePaymentAppRelease(metadata = {}) {
  let apkUrl;
  try {
    apkUrl = new URL(String(metadata.apkUrl || '').trim());
  } catch {
    throw new Error('The payment app release URL is invalid.');
  }
  if (apkUrl.origin !== AGENT_RELEASE_ORIGIN || apkUrl.search || apkUrl.hash ||
      !/^\/portal\/mdm\/chargerent-payment-v\d+\.\d+\.\d+(?:-[a-z0-9-]+)?\.apk$/.test(apkUrl.pathname)) {
    throw new Error('The payment app release is not from the approved Chargerent download location.');
  }

  const packageName = String(metadata.packageName || '').trim();
  const versionName = String(metadata.versionName || '').trim();
  const versionCode = Number(metadata.versionCode);
  const apkSha256 = String(metadata.apkSha256 || '').trim().toLowerCase();
  if (!/^com\.chargerent\.kiosk(?:\.[A-Za-z0-9_]+)*$/.test(packageName) ||
      !/^\d+\.\d+\.\d+(?:-[a-z0-9-]+)?$/.test(versionName) ||
      !Number.isSafeInteger(versionCode) || versionCode < 1 ||
      !/^[0-9a-f]{64}$/.test(apkSha256)) {
    throw new Error('The payment app release information is incomplete.');
  }
  return {
    packageName,
    versionName,
    versionCode,
    apkUrl: apkUrl.toString(),
    apkSha256,
  };
}

export function isPhoneAgentUpdateAvailable(inventory = {}, release = {}) {
  const installedVersionCode = Number(inventory.agentVersionCode);
  const releaseVersionCode = Number(release.versionCode);
  if (Number.isSafeInteger(installedVersionCode) && installedVersionCode > 0 &&
      Number.isSafeInteger(releaseVersionCode) && releaseVersionCode > 0) {
    return installedVersionCode < releaseVersionCode;
  }

  const installedParts = String(inventory.agentVersion || '').trim().split('.').map(Number);
  const releaseParts = String(release.versionName || '').trim().split('.').map(Number);
  if (installedParts.length !== 3 || releaseParts.length !== 3 ||
      installedParts.some((part) => !Number.isSafeInteger(part) || part < 0) ||
      releaseParts.some((part) => !Number.isSafeInteger(part) || part < 0)) {
    return false;
  }

  for (let index = 0; index < releaseParts.length; index += 1) {
    if (installedParts[index] !== releaseParts[index]) {
      return installedParts[index] < releaseParts[index];
    }
  }
  return false;
}

export function phoneTimestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && Number.isFinite(Number(value.seconds))) {
    return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isPhoneWebRtcActive(webRtc = {}, now = Date.now()) {
  return ACTIVE_PHONE_WEBRTC_STATES.has(String(webRtc.state || '')) &&
    phoneTimestampToMillis(webRtc.expiresAt) > now;
}

export function isPhoneRemoteInputAvailable(device = {}, now = Date.now()) {
  if (device?.inventory?.remoteUiInputEnabled === true) return true;
  const webRtc = device?.screen?.webrtc || {};
  return webRtc.inputAvailable === true && isPhoneWebRtcActive(webRtc, now);
}

export function phoneLineNumberKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : '';
}

export function normalizePhoneDevice(rawDevice = {}, documentId = '') {
  const inventory = rawDevice.inventory && typeof rawDevice.inventory === 'object'
    ? rawDevice.inventory
    : {};
  const stationId = String(
    rawDevice.stationId || rawDevice.stationid || rawDevice.assignment?.stationId || '',
  ).trim().toUpperCase();
  const market = String(rawDevice.market || getPhoneStationCountryCode(stationId) || '')
    .trim().toUpperCase();
  const lastSeenAtMs = phoneTimestampToMillis(
    rawDevice.lastSeenAt || rawDevice.heartbeatAt || inventory.collectedAt,
  );
  const rawLocation = rawDevice.location && typeof rawDevice.location === 'object'
    ? rawDevice.location
    : {};
  const rawTerminal = rawDevice.terminal && typeof rawDevice.terminal === 'object'
    ? rawDevice.terminal
    : {};
  const latitude = Number(rawLocation.latitude);
  const longitude = Number(rawLocation.longitude);
  const hasCoordinates = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  const availableWifiNetworks = (Array.isArray(inventory.availableWifiNetworks)
    ? inventory.availableWifiNetworks
    : [])
    .flatMap((network) => {
      if (!network || typeof network !== 'object' || Array.isArray(network)) return [];
      const ssid = String(network.ssid || '').trim();
      if (!ssid) return [];
      const signalLevel = Number(network.signalLevel);
      const signalDbm = Number(network.signalDbm);
      const frequencyMhz = Number(network.frequencyMhz);
      return [{
        ssid,
        security: String(network.security || 'unknown').trim().toLowerCase(),
        signalLevel: Number.isFinite(signalLevel) ? Math.max(0, Math.min(4, signalLevel)) : null,
        signalDbm: Number.isFinite(signalDbm) ? signalDbm : null,
        frequencyMhz: Number.isFinite(frequencyMhz) ? frequencyMhz : null,
        band: String(network.band || '').trim(),
        connected: network.connected === true,
        joinSupported: network.joinSupported === true,
      }];
    })
    .slice(0, 20);

  const optionalNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };
  const connectedWifiNetwork = availableWifiNetworks.find((network) => network.connected) || null;
  const activeNetworkIsWifi = String(inventory.network || '').trim().toLowerCase() === 'wifi';
  const wifiSsid = String(inventory.wifiSsid || connectedWifiNetwork?.ssid || '').trim();
  const wifiConnected = inventory.wifiConnected === true || activeNetworkIsWifi || Boolean(connectedWifiNetwork);
  const wifiMetric = (inventoryValue, connectedValue) => (
    optionalNumber(inventoryValue) ?? optionalNumber(connectedValue)
  );
  const currentAgentPhoneNumber = String(inventory.phoneNumber || '').trim();
  const retainedAgentPhoneNumber = String(rawDevice.reportedPhoneNumber || '').trim();
  const agentPhoneNumber = currentAgentPhoneNumber || retainedAgentPhoneNumber;
  const manualPhoneNumber = String(rawDevice.manualPhoneNumber || '').trim();
  const effectivePhoneNumber = agentPhoneNumber || manualPhoneNumber;
  const batteryPercent = optionalNumber(inventory.batteryPercent);

  return {
    id: String(rawDevice.deviceId || documentId || '').trim(),
    stationId,
    assignmentState: stationId ? 'assigned' : 'unassigned',
    market,
    displayName: String(rawDevice.displayName || rawDevice.name || '').trim(),
    enrollmentState: String(rawDevice.enrollmentState || rawDevice.status || 'pending').toLowerCase(),
    lastSeenAtMs,
    lastSeenAt: rawDevice.lastSeenAt || rawDevice.heartbeatAt || null,
    lastCommand: rawDevice.lastCommand || null,
    phoneLine: {
      number: effectivePhoneNumber,
      key: phoneLineNumberKey(effectivePhoneNumber),
      source: agentPhoneNumber ? 'agent' : manualPhoneNumber ? 'manual' : '',
      agentNumber: agentPhoneNumber,
      manualNumber: manualPhoneNumber,
      reportedAtMs: phoneTimestampToMillis(rawDevice.reportedPhoneNumberAt),
      manualUpdatedAtMs: phoneTimestampToMillis(rawDevice.manualPhoneNumberUpdatedAt),
    },
    screen: rawDevice.screen && typeof rawDevice.screen === 'object' ? rawDevice.screen : {},
    terminal: {
      enabled: rawTerminal.enabled === true,
      state: String(rawTerminal.state || (rawTerminal.enabled ? 'pending' : 'disabled')).trim().toLowerCase(),
      stationId: String(rawTerminal.stationId || '').trim().toUpperCase(),
      provisionId: String(rawTerminal.provisionId || '').trim(),
      moduleId: String(rawTerminal.moduleId || '').trim(),
      stripeLocationId: String(rawTerminal.stripeLocationId || '').trim(),
      stripeAccountCountry: String(rawTerminal.stripeAccountCountry || '').trim().toUpperCase(),
      stripeMode: String(rawTerminal.stripeMode || '').trim().toLowerCase(),
      packageName: String(rawTerminal.packageName || '').trim(),
      lockdownEnabled: rawTerminal.lockdownEnabled === true,
      lockdownState: String(rawTerminal.lockdownState ||
        (rawTerminal.lockdownEnabled ? 'pending' : 'unlocked')).trim().toLowerCase(),
      message: String(rawTerminal.message || '').trim(),
      updatedAtMs: phoneTimestampToMillis(rawTerminal.updatedAt),
    },
    location: {
      latitude: hasCoordinates ? latitude : null,
      longitude: hasCoordinates ? longitude : null,
      accuracyMeters: Number.isFinite(Number(rawLocation.accuracyMeters))
        ? Number(rawLocation.accuracyMeters)
        : null,
      altitudeMeters: Number.isFinite(Number(rawLocation.altitudeMeters))
        ? Number(rawLocation.altitudeMeters)
        : null,
      provider: String(rawLocation.provider || '').trim(),
      source: String(rawLocation.source || '').trim(),
      stale: rawLocation.stale === true,
      capturedAtMs: phoneTimestampToMillis(rawLocation.capturedAt),
      receivedAtMs: phoneTimestampToMillis(rawLocation.receivedAt),
    },
    inventory: {
      manufacturer: String(inventory.manufacturer || '').trim(),
      model: String(inventory.model || rawDevice.model || 'Android phone').trim(),
      androidVersion: String(inventory.androidVersion || '').trim(),
      securityPatch: String(inventory.securityPatch || '').trim(),
      systemUpdatePolicy: String(inventory.systemUpdatePolicy || 'unknown').trim().toLowerCase(),
      systemUpdateWindowActive: inventory.systemUpdateWindowActive === true,
      systemUpdateWindowStartedAt: phoneTimestampToMillis(inventory.systemUpdateWindowStartedAt),
      systemUpdateWindowExpiresAt: phoneTimestampToMillis(inventory.systemUpdateWindowExpiresAt),
      systemUpdatePending: inventory.systemUpdatePending === true,
      systemUpdateReceivedAt: phoneTimestampToMillis(inventory.systemUpdateReceivedAt),
      agentVersion: String(inventory.agentVersion || rawDevice.agentVersion || '').trim(),
      agentVersionCode: Number.isSafeInteger(Number(inventory.agentVersionCode))
        ? Number(inventory.agentVersionCode)
        : 0,
      batteryPercent: batteryPercent !== null && batteryPercent >= 0 && batteryPercent <= 100
        ? batteryPercent
        : null,
      batteryCharging: inventory.batteryCharging === true,
      batteryPowerConnected: inventory.batteryPowerConnected === true
        ? true
        : inventory.batteryPowerConnected === false
          ? false
          : inventory.batteryCharging === true,
      batteryPowerSource: String(inventory.batteryPowerSource || '').trim().toLowerCase(),
      batteryProtectionEnabled: inventory.batteryProtectionEnabled === true,
      batteryProtectionThresholdPercent: optionalNumber(
        inventory.batteryProtectionThresholdPercent,
      ),
      batteryProtectionShutdownLatched: inventory.batteryProtectionShutdownLatched === true,
      batteryProtectionLowUnpluggedSince: phoneTimestampToMillis(
        inventory.batteryProtectionLowUnpluggedSince,
      ),
      batteryProtectionLastAttemptAt: phoneTimestampToMillis(
        inventory.batteryProtectionLastAttemptAt,
      ),
      network: String(inventory.network || 'offline').toLowerCase(),
      networkStatus: String(inventory.networkStatus || '').trim().toLowerCase(),
      networkValidated: inventory.networkValidated === true,
      networkCaptivePortal: inventory.networkCaptivePortal === true,
      phoneNumber: String(inventory.phoneNumber || '').trim(),
      wifiSsid,
      wifiEnabled: inventory.wifiEnabled === true,
      wifiConnected,
      wifiValidated: inventory.wifiValidated === true || (
        wifiConnected && activeNetworkIsWifi && inventory.networkValidated === true
      ),
      wifiCaptivePortal: inventory.wifiCaptivePortal === true || (
        wifiConnected && activeNetworkIsWifi && inventory.networkCaptivePortal === true
      ),
      wifiRssiDbm: wifiMetric(inventory.wifiRssiDbm, connectedWifiNetwork?.signalDbm),
      wifiSignalLevel: wifiMetric(inventory.wifiSignalLevel, connectedWifiNetwork?.signalLevel),
      wifiFrequencyMhz: wifiMetric(inventory.wifiFrequencyMhz, connectedWifiNetwork?.frequencyMhz),
      wifiBand: String(inventory.wifiBand || connectedWifiNetwork?.band || '').trim(),
      wifiLinkSpeedMbps: optionalNumber(inventory.wifiLinkSpeedMbps),
      wifiStandard: String(inventory.wifiStandard || '').trim(),
      wifiSecurity: String(inventory.wifiSecurity || connectedWifiNetwork?.security || '').trim().toLowerCase(),
      cellularCarrier: String(inventory.cellularCarrier || '').trim(),
      cellularTechnology: String(inventory.cellularTechnology || '').trim(),
      cellularDataConnected: inventory.cellularDataConnected === true,
      cellularSignalLevel: optionalNumber(inventory.cellularSignalLevel),
      cellularSignalDbm: optionalNumber(inventory.cellularSignalDbm),
      availableWifiNetworks,
      availableWifiScannedAt: phoneTimestampToMillis(inventory.availableWifiScannedAt),
      commandEncryptionReady: Boolean(String(inventory.commandEncryptionPublicKey || '').trim()),
      terminalPackageInstalled: inventory.terminalPackageInstalled === true,
      terminalPackageVersionName: String(inventory.terminalPackageVersionName || '').trim(),
      terminalPackageVersionCode: optionalNumber(inventory.terminalPackageVersionCode),
      terminalLockdownDesired: inventory.terminalLockdownDesired === true,
      terminalLockdownPermitted: inventory.terminalLockdownPermitted === true,
      terminalLockdownActive: inventory.terminalLockdownActive === true,
      hotspotSupported: inventory.hotspotSupported === true,
      hotspotControlMode: String(
        inventory.hotspotControlMode ||
        (inventory.hotspotSupported === true ? 'android_api' : 'unavailable'),
      ).trim().toLowerCase(),
      hotspotControlGranted: inventory.hotspotControlGranted === true,
      hotspotAlwaysOn: inventory.hotspotAlwaysOn === true,
      hotspotActive: inventory.hotspotActive === true,
      hotspotState: String(inventory.hotspotState || 'unknown').trim().toLowerCase(),
      hotspotLastError: String(inventory.hotspotLastError || '').trim(),
      hotspotUpdatedAt: phoneTimestampToMillis(inventory.hotspotUpdatedAt),
      bluetoothEnabled: inventory.bluetoothEnabled === true,
      locationEnabled: inventory.locationEnabled === true,
      remoteUiInputEnabled: inventory.remoteUiInputEnabled === true,
      isDeviceOwner: inventory.isDeviceOwner === true,
      storageAvailableBytes: Number(inventory.storageAvailableBytes || 0),
      storageTotalBytes: Number(inventory.storageTotalBytes || 0),
    },
    raw: rawDevice,
  };
}

export function getPhoneConnectionState(device, now = Date.now()) {
  if (!device?.lastSeenAtMs) return 'never';
  return now - device.lastSeenAtMs <= PHONE_ONLINE_WINDOW_MS ? 'online' : 'offline';
}

export function getPhonePowerState(device, now = Date.now()) {
  if (getPhoneConnectionState(device, now) !== 'online') return 'offline';
  return device?.inventory?.batteryPowerConnected === true ? 'powered' : 'unplugged';
}

export function summarizePhoneLines(devices = [], now = Date.now()) {
  const linesByNumber = new Map();
  let unavailableCount = 0;

  devices.forEach((device) => {
    const key = phoneLineNumberKey(device?.phoneLine?.number);
    if (!key) {
      unavailableCount += 1;
      return;
    }
    const existing = linesByNumber.get(key) || {
      key,
      number: device.phoneLine.number,
      devices: [],
      live: false,
    };
    existing.devices.push(device);
    existing.live = existing.live || getPhoneConnectionState(device, now) === 'online';
    linesByNumber.set(key, existing);
  });

  const lines = [...linesByNumber.values()];
  return {
    lines,
    lineCount: lines.length,
    liveCount: lines.filter((line) => line.live).length,
    offlineCount: lines.filter((line) => !line.live).length,
    unavailableCount,
    duplicateCount: lines.filter((line) => line.devices.length > 1).length,
  };
}

export function phoneMatchesSearch(device, kiosk, searchTerm) {
  const needle = String(searchTerm || '').trim().toLowerCase();
  if (!needle) return true;

  return [
    device?.stationId,
    device?.market,
    device?.displayName,
    device?.id,
    device?.inventory?.manufacturer,
    device?.inventory?.model,
    device?.phoneLine?.number,
    device?.inventory?.wifiSsid,
    kiosk?.info?.location,
    kiosk?.info?.place,
    kiosk?.info?.client,
    kiosk?.info?.account,
  ].some((value) => String(value || '').toLowerCase().includes(needle));
}

export function phoneNetworkLabel(inventory = {}) {
  const network = String(inventory.network || 'offline').trim().toLowerCase();
  const wifiSsid = String(inventory.wifiSsid || '').trim();
  if (network === 'wifi') return wifiSsid ? `Wi-Fi · ${wifiSsid}` : 'Wi-Fi';
  return network ? network.charAt(0).toUpperCase() + network.slice(1) : 'Offline';
}

export function phoneKioskPlaceLabel(kiosk = {}) {
  const labels = [kiosk?.info?.place, kiosk?.info?.location]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return labels.filter((label, index) => (
    labels.findIndex((candidate) => candidate.toLowerCase() === label.toLowerCase()) === index
  )).join(' · ');
}

export function phoneHotspotLabel(inventory = {}) {
  const mode = String(inventory.hotspotControlMode || '').trim().toLowerCase();
  const compatibility = mode === 'settings_automation';
  if (inventory.hotspotSupported !== true || mode === 'unavailable') return 'Control unavailable';
  if (inventory.hotspotControlGranted !== true) {
    return compatibility ? 'Remote UI needed' : 'Permission needed';
  }
  if (inventory.hotspotActive === true) {
    if (compatibility) return inventory.hotspotAlwaysOn === true
      ? 'Last confirmed on'
      : 'On · Settings control';
    return inventory.hotspotAlwaysOn === true ? 'On · Always-on' : 'On';
  }
  if (inventory.hotspotAlwaysOn !== true) {
    return compatibility ? 'Off · Settings control' : 'Disabled';
  }
  const state = String(inventory.hotspotState || '').trim().toLowerCase();
  if (state === 'starting') return compatibility ? 'Starting through Settings' : 'Starting';
  if (state === 'retrying') return compatibility ? 'Compatibility recovery' : 'Retrying';
  return compatibility ? 'Waiting for Settings' : 'Waiting to start';
}

export function phoneHotspotControlLabel(inventory = {}) {
  const mode = String(inventory.hotspotControlMode || '').trim().toLowerCase();
  if (mode === 'android_api') return 'Direct Android control';
  if (mode === 'settings_automation') return 'Compatibility control';
  return 'Manual hotspot control';
}

export function phoneLocationMapUrls(location = {}) {
  if (location.latitude == null || location.latitude === '' ||
      location.longitude == null || location.longitude === '') return null;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;

  const accuracy = Math.max(0, Number(location.accuracyMeters || 0));
  const latitudeDelta = Math.max(0.004, Math.min(0.08, accuracy / 111_000 * 4));
  const longitudeScale = Math.max(0.2, Math.cos(latitude * Math.PI / 180));
  const longitudeDelta = Math.min(0.12, latitudeDelta / longitudeScale);
  const bbox = [
    longitude - longitudeDelta,
    latitude - latitudeDelta,
    longitude + longitudeDelta,
    latitude + latitudeDelta,
  ].map((value) => value.toFixed(6)).join(',');
  const marker = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  return {
    embed: `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(marker)}`,
    external: `https://www.openstreetmap.org/?mlat=${encodeURIComponent(latitude)}&mlon=${encodeURIComponent(longitude)}#map=16/${encodeURIComponent(latitude)}/${encodeURIComponent(longitude)}`,
  };
}

export function formatPhoneRelativeTime(timestampMs, now = Date.now()) {
  if (!timestampMs) return 'Never connected';
  const elapsedSeconds = Math.max(0, Math.round((now - timestampMs) / 1000));
  if (elapsedSeconds < 10) return 'Just now';
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.round(elapsedHours / 24)}d ago`;
}

export function createPhoneCommandRequestId(operation, deviceId, now = Date.now()) {
  const operationPart = String(operation || 'command').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const devicePart = String(deviceId || 'device').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 18);
  const randomPart = Math.random().toString(36).slice(2, 9);
  return `phone-${operationPart}-${devicePart}-${now}-${randomPart}`;
}

export function getKioskForPhone(device, kiosks = []) {
  if (!device?.stationId) return null;
  return kiosks.find((kiosk) => (
    String(kiosk?.stationid || kiosk?.stationId || '').trim().toUpperCase() === device.stationId
  )) || null;
}

export function getPhoneKioskCountryCode(kiosk) {
  const explicitCountry = String(kiosk?.info?.country || kiosk?.country || '')
    .trim()
    .toUpperCase();
  const countryAliases = {
    CA: 'CA',
    CAN: 'CA',
    CANADA: 'CA',
    FR: 'FR',
    FRA: 'FR',
    FRANCE: 'FR',
    US: 'US',
    USA: 'US',
    'UNITED STATES': 'US',
    'UNITED STATES OF AMERICA': 'US',
  };
  if (countryAliases[explicitCountry]) return countryAliases[explicitCountry];

  const stationPrefix = getPhoneStationCountryCode(kiosk?.stationid || kiosk?.stationId);
  return countryAliases[stationPrefix] || '';
}
