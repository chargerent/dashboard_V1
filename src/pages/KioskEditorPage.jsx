// src/pages/KioskEditorPage.jsx

import KioskEditPanel from '../components/kiosk/KioskEditPanel';
import CommandStatusToast from '../components/UI/CommandStatusToast';
import DashboardPageActions from '../components/UI/DashboardPageActions.jsx';

function KioskEditorPage({ _token, onNavigateToDashboard, onNavigateToAdmin, onLogout, t, kioskData, onCommand, commandStatus, onDismissCommandStatus }) {
    // [DEBUG] Log the commandStatus prop every time the component renders
    console.log('[DEBUG] KioskEditorPage rendered. Current commandStatus:', commandStatus);

    // The commandStatus state is now managed by the parent component.

    return (
        <div className="min-h-screen bg-gray-100">
            <header className="bg-white shadow-sm">
                <div className="max-w-7xl mx-auto py-4 px-4 sm:px-4 lg:px-6 flex justify-between items-center">
                    <img className="h-12 w-auto" src="/logo.png" alt="Company Logo"/>
                    <DashboardPageActions
                        onNavigateToDashboard={onNavigateToDashboard}
                        onNavigateToAdmin={onNavigateToAdmin}
                        onLogout={onLogout}
                        t={t}
                    />
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
