// src/pages/AdminPage.jsx

import { useState, useMemo, useEffect } from 'react';
import ConfirmationModal from '../components/UI/ConfirmationModal.jsx';
import LoadingSpinner from '../components/UI/LoadingSpinner.jsx';
import ClientAdminCard from './ClientAdminCard.jsx';
import CreateClientForm from './CreateClientForm.jsx';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
// These are the permission keys that will be displayed as checkboxes
const API_BASE_URL = '';
const featuresList = ['rentals', 'details', 'stationid', 'address', 'status', 'reporting', 'lease_revenue', 'rental_counts', 'rental_revenue', 'client_commission', 'rep_commission'];
const commandsList = ['edit', 'lock', 'eject', 'eject_multiple', 'updates', 'connectivity', 'reboot', 'reload', 'disable', 'client edit'];


function AdminPage({ token, onNavigateToDashboard, onLogout, t, onNavigateToProvisionPage, onNavigateToAgreement }) {
    const [clients, setClients] = useState([]);
    const [originalClients, setOriginalClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [saveStatus, setSaveStatus] = useState(null);
    const [showCreateClientForm, setShowCreateClientForm] = useState(false);
    const [editingClientOriginalUsername, setEditingClientOriginalUsername] = useState(null);
    const [editedClientData, setEditedClientData] = useState(null);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [clientToDelete, setClientToDelete] = useState(null);

    // Fetch all clients when the component mounts
    const fetchClients = async () => {
        try {
            setLoading(true);
            setError('');
            const response = await fetch(`${API_BASE_URL}/api/v1/clients`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) throw new Error('Failed to fetch clients.');
            const data = await response.json();
            setOriginalClients(JSON.parse(JSON.stringify(data || [])));
            setClients(data || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchClients();
    }, [token]);

    const handlePermissionChange = (username, type, key, value) => {
        setClients(prevClients => 
            prevClients.map(client => {
                if (client.username === username) {
                    const newClient = { ...client };
                    // Handle direct properties like 'defaultLanguage'
                    if (key === undefined) {
                        newClient[type] = value;
                    } else {
                        // Handle nested properties like 'features.rentals'
                        newClient[type] = {
                            ...client[type],
                            [key]: value
                        };
                    }
                    return newClient;
                }
                return client;
            })
        );
    };

    const handleEditClick = (username) => {
        setEditingClientOriginalUsername(username);
        // Find the original client data to ensure we start with a clean slate
        const clientToEdit = clients.find(c => c.username === username);
        const clientDataCopy = JSON.parse(JSON.stringify(clientToEdit));
        
        // Ensure contact object and password exist for the edit form
        if (!clientDataCopy.contact) clientDataCopy.contact = { name: '', email: '' };
        if (!clientDataCopy.features) clientDataCopy.features = {};
        if (!clientDataCopy.features.defaultlanguage) clientDataCopy.features.defaultlanguage = 'en';
        setEditedClientData(clientDataCopy);
    };

    const handleCancelEdit = () => {
        setEditingClientOriginalUsername(null);
        setEditedClientData(null);
    };

    const handleClientDataChange = (key, value) => {
        setEditedClientData(prev => {
            const newClientData = { ...prev };
            if (key.includes('.')) {
                const [parent, child] = key.split('.');
                newClientData[parent] = { ...newClientData[parent], [child]: value };
            } else {
                newClientData[key] = value;
            }
            return newClientData;
        });
    };

    const handleUpdateClient = () => {
        if (!editedClientData) return;

        // Prevent username collisions before saving
        if (clients.some(client => client.username === editedClientData.username && client.username !== editingClientOriginalUsername)) {
            setSaveStatus({ state: 'error', message: t('username_already_exists') });
            return;
        }

        const originalClient = originalClients.find(c => c.username === editingClientOriginalUsername);
        const finalData = { ...editedClientData };

        // Ensure clientId is always saved in uppercase
        if (finalData.clientId) {
            finalData.clientId = finalData.clientId.toUpperCase();
        }

        // Only include the password in the update if it has been changed.
        // If it's blank, we assume no change is intended.
        if (!finalData.password && originalClient) {
            delete finalData.password; // Don't send password if it's not changed
        }
        setClients(prevClients => 
            prevClients.map(client => client.username === editingClientOriginalUsername ? finalData : client)
        );
        setEditingClientOriginalUsername(null);
        setEditedClientData(null);
        setSaveStatus({ state: 'success', message: "Client updated locally. Press 'Save Permissions' to commit all changes." });
    };

    const handleCreateClient = (newClientData) => {
        // Perform validation here, where `clients` is always up-to-date.
        if (clients.some(client => client.username === newClientData.username)) {
            // We can show an error, but for now, we'll rely on the form's internal error.
            // This logic is now primarily in the form itself, but this is a good safeguard.
            setSaveStatus({ state: 'error', message: t('username_already_exists') });
            return;
        }
        newClientData.partner = newClientData.partner || false; // Ensure partner field is set
        newClientData.commission = newClientData.commission || 0; // Ensure commission field is set
        // Ensure clientId is always saved in uppercase
        if (newClientData.clientId) {
            newClientData.clientId = newClientData.clientId.toUpperCase();
        }

        setClients(prevClients => [...prevClients, newClientData]);
        setShowCreateClientForm(false);
        setSaveStatus({ state: 'success', message: "Client added locally. Press 'Save Permissions' to commit." });
    };

    const handleDeleteClick = (username) => {
        setClientToDelete(username);
        setDeleteModalOpen(true);
    };

    const confirmDelete = () => {
        setClients(prevClients => prevClients.filter(client => client.username !== clientToDelete));
        setDeleteModalOpen(false);
        setClientToDelete(null);
        setSaveStatus({ state: 'success', message: "Client removed locally. Press 'Save Permissions' to commit." });
    };

    const cancelDelete = () => {
        setDeleteModalOpen(false);
        setClientToDelete(null);
    };

    const handleSave = async () => {
        setSaveStatus({ state: 'sending', message: 'Saving client permissions...' });
        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/clients`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(clients)
            });
            if (!response.ok) throw new Error(t('update_failed'));
            setSaveStatus({ state: 'success', message: t('update_success') });
            setOriginalClients(JSON.parse(JSON.stringify(clients))); // Update baseline to disable save button
        } catch (err) {
            setSaveStatus({ state: 'error', message: err.message });
        }
    };

    const hasChanges = useMemo(() => {
        return JSON.stringify(clients) !== JSON.stringify(originalClients);
    }, [clients, originalClients]);

    return (
        <div className="min-h-screen bg-gray-100">
            <ConfirmationModal
                isOpen={deleteModalOpen}
                onClose={cancelDelete}
                onConfirm={confirmDelete}
                details={{
                    title: t('delete_client_title'),
                    confirmationText: `${t('delete_client_confirmation')} ${clientToDelete}?`
                }}
                t={t}
            />
            <CommandStatusToast status={saveStatus} onDismiss={() => setSaveStatus(null)} />
            <header className="bg-white shadow-sm">
                <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <button onClick={() => {}} className={`px-2 py-1 text-sm font-bold rounded-md bg-blue-600 text-white`}>EN</button>
                        <button onClick={() => {}} className={`px-2 py-1 text-sm font-bold rounded-md bg-gray-200 text-gray-700`}>FR</button>
                    </div>
                    <div className="flex items-center gap-4">
                        <button onClick={onNavigateToDashboard} className="p-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300" title={t('back_to_dashboard')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                        </button>
                        <button onClick={onNavigateToProvisionPage} className="p-2 rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200" title={t('provision_kiosk')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                        </button>
                        <button onClick={onNavigateToAgreement} className="p-2 rounded-md bg-purple-100 text-purple-700 hover:bg-purple-200" title={t('create_agreement')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
                        </button>
                        <button onClick={onLogout} className="p-2 rounded-md bg-red-500 text-white hover:bg-red-600" title={t('logout')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        </button>
                    </div>
                </div>
            </header>
            <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
                {loading ? (
                    <div className="flex justify-center items-center h-64">
                        <LoadingSpinner t={t} />
                    </div>
                ) : error ? (
                    <p className="bg-red-100 text-red-700 p-3 rounded-md mb-4">{error}</p>
                ) : (
                    <>
                        {showCreateClientForm ? (
                            <div className="mb-6">
                                <CreateClientForm 
                                    clients={clients}
                                    onCreate={handleCreateClient} 
                                    onCancel={() => setShowCreateClientForm(false)} 
                                    t={t}
                                    featuresList={featuresList}
                                    commandsList={commandsList}
                                />
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                {clients
                                    .filter(client => client && client.username !== undefined) // Add a filter to ensure client object is valid
                                    .map(client => (
                                        <ClientAdminCard 
                                            key={client.username} 
                                            client={client} 
                                            onPermissionChange={handlePermissionChange}
                                            isEditing={editingClientOriginalUsername === client.username}
                                            editedData={editedClientData}
                                            onEdit={handleEditClick}
                                            onCancel={handleCancelEdit}
                                            onSave={handleUpdateClient}
                                            onDataChange={handleClientDataChange}
                                            onDelete={handleDeleteClick}
                                            featuresList={featuresList}
                                            currentUser={client}
                                            commandsList={commandsList}
                                            t={t}
                                        />
                                    ))}
                                <div 
                                    className="bg-white rounded-lg shadow-md flex items-center justify-center p-6 cursor-pointer hover:bg-gray-50 transition-colors duration-200"
                                    onClick={() => setShowCreateClientForm(true)}
                                    style={{ minHeight: '180px' }}
                                >
                                    <div className="text-center text-gray-400">
                                        <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M12 4v16m8-8H4"></path></svg>
                                        <p className="mt-2 text-lg font-medium">{t('add_new_client')}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                        
                        {!showCreateClientForm && (
                            <div className="flex justify-end mt-8">
                                <button 
                                    onClick={handleSave} 
                                    disabled={!hasChanges}
                                    className="bg-blue-600 text-white font-bold py-3 px-8 rounded-lg shadow-md hover:bg-blue-700 transition-all duration-200 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                >
                                    {t('save_permissions')}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}

export default AdminPage;