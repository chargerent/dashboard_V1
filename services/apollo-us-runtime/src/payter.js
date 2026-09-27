import {normalizeSerial} from './contracts.js';

const CPS_ENVIRONMENTS = {
  test: 'https://cps-test.mypayter.com',
  dev: 'https://cps.dev.mypayter.com',
  production: 'https://cps.mypayter.com',
};

export function payterBaseUrl(environment) {
  const value = CPS_ENVIRONMENTS[environment];
  if (!value) throw new Error('Unsupported Payter CPS environment.');
  return value;
}

export function buildCallbackBaseUrl(publicBaseUrl, token) {
  const baseUrl = String(publicBaseUrl || '').replace(/\/$/, '');
  const value = String(token || '').trim();
  if (!baseUrl || !value) throw new Error('Public callback URL and token are required.');
  return `${baseUrl}/callbacks/${encodeURIComponent(value)}`;
}

export function buildQrStartRequest({apiKey, callbackUrl, cpsEnvironment, language = 'en', promptMessage, promptTitle, serialNumber}) {
  const serial = normalizeSerial(serialNumber);
  const url = new URL(`/terminals/${encodeURIComponent(serial)}/start`, payterBaseUrl(cpsEnvironment));
  url.searchParams.set('authorizedAmount', '0');
  url.searchParams.set('callbackUrl', callbackUrl);
  url.searchParams.set('uiMessageTitle', promptTitle || 'Borrow a charger');
  url.searchParams.set('uiMessage', promptMessage || 'Scan your QR code');
  url.searchParams.set('supportedPaymentMethods', 'QR_CODE');
  url.searchParams.set('language', language);
  url.searchParams.set('hideAmount', 'true');
  return {url, options: {method: 'POST', headers: {Authorization: `CPS apikey="${apiKey}"`}}};
}

export function buildStopRequest({apiKey, cpsEnvironment, serialNumber}) {
  const serial = normalizeSerial(serialNumber);
  const url = new URL(`/terminals/${encodeURIComponent(serial)}/stop`, payterBaseUrl(cpsEnvironment));
  return {url, options: {method: 'POST', headers: {Authorization: `CPS apikey="${apiKey}"`}}};
}

export function buildTerminalRequest({apiKey, cpsEnvironment, serialNumber}) {
  const serial = normalizeSerial(serialNumber);
  const url = new URL(`/terminals/${encodeURIComponent(serial)}`, payterBaseUrl(cpsEnvironment));
  return {url, options: {method: 'GET', headers: {Authorization: `CPS apikey="${apiKey}"`}}};
}

export function buildUiRequest({apiKey, callbackBaseUrl, cpsEnvironment, properties, serialNumber, screenId, type = 'message'}) {
  const serial = normalizeSerial(serialNumber);
  const url = new URL(`/terminals/${encodeURIComponent(serial)}/ui`, payterBaseUrl(cpsEnvironment));
  url.searchParams.set('callbackUrl', `${String(callbackBaseUrl).replace(/\/$/, '')}/ui`);
  return {
    url,
    options: {
      method: 'POST',
      headers: {Authorization: `CPS apikey="${apiKey}"`, 'content-type': 'application/json'},
      body: JSON.stringify({id: screenId, type, properties}),
    },
  };
}

export async function callPayter(request, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(request.url, {...request.options, signal: controller.signal});
    const body = await response.text();
    if (!response.ok) throw new Error(`Payter CPS returned HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ''}`);
    return {status: response.status, body};
  } finally {
    clearTimeout(timeout);
  }
}
