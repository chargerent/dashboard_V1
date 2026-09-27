export const DEFAULT_WORKSPACE_DOMAIN = 'charge.rent';

const cleanText = (value) => String(value ?? '').trim();
const EMAIL_RE = /^[a-z0-9!#$%&'*+/=?^_\x60{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_\x60{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const addressName = (value) => cleanText(value)
  .normalize('NFKD')
  .replace(/\p{M}/gu, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

export function validateContactEmail(value, { companyEmail = '' } = {}) {
  const email = cleanText(value).toLowerCase();
  if (!email) return { email: '', error: 'Contact Email is required. Enter an existing email address they can access.' };
  if (email.length > 254 || email.split('@')[0].length > 64 || !EMAIL_RE.test(email)) {
    return { email: '', error: 'Enter a valid Contact Email address.' };
  }
  if (email === cleanText(companyEmail).toLowerCase()) {
    return { email: '', error: 'Contact Email must be an existing address, different from the new company email, so they can receive the new address.' };
  }
  return { email, error: '' };
}

export function splitWorkspaceName(fullName) {
  const [givenName = '', ...familyParts] = cleanText(fullName).split(/\s+/);
  return { givenName, familyName: familyParts.join(' ') };
}

export function suggestWorkspaceLocalPart(givenName, familyName) {
  const first = addressName(givenName);
  const last = addressName(familyName);
  return first && last ? `${first[0]}.${last}` : '';
}

export function normalizeWorkspaceLocalPart(value) {
  return cleanText(value).toLowerCase();
}

export function workspaceLocalPartError(value) {
  const localPart = normalizeWorkspaceLocalPart(value);
  return /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(localPart) && !localPart.includes('..')
    ? ''
    : 'Enter an email name using letters, numbers, periods, hyphens, or underscores, starting and ending with a letter or number.';
}

// Undefined overrides follow the contact details. Even an empty manual edit is preserved.
export function getWorkspaceMailboxDetails({ contactName, contactEmail, overrides = {}, domain = DEFAULT_WORKSPACE_DOMAIN }) {
  const name = splitWorkspaceName(contactName);
  const givenName = overrides.givenName ?? name.givenName;
  const familyName = overrides.familyName ?? name.familyName;
  const localPart = overrides.localPart ?? suggestWorkspaceLocalPart(givenName, familyName);
  const email = `${normalizeWorkspaceLocalPart(localPart)}@${domain}`;
  const contact = cleanText(contactEmail).toLowerCase();
  const recoveryEmail = overrides.recoveryEmail ?? (contact !== email ? contact : '');
  return { givenName, familyName, localPart, recoveryEmail };
}

export function buildWorkspaceMailboxRequest({ enabled, role, configured, details, domain = DEFAULT_WORKSPACE_DOMAIN }) {
  if (!enabled || role !== 'partner') return undefined;
  if (!configured) throw new Error('Company email creation is not available yet. You can still create dashboard access.');
  const localPart = normalizeWorkspaceLocalPart(details.localPart);
  const addressError = workspaceLocalPartError(localPart);
  if (addressError) throw new Error(addressError);
  const givenName = cleanText(details.givenName);
  const familyName = cleanText(details.familyName);
  if (![givenName, familyName].every((name) => name.length > 0 && name.length <= 60 && !/\p{Cc}/u.test(name))) {
    throw new Error('Enter a first name and last name, each up to 60 characters.');
  }
  const recoveryEmail = cleanText(details.recoveryEmail).toLowerCase();
  if (recoveryEmail && (recoveryEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail))) {
    throw new Error('Enter a valid alternate email address, or leave it blank.');
  }
  if (recoveryEmail === `${localPart}@${domain}`) {
    throw new Error('Use an existing email address for recovery, different from the new company email.');
  }
  return { localPart, givenName, familyName, recoveryEmail };
}
