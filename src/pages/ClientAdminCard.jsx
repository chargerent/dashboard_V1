// src/components/admin/ClientAdminCard.jsx

import { useState, useEffect } from 'react';
import MultiSwitch from '../utils/MultiSwitch';

const ClientAdminCard = ({ client, onPermissionChange, featuresList, commandsList, t, isEditing, editedData, onEdit, onCancel, onSave, onDataChange, onDelete, currentUser }) => {
    if (!client || !currentUser) return null; // Prevent rendering if client or currentUser is undefined

    const [openSection, setOpenSection] = useState(null);

    useEffect(() => {
        setOpenSection(null); // Reset open sections when edit mode changes
    }, [isEditing]);

    const toggleSection = (section) => {
        setOpenSection(prev => (prev === section ? null : section));
    };

    const handlePermissionToggle = (type, key, value) => {
        // Special handling for the top-level 'active' property
        if (key === 'active') {
            if (isEditing) {
                onDataChange('active', value); // Update top-level 'active' in editedData
            } else {
                onPermissionChange(client.username, 'active', value); // Update top-level 'active' for client
            }
            return;
        }

        if (isEditing) {
            onDataChange(`${type}.${key}`, value);
        } else { // This else block is for view mode, where onPermissionChange is used
            onPermissionChange(client.username, type, key, value); // Update nested properties like features.rentals
            if (type === 'commands' && key === 'details' && value === true) { // Ensure 'details' is enabled if a command is turned on
                onPermissionChange(client.username, 'features', 'details', true);
            }
        }
    };

    const SectionButton = ({ section, isEditing }) => (
        <button 
            type="button"
            onClick={() => toggleSection(section)}
            className="w-full flex justify-between items-center p-3 font-semibold text-gray-700 hover:bg-gray-100 rounded-lg"
        >
            <span>{t(section)}</span>
            <svg className={`w-5 h-5 transition-transform ${openSection === section ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
        </button>
    );

    const PermissionToggle = ({ label, isChecked, onChange, disabled }) => (
        <div className={`flex items-center justify-between py-2 px-3 border-b border-gray-100 last:border-b-0 ${disabled ? 'opacity-50' : ''}`}>
            <span className="text-sm font-medium text-gray-700 capitalize">{label.replace(/_/g, ' ')}</span>
            <label className={`flex items-center ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                <div className="relative">
                   <input type="checkbox" className="sr-only" checked={!!isChecked} onChange={e => !disabled && onChange(e.target.checked)} disabled={disabled} />
                   <div className={`block w-10 h-6 rounded-full transition ${isChecked ? (disabled ? 'bg-blue-300' : 'bg-blue-600') : 'bg-gray-300'}`}></div>
                   <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${isChecked ? 'translate-x-4' : ''}`}></div>
                </div>
            </label>
        </div>
    );

    const renderEditForm = () => {
        if (!editedData) return null;
        const allFeatures = { ...Object.fromEntries(featuresList.map(k => [k, false])), ...(editedData.features || {}) };
        const allCommands = { ...Object.fromEntries(commandsList.map(k => [k, false])), ...(editedData.commands || {}) };

        return (
            <div className="p-4">
                    <div className="space-y-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Username</label>
                            <input type="text" value={editedData.username} onChange={(e) => onDataChange('username', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Client ID</label>
                            <input type="text" value={editedData.clientId} onChange={(e) => onDataChange('clientId', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Password (leave blank to keep unchanged)</label>
                            <input type="password" placeholder="Enter new password to change" value={editedData.password || ''} onChange={(e) => onDataChange('password', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Contact Name</label>
                            <input type="text" value={editedData.contact?.name || ''} onChange={(e) => onDataChange('contact.name', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Contact Email</label>
                            <input type="email" value={editedData.contact?.email || ''} onChange={(e) => onDataChange('contact.email', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" />
                        </div>
                        <div className="flex items-center gap-4 border-t pt-3">
                            <div className="w-1/2">
                                <PermissionToggle
                                    label="Partner"
                                    isChecked={editedData.partner}
                                    onChange={(value) => onDataChange('partner', value)}
                                />
                            </div>
                            {editedData.partner && (
                                <div className="w-1/2">
                                    <label className="block text-sm font-medium text-gray-700">{t('commission_percentage')}</label>
                                    <input type="number" value={editedData.commission || ''} onChange={(e) => onDataChange('commission', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" min="0" max="100" step="0.1" />
                                </div>
                            )}
                        </div>                        
                        {/* Active switch - only visible for partners, disabled for partners themselves */}
                        {editedData.partner && ( // Only render if the client is a partner
                            <PermissionToggle
                                label="Active"
                                isChecked={editedData.active}
                                onChange={(value) => handlePermissionToggle(null, 'active', value)} // Call handlePermissionToggle for top-level 'active'
                                disabled={currentUser.username !== 'chargerent'} />
                        )}
                    </div>
                    <div className={`p-2 mt-4 ${isEditing ? 'border-t' : ''}`}>
                        <SectionButton section="features" isEditing={isEditing} />
                        {openSection === 'features' && (
                            <div className="bg-gray-50 rounded-md p-2 mt-1">
                                <MultiSwitch
                                    label={t('default_language')}
                                    options={['EN', 'FR']}
                                    value={editedData.features?.defaultlanguage || 'en'}
                                    onChange={(value) => {
                                        if (isEditing) {
                                            onDataChange('features.defaultlanguage', value);
                                        }
                                    }}
                                />                                
                                {featuresList.map(key => (
                                    <PermissionToggle
                                        key={key} label={key} isChecked={allFeatures[key]}
                                        onChange={(value) => handlePermissionToggle('features', key, value)}
                                    />
                                ))}
                            </div>
                        )}
                        <SectionButton section="commands" isEditing={isEditing} />
                        {openSection === 'commands' && (
                            <div className="bg-gray-50 rounded-md p-2 mt-1">
                                {Object.keys(allCommands).map(key => (
                                    <PermissionToggle key={key} label={key} isChecked={allCommands[key]}
                                        onChange={(value) => handlePermissionToggle('commands', key, value)} />
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="flex justify-end gap-2 mt-4 p-4 border-t">
                        <button onClick={onCancel} className="bg-gray-200 text-gray-800 font-semibold py-1 px-3 rounded-md hover:bg-gray-300">Cancel</button>
                        <button onClick={onSave} className="bg-blue-600 text-white font-semibold py-1 px-3 rounded-md hover:bg-blue-700">Save</button>
                    </div>
            </div>
        );
    };

    const renderViewMode = () => {
        const allFeatures = { ...Object.fromEntries((featuresList || []).map(k => [k, false])), ...(client.features || {}) };
        const allCommands = { ...Object.fromEntries((commandsList || []).map(k => [k, false])), ...(client.commands || {}) };
        const contact = client.contact || {};

        return (
            <>
                <div className="p-4 border-b border-gray-200">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <h3 className="font-bold text-lg text-gray-800">{client.username}</h3>
                            {client.partner && (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-blue-600">
                                    <path fillRule="evenodd" d="M8.603 3.799A4.49 4.49 0 0 1 12 2.25c1.357 0 2.573.6 3.397 1.549a4.49 4.49 0 0 1 3.498 1.307 4.491 4.491 0 0 1 1.307 3.497A4.49 4.49 0 0 1 21.75 12c0 1.357-.6 2.573-1.549 3.397a4.49 4.49 0 0 1-1.307 3.498 4.491 4.491 0 0 1-3.497 1.307A4.49 4.49 0 0 1 12 21.75a4.49 4.49 0 0 1-3.397-1.549 4.49 4.49 0 0 1-3.498-1.307 4.491 4.491 0 0 1-1.307-3.497A4.49 4.49 0 0 1 2.25 12c0-1.357.6-2.573 1.549-3.397a4.49 4.49 0 0 1 1.307-3.498 4.491 4.491 0 0 1 3.497-1.307Zm7.007 6.387a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" />
                                </svg>
                            )}
                        </div>                        <div className="flex items-center gap-2">
                            <button onClick={() => onEdit(client.username)} className="p-1.5 rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-600" title={t('edit_client')}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L14.732 3.732z" /></svg>
                            </button>
                            <button onClick={() => onDelete(client.username)} className="p-1.5 rounded-full text-gray-400 hover:bg-red-200 hover:text-red-600" title={t('delete_client_title')}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                        </div>
                    </div>
                    <p className="text-sm text-gray-500">{client.clientId}</p>
                    <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-600">
                        <p><strong>Contact:</strong> {contact.name || 'N/A'}</p>
                        <p><strong>Email:</strong> {contact.email || 'N/A'}</p>
                    </div>
                </div>
                {/* Active switch - only visible for partners, disabled for partners themselves */}
                {client.partner && ( // Only render if the client is a partner
                    <PermissionToggle
                        label="Active"
                        isChecked={client.active}
                        onChange={(value) => handlePermissionToggle(null, 'active', value)} // Call handlePermissionToggle for top-level 'active'
                        disabled={currentUser.username !== 'chargerent'} />
                )}
                <div className="p-2">
                    <SectionButton section="features" />
                    {openSection === 'features' && (
                        <div className="bg-gray-50 rounded-md p-2 mt-1">
                            <MultiSwitch
                                label={t('default_language')}
                                options={['EN', 'FR']}
                                value={client.features?.defaultlanguage || 'en'}
                                onChange={(value) => onPermissionChange(client.username, 'features', 'defaultlanguage', value)}
                            />
                            {featuresList.map(key => (
                                <PermissionToggle
                                    key={key} label={key} isChecked={allFeatures[key]}
                                    onChange={(value) => handlePermissionToggle('features', key, value)}
                                />
                            ))}
                        </div>
                    )}
                    <SectionButton section="commands" />
                    {openSection === 'commands' && (
                        <div className="bg-gray-50 rounded-md p-2 mt-1">
                            {Object.keys(allCommands).map(key => (<PermissionToggle key={key} label={key} isChecked={allCommands[key]} onChange={(value) => handlePermissionToggle('commands', key, value)} />))}
                        </div>
                    )}
                </div>
            </>
        );
    };

    return (
        <div className="bg-white rounded-lg shadow-md flex flex-col">
            {isEditing ? renderEditForm() : renderViewMode()}
        </div>
    );
};

export default ClientAdminCard;