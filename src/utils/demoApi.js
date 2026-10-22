import { auth } from '../firebase-config';

// Public station screens and management requests share the branded demo origin.
export const DEMO_API_ORIGIN = 'https://demo.chargerentstations.com';
export const DEMO_PUBLIC_ORIGIN = 'https://demo.chargerentstations.com';
const messages = {
  SIGN_IN_REQUIRED: 'Please sign in again.', ADMIN_REQUIRED: 'Only administrators can manage demos.',
  CONFLICT: 'This demo changed in another window. Reload it before saving.',
  INVALID_PROFILE: 'Check the name, languages, color and daily text limit.',
  ARTWORK_REQUIRED: 'Add artwork for the default language.', IMAGE_TOO_LARGE: 'Choose an image smaller than 4 MB.',
  IMAGE_TYPE: 'Choose a JPG, PNG or WebP image.', INVALID_ARTWORK: 'Upload artwork using the image controls.',
};
export async function demoRequest(path, { method = 'GET', body, file } = {}) {
  if (!auth.currentUser) throw new Error(messages.SIGN_IN_REQUIRED);
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await auth.currentUser.getIdToken(attempt === 1);
    const response = await fetch(DEMO_API_ORIGIN + '/api/admin/' + path, {
      method, headers: { Authorization: 'Bearer ' + token, ...(file ? { 'Content-Type': file.type } : body ? { 'Content-Type': 'application/json' } : {}) },
      ...(file ? { body: file } : body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (response.status === 401 && attempt === 0) continue;
    if (!response.ok) throw new Error(messages[value.error] || 'The demo service is unavailable. Please try again.');
    return value;
  }
}
export const demoSlug = (name) => name.normalize('NFKD').replace(/[’']/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64).replace(/-$/, '');
