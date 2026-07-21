// src/components/UI/SoldOutKiosksModal.jsx
import ModalPortal from './ModalPortal';

const SoldOutKiosksModal = ({ isOpen, onClose, soldOutKiosks, t }) => {
    if (!isOpen) return null;

    return (
        <ModalPortal>
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4" role="presentation">
            <div role="dialog" aria-modal="true" aria-labelledby="sold-out-modal-title" className="bg-white p-6 rounded-lg shadow-xl max-w-lg w-full">
                <div className="flex justify-between items-center border-b pb-3 mb-4">
                    <h2 id="sold-out-modal-title" className="text-xl font-bold text-gray-800">{t('sold_out_kiosks_title')}</h2>
                    <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                    {soldOutKiosks.length > 0 ? (
                        <ul className="list-disc list-inside bg-gray-50 p-3 rounded-md">
                            {soldOutKiosks.map(kiosk => (
                                <li key={kiosk.stationid} className="text-sm text-gray-600">{kiosk.stationid} - {kiosk.info.location} - {kiosk.info.place}</li>
                            ))}
                        </ul>
                    ) : <p className="text-gray-600">{t('no_sold_out_kiosks')}</p>}
                </div>
            </div>
        </div>
        </ModalPortal>
    );
};

export default SoldOutKiosksModal;
