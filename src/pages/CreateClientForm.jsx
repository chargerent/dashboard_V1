// src/pages/CreateClientForm.jsx
import { useState, useMemo } from 'react';
import MultiSwitch from "../utils/MultiSwitch";

const AUTH_MAPPING_DOMAIN = "auth.charge.rent";

const CreateClientForm = ({ clients, onCreate, onCancel, t, featuresList, commandsList }) => {
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
    commission: 0,
    active: true,
    role: 'user',
  });

  const [openSection, setOpenSection] = useState(null);
  const [formError, setFormError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const normalizeUsername = (u) => String(u || '').trim().toLowerCase();
  const isValidUsername = (u) => /^[a-z0-9._-]+$/.test(u);

  const mappedEmail = useMemo(() => {
    const u = normalizeUsername(newClient.username);
    if (!u || !isValidUsername(u)) return '';
    return `${u}@${AUTH_MAPPING_DOMAIN}`;
  }, [newClient.username]);

  const toggleSection = (section) => setOpenSection(prev => (prev === section ? null : section));

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;

    if (name.includes('contact.')) {
      const contactKey = name.split('.')[1];
      setNewClient(prev => ({ ...prev, contact: { ...prev.contact, [contactKey]: value } }));
      return;
    }

    if (type === 'checkbox') {
      setNewClient(prev => ({ ...prev, [name]: checked }));
      return;
    }

    setNewClient(prev => ({ ...prev, [name]: value }));
  };

  const handlePermissionChange = (type, key, value) => {
    setNewClient(prev => ({ ...prev, [type]: { ...prev[type], [key]: value } }));
  };

  const handleLanguageChange = (value) =>
    handlePermissionChange('features', 'defaultlanguage', value.toLowerCase());

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    const usernameNorm = normalizeUsername(newClient.username);

    if (!usernameNorm || !newClient.password || (newClient.role !== 'admin' && !newClient.clientId)) {
      setFormError(newClient.role === 'admin' ? "Username and password are required." : "Username, password, and Client ID are required.");
      return;
    }
    if (!isValidUsername(usernameNorm)) {
      setFormError("Username can only contain letters, numbers, dot, underscore, and dash.");
      return;
    }
    if (Array.isArray(clients) && clients.some(c => normalizeUsername(c.username) === usernameNorm)) {
      setFormError(t('username_already_exists'));
      return;
    }

    const profile = {
      username: usernameNorm,
      clientId: String(newClient.clientId).trim().toUpperCase(),
      contact: {
        name: String(newClient.contact?.name || '').trim(),
        email: String(newClient.contact?.email || '').trim(),
      },
      features: { ...newClient.features, defaultlanguage: (newClient.features?.defaultlanguage || 'en').toLowerCase() },
      commands: { ...newClient.commands },
      commission: newClient.role === 'partner' ? String(newClient.commission ?? '0') : "0",
      active: newClient.active !== false,
      role: newClient.role || 'user',
      authEmail: mappedEmail || undefined
    };

    onCreate({
      username: usernameNorm,
      password: newClient.password,
      clientId: profile.clientId,
      profile
    });

    setNewClient(prev => ({ ...prev, password: '' }));
  };

  const PermissionToggle = ({ label, isChecked, onChange }) => (
    <div className="flex items-center justify-between py-2.5 px-3 border-b border-gray-100 last:border-b-0">
      <span className="text-sm font-medium text-gray-700 capitalize">{label.replace(/_/g, ' ')}</span>
      <button
        type="button"
        onClick={() => onChange(!isChecked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isChecked ? 'bg-blue-600' : 'bg-gray-300'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isChecked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );

  const SectionAccordion = ({ section, children }) => (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => toggleSection(section)}
        className="w-full flex justify-between items-center px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="text-sm font-semibold text-gray-700 capitalize">{t(section)}</span>
        <svg className={`w-4 h-4 text-gray-500 transition-transform ${openSection === section ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {openSection === section && (
        <div className="bg-white divide-y divide-gray-100">
          {children}
        </div>
      )}
    </div>
  );

  const inputClass = "mt-1 block w-full border border-gray-300 rounded-lg shadow-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition";
  const labelClass = "block text-sm font-medium text-gray-700 mb-0.5";

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Create New Client</h2>
        <p className="text-sm text-gray-500 mt-1">
          A Firebase Auth account will be created at{' '}
          <span className="font-mono text-blue-600">{mappedEmail || `username@${AUTH_MAPPING_DOMAIN}`}</span>
        </p>
      </div>

      {formError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm">
          <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          {formError}
        </div>
      )}

      <form onSubmit={handleSubmit} autoComplete="off">
        {/* Account Section */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm mb-4">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Account</h3>
          </div>
          <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t('username')} <span className="text-red-500">*</span></label>
              <input
                type="text"
                name="username"
                value={newClient.username}
                onChange={handleInputChange}
                autoComplete="off"
                className={inputClass}
                placeholder="e.g. acme_client"
                required
              />
              <p className="text-xs text-gray-400 mt-1 font-mono">{mappedEmail || `username@${AUTH_MAPPING_DOMAIN}`}</p>
            </div>

            <div>
              <label className={labelClass}>{t('password')} <span className="text-red-500">*</span></label>
              <div className="relative mt-1">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={newClient.password}
                  onChange={handleInputChange}
                  autoComplete="new-password"
                  className="block w-full border border-gray-300 rounded-lg shadow-sm px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  placeholder="Set initial password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className={labelClass}>Role</label>
              <select name="role" value={newClient.role} onChange={handleInputChange} className={inputClass}>
                <option value="user">User</option>
                <option value="partner">Partner</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div>
              <label className={`${labelClass} ${newClient.role === 'admin' ? 'text-gray-400' : ''}`}>
                {t('client_id')} {newClient.role !== 'admin' && <span className="text-red-500">*</span>}
              </label>
              <input
                type="text"
                name="clientId"
                value={newClient.clientId}
                onChange={handleInputChange}
                autoComplete="off"
                className={`${inputClass} ${newClient.role === 'admin' ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''}`}
                placeholder={newClient.role === 'admin' ? 'Not required for admins' : 'e.g. ACME'}
                disabled={newClient.role === 'admin'}
                required={newClient.role !== 'admin'}
              />
            </div>
          </div>
        </div>

        {/* Contact Section */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm mb-4">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Contact <span className="text-gray-400 font-normal normal-case">(Optional)</span></h3>
          </div>
          <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t('contact_name')}</label>
              <input type="text" name="contact.name" value={newClient.contact.name} onChange={handleInputChange}
                autoComplete="off" className={inputClass} placeholder="Full name" />
            </div>
            <div>
              <label className={labelClass}>{t('contact_email')}</label>
              <input type="email" name="contact.email" value={newClient.contact.email} onChange={handleInputChange}
                autoComplete="off" className={inputClass} placeholder="email@example.com" />
            </div>
          </div>
        </div>

        {/* Settings Section */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm mb-4">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Settings</h3>
          </div>
          <div className="px-5 py-4 space-y-1">
            <PermissionToggle label="Active" isChecked={newClient.active}
              onChange={(value) => setNewClient(prev => ({ ...prev, active: value }))} />
            {newClient.role === 'partner' && (
              <div className="px-3 pt-2 pb-1">
                <label className={labelClass}>{t('commission_percentage')}</label>
                <input type="number" name="commission" value={newClient.commission || ''}
                  onChange={handleInputChange} className={inputClass} min="0" max="100" step="0.1" placeholder="0" />
              </div>
            )}
          </div>
        </div>

        {/* Permissions Section */}
        <div className="space-y-2 mb-6">
          <div className={newClient.role === 'admin' ? 'opacity-50 pointer-events-none' : ''}>
            <SectionAccordion section="features">
              {newClient.role === 'admin' && (
                <p className="text-xs text-gray-500 px-4 py-2 italic">Admins have all features enabled</p>
              )}
              <div className="px-4 py-3">
                <MultiSwitch
                  label={t('default_language')}
                  options={['EN', 'FR']}
                  value={(newClient.features.defaultlanguage || 'en').toLowerCase()}
                  onChange={(val) => handleLanguageChange(val)}
                />
              </div>
              {featuresList.map(key => (
                <PermissionToggle key={key} label={key}
                  isChecked={newClient.role === 'admin' ? true : newClient.features[key]}
                  onChange={(value) => handlePermissionChange('features', key, value)} />
              ))}
            </SectionAccordion>

            <SectionAccordion section="commands">
              {newClient.role === 'admin' && (
                <p className="text-xs text-gray-500 px-4 py-2 italic">Admins have all commands enabled</p>
              )}
              {Object.keys(newClient.commands).map(key => (
                <PermissionToggle key={key} label={key}
                  isChecked={newClient.role === 'admin' ? true : newClient.commands[key]}
                  onChange={(value) => handlePermissionChange('commands', key, value)} />
              ))}
            </SectionAccordion>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel}
            className="px-5 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            {t('cancel')}
          </button>
          <button type="submit"
            className="px-6 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors shadow-sm">
            {t('create_client')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreateClientForm;
