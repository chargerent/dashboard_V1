// src/pages/KioskEditorPage.jsx

import { useState } from 'react';
import KioskEditPanel from '../components/kiosk/KioskEditPanel';
import CommandStatusToast from '../components/UI/CommandStatusToast';

function KioskEditorPage({ token, onNavigateToDashboard, onLogout, t, kioskData, onCommand, commandStatus, onDismissCommandStatus }) {
    // [DEBUG] Log the commandStatus prop every time the component renders
    console.log('[DEBUG] KioskEditorPage rendered. Current commandStatus:', commandStatus);

    // The commandStatus state is now managed by the parent component.

    return (
        <div className="min-h-screen bg-gray-100">
            <header className="bg-white shadow-sm">
                <div className="max-w-7xl mx-auto py-4 px-4 sm:px-4 lg:px-6 flex justify-between items-center">
                    <img className="h-12 w-auto" src="/logo.png" alt="Company Logo"/>
                    <div className="flex items-center space-x-4">
                        <button onClick={onNavigateToDashboard} className="p-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300" title={t('back_to_dashboard')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                        </button>
                        <button onClick={onLogout} className="p-2 rounded-md bg-red-500 text-white hover:bg-red-600" title={t('logout')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        </button>
                    </div>
                </div>
            </header>
            <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
                <CommandStatusToast status={commandStatus} onDismiss={onDismissCommandStatus} />
                <div className="bg-white p-6 rounded-lg shadow-md">
                    {/* The KioskManager component is being replaced by KioskEditPanel directly */}
                    <KioskEditPanel kiosk={kioskData} onSave={() => {}} isVisible={true} t={t} onCommand={onCommand} />
                </div>
            </main>
        </div>
    );
}

export default KioskEditorPage;