// src/pages/CreateClientForm.jsx
import { useState, useMemo, useRef } from 'react';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import MultiSwitch from "../utils/MultiSwitch";
import {
  DEFAULT_WORKSPACE_DOMAIN,
  buildWorkspaceMailboxRequest,
  getWorkspaceMailboxDetails,
  normalizeWorkspaceLocalPart,
  validateContactEmail,
  workspaceLocalPartError,
} from '../utils/workspaceEmail.js';

const AUTH_MAPPING_DOMAIN = "auth.charge.rent";
const REVENUE_MODEL_OPTIONS = [
  { value: 'lease', label: 'Lease' },
  { value: 'purchase', label: 'Purchase' },
];
const PAYMENT_SCHEDULE_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];
const PAYMENT_ADMIN_OPTIONS = [
  { value: 'arthur', label: 'Arthur - arthur@charge.rent' },
  { value: 'george', label: 'George - george@charge.rent' },
];

const normalizeSupportPhoneNumbers = (value) => {
  const entries = Array.isArray(value) ? value : String(value || '').split(/[\n,;]+/);
  return [...new Set(entries.map((entry) => String(entry || '').trim()).filter(Boolean))];
};

const getEffectiveAdminFeatures = (features, featuresList, username = '') => {
  const normalizedUsername = String(username || '').trim().toLowerCase();
  const rawFeatures = features || {};
  const base = Object.fromEntries((featuresList || []).map((key) => [key, key !== 'binding' && key !== 'testing']));

  return {
    ...base,
    ...rawFeatures,
    binding: normalizedUsername === 'chargerent' || rawFeatures.binding === true,
    testing: normalizedUsername === 'chargerent' || rawFeatures.testing === true,
  };
};

