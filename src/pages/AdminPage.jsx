// src/pages/AdminPage.jsx
import { useState, useMemo, useEffect, useCallback } from 'react';
import ConfirmationModal from '../components/UI/ConfirmationModal.jsx';
import LoadingSpinner from '../components/UI/LoadingSpinner.jsx';
import ClientAdminCard from './ClientAdminCard.jsx';
import CreateClientForm from './CreateClientForm.jsx';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import { callFunctionWithAuth } from '../utils/callableRequest.js';

import { auth, db } from '../firebase-config';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';

// permission keys
const featuresList = ['rentals', 'details', 'stationid', 'address', 'status', 'reporting', 'lease_revenue', 'rental_counts', 'rental_revenue', 'client_commission', 'rep_commission', 'search', 'binding', 'testing'];
const commandsList = ['edit', 'lock', 'eject', 'eject_multiple', 'updates', 'connectivity', 'reboot', 'reload', 'disable', 'client edit'];

function AdminPage({
  onNavigateToDashboard,
  onLogout,
  t,
  onNavigateToProvisionPage,
  onNavigateToAgreement,
  onNavigateToTemplates,
  currentUser,
}) {
  const [clients, setClients] = useState([]);
  const [originalClients, setOriginalClients] = useState([]);
  const [loginAttempts, setLoginAttempts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState(null);

  const [showCreateClientForm, setShowCreateClientForm] = useState(false);

  const [editingClientUid, setEditingClientUid] = useState(null);
  const [editedClientData, setEditedClientData] = useState(null);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState(null);
  const [firebaseUser, setFirebaseUser] = useState(auth.currentUser || null);

  const isAdmin = currentUser?.role === 'admin' || currentUser?.username === 'chargerent';
  const canManageClients = isAdmin || currentUser?.commands?.['client edit'] === true;
  const canUseProvisionTools = isAdmin || currentUser?.commands?.edit === true || canManageClients;
  const canViewTemplates = currentUser?.username === 'chargerent';

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user || null);
    });
    return () => unsubscribe();
  }, []);

  const ensureSignedIn = useCallback(async () => {
    if (!auth.currentUser) {
      throw new Error('Not signed in');
    }

    await auth.currentUser.getIdToken(true);
    return auth.currentUser;
  }, []);

  const fetchClients = useCallback(async () => {
    if (!canManageClients) {
      setClients([]);
      setOriginalClients([]);
      setLoginAttempts({});
      setError('');
      setLoading(false);
      return;
    }

    if (!firebaseUser) {
      setLoginAttempts({});
      setLoading(false);
      setError('Not signed in');
      return;
    }

    try {
      setLoading(true);
      setError('');

      await ensureSignedIn();
      const [res, attemptsSnap] = await Promise.all([
        callFunctionWithAuth('admin_listUsers'),
        getDocs(collection(db, 'loginAttempts')),
      ]);
      const data = (res?.users || []).map(normalizeBindingClient);
      const attemptsMap = {};
      attemptsSnap.forEach((docSnap) => {
        attemptsMap[docSnap.id] = docSnap.data();
      });

      // Normalize for your existing UI components:
      // Each client object includes uid + profile fields.
      setClients(data);
      setOriginalClients(JSON.parse(JSON.stringify(data)));
      setLoginAttempts(attemptsMap);
    } catch (e) {
      console.error(e);
      setError(e?.message || 'Failed to fetch clients (permission denied or backend not deployed).');
    } finally {
      setLoading(false);
    }
  }, [canManageClients, ensureSignedIn, firebaseUser]);

  useEffect(() => {
    if (!canManageClients) return;
    if (!firebaseUser) {
      setLoading(false);
      return;
    }
    fetchClients();
  }, [canManageClients, fetchClients, firebaseUser]);

  const hasChanges = useMemo(() => JSON.stringify(clients) !== JSON.stringify(originalClients), [clients, originalClients]);

  // ---- edit mode ----
  const handleEditClick = (uid) => {
    setEditingClientUid(uid);
    const clientToEdit = clients.find(c => c.uid === uid);
    if (!clientToEdit) return;

    const copy = normalizeBindingClient(clientToEdit);
    if (!copy.contact) copy.contact = { name: '', email: '' };
    if (!copy.features) copy.features = {};
    if (!copy.features.defaultlanguage) copy.features.defaultlanguage = 'en';
    if (!copy.commands) copy.commands = {};
    setEditedClientData(copy);
  };

  const handleCancelEdit = () => {
    setEditingClientUid(null);
    setEditedClientData(null);
  };

  const handleClientDataChange = (key, value) => {
    setEditedClientData(prev => {
      const next = { ...prev };
      if (key.includes('.')) {
        const [parent, child] = key.split('.');
        next[parent] = { ...next[parent], [child]: value };
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  const handleUpdateClient = async () => {
    if (!editedClientData || !canManageClients) return;

    // Keep clientId uppercase
    const finalData = { ...editedClientData };
    if (finalData.clientId) finalData.clientId = String(finalData.clientId).trim().toUpperCase();
    const nextPassword = String(finalData.password || '').trim();
    if (nextPassword && nextPassword.length < 12) {
      setSaveStatus({ state: 'error', message: 'Password must be at least 12 characters.' });
      return;
    }

    // optimistic UI
    setClients(prev => prev.map(c => (c.uid === editingClientUid ? finalData : c)));
    setEditingClientUid(null);
    setEditedClientData(null);

    setSaveStatus({ state: 'sending', message: 'Updating client...' });

    try {
      await ensureSignedIn();
      await callFunctionWithAuth('admin_upsertUserProfile', {
        uid: finalData.uid,
        profile: stripUnsafeFields(finalData),
      });
      if (nextPassword) {
        await callFunctionWithAuth('admin_setUserPassword', {
          uid: finalData.uid,
          password: nextPassword,
        });
      }
      setSaveStatus({ state: 'success', message: t('update_success') });
      await fetchClients(); // refresh from source of truth
    } catch (e) {
      console.error(e);
      setSaveStatus({ state: 'error', message: e?.message || t('update_failed') });
      await fetchClients();
    }
  };

  // ---- create ----
  const handleCreateClient = async ({ username, password, clientId, profile }) => {
    if (!canManageClients) return;
    setSaveStatus(null);

    // avoid dup username in current list
    const uname = (profile?.username || '').toLowerCase();
    if (clients.some(c => (c.username || '').toLowerCase() === uname)) {
      setSaveStatus({ state: 'error', message: t('username_already_exists') });
      return;
    }

    setSaveStatus({ state: 'sending', message: 'Creating client...' });
    try {
      await ensureSignedIn();
      await callFunctionWithAuth('admin_createAuthUserAndProfile', {
        username,
        password,
        clientId,
        profile: stripUnsafeFields(profile),
      });
      setShowCreateClientForm(false);
      setSaveStatus({ state: 'success', message: t('create_success') });
      await fetchClients();
    } catch (e) {
      console.error(e);
      setSaveStatus({ state: 'error', message: e?.message || t('update_failed') });
    }
  };

  // ---- delete ----
  const handleDeleteClick = (uid) => {
    setClientToDelete(uid);
    setDeleteModalOpen(true);
  };

  const cancelDelete = () => {
    setDeleteModalOpen(false);
    setClientToDelete(null);
  };

  const confirmDelete = async () => {
    if (!clientToDelete || !canManageClients) return;
    setSaveStatus({ state: 'sending', message: 'Deleting client...' });

    try {
      await ensureSignedIn();
      await callFunctionWithAuth('admin_deleteUser', { uid: clientToDelete });
      setSaveStatus({ state: 'success', message: t('update_success') });
      setDeleteModalOpen(false);
      setClientToDelete(null);
      await fetchClients();
    } catch (e) {
      console.error(e);
      setSaveStatus({ state: 'error', message: e?.message || 'Failed to delete client' });
      setDeleteModalOpen(false);
    }
  };

  // Keep your “save permissions” button, but make it a no-op since we save immediately on changes.
  const handleSave = async () => {
    setSaveStatus({ state: 'success', message: 'Changes are saved instantly now.' });
  };

  // If your ClientAdminCard calls onPermissionChange, keep it:
  const handlePermissionChange = async (uid, type, key, value) => {
    if (!canManageClients) return;
    const updated = clients.find(c => c.uid === uid);
    if (!updated) return;

    const next = JSON.parse(JSON.stringify(updated));
    if (key === undefined) {
      next[type] = value;
    } else {
      next[type] = { ...(next[type] || {}), [key]: value };
    }

    // optimistic
    setClients(prev => prev.map(c => (c.uid === uid ? next : c)));

    try {
      await ensureSignedIn();
      await callFunctionWithAuth('admin_upsertUserProfile', {
        uid,
        profile: stripUnsafeFields(next),
      });
    } catch (e) {
      console.error(e);
      setSaveStatus({ state: 'error', message: e?.message || t('update_failed') });
      await fetchClients();
    }
  };

  const handleUnlockUser = async (username) => {
    if (!canManageClients) return;

    setSaveStatus({ state: 'sending', message: 'Unlocking user...' });
    try {
      await ensureSignedIn();
      await callFunctionWithAuth('admin_unlockUser', { username });
      setSaveStatus({ state: 'success', message: 'User unlocked.' });
      await fetchClients();
    } catch (e) {
      console.error(e);
      setSaveStatus({ state: 'error', message: e?.message || 'Failed to unlock user' });
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <ConfirmationModal
        isOpen={deleteModalOpen}
        onClose={cancelDelete}
        onConfirm={confirmDelete}
        details={{
          title: t('delete_client_title'),
          confirmationText: `${t('delete_client_confirmation')} ${clientToDelete}?`,
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
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </button>
            {canUseProvisionTools && (
              <button onClick={onNavigateToProvisionPage} className="p-2 rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200" title={t('provision_kiosk')}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
            )}

            {canManageClients && (
              <button onClick={onNavigateToAgreement} className="p-2 rounded-md bg-purple-100 text-purple-700 hover:bg-purple-200" title={t('create_agreement')}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              </button>
            )}

            {canViewTemplates && (
              <button onClick={onNavigateToTemplates} className="p-2 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200" title={t('template_gallery')}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm9 0a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2V5zM4 16a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H6a2 2 0 01-2-2v-3zm9 0a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2v-3z" />
                </svg>
              </button>
            )}

            <button onClick={onLogout} className="p-2 rounded-md bg-red-500 text-white hover:bg-red-600" title={t('logout')}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
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
            {canManageClients && (
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
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                    {clients
                      .filter(client => client && client.username !== undefined)
                      .map(client => {
                        const usernameKey = String(client.username || '').trim().toLowerCase();
                        return (
                        <ClientAdminCard
                          key={client.uid}
                          client={client}
                          onPermissionChange={(uid, type, key, value) => handlePermissionChange(uid, type, key, value)}
                          isEditing={editingClientUid === client.uid}
                          editedData={editedClientData}
                          onEdit={() => handleEditClick(client.uid)}
                          onCancel={handleCancelEdit}
                          onSave={handleUpdateClient}
                          onDataChange={handleClientDataChange}
                          onDelete={() => handleDeleteClick(client.uid)}
                          featuresList={featuresList}
                          currentUser={currentUser}
                          commandsList={commandsList}
                          lockoutData={loginAttempts[usernameKey] || loginAttempts[client.username] || null}
                          onUnlock={() => handleUnlockUser(client.username)}
                          t={t}
                        />
                        );
                      })}

                    <div
                      className="flex min-h-[180px] cursor-pointer items-center justify-center rounded-lg bg-white p-6 shadow-md transition-colors duration-200 hover:bg-gray-50"
                      onClick={() => setShowCreateClientForm(true)}
                    >
                      <div className="text-center text-gray-400">
                        <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M12 4v16m8-8H4" />
                        </svg>
                        <p className="mt-2 text-lg font-medium">{t('add_new_client')}</p>
                      </div>
                    </div>
                  </div>
                )}

                {!showCreateClientForm && (
                  <div className="mt-8 flex justify-end">
                    <button
                      onClick={handleSave}
                      disabled={!hasChanges}
                      className="rounded-lg bg-blue-600 px-8 py-3 font-bold text-white shadow-md transition-all duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                    >
                      {t('save_permissions')}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// Strip anything we NEVER want in Firestore profiles from the browser
function stripUnsafeFields(client) {
  const c = normalizeBindingClient(client);
  delete c.password;
  delete c.Email;
  delete c.email;
  delete c.token;
  delete c.serverFlowVersion;
  delete c.serverUiVersion;
  return c;
}

function hasBindingAccess(profile) {
  return profile?.features?.binding === true || profile?.commands?.binding === true;
}

function normalizeBindingClient(client) {
  const copy = JSON.parse(JSON.stringify(client || {}));

  if (!copy.features) copy.features = {};
  if (hasBindingAccess(copy)) {
    copy.features.binding = true;
  }

  if (copy.commands && Object.prototype.hasOwnProperty.call(copy.commands, 'binding')) {
    delete copy.commands.binding;
  }

  return copy;
}

export default AdminPage;
