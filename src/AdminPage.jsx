// src/pages/AdminPage.jsx
import { useState, useMemo, useEffect, useCallback } from "react";
import ConfirmationModal from "../components/UI/ConfirmationModal.jsx";
import LoadingSpinner from "../components/UI/LoadingSpinner.jsx";
import ClientAdminCard from "./ClientAdminCard.jsx";
import CreateClientForm from "./CreateClientForm.jsx";
import CommandStatusToast from "../components/UI/CommandStatusToast.jsx";

import { auth, functions } from "../firebase-config";
import { onAuthStateChanged } from "firebase/auth";
import { httpsCallable } from "firebase/functions";

// permission keys
const featuresList = [
  "rentals",
  "details",
  "stationid",
  "address",
  "status",
  "reporting",
  "lease_revenue",
  "rental_counts",
  "rental_revenue",
  "client_commission",
  "rep_commission",
  "search",
];
const commandsList = [
  "edit",
  "lock",
  "eject",
  "eject_multiple",
  "updates",
  "connectivity",
  "reboot",
  "reload",
  "disable",
  "client edit",
];

function stripUnsafeFields(obj) {
  const clean = JSON.parse(JSON.stringify(obj || {}));
  delete clean.password;
  delete clean.Password;
  delete clean.token;
  delete clean.Token;
  delete clean.email;
  delete clean.Email;
  return clean;
}