const CreateClientForm = ({ clients, onCreate, onCancel, t, featuresList, commandsList, workspaceStatus, creating = false, onCheckWorkspaceEmail }) => {
  const [newClient, setNewClient] = useState({
    username: '',
    password: '',
    clientId: '',
    contact: { name: '', email: '' },
    features: {
      ...Object.fromEntries(featuresList.map(k => [k, false])),
      defaultlanguage: 'en',
      lease_revenue: false,
      rental_counts: false,
      rental_revenue: false,
      client_commission: false,
      rep_commission: false,
      search: false,
    },
    commands: Object.fromEntries(commandsList.map(k => [k, false])),
    partner: false,
    commission: 0,
    revShareModel: 'lease',
    paymentSchedule: 'monthly',
    paymentAdmin: 'george',
    supportPhoneNumbers: '',
    active: true,
    role: 'user',
  });

  const [openSection, setOpenSection] = useState(null);
  const [formError, setFormError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [emailCredentials, setEmailCredentials] = useState(false);
  const [includePartnerKit, setIncludePartnerKit] = useState(false);
  const [createWorkspaceMailbox, setCreateWorkspaceMailbox] = useState(false);
  const [workspaceOverrides, setWorkspaceOverrides] = useState({});
  const [workspaceAvailability, setWorkspaceAvailability] = useState(null);
  const [checkingWorkspaceEmail, setCheckingWorkspaceEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitInFlight = useRef(false);
  const checkInFlight = useRef(false);
  const availabilityVersion = useRef(0);
  const isAdminRole = newClient.role === 'admin';
  const isPartnerRole = newClient.role === 'partner';
  const isPurchaseClient = !isAdminRole && !isPartnerRole && newClient.revShareModel === 'purchase';
  const showPayoutFields = isPartnerRole || isPurchaseClient;
  const workspaceEligible = isPartnerRole;
  const workspaceDomain = workspaceStatus?.domain || DEFAULT_WORKSPACE_DOMAIN;
  const workspaceConfigured = workspaceStatus?.configured === true && workspaceStatus?.loading !== true;
  const workspaceDetails = getWorkspaceMailboxDetails({
    contactName: newClient.contact.name,
    contactEmail: newClient.contact.email,
    overrides: workspaceOverrides,
    domain: workspaceDomain,
  });
  const workspaceEmail = `${normalizeWorkspaceLocalPart(workspaceDetails.localPart)}@${workspaceDomain}`;
  const availabilityKey = JSON.stringify([workspaceEmail, workspaceDetails.givenName, workspaceDetails.familyName]);
  const currentAvailability = workspaceAvailability?.key === availabilityKey ? workspaceAvailability : null;
  const busy = creating || submitting;

  const normalizeUsername = (u) => String(u || '').trim().toLowerCase();
  const isValidUsername = (u) => /^[a-z0-9._-]+$/.test(u);

  const mappedEmail = useMemo(() => {
    const u = normalizeUsername(newClient.username);
    if (!u || !isValidUsername(u)) return '';
    return `${u}@${AUTH_MAPPING_DOMAIN}`;
  }, [newClient.username]);
  const effectiveAdminFeatures = useMemo(
    () => getEffectiveAdminFeatures(newClient.features, featuresList, newClient.username),
    [featuresList, newClient.features, newClient.username],
  );

  const toggleSection = (section) => setOpenSection(prev => (prev === section ? null : section));

  const invalidateWorkspaceAvailability = () => {
    availabilityVersion.current += 1;
    setWorkspaceAvailability(null);
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;

    if (name.includes('contact.')) {
      const contactKey = name.split('.')[1];
      if (contactKey === 'name') invalidateWorkspaceAvailability();
      setNewClient(prev => ({ ...prev, contact: { ...prev.contact, [contactKey]: value } }));
      return;
    }

    if (type === 'checkbox') {
      setNewClient(prev => ({ ...prev, [name]: checked }));
      return;
    }

    if (name === 'role') {
      invalidateWorkspaceAvailability();
      if (value !== 'partner') {
        setIncludePartnerKit(false);
        setCreateWorkspaceMailbox(false);
        setWorkspaceOverrides({});
      }
      setNewClient(prev => ({
        ...prev,
        role: value,
        partner: value === 'partner',
        clientId: value === 'admin' ? '' : prev.clientId,
        revShareModel: value === 'admin' ? 'lease' : prev.revShareModel,
      }));
      return;
    }

    setNewClient(prev => ({ ...prev, [name]: value }));
  };

  const handlePermissionChange = (type, key, value) => {
    setNewClient(prev => ({ ...prev, [type]: { ...prev[type], [key]: value } }));
  };

  const handleLanguageChange = (value) =>
    handlePermissionChange('features', 'defaultlanguage', value.toLowerCase());

  const handleWorkspaceChange = (event) => {
    const { name, value } = event.target;
    if (name !== 'recoveryEmail') invalidateWorkspaceAvailability();
    setWorkspaceOverrides((previous) => ({ ...previous, [name]: value }));
  };

  const handleCheckWorkspaceEmail = async () => {
    if (!onCheckWorkspaceEmail || checkInFlight.current || busy || !workspaceConfigured || !createWorkspaceMailbox) return;
    const addressError = workspaceLocalPartError(workspaceDetails.localPart);
    if (addressError) {
      setWorkspaceAvailability({ key: availabilityKey, status: 'error', message: addressError });
      return;
    }
    checkInFlight.current = true;
    const checkVersion = ++availabilityVersion.current;
    setCheckingWorkspaceEmail(true);
    setWorkspaceAvailability(null);
    try {
      const result = await onCheckWorkspaceEmail(normalizeWorkspaceLocalPart(workspaceDetails.localPart));
      if (checkVersion !== availabilityVersion.current) return;
      setWorkspaceAvailability({
        key: availabilityKey,
        status: result?.available === true ? 'available' : 'unavailable',
        message: result?.message || (result?.available === true ? 'This address is available.' : 'This address is already in use. Choose another email name.'),
      });
    } catch (error) {
      if (checkVersion === availabilityVersion.current) {
        setWorkspaceAvailability({ key: availabilityKey, status: 'error', message: error?.message || 'The address could not be checked. Please try again.' });
      }
    } finally {
      checkInFlight.current = false;
      setCheckingWorkspaceEmail(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitInFlight.current || busy || checkingWorkspaceEmail) return;
    setFormError(null);

    const usernameNorm = normalizeUsername(newClient.username);

    if (!usernameNorm || !newClient.password || (!isAdminRole && !newClient.clientId)) {
      setFormError(isAdminRole ? "Username and password are required." : "Username, password, and Client ID are required.");
      return;
    }
    if (!isValidUsername(usernameNorm)) {
      setFormError("Username can only contain letters, numbers, dot, underscore, and dash.");
      return;
    }
    if (newClient.password.length < 12) {
      setFormError("Password must be at least 12 characters.");
      return;
    }
    if (Array.isArray(clients) && clients.some(c => normalizeUsername(c.username) === usernameNorm)) {
      setFormError(t('username_already_exists'));
      return;
    }

    let workspaceMailbox;
    let contactEmail;
    try {
      const contactResult = validateContactEmail(newClient.contact?.email, {
        companyEmail: createWorkspaceMailbox && isPartnerRole ? workspaceEmail : '',
      });
      if (contactResult.error) throw new Error(contactResult.error);
      contactEmail = contactResult.email;
      workspaceMailbox = buildWorkspaceMailboxRequest({
        enabled: createWorkspaceMailbox,
        role: newClient.role,
        configured: workspaceConfigured,
        details: workspaceDetails,
        domain: workspaceDomain,
      });
      if (workspaceMailbox && currentAvailability?.status === 'unavailable') {
        throw new Error('This company email address is already in use. Choose another email name.');
      }
    } catch (error) {
      setFormError(error.message);
      return;
    }

    const profile = {
      username: usernameNorm,
      clientId: isAdminRole ? '' : String(newClient.clientId).trim().toUpperCase(),
      contact: {
        name: String(newClient.contact?.name || '').trim(),
        email: contactEmail,
      },
      features: { ...newClient.features, defaultlanguage: (newClient.features?.defaultlanguage || 'en').toLowerCase() },
      commands: { ...newClient.commands },
      partner: isPartnerRole,
      commission: showPayoutFields ? (String(newClient.commission ?? '').trim() || "0") : "0",
      revShareModel: isAdminRole || isPartnerRole ? 'lease' : newClient.revShareModel,
      paymentSchedule: showPayoutFields ? newClient.paymentSchedule : '',
      paymentAdmin: showPayoutFields ? newClient.paymentAdmin : '',
      active: newClient.active !== false,
      role: newClient.role || 'user',
      supportPhoneNumbers: isPartnerRole ? normalizeSupportPhoneNumbers(newClient.supportPhoneNumbers) : [],
      authEmail: mappedEmail || undefined
    };

    submitInFlight.current = true;
    setSubmitting(true);
    try {
      const result = await onCreate({
        username: usernameNorm,
        password: newClient.password, // only sent to Cloud Function; NOT stored in Firestore
        clientId: profile.clientId,
        profile,
        sendCredentials: (emailCredentials || (isPartnerRole && includePartnerKit)) && !!profile.contact.email,
        includePartnerKit: isPartnerRole && includePartnerKit,
        ...(workspaceMailbox ? { workspaceMailbox } : {}),
      });
      if (result?.ok === true) {
        setNewClient(prev => ({ ...prev, password: '' }));
        setShowPassword(false);
      } else {
        setFormError(result?.message || 'The account could not be created. Your entries have been kept so you can try again.');
      }
    } catch (error) {
      setFormError(error?.message || 'The account could not be created. Please try again.');
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  };

  const SectionButton = ({ section }) => (
    <button type="button" onClick={() => toggleSection(section)}
      className="w-full flex justify-between items-center p-3 font-semibold text-gray-700 hover:bg-gray-100 rounded-lg">
      <span>{t(section)}</span>
      <svg className={`w-5 h-5 transition-transform ${openSection === section ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
      </svg>
    </button>
  );

  const PermissionToggle = ({ label, isChecked, onChange, disabled }) => (
    <div className={`flex items-center justify-between py-2 px-3 border-b border-gray-100 last:border-b-0 ${disabled ? 'opacity-50' : ''}`}>
      <span className="text-sm font-medium text-gray-700 capitalize">{label.replace(/_/g, ' ')}</span>
      <label className={`flex shrink-0 items-center ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
        <div className="relative">
          <input type="checkbox" className="sr-only" checked={!!isChecked} onChange={e => !disabled && onChange(e.target.checked)} disabled={disabled} />
          <div className={`block w-10 h-6 rounded-full transition ${isChecked ? (disabled ? 'bg-blue-300' : 'bg-blue-600') : 'bg-gray-300'}`}></div>
          <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${isChecked ? 'translate-x-4' : ''}`}></div>
        </div>
      </label>
    </div>
  );

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="font-bold text-xl text-gray-800 mb-4">{t('add_new_client')}</h3>

      <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded mb-4 text-sm">
        Create dashboard access for a client, partner, or administrator.
      </div>

      {formError && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">{formError}</div>}

      <form onSubmit={handleSubmit} aria-busy={busy}>
        <fieldset disabled={busy} className="min-w-0">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700">{t('username')} <span className="text-red-500">*</span></label>
            <input type="text" name="username" value={newClient.username} onChange={handleInputChange}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" required />
            <p className="text-xs text-gray-500 mt-1">Used to sign in to the dashboard.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">{t('password')} <span className="text-red-500">*</span></label>
            <div className="relative mt-1">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={newClient.password}
                onChange={handleInputChange}
                className="block w-full rounded-md border border-gray-300 p-2 pr-11 shadow-sm"
                minLength={12}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(prev => !prev)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 transition hover:text-gray-600 focus:outline-none focus:text-blue-600"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeSlashIcon className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <EyeIcon className="h-5 w-5" aria-hidden="true" />
                )}
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">Minimum 12 characters.</p>
          </div>

          <div>
            <label className={`block text-sm font-medium ${isAdminRole ? 'text-gray-400' : 'text-gray-700'}`}>{t('client_id')} {!isAdminRole && <span className="text-red-500">*</span>}</label>
            <input
              type="text"
              name="clientId"
              value={newClient.clientId}
              onChange={handleInputChange}
              disabled={isAdminRole}
              placeholder={isAdminRole ? 'Not required for admins' : ''}
              className={`mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 ${isAdminRole ? 'cursor-not-allowed bg-gray-100 text-gray-400' : ''}`}
              required={!isAdminRole}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Role</label>
            <select name="role" value={newClient.role} onChange={handleInputChange}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2">
              <option value="user">user</option>
              <option value="partner">partner</option>
              <option value="admin">admin</option>
            </select>
          </div>

          {isPartnerRole && (
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Subscribed support phone number(s)</label>
              <input
                type="text"
                name="supportPhoneNumbers"
                value={newClient.supportPhoneNumbers}
                onChange={handleInputChange}
                placeholder="+1 917 993 9355"
                className="mt-1 block w-full rounded-md border border-gray-300 p-2 font-mono shadow-sm"
              />
              <p className="mt-1 text-xs text-gray-500">Optional. Separate multiple E.164 numbers with commas. With no assigned line, the partner can sign in but sees no customer activity and receives no routed calls.</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700">{t('contact_name')} (Optional)</label>
            <input type="text" name="contact.name" value={newClient.contact.name} onChange={handleInputChange}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="contact-email" className="block text-sm font-medium text-gray-700">Contact Email <span className="text-red-500">*</span></label>
            <input id="contact-email" type="email" name="contact.email" value={newClient.contact.email} onChange={handleInputChange}
              required maxLength={254} autoCapitalize="none" spellCheck={false} aria-describedby="contact-email-hint"
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
            <p id="contact-email-hint" className="mt-1 text-xs text-gray-500">Use an existing email address they can already access.</p>
          </div>

          {workspaceEligible && (
            <div className="md:col-span-2 rounded-lg border border-blue-200 bg-blue-50/50 p-4">
              <label className={`flex items-start gap-3 text-sm font-semibold ${workspaceConfigured ? 'text-gray-800' : 'text-gray-500'}`}>
                <input
                  type="checkbox"
                  checked={createWorkspaceMailbox}
                  disabled={!workspaceConfigured && !createWorkspaceMailbox}
                  onChange={(event) => {
                    invalidateWorkspaceAvailability();
                    setCreateWorkspaceMailbox(event.target.checked);
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Create a company email account in Google Workspace
              </label>
              {!workspaceConfigured ? (
                <p className="mt-2 text-sm text-gray-600" role="status">
                  {workspaceStatus?.loading ? 'Checking company email availability…' : (workspaceStatus?.message || 'Company email creation is not available yet. You can still create dashboard access.')}
                </p>
              ) : (
                <p className="mt-2 text-sm text-gray-600">Add an @{workspaceDomain} mailbox with its own Google sign-in. A Google Workspace license may add a recurring charge.</p>
              )}
              {createWorkspaceMailbox && (
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <p className="rounded-md border border-blue-200 bg-white px-3 py-2 text-sm text-blue-800 md:col-span-2">
                    We will email the new company address to {String(newClient.contact.email || '').trim() || 'the contact email above'} after Google creates the account.
                  </p>
                  <div>
                    <label htmlFor="workspace-given-name" className="block text-sm font-medium text-gray-700">First name <span className="text-red-500">*</span></label>
                    <input id="workspace-given-name" name="givenName" type="text" value={workspaceDetails.givenName} onChange={handleWorkspaceChange}
                      maxLength={60} required className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm" />
                  </div>
                  <div>
                    <label htmlFor="workspace-family-name" className="block text-sm font-medium text-gray-700">Last name <span className="text-red-500">*</span></label>
                    <input id="workspace-family-name" name="familyName" type="text" value={workspaceDetails.familyName} onChange={handleWorkspaceChange}
                      maxLength={60} required className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm" />
                  </div>
                  <div className="md:col-span-2">
                    <label htmlFor="workspace-email-name" className="block text-sm font-medium text-gray-700">Company email <span className="text-red-500">*</span></label>
                    <div className="mt-1 flex min-w-0 flex-wrap gap-2">
                      <div className="flex min-w-0 flex-1 rounded-md border border-gray-300 bg-white shadow-sm">
                        <input id="workspace-email-name" name="localPart" type="text" autoCapitalize="none" spellCheck={false}
                          value={workspaceDetails.localPart} onChange={handleWorkspaceChange} maxLength={64} required
                          aria-describedby="workspace-email-hint" placeholder="g.gazelian"
                          className="min-w-0 w-full flex-1 rounded-l-md p-2 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500" />
                        <span className="flex shrink-0 items-center rounded-r-md border-l border-gray-300 bg-gray-50 px-2 text-sm text-gray-600">@{workspaceDomain}</span>
                      </div>
                      {onCheckWorkspaceEmail && (
                        <button type="button" onClick={handleCheckWorkspaceEmail} disabled={checkingWorkspaceEmail || !workspaceConfigured || !workspaceDetails.localPart}
                          className="rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50">
                          {checkingWorkspaceEmail ? 'Checking…' : 'Check availability'}
                        </button>
                      )}
                    </div>
                    <p id="workspace-email-hint" className="mt-1 text-xs text-gray-500">Suggested format: first initial.last name. You can edit it before creating the account.</p>
                    {currentAvailability && <p role="status" className={`mt-2 text-sm ${currentAvailability.status === 'available' ? 'text-green-700' : 'text-red-700'}`}>{currentAvailability.message}</p>}
                  </div>
                  <div className="md:col-span-2">
                    <label htmlFor="workspace-recovery-email" className="block text-sm font-medium text-gray-700">Alternate email for account recovery (Optional)</label>
                    <input id="workspace-recovery-email" name="recoveryEmail" type="email" value={workspaceDetails.recoveryEmail} onChange={handleWorkspaceChange}
                      maxLength={254} className="mt-1 block w-full rounded-md border border-gray-300 p-2 shadow-sm" />
                    <p className="mt-1 text-xs text-gray-500">Use an existing email address they can already access.</p>
                  </div>
                  <p className="text-sm text-gray-600 md:col-span-2">Google will use a separate temporary password, shown after creation. They must change it when they first sign in.</p>
                </div>
              )}
            </div>
          )}

          {!isAdminRole && !isPartnerRole && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Revenue Model</label>
              <select name="revShareModel" value={newClient.revShareModel} onChange={handleInputChange}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2">
                {REVENUE_MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-3 md:col-span-2">
            <label className="flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700">
              <input
                checked={emailCredentials}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                onChange={(event) => {
                  setEmailCredentials(event.target.checked);
                  if (!event.target.checked) setIncludePartnerKit(false);
                }}
                type="checkbox"
              />
              Email dashboard login credentials after creating this client
            </label>
            {isPartnerRole && (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <label className="flex items-center gap-3 text-sm font-medium text-gray-700">
                  <input
                    checked={includePartnerKit}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    onChange={(event) => {
                      setIncludePartnerKit(event.target.checked);
                      if (event.target.checked) setEmailCredentials(true);
                    }}
                    type="checkbox"
                  />
                  Include partner kit with login details
                </label>
                <p className="mt-1 pl-7 text-xs text-gray-500">Attach the partner launch kit PDF to the same email as their dashboard login details.</p>
              </div>
            )}
          </div>

          {showPayoutFields && (
            <div className="md:col-span-2 border-t pt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">{t('rev_share_percentage')}</label>
                <input type="number" name="commission" value={newClient.commission || ''} onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" min="0" max="100" step="0.1" />
              </div>
            </div>
          )}

          {showPayoutFields && (
            <div className="md:col-span-2 grid grid-cols-1 gap-4 border-t pt-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Payment Schedule</label>
                <select name="paymentSchedule" value={newClient.paymentSchedule} onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2">
                  {PAYMENT_SCHEDULE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Payment Admin</label>
                <select name="paymentAdmin" value={newClient.paymentAdmin} onChange={handleInputChange}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2">
                  {PAYMENT_ADMIN_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700">Active</label>
            <PermissionToggle label="Active" isChecked={newClient.active}
              onChange={(value) => setNewClient(prev => ({ ...prev, active: value }))} />
          </div>
        </div>

        <div className="p-2 border-t border-gray-200 mt-4">
          <SectionButton section="features" />
          {openSection === 'features' && (
            <div className={`rounded-md p-2 mt-1 ${isAdminRole ? 'bg-gray-100 opacity-60' : 'bg-gray-50'}`}>
              {isAdminRole && <p className="px-2 pb-2 text-xs italic text-gray-500">Admins have all features except binding and testing unless explicitly enabled.</p>}
              <MultiSwitch label={t('default_language')} options={['EN', 'FR']}
                value={newClient.features.defaultlanguage || 'en'}
                onChange={(val) => !isAdminRole && handleLanguageChange(val)} />
              {featuresList.map(key => (
                <PermissionToggle key={key} label={key} isChecked={isAdminRole ? effectiveAdminFeatures[key] : newClient.features[key]}
                  onChange={(value) => ((isAdminRole && (key === 'binding' || key === 'testing')) || !isAdminRole) && handlePermissionChange('features', key, value)}
                  disabled={isAdminRole && key !== 'binding' && key !== 'testing'} />
              ))}
            </div>
          )}

          <SectionButton section="commands" />
          {openSection === 'commands' && (
            <div className={`rounded-md p-2 mt-1 ${isAdminRole ? 'bg-gray-100 opacity-60' : 'bg-gray-50'}`}>
              {isAdminRole && <p className="px-2 pb-2 text-xs italic text-gray-500">Admins have all commands enabled</p>}
              {Object.keys(newClient.commands).map(key => (
                <PermissionToggle key={key} label={key} isChecked={isAdminRole ? true : newClient.commands[key]}
                  onChange={(value) => !isAdminRole && handlePermissionChange('commands', key, value)}
                  disabled={isAdminRole} />
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button type="button" onClick={onCancel} className="bg-gray-300 text-gray-800 font-bold py-2 px-5 rounded-md hover:bg-gray-400 transition-all">
            {t('cancel')}
          </button>
          <button type="submit" disabled={busy || checkingWorkspaceEmail} className="bg-green-600 text-white font-bold py-2 px-5 rounded-md hover:bg-green-700 transition-all disabled:cursor-not-allowed disabled:opacity-60">
            {busy ? 'Creating account…' : t('create_client')}
          </button>
        </div>
        </fieldset>
      </form>
    </div>
  );
};

export default CreateClientForm;
