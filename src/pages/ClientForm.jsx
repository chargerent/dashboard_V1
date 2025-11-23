// src/components/admin/ClientForm.jsx
import { useState, useEffect } from 'react';

function ClientForm({ client, onSave, onClose, featuresList, commandsList, t }) {
    const [clientData, setClientData] = useState({
        name: '',
        features: {},
        commands: {}
    });

    useEffect(() => {
        if (client) {
            setClientData({
                id: client.id,
                name: client.name || '',
                features: client.features || {},
                commands: client.commands || {}
            });
        } else {
            setClientData({ name: '', features: {}, commands: {} });
        }
    }, [client]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setClientData(prev => ({ ...prev, [name]: value }));
    };

    const handlePermissionChange = (type, key, value) => {
        setClientData(prev => ({
            ...prev,
            [type]: {
                ...prev[type],
                [key]: value
            }
        }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(clientData);
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-20 mx-auto p-5 border w-full max-w-2xl shadow-lg rounded-md bg-white">
                <form onSubmit={handleSubmit}>
                    <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">
                        {client ? t('edit_client') : t('create_client')}
                    </h3>
                    <div className="mb-4">
                        <label htmlFor="name" className="block text-sm font-medium text-gray-700">{t('client_name') || 'Client Name'}</label>
                        <input
                            type="text"
                            name="name"
                            id="name"
                            value={clientData.name}
                            onChange={handleInputChange}
                            className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            required
                        />
                    </div>

                    <div className="mb-6">
                        <h4 className="text-md font-semibold border-b pb-2 mb-3">{t('features')}</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {featuresList.map(key => (
                                <label key={key} className="flex items-center space-x-3">
                                    <input type="checkbox" checked={!!clientData.features[key]} onChange={(e) => handlePermissionChange('features', key, e.target.checked)} className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                                    <span className="text-gray-700 capitalize">{t(key) || key}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h4 className="text-md font-semibold border-b pb-2 mb-3">{t('commands')}</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {commandsList.map(key => (
                                <label key={key} className="flex items-center space-x-3">
                                    <input type="checkbox" checked={!!clientData.commands[key]} onChange={(e) => handlePermissionChange('commands', key, e.target.checked)} className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                                    <span className="text-gray-700 capitalize">{t(key) || key.replace('_', ' ')}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="mt-6 flex justify-end space-x-3">
                        <button type="button" onClick={onClose} className="bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-md hover:bg-gray-300">
                            {t('cancel')}
                        </button>
                        <button type="submit" className="bg-blue-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-blue-700">
                            {t('save')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default ClientForm;