function AdminPage({ onNavigateToDashboard, onLogout, t, onNavigateToProvisionPage, onNavigateToAgreement }) {
  const [firebaseUser, setFirebaseUser] = useState(auth.currentUser || null);

  const [clients, setClients] = useState([]);
  const [_originalClients, setOriginalClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [saveStatus, setSaveStatus] = useState(null);
  const [showCreateClientForm, setShowCreateClientForm] = useState(false);

  const [editingClientUid, setEditingClientUid] = useState(null);
  const [editedClientData, setEditedClientData] = useState(null);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState(null);

  // ✅ Correct callable names (match your deployed exports)
  const listUsersFn = useMemo(() => httpsCallable(functions, "admin_listUsers"), []);
  const upsertUserProfileFn = useMemo(() => httpsCallable(functions, "admin_upsertUserProfile"), []);
  const deleteUserFn = useMemo(() => httpsCallable(functions, "admin_deleteUser"), []);

  // ✅ Make AdminPage robust: wait for auth hydration in THIS module
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setFirebaseUser(u || null);
    });
    return () => unsub();
  }, []);

  const ensureSignedIn = useCallback(async () => {
    if (!auth.currentUser) {
      throw new Error("Not signed in");
    }
    // Force-refresh token right before calling functions
    const tok = await auth.currentUser.getIdToken(true);

    // Debug: confirm we have an ID token
    console.log("[AdminPage] user:", auth.currentUser.email);
    console.log("[AdminPage] token starts:", tok?.slice(0, 20));
  }, []);

  const fetchClients = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      await ensureSignedIn();

      const res = await listUsersFn({});
      const data = res?.data?.users || [];

      setClients(data);
      setOriginalClients(JSON.parse(JSON.stringify(data)));
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to fetch clients.");
    } finally {
      setLoading(false);
    }
  }, [ensureSignedIn, listUsersFn]);

  // ✅ Only fetch once we KNOW firebaseUser exists
  useEffect(() => {
    if (!firebaseUser) {
      setLoading(false);
      setError("Not signed in");
      return;
    }
    fetchClients();
  }, [firebaseUser, fetchClients]);

  const handleEditClick = (uid) => {
    setEditingClientUid(uid);
    const clientToEdit = clients.find((c) => c.uid === uid);
    if (!clientToEdit) return;

    const copy = JSON.parse(JSON.stringify(clientToEdit));
    if (!copy.contact) copy.contact = { name: "", email: "" };
    if (!copy.features) copy.features = {};
    if (!copy.features.defaultlanguage) copy.features.defaultlanguage = "en";
    if (!copy.commands) copy.commands = {};
    setEditedClientData(copy);
  };

  const handleCancelEdit = () => {
    setEditingClientUid(null);
    setEditedClientData(null);
  };

  const handleClientDataChange = (key, value) => {
    setEditedClientData((prev) => {
      const next = { ...prev };
      if (key.includes(".")) {
        const [parent, child] = key.split(".");
        next[parent] = { ...next[parent], [child]: value };
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  const handleUpdateClient = async () => {
    if (!editedClientData) return;

    const finalData = { ...editedClientData };
    if (finalData.clientId) finalData.clientId = String(finalData.clientId).trim().toUpperCase();

    setSaveStatus({ state: "sending", message: "Updating client..." });

    try {
      await ensureSignedIn();

      await upsertUserProfileFn({
        uid: finalData.uid,
        profile: stripUnsafeFields(finalData),
      });

      setSaveStatus({ state: "success", message: t("update_success") });
      setEditingClientUid(null);
      setEditedClientData(null);
      await fetchClients();
    } catch (e) {
      console.error(e);
      setSaveStatus({ state: "error", message: e?.message || t("update_failed") });
      await fetchClients();
    }
  };

  const handleCreateClient = async () => {
    // We’ll wire admin_createAuthUserAndProfile next; for now just refresh
    setShowCreateClientForm(false);
    await fetchClients();
  };

  const handleDeleteClick = (uid) => {
    setClientToDelete(uid);
    setDeleteModalOpen(true);
  };

  const cancelDelete = () => {
    setDeleteModalOpen(false);
    setClientToDelete(null);
  };

  const confirmDelete = async () => {
    setSaveStatus({ state: "sending", message: "Deleting client..." });
    try {
      await ensureSignedIn();
      await deleteUserFn({ uid: clientToDelete });

      setSaveStatus({ state: "success", message: t("update_success") });
      setDeleteModalOpen(false);
      setClientToDelete(null);
      await fetchClients();
    } catch (e) {
      console.error(e);
      setSaveStatus({ state: "error", message: e?.message || "Failed to delete client" });
      setDeleteModalOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <ConfirmationModal
        isOpen={deleteModalOpen}
        onClose={cancelDelete}
        onConfirm={confirmDelete}
        details={{
          title: t("delete_client_title"),
          confirmationText: `${t("delete_client_confirmation")} ${clientToDelete}?`,
        }}
        t={t}
      />

      <CommandStatusToast status={saveStatus} onDismiss={() => setSaveStatus(null)} />

      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button onClick={onNavigateToDashboard} className="p-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300">
              Back
            </button>
            <button onClick={onNavigateToProvisionPage} className="p-2 rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200">
              Provision
            </button>
            <button onClick={onNavigateToAgreement} className="p-2 rounded-md bg-purple-100 text-purple-700 hover:bg-purple-200">
              Agreement
            </button>
          </div>

          <button onClick={onLogout} className="p-2 rounded-md bg-red-500 text-white hover:bg-red-600">
            Logout
          </button>
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
                  .filter((client) => client && client.uid)
                  .map((client) => (
                    <ClientAdminCard
                      key={client.uid}
                      client={client}
                      isEditing={editingClientUid === client.uid}
                      editedData={editedClientData}
                      onEdit={() => handleEditClick(client.uid)}
                      onCancel={handleCancelEdit}
                      onSave={handleUpdateClient}
                      onDataChange={handleClientDataChange}
                      onDelete={() => handleDeleteClick(client.uid)}
                      featuresList={featuresList}
                      commandsList={commandsList}
                      t={t}
                    />
                  ))}

                <div
                  className="bg-white rounded-lg shadow-md flex items-center justify-center p-6 cursor-pointer hover:bg-gray-50 transition-colors duration-200"
                  onClick={() => setShowCreateClientForm(true)}
                  style={{ minHeight: "180px" }}
                >
                  <div className="text-center text-gray-400">
                    <p className="mt-2 text-lg font-medium">{t("add_new_client")}</p>
                  </div>
                </div>
              </div>
            )}

            {!showCreateClientForm && (
              <div className="flex justify-end mt-8">
                <button
                  onClick={fetchClients}
                  className="bg-blue-600 text-white font-bold py-3 px-8 rounded-lg shadow-md hover:bg-blue-700 transition-all duration-200"
                >
                  Refresh
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
