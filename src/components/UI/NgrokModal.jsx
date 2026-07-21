// src/components/UI/NgrokModal.jsx

import ModalPortal from './ModalPortal';

function NgrokModal({ isOpen, onClose, info, t }) {
    if (!isOpen) return null;
    
    // Construct the URLs based on the kiosk ID from the info prop
    const dashboardUrl = `https://${info?.kioskId}.ngrok.io/`;
    const uiUrl = `https://${info?.kioskId}.ngrok.io/ui`;

    return (
        <ModalPortal>
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4" role="presentation">
            <div role="dialog" aria-modal="true" aria-labelledby="ngrok-modal-title" className="bg-white p-6 rounded-lg shadow-xl max-w-sm mx-auto">
                <h2 id="ngrok-modal-title" className="text-lg font-bold mb-4 text-center">{t('ngrok_connected')}</h2>
                <p className="text-gray-600 mb-6 text-center">
                    {info?.message}
                </p>
                <div className="flex flex-col gap-4">
                    <a 
                        href={dashboardUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={onClose}
                        className="bg-blue-500 text-white text-center font-semibold py-2 px-6 rounded-md hover:bg-blue-600"
                    >{t('ngrok_dashboard')}</a>
                    <a 
                        href={uiUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={onClose}
                        className="bg-blue-500 text-white text-center font-semibold py-2 px-6 rounded-md hover:bg-blue-600"
                    >{t('ngrok_ui')}</a>
                </div>
                <div className="mt-6 text-center">
                        <button type="button" onClick={onClose} className="bg-gray-300 text-gray-800 font-semibold py-2 px-6 rounded-md hover:bg-gray-400">
                            {t('close')}
                        </button>
                </div>
            </div>
        </div>
        </ModalPortal>
    );
}

export default NgrokModal;
