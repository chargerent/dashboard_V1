// src/components/UI/NgrokModal.jsx

function NgrokModal({ isOpen, onClose, info, t }) {
    if (!isOpen) return null;
    
    // Construct the URLs based on the kiosk ID from the info prop
    const dashboardUrl = `https://${info?.kioskId}.ngrok.io/`;
    const uiUrl = `https://${info?.kioskId}.ngrok.io/ui`;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white p-6 rounded-lg shadow-xl max-w-sm mx-auto">
                <h2 className="text-lg font-bold mb-4 text-center">{t('ngrok_connected')}</h2>
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
                        <button onClick={onClose} className="bg-gray-300 text-gray-800 font-semibold py-2 px-6 rounded-md hover:bg-gray-400">
                            {t('close')}
                        </button>
                </div>
            </div>
        </div>
    );
}

export default NgrokModal;