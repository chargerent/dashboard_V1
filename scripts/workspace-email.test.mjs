import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWorkspaceMailboxRequest,
  getWorkspaceMailboxDetails,
  splitWorkspaceName,
  suggestWorkspaceLocalPart,
  validateContactEmail,
  workspaceLocalPartError,
} from '../src/utils/workspaceEmail.js';

test('requires an existing contact email for every new account and normalizes it', () => {
  assert.deepEqual(validateContactEmail('  Partner+Dashboard@Example.COM  '), { email: 'partner+dashboard@example.com', error: '' });
  for (const value of ['', '   ', null, undefined]) {
    const result = validateContactEmail(value);
    assert.equal(result.email, '');
    assert.match(result.error, /required/);
  }
});

test('rejects malformed contact emails and header injection', () => {
  for (const value of ['invalid', 'first..last@example.com', 'name@-example.com', 'name@example', 'name@example.com\r\nBcc:other@example.com', `${'x'.repeat(65)}@example.com`]) {
    const result = validateContactEmail(value);
    assert.equal(result.email, '', value);
    assert.match(result.error, /valid Contact Email/);
  }
});

test('company address notifications require a different contact address regardless of case', () => {
  const collision = validateContactEmail(' G.Gazelian@Charge.Rent ', { companyEmail: 'g.gazelian@charge.rent' });
  assert.equal(collision.email, '');
  assert.match(collision.error, /different from the new company email/);
  assert.deepEqual(validateContactEmail('existing@example.com', { companyEmail: 'g.gazelian@charge.rent' }), { email: 'existing@example.com', error: '' });
  // With no new mailbox selected, an existing company email remains a valid contact.
  assert.deepEqual(validateContactEmail('g.gazelian@charge.rent'), { email: 'g.gazelian@charge.rent', error: '' });
});

test('suggests first initial dot surname, normalizing accents and name punctuation', () => {
  assert.equal(suggestWorkspaceLocalPart('George', 'Gazelian'), 'g.gazelian');
  assert.equal(suggestWorkspaceLocalPart('Élise', 'D’Arcy'), 'e.darcy');
  assert.equal(suggestWorkspaceLocalPart('Mary Jane', 'Smith-Jones'), 'm.smithjones');
  assert.equal(suggestWorkspaceLocalPart('Juan', 'de la Cruz'), 'j.delacruz');
  assert.equal(suggestWorkspaceLocalPart('George', ''), '');
});

test('splits a contact name without discarding surname words', () => {
  assert.deepEqual(splitWorkspaceName('  Juan   de la Cruz  '), { givenName: 'Juan', familyName: 'de la Cruz' });
  assert.deepEqual(splitWorkspaceName(''), { givenName: '', familyName: '' });
});

test('contact defaults follow edits while manually edited and cleared fields persist', () => {
  const original = getWorkspaceMailboxDetails({ contactName: 'George Gazelian', contactEmail: 'old@example.com' });
  assert.equal(original.localPart, 'g.gazelian');
  const edited = getWorkspaceMailboxDetails({
    contactName: 'Arthur Smith', contactEmail: 'new@example.com',
    overrides: { localPart: 'custom.address', givenName: 'Georges', familyName: 'Gazelian', recoveryEmail: '' },
  });
  assert.deepEqual(edited, { localPart: 'custom.address', givenName: 'Georges', familyName: 'Gazelian', recoveryEmail: '' });
  assert.equal(getWorkspaceMailboxDetails({ contactName: 'Arthur Smith', overrides: { localPart: '' } }).localPart, '');
});

test('changing an editable Workspace name updates its default address', () => {
  assert.equal(getWorkspaceMailboxDetails({
    contactName: 'George Gazelian', overrides: { givenName: 'Arthur', familyName: 'Smith' },
  }).localPart, 'a.smith');
});

test('does not default recovery to the new company mailbox itself', () => {
  assert.equal(getWorkspaceMailboxDetails({ contactName: 'George Gazelian', contactEmail: 'G.GAZELIAN@charge.rent' }).recoveryEmail, '');
  assert.equal(getWorkspaceMailboxDetails({ contactName: 'George Gazelian', contactEmail: 'existing@example.com' }).recoveryEmail, 'existing@example.com');
});

test('omits a mailbox for admin and ordinary user recipients or when unchecked', () => {
  assert.equal(buildWorkspaceMailboxRequest({ enabled: true, role: 'user' }), undefined);
  assert.equal(buildWorkspaceMailboxRequest({ enabled: true, role: 'admin' }), undefined);
  assert.equal(buildWorkspaceMailboxRequest({ enabled: false, role: 'partner' }), undefined);
});

const request = { enabled: true, configured: true, role: 'partner', details: {
  localPart: ' G.Gazelian ', givenName: ' George ', familyName: ' Gazelian ', recoveryEmail: '',
} };

test('builds a normalized mailbox request with optional recovery and no password', () => {
  assert.deepEqual(buildWorkspaceMailboxRequest(request), {
    localPart: 'g.gazelian', givenName: 'George', familyName: 'Gazelian', recoveryEmail: '',
  });
});

test('rejects unavailable configuration, invalid names, and self-recovery', () => {
  assert.throws(() => buildWorkspaceMailboxRequest({ ...request, configured: false }), /not available/);
  assert.throws(() => buildWorkspaceMailboxRequest({ ...request, details: { ...request.details, familyName: '' } }), /last name/);
  assert.throws(() => buildWorkspaceMailboxRequest({ ...request, details: { ...request.details, recoveryEmail: 'G.GAZELIAN@charge.rent' } }), /different/);
  assert.throws(() => buildWorkspaceMailboxRequest({ ...request, details: { ...request.details, recoveryEmail: 'invalid' } }), /valid alternate/);
});

test('rejects full addresses, dot edges, double dots, and overlong local parts', () => {
  for (const value of ['g.gazelian@charge.rent', '.george', 'george.', 'g..gazelian', 'x'.repeat(65)]) {
    assert.ok(workspaceLocalPartError(value), value);
  }
  assert.equal(workspaceLocalPartError('g.gazelian'), '');
  assert.equal(workspaceLocalPartError('x'.repeat(64)), '');
});
