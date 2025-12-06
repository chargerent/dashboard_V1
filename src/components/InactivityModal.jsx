// src/components/InactivityModal.jsx
import React from 'react';

const InactivityModal = ({ isOpen, onStay, onLogout, countdown, t }) => {
    if (!isOpen) {
        return null;
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center">
            <div className="bg-white p-8 rounded-lg shadow-xl text-center max-w-sm mx-auto">
                <h2 className="text-2xl font-bold mb-4">{t('session_timeout_title') || 'Are you still there?'}</h2>
                <p className="mb-6">{t('session_timeout_message', { seconds: countdown }) || `For your security, you will be logged out in ${countdown} seconds due to inactivity.`}</p>
                <div className="flex justify-center space-x-4">
                    <button onClick={onLogout} className="px-6 py-2 rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300">{t('logout')}</button>
                    <button onClick={onStay} className="px-6 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600">{t('stay_logged_in') || 'Stay Logged In'}</button>
                </div>
            </div>
        </div>
    );
};

export default InactivityModal;