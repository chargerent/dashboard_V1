// src/components/kiosk/KioskManager.jsx

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import CommandStatusToast from '../UI/CommandStatusToast';
import KioskEditPanel from '../kiosk/KioskEditPanel';
import LoadingSpinner from '../UI/LoadingSpinner';
import ConfirmationModal from '../UI/ConfirmationModal';

const API_BASE_URL = ''; // Use relative path, assuming proxy or same host

function KioskManager({ token, t, setSuccessMessage, setErrorMessage }) {
    const [kiosks, setKiosks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedKioskId, setSelectedKioskId] = useState('');
    const [editingKiosk, setEditingKiosk] = useState(null);
    const [commandModalOpen, setCommandModalOpen] = useState(false);
    const [commandDetails, setCommandDetails] = useState(null);
    const [commandStatus, setCommandStatus] = useState(null); // Added state for command status
    const onMessageHandlerRef = useRef(); // Ref for WebSocket message handler
    // Mocking these versions for now, ideally they come from a higher-level state
    const serverUiVersion = "1.0.0"; 
    const serverFlowVersion = "1.0.0";
    const ws = useRef(null);

    useEffect(() => {
        const fetchKiosks = async () => {
            try {
                setLoading(true); // Use API_BASE_URL for consistency
                const response = await fetch(`${API_BASE_URL}/api/v1/kiosks`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!response.ok) throw new Error('Failed to fetch kiosks.');
                const data = await response.json();
                setKiosks(prevKiosks => {
                    const newKiosks = data.stations || [];
                    if (editingKiosk) {
                        // If we are editing a kiosk, don't update it from the fetch
                        const editingId = editingKiosk.stationid;
                        const currentKioskInState = prevKiosks.find(k => k.stationid === editingId);
                        const kioskIndex = newKiosks.findIndex(k => k.stationid === editingId);
                        if (kioskIndex !== -1 && currentKioskInState) {
                            newKiosks[kioskIndex] = currentKioskInState;
                        }
                    }
                    return newKiosks;
                });
            } catch (err) {
                setErrorMessage(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchKiosks();
    }, [token, editingKiosk]);

    // WebSocket message handler logic
    useEffect(() => {
        onMessageHandlerRef.current = (event) => {
            console.log('--- Admin WebSocket Message Received ---', JSON.parse(event.data));
            try {
                const message = JSON.parse(event.data);
                if (message.action === 'command_response') {
                    if (message.status === 'success') {
                        setCommandStatus({ type: 'success', message: message.message || t('command_success') });
                        // If it was an infochange, update the local kiosks state
                        if (message.original_action === 'infochange' && message.stationid && message.section && message.data) {
                            setKiosks(prevKiosks => prevKiosks.map(k => 
                                k.stationid === message.stationid ? { ...k, [message.section]: { ...k[message.section], ...message.data } } : k
                            ));
                        }
                    } else {
                        setCommandStatus({ type: 'error', message: `${t('command_failed')} ${message.message}` });
                    }
                }
                // No ngrok_info handling needed here as it's specific to DashboardPage
            } catch (e) {
                console.error("Error parsing Admin WebSocket message:", e);
                setCommandStatus({ type: 'error', message: t('invalid_response') });
            }
        };
    }, [t]);

    // WebSocket connection establishment
    useEffect(() => {
        const connectWebSocket = () => {
            if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
                return;
            }
            ws.current = new WebSocket(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${API_BASE_URL}/ws/commands?token=${token}`);
            ws.current.onopen = () => console.log("Admin WebSocket connection established.");
            ws.current.onmessage = (event) => onMessageHandlerRef.current(event); // Added onmessage handler
            ws.current.onclose = () => setTimeout(connectWebSocket, 5000);
            ws.current.onerror = (err) => console.error("Admin WebSocket error:", err);
        };
        connectWebSocket();
        return () => {
            if (ws.current) ws.current.close();
        };
    }, [token]);

    const handleKioskSelectionChange = (kioskId) => {
        setSelectedKioskId(kioskId);
        if (kioskId) {
            const selectedKiosk = kiosks.find(k => k.stationid === kioskId);
            // Deep copy to avoid mutating the original state
            setEditingKiosk(selectedKiosk ? JSON.parse(JSON.stringify(selectedKiosk)) : null);
        } else {
            setEditingKiosk(null);
        }
    };

    const handleKioskDataChange = useCallback((section, path, value) => {
        setEditingKiosk(prev => {
            const newKioskData = JSON.parse(JSON.stringify(prev)); // Deep copy to avoid mutation
            const newSectionData = newKioskData[section] || {};
            const keys = path.split('.');
            let current = newSectionData;

            for (let i = 0; i < keys.length - 1; i++) {
                if (!current[keys[i]]) {
                    current[keys[i]] = {};
                }
                current = current[keys[i]];
            }
            current[keys[keys.length - 1]] = value;
            newKioskData[section] = newSectionData;
            return newKioskData;
        });
    }, []);

    const handleKioskSave = useCallback((stationid, section, data) => {
        const confirmationText = t('save_info_confirmation');
        // Prepare details for the confirmation modal
        setCommandDetails({
            stationid,
            action: 'infochange',
            kiosk: editingKiosk,
            confirmationText,
        });
        setCommandModalOpen(true);
    }, [t, editingKiosk]);

    const handleGeneralCommand = useCallback((stationid, action, moduleid = null, provisionid = null, version = null, count = null, reason = null) => {
        let confirmationText = '';
        const command = { stationid, action, moduleid, provisionid, version, count, reason };

        switch (action) {
            case 'reboot':
                confirmationText = t('reboot_confirmation');
                break;
            case 'reload ui':
                confirmationText = "Are you sure you want to reload the UI?";
                break;
            case 'disable':
                confirmationText = "Are you sure you want to disable this kiosk?";
                break;
            case 'ngrok connect':
                confirmationText = t('ngrok_connect_confirmation');
                break;
            case 'ssh connect':
                confirmationText = t('ssh_connect_confirmation');
                break;
            case 'update flow':
                confirmationText = `Are you sure you want to update the flow to version ${serverFlowVersion}?`;
                command.version = serverFlowVersion;
                break;
            case 'update ui':
                confirmationText = `Are you sure you want to update the UI to version ${serverUiVersion}?`;
                command.version = serverUiVersion;
                break;
            case 'eject count':
                confirmationText = `${t('eject_count_confirmation')} ${count} ${t('chargers')}?`;
                break;
            case 'rent':
                confirmationText = t('rent_confirmation');
                break;
            default:
                // For actions without confirmation, send immediately
                if (ws.current && ws.current.readyState === WebSocket.OPEN) {
                    const messageToSend = { type: 'command', token: token, data: command };
                    ws.current.send(JSON.stringify(messageToSend));
                    const message = { type: 'command', token: token, data: command };
                    ws.current.send(JSON.stringify(message));
                }
                return;
        }
        setCommandDetails({ ...command, confirmationText });
        setCommandModalOpen(true);
    }, [t]);

    const executeCommand = async () => {
        if (!commandDetails) return;

        const messageToSend = { type: 'command', token: token, data: commandDetails };

        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify(messageToSend));
            setCommandStatus({ type: 'info', message: t('sending_command') });
        } else {
            setErrorMessage(t('connection_lost'));
        }

        setCommandModalOpen(false);
        // Only reset the view if it was a save action
        if (commandDetails.action === 'infochange' && commandDetails.kiosk) {
            // Optimistically update the kiosk in the main list
            setKiosks(prevKiosks => prevKiosks.map(k => 
                k.stationid === commandDetails.stationid ? commandDetails.kiosk : k
            ));
            setEditingKiosk(null);
            setSelectedKioskId('');
        }
        if (commandDetails.action === 'infochange') {
            setEditingKiosk(null);
            setSelectedKioskId('');
        }
    };
    
    const clientInfo = useMemo(() => ({
        features: { rentals: true, details: true, stationid: true, address: true },
        commands: { edit: true, lock: true, eject: true, eject_multiple: true, updates: true, connectivity: true, reboot: true, reload: true, disable: true }
    }), []);

    const onConfirm = () => {
        executeCommand();
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-48">
                <LoadingSpinner t={t} />
            </div>
        );
    }

    return (
        <>
            <ConfirmationModal
                isOpen={commandModalOpen}
                onClose={() => setCommandModalOpen(false)}
                onConfirm={onConfirm}
                details={commandDetails}
                t={t}
            />
            <CommandStatusToast status={commandStatus} onDismiss={() => setCommandStatus(null)} /> {/* Render CommandStatusToast */}
            <div className="mt-8">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold">{t('edit_kiosks')}</h2>
                    <button className="bg-green-500 text-white font-semibold py-2 px-4 rounded-md hover:bg-green-600">{t('add_kiosk')}</button>
                </div>
                <div className="mb-6">
                    <label htmlFor="kiosk-select" className="block text-sm font-medium text-gray-700 mb-2">{t('select_kiosk')}</label>
                    <select id="kiosk-select" value={selectedKioskId} onChange={(e) => handleKioskSelectionChange(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500">
                        <option value="">-- {t('select_a_kiosk')} --</option>
                        {kiosks.map(kiosk => <option key={kiosk.stationid} value={kiosk.stationid}>{kiosk.stationid} - {kiosk.info.place}</option>)}
                    </select>
                </div>
                {editingKiosk && <KioskEditPanel 
                    kiosk={editingKiosk} 
                    onDataChange={handleKioskDataChange} 
                    onSave={handleKioskSave}
                    onCommand={handleGeneralCommand}
                    clientInfo={clientInfo}
                    t={t}
                    serverUiVersion={serverUiVersion}
                    serverFlowVersion={serverFlowVersion}
                    showControls={false}
                />}
            </div>
        </>
    );
}

export default KioskManager;