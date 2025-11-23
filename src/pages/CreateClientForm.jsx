// src/components/admin/CreateClientForm.jsx

import { useState } from 'react';
import MultiSwitch from '../utils/MultiSwitch';

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
        },
        commands: Object.fromEntries(commandsList.map(k => [k, false])),
        partner: false,
        commission: 0
    });
    const [openSection, setOpenSection] = useState(null);
    const [formError, setFormError] = useState(null);

    const toggleSection = (section) => {
        setOpenSection(prev => (prev === section ? null : section));
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        if (name.includes('contact.')) {
            const contactKey = name.split('.')[1];
            setNewClient(prev => ({
                ...prev,
                contact: { ...prev.contact, [contactKey]: value }
            }));
        } else {
            setNewClient(prev => ({ ...prev, [name]: value }));
            // Special handling for defaultLanguage if it's part of the main form
            if (name === 'defaultLanguage') {
                setNewClient(prev => ({ ...prev, defaultLanguage: value }));
            }
        }
    };

    const handleTopLevelChange = (key, value) => {
        setNewClient(prev => ({ ...prev, [key]: value }));
    };

    const handlePermissionChange = (type, key, value) => {
        setNewClient(prev => ({
            ...prev,
            [type]: { ...prev[type], [key]: value }
        }));
    };

    const handleLanguageChange = (value) => {
        handlePermissionChange('features', 'defaultlanguage', value);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setFormError(null);
        if (!newClient.username || !newClient.password || !newClient.clientId) {
            setFormError("Username, password, and Client ID are required.");
            return;
        }
        if (clients.some(client => client.username === newClient.username)) {
            setFormError(t('username_already_exists'));
            return;
        }
        // The client object is now complete from the form state.
        onCreate(newClient);
    };

    const SectionButton = ({ section }) => (
        <button 
            type="button"
            onClick={() => toggleSection(section)}
            className="w-full flex justify-between items-center p-3 font-semibold text-gray-700 hover:bg-gray-100 rounded-lg"
        >
            <span>{t(section)}</span>
            <svg className={`w-5 h-5 transition-transform ${openSection === section ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
        </button>
    );

    const PermissionToggle = ({ label, isChecked, onChange }) => (
        <div className="flex items-center justify-between py-2 px-3 border-b border-gray-100 last:border-b-0">
            <span className="text-sm font-medium text-gray-700 capitalize">{label.replace(/_/g, ' ')}</span>
            <label className="flex items-center cursor-pointer">
                <div className="relative">
                   <input type="checkbox" className="sr-only" checked={!!isChecked} onChange={e => onChange(e.target.checked)} />
                   <div className={`block w-10 h-6 rounded-full transition ${isChecked ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
                   <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${isChecked ? 'translate-x-4' : ''}`}></div>
                </div>
            </label>
        </div>
    );

    return (
        <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="font-bold text-xl text-gray-800 mb-4">{t('create_new_client')}</h3>
            {formError && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">{formError}</div>}
            <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">{t('username')} <span className="text-red-500">*</span></label>
                        <input type="text" name="username" value={newClient.username} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">{t('password')} <span className="text-red-500">*</span></label>
                        <input type="password" name="password" value={newClient.password} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">{t('client_id')} <span className="text-red-500">*</span></label>
                        <input type="text" name="clientId" value={newClient.clientId} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">{t('contact_name')} (Optional)</label>
                        <input type="text" name="contact.name" value={newClient.contact.name} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700">{t('contact_email')} (Optional)</label>
                        <input type="email" name="contact.email" value={newClient.contact.email} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
                    </div>
                    <div className="md:col-span-2 flex items-center gap-4 border-t pt-4">
                        <div className="w-1/2">
                            <PermissionToggle
                                label="Partner"
                                isChecked={newClient.partner}
                                onChange={(value) => handleTopLevelChange('partner', value)}
                            />
                        </div>
                        {newClient.partner && (
                            <div className="w-1/2">
                                <label className="block text-sm font-medium text-gray-700">{t('commission_percentage')}</label>
                                <input type="number" name="commission" value={newClient.commission || ''} onChange={handleInputChange} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" min="0" max="100" step="0.1" />
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-2 border-t border-gray-200 mt-4">
                    <SectionButton section="features" />
                    {openSection === 'features' && (
                        <div className="bg-gray-50 rounded-md p-2 mt-1">
                            <MultiSwitch 
                                label={t('default_language')}
                                options={['EN', 'FR']}
                                value={newClient.features.defaultlanguage}
                                onChange={handleLanguageChange}
                            />
                            {featuresList.map(key => (<PermissionToggle key={key} label={key} isChecked={newClient.features[key]} onChange={(value) => handlePermissionChange('features', key, value)} />))}
                        </div>
                    )}
                    <SectionButton section="commands" />
                    {openSection === 'commands' && <div className="bg-gray-50 rounded-md p-2 mt-1">{Object.keys(newClient.commands).map(key => (<PermissionToggle key={key} label={key} isChecked={newClient.commands[key]} onChange={(value) => handlePermissionChange('commands', key, value)} />))}</div>}
                </div>

                <div className="flex justify-end gap-3 mt-6">
                    <button type="button" onClick={onCancel} className="bg-gray-300 text-gray-800 font-bold py-2 px-5 rounded-md hover:bg-gray-400 transition-all">{t('cancel')}</button>
                    <button type="submit" className="bg-green-600 text-white font-bold py-2 px-5 rounded-md hover:bg-green-700 transition-all">{t('create_client')}</button>
                </div>
            </form>
        </div>
    );
};

export default CreateClientForm;