// src/components/InactivityModal.jsx
import ModalPortal from './UI/ModalPortal';

const InactivityModal = ({ isOpen, onStay, onLogout, countdown, t }) => {
    if (!isOpen) {
        return null;
    }

    const translateOrFallback = (key, fallback) => {
        const translated = t(key);
        return translated && translated !== key ? translated : fallback;
    };
    const title = translateOrFallback('session_timeout_title', 'Are you still there?');
    const message = translateOrFallback(
        'session_timeout_message',
        'For your security, you will be logged out in {seconds} seconds due to inactivity.'
    ).replace('{seconds}', String(countdown));
    const stayLoggedIn = translateOrFallback('stay_logged_in', 'Stay Logged In');

    return (
        <ModalPortal>
        <div className="fixed inset-0 bg-black bg-opacity-50 z-[100] flex justify-center items-center p-4" role="presentation">
            <div role="dialog" aria-modal="true" aria-labelledby="inactivity-modal-title" className="bg-white p-8 rounded-lg shadow-xl text-center max-w-sm mx-auto">
                <h2 id="inactivity-modal-title" className="text-2xl font-bold mb-4">{title}</h2>
                <p className="mb-6">{message}</p>
                <div className="flex justify-center space-x-4">
                    <button type="button" onClick={onLogout} className="px-6 py-2 rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300">{t('logout')}</button>
                    <button type="button" onClick={onStay} className="px-6 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600">{stayLoggedIn}</button>
                </div>
            </div>
        </div>
        </ModalPortal>
    );
};

export default InactivityModal;
